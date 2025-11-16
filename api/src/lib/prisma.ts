// /api/src/lib/prisma.ts
import { PrismaClient } from '@prisma/client';

// This creates a global singleton for the Prisma client
export const prisma = new PrismaClient({
  // Optional: log queries for debugging
  // log: ['query', 'info', 'warn', 'error'],
});