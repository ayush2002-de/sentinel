// /api/src/services/guardrails.ts
import pRetry from 'p-retry';
import CircuitBreaker from 'opossum';

// --- 1. Timeout ---
export function withTimeout<T>(
  fn: () => Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`Agent timed out after ${ms}ms, using fallback.`);
      resolve(fallback);
    }, ms);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        console.error('Agent failed, using fallback.', err);
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

// --- 2. Retry ---
export function withRetry<T>(
  fn: (retries: number) => Promise<T>,
  options: Parameters<typeof pRetry>[1] = {}
): Promise<T> {
  let attemptCount = 0;
  return pRetry(() => {
    attemptCount++;
    return fn(attemptCount);
  }, {
    retries: 2, // Max 2 retries (3 total attempts)
    minTimeout: 150, // 150ms
    factor: 2.6,     // ~400ms
    randomize: true, // + jitter
    ...options,
  });
}

// --- 3. Circuit Breaker ---
// You would create a specific breaker for each critical tool
export function createCircuitBreaker(
  name: string,
  fn: (...args: any[]) => Promise<any>
) {
  const options: CircuitBreaker.Options = {
    timeout: 3000, // If function takes longer than 3s, trigger a failure
    errorThresholdPercentage: 50, // 50% failures
    resetTimeout: 30000, // Open for 30s
  };

  const breaker = new CircuitBreaker(fn, options);
  breaker.on('open', () => console.error(`Circuit ${name} is OPEN.`));
  breaker.on('close', () => console.log(`Circuit ${name} is CLOSED.`));
  
  // Return a function that uses the breaker
  return (...args: any[]) => breaker.fire(...args);
}