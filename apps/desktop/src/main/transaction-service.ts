// Doanh thu & Công nợ (Nhóm B, main). Mỗi giao dịch = 1 lần quẹt/rút qua 1 TID cho 1 khách.
// LEAD 9/7: doanh thu BÓC 2 khoản chênh rồi CỘNG GỘP:
//   • CL_NCC (chênh đối tác) = phiMua − phiCaiMay  → khoản đối soát/thu từ đối tác
//   • CL_KH  (chênh bán)     = phiBan − phiCaiMay  → khoản thu từ khách
//   Doanh thu = số tiền × (CL_NCC% + CL_KH%). CẢ 2 khoản = CÔNG NỢ thu về (đối tác + khách).
// Biểu phí tra theo (Đối tác của TID × Loại thẻ) → snapshot vào giao dịch (×1000) để phí đổi
// về sau KHÔNG làm sai doanh thu đã ghi. Permission-guarded, audited, soft-delete → thùng rác.
import { auditSnapshot, computeRevenue } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';

const VIEW = 'REVENUE_VIEW';
const MANAGE = 'REVENUE_MANAGE';
const DEBT_VIEW = 'DEBT_VIEW';
const DEBT_SETTLE = 'DEBT_SETTLE';

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
  count: number; // số giao dịch CHƯA đối soát
  debtPartner: number; // công nợ phía đối tác
  debtSell: number; // công nợ phía khách
  debtTotal: number; // tổng công nợ thu về
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
 * Tra biểu phí cho 1 giao dịch trên (TID × Loại thẻ):
 *   Đối tác lấy từ TID → FeeRate(partnerId, cardTypeId) → CL_NCC / CL_KH (milli).
 * Trả về margins đã snapshot, hoặc null + lý do.
 */
async function resolveFeeForTxn(
  db: Db,
  tidRow: { id: number; partnerId: number | null; bankId: number | null },
  cardTypeId: number
): Promise<{ ok: true; fee: ResolvedFee } | { ok: false; error: string; message: string }> {
  if (tidRow.partnerId == null)
    return { ok: false, error: 'NO_PARTNER', message: 'TID này chưa gán Đối tác nên không tra được biểu phí. Hãy cấu hình TID trước.' };
  const card = await db.cardType.findUnique({ where: { id: cardTypeId } });
  if (!card || card.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Loại thẻ không tồn tại.' };
  if (tidRow.bankId != null && card.bankId !== tidRow.bankId)
    return { ok: false, error: 'CARD_BANK_MISMATCH', message: 'Loại thẻ không thuộc ngân hàng của TID này.' };
  const rate = await db.feeRate.findFirst({ where: { partnerId: tidRow.partnerId, cardTypeId, deletedAt: null } });
  if (!rate)
    return {
      ok: false,
      error: 'NO_FEE_RATE',
      message: 'Chưa có biểu phí cho tổ hợp Đối tác × Loại thẻ này. Hãy cấu hình biểu phí trước.'
    };
  return {
    ok: true,
    fee: {
      partnerMarginMilli: rate.phiMua - rate.phiCaiMay, // CL_NCC
      sellMarginMilli: rate.phiBan - rate.phiCaiMay, // CL_KH
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

  const fee = await resolveFeeForTxn(db, tid, input.cardTypeId);
  if (!fee.ok) return fee;

  const rev = computeRevenue(amount, fee.fee.partnerMarginMilli, fee.fee.sellMarginMilli);
  const customerId = input.customerId === undefined ? tid.customerId : input.customerId;

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

export async function updateTransaction(id: number, input: UpdateTransactionInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'TRANSACTION_UPDATED', targetType: 'Transaction', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.transaction.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Giao dịch không tồn tại.' };

  const amount = input.amount !== undefined ? parseAmount(input.amount) : row.amount;
  if (amount === null) return { ok: false, error: 'VALIDATION', message: 'Số tiền không hợp lệ (số nguyên ≥ 0).' };
  let txnDate = row.txnDate;
  if (input.txnDate !== undefined) {
    const d = parseDate(input.txnDate);
    if (!d) return { ok: false, error: 'VALIDATION', message: 'Ngày giao dịch không hợp lệ.' };
    txnDate = d;
  }
  const cardTypeId = input.cardTypeId ?? row.cardTypeId;
  if (!cardTypeId) return { ok: false, error: 'VALIDATION', message: 'Thiếu loại thẻ.' };

  // SNAPSHOT phí (LEAD): GIỮ NGUYÊN margin đã lưu — sửa ghi chú/ngày/khách/số tiền KHÔNG tái định giá
  // theo biểu phí hiện tại. CHỈ tra lại phí khi người dùng ĐỔI LOẠI THẺ (phí phụ thuộc loại thẻ).
  const cardChanged = input.cardTypeId !== undefined && input.cardTypeId !== row.cardTypeId;
  let partnerMarginMilli = row.partnerMarginMilli;
  let sellMarginMilli = row.sellMarginMilli;
  if (cardChanged) {
    const tid = await db.tid.findUnique({ where: { id: row.tidId } });
    if (!tid || tid.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'TID không tồn tại.' };
    const fee = await resolveFeeForTxn(db, tid, cardTypeId);
    if (!fee.ok) return fee;
    partnerMarginMilli = fee.fee.partnerMarginMilli;
    sellMarginMilli = fee.fee.sellMarginMilli;
  }

  const rev = computeRevenue(amount, partnerMarginMilli, sellMarginMilli);
  const customerId = input.customerId === undefined ? row.customerId : input.customerId;
  const before = auditSnapshot({ amount: row.amount, cardTypeId: row.cardTypeId, revenueAmount: row.revenueAmount });

  await db.transaction.update({
    where: { id },
    data: {
      cardTypeId,
      amount,
      partnerMarginMilli,
      sellMarginMilli,
      revenuePartner: rev.revenuePartner,
      revenueSell: rev.revenueSell,
      revenueAmount: rev.revenueAmount,
      txnDate,
      customerId: customerId ?? null,
      note: input.note !== undefined ? input.note.trim() || null : row.note,
      updatedBy: user.id
    }
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'TRANSACTION_UPDATED',
    targetType: 'Transaction',
    targetId: String(id),
    before,
    after: auditSnapshot({ amount, cardTypeId, revenueAmount: rev.revenueAmount })
  });
  return { ok: true, id };
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

/** Đối soát: đánh dấu (các) giao dịch đã thu công nợ. */
export async function settleTransactions(ids: number[], settled: boolean): Promise<MutationResult & { changed?: number }> {
  const g = await requirePermission(DEBT_SETTLE, { action: 'DEBT_SETTLED', targetType: 'Transaction' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn giao dịch để đối soát.' };
  let changed = 0;
  for (const id of ids) {
    const row = await db.transaction.findUnique({ where: { id } });
    if (!row || row.deletedAt || row.settled === settled) continue;
    await db.transaction.update({ where: { id }, data: { settled, settledAt: settled ? new Date() : null, updatedBy: user.id } });
    changed++;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'DEBT_SETTLED', targetType: 'Transaction', after: auditSnapshot({ ids, settled, changed }) });
  return { ok: true, changed };
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

  // Summary trên TOÀN BỘ dòng khớp (aggregate ở DB — không tải hết về).
  const agg = await db.transaction.aggregate({
    where,
    _sum: { amount: true, revenuePartner: true, revenueSell: true, revenueAmount: true }
  });
  const summary: RevenueSummary = {
    count: total,
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

/** Công nợ thu về = tổng hợp các giao dịch CHƯA đối soát (settled=false) trong phạm vi lọc. */
export async function debtSummary(filter: TransactionFilter = {}): Promise<{ ok: boolean; error?: string; message?: string; data?: DebtSummary }> {
  const g = await requirePermission(DEBT_VIEW, { action: DEBT_VIEW });
  if (!g.ok) return g;
  const db = g.db;
  const where = await buildWhere(db, { ...filter, settled: false });
  if (where === null) return { ok: true, data: { count: 0, debtPartner: 0, debtSell: 0, debtTotal: 0 } };
  const agg = await db.transaction.aggregate({ where, _sum: { revenuePartner: true, revenueSell: true, revenueAmount: true }, _count: true });
  return {
    ok: true,
    data: {
      count: agg._count,
      debtPartner: agg._sum.revenuePartner ?? 0,
      debtSell: agg._sum.revenueSell ?? 0,
      debtTotal: agg._sum.revenueAmount ?? 0
    }
  };
}
