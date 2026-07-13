// LOẠI GIAO MÁY (Mr.Long) — danh mục hình thức GIAO máy/TID cho khách. `moneyKind` quyết định MÔ HÌNH
// TIỀN: SALE (bán đứt → doanh thu, luồng device-sale) | RENT (cho thuê → thu 1 lần, doanh thu) |
// DEPOSIT (cọc → nợ phải trả, KHÔNG doanh thu, recall hoàn cọc) | NONE (mượn → 0đ). Khuôn FeeType
// (name @unique + audit + soft-delete). Builtin (4 loại seed): cấm xóa + KHÓA moneyKind (chỉ đổi
// name/sortOrder). Permission-guarded (CONFIG_HANDOVER_VIEW/MANAGE), audited, R_UX_WARN tiếng Việt.
import { auditSnapshot } from '@glb/business-rules';
import { hasPermission } from '@glb/shared';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { me } from './auth-service.js';
import { writeAudit } from './audit.js';
import { staleGuard } from './optimistic-lock.js';
import type { MoneyKind, HandoverContext } from './deposit-service.js';

const VIEW = 'CONFIG_HANDOVER_VIEW';
const MANAGE = 'CONFIG_HANDOVER_MANAGE';

/** moneyKind hợp lệ — quyết định mô hình tiền của loại giao. */
export const MONEY_KINDS = new Set<MoneyKind>(['SALE', 'RENT', 'DEPOSIT', 'NONE']);

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

export interface HandoverTypeDto extends AuditTrail {
  id: number;
  name: string;
  moneyKind: string;
  isBuiltin: boolean;
  sortOrder: number;
}
export interface CreateHandoverTypeInput {
  name: string;
  moneyKind: string;
  sortOrder?: number;
}
export interface UpdateHandoverTypeInput {
  name?: string;
  moneyKind?: string; // builtin KHÓA moneyKind
  sortOrder?: number;
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock
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
function trail(row: { createdBy: number | null; createdAt: Date; updatedBy: number | null; updatedAt: Date }, names: Map<number, string>): AuditTrail {
  return {
    createdBy: row.createdBy,
    createdByName: row.createdBy != null ? names.get(row.createdBy) ?? null : null,
    createdAt: row.createdAt.toISOString(),
    updatedBy: row.updatedBy,
    updatedByName: row.updatedBy != null ? names.get(row.updatedBy) ?? null : null,
    updatedAt: row.updatedAt.toISOString()
  };
}
function toDto(r: { id: number; name: string; moneyKind: string; isBuiltin: boolean; sortOrder: number; createdBy: number | null; createdAt: Date; updatedBy: number | null; updatedAt: Date }, names: Map<number, string>): HandoverTypeDto {
  return { id: r.id, name: r.name, moneyKind: r.moneyKind, isBuiltin: r.isBuiltin, sortOrder: r.sortOrder, ...trail(r, names) };
}

/** CONFIG_HANDOVER_VIEW — danh sách loại giao (chưa xóa), theo sortOrder rồi id. */
export async function listHandoverTypes(): Promise<{ ok: boolean; data?: HandoverTypeDto[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const rows = await g.db.handoverType.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  const names = await resolveUserNames(g.db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  return { ok: true, data: rows.map((r) => toDto(r, names)) };
}

/** Danh sách loại giao GỌN cho picker "Giao máy / Giao TID" — chấp nhận CONFIG_HANDOVER_VIEW HOẶC
 *  POS_VIEW HOẶC TID_VIEW (người giao máy/TID phải chọn được loại giao dù không quản danh mục). */
export async function listHandoverTypesLite(): Promise<{ ok: boolean; data?: { id: number; name: string; moneyKind: string; sortOrder: number }[]; error?: string; message?: string }> {
  const user = me();
  const code = user && (hasPermission(user, VIEW) ? VIEW : hasPermission(user, 'POS_VIEW') ? 'POS_VIEW' : 'TID_VIEW');
  const g = await requirePermission(code || VIEW, { action: 'HANDOVER_PICKER' });
  if (!g.ok) return g;
  const rows = await g.db.handoverType.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, name: true, moneyKind: true, sortOrder: true } });
  return { ok: true, data: rows };
}

/** CONFIG_HANDOVER_MANAGE — tạo loại giao mới (KHÔNG builtin) + chống trùng tên + audit. */
export async function createHandoverType(input: CreateHandoverTypeInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'HANDOVER_TYPE_CREATED', targetType: 'HandoverType' });
  if (!g.ok) return g;
  const { db, user } = g;
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên loại giao bắt buộc.' };
  const moneyKind = (input.moneyKind ?? '').trim().toUpperCase();
  if (!MONEY_KINDS.has(moneyKind as MoneyKind)) return { ok: false, error: 'VALIDATION', message: 'Mô hình tiền phải là Bán / Cho thuê / Cọc / Mượn.' };
  const sortOrder = Number.isInteger(input.sortOrder) ? (input.sortOrder as number) : 0;
  const dup = await db.handoverType.findFirst({ where: { name } });
  if (dup) {
    return dup.deletedAt
      ? { ok: false, error: 'DUPLICATE_TRASH', message: `Loại giao "${name}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn tên khác.` }
      : { ok: false, error: 'DUPLICATE', message: `Loại giao "${name}" đã tồn tại.` };
  }
  let created;
  try {
    created = await db.handoverType.create({ data: { name, moneyKind, isBuiltin: false, sortOrder, createdBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Loại giao "${name}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'HANDOVER_TYPE_CREATED', targetType: 'HandoverType', targetId: String(created.id), after: auditSnapshot({ name, moneyKind, sortOrder }) });
  return { ok: true, id: created.id };
}

/** CONFIG_HANDOVER_MANAGE — sửa loại giao. Builtin: chỉ đổi name/sortOrder (KHÓA moneyKind). Audit before/after. */
export async function updateHandoverType(id: number, input: UpdateHandoverTypeInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'HANDOVER_TYPE_UPDATED', targetType: 'HandoverType', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.handoverType.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Loại giao không tồn tại.' };
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;

  const name = input.name !== undefined ? input.name.trim() : row.name;
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên loại giao không được để trống.' };

  let moneyKind = row.moneyKind;
  if (input.moneyKind !== undefined) {
    const next = input.moneyKind.trim().toUpperCase();
    if (!MONEY_KINDS.has(next as MoneyKind)) return { ok: false, error: 'VALIDATION', message: 'Mô hình tiền phải là Bán / Cho thuê / Cọc / Mượn.' };
    if (row.isBuiltin && next !== row.moneyKind) {
      return { ok: false, error: 'BUILTIN_LOCKED', message: 'Không đổi được mô hình tiền của loại giao mặc định (Bán/Cho thuê/Mượn/Cọc).' };
    }
    moneyKind = next;
  }
  const sortOrder = Number.isInteger(input.sortOrder) ? (input.sortOrder as number) : row.sortOrder;

  if (name !== row.name) {
    const dup = await db.handoverType.findFirst({ where: { name, NOT: { id } } });
    if (dup) {
      return dup.deletedAt
        ? { ok: false, error: 'DUPLICATE_TRASH', message: `Loại giao "${name}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn tên khác.` }
        : { ok: false, error: 'DUPLICATE', message: `Loại giao "${name}" đã tồn tại.` };
    }
  }
  const before = auditSnapshot({ name: row.name, moneyKind: row.moneyKind, sortOrder: row.sortOrder });
  let updated;
  try {
    updated = await db.handoverType.update({ where: { id }, data: { name, moneyKind, sortOrder, updatedBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Loại giao "${name}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'HANDOVER_TYPE_UPDATED', targetType: 'HandoverType', targetId: String(id), before, after: auditSnapshot({ name: updated.name, moneyKind: updated.moneyKind, sortOrder: updated.sortOrder }) });
  return { ok: true, id };
}

/** CONFIG_HANDOVER_MANAGE — xóa mềm 1..n loại giao + mật khẩu (§14). Builtin KHÔNG xóa (BUILTIN_LOCKED). */
export async function deleteHandoverTypes(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission(MANAGE, { action: 'HANDOVER_TYPE_DELETED', targetType: 'HandoverType' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn loại giao để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'HANDOVER_TYPE_DELETED', targetType: 'HandoverType', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  let builtinBlocked = 0;
  for (const id of ids) {
    const row = await db.handoverType.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    if (row.isBuiltin) { builtinBlocked++; continue; }
    await db.handoverType.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'HANDOVER_TYPE_DELETED', targetType: 'HandoverType', targetId: String(id), before: auditSnapshot({ name: row.name, moneyKind: row.moneyKind }) });
    deleted++;
  }
  if (deleted === 0 && builtinBlocked > 0) {
    return { ok: false, error: 'BUILTIN_LOCKED', message: 'Loại giao mặc định (Bán/Cho thuê/Mượn/Cọc) không thể xóa.' };
  }
  return { ok: true, deleted };
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveHandoverInput — VALIDATE (trước $transaction) loại giao + số tiền + quỹ cho deploy / assign-TID.
// Trả HandoverContext đã kiểm (applyHandoverTx chỉ GHI, không còn nhánh lỗi nghiệp vụ trong tx). moneyKind
// SALE trả cờ để CALLER chặn/định tuyến sang luồng Bán (helper KHÔNG xử lý Bán).
// ─────────────────────────────────────────────────────────────────────────────
export interface ResolveHandoverInput {
  handoverTypeId?: number | null; // null = giao nội bộ (mượn/không loại giao) → NONE
  amount?: number | null; // số tiền giao (VND); mặc định 0
  fundId?: number | null; // quỹ nhận (bắt buộc khi amount>0 với RENT/DEPOSIT)
  method?: string | null; // CK | CASH (mặc định CASH)
}
export type ResolveHandoverResult =
  | { ok: true; moneyKind: MoneyKind; handoverTypeId: number | null; amount: bigint; fundId: number | null; method: string }
  | { ok: false; error: string; message: string };

const METHODS = new Set(['CK', 'CASH']);

function parseVndAmount(v: unknown): bigint | null {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return BigInt(n);
}

export async function resolveHandoverInput(db: Db, input: ResolveHandoverInput): Promise<ResolveHandoverResult> {
  const method = input.method === 'CK' ? 'CK' : 'CASH';
  if (input.method != null && !METHODS.has(String(input.method).toUpperCase()) && input.method !== 'CK' && input.method !== 'CASH') {
    // giữ mềm: method lạ → mặc định CASH (không chặn giao vì hình thức)
  }
  const amount = parseVndAmount(input.amount ?? 0);
  if (amount === null) return { ok: false, error: 'VALIDATION', message: 'Số tiền giao phải là số nguyên ≥ 0 (VND).' };

  // Không chọn loại giao → coi như MƯỢN (NONE, 0đ) — giữ tương thích giao nội bộ / selftest cũ.
  if (input.handoverTypeId == null) {
    if (amount > 0n) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn loại giao thì không nhập số tiền (mặc định Mượn 0đ).' };
    return { ok: true, moneyKind: 'NONE', handoverTypeId: null, amount: 0n, fundId: null, method };
  }
  const ht = await db.handoverType.findUnique({ where: { id: input.handoverTypeId } });
  if (!ht || ht.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Loại giao đã chọn không tồn tại.' };
  const moneyKind = ht.moneyKind as MoneyKind;

  if (moneyKind === 'SALE') {
    // Helper KHÔNG xử lý Bán — caller định tuyến sang chức năng Bán máy.
    return { ok: true, moneyKind, handoverTypeId: ht.id, amount, fundId: input.fundId ?? null, method };
  }
  if (moneyKind === 'NONE') {
    if (amount > 0n) return { ok: false, error: 'VALIDATION', message: 'Giao hình thức "Mượn" là 0đ — không nhập số tiền.' };
    return { ok: true, moneyKind, handoverTypeId: ht.id, amount: 0n, fundId: null, method };
  }
  // RENT (amount≥0; 0 → bỏ qua tiền) | DEPOSIT (amount>0).
  if (moneyKind === 'DEPOSIT' && amount <= 0n) {
    return { ok: false, error: 'VALIDATION', message: 'Giao hình thức "Cọc" phải nhập số tiền cọc (> 0).' };
  }
  let fundId: number | null = null;
  if (amount > 0n) {
    if (!input.fundId) return { ok: false, error: 'VALIDATION', message: 'Có thu tiền thì phải chọn quỹ nhận.' };
    const fund = await db.fund.findFirst({ where: { id: input.fundId, deletedAt: null }, select: { id: true } });
    if (!fund) return { ok: false, error: 'NOT_FOUND', message: 'Quỹ nhận tiền không tồn tại.' };
    fundId = input.fundId;
  }
  return { ok: true, moneyKind, handoverTypeId: ht.id, amount, fundId, method };
}

/** Ghép HandoverContext để đưa vào applyHandoverTx (deposit-service). */
export function buildHandoverContext(
  r: Extract<ResolveHandoverResult, { ok: true }>,
  ctx: { deviceSerial: string | null; tid: string | null; customerId: number | null; occurredAt: Date; actorId: number }
): HandoverContext {
  return {
    moneyKind: r.moneyKind,
    handoverTypeId: r.handoverTypeId,
    amount: r.amount,
    fundId: r.fundId,
    method: r.method,
    deviceSerial: ctx.deviceSerial,
    tid: ctx.tid,
    customerId: ctx.customerId,
    occurredAt: ctx.occurredAt,
    actorId: ctx.actorId
  };
}
