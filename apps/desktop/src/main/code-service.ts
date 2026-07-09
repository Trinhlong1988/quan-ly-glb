// Identifier-code generator (§D). Atomic per-prefix counter in `code_counters`.
// nextCode() is the ONLY way codes are minted — never derive from a raw autoincrement id
// (ids can gap). Codes are zero-padded to ≥2 digits: NV01, KH01, … NV100.
import { formatCode, isValidCodePrefix } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { getDb } from './db.js';

/** A Prisma client OR an interactive-transaction handle — both expose codeCounter/user. */
type Client = Db | Parameters<Parameters<Db['$transaction']>[0]>[0];

/**
 * Mint the next code for `prefix` atomically. Pass a transaction client to make the
 * counter bump part of a larger atomic write (e.g. customer create).
 * First value is 1 → `${prefix}01`.
 */
export async function nextCode(prefix: string, client?: Client): Promise<string> {
  if (!isValidCodePrefix(prefix)) throw new Error(`Prefix mã không hợp lệ: ${prefix}`);
  const db = client ?? getDb();
  // upsert increments (or creates at 1) and returns the resulting row atomically.
  const row = await db.codeCounter.upsert({
    where: { prefix },
    create: { prefix, lastValue: 1 },
    update: { lastValue: { increment: 1 } }
  });
  return formatCode(prefix, row.lastValue);
}

/**
 * One-off/idempotent: give every user still missing an `employee_code` a NV## code,
 * lowest id first (so the seed admin `adminroot` becomes NV01). Safe to run on every boot.
 */
export async function backfillEmployeeCodes(db: Db): Promise<number> {
  const missing = await db.user.findMany({
    where: { employeeCode: null },
    orderBy: { id: 'asc' },
    select: { id: true }
  });
  let assigned = 0;
  for (const u of missing) {
    // Sequential (not Promise.all) so codes are handed out in id order without collision.
    const code = await nextCode('NV', db);
    await db.user.update({ where: { id: u.id }, data: { employeeCode: code } });
    assigned++;
  }
  return assigned;
}
