// /scripts/generate_txns.ts
import path from 'path';
import fs from 'fs';
import { readFile } from 'fs/promises';

import { randomUUID, randomInt } from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Realistic Data Samples ---
const MERCHANTS = [
  'QuickCab', 'Starcoffee', 'ABC Mart', 'TechZone', 'The Corner Cafe',
  'ByteGoods', 'Global Airlines', 'Metro Transit', 'City Power', 'NetFlix',
];
const MCCS = ['4121', '5812', '5411', '5732', '5814', '5045', '3001', '4111', '4900', '5968'];
const COUNTRIES = ['US', 'GB', 'CA', 'AU', 'IN', 'DE', 'FR'];
const CURRENCIES = ['USD', 'GBP', 'CAD', 'AUD', 'INR', 'EUR'];
const CITIES = ['New York', 'London', 'Toronto', 'Sydney', 'Mumbai', 'Berlin', 'Paris'];

// --- Helper Functions ---
const randEl = (arr: any[]) => arr[randomInt(arr.length)];
const randDate = (start: Date, end: Date) => {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
};

interface CustomerRef {
  id: string;
  cards: string[];
}

/**
 * Generates a single random transaction.
 */
const generateTransaction = (customer: CustomerRef) => {
  const cardId = randEl(customer.cards);
  const merchantIndex = randomInt(MERCHANTS.length);
  
  return {
    id: randomUUID(),
    customer_id: customer.id,
    card_id: cardId,
    mcc: MCCS[merchantIndex],
    merchant: MERCHANTS[merchantIndex],
    amount_cents: randomInt(100, 50000), // $1.00 to $500.00
    currency: randEl(CURRENCIES),
    ts: randDate(new Date(2023, 0, 1), new Date()).toISOString(),
    device_id: randomUUID(),
    country: randEl(COUNTRIES),
    city: randEl(CITIES),
  };
};

/**
 * Main generator function.
 */
async function generate(
  customerRefs: CustomerRef[],
  count: number,
  outputPath: string,
) {
  console.log(`Generating ${count} transactions...`);
  
  // We write in batches to avoid consuming all system memory.
  const BATCH_SIZE = 10000;
  const stream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });
  
  stream.write('[\n'); // Start JSON array

  for (let i = 0; i < count; i++) {
    const customer = randEl(customerRefs);
    if (!customer?.cards?.length) continue; // Skip if customer has no cards

    const txn = generateTransaction(customer);
    
    // Write the JSON object, adding a comma if it's not the last item.
    const line = JSON.stringify(txn) + (i === count - 1 ? '' : ',\n');
    
    if (!stream.write(line)) {
      // Handle backpressure: pause and wait for the stream to drain
      await new Promise<void>((resolve) => stream.once('drain', () => resolve()));
    }

    if (i % BATCH_SIZE === 0 && i > 0) {
      console.log(`... generated ${i} transactions`);
    }
  }

  stream.write('\n]\n'); // End JSON array
  stream.end();

  await new Promise<void>((resolve) => stream.on('finish', () => resolve()));
  console.log(`✅ Success! Generated ${count} transactions at ${outputPath}`);
}

/**
 * Load customer and card data from fixture files.
 */
async function loadCustomerCardData(): Promise<CustomerRef[]> {
  const fixturesDir = path.join(__dirname, '..', '..', 'fixtures');
  const customersPath = path.join(fixturesDir, 'customers.json');
  const cardsPath = path.join(fixturesDir, 'cards.json');

  console.log('Loading customers and cards from fixture files...');

  const [customersData, cardsData] = await Promise.all([
    readFile(customersPath, 'utf-8').then(JSON.parse),
    readFile(cardsPath, 'utf-8').then(JSON.parse),
  ]);

  // Build a map of customer_id -> card IDs
  const customerCardMap = new Map<string, string[]>();

  for (const card of cardsData) {
    const customerId = card.customer_id;
    if (!customerCardMap.has(customerId)) {
      customerCardMap.set(customerId, []);
    }
    // Only include ACTIVE cards for transaction generation
    if (card.status === 'ACTIVE') {
      customerCardMap.get(customerId)!.push(card.id);
    }
  }

  // Build CustomerRef array
  const customerRefs: CustomerRef[] = customersData
    .map((customer: any) => ({
      id: customer.id,
      cards: customerCardMap.get(customer.id) || [],
    }))
    .filter((ref: CustomerRef) => ref.cards.length > 0); // Only include customers with active cards

  console.log(`Loaded ${customerRefs.length} customers with active cards`);

  return customerRefs;
}

/**
 * IIFE to run the script from CLI.
 * Usage: pnpm generate-txns 1000000
 */
(async () => {
  const count = parseInt(process.argv[2], 10);
  if (isNaN(count) || count <= 0) {
    console.error('Error: Please provide a valid number of transactions to generate.');
    console.log('Usage: pnpm generate-txns <count>');
    console.log('Example: pnpm generate-txns 1000000');
    process.exit(1);
  }

  const outputPath = path.join(__dirname, '..', '..', 'fixtures', 'transactions.json');

  try {
    // Load actual customer and card data from fixture files
    const customerRefs = await loadCustomerCardData();

    if (customerRefs.length === 0) {
      console.error('Error: No customers with active cards found in fixtures.');
      console.log('Please ensure customers.json and cards.json have valid data.');
      process.exit(1);
    }

    await generate(customerRefs, count, outputPath);
  } catch (err) {
    console.error('Generation failed:', err);
    process.exit(1);
  }
})();