// Doanh thu & Công nợ (Nhóm B, main). Mỗi giao dịch = 1 lần quẹt/rút qua 1 TID cho 1 khách.
// LEAD 9/7: doanh thu BÓC 2 khoản chênh rồi CỘNG GỘP:
//   • CL_NCC (chênh đối tác) = phiMua − phiCaiMay  → khoản đối soát/thu từ đối tác
//   • CL_KH  (chênh bán)     = phiBan − phiCaiMay  → khoản thu từ khách
//   Doanh thu = số tiền × (CL_NCC% + CL_KH%). CẢ 2 khoản = CÔNG NỢ thu về (đối tác + khách).
// Biểu phí tra theo (Đối tác của TID × Loại thẻ) → snapshot vào giao dịch (×1000) để phí đổi
// về sau KHÔNG làm sai doanh thu đã ghi. Permission-guarded, audited, soft-delete → thùng rác.
import { auditSnapshot, computeRevenue, pickEffectiveRate } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { nextCode } from './code-service.js';

const VIEW = 'REVENUE_VIEW';
const MANAGE = 'REVENUE_MANAGE';
const DEBT_VIEW = 'DEBT_VIEW';
// H5: DEBT_SETTLE (toggle tay) đã vô hiệu — settled chỉ đổi qua phiếu Thu công nợ.
// H2b — phân loại chất lượng công nợ + ghi giảm nợ xấu.
const DEBT_CLASSIFY = 'DEBT_CLASSIFY';
const DEBT_WRITEOFF = 'DEBT_WRITEOFF';
/** 3 mức chất lượng công nợ: GOOD Dễ thu hồi | HARD Khó thu hồi | BAD Không thu hồi. */
const DEBT_QUALITIES = new Set(['GOOD', 'HARD', 'BAD']);

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
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
/** ISO string / Date → Date hợp lệ, hoặc null. */
function parseDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** Số tiền VND: số nguyên ≥ 0. */
function parseAmount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

// ═════════════════════════════════════════════════════════════════════════════
// DTO
// ═════════════════════════════════════════════════════════════════════════════
export interface TransactionDto {
  id: number;
  code: string | null;
  tidId: number;
  tid: string | null;
  mid: string | null;
  hkdName: string | null;
  bankId: number | null;
  bankName: string | null;
  partnerId: number | null;
  partnerName: string | null;
  customerId: number | null;
  customerName: string | null;
  cardTypeId: number | null;
  cardTypeName: string | null;
  amount: number;
  partnerMarginPct: number; // CL_NCC %
  sellMarginPct: number; // CL_KH %
  revenuePartner: number; // VND
  revenueSell: number; // VND
  revenueAmount: number; // VND (tổng)
  settled: boolean;
  settledAt: string | null;
  status: string; // P1.2: POSTED | CANCEL_PENDING | CANCELLED
  txnDate: string;
  note: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
}

export interface TransactionFilter {
  tidId?: number;
  mid?: string; // chứa
  hkdName?: string; // chứa
  partnerId?: number;
  bankId?: number;
  customerId?: number;
  cardTypeId?: number;
  dateFrom?: string;
  dateTo?: string;
  settled?: boolean; // undefined = tất cả
  page?: number; // 1-based
  pageSize?: number;
}

export interface RevenueSummary {
  count: number;
  totalAmount: number; // tổng số tiền giao dịch
  totalRevenuePartner: number; // tổng chênh đối tác
  totalRevenueSell: number; // tổng chênh bán
  totalRevenue: number; // doanh thu = partner + sell
}

export interface DebtSummary {
  count: number; // số giao dịch CÒN NỢ (net > 0)
  debtPartner: number; // công nợ phía đối tác (net)
  debtSell: number; // công nợ phía khách (net)
  debtTotal: number; // tổng công nợ thu về (net)
}

// H2-debt — 1 GD còn nợ (net-of-settlement) để hiển thị DebtPage + chọn khi Thu công nợ.
export interface DebtOpenTxnDto {
  id: number;
  code: string | null;
  txnDate: string;
  tid: string | null;
  mid: string | null;
  hkdName: string | null;
  customerId: number | null;
  customerName: string | null;
  partnerId: number | null; // đối tác của TID (đối tượng nợ side PARTNER)
  partnerName: string | null;
  revenuePartner: number; // tổng chênh đối tác (gốc)
  revenueSell: number; // tổng chênh bán (gốc)
  remainingPartner: number; // còn nợ đối tác = revenuePartner − Σ settle(PARTNER)
  remainingSell: number; // còn nợ khách = revenueSell − Σ settle(SELL)
  settled: boolean;
  debtQuality: string | null; // H2b: GOOD | HARD | BAD | null(chưa phân loại)
}

export interface DebtOpenResult {
  ok: boolean;
  error?: string;
  message?: string;
  data?: DebtOpenTxnDto[];
}

const SCALE = 1000;
const milliToPct = (m: number): number => m / SCALE;

interface ResolvedFee {
  partnerMarginMilli: number;
  sellMarginMilli: number;
  bankId: number | null;
  partnerId: number | null;
}

/**
 * Tra biểu phí cho 1 giao dịch trên (TID × Loại thẻ) tại NGÀY GIAO DỊCH `at` (P1.1):
 *   Đối tác lấy từ TID → các KỲ FeeRate(partnerId, cardTypeId) → chọn kỳ đang hiệu lực tại `at`
 *   bằng pickEffectiveRate → CL_NCC / CL_KH (milli). Trả về margins đã snapshot, hoặc null + lý do.
 */
async function resolveFeeForTxn(
  db: Db,
  tidRow: { id: number; partnerId: number | null; bankId: number | null },
  cardTypeId: number,
  at: Date
): Promise<{ ok: true; fee: ResolvedFee } | { ok: false; error: string; message: string }> {
  if (tidRow.partnerId == null)
    return { ok: false, error: 'NO_PARTNER', message: 'TID này chưa gán Đối tác nên không tra được biểu phí. Hãy cấu hình TID trước.' };
  const card = await db.cardType.findUnique({ where: { id: cardTypeId } });
  if (!card || card.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Loại thẻ không tồn tại.' };
  if (tidRow.bankId != null && card.bankId !== tidRow.bankId)
    return { ok: false, error: 'CARD_BANK_MISMATCH', message: 'Loại thẻ không thuộc ngân hàng của TID này.' };
  // Tất cả KỲ giá còn sống của tổ hợp → chọn kỳ hiệu lực tại ngày GD (không lấy đại kỳ tương lai).
  const rates = await db.feeRate.findMany({ where: { partnerId: tidRow.partnerId, cardTypeId, deletedAt: null } });
  const rate = pickEffectiveRate(rates, at);
  if (!rate)
    return {
      ok: false,
      error: 'NO_FEE_RATE',
      message: 'Chưa có biểu phí hiệu lực tại ngày giao dịch. Hãy cấu hình biểu phí có ngày hiệu lực ≤ ngày GD.'
    };
  // R30: phí bán THỰC TẾ theo TID × thẻ (thỏa thuận khi giao) ưu tiên hơn phí bán NIÊM YẾT (FeeRate.phiBan).
  // Phí cài máy vẫn lấy từ kỳ FeeRate hiệu lực → CL_KH = (phí bán thực tế nếu có, else niêm yết) − phí cài máy.
  // orderBy id desc → xác định (chọn override mới nhất) kể cả nếu lỡ tồn tại >1 dòng active; khớp listTidSellFees.
  const override = await db.tidSellFee.findFirst({ where: { tidId: tidRow.id, cardTypeId, deletedAt: null }, orderBy: { id: 'desc' } });
  const phiBan = override ? override.phiBan : rate.phiBan;
  return {
    ok: true,
    fee: {
      partnerMarginMilli: rate.phiMua - rate.phiCaiMay, // CL_NCC
      sellMarginMilli: phiBan - rate.phiCaiMay, // CL_KH (ưu tiên phí bán thực tế theo TID)
      bankId: tidRow.bankId,
      partnerId: tidRow.partnerId
    }
  };
}

export interface CreateTransactionInput {
  tidId: number;
  cardTypeId: number;
  amount: number;
  txnDate: string; // ISO
  customerId?: number | null; // mặc định lấy theo TID
  note?: string;
}

export async function createTransaction(input: CreateTransactionInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'TRANSACTION_CREATED', targetType: 'Transaction' });
  if (!g.ok) return g;
  const { db, user } = g;

  const amount = parseAmount(input.amount);
  if (amount === null) return { ok: false, error: 'VALIDATION', message: 'Số tiền không hợp lệ (số nguyên ≥ 0).' };
  const txnDate = parseDate(input.txnDate);
  if (!txnDate) return { ok: false, error: 'VALIDATION', message: 'Ngày giao dịch không hợp lệ.' };
  if (!input.cardTypeId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn loại thẻ.' };

  const tid = await db.tid.findUnique({ where: { id: input.tidId } });
  if (!tid || tid.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'TID không tồn tại.' };

  const fee = await resolveFeeForTxn(db, tid, input.cardTypeId, txnDate);
  if (!fee.ok) return fee;

  const rev = computeRevenue(amount, fee.fee.partnerMarginMilli, fee.fee.sellMarginMilli);
  const customerId = input.customerId === undefined ? tid.customerId : input.customerId;

  // R2: khách hàng "Đã khóa"/"Đã hủy" → CHẶN giao dịch mới (vẫn xem được lịch sử).
  // R48: khách hàng ĐÃ XÓA MỀM (deletedAt) cũng phải CHẶN — trước đây guard chỉ chạy khi deletedAt==null nên
  // khách đã hủy qua duyệt vẫn gắn được GD mới → tái xuất hiện thành người nợ. Nay chặn cả 2.
  if (customerId != null) {
    const cust = await db.customer.findUnique({ where: { id: customerId }, select: { status: true, deletedAt: true } });
    if (!cust || cust.deletedAt != null) {
      return { ok: false, error: 'CUSTOMER_INACTIVE', message: 'Khách hàng không tồn tại hoặc đã bị hủy khỏi hệ thống — không thể tạo giao dịch mới.' };
    }
    if (cust.status === 'LOCKED' || cust.status === 'CANCELLED') {
      return { ok: false, error: 'CUSTOMER_INACTIVE', message: `Khách hàng đang ở trạng thái "${cust.status === 'LOCKED' ? 'Đã khóa' : 'Đã hủy'}" — không thể tạo giao dịch mới.` };
    }
  }

  const created = await db.transaction.create({
    data: {
      tidId: tid.id,
      customerId: customerId ?? null,
      cardTypeId: input.cardTypeId,
      amount,
      partnerMarginMilli: fee.fee.partnerMarginMilli,
      sellMarginMilli: fee.fee.sellMarginMilli,
      revenuePartner: rev.revenuePartner,
      revenueSell: rev.revenueSell,
      revenueAmount: rev.revenueAmount,
      txnDate,
      note: input.note?.trim() || null,
      createdBy: user.id
    }
  });
  const code = 'GD' + String(created.id).padStart(5, '0');
  try {
    await db.transaction.update({ where: { id: created.id }, data: { code } });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'TRANSACTION_CREATED',
    targetType: 'Transaction',
    targetId: String(created.id),
    after: auditSnapshot({ code, tidId: tid.id, cardTypeId: input.cardTypeId, amount, revenueAmount: rev.revenueAmount })
  });
  return { ok: true, id: created.id };
}

export interface UpdateTransactionInput {
  cardTypeId?: number;
  amount?: number;
  txnDate?: string;
  customerId?: number | null;
  note?: string;
}

export async function updateTransaction(id: number, _input: UpdateTransactionInput): Promise<MutationResult> {
  // P1.2 — BILL BẤT BIẾN (LEAD 10/7): bill KHÔNG sửa được. Sai thì tạo yêu cầu hủy (requestCancelBill,
  // approval-service) → duyệt Manager/Admin → tạo bill mới. Giữ permission-guard: thao tác trái phép vẫn FORBIDDEN+audit.
  const g = await requirePermission(MANAGE, { action: 'TRANSACTION_UPDATED', targetType: 'Transaction', targetId: String(id) });
  if (!g.ok) return g;
  return { ok: false, error: 'BILL_IMMUTABLE', message: 'Bill bất biến — không sửa được. Hãy tạo yêu cầu hủy rồi tạo bill mới.' };
}

export async function deleteTransactions(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission(MANAGE, { action: 'TRANSACTION_DELETED', targetType: 'Transaction' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn giao dịch để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'TRANSACTION_DELETED', targetType: 'Transaction', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.transaction.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.transaction.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'TRANSACTION_DELETED', targetType: 'Transaction', targetId: String(id), before: auditSnapshot({ code: row.code, amount: row.amount, revenueAmount: row.revenueAmount }) });
    deleted++;
  }
  return { ok: true, deleted };
}

/**
 * H5 — VÔ HIỆU HÓA toggle `settled` thủ công (spec §2.4/§3/§6.1, invariant I#9).
 * `settled` chỉ còn được đổi qua phiếu Thu công nợ (createDebtReceipt) / hủy phiếu thu (cùng
 * $transaction, tính theo net-of-settlement). Hai cơ chế song song (toggle tay + phiếu thu) sẽ mâu
 * thuẫn: toggle tay set settled=true mà KHÔNG có tiền vào quỹ, hoặc đảo ngược net-of-settlement.
 * Giữ chữ ký để không vỡ import cũ; IPC handler `transaction:settle` đã GỠ (không expose renderer).
 */
export async function settleTransactions(_ids: number[], _settled: boolean): Promise<MutationResult & { changed?: number }> {
  return {
    ok: false,
    error: 'DEBT_SETTLE_DISABLED',
    message: 'Đối soát công nợ nay thực hiện qua phiếu Thu công nợ (chọn số tiền thu từng khoản). Không đánh dấu đã thu thủ công.'
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Lọc + đọc
// ═════════════════════════════════════════════════════════════════════════════
/** Dựng where-clause Prisma cho transaction từ filter (đã resolve tidIds nếu cần). */
async function buildWhere(db: Db, filter: TransactionFilter): Promise<Record<string, unknown> | null> {
  const where: Record<string, unknown> = { deletedAt: null };
  // Lọc theo thuộc tính của TID (mid/hkd/partner/bank) → resolve ra danh sách tidId.
  // KHÔNG lọc deletedAt: giao dịch tham chiếu TID theo id; nếu cấu hình TID bị xóa mềm sau này,
  // GD lịch sử vẫn phải lọc/tổng hợp ĐÚNG (nếu không sẽ lệch tổng toàn cục — audit Nhóm B).
  const tidWhere: Record<string, unknown> = {};
  let hasTidFilter = false;
  if (filter.tidId) {
    tidWhere.id = filter.tidId;
    hasTidFilter = true;
  }
  if (filter.mid?.trim()) {
    tidWhere.mid = { contains: filter.mid.trim() };
    hasTidFilter = true;
  }
  if (filter.hkdName?.trim()) {
    tidWhere.hkdName = { contains: filter.hkdName.trim() };
    hasTidFilter = true;
  }
  if (filter.partnerId) {
    tidWhere.partnerId = filter.partnerId;
    hasTidFilter = true;
  }
  if (filter.bankId) {
    tidWhere.bankId = filter.bankId;
    hasTidFilter = true;
  }
  if (hasTidFilter) {
    const tids = await db.tid.findMany({ where: tidWhere, select: { id: true } });
    if (tids.length === 0) return null; // không TID nào khớp → không giao dịch nào
    where.tidId = { in: tids.map((t) => t.id) };
  }
  if (filter.customerId) where.customerId = filter.customerId;
  if (filter.cardTypeId) where.cardTypeId = filter.cardTypeId;
  if (filter.settled !== undefined) where.settled = filter.settled;
  const from = parseDate(filter.dateFrom);
  const to = parseDate(filter.dateTo);
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    where.txnDate = range;
  }
  return where;
}

export interface ListTransactionsResult {
  ok: boolean;
  error?: string;
  message?: string;
  data?: TransactionDto[];
  total?: number; // tổng số dòng khớp (trước phân trang)
  page?: number;
  pageSize?: number;
  summary?: RevenueSummary; // tổng hợp TOÀN BỘ dòng khớp (không chỉ trang hiện tại)
}

export async function listTransactions(filter: TransactionFilter = {}): Promise<ListTransactionsResult> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const db = g.db;
  const where = await buildWhere(db, filter);
  if (where === null) {
    return { ok: true, data: [], total: 0, page: 1, pageSize: filter.pageSize ?? 50, summary: emptySummary() };
  }

  const total = await db.transaction.count({ where });
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, filter.pageSize ?? 50));

  // Summary trên TOÀN BỘ dòng khớp (aggregate ở DB). P1.2: LOẠI bill đã HỦY (status CANCELLED) khỏi
  // tổng doanh thu — bill cancelled vẫn HIỂN THỊ trong danh sách nhưng đóng góp 0 vào tổng.
  const revenueWhere = { ...where, status: { not: 'CANCELLED' } };
  const agg = await db.transaction.aggregate({
    where: revenueWhere,
    _sum: { amount: true, revenuePartner: true, revenueSell: true, revenueAmount: true },
    _count: true
  });
  const summary: RevenueSummary = {
    count: agg._count,
    totalAmount: agg._sum.amount ?? 0,
    totalRevenuePartner: agg._sum.revenuePartner ?? 0,
    totalRevenueSell: agg._sum.revenueSell ?? 0,
    totalRevenue: agg._sum.revenueAmount ?? 0
  };

  const rows = await db.transaction.findMany({
    where,
    orderBy: [{ txnDate: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize
  });

  // Resolve nhãn hiển thị (TID/MID/HKD/NH/đối tác/khách/loại thẻ/người tạo).
  const tidIds = [...new Set(rows.map((r) => r.tidId))];
  const tidMap = new Map(
    (await db.tid.findMany({ where: { id: { in: tidIds } }, select: { id: true, tid: true, mid: true, hkdName: true, bankId: true, partnerId: true } })).map((t) => [t.id, t])
  );
  const bankIds = [...new Set([...tidMap.values()].map((t) => t.bankId).filter((x): x is number => x != null))];
  const partnerIds = [...new Set([...tidMap.values()].map((t) => t.partnerId).filter((x): x is number => x != null))];
  const custIds = [...new Set(rows.map((r) => r.customerId).filter((x): x is number => x != null))];
  const cardIds = [...new Set(rows.map((r) => r.cardTypeId).filter((x): x is number => x != null))];
  const bankMap = new Map((await db.bank.findMany({ where: { id: { in: bankIds } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]));
  const partnerMap = new Map((await db.partner.findMany({ where: { id: { in: partnerIds } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const custMap = new Map((await db.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, fullName: true } })).map((c) => [c.id, c.fullName]));
  const cardMap = new Map((await db.cardType.findMany({ where: { id: { in: cardIds } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const names = await resolveUserNames(db, rows.map((r) => r.createdBy));

  const data: TransactionDto[] = rows.map((r) => {
    const t = tidMap.get(r.tidId);
    return {
      id: r.id,
      code: r.code,
      tidId: r.tidId,
      tid: t?.tid ?? null,
      mid: t?.mid ?? null,
      hkdName: t?.hkdName ?? null,
      bankId: t?.bankId ?? null,
      bankName: t?.bankId != null ? bankMap.get(t.bankId) ?? null : null,
      partnerId: t?.partnerId ?? null,
      partnerName: t?.partnerId != null ? partnerMap.get(t.partnerId) ?? null : null,
      customerId: r.customerId,
      customerName: r.customerId != null ? custMap.get(r.customerId) ?? null : null,
      cardTypeId: r.cardTypeId,
      cardTypeName: r.cardTypeId != null ? cardMap.get(r.cardTypeId) ?? null : null,
      amount: r.amount,
      partnerMarginPct: milliToPct(r.partnerMarginMilli),
      sellMarginPct: milliToPct(r.sellMarginMilli),
      revenuePartner: r.revenuePartner,
      revenueSell: r.revenueSell,
      revenueAmount: r.revenueAmount,
      settled: r.settled,
      settledAt: r.settledAt ? r.settledAt.toISOString() : null,
      status: r.status,
      txnDate: r.txnDate.toISOString(),
      note: r.note,
      createdBy: r.createdBy,
      createdByName: r.createdBy != null ? names.get(r.createdBy) ?? null : null,
      createdAt: r.createdAt.toISOString()
    };
  });
  return { ok: true, data, total, page, pageSize, summary };
}

function emptySummary(): RevenueSummary {
  return { count: 0, totalAmount: 0, totalRevenuePartner: 0, totalRevenueSell: 0, totalRevenue: 0 };
}

/**
 * H4 — Σ số tiền ĐÃ tất toán theo (transactionId, side) từ CashDebtSettlement (net-of-settlement).
 * 1 group-by (KHÔNG N+1). key = `${transactionId}:${side}`. Chỉ tính các GD trong `txnIds`.
 * Settlement bị xóa cứng khi hủy phiếu thu (M3) nên các dòng còn lại luôn hiệu lực.
 */
async function settledByTxnSide(db: Db, txnIds: number[]): Promise<Map<string, number>> {
  const paid = new Map<string, number>();
  if (txnIds.length === 0) return paid;
  const rows = await db.cashDebtSettlement.groupBy({
    by: ['transactionId', 'side'],
    where: { transactionId: { in: txnIds } },
    _sum: { amount: true }
  });
  for (const r of rows) paid.set(`${r.transactionId}:${r.side}`, r._sum.amount ?? 0);
  return paid;
}

/**
 * Công nợ thu về = tổng công nợ CÒN LẠI (NET-OF-SETTLEMENT, H4/I#2) trong phạm vi lọc.
 * KHÔNG dùng cờ `settled` (sai khi thu TỪNG PHẦN: GD chưa settled sẽ tính TOÀN BỘ revenue là nợ, bỏ
 * qua phần đã thu qua CashDebtSettlement → thu trùng). Với TỪNG side:
 *   còn nợ(side) = revenue(side) − Σ CashDebtSettlement.amount(side); chỉ tính phần > 0.
 * count = số GD còn nợ (net PARTNER > 0 hoặc net SELL > 0).
 */
export async function debtSummary(filter: TransactionFilter = {}): Promise<{ ok: boolean; error?: string; message?: string; data?: DebtSummary }> {
  const g = await requirePermission(DEBT_VIEW, { action: DEBT_VIEW });
  if (!g.ok) return g;
  const db = g.db;
  const where = await buildWhere(db, filter); // KHÔNG ép settled — tính theo net
  if (where === null) return { ok: true, data: { count: 0, debtPartner: 0, debtSell: 0, debtTotal: 0 } };
  where.status = { not: 'CANCELLED' }; // P1.2: bill đã hủy không còn là công nợ
  where.writtenOffAt = null; // H2b: GD đã ghi giảm nợ xấu rớt khỏi công nợ
  const txns = await db.transaction.findMany({ where, select: { id: true, revenuePartner: true, revenueSell: true } });
  const paid = await settledByTxnSide(db, txns.map((t) => t.id));
  let debtPartner = 0, debtSell = 0, count = 0;
  for (const t of txns) {
    const rp = Math.max(0, t.revenuePartner - (paid.get(`${t.id}:PARTNER`) ?? 0));
    const rs = Math.max(0, t.revenueSell - (paid.get(`${t.id}:SELL`) ?? 0));
    if (rp > 0 || rs > 0) { count++; debtPartner += rp; debtSell += rs; }
  }
  return { ok: true, data: { count, debtPartner, debtSell, debtTotal: debtPartner + debtSell } };
}

/**
 * DEBT_VIEW — danh sách GD CÒN NỢ net (per-side remaining) trong phạm vi lọc — nguồn cho DebtPage
 * (hiển thị nợ còn lại từng khoản) + màn "Thu công nợ" (chọn GD → nhập số thu ≤ còn lại). Chỉ GD
 * còn nợ (remainingPartner > 0 hoặc remainingSell > 0), chưa xóa, status ≠ CANCELLED.
 */
export async function debtOpenTransactions(filter: TransactionFilter = {}): Promise<DebtOpenResult> {
  const g = await requirePermission(DEBT_VIEW, { action: DEBT_VIEW });
  if (!g.ok) return g;
  const db = g.db;
  const where = await buildWhere(db, filter);
  if (where === null) return { ok: true, data: [] };
  where.status = { not: 'CANCELLED' };
  where.writtenOffAt = null; // H2b: GD đã ghi giảm nợ xấu rớt khỏi công nợ
  const rows = await db.transaction.findMany({ where, orderBy: [{ txnDate: 'asc' }, { id: 'asc' }] });
  const paid = await settledByTxnSide(db, rows.map((r) => r.id));

  // Nhãn hiển thị: TID (→ MID/HKD/partner) + khách.
  const tidIds = [...new Set(rows.map((r) => r.tidId))];
  const tidMap = new Map(
    (await db.tid.findMany({ where: { id: { in: tidIds } }, select: { id: true, tid: true, mid: true, hkdName: true, partnerId: true } })).map((t) => [t.id, t])
  );
  const partnerIds = [...new Set([...tidMap.values()].map((t) => t.partnerId).filter((x): x is number => x != null))];
  const custIds = [...new Set(rows.map((r) => r.customerId).filter((x): x is number => x != null))];
  const partnerMap = new Map((await db.partner.findMany({ where: { id: { in: partnerIds } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const custMap = new Map((await db.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, fullName: true, nickname: true } })).map((c) => [c.id, c.nickname || c.fullName]));

  const data: DebtOpenTxnDto[] = [];
  for (const r of rows) {
    const remainingPartner = Math.max(0, r.revenuePartner - (paid.get(`${r.id}:PARTNER`) ?? 0));
    const remainingSell = Math.max(0, r.revenueSell - (paid.get(`${r.id}:SELL`) ?? 0));
    if (remainingPartner <= 0 && remainingSell <= 0) continue;
    const t = tidMap.get(r.tidId);
    data.push({
      id: r.id,
      code: r.code,
      txnDate: r.txnDate.toISOString(),
      tid: t?.tid ?? null,
      mid: t?.mid ?? null,
      hkdName: t?.hkdName ?? null,
      customerId: r.customerId,
      customerName: r.customerId != null ? custMap.get(r.customerId) ?? null : null,
      partnerId: t?.partnerId ?? null,
      partnerName: t?.partnerId != null ? partnerMap.get(t.partnerId) ?? null : null,
      revenuePartner: r.revenuePartner,
      revenueSell: r.revenueSell,
      remainingPartner,
      remainingSell,
      settled: r.settled,
      debtQuality: r.debtQuality
    });
  }
  return { ok: true, data };
}

// ═════════════════════════════════════════════════════════════════════════════
// H2b — PHÂN LOẠI CHẤT LƯỢNG CÔNG NỢ + GHI GIẢM NỢ XẤU (§2.8/§5b/§0 Q-C/Q-F)
// ═════════════════════════════════════════════════════════════════════════════

/** Chuyển trạng thái nguyên tử THUA trong $transaction → ném ra ngoài (mẫu cash-entry-service). */
class TxGuardError extends Error {
  constructor(public readonly code: string, public readonly userMessage: string) {
    super(code);
    this.name = 'TxGuardError';
  }
}

/** Nợ CÒN LẠI net từng side của 1 GD (revenue − Σ settlement), dùng cho classify/write-off. */
function netRemaining(t: { revenuePartner: number; revenueSell: number }, paid: Map<string, number>, id: number): { partner: number; sell: number; total: number } {
  const partner = Math.max(0, t.revenuePartner - (paid.get(`${id}:PARTNER`) ?? 0));
  const sell = Math.max(0, t.revenueSell - (paid.get(`${id}:SELL`) ?? 0));
  return { partner, sell, total: partner + sell };
}

export interface DebtQualityStat {
  count: number;
  debtPartner: number;
  debtSell: number;
  debtTotal: number;
}
export interface DebtByQualityResult {
  GOOD: DebtQualityStat;
  HARD: DebtQualityStat;
  BAD: DebtQualityStat;
  UNCLASSIFIED: DebtQualityStat;
}
function emptyQualityStat(): DebtQualityStat {
  return { count: 0, debtPartner: 0, debtSell: 0, debtTotal: 0 };
}

/** DebtQualityLog DTO cho lịch sử phân loại. */
export interface DebtQualityLogDto {
  id: number;
  fromQuality: string | null;
  toQuality: string;
  reason: string | null;
  actorUserId: number;
  actorName: string | null;
  createdAt: string;
}

/**
 * DEBT_CLASSIFY — đổi phân loại chất lượng công nợ của 1 GD (GOOD|HARD|BAD). CHỈ cho GD CÒN NỢ net
 * (revenue − settlement > 0 ở ≥1 side, H4 — KHÔNG dùng cờ settled) và CHƯA ghi giảm. Ghi DebtQualityLog
 * (from→to + reason + actor) + writeAudit + cập nhật Transaction.debtQuality. GD thu đủ (net=0) →
 * DEBT_FULLY_PAID. GD đã ghi giảm → ALREADY_WRITTEN_OFF.
 */
export async function classifyDebt(transactionId: number, quality: string, reason?: string): Promise<MutationResult> {
  const g = await requirePermission(DEBT_CLASSIFY, { action: 'DEBT_CLASSIFIED', targetType: 'Transaction', targetId: String(transactionId) });
  if (!g.ok) return g;
  const { db, user } = g;

  const q = (quality ?? '').trim().toUpperCase();
  if (!DEBT_QUALITIES.has(q)) return { ok: false, error: 'VALIDATION', message: 'Mức chất lượng công nợ phải là GOOD (Dễ), HARD (Khó) hoặc BAD (Không thu hồi).' };

  const t = await db.transaction.findUnique({ where: { id: transactionId }, select: { id: true, deletedAt: true, status: true, revenuePartner: true, revenueSell: true, debtQuality: true, writtenOffAt: true } });
  if (!t || t.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Giao dịch không tồn tại.' };
  if (t.status === 'CANCELLED') return { ok: false, error: 'TXN_CANCELLED', message: 'Giao dịch đã hủy — không phải công nợ.' };
  if (t.writtenOffAt) return { ok: false, error: 'ALREADY_WRITTEN_OFF', message: 'Giao dịch đã ghi giảm nợ xấu — không phân loại lại.' };

  const paid = await settledByTxnSide(db, [transactionId]);
  const net = netRemaining(t, paid, transactionId);
  if (net.total <= 0) return { ok: false, error: 'DEBT_FULLY_PAID', message: 'Giao dịch đã thu đủ — không còn là công nợ để phân loại.' };

  const from = t.debtQuality;
  if (from === q) return { ok: true, id: transactionId, message: 'Mức phân loại không đổi.' };

  await db.$transaction(async (tx) => {
    await tx.debtQualityLog.create({ data: { transactionId, fromQuality: from, toQuality: q, reason: reason?.trim() || null, actorUserId: user.id } });
    await tx.transaction.update({ where: { id: transactionId }, data: { debtQuality: q, updatedBy: user.id } });
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'DEBT_CLASSIFIED',
    targetType: 'Transaction',
    targetId: String(transactionId),
    before: auditSnapshot({ debtQuality: from }),
    after: auditSnapshot({ debtQuality: q, reason: reason?.trim() || null, remainingNet: net.total })
  });
  return { ok: true, id: transactionId };
}

/** DEBT_VIEW — lịch sử đổi phân loại của 1 GD (mới nhất trước). */
export async function debtQualityHistory(transactionId: number): Promise<{ ok: boolean; error?: string; message?: string; data?: DebtQualityLogDto[] }> {
  const g = await requirePermission(DEBT_VIEW, { action: DEBT_VIEW });
  if (!g.ok) return g;
  const db = g.db;
  const rows = await db.debtQualityLog.findMany({ where: { transactionId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const names = await resolveUserNames(db, rows.map((r) => r.actorUserId));
  const data: DebtQualityLogDto[] = rows.map((r) => ({
    id: r.id,
    fromQuality: r.fromQuality,
    toQuality: r.toQuality,
    reason: r.reason,
    actorUserId: r.actorUserId,
    actorName: names.get(r.actorUserId) ?? null,
    createdAt: r.createdAt.toISOString()
  }));
  return { ok: true, data };
}

/**
 * DEBT_VIEW — tổng công nợ CÒN LẠI net theo TỪNG mức chất lượng (GOOD/HARD/BAD/UNCLASSIFIED) trong
 * phạm vi lọc. Loại GD đã hủy + đã ghi giảm nợ xấu. Chỉ tính GD net > 0.
 */
export async function debtByQuality(filter: TransactionFilter = {}): Promise<{ ok: boolean; error?: string; message?: string; data?: DebtByQualityResult }> {
  const g = await requirePermission(DEBT_VIEW, { action: DEBT_VIEW });
  if (!g.ok) return g;
  const db = g.db;
  const empty: DebtByQualityResult = { GOOD: emptyQualityStat(), HARD: emptyQualityStat(), BAD: emptyQualityStat(), UNCLASSIFIED: emptyQualityStat() };
  const where = await buildWhere(db, filter);
  if (where === null) return { ok: true, data: empty };
  where.status = { not: 'CANCELLED' };
  where.writtenOffAt = null;
  const txns = await db.transaction.findMany({ where, select: { id: true, revenuePartner: true, revenueSell: true, debtQuality: true } });
  const paid = await settledByTxnSide(db, txns.map((t) => t.id));
  for (const t of txns) {
    const net = netRemaining(t, paid, t.id);
    if (net.total <= 0) continue;
    const bucket = t.debtQuality && DEBT_QUALITIES.has(t.debtQuality) ? (t.debtQuality as 'GOOD' | 'HARD' | 'BAD') : 'UNCLASSIFIED';
    const s = empty[bucket];
    s.count++;
    s.debtPartner += net.partner;
    s.debtSell += net.sell;
    s.debtTotal += net.total;
  }
  return { ok: true, data: empty };
}

/**
 * DEBT_WRITEOFF — Ghi giảm nợ xấu (write-off, Q-F=B). Perm CAO + verifyActorPassword. CHỈ áp GD
 * debtQuality=BAD, còn nợ net > 0, CHƯA ghi giảm (idempotent → ALREADY_WRITTEN_OFF). Trong 1 $transaction:
 *  • sinh 1 CashEntry CHI danh mục hệ thống "Chi phí nợ xấu" (sourceKind=BAD_DEBT, affectsPnl=true),
 *    amount = nợ còn lại net (tổng 2 side), fundId=null (bút toán PHI TIỀN MẶT — không trừ số dư quỹ),
 *    sourceType=BAD_DEBT + sourceId=transactionId (truy vết), payerUserId=actor, entryDate=now (local);
 *  • set Transaction.writtenOffAt/By → GD rớt khỏi công nợ (debtSummary/debtOpen loại writtenOff).
 * Vì affectsPnl=true → getMonthlyProfit tự trừ vào lợi nhuận (KHÔNG cần sửa dashboard-service).
 * Sai mật khẩu → WRONG_ACTOR_PASSWORD + audit denied.
 */
export async function writeOffBadDebt(transactionId: number, actorPassword: string): Promise<MutationResult> {
  const g = await requirePermission(DEBT_WRITEOFF, { action: 'DEBT_WRITTEN_OFF', targetType: 'Transaction', targetId: String(transactionId) });
  if (!g.ok) return g;
  const { db, user } = g;

  if (!(await verifyActorPassword(user, actorPassword))) {
    await writeAudit(db, { actorUserId: user.id, action: 'DEBT_WRITTEN_OFF', targetType: 'Transaction', targetId: String(transactionId), after: { denied: true, reason: 'WRONG_ACTOR_PASSWORD' } });
    return { ok: false, error: 'WRONG_ACTOR_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }

  // Pre-check NHANH ngoài khóa (fail sớm) — nhưng KHÔNG tính số tiền ở đây: net + kiểm net>0 tính TRONG
  // khóa (FIX 1 TOCTOU) để phản ánh settlement đã COMMIT của phiếu thu song song.
  const pre = await db.transaction.findUnique({ where: { id: transactionId }, select: { id: true, deletedAt: true, status: true, debtQuality: true, writtenOffAt: true } });
  if (!pre || pre.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Giao dịch không tồn tại.' };
  if (pre.status === 'CANCELLED') return { ok: false, error: 'TXN_CANCELLED', message: 'Giao dịch đã hủy — không phải công nợ.' };
  if (pre.writtenOffAt) return { ok: false, error: 'ALREADY_WRITTEN_OFF', message: 'Giao dịch này đã được ghi giảm nợ xấu rồi.' };
  if (pre.debtQuality !== 'BAD') return { ok: false, error: 'NOT_BAD_DEBT', message: 'Chỉ ghi giảm được công nợ đã phân loại "Không thu hồi (BAD)".' };

  const badCat = await db.cashCategory.findFirst({ where: { kind: 'CHI', sourceKind: 'BAD_DEBT', deletedAt: null }, select: { id: true } });
  if (!badCat) return { ok: false, error: 'BAD_DEBT_CATEGORY_MISSING', message: 'Chưa có danh mục hệ thống "Chi phí nợ xấu". Khởi động lại máy chủ để seed danh mục.' };

  const now = new Date();
  let result: { entryId: number; net: { partner: number; sell: number; total: number } };
  try {
    result = await db.$transaction(async (tx) => {
      // ── FIX 1 (TOCTOU write-off ⨯ thu công nợ) — KHÓA HÀNG GD cha TRƯỚC khi đọc settlement/tính net.
      // $transaction mặc định READ COMMITTED. Trước đây net được đọc + kiểm NGOÀI $transaction rồi mới mở
      // tx ghi giảm: giữa đọc-net và ghi, 1 createDebtReceipt (cũng FOR UPDATE hàng này) có thể thu ĐỦ GD
      // → write-off vẫn chạy với net cũ → GD vừa vào quỹ vừa bị ghi giảm (trừ oan lợi nhuận). Khóa FOR
      // UPDATE tại đây serialize 2 luồng: nếu phiếu thu commit trước → net đọc TRONG khóa = 0 →
      // DEBT_FULLY_PAID (rollback, không ghi giảm oan). Nếu write-off commit trước → phiếu thu thấy
      // writtenOffAt (statement mới, READ COMMITTED) → TXN_WRITTEN_OFF (FIX 2). Không thể vừa thu vừa giảm.
      await tx.$queryRawUnsafe('SELECT id FROM transactions WHERE id = $1 FOR UPDATE', transactionId);

      // Đọc GD + settlement + tính net TRONG khóa (giá trị authoritative — dùng cho amount write-off).
      const t = await tx.transaction.findUnique({ where: { id: transactionId }, select: { id: true, deletedAt: true, status: true, revenuePartner: true, revenueSell: true, debtQuality: true, writtenOffAt: true } });
      if (!t || t.deletedAt) throw new TxGuardError('NOT_FOUND', 'Giao dịch không tồn tại.');
      if (t.status === 'CANCELLED') throw new TxGuardError('TXN_CANCELLED', 'Giao dịch đã hủy — không phải công nợ.');
      if (t.writtenOffAt) throw new TxGuardError('ALREADY_WRITTEN_OFF', 'Giao dịch này đã được ghi giảm nợ xấu rồi.');
      if (t.debtQuality !== 'BAD') throw new TxGuardError('NOT_BAD_DEBT', 'Chỉ ghi giảm được công nợ đã phân loại "Không thu hồi (BAD)".');

      const agg = await tx.cashDebtSettlement.groupBy({ by: ['side'], where: { transactionId }, _sum: { amount: true } });
      const paid = new Map<string, number>();
      for (const a of agg) paid.set(`${transactionId}:${a.side}`, a._sum.amount ?? 0);
      const net = netRemaining(t, paid, transactionId);
      // Kiểm net>0 TRONG khóa: nếu phiếu thu song song vừa thu đủ (commit trước) → net=0 → rollback.
      if (net.total <= 0) throw new TxGuardError('DEBT_FULLY_PAID', 'Giao dịch đã thu đủ — không còn nợ để ghi giảm.');

      // Idempotent nguyên tử: chỉ ghi giảm khi CHƯA writtenOff (đã khóa hàng nên moved luôn = 1; giữ như phòng vệ).
      const moved = await tx.transaction.updateMany({
        where: { id: transactionId, writtenOffAt: null, deletedAt: null, status: { not: 'CANCELLED' } },
        data: { writtenOffAt: now, writtenOffBy: user.id, updatedBy: user.id }
      });
      if (moved.count === 0) throw new TxGuardError('ALREADY_WRITTEN_OFF', 'Giao dịch này đã được ghi giảm nợ xấu rồi.');
      const code = await nextCode('PC', tx);
      const entry = await tx.cashEntry.create({
        data: {
          code, kind: 'CHI', categoryId: badCat.id, fundId: null, amount: net.total, method: 'CASH', entryDate: now,
          payerUserId: user.id, sourceType: 'BAD_DEBT', sourceId: transactionId,
          note: `Ghi giảm nợ xấu GD #${transactionId} (nợ còn lại net ${net.total}đ)`, status: 'POSTED', createdBy: user.id
        }
      });
      return { entryId: entry.id, net };
    });
  } catch (e) {
    if (e instanceof TxGuardError) return { ok: false, error: e.code, message: e.userMessage };
    throw e;
  }

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'DEBT_WRITTEN_OFF',
    targetType: 'Transaction',
    targetId: String(transactionId),
    after: auditSnapshot({ cashEntryId: result.entryId, amountNet: result.net.total, partner: result.net.partner, sell: result.net.sell, categoryId: badCat.id })
  });
  return { ok: true, id: result.entryId };
}
