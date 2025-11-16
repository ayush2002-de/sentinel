// /api/src/routes/index.ts
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import type { Prisma } from '@prisma/client';

// --- Import new services and middleware ---
import { TriageOrchestrator } from '../Services/TriageOrchestrator.js';
import { sseService } from '../Services/SseService.js';
import { AuditService } from '../Services/AuditService.js';
import { metrics } from '../Services/MetricsService.js';
import { ComplianceAgent } from '../Services/agents/ComplianceAgent.js';
import { apiKeyAuth } from '../middleware/auth.js';
import { actionRateLimiter, triageRateLimiter } from '../middleware/rateLimit.js';

export const apiRoutes = Router();

// --- Module-level storage for pending triage states ---
// This stores the initial state for triage runs that haven't started yet
const pendingTriageStates = new Map<string, any>();

// --- 1. Core APIs ---

apiRoutes.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', ts: new Date().toISOString() });
});

apiRoutes.get('/metrics', async (req, res, next) => {
  try {
    res.setHeader('Content-Type', metrics.registry.contentType);
    res.end(await metrics.getMetrics());
  } catch (error) {
    next(error);
  }
});

// --- 2. Ingest API ---

// Zod schema for a single transaction (matches Prisma schema)
const transactionIngestSchema = z.object({
  id: z.string(), // This is the unique txnId
  customer_id: z.string(),
  card_id: z.string(),
  mcc: z.string(),
  merchant: z.string(),
  amount_cents: z.number().int(),
  currency: z.string(),
  ts: z.string().refine(val => !isNaN(Date.parse(val)), { message: "Invalid ISO date string" }), // We'll receive ISO strings
  device_id: z.string().nullable().optional(),
  country: z.string(),
  city: z.string().nullable().optional(),
});

// The endpoint accepts an array of transactions
const ingestSchema = z.array(transactionIngestSchema);

apiRoutes.post('/ingest/transactions', async (req, res, next) => {
  try {
    // 1. Idempotency Check
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    if (idempotencyKey) {
      const cachedResult = await redis.get(`idempotency:${idempotencyKey}`);
      if (cachedResult) {
        req.log.info(`Idempotency hit for key: ${idempotencyKey}`);
        return res.status(200).json(JSON.parse(cachedResult));
      }
    }

    // 2. Validation
    // This will throw an error if the body doesn't match the schema
    const transactions = ingestSchema.parse(req.body);

    // 3. Database Ingest
    // We use createMany for high-performance bulk inserts.
    // 'skipDuplicates' uses the @@unique constraint in schema.prisma
    // to prevent duplicate (customerId, txnId) records.
    const result = await prisma.transaction.createMany({
      data: transactions.map(txn => ({
        ...txn,
        ts: new Date(txn.ts), // Convert ISO string to Date object
      })),
      skipDuplicates: true,
    });

    const response = {
      accepted: true,
      count: result.count,
      requestId: idempotencyKey || null,
    };

    // 4. Cache Response
    if (idempotencyKey) {
      // Set key to expire in 24 hours
      await redis.set(`idempotency:${idempotencyKey}`, JSON.stringify(response), 'EX', 60 * 60 * 24);
    }

    res.status(201).json(response);
  } catch (error) {
    next(error); // Pass errors to our handler
  }
});


// --- 3. Performance-Critical Customer Transaction API ---

apiRoutes.get('/customer/:id/transactions', async (req, res, next) => {
  try {
    const { id: customerId } = req.params;
    const { cursor, limit: limitStr, from, to } = req.query;

    const limit = parseInt(limitStr as string, 10) || 50;

    // Build the base WHERE clause
    const where: Prisma.TransactionWhereInput = {
      customer_id: customerId,
      ts: {
        ...(from && { gte: new Date(from as string) }),
        ...(to && { lte: new Date(to as string) }),
      },
    };

    // --- Keyset Pagination Logic ---
    if (cursor) {
      // Decode the cursor: "timestamp_id"
      const [tsStr, id] = Buffer.from(cursor as string, 'base64').toString('utf-8').split('_');
      const ts = new Date(tsStr);

      // This implements the (ts, id) < (cursor_ts, cursor_id) logic.
      // We look for records that are:
      // 1. Older than the cursor's timestamp
      //    OR
      // 2. Have the *same* timestamp, but a smaller ID (the tie-breaker)
      where.OR = [
        { ts: { lt: ts } },
        { ts: ts, id: { lt: id } },
      ];
    }

    // The Query:
    // We fetch `limit + 1` items to easily check if there's a "next page"
    const items = await prisma.transaction.findMany({
      where,
      take: limit + 1,
      orderBy: [
        { ts: 'desc' }, // This MUST match the index (customer_id, ts DESC)
        { id: 'desc' }, // Tie-breaker
      ],
    });

    // --- Generate Next Cursor ---
    let nextCursor: string | null = null;
    if (items.length > limit) {
      // If we got more items than we asked for, there's a next page.
      // Remove the "extra" item; it's only for cursor generation.
      const lastItem = items.pop();

      // Create a stable cursor: "timestamp_id"
      // We use Base64 to make it an opaque string for the client.
      const cursorString = `${lastItem!.ts.toISOString()}_${lastItem!.id}`;
      nextCursor = Buffer.from(cursorString, 'utf-8').toString('base64');
    }

    // CRITICAL: Redact PII from transactions before sending to frontend
    const { RedactorAgent } = await import('../Services/agents/RedactorAgent.js');
    const redactedItems = RedactorAgent.redactObject(items);

    res.status(200).json({ items: redactedItems, nextCursor });

  } catch (error) {
    next(error);
  }
});

// --- Customer Insights API ---

apiRoutes.get('/insights/:customerId/summary', async (req, res, next) => {
  try {
    const { customerId } = req.params;

    // Fetch last 30 days of transactions
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const transactions = await prisma.transaction.findMany({
      where: {
        customer_id: customerId,
        ts: { gte: thirtyDaysAgo },
      },
    });

    if (transactions.length === 0) {
      return res.status(200).json({
        totalSpent: 0,
        averageTransaction: 0,
        merchantCount: 0,
        riskLevel: 'LOW',
      });
    }

    // Calculate insights
    const totalSpent = transactions.reduce((sum, txn) => sum + txn.amount_cents, 0);
    const averageTransaction = Math.round(totalSpent / transactions.length);
    const uniqueMerchants = new Set(transactions.map(txn => txn.merchant));
    const merchantCount = uniqueMerchants.size;

    // Simple risk calculation based on transaction patterns
    let riskLevel = 'LOW';
    if (averageTransaction > 50000) {
      riskLevel = 'HIGH';
    } else if (averageTransaction > 20000) {
      riskLevel = 'MEDIUM';
    }

    res.status(200).json({
      totalSpent,
      averageTransaction,
      merchantCount,
      riskLevel,
    });
  } catch (error) {
    next(error);
  }
});


// --- 3.5. Dashboard KPIs API ---

apiRoutes.get('/dashboard/kpis', async (_req, res, next) => {
  try {
    // Count alerts by status
    const alertsInQueue = await prisma.alert.count({
      where: { status: 'NEW' },
    });

    const alertsTriaged = await prisma.alert.count({
      where: { status: 'TRIAGED' },
    });

    // Count open disputes
    const disputesOpened = await prisma.case.count({
      where: { type: 'DISPUTE', status: 'OPEN' },
    });

    // Calculate average triage latency
    const triageRuns = await prisma.triageRun.findMany({
      where: {
        latency_ms: { not: null },
      },
      select: { latency_ms: true },
    });

    const avgTriageLatency = triageRuns.length > 0
      ? triageRuns.reduce((sum, run) => sum + (run.latency_ms || 0), 0) / triageRuns.length
      : 0;

    res.status(200).json({
      alertsInQueue,
      alertsTriaged,
      disputesOpened,
      avgTriageLatency: Math.round(avgTriageLatency),
    });
  } catch (error) {
    next(error);
  }
});


// --- 3.6. Alerts API ---

apiRoutes.get('/alerts', async (req, res, next) => {
  try {
    const { status, limit: limitStr } = req.query;
    const limit = parseInt(limitStr as string, 10) || 50;

    const where: Prisma.AlertWhereInput = {};
    if (status) {
      where.status = status as string;
    }

    const alerts = await prisma.alert.findMany({
      where,
      take: limit,
      orderBy: { created_at: 'desc' },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email_masked: true,
          },
        },
        suspect_txn: true, // Include full transaction details
      },
    });

    // CRITICAL: Redact PII from alerts before sending to frontend
    const { RedactorAgent } = await import('../Services/agents/RedactorAgent.js');
    const redactedAlerts = RedactorAgent.redactObject(alerts);

    res.status(200).json({ alerts: redactedAlerts });
  } catch (error) {
    next(error);
  }
});

// --- 3.7. Cards API ---

apiRoutes.get('/cards/:cardId', apiKeyAuth, async (req, res, next) => {
  try {
    const { cardId } = req.params;

    const card = await prisma.card.findUnique({
      where: { id: cardId },
      select: {
        id: true,
        last4: true,
        network: true,
        status: true,
        created_at: true,
        customer_id: true,
      },
    });

    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }

    res.status(200).json(card);
  } catch (error) {
    next(error);
  }
});


// --- 4. Triage Streaming APIs ---

const triageStartSchema = z.object({
  alertId: z.string(),
});

apiRoutes.post('/triage', apiKeyAuth, triageRateLimiter, async (req, res, next) => {
  try {
    console.log('[POST /api/triage] Received request:', req.body);
    const { alertId } = triageStartSchema.parse(req.body);
    console.log('[POST /api/triage] Alert ID:', alertId);

    // 1. Fetch all required data for the orchestrator
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
      include: { suspect_txn: true },
    });
    if (!alert) {
      console.log('[POST /api/triage] Alert not found:', alertId);
      return res.status(404).json({ error: 'Alert not found' });
    }
    console.log('[POST /api/triage] Found alert:', alert.id, 'suspect_txn_id:', alert.suspect_txn_id);

    const customer = await prisma.customer.findUnique({
      where: { id: alert.customer_id }
    });
    if (!customer) {
      console.log('[POST /api/triage] Customer not found:', alert.customer_id);
      return res.status(404).json({ error: 'Customer not found' });
    }
    console.log('[POST /api/triage] Found customer:', customer.id);

    // Fetch recent transactions
    const recentTx = await prisma.transaction.findMany({
      where: {
        customer_id: customer.id,
        ts: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30d
      },
      orderBy: { ts: 'desc' },
      take: 100,
    });
    console.log('[POST /api/triage] Found recent transactions:', recentTx.length);

    // If no suspect_txn is linked, use the most recent transaction
    let suspectTransaction = alert.suspect_txn;
    if (!suspectTransaction && recentTx.length > 0) {
      suspectTransaction = recentTx[0];
      console.log('[POST /api/triage] Using most recent transaction as suspect:', suspectTransaction.id);
    }

    if (!suspectTransaction) {
      console.log('[POST /api/triage] No transaction found for customer');
      return res.status(404).json({ error: 'No transaction found for this customer' });
    }

    // Update alert to include the suspect transaction for the orchestrator
    const alertWithTxn = {
      ...alert,
      suspect_txn: suspectTransaction
    };

    // 2. Create the TriageRun entry
    const triageRun = await prisma.triageRun.create({
      data: {
        alert_id: alertId,
        risk: 'MEDIUM',
      },
    });
    const runId = triageRun.id;
    console.log('[POST /api/triage] Created triage run:', runId);

    // 3. Store the initial state in the triage run for later use
    // We DON'T start the orchestrator here - it will be started when the SSE client connects
    await prisma.triageRun.update({
      where: { id: runId },
      data: {
        // Store a flag to indicate this run needs to be started
        reasons: 'PENDING_START'
      }
    });

    // Store the initial state temporarily (we'll use it when SSE connects)
    const initialState = { alert: alertWithTxn, customer, recentTx };
    pendingTriageStates.set(runId, initialState);

    // 4. Return the runId immediately
    res.status(202).json({ runId, alertId });
    console.log('[POST /api/triage] Triage run created, waiting for SSE connection to start orchestrator');

  } catch (error) {
    console.error('[POST /api/triage] Route error:', error);
    next(error);
  }
});

apiRoutes.get('/triage/:runId/stream', async (req, res) => {
  const { runId } = req.params;

  // Start the SSE stream and WAIT for Redis subscription to be confirmed
  await sseService.handleSse(req, res, runId);

  // Check if this triage run is pending and needs to be started
  // We check the database to see if it's still in PENDING_START state
  const triageRun = await prisma.triageRun.findUnique({
    where: { id: runId }
  });

  if (triageRun && triageRun.reasons === 'PENDING_START') {
    const initialState = pendingTriageStates.get(runId);

    if (initialState) {
      console.log(`[GET /triage/:runId/stream] Will start orchestrator for run ${runId} after delay`);

      // Update database to mark as started (prevents duplicate starts)
      await prisma.triageRun.update({
        where: { id: runId },
        data: { reasons: 'RUNNING' }
      });

      // Keep in pending map for a bit in case of reconnections
      setTimeout(() => {
        pendingTriageStates.delete(runId);
      }, 5000); // Clean up after 5 seconds

      // CRITICAL FIX: Add a small delay before starting the orchestrator
      // This allows React StrictMode's first connection to disconnect before we start
      // publishing events, ensuring the second (persistent) connection receives them
      setTimeout(() => {
        console.log(`[GET /triage/:runId/stream] Starting orchestrator for run ${runId}`);

        const orchestrator = new TriageOrchestrator(runId, initialState);

        // Run in background (don't await)
        orchestrator.run().catch(err => {
          console.error(`[GET /triage/:runId/stream] Orchestrator error for ${runId}:`, err);
          req.log.error(err, `Triage run ${runId} failed in background`);
        });
      }, 100); // 100ms delay to allow React StrictMode cleanup
    } else {
      console.log(`[GET /triage/:runId/stream] Warning: Run ${runId} marked PENDING_START but no state found`);
    }
  }
});


// --- 5. Action APIs (Protected & Rate Limited) ---

// Apply middleware to all /action routes
const actionRouter = Router();
actionRouter.use(apiKeyAuth);
actionRouter.use(actionRateLimiter);

const freezeSchema = z.object({
  cardId: z.string(),
  otp: z.string().optional(),
});

actionRouter.post('/action/freeze-card', async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'] as string;

  try {
    // Check Redis for idempotency
    if (idempotencyKey) {
      const cachedResult = await redis.get(`idempotency:action:${idempotencyKey}`);
      if (cachedResult) {
        req.log.info(`Idempotency hit for action key: ${idempotencyKey}`);
        return res.status(200).json(JSON.parse(cachedResult));
      }
    }

    const { cardId, otp } = freezeSchema.parse(req.body);

    // Fetch card and customer info
    const card = await prisma.card.findUnique({
      where: { id: cardId },
      include: { customer: true }
    });
    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }

    // Check compliance policy
    const policyCheck = await ComplianceAgent.checkFreezeCardPolicy(
      cardId,
      card.customer.kyc_level,
      !!otp
    );

    if (!policyCheck.allowed) {
      // Block action and increment policy metric
      metrics.actionBlockedTotal.labels(policyCheck.policyCode || 'unknown').inc();

      if (policyCheck.requiresOTP) {
        // Generate OTP for the user
        const generatedOTP = await ComplianceAgent.generateOTP(cardId);
        req.log.info({ cardId, otp: generatedOTP }, 'OTP generated for freeze-card');

        return res.status(403).json({
          status: 'PENDING_OTP',
          requiresOTP: true,
          policyCode: policyCheck.policyCode,
          reason: policyCheck.reason,
          // In production, don't return OTP - send via SMS/email
          _dev_otp: generatedOTP, // Only for demo/testing
        });
      }

      return res.status(403).json({
        error: 'Action blocked by policy',
        policyCode: policyCheck.policyCode,
        reason: policyCheck.reason,
      });
    }

    // If OTP was provided, verify it
    if (otp) {
      const otpValid = await ComplianceAgent.verifyOTP(cardId, otp);
      if (!otpValid) {
        metrics.actionBlockedTotal.labels('OTP_INVALID').inc();
        return res.status(403).json({
          error: 'Invalid OTP',
          status: 'PENDING_OTP',
        });
      }
    }

    // Execute the freeze action
    await prisma.card.update({
      where: { id: cardId },
      data: { status: 'FROZEN' },
    });

    const caseEntry = await prisma.case.create({
      data: {
        type: 'FRAUD_REPORT',
        status: 'OPEN',
        customer_id: card.customer_id,
        reason_code: 'AGENT_FREEZE',
      }
    });

    // Write to Audit Log
    await AuditService.logEvent(
      caseEntry.id,
      req.user ? `${req.user.role}:${req.user.email}` : 'system:unknown',
      'FREEZE_CARD',
      { cardId, otpVerified: !!otp }
    );

    const response = { status: 'FROZEN', requestId: idempotencyKey, caseId: caseEntry.id };

    // Cache response in Redis
    if (idempotencyKey) {
      await redis.set(
        `idempotency:action:${idempotencyKey}`,
        JSON.stringify(response),
        'EX',
        60 * 60 * 24
      );
    }

    res.status(200).json(response);

  } catch (error) {
    next(error);
  }
});

const disputeSchema = z.object({
  txnId: z.string(), // Accept any string ID (not just UUIDs for acceptance tests)
  reasonCode: z.string(),
});

actionRouter.post('/action/open-dispute', async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'] as string;

  try {
    // Check Redis for idempotency
    if (idempotencyKey) {
      const cachedResult = await redis.get(`idempotency:action:${idempotencyKey}`);
      if (cachedResult) {
        req.log.info(`Idempotency hit for action key: ${idempotencyKey}`);
        return res.status(200).json(JSON.parse(cachedResult));
      }
    }

    const { txnId, reasonCode } = disputeSchema.parse(req.body);
    const txn = await prisma.transaction.findUnique({ where: { id: txnId } });
    if (!txn) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Check compliance policy for disputes
    const policyCheck = await ComplianceAgent.checkDisputePolicy(
      txnId,
      txn.customer_id,
      reasonCode
    );

    if (!policyCheck.allowed) {
      metrics.actionBlockedTotal.labels(policyCheck.policyCode || 'unknown').inc();
      return res.status(403).json({
        error: 'Action blocked by policy',
        policyCode: policyCheck.policyCode,
        reason: policyCheck.reason,
      });
    }

    // Check action rate limit
    const rateLimitCheck = await ComplianceAgent.checkActionRateLimit(
      txn.customer_id,
      'OPEN_DISPUTE'
    );

    if (!rateLimitCheck.allowed) {
      metrics.actionBlockedTotal.labels(rateLimitCheck.policyCode || 'unknown').inc();
      return res.status(429).json({
        error: 'Action rate limit exceeded',
        policyCode: rateLimitCheck.policyCode,
        reason: rateLimitCheck.reason,
      });
    }

    // Create the case
    const caseEntry = await prisma.case.create({
      data: {
        customer_id: txn.customer_id,
        txn_id: txnId,
        type: 'DISPUTE',
        status: 'OPEN',
        reason_code: reasonCode,
      },
    });

    // Write to Audit Log
    await AuditService.logEvent(
      caseEntry.id,
      req.user ? `${req.user.role}:${req.user.email}` : 'system:unknown',
      'OPEN_DISPUTE',
      { txnId, reasonCode }
    );

    const response = { caseId: caseEntry.id, status: 'OPEN' };

    // Cache response in Redis
    if (idempotencyKey) {
      await redis.set(
        `idempotency:action:${idempotencyKey}`,
        JSON.stringify(response),
        'EX',
        60 * 60 * 24
      );
    }

    res.status(201).json(response);

  } catch (error) {
    next(error);
  }
});

// --- Contact Customer Action ---
const contactCustomerSchema = z.object({
  customerId: z.string(),
  alertId: z.string(),
  message: z.string(),
  channel: z.enum(['EMAIL', 'SMS', 'PUSH']).default('EMAIL'),
});

actionRouter.post('/action/contact-customer', async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'] as string;

  try {
    if (idempotencyKey) {
      const cachedResult = await redis.get(`idempotency:action:${idempotencyKey}`);
      if (cachedResult) {
        req.log.info(`Idempotency hit for action key: ${idempotencyKey}`);
        return res.status(200).json(JSON.parse(cachedResult));
      }
    }

    const { customerId, alertId, message, channel } = contactCustomerSchema.parse(req.body);

    // Create a case for tracking customer contact
    const caseEntry = await prisma.case.create({
      data: {
        customer_id: customerId,
        type: 'CUSTOMER_CONTACT',
        status: 'PENDING_CUSTOMER',
        reason_code: 'ALERT_VERIFICATION',
      },
    });

    // Log the contact attempt
    await AuditService.logEvent(
      caseEntry.id,
      req.user ? `${req.user.role}:${req.user.email}` : 'system:unknown',
      'CONTACT_CUSTOMER',
      { alertId, channel, messageLength: message.length }
    );

    // In production, this would trigger email/SMS/push notification
    req.log.info({ customerId, channel, caseId: caseEntry.id }, 'Customer contact initiated');

    const response = {
      caseId: caseEntry.id,
      status: 'SENT',
      channel,
      requestId: idempotencyKey,
    };

    if (idempotencyKey) {
      await redis.set(
        `idempotency:action:${idempotencyKey}`,
        JSON.stringify(response),
        'EX',
        60 * 60 * 24
      );
    }

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
});

// --- Mark False Positive Action ---
const markFalsePositiveSchema = z.object({
  alertId: z.string(),
  reason: z.string().optional(),
});

actionRouter.post('/action/mark-false-positive', async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'] as string;

  try {
    if (idempotencyKey) {
      const cachedResult = await redis.get(`idempotency:action:${idempotencyKey}`);
      if (cachedResult) {
        req.log.info(`Idempotency hit for action key: ${idempotencyKey}`);
        return res.status(200).json(JSON.parse(cachedResult));
      }
    }

    const { alertId, reason } = markFalsePositiveSchema.parse(req.body);

    // Fetch the alert
    const alert = await prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    // Update alert status to CLOSED
    await prisma.alert.update({
      where: { id: alertId },
      data: { status: 'CLOSED' },
    });

    // Create a case for audit trail
    const caseEntry = await prisma.case.create({
      data: {
        customer_id: alert.customer_id,
        type: 'FALSE_POSITIVE',
        status: 'CLOSED',
        reason_code: 'AGENT_REVIEW',
      },
    });

    // Log the action
    await AuditService.logEvent(
      caseEntry.id,
      req.user ? `${req.user.role}:${req.user.email}` : 'system:unknown',
      'MARK_FALSE_POSITIVE',
      { alertId, reason: reason || 'No reason provided' }
    );

    const response = {
      alertId,
      caseId: caseEntry.id,
      status: 'CLOSED',
      requestId: idempotencyKey,
    };

    if (idempotencyKey) {
      await redis.set(
        `idempotency:action:${idempotencyKey}`,
        JSON.stringify(response),
        'EX',
        60 * 60 * 24
      );
    }

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
});

// Mount the protected action router
apiRoutes.use('/', actionRouter);

// --- 6. KB Search API ---

apiRoutes.get('/kb/search', async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    // Search KB documents using Prisma full-text search
    const results = await prisma.kbDoc.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { content_text: { contains: q, mode: 'insensitive' } },
          { anchor: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 10,
    });

    // Format results to match the required API contract
    const formattedResults = results.map(doc => ({
      docId: doc.id,
      title: doc.title,
      anchor: doc.anchor,
      extract: doc.content_text.substring(0, 200) + '...', // First 200 chars as extract
    }));

    res.status(200).json({ results: formattedResults });
  } catch (error) {
    next(error);
  }
});