// PHASE H1 — Thu–Chi: Danh mục thu/chi service (main). Spec docs/PHASE_H_THUCHI_SPEC.md §2.1/§5/§6.
// Permission-guarded (CASHCAT_VIEW/CREATE/UPDATE/DELETE), audited (before/after — R_AUDIT_TRAIL, kể cả
// nhánh từ chối), soft-delete, R_UX_WARN (message tiếng Việt cụ thể). Tiền = VND nguyên (KHÔNG ×1000).
//
// BẤT BIẾN affectsPnl (I#12, §2.1): danh mục sourceKind nội bộ
//   {DEBT_CUSTOMER, DEBT_PARTNER, DEPOSIT, DEPOSIT_REFUND, ADVANCE, DEVICE_DEPOSIT, FUND_TRANSFER}
//   CẤM affectsPnl=true (đã nằm trong Transaction accrual / là dòng tiền nội bộ) → chống double-count.
//   Chặn cả create & update → PNL_FLAG_FORBIDDEN.
// isSystem = danh mục hệ thống (seed) — KHÔNG xóa cứng; đổi nguồn (sourceKind) cũng bị khóa.
import { auditSnapshot } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { dateRange } from './customer-service.js';
import { staleGuard } from './optimistic-lock.js';

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

/** Yếu tố truy vết chung (ai tạo/sửa gần nhất) — đồng bộ khuôn industry-service. */
export interface AuditTrail {
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedBy: number | null;
  updatedByName: string | null;
  updatedAt: string;
}

export interface CashCategoryDto extends AuditTrail {
  id: number;
  kind: string; // THU | CHI
  name: string;
  unit: string | null;
  periodType: string | null; // NONE | MONTH | DATE_RANGE
  sourceKind: string;
  affectsPnl: boolean;
  isSystem: boolean;
  active: boolean;
}

export interface CashCategoryFilter {
  search?: string;
  kind?: string; // THU | CHI — bỏ trống = cả hai
  active?: boolean;
  sourceKind?: string;
  fromDate?: string;
  toDate?: string;
}

export interface CreateCashCategoryInput {
  kind: string; // THU | CHI
  name: string;
  unit?: string | null;
  periodType?: string | null;
  sourceKind?: string;
  affectsPnl?: boolean;
  active?: boolean;
}

export interface UpdateCashCategoryInput {
  name?: string;
  unit?: string | null;
  periodType?: string | null;
  sourceKind?: string; // KHÔNG đổi được với danh mục hệ thống
  affectsPnl?: boolean;
  active?: boolean;
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock — mốc updatedAt client giữ lúc mở form
}

// ── Miền giá trị hợp lệ (khớp §2.1) ──
const KINDS = new Set(['THU', 'CHI']);
const PERIOD_TYPES = new Set(['NONE', 'MONTH', 'DATE_RANGE']);
const SOURCE_KINDS = new Set([
  'MANUAL',
  'DEBT_CUSTOMER',
  'DEBT_PARTNER',
  'SALE_POS',
  'SALE_TID',
  'ADVANCE',
  'DEPOSIT',
  'DEPOSIT_REFUND',
  'DEVICE_DEPOSIT',
  'FUND_TRANSFER',
  'SALARY',
  // LOẠI GIAO MÁY (Mr.Long) — "Doanh thu cho thuê máy" (giao hình thức Cho thuê, thu 1 lần lúc giao).
  // LÀ doanh thu thật → affectsPnl=true (KHÔNG nằm trong PNL_FORBIDDEN_SOURCE). Seed hệ thống, sinh khi
  // applyHandover xử lý moneyKind=RENT.
  'RENT',
  // H2b — "Chi phí nợ xấu" (ghi giảm nợ xấu). LÀ chi phí thật → affectsPnl=true (KHÔNG nằm trong
  // PNL_FORBIDDEN_SOURCE). Danh mục seed hệ thống, sinh khi write-off (writeOffBadDebt).
  'BAD_DEBT'
]);
/** sourceKind nội bộ — CẤM affectsPnl=true (I#12). BAD_DEBT KHÔNG nằm đây (nó là chi phí thật). */
const PNL_FORBIDDEN_SOURCE = new Set([
  'DEBT_CUSTOMER',
  'DEBT_PARTNER',
  'DEPOSIT',
  'DEPOSIT_REFUND',
  'ADVANCE',
  'DEVICE_DEPOSIT',
  'FUND_TRANSFER'
]);

/** Bất biến affectsPnl (I#12). Trả message lỗi nếu vi phạm, null nếu hợp lệ. */
function checkPnlInvariant(sourceKind: string, affectsPnl: boolean): string | null {
  if (affectsPnl && PNL_FORBIDDEN_SOURCE.has(sourceKind)) {
    return 'Danh mục loại này (công nợ/cọc/tạm ứng/chuyển quỹ) không được tính vào lợi nhuận.';
  }
  return null;
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

/** So khớp tên (không phân biệt hoa/thường + khoảng trắng) để chống trùng trong CÙNG loại (kind). */
function normName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** CASHCAT_VIEW — liệt kê danh mục thu/chi (loại đã xóa mềm), lọc theo loại/nguồn/trạng thái/ngày. */
export async function listCashCategories(
  filter: CashCategoryFilter = {}
): Promise<{ ok: boolean; data?: CashCategoryDto[]; error?: string; message?: string }> {
  const g = await requirePermission('CASHCAT_VIEW', { action: 'CASHCAT_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.cashCategory.findMany({
    where: {
      deletedAt: null,
      kind: filter.kind && KINDS.has(filter.kind) ? filter.kind : undefined,
      sourceKind: filter.sourceKind && SOURCE_KINDS.has(filter.sourceKind) ? filter.sourceKind : undefined,
      active: filter.active === undefined ? undefined : filter.active,
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search ? [{ name: { contains: filter.search } }] : undefined
    },
    orderBy: [{ kind: 'asc' }, { id: 'asc' }]
  });
  const names = await resolveUserNames(g.db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      unit: r.unit,
      periodType: r.periodType,
      sourceKind: r.sourceKind,
      affectsPnl: r.affectsPnl,
      isSystem: r.isSystem,
      active: r.active,
      ...trail(r, names)
    }))
  };
}

/** CASHCAT_CREATE — tạo danh mục thu/chi + bất biến affectsPnl (I#12) + chống trùng tên trong loại + audit. */
export async function createCashCategory(input: CreateCashCategoryInput): Promise<MutationResult> {
  const g = await requirePermission('CASHCAT_CREATE', { action: 'CASH_CATEGORY_CREATED', targetType: 'CashCategory' });
  if (!g.ok) return g;
  const { db, user } = g;

  const kind = (input.kind ?? '').trim().toUpperCase();
  if (!KINDS.has(kind)) return { ok: false, error: 'VALIDATION', message: 'Loại danh mục phải là THU hoặc CHI.' };

  const name = input.name?.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên danh mục bắt buộc.' };

  const sourceKind = (input.sourceKind ?? 'MANUAL').trim().toUpperCase() || 'MANUAL';
  if (!SOURCE_KINDS.has(sourceKind)) return { ok: false, error: 'VALIDATION', message: 'Nguồn danh mục không hợp lệ.' };

  const periodType = input.periodType ? input.periodType.trim().toUpperCase() : 'NONE';
  if (!PERIOD_TYPES.has(periodType)) return { ok: false, error: 'VALIDATION', message: 'Kỳ áp dụng không hợp lệ.' };

  const affectsPnl = input.affectsPnl ?? true;
  const pnlErr = checkPnlInvariant(sourceKind, affectsPnl);
  if (pnlErr) return { ok: false, error: 'PNL_FLAG_FORBIDDEN', message: pnlErr };

  // Chống trùng tên trong CÙNG loại (name KHÔNG @unique DB — dedup ở service, phân biệt active vs trash).
  const dup = (await db.cashCategory.findMany({ where: { kind }, select: { id: true, name: true, deletedAt: true } })).find(
    (r) => normName(r.name) === normName(name)
  );
  if (dup) {
    return dup.deletedAt
      ? { ok: false, error: 'DUPLICATE_TRASH', message: `Danh mục "${name}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn tên khác.` }
      : { ok: false, error: 'DUPLICATE', message: `Danh mục "${name}" đã tồn tại trong nhóm ${kind === 'THU' ? 'thu' : 'chi'}.` };
  }

  const created = await db.cashCategory.create({
    data: {
      kind,
      name,
      unit: input.unit?.trim() || null,
      periodType,
      sourceKind,
      affectsPnl,
      isSystem: false,
      active: input.active ?? true,
      createdBy: user.id
    }
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'CASH_CATEGORY_CREATED',
    targetType: 'CashCategory',
    targetId: String(created.id),
    after: auditSnapshot({ kind, name, unit: created.unit, periodType, sourceKind, affectsPnl, active: created.active })
  });
  return { ok: true, id: created.id };
}

/** CASHCAT_UPDATE — sửa danh mục; kind/isSystem bất biến; bất biến affectsPnl; chống trùng tên; audit before/after. */
export async function updateCashCategory(id: number, input: UpdateCashCategoryInput): Promise<MutationResult> {
  const g = await requirePermission('CASHCAT_UPDATE', { action: 'CASH_CATEGORY_UPDATED', targetType: 'CashCategory', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.cashCategory.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Danh mục không tồn tại.' };
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;

  const name = input.name !== undefined ? input.name.trim().replace(/\s+/g, ' ') : row.name;
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên danh mục không được để trống.' };

  // Nguồn (sourceKind): danh mục hệ thống KHÓA nguồn; danh mục thường cho đổi (re-validate bất biến).
  let sourceKind = row.sourceKind;
  if (input.sourceKind !== undefined) {
    const next = input.sourceKind.trim().toUpperCase();
    if (!SOURCE_KINDS.has(next)) return { ok: false, error: 'VALIDATION', message: 'Nguồn danh mục không hợp lệ.' };
    if (row.isSystem && next !== row.sourceKind) {
      return { ok: false, error: 'SYSTEM_LOCKED', message: 'Không đổi được nguồn của danh mục hệ thống.' };
    }
    sourceKind = next;
  }

  let periodType = row.periodType ?? 'NONE';
  if (input.periodType !== undefined) {
    const next = (input.periodType || 'NONE').trim().toUpperCase();
    if (!PERIOD_TYPES.has(next)) return { ok: false, error: 'VALIDATION', message: 'Kỳ áp dụng không hợp lệ.' };
    periodType = next;
  }

  // FIX 4 — danh mục HỆ THỐNG: KHÓA affectsPnl (như đã khóa sourceKind). Nếu không, user CASHCAT_UPDATE có
  // thể lật BAD_DEBT.affectsPnl=false → write-off ngừng trừ lợi nhuận (nợ xấu biến mất khỏi P&L).
  if (row.isSystem && input.affectsPnl !== undefined && input.affectsPnl !== row.affectsPnl) {
    return { ok: false, error: 'SYSTEM_LOCKED', message: 'Không đổi được cờ tính lợi nhuận của danh mục hệ thống.' };
  }
  const affectsPnl = input.affectsPnl !== undefined ? input.affectsPnl : row.affectsPnl;
  const pnlErr = checkPnlInvariant(sourceKind, affectsPnl);
  if (pnlErr) return { ok: false, error: 'PNL_FLAG_FORBIDDEN', message: pnlErr };

  if (normName(name) !== normName(row.name)) {
    const dup = (await db.cashCategory.findMany({ where: { kind: row.kind, NOT: { id } }, select: { id: true, name: true, deletedAt: true } })).find(
      (r) => normName(r.name) === normName(name)
    );
    if (dup) {
      return dup.deletedAt
        ? { ok: false, error: 'DUPLICATE_TRASH', message: `Danh mục "${name}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn tên khác.` }
        : { ok: false, error: 'DUPLICATE', message: `Danh mục "${name}" đã tồn tại trong nhóm ${row.kind === 'THU' ? 'thu' : 'chi'}.` };
    }
  }

  const before = auditSnapshot({ kind: row.kind, name: row.name, unit: row.unit, periodType: row.periodType, sourceKind: row.sourceKind, affectsPnl: row.affectsPnl, active: row.active });
  const updated = await db.cashCategory.update({
    where: { id },
    data: {
      name,
      unit: input.unit !== undefined ? input.unit?.trim() || null : row.unit,
      periodType,
      sourceKind,
      affectsPnl,
      active: input.active !== undefined ? input.active : row.active,
      updatedBy: user.id
    }
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'CASH_CATEGORY_UPDATED',
    targetType: 'CashCategory',
    targetId: String(id),
    before,
    after: auditSnapshot({ kind: updated.kind, name: updated.name, unit: updated.unit, periodType: updated.periodType, sourceKind: updated.sourceKind, affectsPnl: updated.affectsPnl, active: updated.active })
  });
  return { ok: true, id };
}

/**
 * CASHCAT_DELETE — xóa mềm 1..n danh mục + nhập lại mật khẩu (§14). Từ chối cũng ghi audit.
 * - Danh mục HỆ THỐNG (isSystem) KHÔNG xóa được → chặn (SYSTEM_LOCKED).
 * - (H2) danh mục ĐANG DÙNG (có CashEntry tham chiếu) sẽ chặn IN_USE — thêm khi có bảng CashEntry.
 */
export async function deleteCashCategories(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission('CASHCAT_DELETE', { action: 'CASH_CATEGORY_DELETED', targetType: 'CashCategory' });
  if (!g.ok) return g;
  const { db, user } = g;

  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn danh mục để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'CASH_CATEGORY_DELETED', targetType: 'CashCategory', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }

  let deleted = 0;
  let systemBlocked = 0;
  for (const id of ids) {
    const row = await db.cashCategory.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    if (row.isSystem) {
      systemBlocked++;
      continue;
    }
    await db.cashCategory.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'CASH_CATEGORY_DELETED',
      targetType: 'CashCategory',
      targetId: String(id),
      before: auditSnapshot({ kind: row.kind, name: row.name, sourceKind: row.sourceKind })
    });
    deleted++;
  }
  if (deleted === 0 && systemBlocked > 0) {
    return { ok: false, error: 'SYSTEM_LOCKED', message: 'Danh mục hệ thống không thể xóa.' };
  }
  return { ok: true, deleted };
}
