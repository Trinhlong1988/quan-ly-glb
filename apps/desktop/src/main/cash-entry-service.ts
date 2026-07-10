// PHASE H2-core — Thu–Chi: Phiếu thu/chi (CashEntry §2.3/D+E) + báo cáo dòng tiền cơ bản (§F).
// Permission-guarded (CASHENTRY_VIEW/CREATE/CANCEL), audited (kể cả nhánh từ chối), soft-delete.
// Tiền = VND nguyên > 0 (I#4). kind=CHI bắt buộc payerUserId (I#3). Ngày local (I#10, B16).
//
// RÀNG BUỘC (spec §4/§6.1):
//  • categoryId phải CÙNG kind với phiếu (THU↔THU, CHI↔CHI) + category active + chưa xóa.
//  • CHẶN category sourceKind ∈ {DEBT_CUSTOMER, DEBT_PARTNER} ở H2-core → DEBT_RECEIPT_DEFERRED
//    (thu công nợ dùng chức năng "Thu công nợ" pha sau — tránh phiếu thu công nợ mồ côi).
//  • Mã PT (THU) / PC (CHI) sinh atomic trong $transaction (§D/R7).
//  • Hủy: POSTED→CANCELLED nguyên tử (conditional updateMany trong $transaction, mẫu approval-service)
//    + verifyActorPassword + cancelReason. Phiếu CANCELLED KHÔNG tính vào số dư quỹ (I#1).
import { auditSnapshot } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { nextCode } from './code-service.js';

const KINDS = new Set(['THU', 'CHI']);
const METHODS = new Set(['CK', 'CASH']);
/** sourceKind công nợ — H2-core CHẶN lập phiếu thu (chờ chức năng Thu công nợ pha H2-debt). */
const DEBT_SOURCE = new Set(['DEBT_CUSTOMER', 'DEBT_PARTNER']);
/** Trần an toàn số tiền (R5 — chống tràn Number). */
const AMOUNT_MAX = 1e15;

/** Chuyển trạng thái nguyên tử THUA (updateMany count===0) → ném ra ngoài $transaction (mẫu approval-service). */
class TxGuardError extends Error {
  constructor(public readonly code: string, public readonly userMessage: string) {
    super(code);
    this.name = 'TxGuardError';
  }
}

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

export interface CashEntryDto {
  id: number;
  code: string | null;
  kind: string; // THU | CHI
  categoryId: number;
  categoryName: string | null;
  sourceKind: string | null;
  fundId: number;
  fundCode: string | null;
  fundName: string | null;
  amount: number;
  method: string; // CK | CASH
  entryDate: string; // ISO
  customerId: number | null;
  customerName: string | null;
  partnerId: number | null;
  partnerName: string | null;
  payerUserId: number | null;
  payerUserName: string | null;
  receiverUserId: number | null;
  receiverUserName: string | null;
  note: string | null;
  status: string; // DRAFT | POSTED | CANCELLED
  cancelReason: string | null;
  cancelledAt: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
}

export interface CashEntryFilter {
  kind?: string; // THU | CHI
  categoryId?: number;
  fundId?: number;
  customerId?: number;
  partnerId?: number;
  status?: string; // POSTED | CANCELLED | DRAFT
  fromDate?: string; // YYYY-MM-DD (local)
  toDate?: string; // YYYY-MM-DD (local)
}

export interface CreateCashEntryInput {
  kind: string; // THU | CHI
  categoryId: number;
  fundId: number;
  amount: number;
  method: string; // CK | CASH
  entryDate: string; // YYYY-MM-DD (local) hoặc ISO
  customerId?: number | null;
  partnerId?: number | null;
  payerUserId?: number | null; // bắt buộc khi kind=CHI
  receiverUserId?: number | null;
  note?: string | null;
}

export interface CashflowSummary {
  count: number;
  totalThu: number; // Σ THU POSTED
  totalChi: number; // Σ CHI POSTED
  net: number; // THU − CHI
}

export interface CashflowReportResult {
  ok: boolean;
  error?: string;
  message?: string;
  data?: CashEntryDto[];
  summary?: CashflowSummary;
}

/** Ngày VND local (B16): 'YYYY-MM-DD' → nửa đêm LOCAL; ISO → nguyên. null nếu không parse được. */
function parseLocalDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** Biên khoảng lọc (local): from 00:00, to 23:59:59.999 (R9). */
function dayStart(v?: string): Date | undefined {
  if (!v) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : new Date(v);
}
function dayEnd(v?: string): Date | undefined {
  if (!v) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T23:59:59.999') : new Date(v);
}
/** Số tiền VND: số nguyên > 0, không tràn (I#4/R5). null nếu sai. */
function parseAmount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > AMOUNT_MAX) return null;
  return n;
}

async function resolveUserNames(db: Db, ids: (number | null | undefined)[]): Promise<Map<number, string>> {
  const uniq = [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
  const map = new Map<number, string>();
  if (uniq.length === 0) return map;
  const users = await db.user.findMany({ where: { id: { in: uniq } }, select: { id: true, fullName: true, username: true } });
  for (const u of users) map.set(u.id, u.fullName || u.username);
  return map;
}

/** Build where cho list/report từ filter (dùng chung). */
function buildWhere(filter: CashEntryFilter): Record<string, unknown> {
  const start = dayStart(filter.fromDate);
  const end = dayEnd(filter.toDate);
  return {
    deletedAt: null,
    kind: filter.kind && KINDS.has(filter.kind) ? filter.kind : undefined,
    categoryId: filter.categoryId ?? undefined,
    fundId: filter.fundId ?? undefined,
    customerId: filter.customerId ?? undefined,
    partnerId: filter.partnerId ?? undefined,
    status: filter.status ?? undefined,
    entryDate: start || end ? { gte: start, lte: end } : undefined
  };
}

/** Ánh xạ rows → DTO + join tên (category/fund/customer/partner/user). */
async function toDtos(db: Db, rows: Awaited<ReturnType<Db['cashEntry']['findMany']>>): Promise<CashEntryDto[]> {
  const catIds = [...new Set(rows.map((r) => r.categoryId))];
  const fundIds = [...new Set(rows.map((r) => r.fundId))];
  const custIds = [...new Set(rows.map((r) => r.customerId).filter((x): x is number => x != null))];
  const partIds = [...new Set(rows.map((r) => r.partnerId).filter((x): x is number => x != null))];
  const [cats, funds, custs, parts] = await Promise.all([
    catIds.length ? db.cashCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true, sourceKind: true } }) : Promise.resolve([]),
    fundIds.length ? db.fund.findMany({ where: { id: { in: fundIds } }, select: { id: true, code: true, name: true } }) : Promise.resolve([]),
    custIds.length ? db.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, nickname: true, fullName: true } }) : Promise.resolve([]),
    partIds.length ? db.partner.findMany({ where: { id: { in: partIds } }, select: { id: true, name: true } }) : Promise.resolve([])
  ]);
  const catMap = new Map(cats.map((c) => [c.id, c]));
  const fundMap = new Map(funds.map((f) => [f.id, f]));
  const custMap = new Map(custs.map((c) => [c.id, c.nickname || c.fullName]));
  const partMap = new Map(parts.map((p) => [p.id, p.name]));
  const userNames = await resolveUserNames(db, rows.flatMap((r) => [r.payerUserId, r.receiverUserId, r.createdBy]));
  return rows.map((r) => {
    const cat = catMap.get(r.categoryId);
    const fund = fundMap.get(r.fundId);
    return {
      id: r.id,
      code: r.code,
      kind: r.kind,
      categoryId: r.categoryId,
      categoryName: cat?.name ?? null,
      sourceKind: cat?.sourceKind ?? null,
      fundId: r.fundId,
      fundCode: fund?.code ?? null,
      fundName: fund?.name ?? null,
      amount: r.amount,
      method: r.method,
      entryDate: r.entryDate.toISOString(),
      customerId: r.customerId,
      customerName: r.customerId != null ? custMap.get(r.customerId) ?? null : null,
      partnerId: r.partnerId,
      partnerName: r.partnerId != null ? partMap.get(r.partnerId) ?? null : null,
      payerUserId: r.payerUserId,
      payerUserName: r.payerUserId != null ? userNames.get(r.payerUserId) ?? null : null,
      receiverUserId: r.receiverUserId,
      receiverUserName: r.receiverUserId != null ? userNames.get(r.receiverUserId) ?? null : null,
      note: r.note,
      status: r.status,
      cancelReason: r.cancelReason,
      cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
      createdBy: r.createdBy,
      createdByName: r.createdBy != null ? userNames.get(r.createdBy) ?? null : null,
      createdAt: r.createdAt.toISOString()
    };
  });
}

/** Tổng THU/CHI (POSTED) từ danh sách DTO. */
function summarize(dtos: CashEntryDto[]): CashflowSummary {
  let totalThu = 0, totalChi = 0, count = 0;
  for (const d of dtos) {
    if (d.status !== 'POSTED') continue;
    count++;
    if (d.kind === 'THU') totalThu += d.amount; else totalChi += d.amount;
  }
  return { count, totalThu, totalChi, net: totalThu - totalChi };
}

/** CASHENTRY_VIEW — liệt kê phiếu thu/chi (mọi trạng thái, loại đã xóa mềm) + tổng THU/CHI (POSTED). */
export async function listCashEntries(filter: CashEntryFilter = {}): Promise<CashflowReportResult> {
  const g = await requirePermission('CASHENTRY_VIEW', { action: 'CASHENTRY_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.cashEntry.findMany({ where: buildWhere(filter), orderBy: [{ entryDate: 'desc' }, { id: 'desc' }] });
  const data = await toDtos(g.db, rows);
  return { ok: true, data, summary: summarize(data) };
}

/** CASHENTRY_VIEW — báo cáo dòng tiền (§F): CHỈ phiếu POSTED trong khoảng ngày + danh mục/quỹ/đối tượng. */
export async function cashflowReport(filter: CashEntryFilter = {}): Promise<CashflowReportResult> {
  const g = await requirePermission('CASHENTRY_VIEW', { action: 'CASHENTRY_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.cashEntry.findMany({ where: { ...buildWhere(filter), status: 'POSTED' }, orderBy: [{ entryDate: 'asc' }, { id: 'asc' }] });
  const data = await toDtos(g.db, rows);
  return { ok: true, data, summary: summarize(data) };
}

/** CASHENTRY_VIEW — danh mục thu/chi gọn (active) để chọn khi lập phiếu (không cần quyền CASHCAT_*). */
export async function listEntryCategoriesLite(): Promise<{ ok: boolean; data?: { id: number; kind: string; name: string; sourceKind: string; affectsPnl: boolean }[]; error?: string; message?: string }> {
  const g = await requirePermission('CASHENTRY_VIEW', { action: 'CASHENTRY_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.cashCategory.findMany({ where: { deletedAt: null, active: true }, select: { id: true, kind: true, name: true, sourceKind: true, affectsPnl: true }, orderBy: [{ kind: 'asc' }, { id: 'asc' }] });
  return { ok: true, data: rows };
}

/** CASHENTRY_CREATE — lập phiếu thu/chi (POSTED thẳng). Mã PT/PC atomic trong $transaction. */
export async function createCashEntry(input: CreateCashEntryInput): Promise<MutationResult> {
  const g = await requirePermission('CASHENTRY_CREATE', { action: 'CASH_ENTRY_CREATED', targetType: 'CashEntry' });
  if (!g.ok) return g;
  const { db, user } = g;

  const kind = (input.kind ?? '').trim().toUpperCase();
  if (!KINDS.has(kind)) return { ok: false, error: 'VALIDATION', message: 'Loại phiếu phải là THU hoặc CHI.' };

  const amount = parseAmount(input.amount);
  if (amount === null) return { ok: false, error: 'VALIDATION', message: 'Số tiền phải là số nguyên dương (VND).' };

  const method = (input.method ?? '').trim().toUpperCase();
  if (!METHODS.has(method)) return { ok: false, error: 'VALIDATION', message: 'Hình thức phải là Chuyển khoản (CK) hoặc Tiền mặt (CASH).' };

  const entryDate = parseLocalDate(input.entryDate);
  if (!entryDate) return { ok: false, error: 'VALIDATION', message: 'Ngày thu/chi không hợp lệ.' };

  // Quỹ phải tồn tại + chưa xóa.
  const fund = await db.fund.findUnique({ where: { id: input.fundId }, select: { id: true, deletedAt: true } });
  if (!fund || fund.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Quỹ không hợp lệ.' };

  // Danh mục: tồn tại + chưa xóa + active + CÙNG kind + KHÔNG phải công nợ (H2-core).
  const cat = await db.cashCategory.findUnique({ where: { id: input.categoryId }, select: { id: true, kind: true, active: true, deletedAt: true, sourceKind: true } });
  if (!cat || cat.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Danh mục không hợp lệ.' };
  if (!cat.active) return { ok: false, error: 'VALIDATION', message: 'Danh mục đã ngừng dùng, không lập phiếu được.' };
  if (cat.kind !== kind) return { ok: false, error: 'VALIDATION', message: `Danh mục thuộc nhóm ${cat.kind === 'THU' ? 'thu' : 'chi'}, không dùng cho phiếu ${kind === 'THU' ? 'thu' : 'chi'}.` };
  if (DEBT_SOURCE.has(cat.sourceKind)) {
    return { ok: false, error: 'DEBT_RECEIPT_DEFERRED', message: 'Thu công nợ dùng chức năng Thu công nợ (pha sau), không lập phiếu thu thường ở đây.' };
  }

  // Người chi bắt buộc khi kind=CHI (I#3).
  if (kind === 'CHI' && input.payerUserId == null) {
    return { ok: false, error: 'PAYER_REQUIRED', message: 'Phiếu chi bắt buộc chọn người chi.' };
  }

  // Validate các tham chiếu tùy chọn nếu có (chống mồ côi).
  for (const [uid, label] of [[input.payerUserId, 'Người chi'], [input.receiverUserId, 'Người nhận']] as [number | null | undefined, string][]) {
    if (uid != null) {
      const u = await db.user.findUnique({ where: { id: uid }, select: { id: true, deletedAt: true } });
      if (!u || u.deletedAt) return { ok: false, error: 'VALIDATION', message: `${label} không hợp lệ.` };
    }
  }
  if (input.customerId != null) {
    const c = await db.customer.findUnique({ where: { id: input.customerId }, select: { id: true, deletedAt: true } });
    if (!c || c.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Khách hàng không hợp lệ.' };
  }
  if (input.partnerId != null) {
    const p = await db.partner.findUnique({ where: { id: input.partnerId }, select: { id: true, deletedAt: true } });
    if (!p || p.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Đối tác không hợp lệ.' };
  }

  const prefix = kind === 'THU' ? 'PT' : 'PC';
  const created = await db.$transaction(async (tx) => {
    const code = await nextCode(prefix, tx);
    return tx.cashEntry.create({
      data: {
        code,
        kind,
        categoryId: input.categoryId,
        fundId: input.fundId,
        amount,
        method,
        entryDate,
        customerId: input.customerId ?? null,
        partnerId: input.partnerId ?? null,
        payerUserId: input.payerUserId ?? null,
        receiverUserId: input.receiverUserId ?? null,
        note: input.note?.trim() || null,
        status: 'POSTED',
        createdBy: user.id
      }
    });
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'CASH_ENTRY_CREATED',
    targetType: 'CashEntry',
    targetId: String(created.id),
    after: auditSnapshot({ code: created.code, kind, categoryId: input.categoryId, fundId: input.fundId, amount, method, entryDate: entryDate.toISOString(), status: 'POSTED' })
  });
  return { ok: true, id: created.id };
}

/**
 * CASHENTRY_CANCEL — hủy phiếu (POSTED→CANCELLED) nguyên tử + nhập lại mật khẩu (§14) + lý do.
 * Conditional updateMany trong $transaction (chống hủy 2 lần / race). Từ chối cũng ghi audit.
 */
export async function cancelCashEntry(id: number, reason: string, password: string): Promise<MutationResult> {
  const g = await requirePermission('CASHENTRY_CANCEL', { action: 'CASH_ENTRY_CANCELLED', targetType: 'CashEntry', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const r = (reason ?? '').trim();
  if (!r) return { ok: false, error: 'VALIDATION', message: 'Vui lòng nhập lý do hủy phiếu.' };

  const row = await db.cashEntry.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Phiếu không tồn tại.' };

  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'CASH_ENTRY_CANCELLED', targetType: 'CashEntry', targetId: String(id), after: { denied: true, reason: 'WRONG_PASSWORD' } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }

  const cancelledAt = new Date();
  try {
    await db.$transaction(async (txc) => {
      const moved = await txc.cashEntry.updateMany({
        where: { id, status: 'POSTED', deletedAt: null },
        data: { status: 'CANCELLED', cancelReason: r, cancelledAt, updatedBy: user.id }
      });
      if (moved.count === 0) throw new TxGuardError('INVALID_STATE', 'Chỉ phiếu đang hiệu lực (đã ghi) mới hủy được.');
    });
  } catch (e) {
    if (e instanceof TxGuardError) return { ok: false, error: e.code, message: e.userMessage };
    throw e;
  }
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'CASH_ENTRY_CANCELLED',
    targetType: 'CashEntry',
    targetId: String(id),
    before: auditSnapshot({ code: row.code, kind: row.kind, amount: row.amount, status: row.status }),
    after: auditSnapshot({ status: 'CANCELLED', cancelReason: r })
  });
  return { ok: true, id };
}
