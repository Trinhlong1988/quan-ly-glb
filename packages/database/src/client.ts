// Prisma client factory (Prisma 7 + better-sqlite3 driver adapter).
// better-sqlite3 packages cleanly into Electron (.exe) — no query-engine binary.
// Electron main passes an absolute url under app.getPath('userData'); dev uses .env.
import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client.js";

export type Db = PrismaClient;

export function createPrisma(databaseUrl?: string): PrismaClient {
  const url = databaseUrl ?? process.env.DATABASE_URL ?? "file:./dev.db";
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

let _prisma: PrismaClient | undefined;

/** Lazy process-wide singleton (used by seed & tests). Main process may pass a url once. */
export function getPrisma(databaseUrl?: string): PrismaClient {
  if (!_prisma) _prisma = createPrisma(databaseUrl);
  return _prisma;
}
