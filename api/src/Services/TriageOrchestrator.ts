import { prisma } from '../lib/prisma.js';
import { withTimeout } from './guardrails.js';
import { FraudAgent, FraudReport } from './agents/FraudAgent.js';
import { KBAgent, KBHit } from './agents/KBAgent.js';
import { RedactorAgent } from './agents/RedactorAgent.js';
import { sseService } from './SseService.js';
import { metrics } from './MetricsService.js';
import { z } from 'zod';
import { Alert, Customer, Transaction } from '@prisma/client';

// --- Zod Schemas for Validation ---
// Ensures agent outputs are safe before use

const FraudReportSchema = z.object({
  score: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  reasons: z.array(z.string()),
  recommendedAction: z.enum(['FREEZE_CARD', 'OPEN_DISPUTE', 'NONE']).optional(),
  reasonCode: z.string().optional(), // Visa/Mastercard dispute reason code
  fallback_used: z.boolean().optional(),
});

const KBHitSchema = z.object({
  docId: z.string(),
  title: z.string(),
  anchor: z.string(),
  extract: z.string(),
});

// --- State & Decision Types ---

// The state that is passed between steps
interface TriageState {
  alert: Alert & { suspect_txn?: Transaction | null }; // Enriched Alert type
  customer: Customer;
  recentTx: Transaction[];
  fraudReport?: FraudReport;
  kbHits?: KBHit[];
  finalDecision?: {
    action: string;
    reason: string;
    reasonCode?: string; // Visa/Mastercard dispute reason code
    citations: KBHit[];
    relatedTransactions?: Transaction[]; // For showing duplicates/pre-auth pairs
  };
}

export class TriageOrchestrator {
  private runId: string;
  private state: TriageState;
  private step = 0;
  private fallbackUsed = false;

  constructor(runId: string, initialState: TriageState) {
    this.runId = runId;
    this.state = initialState;
  }

  /**
   * The main triage execution plan.
   */
  public async run(): Promise<TriageState> {
    console.log(`[Orchestrator ${this.runId}] Starting run()`);
    try {
      // --- Step 1: Get Profile & Recent Tx ---
      // (This data is provided in the initial state)
      // We log it as the first "step" for traceability.
      console.log(`[Orchestrator ${this.runId}] Step 1: loadContext`);
      await this.traceStep(
        'loadContext',
        {
          customerId: this.state.customer.id,
          alertId: this.state.alert.id,
          txnId: this.state.alert.suspect_txn_id,
        },
        true
      );
      console.log(`[Orchestrator ${this.runId}] Step 1 complete`);

      // --- Step 2: Run Fraud Signals ---
      // Use suspect_txn if available, otherwise use most recent transaction
      console.log(`[Orchestrator ${this.runId}] Step 2: riskSignals`);
      const txnToAnalyze = this.state.alert.suspect_txn || this.state.recentTx[0];
      console.log(`[Orchestrator ${this.runId}] Transaction to analyze:`, txnToAnalyze?.id || 'NONE');

      if (!txnToAnalyze) {
        // No transaction data available, use fallback
        console.log(`[Orchestrator ${this.runId}] No transaction data, using fallback`);
        this.state.fraudReport = {
          score: 'LOW',
          reasons: ['No transaction data available'],
          recommendedAction: 'NONE',
        };
        this.fallbackUsed = true;

        await this.traceStep('riskSignals', { error: 'No transaction data' }, false, 0);
      } else {
        console.log(`[Orchestrator ${this.runId}] Running FraudAgent...`);

        // Fetch customer's chargeback/dispute history
        const chargebackHistory = await prisma.case.findMany({
          where: { customer_id: this.state.customer.id },
          orderBy: { created_at: 'desc' },
        });

        const fraudReport = await this.runAgent(
          'riskSignals',
          () => FraudAgent.analyze(this.state.recentTx, txnToAnalyze, this.state.customer, chargebackHistory),
          {
            score: 'MEDIUM',
            reasons: ['risk_unavailable (fallback)'],
            recommendedAction: 'NONE',
          }
        );
        console.log(`[Orchestrator ${this.runId}] FraudAgent complete:`, fraudReport);

        // Validate and save state
        const validation = FraudReportSchema.safeParse(fraudReport);
        if (validation.success) {
          this.state.fraudReport = validation.data;
          // Check if the agent used fallback
          if (validation.data.fallback_used === true) {
            this.fallbackUsed = true;
          }
        } else {
          // Log validation error and use fallback
          console.error('FraudAgent output failed validation', validation.error);
          this.state.fraudReport = {
            score: 'MEDIUM',
            reasons: ['risk_validation_failed (fallback)'],
          };
          this.fallbackUsed = true;
        }
      }
      console.log(`[Orchestrator ${this.runId}] Step 2 complete`);

      // --- Step 3: KB Lookup ---
      console.log(`[Orchestrator ${this.runId}] Step 3: kbLookup`);
      const alertMerchant = this.state.alert.suspect_txn?.merchant;
      let kbHits: KBHit[] = [];

      // Search for merchant-specific KB docs
      if (alertMerchant) {
        console.log(`[Orchestrator ${this.runId}] Searching KB for merchant:`, alertMerchant);
        kbHits = await this.runAgent(
          'kbLookup',
          () => KBAgent.search(alertMerchant),
          [] // Fallback is an empty array
        );
        console.log(`[Orchestrator ${this.runId}] Merchant KB hits:`, kbHits.length);
      }

      // Check for duplicate transactions (pre-auth scenario)
      const suspectTxn = this.state.alert.suspect_txn || this.state.recentTx[0];
      const duplicateTransactions = this.state.recentTx.filter(
        (t) => t.merchant === suspectTxn?.merchant &&
               Math.abs(t.amount_cents - (suspectTxn?.amount_cents || 0)) < 100 && // Within $1
               t.id !== suspectTxn?.id
      );

      if (duplicateTransactions.length > 0) {
        console.log(`[Orchestrator ${this.runId}] Found ${duplicateTransactions.length} duplicate transactions, searching for pre-auth KB`);
        const preAuthKbHits = await this.runAgent(
          'kbLookup',
          () => KBAgent.search('pre-auth'),
          []
        );
        console.log(`[Orchestrator ${this.runId}] Pre-auth KB hits:`, preAuthKbHits.length);
        kbHits = [...kbHits, ...preAuthKbHits];
      }

      // If recommending OPEN_DISPUTE, also search for dispute-related KB docs
      if (this.state.fraudReport?.recommendedAction === 'OPEN_DISPUTE') {
        console.log(`[Orchestrator ${this.runId}] Searching KB for dispute guidance`);
        const disputeKbHits = await this.runAgent(
          'kbLookup',
          () => KBAgent.search('dispute'),
          []
        );
        console.log(`[Orchestrator ${this.runId}] Dispute KB hits:`, disputeKbHits.length);
        // Merge dispute KB hits with merchant KB hits
        kbHits = [...kbHits, ...disputeKbHits];
      }

      this.state.kbHits = z.array(KBHitSchema).parse(kbHits); // Validate KB output
      console.log(`[Orchestrator ${this.runId}] Total KB hits:`, kbHits.length);
      console.log(`[Orchestrator ${this.runId}] Step 3 complete`);

      // --- Step 4: Decide & Propose ---
      // This is the final decision logic that synthesizes all agent outputs.
      console.log(`[Orchestrator ${this.runId}] Step 4: finalDecision`);

      let finalAction = this.state.fraudReport?.recommendedAction || 'NONE';
      let finalReason =
        this.state.fraudReport?.reasons[0] || 'No issues found.';
      let finalReasonCode = this.state.fraudReport?.reasonCode;
      let finalCitations: KBHit[] = [];

      // Refine Decision based on KB
      const preAuthHit = this.state.kbHits?.find(
        (hit) => hit.anchor === 'disputes:pre-auth-vs-capture'
      );

      // Find dispute-related KB documents
      const disputeHits = this.state.kbHits?.filter(
        (hit) => hit.anchor.startsWith('disputes:') || hit.title.toLowerCase().includes('dispute')
      ) || [];

      // Acceptance Scenario 3: Handle "Duplicate pending vs captured"
      // Find similar transactions for the suspect transaction
      const relatedDuplicates = this.state.recentTx.filter(
        (t) => t.merchant === txnToAnalyze?.merchant &&
               Math.abs(t.amount_cents - (txnToAnalyze?.amount_cents || 0)) < 100 && // Within $1
               t.id !== txnToAnalyze?.id
      );

      if (relatedDuplicates.length > 0 && preAuthHit) {
        // Found duplicate transactions - likely pre-auth scenario
        finalAction = 'NONE'; // Don't dispute, it's a pre-auth
        finalReason = `Two transactions detected: pre-authorization hold and final capture at ${txnToAnalyze?.merchant}. This is normal for ${txnToAnalyze?.mcc === '4121' ? 'ride-sharing' : 'this type of'} merchant. Not fraudulent.`;
        finalCitations = [preAuthHit];

        // Include all related transactions in the decision
        this.state.finalDecision = {
          action: finalAction,
          reason: finalReason,
          reasonCode: finalReasonCode,
          citations: finalCitations,
          relatedTransactions: [txnToAnalyze, ...relatedDuplicates].filter(Boolean) as Transaction[],
        };
        console.log(`[Orchestrator ${this.runId}] Step 4 complete`);

        console.log(`[Orchestrator ${this.runId}] Finalizing run...`);
        await this.finalizeRun();
        console.log(`[Orchestrator ${this.runId}] Run complete successfully`);
        return this.state;
      } else if (finalAction === 'OPEN_DISPUTE' && disputeHits.length > 0) {
        // Add dispute KB citations when recommending to open dispute
        finalCitations = disputeHits;
      }

      // Refine based on Compliance/Policy (example)
      if (finalAction === 'FREEZE_CARD') {
        finalReason += ' (Policy: OTP may be required for unfreeze)';
      }

      // Save the final decision to state
      this.state.finalDecision = {
        action: finalAction,
        reason: finalReason,
        reasonCode: finalReasonCode,
        citations: finalCitations,
      };
      console.log(`[Orchestrator ${this.runId}] Step 4 complete`);

      console.log(`[Orchestrator ${this.runId}] Finalizing run...`);
      await this.finalizeRun();
      console.log(`[Orchestrator ${this.runId}] Run complete successfully`);
      return this.state;
    } catch (error) {
      console.error(`[Orchestrator ${this.runId}] ERROR in run():`, error);
      console.error(`[Orchestrator ${this.runId}] Error stack:`, (error as Error).stack);
      await this.finalizeRun(error as Error);
      throw error;
    }
  }

  /**
   * A wrapped function to run a single agent step with all guardrails.
   */
  private async runAgent<T>(
    stepName: string,
    fn: () => Promise<T>,
    fallback: T
  ): Promise<T> {
    const start = process.hrtime.bigint();
    let ok = false;
    let detail: any;
    let result: T;

    try {
      // --- Apply Guardrails ---
      // 1s Timeout. Retries are handled by the guardrail function if needed.
      result = await withTimeout(() => fn(), 1000, fallback);

      if (result === fallback) {
        this.fallbackUsed = true;
        detail = {
          output: fallback,
          fallback_triggered: true,
          error: 'Agent timed out or failed.',
        };
      } else {
        ok = true;
        detail = { output: result };
      }

      return result;
    } catch (error) {
      detail = { error: (error as Error).message, fallback_triggered: true };
      this.fallbackUsed = true;
      return fallback; // Return fallback on unexpected error
    } finally {
      const end = process.hrtime.bigint();
      const duration_ms = Math.round(Number(end - start) / 1_000_000);

      await this.traceStep(stepName, detail, ok, duration_ms);

      // Record metrics
      metrics.agentLatency.labels(stepName).observe(duration_ms);
      metrics.toolCallTotal.labels(stepName, ok ? 'true' : 'false').inc();
      if (this.fallbackUsed) {
        metrics.agentFallbackTotal.labels(stepName).inc();
      }

      // Dispatch 'tool_update' event to SSE stream
      await sseService.dispatch(this.runId, 'tool_update', {
        step: stepName,
        ok,
        duration_ms,
        detail: ok ? RedactorAgent.redactObject(detail) : null
      });
    }
  }

  /**
   * Writes a trace step to the database.
   */
  private async traceStep(
    stepName: string,
    detail: any,
    ok: boolean,
    duration_ms: number = 0
  ) {
    this.step++;
    await prisma.agentTrace.create({
      data: {
        run_id: this.runId,
        seq: this.step,
        step: stepName,
        ok: ok,
        duration_ms: duration_ms,
        // CRITICAL: Redact all trace details before saving to DB
        detail_json: RedactorAgent.redactObject(detail),
      },
    });
  }

  /**
   * Updates the parent TriageRun with the final state.
   */
  private async finalizeRun(error?: Error) {
    const end = new Date();
    const run = await prisma.triageRun.findUnique({ where: { id: this.runId }});
    const latency_ms = run ? end.getTime() - run.started_at.getTime() : 0;

    await prisma.triageRun.update({
      where: { id: this.runId },
      data: {
        ended_at: end,
        latency_ms: latency_ms,
        fallback_used: this.fallbackUsed,
        // Save the fraud risk score
        risk: this.state.fraudReport?.score || 'LOW',
        reasons: RedactorAgent.redactObject(
          this.state.fraudReport?.reasons || []
        ),
        // We'll store the full redacted decision payload
        // detail_json: RedactorAgent.redactObject(this.state.finalDecision)
      },
    });

    // Dispatch 'decision_finalized' event to SSE stream
    if (error) {
      await sseService.dispatch(this.runId, 'decision_finalized', {
        error: 'Triage run failed',
        reason: error.message
      });
    } else {
      await sseService.dispatch(this.runId, 'decision_finalized', {
        decision: this.state.finalDecision,
        risk: this.state.fraudReport?.score,
      });
    }
  }
}