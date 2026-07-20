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
/** sourceKind công nợ — create THƯỜNG CHẶN (DEBT_RECEIPT_DEFERRED); thu công nợ đi qua createDebtReceipt. */
const DEBT_SOURCE = new Set(['DEBT_CUSTOMER', 'DEBT_PARTNER']);
/** Khoản nợ của 1 GD: PARTNER (CL_NCC — chênh đối tác) | SELL (CL_KH — chênh bán). */
const SIDES = new Set(['PARTNER', 'SELL']);
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
  sourceType: string | null; // L-5 (audit 16/7): nguồn sinh phiếu (null=thủ công | SALE_COLLECT | DEVICE_* …) — renderer lọc phiếu hệ thống khỏi hủy/tích-chọn hàng loạt
  fundId: number | null; // H2b: null cho bút toán phi tiền mặt (write-off nợ xấu — không gắn quỹ)
  fundCode: string | null;
  fundName: string | null;
  amount: number;
  method: string; // CK | CASH
  entryDate: string; // ISO
  customerId: number | null;
  customerName: string | null;
  partnerId: number | null;
  partnerName: string | null;
  partnerText: string | null; // "của ai" nhập tay (đối tác lẻ ngoài danh sách)
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
  partnerText?: string | null; // "của ai" nhập tay — loại trừ với partnerId
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

/** 1 dòng tất toán: áp `amount` vào 1 side (PARTNER|SELL) của 1 Transaction (§2.4). */
export interface DebtReceiptLine {
  transactionId: number;
  side: string; // PARTNER | SELL
  amount: number; // VND > 0
}

/** Input Thu công nợ (createDebtReceipt): 1 phiếu THU (category DEBT_*) tất toán ≥1 GD qua các line. */
export interface CreateDebtReceiptInput {
  categoryId: number; // danh mục DEBT_CUSTOMER | DEBT_PARTNER
  fundId: number;
  method: string; // CK | CASH
  entryDate: string; // YYYY-MM-DD (local) hoặc ISO
  customerId?: number | null; // đối tượng thu (KH) — GD phải khớp customerId
  partnerId?: number | null; // đối tượng thu (đối tác của TID) — GD phải khớp partnerId
  note?: string | null;
  docPath?: string | null;
  docName?: string | null;
  lines: DebtReceiptLine[];
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
  const fundIds = [...new Set(rows.map((r) => r.fundId).filter((x): x is number => x != null))];
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
    const fund = r.fundId != null ? fundMap.get(r.fundId) : undefined;
    return {
      id: r.id,
      code: r.code,
      kind: r.kind,
      categoryId: r.categoryId,
      categoryName: cat?.name ?? null,
      sourceKind: cat?.sourceKind ?? null,
      sourceType: r.sourceType, // audit 15/7 — renderer lọc phiếu hệ thống khỏi hủy/tích-chọn hàng loạt
      fundId: r.fundId,
      fundCode: fund?.code ?? null,
      fundName: fund?.name ?? null,
      amount: Number(r.amount),
      method: r.method,
      entryDate: r.entryDate.toISOString(),
      customerId: r.customerId,
      customerName: r.customerId != null ? custMap.get(r.customerId) ?? null : null,
      partnerId: r.partnerId,
      partnerName: r.partnerId != null ? partMap.get(r.partnerId) ?? null : null,
      partnerText: r.partnerText,
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

/**
 * Tổng THU/CHI (POSTED) từ danh sách DTO — DÒNG TIỀN thực vào/ra quỹ.
 * FIX 3 — LOẠI bút toán PHI TIỀN MẶT (fundId=null, vd write-off nợ xấu sourceType=BAD_DEBT): không đồng
 * nào rời quỹ nên KHÔNG được cộng vào totalChi (nếu cộng → net dòng tiền lệch số dư quỹ). Đây là phòng vệ
 * chung (kể cả listCashEntries hiển thị nguyên bút toán vẫn có summary dòng tiền đúng). KHÔNG ảnh hưởng
 * getMonthlyProfit (accrual) — hàm đó tính riêng theo affectsPnl, không qua summarize.
 */
function summarize(dtos: CashEntryDto[]): CashflowSummary {
  let totalThu = 0, totalChi = 0, count = 0;
  for (const d of dtos) {
    if (d.status !== 'POSTED') continue;
    if (d.fundId == null) continue; // phi tiền mặt — không tính vào dòng tiền
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

/**
 * CASHENTRY_VIEW — báo cáo dòng tiền (§F): CHỈ phiếu POSTED trong khoảng ngày + danh mục/quỹ/đối tượng.
 * FIX 3 — LOẠI bút toán PHI TIỀN MẶT (fundId=null, vd ghi giảm nợ xấu): báo cáo DÒNG TIỀN = tiền THỰC
 * vào/ra quỹ, write-off không chuyển tiền quỹ nào. Nếu người dùng lọc theo 1 quỹ cụ thể (filter.fundId)
 * thì where.fundId đã là số ⇒ đương nhiên loại phi-tiền-mặt; nếu không lọc quỹ, ép fundId ≠ null.
 * Chi phí nợ xấu vẫn vào lợi nhuận qua getMonthlyProfit (accrual, không dùng report này).
 */
export async function cashflowReport(filter: CashEntryFilter = {}): Promise<CashflowReportResult> {
  const g = await requirePermission('CASHENTRY_VIEW', { action: 'CASHENTRY_VIEW' });
  if (!g.ok) return g;
  const where: Record<string, unknown> = { ...buildWhere(filter), status: 'POSTED' };
  if (where['fundId'] == null) where['fundId'] = { not: null };
  const rows = await g.db.cashEntry.findMany({ where, orderBy: [{ entryDate: 'asc' }, { id: 'asc' }] });
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

/**
 * CASHENTRY_VIEW — danh sách đối tác gọn (id + tên) để chọn "của ai" khi lập phiếu, KHÔNG cần quyền nặng
 * CONFIG_BANK_VIEW (listPartners). Chỉ đối tác chưa xóa; sắp theo tên cho dễ tìm (tránh phiếu mồ côi quyền).
 */
export async function listPartnersLite(): Promise<{ ok: boolean; data?: { id: number; name: string }[]; error?: string; message?: string }> {
  const g = await requirePermission('CASHENTRY_VIEW', { action: 'CASHENTRY_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.partner.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  return { ok: true, data: rows };
}

/** CASHENTRY_CREATE — lập phiếu thu/chi (POSTED thẳng). Mã PT/PC atomic trong $transaction. */
export async function createCashEntry(input: CreateCashEntryInput): Promise<MutationResult> {
  const g = await requirePermission('CASHENTRY_CREATE', { action: 'CASH_ENTRY_CREATED', targetType: 'CashEntry' });
  if (!g.ok) return g;
  const { db, user } = g;

  // FIX 5 — chốt quỹ tường minh (thay vì dựa side-effect findUnique(null) → NOT_FOUND khó hiểu). Bút toán
  // phi tiền mặt (fundId=null) CHỈ do hệ thống sinh (write-off), KHÔNG qua API tạo phiếu này.
  if (input.fundId == null) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn quỹ.' };

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

  // "Của ai" (mục D): chọn từ danh sách đối tác (partnerId) HOẶC gõ tay (partnerText) — LOẠI TRỪ nhau
  // (không cho vừa chọn vừa gõ → tránh 2 nguồn tên mâu thuẫn). Bỏ trống cả hai = none (mặc định).
  const partnerText = input.partnerText?.trim() || null;
  if (input.partnerId != null && partnerText) {
    return { ok: false, error: 'PARTNER_SOURCE_CONFLICT', message: 'Chỉ chọn đối tác từ danh sách HOẶC nhập tay, không dùng cả hai.' };
  }

  const prefix = kind === 'THU' ? 'PT' : 'PC';
  const created = await db.$transaction(async (tx) => {
    const code = await nextCode(prefix, tx);
    const c = await tx.cashEntry.create({
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
        partnerText,
        payerUserId: input.payerUserId ?? null,
        receiverUserId: input.receiverUserId ?? null,
        note: input.note?.trim() || null,
        status: 'POSTED',
        createdBy: user.id
      }
    });
    // R48 Pha 3 — audit TRONG transaction (tiền + log atomic).
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'CASH_ENTRY_CREATED',
      targetType: 'CashEntry',
      targetId: String(c.id),
      after: auditSnapshot({ code: c.code, kind, categoryId: input.categoryId, fundId: input.fundId, amount, method, entryDate: entryDate.toISOString(), status: 'POSTED' })
    });
    return c;
  });
  return { ok: true, id: created.id };
}

/**
 * CASHENTRY_CREATE — Thu công nợ (H2-debt §2.4): 1 phiếu THU (category DEBT_*) TẤT TOÁN ≥1 Transaction
 * qua các CashDebtSettlement, theo NET-OF-SETTLEMENT (I#2). Trong 1 $transaction:
 *  • mỗi line: amount ≤ nợ CÒN LẠI net của (GD, side) = revenue(side) − Σ settle(side) đã có → vượt = DEBT_OVERPAY (rollback);
 *  • GD tồn tại, chưa xóa, status ≠ CANCELLED, khớp đối tượng (customerId/partnerId);
 *  • tạo CashEntry (sourceType=null) + N dòng settlement; tổng line = amount phiếu;
 *  • HỆ QUẢ: GD nào cả 2 side net=0 → settled=true (KHÔNG toggle tay — H5).
 * Audit CASH_DEBT_RECEIPT_CREATED (+ PERMISSION_DENIED ở guard). Doanh thu KHÔNG double-count:
 * category DEBT_* affectsPnl=false (đã có trong Transaction.revenueAmount accrual).
 */
export async function createDebtReceipt(input: CreateDebtReceiptInput): Promise<MutationResult> {
  const g = await requirePermission('CASHENTRY_CREATE', { action: 'CASH_DEBT_RECEIPT_CREATED', targetType: 'CashEntry' });
  if (!g.ok) return g;
  const { db, user } = g;

  // FIX 5 — chốt quỹ tường minh (thu công nợ luôn phải vào 1 quỹ; fundId=null chỉ dành bút toán hệ thống).
  if (input.fundId == null) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn quỹ.' };

  const method = (input.method ?? '').trim().toUpperCase();
  if (!METHODS.has(method)) return { ok: false, error: 'VALIDATION', message: 'Hình thức phải là Chuyển khoản (CK) hoặc Tiền mặt (CASH).' };

  const entryDate = parseLocalDate(input.entryDate);
  if (!entryDate) return { ok: false, error: 'VALIDATION', message: 'Ngày thu không hợp lệ.' };

  // Quỹ hợp lệ.
  const fund = await db.fund.findUnique({ where: { id: input.fundId }, select: { id: true, deletedAt: true } });
  if (!fund || fund.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Quỹ không hợp lệ.' };

  // Danh mục: THU + DEBT_* + active + chưa xóa (thu công nợ CHỈ dùng danh mục công nợ).
  const cat = await db.cashCategory.findUnique({ where: { id: input.categoryId }, select: { id: true, kind: true, active: true, deletedAt: true, sourceKind: true } });
  if (!cat || cat.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Danh mục không hợp lệ.' };
  if (!cat.active) return { ok: false, error: 'VALIDATION', message: 'Danh mục đã ngừng dùng, không lập phiếu được.' };
  if (cat.kind !== 'THU' || !DEBT_SOURCE.has(cat.sourceKind)) {
    return { ok: false, error: 'VALIDATION', message: 'Thu công nợ phải dùng danh mục Công nợ (khách hàng / đối tác).' };
  }

  // Đối tượng: cần ≥1 chiều (KH hoặc đối tác) để ràng buộc GD.
  if (input.customerId == null && input.partnerId == null) {
    return { ok: false, error: 'VALIDATION', message: 'Chọn đối tượng thu (khách hàng hoặc đối tác).' };
  }
  // FIX 3 — RÀNG side ↔ danh mục ↔ đối tượng: DEBT_CUSTOMER ⇒ side SELL + có KH; DEBT_PARTNER ⇒ side
  // PARTNER + có đối tác. Chống dùng danh mục lệch (net đúng nhưng nhãn dòng tiền sai). Đối tượng khớp
  // danh mục để settlement luôn đi đúng side (kiểm side từng line ở vòng dưới).
  if (cat.sourceKind === 'DEBT_CUSTOMER' && input.customerId == null) {
    return { ok: false, error: 'DEBT_SIDE_CATEGORY_MISMATCH', message: 'Thu công nợ theo danh mục Công nợ khách hàng cần chọn khách hàng.' };
  }
  if (cat.sourceKind === 'DEBT_PARTNER' && input.partnerId == null) {
    return { ok: false, error: 'DEBT_SIDE_CATEGORY_MISMATCH', message: 'Thu công nợ theo danh mục Công nợ đối tác cần chọn đối tác.' };
  }
  if (input.customerId != null) {
    const c = await db.customer.findUnique({ where: { id: input.customerId }, select: { id: true, deletedAt: true } });
    if (!c || c.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Khách hàng không hợp lệ.' };
  }
  if (input.partnerId != null) {
    const p = await db.partner.findUnique({ where: { id: input.partnerId }, select: { id: true, deletedAt: true } });
    if (!p || p.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Đối tác không hợp lệ.' };
  }

  // Lines: không rỗng, side hợp lệ, amount nguyên > 0; gộp amount mới theo (GD, side).
  const lines = input.lines ?? [];
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa nhập khoản thu nào.' };
  const addBySide = new Map<string, number>(); // `${txnId}:${side}` → Σ amount mới
  // FIX 3 — side hợp lệ theo danh mục: DEBT_CUSTOMER ⇒ chỉ SELL; DEBT_PARTNER ⇒ chỉ PARTNER.
  const wantSide = cat.sourceKind === 'DEBT_CUSTOMER' ? 'SELL' : 'PARTNER';
  let total = 0;
  for (const ln of lines) {
    const side = (ln.side ?? '').trim().toUpperCase();
    if (!SIDES.has(side)) return { ok: false, error: 'VALIDATION', message: 'Khoản nợ phải là đối tác (PARTNER) hoặc khách/bán (SELL).' };
    if (side !== wantSide) {
      return { ok: false, error: 'DEBT_SIDE_CATEGORY_MISMATCH', message: `Danh mục ${cat.sourceKind === 'DEBT_CUSTOMER' ? 'Công nợ khách hàng' : 'Công nợ đối tác'} chỉ tất toán khoản ${wantSide === 'SELL' ? 'khách/bán (SELL)' : 'đối tác (PARTNER)'}, không dùng cho khoản ${side === 'SELL' ? 'khách/bán' : 'đối tác'}.` };
    }
    const amt = parseAmount(ln.amount);
    if (amt === null) return { ok: false, error: 'VALIDATION', message: 'Số tiền thu mỗi khoản phải là số nguyên dương (VND).' };
    if (!Number.isInteger(ln.transactionId) || ln.transactionId <= 0) return { ok: false, error: 'VALIDATION', message: 'Giao dịch không hợp lệ.' };
    const key = `${ln.transactionId}:${side}`;
    addBySide.set(key, (addBySide.get(key) ?? 0) + amt);
    total += amt;
  }
  if (total <= 0 || total > AMOUNT_MAX) return { ok: false, error: 'VALIDATION', message: 'Tổng tiền thu không hợp lệ.' };
  const txnIds = [...new Set(lines.map((l) => l.transactionId))];
  // FIX 1 — khóa GD cha theo id TĂNG DẦN (thứ tự nhất quán → chống deadlock chéo).
  const lockIds = [...txnIds].sort((a, b) => a - b);

  let created;
  try {
    created = await db.$transaction(async (tx) => {
      // ── FIX 1 (TOCTOU race) — KHÓA HÀNG Transaction cha TRƯỚC khi đọc settlement/tính remaining.
      // $transaction mặc định READ COMMITTED: 2 phiếu thu SONG SONG cùng (GD, side) đọc cùng `remaining`
      // cũ → cùng qua check → thu VƯỢT nợ (quỹ +2×, over-settlement). SELECT ... FOR UPDATE trên hàng
      // `transactions` giữ khóa tới khi phiếu 1 COMMIT; phiếu 2 BLOCK tại đây → khi resume, groupBy dưới
      // (statement mới, READ COMMITTED) đọc settlement ĐÃ COMMIT của phiếu 1 → remaining mới → DEBT_OVERPAY.
      const lockPlaceholders = lockIds.map((_, i) => `$${i + 1}`).join(', ');
      await tx.$queryRawUnsafe(`SELECT id FROM transactions WHERE id IN (${lockPlaceholders}) FOR UPDATE`, ...lockIds);

      // FIX 4 — batch đọc GD + tid (1 query mỗi loại, KHÔNG N+1 findUnique trong vòng lặp).
      const txnRows = await tx.transaction.findMany({
        where: { id: { in: txnIds } },
        select: { id: true, revenuePartner: true, revenueSell: true, customerId: true, tidId: true, status: true, deletedAt: true, settled: true, writtenOffAt: true }
      });
      const txnMap = new Map(txnRows.map((t) => [t.id, t]));
      let tidPartnerMap = new Map<number, number | null>();
      if (input.partnerId != null) {
        const tidIds = [...new Set(txnRows.map((t) => t.tidId))];
        const tidRows = await tx.tid.findMany({ where: { id: { in: tidIds } }, select: { id: true, partnerId: true } });
        tidPartnerMap = new Map(tidRows.map((t) => [t.id, t.partnerId]));
      }
      // Σ settlement ĐÃ CÓ theo (GD, side) — batch 1 groupBy (đọc SAU khi đã khóa hàng cha).
      const prevAgg = await tx.cashDebtSettlement.groupBy({ by: ['transactionId', 'side'], where: { transactionId: { in: txnIds } }, _sum: { amount: true } });
      const paidBySide = new Map<string, number>();
      for (const p of prevAgg) paidBySide.set(`${p.transactionId}:${p.side}`, Number(p._sum.amount ?? 0));

      // Kiểm + tính net cho TỪNG GD (đọc trong tx + đã khóa → chống race I#2).
      for (const txnId of txnIds) {
        const t = txnMap.get(txnId);
        if (!t || t.deletedAt) throw new TxGuardError('TXN_INVALID', `Giao dịch #${txnId} không tồn tại.`);
        if (t.status === 'CANCELLED') throw new TxGuardError('TXN_INVALID', `Giao dịch #${txnId} đã hủy, không thu công nợ được.`);
        // FIX 2 — GD đã ghi giảm nợ xấu (write-off) KHÔNG còn là công nợ → cấm thu (nếu không sẽ vừa ghi
        // giảm lợi nhuận vừa thu tiền vào quỹ cùng 1 khoản). Khóa FOR UPDATE ở trên đảm bảo thấy writtenOffAt
        // ĐÃ COMMIT của write-off song song → chống race cả 2 chiều (mẫu FIX 1).
        if (t.writtenOffAt != null) throw new TxGuardError('TXN_WRITTEN_OFF', `Giao dịch #${txnId} đã ghi giảm nợ xấu — không thu công nợ.`);
        // Khớp đối tượng.
        if (input.customerId != null && t.customerId !== input.customerId) throw new TxGuardError('TXN_OBJECT_MISMATCH', `Giao dịch #${txnId} không thuộc khách hàng đã chọn.`);
        if (input.partnerId != null) {
          const tp = tidPartnerMap.get(t.tidId);
          if (tp == null || tp !== input.partnerId) throw new TxGuardError('TXN_OBJECT_MISMATCH', `Giao dịch #${txnId} không thuộc đối tác đã chọn.`);
        }
        const revBySide: Record<string, number> = { PARTNER: Number(t.revenuePartner), SELL: Number(t.revenueSell) };
        for (const side of ['PARTNER', 'SELL']) {
          const adding = addBySide.get(`${txnId}:${side}`) ?? 0;
          if (adding <= 0) continue;
          const remaining = revBySide[side] - (paidBySide.get(`${txnId}:${side}`) ?? 0);
          if (adding > remaining) {
            const label = side === 'PARTNER' ? 'đối tác' : 'khách/bán';
            throw new TxGuardError('DEBT_OVERPAY', `Số thu khoản ${label} của GD #${txnId} vượt công nợ còn lại (còn ${Math.max(0, remaining)} đ).`);
          }
        }
      }

      // Tạo phiếu thu (PT) + các dòng settlement.
      const code = await nextCode('PT', tx);
      const entry = await tx.cashEntry.create({
        data: {
          code, kind: 'THU', categoryId: input.categoryId, fundId: input.fundId, amount: total, method, entryDate,
          customerId: input.customerId ?? null, partnerId: input.partnerId ?? null,
          docPath: input.docPath?.trim() || null, docName: input.docName?.trim() || null,
          sourceType: null, note: input.note?.trim() || null, status: 'POSTED', createdBy: user.id
        }
      });
      for (const ln of lines) {
        await tx.cashDebtSettlement.create({ data: { cashEntryId: entry.id, transactionId: ln.transactionId, side: (ln.side ?? '').trim().toUpperCase(), amount: parseAmount(ln.amount)! } });
      }

      // HỆ QUẢ: GD nào cả 2 side net=0 → settled=true; chưa đủ → settled=false. Batch 1 groupBy sau insert.
      const postAgg = await tx.cashDebtSettlement.groupBy({ by: ['transactionId', 'side'], where: { transactionId: { in: txnIds } }, _sum: { amount: true } });
      const paidPost = new Map<string, number>();
      for (const a of postAgg) paidPost.set(`${a.transactionId}:${a.side}`, Number(a._sum.amount ?? 0));
      for (const txnId of txnIds) {
        const t = txnMap.get(txnId);
        if (!t) continue;
        const remainingPartner = Number(t.revenuePartner) - (paidPost.get(`${txnId}:PARTNER`) ?? 0);
        const remainingSell = Number(t.revenueSell) - (paidPost.get(`${txnId}:SELL`) ?? 0);
        const fullySettled = remainingPartner <= 0 && remainingSell <= 0;
        if (fullySettled !== t.settled) {
          await tx.transaction.update({ where: { id: txnId }, data: { settled: fullySettled, settledAt: fullySettled ? new Date() : null, updatedBy: user.id } });
        }
      }
      // R48 Pha 3 — audit TRONG transaction (phiếu thu công nợ + đối soát + log atomic).
      await writeAudit(tx, {
        actorUserId: user.id,
        action: 'CASH_DEBT_RECEIPT_CREATED',
        targetType: 'CashEntry',
        targetId: String(entry.id),
        after: auditSnapshot({ code: entry.code, amount: total, categoryId: input.categoryId, fundId: input.fundId, method, entryDate: entryDate.toISOString(), customerId: input.customerId ?? null, partnerId: input.partnerId ?? null, lines: lines.length, transactions: txnIds })
      });
      return entry;
    });
  } catch (e) {
    if (e instanceof TxGuardError) return { ok: false, error: e.code, message: e.userMessage };
    throw e;
  }
  return { ok: true, id: created.id };
}

/**
 * CASHENTRY_CANCEL — hủy phiếu (POSTED→CANCELLED) nguyên tử + nhập lại mật khẩu (§14) + lý do.
 * Conditional updateMany trong $transaction (chống hủy 2 lần / race). Từ chối cũng ghi audit.
 * M3 — nếu là phiếu THU công nợ (có CashDebtSettlement): trong CÙNG $transaction xóa các dòng
 * settlement + TÍNH LẠI settled của các GD liên quan (nợ còn lại > 0 → settled=false).
 */
export async function cancelCashEntry(id: number, reason: string, password: string): Promise<MutationResult> {
  const g = await requirePermission('CASHENTRY_CANCEL', { action: 'CASH_ENTRY_CANCELLED', targetType: 'CashEntry', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const r = (reason ?? '').trim();
  if (!r) return { ok: false, error: 'VALIDATION', message: 'Vui lòng nhập lý do hủy phiếu.' };

  const row = await db.cashEntry.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Phiếu không tồn tại.' };

  // P1 (audit 15/7) — CHỈ phiếu thủ công (sourceType=null: THU/CHI tay + thu công nợ) và thu tiền bán
  // máy (SALE_COLLECT) mới hủy TRỰC TIẾP được — hai loại này có đường hoàn đối soát (M3/M3b) bên dưới.
  // Phiếu hệ thống khác (DEVICE_DEPOSIT cọc/hoàn cọc, RENT thuê, BAD_DEBT ghi giảm nợ xấu, SALE_POS/
  // SALE_TID doanh thu bán máy) hủy tại đây sẽ làm quỹ lệch tiền thật + mồ côi bản ghi cọc/nợ/bán máy.
  // Phải hủy ở nghiệp vụ gốc (thu hồi máy / hủy hóa đơn / v.v.). Ghi audit cho lần bị chặn.
  if (row.sourceType !== null && row.sourceType !== 'SALE_COLLECT') {
    await writeAudit(db, { actorUserId: user.id, action: 'CASH_ENTRY_CANCELLED', targetType: 'CashEntry', targetId: String(id), after: { denied: true, reason: 'SOURCE_LOCKED', sourceType: row.sourceType } });
    return { ok: false, error: 'SOURCE_LOCKED', message: 'Phiếu này sinh tự động từ nghiệp vụ khác (cọc/thuê/bán máy/ghi giảm nợ xấu). Hãy hủy ở nghiệp vụ gốc, không hủy trực tiếp tại đây.' };
  }

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

      // M3 — phiếu THU công nợ: gỡ các dòng settlement + TÍNH LẠI settled của GD liên quan (net > 0
      // → settled=false). Chỉ chạy khi hủy THÀNH CÔNG (moved.count===1) nên chống hủy 2 lần (lần 2
      // đã CANCELLED → moved.count===0 → throw trước khi tới đây, settlement không bị gỡ lần nữa).
      const settlements = await txc.cashDebtSettlement.findMany({ where: { cashEntryId: id }, select: { transactionId: true } });
      if (settlements.length > 0) {
        const affected = [...new Set(settlements.map((s) => s.transactionId))];
        // FIX 2 — GD đã ghi giảm nợ xấu (write-off) là ĐÃ ĐÓNG: số write-off = net TẠI thời điểm ghi giảm
        // (revenue − Σ settlement lúc đó). Nếu cho hủy phiếu thu này → xóa 1 settlement từng nằm trong net
        // đó → write-off bị hụt số (nợ xấu ghi giảm ít hơn thực). HÀNH VI: CHẶN hủy — GD written-off KHÔNG
        // bị settle lại. (createDebtReceipt đã cấm tạo settlement mới trên GD write-off nên settlement này
        // chắc chắn tạo TRƯỚC write-off.)
        const woRows = await txc.transaction.findMany({ where: { id: { in: affected }, writtenOffAt: { not: null } }, select: { id: true } });
        if (woRows.length > 0) {
          throw new TxGuardError('TXN_WRITTEN_OFF', `Không thể hủy: phiếu thu này tất toán giao dịch đã ghi giảm nợ xấu (GD #${woRows.map((r) => r.id).join(', #')}).`);
        }
        await txc.cashDebtSettlement.deleteMany({ where: { cashEntryId: id } });
        for (const txnId of affected) {
          const t = await txc.transaction.findUnique({ where: { id: txnId }, select: { revenuePartner: true, revenueSell: true, settled: true } });
          if (!t) continue;
          const agg = await txc.cashDebtSettlement.groupBy({ by: ['side'], where: { transactionId: txnId }, _sum: { amount: true } });
          const paid = new Map<string, number>();
          for (const a of agg) paid.set(a.side, Number(a._sum.amount ?? 0));
          const fullySettled = Number(t.revenuePartner) - (paid.get('PARTNER') ?? 0) <= 0 && Number(t.revenueSell) - (paid.get('SELL') ?? 0) <= 0;
          if (fullySettled !== t.settled) {
            await txc.transaction.update({ where: { id: txnId }, data: { settled: fullySettled, settledAt: fullySettled ? new Date() : null, updatedBy: user.id } });
          }
        }
      }
      // M3b — phiếu THU tiền BÁN THIẾT BỊ (SALE_COLLECT): gỡ dòng deviceSaleSettlement. Nếu KHÔNG gỡ →
      // hủy phiếu làm quỹ giảm nhưng công nợ mua thiết bị vẫn bị trừ (remaining kẹt) → chặn thu lại
      // (ALREADY_SETTLED) + báo cáo công nợ thiếu số. Remaining của DeviceSale tính LIVE từ Σ settlement
      // (không có cờ settled) nên chỉ cần xóa dòng; chỉ phiếu SALE_COLLECT mới có deviceSaleSettlement.cashEntryId
      // trỏ về nên deleteMany an toàn cho mọi loại phiếu. Chạy sau moved.count===1 → chống hủy 2 lần.
      await txc.deviceSaleSettlement.deleteMany({ where: { cashEntryId: id } });
      // R48 Pha 3 — audit TRONG transaction (hủy phiếu + hoàn đối soát + log atomic).
      await writeAudit(txc, {
        actorUserId: user.id,
        action: 'CASH_ENTRY_CANCELLED',
        targetType: 'CashEntry',
        targetId: String(id),
        before: auditSnapshot({ code: row.code, kind: row.kind, amount: row.amount, status: row.status }),
        after: auditSnapshot({ status: 'CANCELLED', cancelReason: r })
      });
    });
  } catch (e) {
    if (e instanceof TxGuardError) return { ok: false, error: e.code, message: e.userMessage };
    throw e;
  }
  return { ok: true, id };
}
