// PHASE 1 ENGINE (Mr.Long 13/7) — Yêu cầu xuất kho POS/TID → DUYỆT → đối trừ tồn kho (BACKEND ONLY).
// Mô hình (chốt Mr.Long):
//   • 1b: GIỮ giao trực tiếp (pos/tid-service) + THÊM luồng yêu cầu→duyệt cho user thường.
//   • 2b: chỉ Bán (SALE) / Cho thuê (RENT) — không Sửa/Đổi.
//   • 3: phiếu N đơn vị CHƯA seri; người DUYỆT (quyền Kho) chọn N seri/TID lúc duyệt. Tiền = đơn giá × số
//     lượng (mỗi dòng = 1 máy ở đơn giá phiếu). TIỀN + TỒN KHO TRỪ LÚC DUYỆT (không lúc tạo phiếu).
//   • Money-model TÁI DÙNG NGUYÊN per-máy: bookSaleCashEntries (device-sale) cho SALE, applyHandoverTx
//     (RENT) + openDepositTx (cọc) từ deposit-service — KHÔNG nhân bản semantics tiền.
//   • Khuôn duyệt NHÂN entity-cancel: Admin (ELEVATED=role ADMIN) tự duyệt được (chốt = nhập mật khẩu khi
//     duyệt); người khác cần verifyActorPassword; $transaction FOR UPDATE guard PENDING (chống double-approve).
// State POS/TID chiếu qua decidePosTransition/decideTidTransition (nguồn sự thật state machine) — không đoán.
import { decidePosTransition, decideTidTransition, auditSnapshot, type PosStatus, type TidStatus } from '@glb/business-rules';
import { hasPermission } from '@glb/shared';
import { Prisma } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { nextCode } from './code-service.js';
import { bookSaleCashEntries } from './device-sale-service.js';
import { applyHandoverTx, openDepositTx } from './deposit-service.js';

const ADMIN_ROLE_CODE = 'ADMIN';
const DEFAULT_METHOD = 'CASH'; // ExportRequest KHÔNG có cột method → mọi bút toán mặc định CASH (báo cáo).

type PrismaTx = Prisma.TransactionClient;

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

/** Sentinel: hủy $transaction với MutationResult thân thiện (giống device-sale SaleAbort). */
class ReqAbort extends Error {
  constructor(public readonly result: MutationResult) {
    super(result.message ?? result.error ?? 'ABORT');
  }
}
function isRetryablePg(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === '40P01' || code === '40001';
}
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ReqAbort) throw e;
      if (isRetryablePg(e)) { last = e; continue; }
      throw e;
    }
  }
  throw last;
}

/** VND nguyên từ number. allowZero=false → bắt buộc > 0. Ném ReqAbort nếu không hợp lệ. */
function toVnd(v: unknown, label: string, opts: { allowZero?: boolean } = {}): bigint {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || (!opts.allowZero && n === 0)) {
    throw new ReqAbort({ ok: false, error: 'VALIDATION', message: `${label} phải là số nguyên ${opts.allowZero ? '≥ 0' : '> 0'} (VND).` });
  }
  return BigInt(n);
}

const KINDS = new Set(['POS', 'TID']);
const HANDOVER_KINDS = new Set(['SALE', 'RENT']);
const PRICE_MODES = new Set(['LISTED', 'CUSTOM']);

// ═════════════════════════════════════════════════════════════════════════════
// TẠO YÊU CẦU (không động tiền/kho — chỉ ghi phiếu PENDING)
// ═════════════════════════════════════════════════════════════════════════════
export interface CreateExportRequestInput {
  kind: string; // POS | TID
  handoverKind: string; // SALE | RENT
  withTid?: boolean; // POS giao KÈM TID (assign khi duyệt); kind TID luôn false
  bankId?: number | null;
  partnerId?: number | null; // đối tác (bắt buộc cho TID)
  customerId: number;
  cardTypeId?: number | null;
  feeTypeId?: number | null;
  priceMode?: string; // LISTED | CUSTOM
  unitPrice: number; // đơn giá 1 đơn vị (VND) > 0
  quantity: number; // > 0
  depositAmount?: number | null; // cọc kèm (≥ 0)
  paidAmount?: number | null; // SALE thu ngay khi duyệt (0..amount); RENT phải = 0
  fundId?: number | null; // quỹ nhận tiền khi duyệt (bắt buộc khi có tiền)
  note?: string | null;
}

/** EXPORT_REQUEST_CREATE — user thường tạo phiếu yêu cầu xuất kho (chưa seri). Validate + amount=đơn giá×SL. */
export async function createExportRequest(input: CreateExportRequestInput): Promise<MutationResult> {
  const g = await requirePermission('EXPORT_REQUEST_CREATE', { action: 'EXPORT_REQUEST_CREATED', targetType: 'ExportRequest' });
  if (!g.ok) return g;
  const { db, user } = g;
  try {
    const kind = String(input.kind ?? '').toUpperCase();
    if (!KINDS.has(kind)) throw new ReqAbort({ ok: false, error: 'VALIDATION', message: 'Loại yêu cầu phải là POS hoặc TID.' });
    const handoverKind = String(input.handoverKind ?? '').toUpperCase();
    if (!HANDOVER_KINDS.has(handoverKind)) throw new ReqAbort({ ok: false, error: 'VALIDATION', message: 'Hình thức xuất kho chỉ có Bán (SALE) hoặc Cho thuê (RENT).' });
    const priceMode = input.priceMode ? String(input.priceMode).toUpperCase() : 'LISTED';
    if (!PRICE_MODES.has(priceMode)) throw new ReqAbort({ ok: false, error: 'VALIDATION', message: 'Chế độ giá phải là LISTED hoặc CUSTOM.' });

    // kind TID: kèm-máy phải quay về phiếu POS → withTid luôn false; đối tác + ngân hàng bắt buộc (khớp khi duyệt).
    const withTid = kind === 'POS' ? !!input.withTid : false;

    if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new ReqAbort({ ok: false, error: 'VALIDATION', message: 'Số lượng phải là số nguyên ≥ 1.' });
    const quantity = input.quantity;
    const unitPrice = toVnd(input.unitPrice, 'Đơn giá');
    const amount = unitPrice * BigInt(quantity);
    const depositAmount = toVnd(input.depositAmount ?? 0, 'Tiền cọc', { allowZero: true });
    const paidAmount = toVnd(input.paidAmount ?? 0, 'Tiền thu khi duyệt', { allowZero: true });

    // RENT thu 1 lần = doanh thu qua applyHandover(RENT, đơn giá) → KHÔNG dùng paidAmount (chống thu 2 lần).
    if (handoverKind === 'RENT' && paidAmount > 0n) throw new ReqAbort({ ok: false, error: 'VALIDATION', message: 'Cho thuê thu tiền qua đơn giá thuê khi duyệt — không nhập "tiền thu khi duyệt".' });
    if (paidAmount > amount) throw new ReqAbort({ ok: false, error: 'VALIDATION', message: 'Tiền thu khi duyệt không được lớn hơn thành tiền (đơn giá × số lượng).' });

    // Khách bắt buộc + tồn tại.
    if (!input.customerId) throw new ReqAbort({ ok: false, error: 'VALIDATION', message: 'Phải chọn khách hàng.' });
    const cust = await db.customer.findFirst({ where: { id: input.customerId, deletedAt: null }, select: { id: true } });
    if (!cust) throw new ReqAbort({ ok: false, error: 'NOT_FOUND', message: 'Khách hàng không tồn tại (hoặc đã bị xóa).' });

    // Ngân hàng: bắt buộc cho TID (khớp khi duyệt); tùy chọn cho POS. Tồn tại nếu có.
    if (kind === 'TID' && !input.bankId) throw new ReqAbort({ ok: false, error: 'VALIDATION', message: 'Yêu cầu TID phải chọn ngân hàng (khớp TID khi duyệt).' });
    if (input.bankId) {
      const bank = await db.bank.findFirst({ where: { id: input.bankId, deletedAt: null }, select: { id: true } });
      if (!bank) throw new ReqAbort({ ok: false, error: 'NOT_FOUND', message: 'Ngân hàng không tồn tại.' });
    }
    // Đối tác: bắt buộc cho TID (khớp khi duyệt); tùy chọn cho POS. Tồn tại nếu có.
    if (kind === 'TID' && !input.partnerId) throw new ReqAbort({ ok: false, error: 'VALIDATION', message: 'Yêu cầu TID phải chọn đối tác (khớp TID khi duyệt).' });
    if (input.partnerId) {
      const partner = await db.partner.findFirst({ where: { id: input.partnerId, deletedAt: null }, select: { id: true } });
      if (!partner) throw new ReqAbort({ ok: false, error: 'NOT_FOUND', message: 'Đối tác không tồn tại.' });
    }
    // Loại thẻ / loại phí (metadata) — tồn tại nếu có.
    if (input.cardTypeId) {
      const ct = await db.cardType.findFirst({ where: { id: input.cardTypeId, deletedAt: null }, select: { id: true } });
      if (!ct) throw new ReqAbort({ ok: false, error: 'NOT_FOUND', message: 'Loại thẻ không tồn tại.' });
    }
    if (input.feeTypeId) {
      const ft = await db.feeType.findFirst({ where: { id: input.feeTypeId, deletedAt: null }, select: { id: true } });
      if (!ft) throw new ReqAbort({ ok: false, error: 'NOT_FOUND', message: 'Loại phí không tồn tại.' });
    }
    // Quỹ: bắt buộc khi có tiền vào (thu SALE / cọc / thuê). Tồn tại nếu có.
    const needsFund = paidAmount > 0n || depositAmount > 0n || handoverKind === 'RENT';
    if (needsFund && !input.fundId) throw new ReqAbort({ ok: false, error: 'VALIDATION', message: 'Có thu tiền (bán/thuê/cọc) thì phải chọn quỹ nhận.' });
    if (input.fundId) {
      const fund = await db.fund.findFirst({ where: { id: input.fundId, deletedAt: null }, select: { id: true } });
      if (!fund) throw new ReqAbort({ ok: false, error: 'NOT_FOUND', message: 'Quỹ nhận tiền không tồn tại.' });
    }

    const code = await nextCode('YCXK', db);
    const created = await db.exportRequest.create({
      data: {
        code, kind, handoverKind, withTid, requesterUserId: user.id,
        bankId: input.bankId ?? null, partnerId: input.partnerId ?? null, customerId: input.customerId,
        cardTypeId: input.cardTypeId ?? null, feeTypeId: input.feeTypeId ?? null, priceMode,
        unitPrice, quantity, amount, depositAmount, paidAmount, fundId: input.fundId ?? null,
        status: 'PENDING', note: input.note?.trim() || null
      }
    });
    await writeAudit(db, {
      actorUserId: user.id, action: 'EXPORT_REQUEST_CREATED', targetType: 'ExportRequest', targetId: String(created.id),
      after: auditSnapshot({ code, kind, handoverKind, withTid, quantity, unitPrice: unitPrice.toString(), amount: amount.toString(), customerId: input.customerId })
    });
    return { ok: true, id: created.id };
  } catch (e) {
    if (e instanceof ReqAbort) return e.result;
    throw e;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// DANH SÁCH + KPI
// ═════════════════════════════════════════════════════════════════════════════
export interface ExportRequestDto {
  id: number;
  code: string | null;
  kind: string;
  handoverKind: string;
  withTid: boolean;
  status: string;
  priceMode: string;
  unitPrice: number;
  quantity: number;
  amount: number;
  depositAmount: number;
  paidAmount: number;
  customerId: number;
  customerName: string | null;
  requesterUserId: number;
  requesterName: string | null;
  bankId: number | null;
  bankName: string | null;
  partnerId: number | null;
  feeTypeId: number | null;
  feeTypeName: string | null;
  fundId: number | null;
  note: string | null;
  requestedAt: string;
  decidedBy: number | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  isMine: boolean;
}
export interface ExportRequestKpi {
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
  total: number;
}
export interface ExportRequestFilter {
  status?: string;
  kind?: string;
  mine?: boolean;
}

/** EXPORT_REQUEST_VIEW — danh sách phiếu + KPI đếm theo trạng thái (KPI bỏ qua bộ lọc status, giữ mine/kind). */
export async function listExportRequests(filter: ExportRequestFilter = {}): Promise<{ ok: boolean; data?: ExportRequestDto[]; kpi?: ExportRequestKpi; error?: string; message?: string }> {
  const g = await requirePermission('EXPORT_REQUEST_VIEW', { action: 'EXPORT_REQUEST_VIEW' });
  if (!g.ok) return g;
  const { db, user } = g;
  const baseWhere: Prisma.ExportRequestWhereInput = {
    kind: filter.kind || undefined,
    requesterUserId: filter.mine ? user.id : undefined
  };
  const rows = await db.exportRequest.findMany({
    where: { ...baseWhere, status: filter.status || undefined },
    orderBy: { id: 'desc' }
  });
  // KPI đếm theo trạng thái trên tập mine/kind (KHÔNG áp status filter).
  const kpiRows = await db.exportRequest.groupBy({ by: ['status'], where: baseWhere, _count: true });
  const kpi: ExportRequestKpi = { pending: 0, approved: 0, rejected: 0, cancelled: 0, total: 0 };
  for (const r of kpiRows) {
    const c = r._count;
    kpi.total += c;
    if (r.status === 'PENDING') kpi.pending = c;
    else if (r.status === 'APPROVED') kpi.approved = c;
    else if (r.status === 'REJECTED') kpi.rejected = c;
    else if (r.status === 'CANCELLED') kpi.cancelled = c;
  }

  const custIds = [...new Set(rows.map((r) => r.customerId))];
  const custMap = new Map((await db.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, nickname: true, fullName: true } })).map((c) => [c.id, c.nickname || c.fullName]));
  const userIds = [...new Set(rows.flatMap((r) => [r.requesterUserId, r.decidedBy].filter((x): x is number => x != null)))];
  const userMap = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, username: true } })).map((u) => [u.id, u.fullName || u.username]));
  const bankIds = [...new Set(rows.map((r) => r.bankId).filter((x): x is number => x != null))];
  const bankMap = new Map((await db.bank.findMany({ where: { id: { in: bankIds } }, select: { id: true, code: true, name: true } })).map((b) => [b.id, `${b.code} · ${b.name}`]));
  const feeIds = [...new Set(rows.map((r) => r.feeTypeId).filter((x): x is number => x != null))];
  const feeMap = new Map((await db.feeType.findMany({ where: { id: { in: feeIds } }, select: { id: true, name: true } })).map((f) => [f.id, f.name]));

  const data: ExportRequestDto[] = rows.map((r) => ({
    id: r.id, code: r.code, kind: r.kind, handoverKind: r.handoverKind, withTid: r.withTid, status: r.status,
    priceMode: r.priceMode, unitPrice: Number(r.unitPrice), quantity: r.quantity, amount: Number(r.amount),
    depositAmount: Number(r.depositAmount), paidAmount: Number(r.paidAmount),
    customerId: r.customerId, customerName: custMap.get(r.customerId) ?? null,
    requesterUserId: r.requesterUserId, requesterName: userMap.get(r.requesterUserId) ?? null,
    bankId: r.bankId, bankName: r.bankId != null ? bankMap.get(r.bankId) ?? null : null,
    partnerId: r.partnerId, feeTypeId: r.feeTypeId, feeTypeName: r.feeTypeId != null ? feeMap.get(r.feeTypeId) ?? null : null,
    fundId: r.fundId, note: r.note,
    requestedAt: r.requestedAt.toISOString(),
    decidedBy: r.decidedBy, decidedByName: r.decidedBy != null ? userMap.get(r.decidedBy) ?? null : null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null, decisionNote: r.decisionNote,
    isMine: r.requesterUserId === user.id
  }));
  return { ok: true, data, kpi };
}

// ═════════════════════════════════════════════════════════════════════════════
// DUYỆT — chọn N seri/TID + trừ tiền + tồn kho trong 1 $transaction
// ═════════════════════════════════════════════════════════════════════════════
export interface ApproveLineInput {
  seq: number; // 1..N (khớp quantity, không trùng)
  posSerial?: string | null;
  tid?: string | null;
}

/** Địa chỉ HIỆU LỰC của kho trong tx (mirror pos-service): manager address ưu tiên, else address cột kho. */
async function warehouseEffAddressTx(tx: PrismaTx, warehouseId: number): Promise<string | null> {
  const wh = await tx.warehouse.findFirst({ where: { id: warehouseId, deletedAt: null }, select: { address: true, managerUserId: true } });
  if (!wh) return null;
  if (wh.managerUserId != null) {
    const u = await tx.user.findUnique({ where: { id: wh.managerUserId }, select: { address: true } });
    return u?.address ?? null;
  }
  return wh.address;
}

interface ReqRow {
  id: number; kind: string; handoverKind: string; withTid: boolean; bankId: number | null;
  partnerId: number | null; customerId: number; unitPrice: bigint; quantity: number;
  depositAmount: bigint; fundId: number | null;
}

/** Gán TID KÈM MÁY (mirror tid-service.assignTid, KHÔNG money — tiền áp riêng ở caller). dev đã khóa FOR UPDATE. */
async function assignTidLineTx(
  tx: PrismaTx,
  a: { tid: string; serial: string; customerId: number; occurredAt: Date; actorId: number }
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM tids WHERE tid = ${a.tid} FOR UPDATE`;
  const row = await tx.tid.findUnique({ where: { tid: a.tid } });
  if (!row || row.deletedAt) throw new ReqAbort({ ok: false, error: 'NOT_FOUND', message: `Không tìm thấy TID "${a.tid}" (giao kèm máy).` });
  const decision = decideTidTransition(row.status as TidStatus, 'assign');
  if (!decision.allowed) throw new ReqAbort({ ok: false, error: 'INVALID_STATE', message: `TID "${a.tid}" ở trạng thái ${row.status} không gán được (đã chết/đóng/thu hồi).` });
  if (row.posSerial != null) throw new ReqAbort({ ok: false, error: 'TID_ON_DEVICE', message: `TID "${a.tid}" đang gắn trên máy ${row.posSerial}.` });
  const dev = await tx.posDevice.findUnique({ where: { serial: a.serial } });
  if (!dev) throw new ReqAbort({ ok: false, error: 'NOT_FOUND', message: `Không tìm thấy máy POS "${a.serial}".` });
  if (dev.currentTid != null && dev.currentTid !== a.tid) throw new ReqAbort({ ok: false, error: 'DEVICE_HAS_TID', message: `Máy ${a.serial} đang gắn TID ${dev.currentTid}.` });
  // Cài APP — TID phải cùng ngân hàng app máy (mirror assignTid).
  if (dev.bankId == null) throw new ReqAbort({ ok: false, error: 'MACHINE_BLANK', message: `Máy POS "${a.serial}" là máy trắng (chưa cài app ngân hàng).` });
  if (dev.bankId !== row.bankId) throw new ReqAbort({ ok: false, error: 'BANK_MISMATCH', message: `Bank của TID "${a.tid}" không khớp app ngân hàng trên máy "${a.serial}".` });
  const devAgentId = dev.currentAgentId ?? null;
  await tx.tid.update({ where: { id: row.id }, data: { status: 'ACTIVE', posSerial: a.serial, customerId: a.customerId, agentId: devAgentId } });
  const posPatch: Record<string, unknown> = { currentTid: a.tid, currentCustomerId: a.customerId, updatedBy: a.actorId };
  if (dev.status === 'IN_STOCK') posPatch.status = 'DEPLOYED';
  await tx.posDevice.update({ where: { id: dev.id }, data: posPatch });
  await tx.posTidBinding.create({ data: { posSerial: a.serial, tid: a.tid, boundAt: a.occurredAt } });
  await tx.assetEvent.create({
    data: {
      deviceSerial: a.serial, tid: a.tid, eventType: decision.eventType!, fromState: row.status, toState: 'ACTIVE',
      customerId: a.customerId, toAgentId: devAgentId, actorUserId: a.actorId, occurredAt: a.occurredAt,
      note: 'Giao kèm TID (duyệt yêu cầu xuất kho)', afterJson: JSON.stringify(auditSnapshot({ tid: a.tid, posSerial: a.serial, status: 'ACTIVE' }))
    }
  });
}

/** Xử lý 1 dòng POS khi duyệt: validate máy IN_STOCK + kho có địa chỉ + bank khớp + currentTid null, rồi
 *  SALE (sell + bookSaleCashEntries) hoặc RENT (deploy + applyHandover RENT). withTid → gán TID trước. */
async function processPosLineTx(tx: PrismaTx, req: ReqRow, serial: string, tid: string | null, allocPaid: bigint, occurredAt: Date, actorId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM pos_devices WHERE serial = ${serial} FOR UPDATE`;
  let dev = await tx.posDevice.findUnique({ where: { serial } });
  if (!dev || dev.deletedAt) throw new ReqAbort({ ok: false, error: 'NOT_FOUND', message: `Không tìm thấy máy POS serial "${serial}".` });
  if (dev.status !== 'IN_STOCK') throw new ReqAbort({ ok: false, error: 'INVALID_STATE', message: `Máy POS "${serial}" đang ở trạng thái ${dev.status} — chỉ xuất kho máy đang TRONG KHO (IN_STOCK).` });
  if (dev.currentTid != null) throw new ReqAbort({ ok: false, error: 'DEVICE_HAS_TID', message: `Máy POS "${serial}" đang gắn TID ${dev.currentTid} — không xuất kho được.` });
  if (req.bankId != null && dev.bankId !== req.bankId) throw new ReqAbort({ ok: false, error: 'BANK_MISMATCH', message: `App ngân hàng trên máy "${serial}" không khớp ngân hàng của yêu cầu.` });
  // Kho có địa chỉ cụ thể (máy rời kho phải xuất từ 1 kho có địa chỉ — mirror deploy #5).
  if (dev.warehouseId == null) throw new ReqAbort({ ok: false, error: 'NO_WAREHOUSE', message: `Máy POS "${serial}" chưa thuộc kho nào — máy phải ở kho có địa chỉ mới xuất được.` });
  const effAddr = await warehouseEffAddressTx(tx, dev.warehouseId);
  if (!(effAddr && effAddr.trim())) throw new ReqAbort({ ok: false, error: 'WAREHOUSE_NO_ADDRESS', message: `Kho của máy "${serial}" chưa có địa chỉ cụ thể (kiểm tra User quản lý kho).` });

  // withTid → gán TID kèm máy TRƯỚC (máy → DEPLOYED, currentTid set). Re-đọc dev sau gán.
  if (req.withTid) {
    if (!tid) throw new ReqAbort({ ok: false, error: 'VALIDATION', message: `Dòng máy "${serial}" giao kèm TID nhưng chưa nhập TID.` });
    await assignTidLineTx(tx, { tid, serial, customerId: req.customerId, occurredAt, actorId });
    dev = await tx.posDevice.findUnique({ where: { serial } });
    if (!dev) throw new ReqAbort({ ok: false, error: 'NOT_FOUND', message: `Máy POS "${serial}" biến mất sau khi gán TID.` });
  }
  const srcWhId = dev.warehouseId; // kho xuất (nguồn sự thật)

  if (req.handoverKind === 'SALE') {
    const decision = decidePosTransition(dev.status as PosStatus, 'sell');
    if (!decision.allowed) throw new ReqAbort({ ok: false, error: 'INVALID_STATE', message: `Không thể bán máy "${serial}" ở trạng thái ${dev.status}.` });
    const code = await nextCode('BS', tx);
    const sale = await tx.deviceSale.create({
      data: {
        code, saleKind: 'POS', deviceSerial: serial, tid: dev.currentTid, customerId: req.customerId,
        salePrice: req.unitPrice, warehouseId: srcWhId, soldByUserId: actorId, occurredAt,
        note: 'Xuất kho (duyệt yêu cầu)', status: 'POSTED', createdBy: actorId
      }
    });
    // TID bán kèm (nếu có currentTid từ withTid) → SOLD, đóng binding, sang khách mua (mirror sellPos).
    if (dev.currentTid) {
      const trow = await tx.tid.findUnique({ where: { tid: dev.currentTid } });
      if (trow) {
        const td = decideTidTransition(trow.status as TidStatus, 'sell');
        const toTid = td.allowed ? td.to! : 'SOLD';
        await tx.tid.update({ where: { id: trow.id }, data: { status: toTid, posSerial: null, agentId: null, customerId: req.customerId } });
        await tx.posTidBinding.updateMany({ where: { posSerial: serial, tid: dev.currentTid, unboundAt: null }, data: { unboundAt: occurredAt, unbindReason: 'SOLD' } });
        await tx.assetEvent.create({ data: { deviceSerial: serial, tid: dev.currentTid, eventType: 'TID_SELL', fromState: trow.status, toState: toTid, customerId: req.customerId, actorUserId: actorId, occurredAt, note: `Bán kèm máy (${code})`, afterJson: JSON.stringify(auditSnapshot({ tid: dev.currentTid, soldWith: serial, status: toTid })) } });
      }
    }
    const fromState = dev.status;
    await tx.posDevice.update({ where: { id: dev.id }, data: { status: 'SOLD', currentTid: null, currentCustomerId: req.customerId, currentAgentId: null, recallPending: false, warehouseId: null, updatedBy: actorId } });
    await tx.assetEvent.create({ data: { deviceSerial: serial, tid: null, eventType: decision.eventType!, fromState, toState: 'SOLD', customerId: req.customerId, actorUserId: actorId, occurredAt, fromWarehouseId: srcWhId, deliveryAddress: effAddr, note: 'Xuất kho bán (duyệt yêu cầu)', afterJson: JSON.stringify(auditSnapshot({ sale: code, salePrice: req.unitPrice.toString(), customerId: req.customerId })) } });
    // MONEY-MODEL TÁI DÙNG: doanh thu đủ (accrual) + tiền thu ngay (allocPaid) + settlement.
    await bookSaleCashEntries(tx, { saleId: sale.id, saleKind: 'POS', salePrice: req.unitPrice, paid: allocPaid, fundId: req.fundId ?? null, method: DEFAULT_METHOD, entryDate: occurredAt, customerId: req.customerId, userId: actorId });
    return;
  }

  // RENT — giao thuê. withTid=false → deploy (IN_STOCK→DEPLOYED); withTid=true → assign đã đưa về DEPLOYED.
  if (!req.withTid) {
    const decision = decidePosTransition(dev.status as PosStatus, 'deploy');
    if (!decision.allowed) throw new ReqAbort({ ok: false, error: 'INVALID_STATE', message: `Không thể giao thuê máy "${serial}" ở trạng thái ${dev.status}.` });
    const fromState = dev.status;
    await tx.posDevice.update({ where: { id: dev.id }, data: { status: 'DEPLOYED', currentCustomerId: req.customerId, recallPending: false, warehouseId: null, updatedBy: actorId } });
    await tx.assetEvent.create({ data: { deviceSerial: serial, tid: null, eventType: decision.eventType!, fromState, toState: 'DEPLOYED', customerId: req.customerId, actorUserId: actorId, occurredAt, fromWarehouseId: srcWhId, deliveryAddress: effAddr, note: 'Xuất kho cho thuê (duyệt yêu cầu)', afterJson: JSON.stringify(auditSnapshot({ status: 'DEPLOYED', customerId: req.customerId })) } });
  }
  // MONEY-MODEL TÁI DÙNG: doanh thu cho thuê 1 lần = đơn giá vào quỹ (RENT).
  await applyHandoverTx(tx, { moneyKind: 'RENT', handoverTypeId: null, amount: req.unitPrice, fundId: req.fundId ?? null, method: DEFAULT_METHOD, deviceSerial: serial, tid: dev.currentTid, customerId: req.customerId, occurredAt, actorId });
}

/** Xử lý 1 dòng TID (kind TID, withTid=false): validate TID chưa giao + bank khớp + đối tác khớp → markTidDelivered. */
async function processTidLineTx(tx: PrismaTx, req: ReqRow, tid: string, allocPaid: bigint, occurredAt: Date, actorId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM tids WHERE tid = ${tid} FOR UPDATE`;
  const row = await tx.tid.findUnique({ where: { tid } });
  if (!row || row.deletedAt) throw new ReqAbort({ ok: false, error: 'NOT_FOUND', message: `Không tìm thấy TID "${tid}".` });
  if (row.deliveredAt != null) throw new ReqAbort({ ok: false, error: 'ALREADY_DELIVERED', message: `TID "${tid}" đã được giao trước đó.` });
  if (req.bankId != null && row.bankId !== req.bankId) throw new ReqAbort({ ok: false, error: 'BANK_MISMATCH', message: `Ngân hàng của TID "${tid}" không khớp yêu cầu.` });
  if (req.partnerId != null && row.partnerId !== req.partnerId) throw new ReqAbort({ ok: false, error: 'PARTNER_MISMATCH', message: `Đối tác của TID "${tid}" không khớp yêu cầu.` });
  const customerId = req.customerId;
  const toAgentId = row.agentId ?? null;
  await tx.tid.update({ where: { id: row.id }, data: { deliveredAt: occurredAt, customerId, agentId: toAgentId } });
  await tx.assetEvent.create({
    data: {
      deviceSerial: row.posSerial, tid, eventType: 'TID_DELIVERED', fromState: row.status, toState: row.status,
      customerId, toAgentId, actorUserId: actorId, occurredAt, note: 'Giao TID (duyệt yêu cầu xuất kho)'
    }
  });
  // #2 (Mr.Long "Bán TID có doanh thu") — money-model TÁI DÙNG: SALE → chứng từ bán TID (SALE_TID) + doanh thu
  // accrual + thu ngay (mirror sellTid); RENT → doanh thu cho thuê 1 lần = đơn giá (applyHandover RENT).
  if (req.handoverKind === 'SALE') {
    const code = await nextCode('BS', tx);
    const sale = await tx.deviceSale.create({
      data: {
        code, saleKind: 'TID', deviceSerial: row.posSerial, tid, customerId, salePrice: req.unitPrice,
        warehouseId: null, soldByUserId: actorId, occurredAt, note: 'Bán TID (duyệt yêu cầu xuất kho)', status: 'POSTED', createdBy: actorId
      }
    });
    await bookSaleCashEntries(tx, { saleId: sale.id, saleKind: 'TID', salePrice: req.unitPrice, paid: allocPaid, fundId: req.fundId ?? null, method: DEFAULT_METHOD, entryDate: occurredAt, customerId, userId: actorId });
  } else {
    await applyHandoverTx(tx, { moneyKind: 'RENT', handoverTypeId: null, amount: req.unitPrice, fundId: req.fundId ?? null, method: DEFAULT_METHOD, deviceSerial: row.posSerial, tid, customerId, occurredAt, actorId });
  }
}

/** EXPORT_REQUEST_APPROVE — duyệt phiếu: chọn N seri/TID + trừ tiền/tồn kho trong 1 $transaction guard PENDING.
 *  Self-duyệt CHỈ Admin (elevated) — chốt = nhập mật khẩu. Dòng bất hợp lệ → ABORT toàn bộ (không nửa vời). */
export async function approveExportRequest(requestId: number, lines: ApproveLineInput[], password: string, note?: string): Promise<MutationResult> {
  const g = await requirePermission('EXPORT_REQUEST_APPROVE', { action: 'EXPORT_REQUEST_APPROVED', targetType: 'ExportRequest', targetId: String(requestId) });
  if (!g.ok) return g;
  const { db, user } = g;

  const req = await db.exportRequest.findUnique({ where: { id: requestId } });
  if (!req) return { ok: false, error: 'NOT_FOUND', message: 'Yêu cầu xuất kho không tồn tại.' };
  if (req.status !== 'PENDING') return { ok: false, error: 'INVALID_STATE', message: 'Yêu cầu đã được xử lý (không còn chờ duyệt).' };

  // Phân vai (mirror entity-cancel 0.2.24): người TẠO ≠ người DUYỆT, trừ Admin (elevated) tự duyệt được.
  const isSelf = user.id === req.requesterUserId;
  const elevated = user.roles.includes(ADMIN_ROLE_CODE);
  let selfNote: string | null = null;
  if (isSelf) {
    if (elevated) selfNote = 'Admin tự duyệt (đã nhập mật khẩu)';
    else {
      await writeAudit(db, { actorUserId: user.id, action: 'EXPORT_REQUEST_APPROVED', targetType: 'ExportRequest', targetId: String(requestId), after: { denied: true, reason: 'SELF_APPROVAL_FORBIDDEN' } });
      return { ok: false, error: 'SELF_APPROVAL_FORBIDDEN', message: 'Chỉ Admin mới được tự duyệt yêu cầu của chính mình.' };
    }
  }
  // Mật khẩu người DUYỆT (chốt kiểm soát).
  if (!(await verifyActorPassword(user, password ?? ''))) {
    await writeAudit(db, { actorUserId: user.id, action: 'EXPORT_REQUEST_APPROVED', targetType: 'ExportRequest', targetId: String(requestId), after: { denied: true, reason: 'WRONG_PASSWORD' } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }

  // Validate SỐ DÒNG = số lượng + seq 1..N duy nhất.
  const arr = Array.isArray(lines) ? lines : [];
  if (arr.length !== req.quantity) return { ok: false, error: 'VALIDATION', message: `Phải chọn đúng ${req.quantity} đơn vị (đang có ${arr.length} dòng).` };
  const seqs = new Set<number>();
  for (const l of arr) {
    if (!Number.isInteger(l.seq) || l.seq < 1 || l.seq > req.quantity) return { ok: false, error: 'VALIDATION', message: `Số thứ tự dòng phải trong 1..${req.quantity}.` };
    if (seqs.has(l.seq)) return { ok: false, error: 'VALIDATION', message: `Số thứ tự dòng ${l.seq} bị trùng.` };
    seqs.add(l.seq);
    if (req.kind === 'POS' && !l.posSerial?.trim()) return { ok: false, error: 'VALIDATION', message: `Dòng ${l.seq}: phải chọn serial máy POS.` };
    if (req.kind === 'TID' && !l.tid?.trim()) return { ok: false, error: 'VALIDATION', message: `Dòng ${l.seq}: phải chọn TID.` };
    if (req.kind === 'POS' && req.withTid && !l.tid?.trim()) return { ok: false, error: 'VALIDATION', message: `Dòng ${l.seq}: giao kèm TID nhưng chưa chọn TID.` };
  }
  // Chống trùng serial/TID giữa các dòng (2 dòng cùng 1 máy).
  const posSerials = arr.map((l) => l.posSerial?.trim()).filter((x): x is string => !!x);
  if (new Set(posSerials).size !== posSerials.length) return { ok: false, error: 'VALIDATION', message: 'Có serial máy bị chọn trùng ở nhiều dòng.' };
  const tids = arr.map((l) => l.tid?.trim()).filter((x): x is string => !!x);
  if (new Set(tids).size !== tids.length) return { ok: false, error: 'VALIDATION', message: 'Có TID bị chọn trùng ở nhiều dòng.' };

  const sorted = [...arr].sort((a, b) => a.seq - b.seq);
  const reqRow: ReqRow = {
    id: req.id, kind: req.kind, handoverKind: req.handoverKind, withTid: req.withTid, bankId: req.bankId,
    partnerId: req.partnerId, customerId: req.customerId, unitPrice: req.unitPrice, quantity: req.quantity,
    depositAmount: req.depositAmount, fundId: req.fundId
  };
  // Phân bổ paidAmount xuống các dòng SALE (POS hoặc TID) — giữ Σ = paidAmount; mỗi dòng ≤ đơn giá.
  const allocPaid = new Map<number, bigint>();
  if (req.handoverKind === 'SALE') {
    let remaining = req.paidAmount;
    for (const l of sorted) {
      const a = remaining > req.unitPrice ? req.unitPrice : remaining;
      allocPaid.set(l.seq, a);
      remaining -= a;
    }
  }
  const occurredAt = new Date();
  const decidedNote = [note?.trim() || null, selfNote].filter(Boolean).join(' · ') || null;

  try {
    await withRetry(async () => {
      await db.$transaction(async (tx) => {
        // Khóa phiếu + re-đọc trạng thái (chống double-approve).
        await tx.$queryRaw`SELECT id FROM export_requests WHERE id = ${requestId} FOR UPDATE`;
        const fresh = await tx.exportRequest.findUnique({ where: { id: requestId }, select: { status: true } });
        if (!fresh || fresh.status !== 'PENDING') throw new ReqAbort({ ok: false, error: 'ALREADY_DECIDED', message: 'Yêu cầu đã được xử lý (không còn chờ duyệt).' });

        for (const l of sorted) {
          if (reqRow.kind === 'POS') await processPosLineTx(tx, reqRow, l.posSerial!.trim(), l.tid?.trim() ?? null, allocPaid.get(l.seq) ?? 0n, occurredAt, user.id);
          else await processTidLineTx(tx, reqRow, l.tid!.trim(), allocPaid.get(l.seq) ?? 0n, occurredAt, user.id);
        }

        // Cọc kèm phiếu (1 lần/phiếu) → DeviceDeposit(OPEN) + CashEntry DEPOSIT (KHÔNG doanh thu).
        if (reqRow.depositAmount > 0n) {
          if (reqRow.fundId == null) throw new ReqAbort({ ok: false, error: 'VALIDATION', message: 'Có tiền cọc thì phải có quỹ nhận.' });
          await openDepositTx(tx, { customerId: reqRow.customerId, deviceSerial: null, tid: null, handoverTypeId: null, amount: reqRow.depositAmount, fundId: reqRow.fundId, method: DEFAULT_METHOD, occurredAt, actorId: user.id, note: `Cọc kèm yêu cầu xuất kho ${req.code ?? req.id}` });
        }

        // Ghi N dòng ExportRequestLine (seri/TID đã gán) + chuyển phiếu APPROVED (guard PENDING backstop).
        for (const l of sorted) {
          await tx.exportRequestLine.create({ data: { exportRequestId: req.id, seq: l.seq, posSerial: l.posSerial?.trim() || null, tid: l.tid?.trim() || null } });
        }
        const moved = await tx.exportRequest.updateMany({ where: { id: req.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedBy: user.id, decidedAt: occurredAt, decisionNote: decidedNote } });
        if (moved.count === 0) throw new ReqAbort({ ok: false, error: 'ALREADY_DECIDED', message: 'Yêu cầu đã được xử lý.' });
      });
    });
  } catch (e) {
    if (e instanceof ReqAbort) return e.result;
    throw e;
  }

  await writeAudit(db, {
    actorUserId: user.id, action: 'EXPORT_REQUEST_APPROVED', targetType: 'ExportRequest', targetId: String(req.id),
    after: auditSnapshot({ code: req.code, kind: req.kind, handoverKind: req.handoverKind, quantity: req.quantity, lines: sorted.map((l) => ({ seq: l.seq, posSerial: l.posSerial ?? null, tid: l.tid ?? null })), note: decidedNote })
  });
  return { ok: true, id: req.id };
}

/** EXPORT_REQUEST_APPROVE — từ chối phiếu PENDING (bắt buộc lý do). Không động tiền/kho. */
export async function rejectExportRequest(requestId: number, note: string): Promise<MutationResult> {
  const g = await requirePermission('EXPORT_REQUEST_APPROVE', { action: 'EXPORT_REQUEST_REJECTED', targetType: 'ExportRequest', targetId: String(requestId) });
  if (!g.ok) return g;
  const { db, user } = g;
  const reason = (note ?? '').trim();
  if (!reason) return { ok: false, error: 'VALIDATION', message: 'Vui lòng nhập lý do từ chối.' };
  const req = await db.exportRequest.findUnique({ where: { id: requestId }, select: { id: true, status: true, code: true } });
  if (!req) return { ok: false, error: 'NOT_FOUND', message: 'Yêu cầu xuất kho không tồn tại.' };
  if (req.status !== 'PENDING') return { ok: false, error: 'INVALID_STATE', message: 'Yêu cầu đã được xử lý.' };
  const moved = await db.exportRequest.updateMany({ where: { id: requestId, status: 'PENDING' }, data: { status: 'REJECTED', decidedBy: user.id, decidedAt: new Date(), decisionNote: reason } });
  if (moved.count === 0) return { ok: false, error: 'INVALID_STATE', message: 'Yêu cầu đã được xử lý.' };
  await writeAudit(db, { actorUserId: user.id, action: 'EXPORT_REQUEST_REJECTED', targetType: 'ExportRequest', targetId: String(requestId), after: auditSnapshot({ code: req.code, note: reason }) });
  return { ok: true, id: requestId };
}

/** EXPORT_REQUEST_CREATE — người TẠO tự hủy phiếu PENDING của mình (hoặc người có quyền duyệt hủy giúp). */
export async function cancelExportRequest(requestId: number, note?: string): Promise<MutationResult> {
  const g = await requirePermission('EXPORT_REQUEST_CREATE', { action: 'EXPORT_REQUEST_CANCELLED', targetType: 'ExportRequest', targetId: String(requestId) });
  if (!g.ok) return g;
  const { db, user } = g;
  const req = await db.exportRequest.findUnique({ where: { id: requestId }, select: { id: true, status: true, code: true, requesterUserId: true } });
  if (!req) return { ok: false, error: 'NOT_FOUND', message: 'Yêu cầu xuất kho không tồn tại.' };
  if (req.requesterUserId !== user.id && !hasPermission(user, 'EXPORT_REQUEST_APPROVE')) {
    return { ok: false, error: 'FORBIDDEN', message: 'Chỉ người tạo phiếu (hoặc người có quyền duyệt) mới hủy được.' };
  }
  if (req.status !== 'PENDING') return { ok: false, error: 'INVALID_STATE', message: 'Chỉ hủy được phiếu đang chờ duyệt.' };
  const moved = await db.exportRequest.updateMany({ where: { id: requestId, status: 'PENDING' }, data: { status: 'CANCELLED', decidedBy: user.id, decidedAt: new Date(), decisionNote: note?.trim() || null } });
  if (moved.count === 0) return { ok: false, error: 'INVALID_STATE', message: 'Yêu cầu đã được xử lý.' };
  await writeAudit(db, { actorUserId: user.id, action: 'EXPORT_REQUEST_CANCELLED', targetType: 'ExportRequest', targetId: String(requestId), after: auditSnapshot({ code: req.code, note: note?.trim() || null }) });
  return { ok: true, id: requestId };
}
