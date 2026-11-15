import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient({
  // A hosted database is a network hop away, so a multi-step booking can outlast Prisma's 5 s default.
  transactionOptions: { maxWait: 15_000, timeout: 30_000 },
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
