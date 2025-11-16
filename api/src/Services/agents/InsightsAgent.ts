// /api/src/Services/agents/InsightsAgent.ts

import { Transaction } from '@prisma/client';

export interface CategoryBreakdown {
  category: string;
  count: number;
  totalCents: number;
  percentage: number;
}

export interface MerchantConcentration {
  merchant: string;
  count: number;
  totalCents: number;
  percentage: number;
}

export interface SpendPattern {
  avgTransactionCents: number;
  maxTransactionCents: number;
  minTransactionCents: number;
  totalSpendCents: number;
  transactionCount: number;
  uniqueMerchants: number;
  uniqueCountries: number;
}

export interface Anomaly {
  type: 'HIGH_AMOUNT' | 'NEW_MERCHANT' | 'FOREIGN_COUNTRY' | 'UNUSUAL_TIME' | 'HIGH_VELOCITY';
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  relatedTxnId?: string;
}

export interface InsightsReport {
  categories: CategoryBreakdown[];
  merchantConcentration: MerchantConcentration[];
  spendPattern: SpendPattern;
  anomalies: Anomaly[];
}

// MCC to Category mapping (simplified)
const MCC_CATEGORIES: Record<string, string> = {
  '4121': 'Transportation',
  '5812': 'Food & Dining',
  '5411': 'Grocery',
  '5732': 'Electronics',
  '5814': 'Food & Dining',
  '5045': 'Electronics',
  '3001': 'Travel',
  '4111': 'Transportation',
  '4900': 'Utilities',
  '5968': 'Subscription',
  '7995': 'Gambling',
  '5999': 'Retail',
};

export class InsightsAgent {
  /**
   * Analyzes transaction history and generates structured insights.
   */
  public static async analyze(transactions: Transaction[]): Promise<InsightsReport> {
    if (transactions.length === 0) {
      return {
        categories: [],
        merchantConcentration: [],
        spendPattern: {
          avgTransactionCents: 0,
          maxTransactionCents: 0,
          minTransactionCents: 0,
          totalSpendCents: 0,
          transactionCount: 0,
          uniqueMerchants: 0,
          uniqueCountries: 0,
        },
        anomalies: [],
      };
    }

    // --- 1. Category Breakdown ---
    const categoryMap = new Map<string, { count: number; totalCents: number }>();
    transactions.forEach(txn => {
      const category = MCC_CATEGORIES[txn.mcc] || 'Other';
      const existing = categoryMap.get(category) || { count: 0, totalCents: 0 };
      categoryMap.set(category, {
        count: existing.count + 1,
        totalCents: existing.totalCents + txn.amount_cents,
      });
    });

    const totalSpendCents = transactions.reduce((sum, txn) => sum + txn.amount_cents, 0);
    const categories: CategoryBreakdown[] = Array.from(categoryMap.entries()).map(([category, data]) => ({
      category,
      count: data.count,
      totalCents: data.totalCents,
      percentage: Math.round((data.totalCents / totalSpendCents) * 100),
    })).sort((a, b) => b.totalCents - a.totalCents);

    // --- 2. Merchant Concentration ---
    const merchantMap = new Map<string, { count: number; totalCents: number }>();
    transactions.forEach(txn => {
      const existing = merchantMap.get(txn.merchant) || { count: 0, totalCents: 0 };
      merchantMap.set(txn.merchant, {
        count: existing.count + 1,
        totalCents: existing.totalCents + txn.amount_cents,
      });
    });

    const merchantConcentration: MerchantConcentration[] = Array.from(merchantMap.entries())
      .map(([merchant, data]) => ({
        merchant,
        count: data.count,
        totalCents: data.totalCents,
        percentage: Math.round((data.totalCents / totalSpendCents) * 100),
      }))
      .sort((a, b) => b.totalCents - a.totalCents)
      .slice(0, 10); // Top 10 merchants

    // --- 3. Spend Pattern ---
    const amounts = transactions.map(txn => txn.amount_cents);
    const uniqueMerchants = new Set(transactions.map(txn => txn.merchant)).size;
    const uniqueCountries = new Set(transactions.map(txn => txn.country)).size;

    const spendPattern: SpendPattern = {
      avgTransactionCents: Math.round(totalSpendCents / transactions.length),
      maxTransactionCents: Math.max(...amounts),
      minTransactionCents: Math.min(...amounts),
      totalSpendCents,
      transactionCount: transactions.length,
      uniqueMerchants,
      uniqueCountries,
    };

    // --- 4. Anomaly Detection ---
    const anomalies: Anomaly[] = [];

    // High amount anomaly (>2x average)
    const highAmountThreshold = spendPattern.avgTransactionCents * 2;
    const highAmountTxns = transactions.filter(txn => txn.amount_cents > highAmountThreshold);
    if (highAmountTxns.length > 0) {
      highAmountTxns.forEach(txn => {
        anomalies.push({
          type: 'HIGH_AMOUNT',
          description: `${txn.merchant}: $${(txn.amount_cents / 100).toFixed(2)} (2x+ average)`,
          severity: txn.amount_cents > highAmountThreshold * 2 ? 'HIGH' : 'MEDIUM',
          relatedTxnId: txn.id,
        });
      });
    }

    // New merchant (appears only once)
    const newMerchants = Array.from(merchantMap.entries())
      .filter(([_, data]) => data.count === 1)
      .map(([merchant]) => merchant);

    if (newMerchants.length > 0) {
      anomalies.push({
        type: 'NEW_MERCHANT',
        description: `${newMerchants.length} new merchant(s): ${newMerchants.slice(0, 3).join(', ')}`,
        severity: 'LOW',
      });
    }

    // Foreign country transactions
    const foreignTxns = transactions.filter(txn => txn.country !== 'US');
    if (foreignTxns.length > 0) {
      const countries = Array.from(new Set(foreignTxns.map(txn => txn.country)));
      anomalies.push({
        type: 'FOREIGN_COUNTRY',
        description: `${foreignTxns.length} transaction(s) from foreign countries: ${countries.join(', ')}`,
        severity: countries.length > 2 ? 'HIGH' : 'MEDIUM',
      });
    }

    // High velocity (>5 txns in 1 hour)
    const sortedTxns = [...transactions].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    for (let i = 0; i < sortedTxns.length; i++) {
      const windowStart = sortedTxns[i].ts.getTime();
      const windowEnd = windowStart + 60 * 60 * 1000; // 1 hour
      const txnsInWindow = sortedTxns.filter(
        txn => txn.ts.getTime() >= windowStart && txn.ts.getTime() <= windowEnd
      );
      if (txnsInWindow.length > 5) {
        anomalies.push({
          type: 'HIGH_VELOCITY',
          description: `${txnsInWindow.length} transactions in 1 hour`,
          severity: 'HIGH',
        });
        break; // Only report once
      }
    }

    return {
      categories,
      merchantConcentration,
      spendPattern,
      anomalies,
    };
  }
}
