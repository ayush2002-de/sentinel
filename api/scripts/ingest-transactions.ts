import { createReadStream } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INGEST_URL = process.env.INGEST_URL || 'http://localhost:8080/api/ingest/transactions';
const FIXTURES_PATH = path.join(__dirname, '..', '..', 'fixtures', 'transactions.json');
const BATCH_SIZE = 10000; // Number of transactions to send per batch

async function ingestTransactions() {
  console.log('Starting transaction ingestion...');
  console.log(`Target URL: ${INGEST_URL}`);
  console.log(`Reading from: ${FIXTURES_PATH}`);

  try {
    const fileStream = createReadStream(FIXTURES_PATH, { encoding: 'utf-8' });
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let buffer = '';
    let batch: any[] = [];
    let totalSent = 0;
    let batchNumber = 0;

    for await (const line of rl) {
      buffer += line;
    }

    // Parse the entire JSON file
    console.log('Parsing JSON file...');
    const transactions = JSON.parse(buffer);

    if (!Array.isArray(transactions)) {
      throw new Error('Expected transactions.json to contain an array');
    }

    console.log(`Found ${transactions.length} transactions`);
    console.log(`Sending in batches of ${BATCH_SIZE}...`);

    // Send transactions in batches
    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      batch = transactions.slice(i, i + BATCH_SIZE);
      batchNumber++;

      try {
        const response = await fetch(INGEST_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(batch),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        totalSent += batch.length;
        console.log(`✓ Batch ${batchNumber}: Sent ${batch.length} transactions (Total: ${totalSent}/${transactions.length})`);
      } catch (error) {
        console.error(`✗ Batch ${batchNumber} failed:`, error);
        throw error;
      }
    }

    console.log('\n✓ Successfully ingested all transactions!');
    console.log(`Total transactions sent: ${totalSent}`);

  } catch (error) {
    console.error('\n✗ Error during ingestion:');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

// Run the script
ingestTransactions();
