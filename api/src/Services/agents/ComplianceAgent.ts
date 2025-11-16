// /api/src/Services/agents/ComplianceAgent.ts

import { redis } from '../../lib/redis.js';

export interface ComplianceCheckResult {
  allowed: boolean;
  requiresOTP: boolean;
  policyCode?: string;
  reason?: string;
}

export class ComplianceAgent {
  /**
   * Validates if an OTP is correct for a given card freeze action.
   * In production, this would integrate with a real OTP service (SMS, Email, TOTP).
   * For demo purposes, we use a simple Redis-based OTP storage.
   */
  public static async verifyOTP(cardId: string, otp: string): Promise<boolean> {
    // Check if OTP exists in Redis
    const storedOTP = await redis.get(`otp:${cardId}`);

    if (!storedOTP) {
      // No OTP was generated - for demo, accept a default OTP
      return otp === '123456';
    }

    return storedOTP === otp;
  }

  /**
   * Generates and stores an OTP for a card action.
   * Returns the generated OTP (in production, this would be sent via SMS/email).
   */
  public static async generateOTP(cardId: string): Promise<string> {
    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store in Redis with 5-minute expiration
    await redis.set(`otp:${cardId}`, otp, 'EX', 300);

    return otp;
  }

  /**
   * Checks if a freeze-card action is allowed based on policies.
   */
  public static async checkFreezeCardPolicy(
    cardId: string,
    kycLevel: string,
    hasOTP: boolean
  ): Promise<ComplianceCheckResult> {
    // Policy 1: High-risk KYC requires OTP
    if (kycLevel === 'LVL_0' || kycLevel === 'LVL_1') {
      if (!hasOTP) {
        return {
          allowed: false,
          requiresOTP: true,
          policyCode: 'OTP_REQUIRED_FOR_FREEZE',
          reason: 'OTP verification required for low KYC level accounts',
        };
      }
    }

    return {
      allowed: true,
      requiresOTP: false,
    };
  }

  /**
   * Checks if an unfreeze action is allowed.
   */
  public static async checkUnfreezePolicy(
    cardId: string,
    kycLevel: string,
    hasOTP: boolean
  ): Promise<ComplianceCheckResult> {
    // Policy: ALL unfreezes require OTP
    if (!hasOTP) {
      return {
        allowed: false,
        requiresOTP: true,
        policyCode: 'OTP_REQUIRED_FOR_UNFREEZE',
        reason: 'OTP verification required for all unfreeze actions',
      };
    }

    return {
      allowed: true,
      requiresOTP: false,
    };
  }

  /**
   * Checks if a dispute can be opened based on policies.
   */
  public static async checkDisputePolicy(
    txnId: string,
    customerId: string,
    reasonCode: string
  ): Promise<ComplianceCheckResult> {
    // Policy 1: Check if a dispute already exists for this transaction
    // (This would query the database in a real implementation)

    // Policy 2: Validate reason code
    const validReasonCodes = ['10.4', '13.1', '13.2', '13.3', '13.5', '13.6', '13.7'];
    if (!validReasonCodes.includes(reasonCode)) {
      return {
        allowed: false,
        requiresOTP: false,
        policyCode: 'INVALID_REASON_CODE',
        reason: `Reason code ${reasonCode} is not valid. Use Visa/Mastercard standard codes.`,
      };
    }

    return {
      allowed: true,
      requiresOTP: false,
    };
  }

  /**
   * Rate limits sensitive actions per customer.
   */
  public static async checkActionRateLimit(
    customerId: string,
    action: string
  ): Promise<ComplianceCheckResult> {
    const key = `action_limit:${customerId}:${action}`;
    const count = await redis.incr(key);

    if (count === 1) {
      // First action, set expiration to 1 hour
      await redis.expire(key, 3600);
    }

    // Limit: 5 actions per hour per customer
    if (count > 5) {
      return {
        allowed: false,
        requiresOTP: false,
        policyCode: 'ACTION_RATE_LIMIT_EXCEEDED',
        reason: `Too many ${action} actions for this customer. Limit: 5 per hour.`,
      };
    }

    return {
      allowed: true,
      requiresOTP: false,
    };
  }
}
