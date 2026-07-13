// LOẠI GIAO MÁY (Mr.Long) — CỌC + áp mô hình tiền khi giao (applyHandover). NHÂN khuôn device-sale.
// Kế toán khóa (chống lệch sổ):
//   • CHO THUÊ (RENT): thu 1 lần lúc giao = 1 CashEntry THU danh mục RENT (affectsPnl=true) vào quỹ → DOANH THU.
//   • CỌC (DEPOSIT): tiền cọc = NỢ PHẢI TRẢ → 1 DeviceDeposit(OPEN) + CashEntry THU danh mục DEPOSIT
//     (affectsPnl=false, sourceType='DEVICE_DEPOSIT') vào quỹ → KHÔNG doanh thu. Thu máy về (recall) →
//     HOÀN phần CÒN GIỮ = CashEntry CHI danh mục DEPOSIT_REFUND + DeviceDepositRefund; cọc CÒN GIỮ =
//     amount − Σ refund (LIVE). Chống hoàn quá remaining (FOR UPDATE).
//   • MƯỢN (NONE): 0đ — không CashEntry.
//   • BÁN (SALE): KHÔNG đi qua đây (luồng device-sale) — caller định tuyến.
// applyHandoverTx CHỈ GHI (validate đã làm trước tx ở handover-service.resolveHandoverInput).
import { Prisma, type Db } from '@glb/database';
import { requirePermission } from './guard.js';
import { nextCode } from './code-service.js';

export type MoneyKind = 'SALE' | 'RENT' | 'DEPOSIT' | 'NONE';

/** Ngữ cảnh áp mô hình tiền khi giao (đã validate ở resolveHandoverInput). */
export interface HandoverContext {
  moneyKind: MoneyKind;
  handoverTypeId: number | null;
  amount: bigint; // ≥ 0
  fundId: number | null; // ≠ null khi amount>0 (RENT/DEPOSIT)
  method: string; // CK | CASH
  deviceSerial: string | null;
  tid: string | null;
  customerId: number | null;
  occurredAt: Date;
  actorId: number;
}

type PrismaTx = Prisma.TransactionClient;

/** id danh mục thu/chi theo sourceKind hệ thống (RENT/DEPOSIT/DEPOSIT_REFUND). Ném nếu thiếu seed. */
async function catIdBySourceKind(tx: PrismaTx, sourceKind: string): Promise<number> {
  const c = await tx.cashCategory.findFirst({ where: { sourceKind, deletedAt: null }, select: { id: true } });
  if (!c) throw new Error(`Thiếu danh mục thu/chi (${sourceKind}) — kiểm tra seed hệ thống.`);
  return c.id;
}

/**
 * Mở 1 chứng từ cọc trong CÙNG $transaction: DeviceDeposit(OPEN) + CashEntry THU danh mục DEPOSIT
 * (affectsPnl=false, sourceType='DEVICE_DEPOSIT', sourceId=depositId) vào quỹ. Trả depositId.
 */
export async function openDepositTx(
  tx: PrismaTx,
  a: { customerId: number; deviceSerial: string | null; tid: string | null; handoverTypeId: number | null; amount: bigint; fundId: number; method: string; occurredAt: Date; actorId: number; note?: string | null }
): Promise<number> {
  const code = await nextCode('CO', tx);
  const deposit = await tx.deviceDeposit.create({
    data: {
      code, customerId: a.customerId, deviceSerial: a.deviceSerial, tid: a.tid, handoverTypeId: a.handoverTypeId,
      amount: a.amount, status: 'OPEN', occurredAt: a.occurredAt, note: a.note ?? null, createdBy: a.actorId
    }
  });
  const catId = await catIdBySourceKind(tx, 'DEPOSIT');
  const payCode = await nextCode('PT', tx);
  await tx.cashEntry.create({
    data: {
      code: payCode, kind: 'THU', categoryId: catId, fundId: a.fundId, amount: a.amount, method: a.method,
      entryDate: a.occurredAt, customerId: a.customerId, sourceType: 'DEVICE_DEPOSIT', sourceId: deposit.id,
      note: 'Thu cọc máy (giao cọc)', status: 'POSTED', createdBy: a.actorId
    }
  });
  return deposit.id;
}

/** Cọc CÒN GIỮ của 1 chứng từ (LIVE) = amount − Σ DeviceDepositRefund.amount. */
export async function depositRemainingTx(tx: PrismaTx, depositId: number): Promise<bigint> {
  const dep = await tx.deviceDeposit.findUnique({ where: { id: depositId }, select: { amount: true } });
  if (!dep) return 0n;
  const agg = await tx.deviceDepositRefund.aggregate({ where: { deviceDepositId: depositId }, _sum: { amount: true } });
  return dep.amount - (agg._sum.amount ?? 0n);
}

/**
 * Thu máy về (recall) → HOÀN phần cọc CÒN GIỮ của MỌI chứng từ cọc OPEN gắn máy `serial`, trong CÙNG
 * $transaction. Mỗi chứng từ: FOR UPDATE, tính remaining, nếu > 0 tạo CashEntry CHI DEPOSIT_REFUND
 * (sourceType='DEVICE_DEPOSIT') + DeviceDepositRefund, set status=REFUNDED. Quỹ hoàn = fundIdOverride
 * nếu có, ngược lại QUỸ của CashEntry cọc GỐC (đối xứng: hoàn về đúng quỹ đã thu). Trả tổng đã hoàn.
 */
export async function refundOpenDepositsForSerialTx(
  tx: PrismaTx,
  a: { serial: string; fundIdOverride: number | null; method: string; occurredAt: Date; actorId: number }
): Promise<bigint> {
  const opens = await tx.deviceDeposit.findMany({ where: { deviceSerial: a.serial, status: 'OPEN' }, select: { id: true } });
  if (opens.length === 0) return 0n;
  const catId = await catIdBySourceKind(tx, 'DEPOSIT_REFUND');
  let refundedTotal = 0n;
  for (const o of opens) {
    // Khóa hàng chứng từ cọc (chống hoàn 2 lần / race).
    await tx.$queryRaw`SELECT id FROM device_deposits WHERE id = ${o.id} FOR UPDATE`;
    const dep = await tx.deviceDeposit.findUnique({ where: { id: o.id } });
    if (!dep || dep.status !== 'OPEN') continue;
    const remaining = await depositRemainingTx(tx, o.id);
    if (remaining <= 0n) {
      // Không còn gì để hoàn → đóng chứng từ.
      await tx.deviceDeposit.update({ where: { id: o.id }, data: { status: 'REFUNDED' } });
      continue;
    }
    // Quỹ hoàn: ưu tiên override, else quỹ của CashEntry cọc gốc (THU DEVICE_DEPOSIT).
    let fundId = a.fundIdOverride;
    if (fundId == null) {
      const orig = await tx.cashEntry.findFirst({ where: { sourceType: 'DEVICE_DEPOSIT', sourceId: o.id, kind: 'THU', status: 'POSTED' }, orderBy: { id: 'asc' }, select: { fundId: true } });
      fundId = orig?.fundId ?? null;
    }
    if (fundId == null) {
      // Không xác định được quỹ hoàn → BỎ QUA (giữ OPEN) để không tạo bút toán mồ côi. (Thực tế cọc gốc luôn có quỹ.)
      continue;
    }
    const payCode = await nextCode('PC', tx);
    const entry = await tx.cashEntry.create({
      data: {
        code: payCode, kind: 'CHI', categoryId: catId, fundId, amount: remaining, method: a.method,
        entryDate: a.occurredAt, customerId: dep.customerId, sourceType: 'DEVICE_DEPOSIT', sourceId: o.id,
        note: 'Hoàn cọc máy (thu máy về)', status: 'POSTED', createdBy: a.actorId
      }
    });
    await tx.deviceDepositRefund.create({ data: { deviceDepositId: o.id, cashEntryId: entry.id, amount: remaining } });
    await tx.deviceDeposit.update({ where: { id: o.id }, data: { status: 'REFUNDED' } });
    refundedTotal += remaining;
  }
  return refundedTotal;
}

/**
 * Áp MÔ HÌNH TIỀN khi giao (deploy / gán-TID kèm máy) trong CÙNG $transaction — dùng chung cho pos & tid.
 *   RENT   → amount>0 tạo CashEntry THU danh mục RENT vào quỹ (doanh thu). amount=0 → bỏ qua tiền.
 *   DEPOSIT→ openDepositTx (DeviceDeposit + CashEntry THU DEPOSIT).
 *   NONE   → 0đ, không CashEntry.
 *   SALE   → KHÔNG xử lý (caller định tuyến sang luồng Bán) — no-op an toàn.
 * (Validate số tiền/quỹ đã làm ở resolveHandoverInput → đây chỉ GHI.)
 */
export async function applyHandoverTx(tx: PrismaTx, ctx: HandoverContext): Promise<void> {
  if (ctx.moneyKind === 'SALE' || ctx.moneyKind === 'NONE') return;
  if (ctx.moneyKind === 'RENT') {
    if (ctx.amount <= 0n) return; // thuê 0đ (miễn phí kỳ đầu) — không ghi tiền
    if (ctx.fundId == null) throw new Error('RENT amount>0 thiếu quỹ (lỗi logic — đã validate trước tx).');
    const catId = await catIdBySourceKind(tx, 'RENT');
    const code = await nextCode('PT', tx);
    await tx.cashEntry.create({
      data: {
        code, kind: 'THU', categoryId: catId, fundId: ctx.fundId, amount: ctx.amount, method: ctx.method,
        entryDate: ctx.occurredAt, customerId: ctx.customerId, sourceType: 'RENT', sourceId: null,
        note: 'Doanh thu cho thuê máy (giao thuê)', status: 'POSTED', createdBy: ctx.actorId
      }
    });
    return;
  }
  // DEPOSIT
  if (ctx.fundId == null || ctx.customerId == null) throw new Error('DEPOSIT thiếu quỹ/khách (lỗi logic — đã validate trước tx).');
  await openDepositTx(tx, {
    customerId: ctx.customerId, deviceSerial: ctx.deviceSerial, tid: ctx.tid, handoverTypeId: ctx.handoverTypeId,
    amount: ctx.amount, fundId: ctx.fundId, method: ctx.method, occurredAt: ctx.occurredAt, actorId: ctx.actorId
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Báo cáo: cọc ĐANG GIỮ (nợ phải trả) — KHÔNG tính vào doanh thu. Gộp theo khách.
// ─────────────────────────────────────────────────────────────────────────────
export interface DepositHeldRow {
  customerId: number;
  customerName: string | null;
  totalDeposit: number; // Σ amount các chứng từ OPEN
  totalRefunded: number; // Σ đã hoàn (một phần) trên các chứng từ đó
  remaining: number; // đang giữ = totalDeposit − totalRefunded
  depositCount: number;
}
/** REVENUE_VIEW — cọc đang giữ (còn remaining>0) gộp theo khách. */
export async function depositsHeld(customerId?: number): Promise<{ ok: boolean; data?: DepositHeldRow[]; error?: string; message?: string }> {
  const g = await requirePermission('REVENUE_VIEW', { action: 'REVENUE_VIEW' });
  if (!g.ok) return g;
  const db: Db = g.db;
  const rows = await db.deviceDeposit.findMany({ where: { status: 'OPEN', customerId: customerId ?? undefined }, select: { id: true, customerId: true, amount: true } });
  const ids = rows.map((r) => r.id);
  const refs = ids.length ? await db.deviceDepositRefund.groupBy({ by: ['deviceDepositId'], where: { deviceDepositId: { in: ids } }, _sum: { amount: true } }) : [];
  const refundMap = new Map(refs.map((r) => [r.deviceDepositId, r._sum.amount ?? 0n]));
  const agg = new Map<number, { dep: bigint; ref: bigint; count: number }>();
  for (const r of rows) {
    const cur = agg.get(r.customerId) ?? { dep: 0n, ref: 0n, count: 0 };
    cur.dep += r.amount;
    cur.ref += refundMap.get(r.id) ?? 0n;
    cur.count += 1;
    agg.set(r.customerId, cur);
  }
  const custs = await db.customer.findMany({ where: { id: { in: [...agg.keys()] } }, select: { id: true, nickname: true, fullName: true } });
  const custMap = new Map(custs.map((c) => [c.id, c.nickname || c.fullName]));
  const data = [...agg.entries()]
    .map(([cid, v]) => ({ customerId: cid, customerName: custMap.get(cid) ?? null, totalDeposit: Number(v.dep), totalRefunded: Number(v.ref), remaining: Number(v.dep - v.ref), depositCount: v.count }))
    .filter((d) => d.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);
  return { ok: true, data };
}

// ─────────────────────────────────────────────────────────────────────────────
// Báo cáo DOANH THU theo LOẠI GIAO — nguồn:
//   • BÁN     = Σ DeviceSale.salePrice (POSTED, alive) — mọi chứng từ bán ĐỀU là "Bán" (moneyKind=SALE),
//     gộp theo handoverTypeId nếu chứng từ có ghi (mặc định gộp vào loại builtin "Bán").
//   • CHO THUÊ= Σ CashEntry POSTED THU danh mục RENT (affectsPnl=true). CashEntry rent KHÔNG có cột
//     handoverTypeId → gộp CHUNG 1 dòng "Cho thuê".
//   • CỌC     = KHÔNG vào doanh thu (nợ phải trả) — báo cáo riêng qua depositsHeld.
// ─────────────────────────────────────────────────────────────────────────────
export interface RevenueByHandoverFilter {
  from?: string; // YYYY-MM-DD (local)
  to?: string;
}
export interface RevenueByHandoverRow {
  handoverTypeId: number | null;
  handoverName: string;
  moneyKind: string;
  revenue: number;
  docCount: number;
}
function localDayBounds(from?: string, to?: string): { gte?: Date; lt?: Date } | undefined {
  const parseLocal = (s: string, addDays: number): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + addDays);
    return isNaN(d.getTime()) ? null : d;
  };
  const b: { gte?: Date; lt?: Date } = {};
  const gte = from ? parseLocal(from, 0) : null;
  const lt = to ? parseLocal(to, 1) : null;
  if (gte) b.gte = gte;
  if (lt) b.lt = lt;
  return b.gte || b.lt ? b : undefined;
}

export async function revenueByHandoverType(filter: RevenueByHandoverFilter = {}): Promise<{ ok: boolean; data?: RevenueByHandoverRow[]; error?: string; message?: string }> {
  const g = await requirePermission('REVENUE_VIEW', { action: 'REVENUE_VIEW' });
  if (!g.ok) return g;
  const db: Db = g.db;
  const saleBounds = localDayBounds(filter.from, filter.to);
  const rentBounds = localDayBounds(filter.from, filter.to);

  // BÁN — Σ DeviceSale.salePrice (POSTED, alive) trong kỳ (occurredAt).
  const sales = await db.deviceSale.findMany({
    where: { deletedAt: null, status: 'POSTED', occurredAt: saleBounds },
    select: { salePrice: true, handoverTypeId: true }
  });
  // CHO THUÊ — Σ CashEntry THU danh mục RENT (POSTED, alive) trong kỳ (entryDate).
  const rentCat = await db.cashCategory.findFirst({ where: { sourceKind: 'RENT', deletedAt: null }, select: { id: true } });
  let rentSum = 0n;
  let rentCount = 0;
  if (rentCat) {
    const rentAgg = await db.cashEntry.aggregate({ where: { status: 'POSTED', kind: 'THU', categoryId: rentCat.id, deletedAt: null, entryDate: rentBounds }, _sum: { amount: true }, _count: true });
    rentSum = rentAgg._sum.amount ?? 0n;
    rentCount = rentAgg._count;
  }

  // Loại giao builtin để đặt nhãn (Bán/Cho thuê).
  const builtins = await db.handoverType.findMany({ where: { deletedAt: null }, select: { id: true, name: true, moneyKind: true } });
  const saleType = builtins.find((h) => h.moneyKind === 'SALE');
  const rentType = builtins.find((h) => h.moneyKind === 'RENT');
  const typeById = new Map(builtins.map((h) => [h.id, h]));

  // Gộp bán theo handoverTypeId (mặc định vào loại builtin "Bán").
  const saleAgg = new Map<number | null, { rev: bigint; count: number }>();
  for (const s of sales) {
    const key = s.handoverTypeId != null && typeById.get(s.handoverTypeId)?.moneyKind === 'SALE' ? s.handoverTypeId : (saleType?.id ?? null);
    const cur = saleAgg.get(key) ?? { rev: 0n, count: 0 };
    cur.rev += s.salePrice;
    cur.count += 1;
    saleAgg.set(key, cur);
  }

  const data: RevenueByHandoverRow[] = [];
  for (const [key, v] of saleAgg) {
    const name = key != null ? typeById.get(key)?.name ?? 'Bán' : 'Bán';
    data.push({ handoverTypeId: key, handoverName: name, moneyKind: 'SALE', revenue: Number(v.rev), docCount: v.count });
  }
  if (rentSum > 0n || rentCount > 0) {
    data.push({ handoverTypeId: rentType?.id ?? null, handoverName: rentType?.name ?? 'Cho thuê', moneyKind: 'RENT', revenue: Number(rentSum), docCount: rentCount });
  }
  data.sort((a, b) => b.revenue - a.revenue);
  return { ok: true, data };
}
