// PHASE H2-core — Thu–Chi: Quỹ (Fund §2.2/J) service (main). Permission-guarded
// (FUND_VIEW/CREATE/UPDATE/DELETE), audited (before/after — R_AUDIT_TRAIL, kể cả nhánh từ chối),
// soft-delete, R_UX_WARN (message tiếng Việt cụ thể). Tiền = VND nguyên (KHÔNG ×1000).
//
// SỐ DƯ KHÔNG LƯU CỨNG (I#1, tránh drift R6): currentBalance = openingBalance
//   + Σ CashEntry.amount (POSTED, kind=THU, fundId) − Σ CashEntry.amount (POSTED, kind=CHI, fundId).
//   Phiếu CANCELLED / DRAFT / đã xóa mềm KHÔNG tính. Mã QU## sinh atomic trong $transaction (§D/R7):
//   prefix 2 ký tự hợp CODE_PREFIX_REGEX /^[A-Z]{2,4}$/ (Q 1 ký tự sẽ throw — H6).
// Xóa mềm CHẶN nếu quỹ đã có CashEntry tham chiếu (IN_USE) → chỉ cho ngừng dùng (active=false).
import { auditSnapshot } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { nextCode } from './code-service.js';

/** Prefix mã quỹ (CodeCounter). 2 ký tự → hợp CODE_PREFIX_REGEX (H6: Q 1 ký tự vi phạm). */
const FUND_CODE_PREFIX = 'QU';
/** Loại quỹ hợp lệ (§2.2). */
const FUND_TYPES = new Set(['CASH', 'BANK', 'EWALLET']);
/** Trần an toàn số dư đầu kỳ (R5 — chống tràn Number). */
const AMOUNT_MAX = 1e15;

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

export interface AuditTrail {
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedBy: number | null;
  updatedByName: string | null;
  updatedAt: string;
}

export interface FundDto extends AuditTrail {
  id: number;
  code: string;
  name: string;
  type: string; // CASH | BANK | EWALLET
  keeperUserId: number | null;
  keeperUserName: string | null;
  openingBalance: number;
  currentBalance: number; // running (KHÔNG lưu cứng) — I#1
  active: boolean;
  note: string | null;
}

export interface FundFilter {
  search?: string;
  active?: boolean;
  type?: string;
}

export interface CreateFundInput {
  name: string;
  type: string; // CASH | BANK | EWALLET
  keeperUserId?: number | null;
  openingBalance?: number;
  active?: boolean;
  note?: string | null;
}

export interface UpdateFundInput {
  name?: string;
  type?: string;
  keeperUserId?: number | null;
  openingBalance?: number;
  active?: boolean;
  note?: string | null;
}

/** Số dư đầu kỳ VND: số nguyên ≥ 0, không tràn. null nếu sai. */
function parseOpening(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n) || n > AMOUNT_MAX) return null;
  return n;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

async function resolveUserNames(db: Db, ids: (number | null | undefined)[]): Promise<Map<number, string>> {
  const uniq = [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
  const map = new Map<number, string>();
  if (uniq.length === 0) return map;
  const users = await db.user.findMany({ where: { id: { in: uniq } }, select: { id: true, fullName: true, username: true } });
  for (const u of users) map.set(u.id, u.fullName || u.username);
  return map;
}

function trail(
  row: { createdBy: number | null; createdAt: Date; updatedBy: number | null; updatedAt: Date },
  names: Map<number, string>
): AuditTrail {
  return {
    createdBy: row.createdBy,
    createdByName: row.createdBy != null ? names.get(row.createdBy) ?? null : null,
    createdAt: row.createdAt.toISOString(),
    updatedBy: row.updatedBy,
    updatedByName: row.updatedBy != null ? names.get(row.updatedBy) ?? null : null,
    updatedAt: row.updatedAt.toISOString()
  };
}

/**
 * Số dư running của TẤT CẢ quỹ (I#1). Trả Map fundId → net (Σ THU − Σ CHI của phiếu POSTED còn sống).
 * Dùng groupBy 1 truy vấn — KHÔNG lưu số dư cứng (R6).
 */
async function postedNetByFund(db: Db): Promise<Map<number, number>> {
  const rows = await db.cashEntry.groupBy({
    by: ['fundId', 'kind'],
    where: { status: 'POSTED', deletedAt: null },
    _sum: { amount: true }
  });
  const net = new Map<number, number>();
  for (const r of rows) {
    const sum = r._sum.amount ?? 0;
    const delta = r.kind === 'THU' ? sum : -sum;
    net.set(r.fundId, (net.get(r.fundId) ?? 0) + delta);
  }
  return net;
}

/** Số dư running của 1 quỹ (openingBalance + net POSTED). Public để service khác/selftest dùng. */
export async function fundCurrentBalance(db: Db, fundId: number): Promise<number> {
  const fund = await db.fund.findUnique({ where: { id: fundId }, select: { openingBalance: true } });
  if (!fund) return 0;
  const agg = await db.cashEntry.groupBy({
    by: ['kind'],
    where: { fundId, status: 'POSTED', deletedAt: null },
    _sum: { amount: true }
  });
  let net = 0;
  for (const r of agg) net += (r.kind === 'THU' ? 1 : -1) * (r._sum.amount ?? 0);
  return fund.openingBalance + net;
}

/** FUND_VIEW — danh sách quỹ + số dư running + tên người giữ. Lọc theo tìm/loại/trạng thái. */
export async function listFunds(
  filter: FundFilter = {}
): Promise<{ ok: boolean; data?: FundDto[]; error?: string; message?: string }> {
  const g = await requirePermission('FUND_VIEW', { action: 'FUND_VIEW' });
  if (!g.ok) return g;
  const db = g.db;
  const rows = await db.fund.findMany({
    where: {
      deletedAt: null,
      active: filter.active === undefined ? undefined : filter.active,
      type: filter.type && FUND_TYPES.has(filter.type) ? filter.type : undefined,
      OR: filter.search ? [{ code: { contains: filter.search } }, { name: { contains: filter.search } }] : undefined
    },
    orderBy: { id: 'asc' }
  });
  const net = await postedNetByFund(db);
  const names = await resolveUserNames(db, rows.flatMap((r) => [r.createdBy, r.updatedBy, r.keeperUserId]));
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      keeperUserId: r.keeperUserId,
      keeperUserName: r.keeperUserId != null ? names.get(r.keeperUserId) ?? null : null,
      openingBalance: r.openingBalance,
      currentBalance: r.openingBalance + (net.get(r.id) ?? 0),
      active: r.active,
      note: r.note,
      ...trail(r, names)
    }))
  };
}

/** FUND_VIEW — danh sách user gọn (id/mã/tên) để chọn người giữ quỹ / người chi / người nhận. */
export async function listCashflowUsersLite(): Promise<{ ok: boolean; data?: { id: number; code: string | null; name: string }[]; error?: string; message?: string }> {
  const g = await requirePermission('FUND_VIEW', { action: 'FUND_VIEW' });
  if (!g.ok) return g;
  const users = await g.db.user.findMany({
    where: { deletedAt: null, status: { not: 'DELETED' } },
    select: { id: true, employeeCode: true, fullName: true, username: true },
    orderBy: { id: 'asc' }
  });
  return { ok: true, data: users.map((u) => ({ id: u.id, code: u.employeeCode, name: u.fullName || u.username })) };
}

/** FUND_CREATE — tạo quỹ; mã QU## auto (atomic $transaction §D) + chống trùng tên + audit. */
export async function createFund(input: CreateFundInput): Promise<MutationResult> {
  const g = await requirePermission('FUND_CREATE', { action: 'FUND_CREATED', targetType: 'Fund' });
  if (!g.ok) return g;
  const { db, user } = g;

  const name = input.name?.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên quỹ bắt buộc.' };

  const type = (input.type ?? '').trim().toUpperCase();
  if (!FUND_TYPES.has(type)) return { ok: false, error: 'VALIDATION', message: 'Loại quỹ phải là Tiền mặt, Ngân hàng hoặc Ví điện tử.' };

  const openingBalance = parseOpening(input.openingBalance ?? 0);
  if (openingBalance === null) return { ok: false, error: 'VALIDATION', message: 'Số dư đầu kỳ phải là số nguyên ≥ 0 (VND).' };

  if (input.keeperUserId != null) {
    const keeper = await db.user.findUnique({ where: { id: input.keeperUserId }, select: { id: true, deletedAt: true } });
    if (!keeper || keeper.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Người giữ quỹ không hợp lệ.' };
  }

  // Chống trùng tên (tên KHÔNG @unique DB — dedup ở service). So khớp trong các quỹ còn sống.
  const dupName = normName(name);
  const dup = (await db.fund.findMany({ where: { deletedAt: null }, select: { name: true } })).some((r) => normName(r.name) === dupName);
  if (dup) return { ok: false, error: 'DUPLICATE', message: `Quỹ "${name}" đã tồn tại.` };

  let created;
  try {
    created = await db.$transaction(async (tx) => {
      const code = await nextCode(FUND_CODE_PREFIX, tx);
      return tx.fund.create({
        data: {
          code,
          name,
          type,
          keeperUserId: input.keeperUserId ?? null,
          openingBalance,
          active: input.active ?? true,
          note: input.note?.trim() || null,
          createdBy: user.id
        }
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: 'Mã quỹ bị trùng, vui lòng thử lại.' };
    throw e;
  }
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'FUND_CREATED',
    targetType: 'Fund',
    targetId: String(created.id),
    after: auditSnapshot({ code: created.code, name: created.name, type: created.type, openingBalance: created.openingBalance, keeperUserId: created.keeperUserId, active: created.active })
  });
  return { ok: true, id: created.id };
}

/** FUND_UPDATE — mã bất biến; đổi tên/loại/người giữ/số dư đầu kỳ/trạng thái/ghi chú; audit before/after. */
export async function updateFund(id: number, input: UpdateFundInput): Promise<MutationResult> {
  const g = await requirePermission('FUND_UPDATE', { action: 'FUND_UPDATED', targetType: 'Fund', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.fund.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Quỹ không tồn tại.' };

  const name = input.name !== undefined ? input.name.trim().replace(/\s+/g, ' ') : row.name;
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên quỹ không được để trống.' };
  if (normName(name) !== normName(row.name)) {
    const dupName = normName(name);
    const dup = (await db.fund.findMany({ where: { deletedAt: null, NOT: { id } }, select: { name: true } })).some((r) => normName(r.name) === dupName);
    if (dup) return { ok: false, error: 'DUPLICATE', message: `Quỹ "${name}" đã tồn tại.` };
  }

  let type = row.type;
  if (input.type !== undefined) {
    const next = input.type.trim().toUpperCase();
    if (!FUND_TYPES.has(next)) return { ok: false, error: 'VALIDATION', message: 'Loại quỹ không hợp lệ.' };
    type = next;
  }

  let openingBalance = row.openingBalance;
  if (input.openingBalance !== undefined) {
    const next = parseOpening(input.openingBalance);
    if (next === null) return { ok: false, error: 'VALIDATION', message: 'Số dư đầu kỳ phải là số nguyên ≥ 0 (VND).' };
    openingBalance = next;
  }

  let keeperUserId = row.keeperUserId;
  if (input.keeperUserId !== undefined) {
    if (input.keeperUserId === null) keeperUserId = null;
    else {
      const keeper = await db.user.findUnique({ where: { id: input.keeperUserId }, select: { id: true, deletedAt: true } });
      if (!keeper || keeper.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Người giữ quỹ không hợp lệ.' };
      keeperUserId = input.keeperUserId;
    }
  }

  const before = auditSnapshot({ name: row.name, type: row.type, openingBalance: row.openingBalance, keeperUserId: row.keeperUserId, active: row.active, note: row.note });
  const updated = await db.fund.update({
    where: { id },
    data: {
      name,
      type,
      openingBalance,
      keeperUserId,
      active: input.active !== undefined ? input.active : row.active,
      note: input.note !== undefined ? input.note?.trim() || null : row.note,
      updatedBy: user.id
    }
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'FUND_UPDATED',
    targetType: 'Fund',
    targetId: String(id),
    before,
    after: auditSnapshot({ name: updated.name, type: updated.type, openingBalance: updated.openingBalance, keeperUserId: updated.keeperUserId, active: updated.active, note: updated.note })
  });
  return { ok: true, id };
}

/**
 * FUND_DELETE — xóa mềm 1..n quỹ + nhập lại mật khẩu (§14). Từ chối cũng ghi audit.
 * CHẶN xóa quỹ ĐANG DÙNG (có CashEntry tham chiếu — kể cả đã hủy, để bảo toàn báo cáo) → IN_USE;
 * quỹ đang dùng chỉ được ngừng dùng (active=false).
 */
export async function deleteFunds(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission('FUND_DELETE', { action: 'FUND_DELETED', targetType: 'Fund' });
  if (!g.ok) return g;
  const { db, user } = g;

  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn quỹ để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'FUND_DELETED', targetType: 'Fund', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }

  let deleted = 0;
  let inUse = 0;
  for (const id of ids) {
    const row = await db.fund.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    const refCount = await db.cashEntry.count({ where: { fundId: id, deletedAt: null } });
    if (refCount > 0) {
      inUse++;
      await writeAudit(db, { actorUserId: user.id, action: 'FUND_DELETED', targetType: 'Fund', targetId: String(id), after: { denied: true, reason: 'IN_USE', refCount } });
      continue;
    }
    await db.fund.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'FUND_DELETED',
      targetType: 'Fund',
      targetId: String(id),
      before: auditSnapshot({ code: row.code, name: row.name, type: row.type })
    });
    deleted++;
  }
  if (deleted === 0 && inUse > 0) {
    return { ok: false, error: 'IN_USE', message: 'Quỹ đang có phiếu thu/chi, không xóa được — chỉ có thể ngừng dùng.' };
  }
  return { ok: true, deleted };
}

/** So khớp tên (không phân biệt hoa/thường + khoảng trắng) để chống trùng quỹ ở tầng service. */
function normName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}
