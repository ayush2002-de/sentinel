// /api/src/services/AuditService.ts
import { prisma } from '../lib/prisma.js';
import { RedactorAgent } from './agents/RedactorAgent.js';

export class AuditService {
  /**
   * Logs a critical event to the case_events table.
   */
  public static async logEvent(
    caseId: string,
    actor: string, // e.g., "agent:bob@sentinel.com" or "system:triage_run_123"
    action: string, // e.g., "FREEZE_CARD", "OPEN_DISPUTE"
    payload: any
  ) {
    try {
      await prisma.caseEvent.create({
        data: {
          case_id: caseId,
          actor: actor,
          action: action,
          // CRITICAL: Always redact the payload before saving
          payload_json: RedactorAgent.redactObject(payload),
        },
      });
    } catch (error) {
      console.error('FATAL: Failed to write audit log!', { caseId, action }, error);
      // In production, this should trigger a high-priority alert.
    }
  }
}