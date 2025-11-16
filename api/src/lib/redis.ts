// /api/src/lib/redis.ts
import { Redis } from 'ioredis';

const connectionUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Client for general commands (GET, SET, PUBLISH)
export const redis = new Redis(connectionUrl, {
  maxRetriesPerRequest: 1,
});

// A separate client for subscribing (blocking command)
export const redisSubscriber = new Redis(connectionUrl);

redis.on('connect', () => console.log('Redis client connected'));
redisSubscriber.on('connect', () => console.log('Redis subscriber client connected'));
