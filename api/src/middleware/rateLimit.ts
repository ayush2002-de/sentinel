// /api/src/middleware/rateLimit.ts
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../lib/redis.js';
import { metrics } from '../Services/MetricsService.js';

export const actionRateLimiter = rateLimit({
  windowMs: 10 * 1000, // 10 seconds
  limit: 5 * 10, // 5 r/s (limit * windowMs / 1000)
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: async (...args: any[]) => redis.call(args[0], ...args.slice(1)) as any,
  }),
  handler: (_req, res, _next, options) => {
    metrics.rateLimitBlockTotal.inc();
    res.status(options.statusCode).send(options.message);
  },
  message: { error: 'Too many requests, please try again after 10 seconds.' },
});

// Rate limiter specifically for triage endpoint
// Acceptance Test 5: 5 requests per 60 second window
export const triageRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 60 seconds
  limit: 5, // 5 requests per window
  standardHeaders: 'draft-7', // Use RateLimit-* headers
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: async (...args: any[]) => redis.call(args[0], ...args.slice(1)) as any,
    prefix: 'rl:triage:', // Separate namespace for triage rate limits
  }),
  handler: (_req, res, _next, options) => {
    metrics.rateLimitBlockTotal.inc();
    const retryAfter = Math.ceil(options.windowMs / 1000);
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter,
      message: 'Too many triage requests. Please try again later.'
    });
  },
  skipSuccessfulRequests: false, // Count all requests
  skipFailedRequests: false,
});