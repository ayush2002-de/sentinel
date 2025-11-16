// /api/scripts/k6-test.ts
// k6 Load Test for Sentinel Support API
// Run with: k6 run scripts/k6-test.ts

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// --- Custom Metrics ---
const latencyTrend = new Trend('api_request_latency_ms');
const successRate = new Rate('success_rate');
const errorCounter = new Counter('errors');

// --- Test Configuration ---
export const options = {
  stages: [
    { duration: '30s', target: 10 },  // Ramp up to 10 VUs over 30s
    { duration: '1m', target: 10 },   // Stay at 10 VUs for 1 minute
    { duration: '20s', target: 50 },  // Spike to 50 VUs
    { duration: '1m', target: 50 },   // Stay at 50 VUs for 1 minute
    { duration: '30s', target: 0 },   // Ramp down to 0
  ],
  thresholds: {
    'http_req_duration': ['p(95)<100'],  // 95% of requests must complete below 100ms (SLO)
    'success_rate': ['rate>0.95'],       // 95% success rate
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:8080';
const API_KEY = __ENV.API_KEY || 'sentinel-dev-key';

// --- Main Test Function ---
export default function () {
  const headers = {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json',
  };

  // Test 1: Health Check
  const healthRes = http.get(`${BASE_URL}/api/health`);
  check(healthRes, {
    'health check is 200': (r) => r.status === 200,
  }) ? successRate.add(1) : successRate.add(0);

  // Test 2: Customer Transactions (Performance-Critical)
  // Replace with a real customer ID from your seeded data
  const customerId = 'cust_001';
  const txRes = http.get(
    `${BASE_URL}/api/customer/${customerId}/transactions?from=2024-01-01&limit=50`,
    { headers }
  );

  const txSuccess = check(txRes, {
    'transactions status is 200': (r) => r.status === 200,
    'transactions has items': (r) => {
      try {
        const body = JSON.parse(r.body as string);
        return body.items && body.items.length > 0;
      } catch {
        return false;
      }
    },
    'p95 latency < 100ms': (r) => r.timings.waiting < 100,
  });

  if (txSuccess) {
    successRate.add(1);
    latencyTrend.add(txRes.timings.waiting);
  } else {
    successRate.add(0);
    errorCounter.add(1);
  }

  // Test 3: Metrics Endpoint
  const metricsRes = http.get(`${BASE_URL}/api/metrics`);
  check(metricsRes, {
    'metrics status is 200': (r) => r.status === 200,
  }) ? successRate.add(1) : successRate.add(0);

  sleep(1); // Wait 1 second between iterations
}

// --- Setup Function (runs once before all VUs) ---
export function setup() {
  console.log('Starting k6 load test...');
  console.log(`Target URL: ${BASE_URL}`);
  console.log('Test will run for ~3.5 minutes');
}

// --- Teardown Function (runs once after all VUs finish) ---
export function teardown() {
  console.log('Load test completed!');
  console.log('Check the metrics endpoint for detailed performance data.');
}
