// /scripts/seed.ts
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define fixture paths
const FIXTURES_DIR = path.join(__dirname, "..", "..", "fixtures");
const CUSTOMERS_PATH = path.join(FIXTURES_DIR, "customers.json");
const CARDS_PATH = path.join(FIXTURES_DIR, "cards.json");
const ACCOUNTS_PATH = path.join(FIXTURES_DIR, "accounts.json");
const TRANSACTIONS_PATH = path.join(FIXTURES_DIR, "transactions.json");
const TRANSACTIONS_ACCEPTANCE_PATH = path.join(FIXTURES_DIR, "transactions_acceptance.json");
const ALERTS_PATH = path.join(FIXTURES_DIR, "alerts.json");
const KB_DOCS_PATH = path.join(FIXTURES_DIR, "kb_docs.json");
const POLICIES_PATH = path.join(FIXTURES_DIR, 'policies.json');

async function main() {
  console.log('🌱 Starting to seed database from fixtures...');
  console.log('');

  // 1. Read all fixture files
  console.log('📖 Reading fixture files...');

  const [
    customers,
    cards,
    accounts,
    alerts,
    kbDocs,
    policies,
    transactionsAcceptance,
  ] = await Promise.all([
    fs.readFile(CUSTOMERS_PATH, 'utf-8').then(JSON.parse),
    fs.readFile(CARDS_PATH, 'utf-8').then(JSON.parse),
    fs.readFile(ACCOUNTS_PATH, 'utf-8').then(JSON.parse),
    fs.readFile(ALERTS_PATH, 'utf-8').then(JSON.parse),
    fs.readFile(KB_DOCS_PATH, 'utf-8').then(JSON.parse),
    fs.readFile(POLICIES_PATH, 'utf-8').then(JSON.parse),
    fs.readFile(TRANSACTIONS_ACCEPTANCE_PATH, 'utf-8').then(JSON.parse).catch(() => []),
  ]);

  console.log(`✅ Loaded fixtures:`);
  console.log(`   - ${customers.length} customers`);
  console.log(`   - ${cards.length} cards`);
  console.log(`   - ${accounts.length} accounts`);
  console.log(`   - ${alerts.length} alerts`);
  console.log(`   - ${kbDocs.length} KB documents`);
  console.log(`   - ${policies.length} policies`);
  console.log(`   - ${transactionsAcceptance.length} acceptance test transactions`);
  console.log('');

  // 2. Clear existing data in reverse order of dependencies
  console.log('🗑️  Clearing existing data...');
  await prisma.$transaction([
    prisma.agentTrace.deleteMany(),
    prisma.triageRun.deleteMany(),
    prisma.caseEvent.deleteMany(),
    prisma.case.deleteMany(),
    prisma.alert.deleteMany(),
    prisma.transaction.deleteMany(), // Clear all transactions
    prisma.account.deleteMany(),
    prisma.card.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.kbDoc.deleteMany(),
    prisma.policy.deleteMany(),
  ]);
  console.log('✅ Cleared existing data.');
  console.log('');

  // 3. Seed new data in order of dependencies
  console.log('💾 Seeding database...');

  // Step 1: Customers (no dependencies)
  console.log('   - Seeding customers...');
  await prisma.customer.createMany({ data: customers });

  // Step 2: Cards (depends on customers)
  console.log('   - Seeding cards...');
  await prisma.card.createMany({ data: cards });

  // Step 3: Accounts (depends on customers)
  console.log('   - Seeding accounts...');
  await prisma.account.createMany({ data: accounts });

  // Step 4: KB & Policies (no dependencies)
  console.log('   - Seeding KB docs...');
  await prisma.kbDoc.createMany({ data: kbDocs });

  console.log('   - Seeding policies...');
  await prisma.policy.createMany({ data: policies });

  // Step 5: Load transactions in batches
  console.log('   - Seeding transactions...');

  // First, seed acceptance test transactions
  if (transactionsAcceptance.length > 0) {
    console.log(`     → Seeding ${transactionsAcceptance.length} acceptance test transactions...`);

    // Convert date strings to Date objects and handle metadata
    const acceptanceTxnsFormatted = transactionsAcceptance.map((txn: any) => ({
      ...txn,
      ts: new Date(txn.ts),
      metadata: txn.metadata || undefined,
    }));

    await prisma.transaction.createMany({ data: acceptanceTxnsFormatted });
    console.log(`     ✅ Seeded ${transactionsAcceptance.length} acceptance test transactions`);
  }

  // Now try to load main transactions.json (1M records) in batches
  try {
    console.log('     → Checking for main transactions.json...');
    const transactionsFileSize = await fs.stat(TRANSACTIONS_PATH).then(s => s.size);
    const sizeMB = (transactionsFileSize / 1024 / 1024).toFixed(2);

    console.log(`     → Found transactions.json (${sizeMB} MB)`);
    console.log('     → Loading large transaction file (this may take a while)...');

    // For large files, we need to stream or batch
    const transactionsContent = await fs.readFile(TRANSACTIONS_PATH, 'utf-8');
    console.log('     → Parsing JSON...');
    const transactions = JSON.parse(transactionsContent);

    console.log(`     → Processing ${transactions.length.toLocaleString()} transactions...`);

    // Batch insert in chunks of 10,000
    const BATCH_SIZE = 10000;
    const totalBatches = Math.ceil(transactions.length / BATCH_SIZE);

    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const batch = transactions.slice(i, i + BATCH_SIZE);
      const currentBatch = Math.floor(i / BATCH_SIZE) + 1;

      // Convert date strings to Date objects
      const batchFormatted = batch.map((txn: any) => ({
        ...txn,
        ts: new Date(txn.ts),
        metadata: txn.metadata || undefined,
      }));

      await prisma.transaction.createMany({ data: batchFormatted });

      if (currentBatch % 10 === 0 || currentBatch === totalBatches) {
        console.log(`     → Batch ${currentBatch}/${totalBatches} complete (${i + batch.length}/${transactions.length})`);
      }
    }

    console.log(`     ✅ Seeded ${transactions.length.toLocaleString()} main transactions`);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log('     ℹ️  Main transactions.json not found (optional)');
    } else {
      console.error('     ⚠️  Error loading main transactions:', error.message);
      console.log('     → Continuing without main transactions...');
    }
  }

  // Step 6: Alerts (depends on customers and transactions)
  console.log('   - Seeding alerts...');

  // Filter out alerts with invalid suspect_txn_id references
  const validAlerts = [];
  const skippedAlerts = [];

  for (const alert of alerts) {
    // Check if suspect_txn_id exists (if provided)
    if (alert.suspect_txn_id) {
      const txnExists = await prisma.transaction.findUnique({
        where: { id: alert.suspect_txn_id },
        select: { id: true },
      });

      if (txnExists) {
        validAlerts.push({
          ...alert,
          created_at: new Date(alert.created_at),
        });
      } else {
        // Alert references non-existent transaction, skip or set to null
        console.log(`     ⚠️  Alert ${alert.id} references non-existent txn ${alert.suspect_txn_id}, setting to null`);
        validAlerts.push({
          ...alert,
          created_at: new Date(alert.created_at),
          suspect_txn_id: null,
        });
      }
    } else {
      validAlerts.push({
        ...alert,
        created_at: new Date(alert.created_at),
      });
    }
  }

  if (validAlerts.length > 0) {
    await prisma.alert.createMany({ data: validAlerts });
    console.log(`     ✅ Seeded ${validAlerts.length} alerts`);
    if (skippedAlerts.length > 0) {
      console.log(`     ⚠️  Skipped ${skippedAlerts.length} alerts with invalid references`);
    }
  }

  console.log('');
  console.log('========================================');
  console.log('✅ Database seeded successfully!');
  console.log('========================================');
  console.log('');
  console.log('Summary:');
  console.log(`  - Customers: ${customers.length}`);
  console.log(`  - Cards: ${cards.length}`);
  console.log(`  - Accounts: ${accounts.length}`);
  console.log(`  - Transactions: Check count above`);
  console.log(`  - Alerts: ${validAlerts.length}`);
  console.log(`  - KB Docs: ${kbDocs.length}`);
  console.log(`  - Policies: ${policies.length}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Start API: docker compose up api');
  console.log('  2. Start Web: docker compose up web');
  console.log('  3. Open: http://localhost:5173');
  console.log('');
}

main()
  .catch((e) => {
    console.error('');
    console.error('❌ Seed failed with error:');
    console.error(e);
    console.error('');
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
