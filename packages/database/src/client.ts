// Prisma client factory (Prisma 7 + @prisma/adapter-pg driver adapter).
// G10: FULL-SWITCH SQLite → PostgreSQL. pg is pure-JS → packages cleanly into
// Electron (.exe) with no native .node addon and no query-engine binary.
// Electron main passes a postgresql:// url built from the server-config file; dev uses .env.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

export type Db = PrismaClient;

export function createPrisma(databaseUrl?: string): PrismaClient {
  const connectionString = databaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL không được cấu hình. Cần chuỗi postgresql:// (server-config hoặc .env)."
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
