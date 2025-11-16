import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding acceptance test fixtures...');

  // Insert transactions
  const transactions = [
    {
      id: 'txn_acceptance_01_otp',
      customer_id: 'cust_004',
      card_id: 'card_008',
      mcc: '7995',
      merchant: 'BetKing Casino',
      amount_cents: 150000,
      currency: 'INR',
      ts: new Date('2025-11-15T09:45:00.000Z'),
      device_id: 'device_new_suspicious',
      country: 'MT',
      city: 'Valletta',
    },
    {
      id: 'txn_acceptance_02_dispute',
      customer_id: 'cust_002',
      card_id: 'card_003',
      mcc: '5411',
      merchant: 'ABC Mart',
      amount_cents: 499900,
      currency: 'INR',
      ts: new Date('2025-11-14T18:15:00.000Z'),
      device_id: 'b2c531c8-5398-466c-b992-9aacaf31294b',
      country: 'IN',
      city: 'Mumbai',
    },
    {
      id: 'txn_acceptance_03_duplicate_preauth',
      customer_id: 'cust_006',
      card_id: 'card_011',
      mcc: '4121',
      merchant: 'QuickCab',
      amount_cents: 35000,
      currency: 'INR',
      ts: new Date('2025-11-15T08:30:00.000Z'),
      device_id: 'd95a9f2b-f65f-4399-9778-71d938b0470a',
      country: 'IN',
      city: 'Mumbai',
    },
    {
      id: 'txn_acceptance_03_duplicate_capture',
      customer_id: 'cust_006',
      card_id: 'card_011',
      mcc: '4121',
      merchant: 'QuickCab',
      amount_cents: 35000,
      currency: 'INR',
      ts: new Date('2025-11-15T08:45:00.000Z'),
      device_id: 'd95a9f2b-f65f-4399-9778-71d938b0470a',
      country: 'IN',
      city: 'Mumbai',
    },
    {
      id: 'txn_acceptance_04_timeout',
      customer_id: 'cust_005',
      card_id: 'card_009',
      mcc: '5732',
      merchant: 'TechZone',
      amount_cents: 89900,
      currency: 'INR',
      ts: new Date('2025-11-15T10:30:00.000Z'),
      device_id: '98dc7577-5fc0-46cb-9142-7de8653398fc',
      country: 'IN',
      city: 'Bangalore',
      metadata: { simulate_risk_timeout: true },
    },
    {
      id: 'txn_acceptance_05_ratelimit',
      customer_id: 'cust_003',
      card_id: 'card_005',
      mcc: '5814',
      merchant: 'The Corner Cafe',
      amount_cents: 25000,
      currency: 'INR',
      ts: new Date('2025-11-15T11:45:00.000Z'),
      device_id: 'ab938615-e52d-4c66-a4ab-bc5c6582868e',
      country: 'IN',
      city: 'Delhi',
    },
    {
      id: 'txn_acceptance_06_pii',
      customer_id: 'cust_007',
      card_id: 'card_012',
      mcc: '5411',
      merchant: 'ShopSmart',
      amount_cents: 125000,
      currency: 'INR',
      ts: new Date('2025-11-15T12:30:00.000Z'),
      device_id: 'b039e146-563a-4f3d-a9ba-4f6ab1f42285',
      country: 'IN',
      city: 'Chennai',
      metadata: {
        customer_note: 'Customer called and provided card 4111111111111111 for verification',
        agent_note: 'Verified with PAN ending 1111, email test@example.com',
      },
    },
    {
      id: 'txn_acceptance_07_performance',
      customer_id: 'cust_001',
      card_id: 'card_001',
      mcc: '5411',
      merchant: 'Daily Groceries',
      amount_cents: 15000,
      currency: 'INR',
      ts: new Date('2025-11-15T13:15:00.000Z'),
      device_id: '21fcb064-3c67-4918-b7c7-1b3d0c95f60c',
      country: 'IN',
      city: 'Mumbai',
    },
  ];

  for (const txn of transactions) {
    await prisma.transaction.upsert({
      where: { id: txn.id },
      update: txn,
      create: txn,
    });
    console.log(`✅ Transaction: ${txn.id}`);
  }

  // Insert alerts
  const alerts = [
    {
      id: 'alert_acceptance_01_otp',
      created_at: new Date('2025-11-15T10:00:00.000Z'),
      risk: 'HIGH',
      status: 'NEW',
      customer_id: 'cust_004',
      suspect_txn_id: 'txn_acceptance_01_otp',
    },
    {
      id: 'alert_acceptance_02_dispute',
      created_at: new Date('2025-11-14T18:30:00.000Z'),
      risk: 'MEDIUM',
      status: 'NEW',
      customer_id: 'cust_002',
      suspect_txn_id: 'txn_acceptance_02_dispute',
    },
    {
      id: 'alert_acceptance_03_duplicate',
      created_at: new Date('2025-11-15T09:00:00.000Z'),
      risk: 'MEDIUM',
      status: 'NEW',
      customer_id: 'cust_006',
      suspect_txn_id: 'txn_acceptance_03_duplicate_capture',
    },
    {
      id: 'alert_acceptance_04_timeout',
      created_at: new Date('2025-11-15T11:00:00.000Z'),
      risk: 'MEDIUM',
      status: 'NEW',
      customer_id: 'cust_005',
      suspect_txn_id: 'txn_acceptance_04_timeout',
    },
    {
      id: 'alert_acceptance_05_ratelimit',
      created_at: new Date('2025-11-15T12:00:00.000Z'),
      risk: 'LOW',
      status: 'NEW',
      customer_id: 'cust_003',
      suspect_txn_id: 'txn_acceptance_05_ratelimit',
    },
    {
      id: 'alert_acceptance_06_pii',
      created_at: new Date('2025-11-15T13:00:00.000Z'),
      risk: 'HIGH',
      status: 'NEW',
      customer_id: 'cust_007',
      suspect_txn_id: 'txn_acceptance_06_pii',
    },
    {
      id: 'alert_acceptance_07_performance',
      created_at: new Date('2025-11-15T14:00:00.000Z'),
      risk: 'LOW',
      status: 'NEW',
      customer_id: 'cust_001',
      suspect_txn_id: 'txn_acceptance_07_performance',
    },
  ];

  for (const alert of alerts) {
    await prisma.alert.upsert({
      where: { id: alert.id },
      update: alert,
      create: alert,
    });
    console.log(`🚨 Alert: ${alert.id}`);
  }

  console.log('✅ Acceptance test fixtures seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
