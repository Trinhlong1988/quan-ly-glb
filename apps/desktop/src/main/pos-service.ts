// POS device service (main). IMS_SPEC §A. Event-sourced lifecycle: every transition writes an
// immutable asset_event (with occurredAt = real operation time) + updates the projected status,
// and also writes a governance audit row. Permission-guarded (POS_VIEW / POS_MANAGE), R_UX_WARN.
import { decidePosTransition, decideTidTransition, auditSnapshot, type PosEvent, type PosStatus, type TidStatus } from '@glb/business-rules';
import { Prisma } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { dateRange } from './customer-service.js';
import { staleGuard } from './optimistic-lock.js';
import { resolveHandoverInput, buildHandoverContext } from './handover-service.js';
import { applyHandoverTx, refundOpenDepositsForSerialTx, type HandoverContext } from './deposit-service.js';

export interface PosDto {
  id: number;
  serial: string;
  model: string | null;
  bank: string | null;
  // Cài APP (Mr.Long 13/7) — app ngân hàng đã cài trên máy (FK Bank). null = MÁY TRẮNG (chưa cài app).
  // Gán TID chỉ được khi bank của TID trùng bankId này (máy trắng KHÔNG gán được — phải Sửa máy chọn app trước).
  bankId: number | null;
  bankCode: string | null; // mã ngân hàng app (AB/VP/MB…) để hiển thị cột "Cài APP"
  status: string;
  currentAgentId: number | null;
  currentCustomerId: number | null;
  currentTid: string | null;
  warehouseLoc: string | null;
  warehouseId: number | null; // Model 1 — kho vật lý đang chứa máy (chỉ khi IN_STOCK)
  warehouseName: string | null; // "MÃ · Tên" kho hiện tại
  recallPending: boolean; // #6 — khách đã hủy, máy chưa thu về (còn ở khách)
  note: string | null;
  createdAt: string;
  // ── PHASE K1 — cột nhập di trú (§2.3) để hiển thị cạnh trạng thái vận hành ──
  posModelId: number | null;
  posModelName: string | null; // "MÃ · Tên" chủng loại
  supplierId: number | null;
  supplierName: string | null;
  importPrice: number | null;
  importedAt: string | null;
  customerName: string | null; // tên khách đang giữ máy (currentCustomerId)
  agentName: string | null; // tên đại lý (currentAgentId)
}

export interface TimelineEventDto {
  id: number;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  fromAgentId: number | null;
  toAgentId: number | null;
  customerId: number | null;
  customerName: string | null; // tên khách của sự kiện (giao/đổi-khách/bán) — biệt danh||họ tên
  actorUserId: number | null;
  actorName: string | null; // AI thao tác sự kiện — họ tên||tài khoản
  occurredAt: string;
  note: string | null;
  tid: string | null;
  fromWarehouseId: number | null; // R27 — kho xuất (giao/đổi-khách)
  warehouseName: string | null; // "MÃ · Tên" kho
  deliveryAddress: string | null; // địa chỉ giao (snapshot theo kho lúc giao)
  // LOẠI GIAO MÁY (Mr.Long) — deploy/gán-TID: loại giao + số tiền (hiển thị "giao hình thức gì, bao nhiêu").
  handoverTypeId: number | null;
  handoverName: string | null;
  handoverAmount: number | null;
}

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

export interface PosFilter {
  search?: string;
  bank?: string;
  status?: string;
  agentId?: number;
  warehouseId?: number; // Model 1 — lọc theo kho vật lý đang chứa máy
  bankId?: number; // Cài APP — lọc máy đã cài app ngân hàng cụ thể
  bankBlank?: boolean; // Cài APP — lọc MÁY TRẮNG (bankId = null)
  fromDate?: string;
  toDate?: string;
}

interface PosDeviceRow {
  id: number;
  serial: string;
  model: string | null;
  bank: string | null;
  bankId: number | null;
  status: string;
  currentAgentId: number | null;
  currentCustomerId: number | null;
  currentTid: string | null;
  warehouseLoc: string | null;
  warehouseId: number | null;
  recallPending: boolean;
  note: string | null;
  createdAt: Date;
  posModelId: number | null;
  supplierId: number | null;
  importPrice: number | null;
  importedAt: Date | null;
}
interface PosNameMaps {
  models: Map<number, { code: string; name: string }>;
  suppliers: Map<number, { code: string; name: string }>;
  customers: Map<number, string>;
  agents: Map<number, string>;
  warehouses: Map<number, string>;
  banks: Map<number, string>; // Cài APP — mã ngân hàng (code)
}
function toDto(d: PosDeviceRow, maps: PosNameMaps): PosDto {
  const m = d.posModelId != null ? maps.models.get(d.posModelId) : undefined;
  const s = d.supplierId != null ? maps.suppliers.get(d.supplierId) : undefined;
  return {
    id: d.id,
    serial: d.serial,
    model: d.model,
    bank: d.bank,
    bankId: d.bankId,
    bankCode: d.bankId != null ? maps.banks.get(d.bankId) ?? null : null,
    status: d.status,
    currentAgentId: d.currentAgentId,
    currentCustomerId: d.currentCustomerId,
    currentTid: d.currentTid,
    warehouseLoc: d.warehouseLoc,
    warehouseId: d.warehouseId,
    warehouseName: d.warehouseId != null ? maps.warehouses.get(d.warehouseId) ?? null : null,
    recallPending: d.recallPending,
    note: d.note,
    createdAt: d.createdAt.toISOString(),
    posModelId: d.posModelId,
    posModelName: m ? `${m.code} · ${m.name}` : d.model,
    supplierId: d.supplierId,
    supplierName: s ? `${s.code} · ${s.name}` : null,
    importPrice: d.importPrice,
    importedAt: d.importedAt ? d.importedAt.toISOString() : null,
    customerName: d.currentCustomerId != null ? maps.customers.get(d.currentCustomerId) ?? null : null,
    agentName: d.currentAgentId != null ? maps.agents.get(d.currentAgentId) ?? null : null
  };
}

/** POS_VIEW — list devices with search (serial) + bank/status/agent filters. */
export async function listPosDevices(
  filter: PosFilter = {}
): Promise<{ ok: boolean; data?: PosDto[]; error?: string; message?: string }> {
  const g = await requirePermission('POS_VIEW', { action: 'POS_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.posDevice.findMany({
    where: {
      deletedAt: null,
      bank: filter.bank || undefined,
      status: filter.status || undefined,
      currentAgentId: filter.agentId ?? undefined,
      warehouseId: filter.warehouseId ?? undefined,
      // Cài APP — lọc theo app ngân hàng: bankId cụ thể HOẶC máy trắng (bankId null). Không truyền cả 2.
      bankId: filter.bankBlank ? null : (filter.bankId ?? undefined),
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search
        ? [{ serial: { contains: filter.search, mode: 'insensitive' } }, { currentTid: { contains: filter.search, mode: 'insensitive' } }]
        : undefined
    },
    orderBy: { id: 'asc' }
  });
  // Resolve FK names (chủng loại / NCC / khách / đại lý / kho) — join ở service layer (resilient soft-delete).
  const modelIds = [...new Set(rows.map((r) => r.posModelId).filter((x): x is number => x != null))];
  const supplierIds = [...new Set(rows.map((r) => r.supplierId).filter((x): x is number => x != null))];
  const customerIds = [...new Set(rows.map((r) => r.currentCustomerId).filter((x): x is number => x != null))];
  const agentIds = [...new Set(rows.map((r) => r.currentAgentId).filter((x): x is number => x != null))];
  const whIds = [...new Set(rows.map((r) => r.warehouseId).filter((x): x is number => x != null))];
  const bankIds = [...new Set(rows.map((r) => r.bankId).filter((x): x is number => x != null))];
  const maps: PosNameMaps = {
    models: new Map((await g.db.posModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, code: true, name: true } })).map((x) => [x.id, { code: x.code, name: x.name }])),
    suppliers: new Map((await g.db.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, code: true, name: true } })).map((x) => [x.id, { code: x.code, name: x.name }])),
    customers: new Map((await g.db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, nickname: true, fullName: true } })).map((x) => [x.id, x.nickname || x.fullName])),
    agents: new Map((await g.db.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })).map((x) => [x.id, x.name])),
    warehouses: new Map((await g.db.warehouse.findMany({ where: { id: { in: whIds } }, select: { id: true, code: true, name: true } })).map((x) => [x.id, `${x.code} · ${x.name}`])),
    banks: new Map((await g.db.bank.findMany({ where: { id: { in: bankIds } }, select: { id: true, code: true } })).map((x) => [x.id, x.code]))
  };
  return { ok: true, data: rows.map((r) => toDto(r, maps)) };
}

/** POS_VIEW — the immutable timeline for one device, oldest → newest (§A4). */
export async function getDeviceTimeline(
  serial: string
): Promise<{ ok: boolean; data?: TimelineEventDto[]; error?: string; message?: string }> {
  const g = await requirePermission('POS_VIEW', { action: 'POS_VIEW' });
  if (!g.ok) return g;
  const dev = await g.db.posDevice.findUnique({ where: { serial } });
  if (!dev) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy máy POS serial "${serial}".` };
  const events = await g.db.assetEvent.findMany({
    where: { deviceSerial: serial },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }]
  });
  // Resolve tên kho + tên khách + tên người thao tác (join tại service layer — batch, KHÔNG N+1).
  const whIds = [...new Set(events.map((e) => e.fromWarehouseId).filter((x): x is number => x != null))];
  const whMap = new Map(
    (await g.db.warehouse.findMany({ where: { id: { in: whIds } }, select: { id: true, code: true, name: true } })).map((w) => [w.id, `${w.code} · ${w.name}`])
  );
  const custIds = [...new Set(events.map((e) => e.customerId).filter((x): x is number => x != null))];
  const custMap = new Map(
    (await g.db.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, nickname: true, fullName: true } })).map((c) => [c.id, c.nickname || c.fullName])
  );
  const actorIds = [...new Set(events.map((e) => e.actorUserId).filter((x): x is number => x != null))];
  const actorMap = new Map(
    (await g.db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, username: true } })).map((u) => [u.id, u.fullName || u.username])
  );
  const htIds = [...new Set(events.map((e) => e.handoverTypeId).filter((x): x is number => x != null))];
  const htMap = new Map(
    (await g.db.handoverType.findMany({ where: { id: { in: htIds } }, select: { id: true, name: true } })).map((h) => [h.id, h.name])
  );
  return {
    ok: true,
    data: events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      fromState: e.fromState,
      toState: e.toState,
      fromAgentId: e.fromAgentId,
      toAgentId: e.toAgentId,
      customerId: e.customerId,
      customerName: e.customerId != null ? custMap.get(e.customerId) ?? null : null,
      actorUserId: e.actorUserId,
      actorName: e.actorUserId != null ? actorMap.get(e.actorUserId) ?? null : null,
      occurredAt: e.occurredAt.toISOString(),
      note: e.note,
      tid: e.tid,
      fromWarehouseId: e.fromWarehouseId,
      warehouseName: e.fromWarehouseId != null ? whMap.get(e.fromWarehouseId) ?? null : null,
      deliveryAddress: e.deliveryAddress,
      handoverTypeId: e.handoverTypeId,
      handoverName: e.handoverTypeId != null ? htMap.get(e.handoverTypeId) ?? null : null,
      handoverAmount: e.handoverAmount != null ? Number(e.handoverAmount) : null
    }))
  };
}

export interface CreatePosInput {
  serial: string;
  model?: string | null;
  bank?: string | null;
  warehouseLoc?: string | null;
  note?: string | null;
  occurredAt?: string | null;
}

/** P1-07: chuẩn hóa serial để so GẦN-TRÙNG (bỏ khoảng trắng + viết hoa) — dùng cho guard chống trùng, KHÔNG
 * đổi giá trị serial lưu trữ (serial thật giữ nguyên hoa/thường như người dùng nhập). */
export function normalizeSerial(s: string): string {
  return String(s ?? '').replace(/\s+/g, '').toUpperCase();
}

/** POS_MANAGE — register a new device (IN_STOCK) + STOCK_IN event + audit. */
export async function createPos(input: CreatePosInput): Promise<MutationResult> {
  const g = await requirePermission('POS_MANAGE', { action: 'POS_CREATED', targetType: 'PosDevice' });
  if (!g.ok) return g;
  const { db, user } = g;

  const serial = input.serial?.trim();
  if (!serial) return { ok: false, error: 'VALIDATION', message: 'Serial máy POS bắt buộc.' };
  const dup = await db.posDevice.findUnique({ where: { serial } });
  if (dup) return { ok: false, error: 'DUPLICATE', message: `Serial POS "${serial}" đã tồn tại.` };
  // P1-07 (hardening 16/7): chặn serial GẦN TRÙNG — chỉ khác hoa/thường hoặc khoảng trắng (vd "ABC1"/"abc1"/
  // " ABC1 ") gần như chắc là gõ lệch cùng 1 máy → tránh 2 record cho 1 thiết bị. KHÔNG đổi serial đã lưu, KHÔNG
  // migration; chỉ so chuẩn-hóa với máy ĐANG SỐNG (deleted_at IS NULL) để không chặn hồi sinh máy đã xóa mềm.
  const normalized = normalizeSerial(serial);
  const near = await db.$queryRaw<{ serial: string }[]>`
    SELECT serial FROM pos_devices
    WHERE deleted_at IS NULL AND upper(regexp_replace(serial, '[[:space:]]+', '', 'g')) = ${normalized}
    LIMIT 1`;
  if (Array.isArray(near) && near.length > 0) {
    return { ok: false, error: 'DUPLICATE', message: `Serial POS gần trùng đã tồn tại: "${near[0].serial}" (chỉ khác hoa/thường hoặc khoảng trắng).` };
  }

  const occurredAt = parseWhen(input.occurredAt);
  const created = await db.$transaction(async (tx) => {
    const dev = await tx.posDevice.create({
      data: {
        serial,
        model: input.model ?? null,
        bank: input.bank ?? null,
        status: 'IN_STOCK',
        warehouseLoc: input.warehouseLoc ?? null,
        note: input.note ?? null
      }
    });
    await tx.assetEvent.create({
      data: {
        deviceSerial: serial,
        eventType: 'STOCK_IN',
        toState: 'IN_STOCK',
        actorUserId: user.id,
        occurredAt,
        note: input.note ?? null,
        afterJson: JSON.stringify(auditSnapshot({ serial, bank: dev.bank, status: 'IN_STOCK' }))
      }
    });
    return dev;
  });

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'POS_CREATED',
    targetType: 'PosDevice',
    targetId: String(created.id),
    after: auditSnapshot({ serial, bank: created.bank, status: 'IN_STOCK' })
  });
  return { ok: true, id: created.id };
}

// ── Sửa THÔNG TIN HỒ SƠ máy POS (Nhóm 1, Mr.Long 12/7) — KHÔNG đụng trạng thái/gán (state machine đi
// qua luồng thao tác riêng). Chỉ các trường hồ sơ: chủng loại/NCC/giá nhập/ngày nhập/model text/bank
// text/vị trí kho (warehouseLoc text)/ghi chú. Serial (định danh, khóa join event-log) BẤT BIẾN — không sửa.
export interface UpdatePosInput {
  model?: string | null;
  bank?: string | null;
  bankId?: number | null; // Cài APP — app ngân hàng cài trên máy (null = máy trắng). "Cài app" cho máy trắng để gán TID.
  posModelId?: number | null;
  supplierId?: number | null;
  importPrice?: number | null;
  importedAt?: string | null;
  warehouseId?: number | null; // Mr.Long 15/7 — đổi KHO đang chứa máy ngay trong form (chỉ khi IN_STOCK)
  warehouseLoc?: string | null;
  note?: string | null;
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock — mốc updatedAt client giữ lúc mở form
}

/** POS_MANAGE — sửa hồ sơ máy (không đổi trạng thái/gán/kho vật lý/serial). Audit before/after + optlock. */
export async function updatePos(id: number, input: UpdatePosInput): Promise<MutationResult> {
  const g = await requirePermission('POS_MANAGE', { action: 'POS_UPDATED', targetType: 'PosDevice', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.posDevice.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Không tìm thấy máy POS.' };
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;

  if (input.posModelId != null) {
    const m = await db.posModel.findFirst({ where: { id: input.posModelId, deletedAt: null }, select: { id: true } });
    if (!m) return { ok: false, error: 'NOT_FOUND', message: 'Chủng loại POS đã chọn không tồn tại.' };
  }
  if (input.supplierId != null) {
    const s = await db.supplier.findFirst({ where: { id: input.supplierId, deletedAt: null }, select: { id: true } });
    if (!s) return { ok: false, error: 'NOT_FOUND', message: 'Nhà cung cấp đã chọn không tồn tại.' };
  }
  // Mr.Long 15/7 — đổi KHO trong form: chỉ khi máy đang IN_STOCK (giữ invariant warehouseId≠null⟺IN_STOCK);
  // máy đã giao/bán đổi kho qua nút Thao tác (vòng đời). Kho đích phải tồn tại + còn hoạt động.
  if (input.warehouseId !== undefined) {
    if (row.status !== 'IN_STOCK') return { ok: false, error: 'VALIDATION', message: 'Chỉ đổi kho được khi máy đang TRONG KHO. Máy đã giao/bán đổi kho qua nút Thao tác.' };
    if (input.warehouseId == null) return { ok: false, error: 'VALIDATION', message: 'Máy trong kho phải thuộc 1 kho — không để trống.' };
    const wh = await db.warehouse.findFirst({ where: { id: input.warehouseId, deletedAt: null }, select: { id: true, status: true } });
    if (!wh) return { ok: false, error: 'NOT_FOUND', message: 'Kho đã chọn không tồn tại.' };
    if (wh.status !== 'ACTIVE') return { ok: false, error: 'VALIDATION', message: 'Kho đã ngừng hoạt động — không thể chuyển máy vào.' };
  }
  // Cài APP — nếu chọn app ngân hàng (bankId>0) phải tồn tại + còn dùng (ACTIVE). bankId null/0 = máy trắng.
  if (input.bankId != null) {
    const bk = await db.bank.findFirst({ where: { id: input.bankId, deletedAt: null }, select: { id: true, status: true } });
    if (!bk) return { ok: false, error: 'NOT_FOUND', message: 'Ngân hàng (app) đã chọn không tồn tại.' };
    if (bk.status !== 'ACTIVE') return { ok: false, error: 'VALIDATION', message: 'Ngân hàng (app) đã ngừng sử dụng — không thể cài lên máy.' };
  }

  const before = auditSnapshot({ model: row.model, bank: row.bank, bankId: row.bankId, posModelId: row.posModelId, supplierId: row.supplierId, importPrice: row.importPrice, importedAt: row.importedAt ? row.importedAt.toISOString() : null, warehouseId: row.warehouseId, warehouseLoc: row.warehouseLoc, note: row.note });
  const importedAt = input.importedAt !== undefined ? (input.importedAt ? parseWhen(input.importedAt) : null) : row.importedAt;
  const updated = await db.posDevice.update({
    where: { id },
    data: {
      model: input.model !== undefined ? input.model?.trim() || null : row.model,
      bank: input.bank !== undefined ? input.bank?.trim() || null : row.bank,
      bankId: input.bankId !== undefined ? (input.bankId || null) : row.bankId,
      posModelId: input.posModelId !== undefined ? input.posModelId : row.posModelId,
      supplierId: input.supplierId !== undefined ? input.supplierId : row.supplierId,
      importPrice: input.importPrice !== undefined ? input.importPrice : row.importPrice,
      importedAt,
      warehouseId: input.warehouseId !== undefined ? input.warehouseId : row.warehouseId,
      warehouseLoc: input.warehouseLoc !== undefined ? input.warehouseLoc?.trim() || null : row.warehouseLoc,
      note: input.note !== undefined ? input.note?.trim() || null : row.note,
      updatedBy: user.id
    }
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'POS_UPDATED',
    targetType: 'PosDevice',
    targetId: String(id),
    before,
    after: auditSnapshot({ model: updated.model, bank: updated.bank, bankId: updated.bankId, posModelId: updated.posModelId, supplierId: updated.supplierId, importPrice: updated.importPrice, warehouseId: updated.warehouseId, warehouseLoc: updated.warehouseLoc, note: updated.note })
  });
  return { ok: true, id };
}

export interface TransitionInput {
  occurredAt?: string | null;
  note?: string | null;
  agentId?: number | null; // deploy / transferAgent target
  customerId?: number | null; // deploy target
  fromWarehouseId?: number | null; // R27 (§4) — giao/đổi-khách: kho xuất (địa chỉ snapshot theo kho)
  toWarehouseId?: number | null; // Model 1 — thu hồi / nhận-sửa VỀ kho nào (set PosDevice.warehouseId)
  // LOẠI GIAO MÁY (Mr.Long) — deploy (giao khách): loại giao + số tiền + quỹ nhận (khi thu tiền). recall
  // (thu máy về): fundId = quỹ HOÀN cọc (nếu rỗng → hoàn về quỹ cọc gốc). SALE bị chặn (dùng chức năng Bán).
  handoverTypeId?: number | null;
  handoverAmount?: number | null;
  fundId?: number | null;
  method?: string | null; // CK | CASH (khi có tiền)
}

/** Vietnamese label for a rejected transition reason (R_UX_WARN). */
function transitionDenyMessage(reason: string | undefined, from: string, event: PosEvent): string {
  if (reason === 'INVALID_STATE') {
    return `Không thể thực hiện "${POS_EVENT_LABELS[event]}" khi máy đang ở trạng thái ${from}.`;
  }
  return 'Chuyển trạng thái không hợp lệ.';
}

const POS_EVENT_LABELS: Record<PosEvent, string> = {
  deploy: 'Triển khai (giao khách)',
  recall: 'Thu hồi về kho',
  transferAgent: 'Chuyển đại lý',
  changeCustomer: 'Đổi khách giữ máy',
  cancelCustomer: 'Hủy khách giữ máy',
  sell: 'Bán máy',
  reportDamage: 'Báo hỏng',
  sendRepair: 'Gửi bảo trì',
  receiveRepaired: 'Nhận sửa xong',
  retire: 'Thanh lý'
};

/** Interactive-transaction client type (Prisma 7). */
type PrismaTx = Prisma.TransactionClient;

/** Sentinel thrown inside a $transaction to abort with a caller-facing MutationResult. */
class TransitionAbort extends Error {
  constructor(public readonly result: MutationResult) {
    super(result.message ?? result.error ?? 'ABORT');
  }
}

/** Sentinel: state raced between dirty-read và khóa (currentTid đổi) → chạy lại transaction sạch. */
class RetrySignal extends Error {}

/** True nếu lỗi Postgres là deadlock (40P01) hoặc serialization failure (40001) → nên retry. */
function isRetryablePgError(e: unknown): boolean {
  if (e instanceof RetrySignal) return true;
  const code = (e as { code?: string })?.code;
  return code === '40P01' || code === '40001';
}

/**
 * Chạy 1 transaction, retry tối đa `attempts` lần khi gặp deadlock/serialization/RetrySignal.
 * TransitionAbort (lỗi nghiệp vụ) KHÔNG retry — ném thẳng để trả message cho caller.
 */
async function runWithRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof TransitionAbort) throw e;
      if (isRetryablePgError(e)) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * PHASE K1 (Q-P6, §2.5) — gỡ gán TID khỏi 1 máy trong CÙNG transaction (chống mồ côi):
 *  - mode 'recall'  (Thu hồi máy): máy về kho, TID về "Chưa gán máy" (clear posSerial/agentId,
 *                   GIỮ customerId/deliveredAt/status) — TID có thể lắp máy khác. Event TID_UNBIND.
 *  - mode 'retire'  (Thanh lý máy): máy biến mất → ĐÓNG/THU HỒI TID (status → RECALLED nếu đang
 *                   sống), clear posSerial. Event TID_RECALL.
 * Khóa hàng tids FOR UPDATE trước khi đổi (TOCTOU). Không làm gì nếu máy không còn currentTid.
 */
async function unbindTidFromDevice(
  tx: PrismaTx,
  args: { serial: string; tid: string; mode: 'recall' | 'retire'; actorUserId: number; occurredAt: Date; note: string | null }
): Promise<void> {
  const { serial, tid, mode, actorUserId, occurredAt, note } = args;
  // Lock the TID row (chống tương tranh với assign/recall TID song song).
  await tx.$queryRaw`SELECT id FROM tids WHERE tid = ${tid} FOR UPDATE`;
  const row = await tx.tid.findUnique({ where: { tid } });
  if (!row) return; // TID đã biến mất → không có gì để gỡ.
  const fromState = row.status;
  let toState = fromState;
  const data: Record<string, unknown> = { posSerial: null, agentId: null };
  let eventType = 'TID_UNBIND';
  if (mode === 'retire') {
    // Đóng/thu hồi TID: đưa về RECALLED khi còn sống (ACTIVE/DEAD/CLOSED); UNASSIGNED/RECALLED giữ nguyên.
    const decision = decideTidTransition(fromState as TidStatus, 'recall');
    if (decision.allowed) {
      toState = decision.to!;
      data.status = toState;
      data.closedAt = occurredAt;
      eventType = decision.eventType!; // TID_RECALL
    }
  }
  await tx.tid.update({ where: { id: row.id }, data });
  await tx.posTidBinding.updateMany({
    where: { posSerial: serial, tid, unboundAt: null },
    data: { unboundAt: occurredAt, unbindReason: mode === 'retire' ? 'POS_RETIRE' : 'POS_RECALL' }
  });
  await tx.assetEvent.create({
    data: {
      deviceSerial: serial,
      tid,
      eventType,
      fromState,
      toState,
      customerId: row.customerId,
      actorUserId,
      occurredAt,
      note,
      afterJson: JSON.stringify(auditSnapshot({ tid, unboundFrom: serial, mode, status: toState }))
    }
  });
}

/** Core: validate + write asset_event + project new status + audit. Shared by all transitions.
 * PHASE K1 (FIX 2 — chống ABBA deadlock): THỨ TỰ KHÓA TOÀN CỤC = tids TRƯỚC pos_devices (khớp
 * assignTid). recall/retire dirty-read `currentTid` (không khóa) → khóa hàng tids đó TRƯỚC → khóa
 * pos_devices → re-đọc + re-validate dưới khóa. Nếu currentTid đổi giữa dirty-read và khóa → RetrySignal
 * (chạy lại sạch). Bọc retry deadlock/serialization (40P01/40001) tối đa 3 lần rồi trả lỗi thân thiện. */
async function applyTransition(serial: string, event: PosEvent, input: TransitionInput): Promise<MutationResult> {
  const g = await requirePermission('POS_MANAGE', { action: 'POS_TRANSITION', targetType: 'PosDevice' });
  if (!g.ok) return g;
  const { db, user } = g;

  const pre = await db.posDevice.findUnique({ where: { serial } });
  if (!pre) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy máy POS serial "${serial}".` };
  if (event === 'deploy' && input.customerId == null) {
    return { ok: false, error: 'VALIDATION', message: 'Triển khai máy phải chọn khách hàng nhận máy.' };
  }
  if (event === 'transferAgent' && input.agentId == null) {
    return { ok: false, error: 'VALIDATION', message: 'Chuyển đại lý phải chọn đại lý đích.' };
  }
  if (event === 'changeCustomer') {
    if (input.customerId == null) {
      return { ok: false, error: 'VALIDATION', message: 'Đổi khách giữ máy phải chọn khách hàng mới.' };
    }
    if (input.customerId === pre.currentCustomerId) {
      return { ok: false, error: 'VALIDATION', message: 'Khách hàng mới trùng với khách đang giữ máy.' };
    }
    const cust = await db.customer.findFirst({ where: { id: input.customerId, deletedAt: null }, select: { id: true } });
    if (!cust) return { ok: false, error: 'NOT_FOUND', message: 'Không tìm thấy khách hàng mới (hoặc đã bị xóa).' };
  }
  if (event === 'cancelCustomer' && pre.currentCustomerId == null) {
    return { ok: false, error: 'VALIDATION', message: 'Máy này chưa gán khách nào để hủy.' };
  }
  // Model 1 — thu hồi / nhận-sửa VỀ kho: BẮT BUỘC chọn kho (máy về kho phải biết ở kho nào — giữ đồng bộ),
  // và kho đích phải tồn tại (chống FK treo). CHỈ bắt khi chuyển HỢP LỆ về trạng thái — sai trạng thái để
  // state machine báo INVALID_STATE (không che lỗi trạng thái bằng lỗi thiếu kho).
  if ((event === 'recall' || event === 'receiveRepaired') && decidePosTransition(pre.status as PosStatus, event).allowed) {
    if (input.toWarehouseId == null) {
      return { ok: false, error: 'VALIDATION', message: 'Phải chọn KHO nhận máy về (máy trong kho luôn phải thuộc 1 kho).' };
    }
    const wh = await db.warehouse.findFirst({ where: { id: input.toWarehouseId, deletedAt: null }, select: { id: true } });
    if (!wh) return { ok: false, error: 'NOT_FOUND', message: 'Kho nhận máy về không tồn tại (hoặc đã bị xóa).' };
  }
  const unbinds = event === 'recall' || event === 'retire';
  // changeCustomer KHÔNG unbind nhưng CÓ đụng hàng tids (đổi customerId TID theo khách) → phải khóa
  // hàng tids TRƯỚC pos_devices như nhánh unbind (chống ABBA + TOCTOU currentTid đổi giữa chừng).
  const touchesTid = unbinds || event === 'changeCustomer';

  const occurredAt = parseWhen(input.occurredAt);

  // LOẠI GIAO MÁY — deploy (giao khách): giải mã loại giao + số tiền + quỹ TRƯỚC $transaction (validate
  // đầy đủ ở đây → applyHandoverTx chỉ GHI). Bán (SALE) cần mật khẩu xác nhận → CHẶN, hướng dùng chức năng
  // Bán máy. Deploy KHÔNG loại giao (handoverTypeId null) = Mượn 0đ → giữ tương thích giao nội bộ/selftest cũ.
  let handover: HandoverContext | null = null;
  if (event === 'deploy') {
    const r = await resolveHandoverInput(db, { handoverTypeId: input.handoverTypeId, amount: input.handoverAmount, fundId: input.fundId, method: input.method });
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    if (r.moneyKind === 'SALE') {
      return { ok: false, error: 'USE_SALE_FLOW', message: 'Giao hình thức "Bán" cần xác nhận mật khẩu — hãy dùng chức năng Bán máy.' };
    }
    handover = buildHandoverContext(r, { deviceSerial: serial, tid: pre.currentTid ?? null, customerId: input.customerId ?? null, occurredAt, actorId: user.id });
  }

  let result: MutationResult;
  try {
    result = await runWithRetry(async () => {
      // Dirty-read currentTid (KHÔNG khóa) mỗi lần thử → biết hàng tids cần khóa TRƯỚC.
      const dirty = touchesTid ? await db.posDevice.findUnique({ where: { serial }, select: { currentTid: true } }) : null;
      const dirtyTid = dirty?.currentTid ?? null;
      return await db.$transaction(async (tx) => {
        // THỨ TỰ KHÓA: tids TRƯỚC (nếu máy còn TID) rồi mới pos_devices — khớp assignTid, chống ABBA.
        if (dirtyTid) await tx.$queryRaw`SELECT id FROM tids WHERE tid = ${dirtyTid} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM pos_devices WHERE serial = ${serial} FOR UPDATE`;
        const dev = await tx.posDevice.findUnique({ where: { serial } });
        if (!dev) throw new TransitionAbort({ ok: false, error: 'NOT_FOUND', message: `Không tìm thấy máy POS serial "${serial}".` });

        // currentTid đổi giữa dirty-read và khóa → tids đã khóa không khớp → retry sạch (dirty-read lại).
        if (touchesTid && (dev.currentTid ?? null) !== dirtyTid) throw new RetrySignal();

        const decision = decidePosTransition(dev.status as PosStatus, event);
        if (!decision.allowed) {
          throw new TransitionAbort({ ok: false, error: decision.reason, message: transitionDenyMessage(decision.reason, dev.status, event) });
        }

        const fromState = dev.status;
      const toState = decision.to!;
      const before = auditSnapshot({ status: fromState, currentAgentId: dev.currentAgentId, currentCustomerId: dev.currentCustomerId, currentTid: dev.currentTid });

      const patch: Record<string, unknown> = { status: toState, updatedBy: user.id };
      let toAgentId: number | null = null;
      let customerId: number | null = null;
      let eventTid: string | null = null; // TID ghi kèm sự kiện (đổi-khách: TID đi theo máy)
      let eventWarehouseId: number | null = null; // R27 — kho xuất (giao/đổi-khách)
      let eventDeliveryAddress: string | null = null; // R27 — SNAPSHOT địa chỉ kho lúc giao
      if (event === 'deploy') {
        patch.currentCustomerId = input.customerId ?? null;
        patch.currentAgentId = input.agentId ?? dev.currentAgentId;
        patch.recallPending = false; // giao khách mới → hết trạng thái "chờ thu hồi"
        customerId = input.customerId ?? null;
        toAgentId = (input.agentId ?? dev.currentAgentId) ?? null;
      } else if (event === 'cancelCustomer') {
        // #6: GIỮ khách (để biết máy đang ở đâu) + đánh dấu chờ thu hồi. TID giữ nguyên trên máy.
        patch.recallPending = true;
        customerId = dev.currentCustomerId; // ghi vào sự kiện: khách đang giữ (bị hủy)
        toAgentId = dev.currentAgentId;
        eventTid = dev.currentTid;
      } else if (event === 'transferAgent') {
        patch.currentAgentId = input.agentId ?? null;
        toAgentId = input.agentId ?? null;
      } else if (event === 'changeCustomer') {
        // POS #2: máy giữ nguyên DEPLOYED + TID; chỉ đổi khách giữ máy. TID (nếu có) đi theo khách mới.
        patch.currentCustomerId = input.customerId ?? null;
        customerId = input.customerId ?? null;
        toAgentId = dev.currentAgentId; // giữ đại lý
        eventTid = dev.currentTid; // ghi TID vào sự kiện để timeline thấy TID theo khách mới
        if (dev.currentTid) {
          await tx.tid.updateMany({ where: { tid: dev.currentTid }, data: { customerId: input.customerId } });
        }
      } else if (event === 'recall') {
        patch.currentCustomerId = null;
        patch.currentAgentId = null;
        patch.recallPending = false; // máy đã về kho → hết "chờ thu hồi"
        // Q-P6: Thu hồi máy = GỠ gán TID (nếu còn) — máy về kho, TID về "Chưa gán máy".
        if (dev.currentTid) {
          patch.currentTid = null;
          await unbindTidFromDevice(tx, { serial, tid: dev.currentTid, mode: 'recall', actorUserId: user.id, occurredAt, note: input.note ?? null });
        }
      } else if (event === 'retire') {
        patch.currentCustomerId = null;
        patch.currentAgentId = null;
        // Q-P6: Thanh lý = BẮT BUỘC gỡ + đóng/thu hồi TID.
        if (dev.currentTid) {
          patch.currentTid = null;
          await unbindTidFromDevice(tx, { serial, tid: dev.currentTid, mode: 'retire', actorUserId: user.id, occurredAt, note: input.note ?? null });
        }
      }
      // Q-P6: reportDamage / sendRepair / receiveRepaired / transferAgent → GIỮ currentTid (không đụng).

      // R27 + Model 1 (§4): giao/đổi-khách ghi KHO XUẤT + SNAPSHOT địa chỉ kho.
      // ĐỒNG BỘ: deploy xuất TỪ kho đang chứa máy (nguồn sự thật `dev.warehouseId`); legacy (null) → dùng input.
      const srcWhId =
        event === 'deploy'
          ? (dev.warehouseId ?? input.fromWarehouseId ?? null)
          : event === 'changeCustomer'
            ? (input.fromWarehouseId ?? null)
            : null;
      // #5 (Mr.Long 12/7) — GIAO máy cho khách (deploy) BẮT BUỘC máy ở 1 kho CÓ ĐỊA CHỈ cụ thể. Địa chỉ
      // kho = địa chỉ hồ sơ User quản lý kho (§4) nếu có managerUserId, ngược lại address cột kho (legacy).
      if (event === 'deploy' && srcWhId == null) {
        throw new TransitionAbort({ ok: false, error: 'NO_WAREHOUSE', message: 'Máy phải ở kho có địa chỉ cụ thể mới giao cho khách được. Hãy chọn kho xuất (Từ kho).' });
      }
      if (srcWhId != null) {
        const wh = await tx.warehouse.findFirst({ where: { id: srcWhId, deletedAt: null }, select: { id: true, address: true, managerUserId: true } });
        if (!wh) throw new TransitionAbort({ ok: false, error: 'NOT_FOUND', message: 'Kho xuất đã chọn không tồn tại (hoặc đã bị xóa).' });
        const effAddr = await resolveWarehouseAddress(tx, wh);
        if (event === 'deploy' && !(effAddr && effAddr.trim())) {
          throw new TransitionAbort({ ok: false, error: 'WAREHOUSE_NO_ADDRESS', message: 'Máy phải ở kho có địa chỉ cụ thể mới giao cho khách được. Kho xuất chưa có địa chỉ (kiểm tra User quản lý kho).' });
        }
        eventWarehouseId = wh.id;
        eventDeliveryAddress = effAddr;
      }

      // Model 1 — ĐỒNG BỘ kho vật lý của máy: CHỈ khi IN_STOCK máy mới thuộc 1 kho (recall/nhận-sửa VỀ kho);
      // mọi trạng thái rời kho (giao/thanh lý/hỏng/gửi-sửa) → warehouseId = null. Bất biến: warehouseId≠null ⟺ IN_STOCK.
      patch.warehouseId = toState === 'IN_STOCK' ? (input.toWarehouseId ?? null) : null;

      await tx.posDevice.update({ where: { id: dev.id }, data: patch });
      await tx.assetEvent.create({
        data: {
          deviceSerial: serial,
          tid: eventTid,
          eventType: decision.eventType!,
          fromState,
          toState,
          fromAgentId: dev.currentAgentId,
          toAgentId,
          customerId,
          fromWarehouseId: eventWarehouseId,
          deliveryAddress: eventDeliveryAddress,
          // LOẠI GIAO MÁY — chỉ ghi khi deploy CÓ chọn loại giao (timeline hiện "giao hình thức gì, bao nhiêu").
          handoverTypeId: handover && handover.handoverTypeId != null ? handover.handoverTypeId : null,
          handoverAmount: handover && handover.handoverTypeId != null ? handover.amount : null,
          actorUserId: user.id,
          occurredAt,
          note: input.note ?? null,
          beforeJson: JSON.stringify(before),
          afterJson: JSON.stringify(auditSnapshot({ status: toState, currentAgentId: patch.currentAgentId ?? dev.currentAgentId, currentCustomerId: patch.currentCustomerId ?? dev.currentCustomerId }))
        }
      });
      // LOẠI GIAO MÁY — áp mô hình tiền TRONG CÙNG $transaction:
      //  • deploy: RENT (thu 1 lần) / DEPOSIT (cọc → nợ phải trả) / NONE (0đ). SALE đã bị chặn ở trên.
      //  • recall: nếu máy có cọc OPEN → tự HOÀN phần còn giữ (fundId override, else quỹ cọc gốc).
      if (event === 'deploy' && handover) await applyHandoverTx(tx, handover);
      if (event === 'recall') {
        await refundOpenDepositsForSerialTx(tx, { serial, fundIdOverride: input.fundId ?? null, method: input.method === 'CK' ? 'CK' : 'CASH', occurredAt, actorId: user.id });
      }
        return { ok: true, id: dev.id, _before: before, _eventType: decision.eventType, _toState: toState } as MutationResult & { _before: unknown; _eventType: string; _toState: string };
      });
    });
  } catch (e) {
    if (e instanceof TransitionAbort) return e.result;
    throw e;
  }

  const meta = result as MutationResult & { _before?: unknown; _eventType?: string; _toState?: string };
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'POS_TRANSITION',
    targetType: 'PosDevice',
    targetId: String(pre.id),
    before: meta._before as Record<string, unknown> | undefined,
    after: auditSnapshot({ event: meta._eventType, status: meta._toState })
  });
  return { ok: true, id: pre.id };
}

export const deployPos = (serial: string, input: TransitionInput): Promise<MutationResult> => applyTransition(serial, 'deploy', input);
export const recallPos = (serial: string, input: TransitionInput): Promise<MutationResult> => applyTransition(serial, 'recall', input);
export const transferPosAgent = (serial: string, input: TransitionInput): Promise<MutationResult> => applyTransition(serial, 'transferAgent', input);
/** POS #2 — đổi khách giữ máy (giữ DEPLOYED + TID, TID theo khách mới), 1 bước atomic. */
export const changeCustomerPos = (serial: string, input: TransitionInput): Promise<MutationResult> => applyTransition(serial, 'changeCustomer', input);
/** #6 — hủy khách giữ máy: giữ khách + đánh dấu chờ thu hồi (máy chưa về kho). */
export const cancelCustomerPos = (serial: string, input: TransitionInput): Promise<MutationResult> => applyTransition(serial, 'cancelCustomer', input);
export const reportPosDamage = (serial: string, input: TransitionInput): Promise<MutationResult> => applyTransition(serial, 'reportDamage', input);
export const sendPosRepair = (serial: string, input: TransitionInput): Promise<MutationResult> => applyTransition(serial, 'sendRepair', input);
export const receivePosRepaired = (serial: string, input: TransitionInput): Promise<MutationResult> => applyTransition(serial, 'receiveRepaired', input);

/** Retire (thanh lý) is destructive → re-enter password (§14). */
export async function retirePos(serial: string, password: string, input: TransitionInput = {}): Promise<MutationResult> {
  const g = await requirePermission('POS_MANAGE', { action: 'POS_TRANSITION', targetType: 'PosDevice' });
  if (!g.ok) return g;
  if (!(await verifyActorPassword(g.user, password))) {
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  return applyTransition(serial, 'retire', input);
}

/** §4 — Địa chỉ HIỆU LỰC của kho: nếu kho gán User quản lý (managerUserId) → lấy address hồ sơ user đó
 *  (nguồn sống); ngược lại dùng address cột kho (dữ liệu kho cũ, tương thích ngược). */
async function resolveWarehouseAddress(tx: PrismaTx, wh: { address: string | null; managerUserId: number | null }): Promise<string | null> {
  if (wh.managerUserId != null) {
    const u = await tx.user.findUnique({ where: { id: wh.managerUserId }, select: { address: true } });
    return u?.address ?? null;
  }
  return wh.address;
}

/** Parse an optional ISO/date string; fall back to now. Invalid → now (never throws). */
function parseWhen(iso?: string | null): Date {
  if (!iso) return new Date();
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date() : d;
}
