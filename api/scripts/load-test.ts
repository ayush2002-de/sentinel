// /api/scripts/load-test.ts
// Node.js-based load test (doesn't require k6)
// Run with: pnpm run load-test

import { performance } from 'perf_hooks';

const BASE_URL = process.env.API_URL || 'http://localhost:8080';
const API_KEY = process.env.API_KEY || 'sentinel-dev-key';

interface TestResult {
  endpoint: string;
  status: number;
  duration: number;
  success: boolean;
  error?: string;
}

interface TestSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  successRate: number;
}

// Test configuration
const TEST_CONFIG = {
  warmupRequests: 10,
  testRequests: 100,
  concurrency: 10,
  delayBetweenRequests: 100, // ms
};

async function makeRequest(endpoint: string, method = 'GET'): Promise<TestResult> {
  const start = performance.now();
  const url = `${BASE_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
      },
    });

    const duration = performance.now() - start;

    return {
      endpoint,
      status: response.status,
      duration,
      success: response.status >= 200 && response.status < 300,
    };
  } catch (error: any) {
    const duration = performance.now() - start;
    return {
      endpoint,
      status: 0,
      duration,
      success: false,
      error: error.message,
    };
  }
}

function calculateStats(results: TestResult[]): TestSummary {
  const durations = results.map(r => r.duration).sort((a, b) => a - b);
  const successCount = results.filter(r => r.success).length;

  return {
    totalRequests: results.length,
    successfulRequests: successCount,
    failedRequests: results.length - successCount,
    averageLatency: durations.reduce((a, b) => a + b, 0) / durations.length,
    p50Latency: durations[Math.floor(durations.length * 0.5)],
    p95Latency: durations[Math.floor(durations.length * 0.95)],
    p99Latency: durations[Math.floor(durations.length * 0.99)],
    successRate: (successCount / results.length) * 100,
  };
}

async function runConcurrentRequests(
  endpoint: string,
  count: number,
  concurrency: number
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const queue: Promise<void>[] = [];

  for (let i = 0; i < count; i++) {
    const promise = makeRequest(endpoint).then(result => {
      results.push(result);
      process.stdout.write('.');
    });

    queue.push(promise);

    // Control concurrency
    if (queue.length >= concurrency) {
      await Promise.race(queue);
      queue.splice(
        queue.findIndex(p => p === promise),
        1
      );
    }

    // Small delay between requests
    if (TEST_CONFIG.delayBetweenRequests > 0) {
      await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.delayBetweenRequests));
    }
  }

  // Wait for all remaining requests
  await Promise.all(queue);
  return results;
}

async function main() {
  console.log('🚀 Starting Sentinel Support Load Test');
  console.log(`Target URL: ${BASE_URL}`);
  console.log(`Concurrency: ${TEST_CONFIG.concurrency}`);
  console.log(`Total Requests: ${TEST_CONFIG.testRequests}\n`);

  // Warmup
  console.log('🔥 Warming up...');
  await runConcurrentRequests('/api/health', TEST_CONFIG.warmupRequests, TEST_CONFIG.concurrency);
  console.log(' Done!\n');

  // Test 1: Health Check
  console.log('📊 Test 1: Health Check');
  const healthResults = await runConcurrentRequests(
    '/api/health',
    TEST_CONFIG.testRequests,
    TEST_CONFIG.concurrency
  );
  console.log(' Done!');
  const healthStats = calculateStats(healthResults);
  printStats('Health Check', healthStats);

  // Test 2: Customer Transactions (Performance-Critical)
  console.log('\n📊 Test 2: Customer Transactions (Performance-Critical)');
  const customerId = 'cus_1';
  const txResults = await runConcurrentRequests(
    `/api/customer/${customerId}/transactions?from=2024-01-01&limit=50`,
    TEST_CONFIG.testRequests,
    TEST_CONFIG.concurrency
  );
  console.log(' Done!');
  const txStats = calculateStats(txResults);
  printStats('Customer Transactions', txStats);

  // Check SLO
  console.log('\n🎯 SLO Check (p95 < 100ms):');
  if (txStats.p95Latency < 100) {
    console.log(`✅ PASSED: p95 latency is ${txStats.p95Latency.toFixed(2)}ms`);
  } else {
    console.log(`❌ FAILED: p95 latency is ${txStats.p95Latency.toFixed(2)}ms (should be < 100ms)`);
  }

  // Test 3: Metrics Endpoint
  console.log('\n📊 Test 3: Metrics Endpoint');
  const metricsResults = await runConcurrentRequests(
    '/api/metrics',
    TEST_CONFIG.testRequests,
    TEST_CONFIG.concurrency
  );
  console.log(' Done!');
  const metricsStats = calculateStats(metricsResults);
  printStats('Metrics', metricsStats);

  // Overall Summary
  console.log('\n📈 Overall Test Summary');
  const allResults = [...healthResults, ...txResults, ...metricsResults];
  const overallStats = calculateStats(allResults);
  printStats('Overall', overallStats);

  // Exit with error if SLO not met
  if (txStats.p95Latency >= 100) {
    process.exit(1);
  }
}

function printStats(name: string, stats: TestSummary) {
  console.log(`\n--- ${name} ---`);
  console.log(`Total Requests:    ${stats.totalRequests}`);
  console.log(`Successful:        ${stats.successfulRequests} (${stats.successRate.toFixed(2)}%)`);
  console.log(`Failed:            ${stats.failedRequests}`);
  console.log(`Average Latency:   ${stats.averageLatency.toFixed(2)}ms`);
  console.log(`p50 Latency:       ${stats.p50Latency.toFixed(2)}ms`);
  console.log(`p95 Latency:       ${stats.p95Latency.toFixed(2)}ms`);
  console.log(`p99 Latency:       ${stats.p99Latency.toFixed(2)}ms`);
}

// Run the load test
main().catch(error => {
  console.error('Load test failed:', error);
  process.exit(1);
});
