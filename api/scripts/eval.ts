// /api/scripts/eval.ts
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../src/lib/prisma.js';
import { TriageOrchestrator } from '../src/Services/TriageOrchestrator.js';
import { performance } from 'perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Types ---
interface EvalCase {
  name: string;
  alertId: string;
  expected: {
    risk: 'LOW' | 'MEDIUM' | 'HIGH';
    finalAction: 'FREEZE_CARD' | 'OPEN_DISPUTE' | 'NONE';
    reasonContains?: string;
    fallbackUsed?: boolean;
  };
}

interface EvalResult {
  name: string;
  passed: boolean;
  latency: number;
  actual: {
    risk: string;
    action: string;
    reason: string;
    fallback: boolean;
  };
  expected: EvalCase['expected'];
  error?: string;
}

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'fixtures', 'evals');

async function runEval(filePath: string): Promise<EvalResult> {
  const fileContent = await fs.readFile(filePath, 'utf-8');
  const testCase: EvalCase = JSON.parse(fileContent);

  const start = performance.now();

  try {
    // 1. Fetch data for the orchestrator (same as POST /api/triage)
    const alert = await prisma.alert.findUnique({
      where: { id: testCase.alertId },
      include: { suspect_txn: true },
    });
    if (!alert) throw new Error('Alert not found');

    const customer = await prisma.customer.findUnique({ where: { id: alert.customer_id } });
    if (!customer) throw new Error('Customer not found');

    const recentTx = await prisma.transaction.findMany({
      where: { customer_id: customer.id, ts: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      orderBy: { ts: 'desc' },
      take: 100,
    });

    // If no suspect_txn is linked, use the most recent transaction
    let suspectTransaction = alert.suspect_txn;
    if (!suspectTransaction && recentTx.length > 0) {
      suspectTransaction = recentTx[0];
    }

    if (!suspectTransaction) {
      throw new Error('No transaction found for this customer');
    }

    // Update alert to include the suspect transaction
    const alertWithTxn = {
      ...alert,
      suspect_txn: suspectTransaction
    };

    // 2. Create a dummy TriageRun to get an ID
    const run = await prisma.triageRun.create({
      data: { alert_id: alert.id, risk: 'MEDIUM' },
    });

    // 3. Run the orchestrator
    const orchestrator = new TriageOrchestrator(run.id, { alert: alertWithTxn, customer, recentTx });
    const finalState = await orchestrator.run();
    const end = performance.now();

    // 4. Get final results
    const finalRun = await prisma.triageRun.findUnique({ where: { id: run.id } });
    const decision = finalState.finalDecision;

    const actual = {
      risk: finalRun?.risk || 'ERROR',
      action: decision?.action || 'ERROR',
      reason: decision?.reason || '',
      fallback: finalRun?.fallback_used || false,
    };

    // 5. Compare actual vs. expected
    let passed = true;
    if (actual.risk !== testCase.expected.risk) passed = false;
    if (actual.action !== testCase.expected.finalAction) passed = false;
    if (testCase.expected.reasonContains && !actual.reason.includes(testCase.expected.reasonContains)) passed = false;
    if (testCase.expected.fallbackUsed !== undefined && actual.fallback !== testCase.expected.fallbackUsed) passed = false;

    return {
      name: testCase.name,
      passed,
      latency: end - start,
      actual,
      expected: testCase.expected,
    };
  } catch (error: any) {
    const end = performance.now();
    return {
      name: testCase.name,
      passed: false,
      latency: end - start,
      actual: { risk: 'ERROR', action: 'ERROR', reason: '', fallback: false },
      expected: testCase.expected,
      error: error.message,
    };
  }
}

// --- Main CLI Function ---
(async () => {
  console.log('Running Sentinel Evals...');
  const files = (await fs.readdir(FIXTURES_DIR)).filter(f => f.endsWith('.json'));
  const results: EvalResult[] = [];

  for (const file of files) {
    const result = await runEval(path.join(FIXTURES_DIR, file));
    results.push(result);
    console.log(`[${result.passed ? 'PASS' : 'FAIL'}] ${result.name} (${result.latency.toFixed(0)}ms)`);
  }

  // --- Print Summary Report ---
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const successRate = (passed / results.length) * 100;

  // Calculate fallback rate
  const fallbackCount = results.filter(r => r.actual.fallback === true).length;
  const fallbackRate = (fallbackCount / results.length) * 100;

  // Latency metrics
  const latencies = results.map(r => r.latency).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;

  // Risk Confusion Matrix
  const confusionMatrix = {
    LOW: { LOW: 0, MEDIUM: 0, HIGH: 0 },
    MEDIUM: { LOW: 0, MEDIUM: 0, HIGH: 0 },
    HIGH: { LOW: 0, MEDIUM: 0, HIGH: 0 },
  };

  results.forEach(r => {
    const expected = r.expected.risk as 'LOW' | 'MEDIUM' | 'HIGH';
    const actual = r.actual.risk as 'LOW' | 'MEDIUM' | 'HIGH';
    if (expected && actual && confusionMatrix[expected]) {
      confusionMatrix[expected][actual]++;
    }
  });

  // Policy/Action denials (cases where expected action didn't match)
  const policyDenials = results.filter(
    r => r.expected.finalAction && r.actual.action !== r.expected.finalAction
  );

  console.log('\n--- 📊 Eval Report ---');
  console.log(`Total Cases:    ${results.length}`);
  console.log(`✅ Passed:       ${passed} (${successRate.toFixed(1)}%)`);
  console.log(`❌ Failed:       ${failed} (${(100 - successRate).toFixed(1)}%)`);
  console.log(`🔄 Fallback Rate: ${fallbackCount}/${results.length} (${fallbackRate.toFixed(1)}%)`);

  console.log('\n--- Agent Latency ---');
  console.log(`p50: ${p50.toFixed(0)}ms`);
  console.log(`p95: ${p95.toFixed(0)}ms`);

  console.log('\n--- Risk Confusion Matrix ---');
  console.log('                 Predicted');
  console.log('Actual      LOW    MEDIUM   HIGH');
  console.log(`LOW         ${confusionMatrix.LOW.LOW.toString().padStart(3)}    ${confusionMatrix.LOW.MEDIUM.toString().padStart(3)}      ${confusionMatrix.LOW.HIGH.toString().padStart(3)}`);
  console.log(`MEDIUM      ${confusionMatrix.MEDIUM.LOW.toString().padStart(3)}    ${confusionMatrix.MEDIUM.MEDIUM.toString().padStart(3)}      ${confusionMatrix.MEDIUM.HIGH.toString().padStart(3)}`);
  console.log(`HIGH        ${confusionMatrix.HIGH.LOW.toString().padStart(3)}    ${confusionMatrix.HIGH.MEDIUM.toString().padStart(3)}      ${confusionMatrix.HIGH.HIGH.toString().padStart(3)}`);

  if (policyDenials.length > 0) {
    console.log('\n--- Top Policy Denials ---');
    const denialCounts = new Map<string, number>();
    policyDenials.forEach(r => {
      const key = `Expected ${r.expected.finalAction}, got ${r.actual.action}`;
      denialCounts.set(key, (denialCounts.get(key) || 0) + 1);
    });

    Array.from(denialCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([denial, count]) => {
        console.log(`  ${denial}: ${count} case(s)`);
      });
  }

  if (failed > 0) {
    console.log('\n--- Top Failures ---');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`- ${r.name}`);
      console.log(`  Expected: ${JSON.stringify(r.expected)}`);
      console.log(`  Actual:   ${JSON.stringify(r.actual)}`);
      if (r.error) console.log(`  Error: ${r.error}`);
    });
  }

  // --- Generate JSON Report for Frontend ---
  const reportData = {
    summary: {
      totalCases: results.length,
      passed,
      failed,
      successRate: successRate.toFixed(1),
      fallbackCount,
      fallbackRate: fallbackRate.toFixed(1),
    },
    latency: {
      p50: p50.toFixed(0),
      p95: p95.toFixed(0),
    },
    confusionMatrix,
    policyDenials: Array.from(new Map<string, number>().entries()).map(([denial, count]) => ({
      denial,
      count,
    })),
    failures: results
      .filter(r => !r.passed)
      .map(r => ({
        name: r.name,
        expected: r.expected,
        actual: r.actual,
        error: r.error,
      })),
  };

  // Define the output path to the web's public directory
  const reportPath = path.join(
    __dirname, // /api/scripts
    '..',      // /api
    '..',      // /sentinel-support
    'web',     // /web
    'public',  // /web/public
    'eval-report.json'
  );

  try {
    await fs.writeFile(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`\n✅ Eval report written to ${reportPath}`);
  } catch (err) {
    console.error(`\n❌ Failed to write eval report:`, err);
  }

  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1); // Exit with error code
  }
})();
