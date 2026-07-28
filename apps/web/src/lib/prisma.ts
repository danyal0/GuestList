import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma client for Next.js App Router route handlers.
 * Reuses a single instance in development to avoid exhausting connections
 * under hot reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
