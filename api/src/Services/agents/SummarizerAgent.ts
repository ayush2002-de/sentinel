// /api/src/Services/agents/SummarizerAgent.ts

import { Transaction, Alert } from '@prisma/client';
import { FraudReport } from './FraudAgent.js';
import { KBHit } from './KBAgent.js';

export interface SummaryOutput {
  customerMessage: string; // User-facing message
  internalNote: string;    // For agent reference
}

export class SummarizerAgent {
  /**
   * Generates a customer-facing message and internal note based on triage results.
   * Uses deterministic templates (no LLM required).
   */
  public static summarize(
    alert: Alert & { suspect_txn?: Transaction | null },
    fraudReport: FraudReport,
    kbHits: KBHit[],
    recommendedAction: string
  ): SummaryOutput {
    const txn = alert.suspect_txn;
    const merchant = txn?.merchant || 'Unknown';
    const amount = txn ? `$${(txn.amount_cents / 100).toFixed(2)}` : 'Unknown';

    // --- Customer Message (User-facing) ---
    let customerMessage = '';

    if (recommendedAction === 'FREEZE_CARD') {
      customerMessage = `We've detected suspicious activity on your account related to a ${amount} transaction at ${merchant}. ` +
        `For your protection, we recommend freezing your card. ` +
        `You can unfreeze it anytime from your app once you verify the transaction.`;
    } else if (recommendedAction === 'OPEN_DISPUTE') {
      customerMessage = `We noticed a potentially unauthorized ${amount} charge from ${merchant}. ` +
        `If you don't recognize this transaction, we can help you dispute it. ` +
        `Our team will investigate and work with the merchant to resolve this issue.`;
    } else if (recommendedAction === 'NONE') {
      // Check if there's a KB citation explaining why
      const preAuthHit = kbHits.find(hit => hit.anchor === 'disputes:pre-auth-vs-capture');
      if (preAuthHit) {
        customerMessage = `We reviewed your ${amount} transaction at ${merchant}. ` +
          `It appears to be a pending authorization that will either complete or drop off in 3-5 business days. ` +
          `This is normal and doesn't require action from you.`;
      } else {
        customerMessage = `We've reviewed the ${amount} transaction at ${merchant} and determined it's within your normal spending pattern. ` +
          `If you have concerns, please contact us directly.`;
      }
    }

    // --- Internal Note (For agent reference) ---
    let internalNote = `Alert ID: ${alert.id}\n`;
    internalNote += `Risk Score: ${fraudReport.score}\n`;
    internalNote += `Reasons: ${fraudReport.reasons.join(', ')}\n`;
    internalNote += `Recommended Action: ${recommendedAction}\n`;

    if (kbHits.length > 0) {
      internalNote += `KB Citations:\n`;
      kbHits.forEach(hit => {
        internalNote += `  - [${hit.title}] (${hit.anchor})\n`;
      });
    }

    if (txn) {
      internalNote += `Transaction Details:\n`;
      internalNote += `  Merchant: ${txn.merchant}\n`;
      internalNote += `  Amount: ${amount}\n`;
      internalNote += `  MCC: ${txn.mcc}\n`;
      internalNote += `  Country: ${txn.country}\n`;
      internalNote += `  Date: ${txn.ts.toISOString()}\n`;
    }

    return {
      customerMessage,
      internalNote,
    };
  }

  /**
   * Generates a short summary for email/SMS notifications.
   */
  public static generateNotification(
    customerName: string,
    action: string,
    merchant: string,
    amount: number
  ): string {
    const amountStr = `$${(amount / 100).toFixed(2)}`;

    if (action === 'FREEZE_CARD') {
      return `Hi ${customerName}, we've detected suspicious activity (${amountStr} at ${merchant}). ` +
        `Your card has been temporarily frozen for security. Reply Y to confirm or call us.`;
    } else if (action === 'OPEN_DISPUTE') {
      return `Hi ${customerName}, we've opened a dispute for the ${amountStr} charge from ${merchant}. ` +
        `We'll update you within 5-7 business days.`;
    } else {
      return `Hi ${customerName}, your recent ${amountStr} transaction at ${merchant} has been reviewed and approved.`;
    }
  }
}
