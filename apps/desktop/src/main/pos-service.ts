// POS device service (main). IMS_SPEC §A. Event-sourced lifecycle: every transition writes an
// immutable asset_event (with occurredAt = real operation time) + updates the projected status,
// and also writes a governance audit row. Permission-guarded (POS_VIEW / POS_MANAGE), R_UX_WARN.
import { decidePosTransition, decideTidTransition, auditSnapshot, type PosEvent, type PosStatus, type TidStatus } from '@glb/business-rules';
import { Prisma } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { dateRange } from './customer-service.js';

export interface PosDto {
  id: number;
  serial: string;
  model: string | null;
  bank: string | null;
  status: string;
  currentAgentId: number | null;
  currentCustomerId: number | null;
  currentTid: string | null;
  warehouseLoc: string | null;
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
  actorUserId: number | null;
  occurredAt: string;
  note: string | null;
  tid: string | null;
  fromWarehouseId: number | null; // R27 — kho xuất (giao/đổi-khách)
  warehouseName: string | null; // "MÃ · Tên" kho
  deliveryAddress: string | null; // địa chỉ giao (snapshot theo kho lúc giao)
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
  fromDate?: string;
  toDate?: string;
}

interface PosDeviceRow {
  id: number;
  serial: string;
  model: string | null;
  bank: string | null;
  status: string;
  currentAgentId: number | null;
  currentCustomerId: number | null;
  currentTid: string | null;
  warehouseLoc: string | null;
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
}
function toDto(d: PosDeviceRow, maps: PosNameMaps): PosDto {
  const m = d.posModelId != null ? maps.models.get(d.posModelId) : undefined;
  const s = d.supplierId != null ? maps.suppliers.get(d.supplierId) : undefined;
  return {
    id: d.id,
    serial: d.serial,
    model: d.model,
    bank: d.bank,
    status: d.status,
    currentAgentId: d.currentAgentId,
    currentCustomerId: d.currentCustomerId,
    currentTid: d.currentTid,
    warehouseLoc: d.warehouseLoc,
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
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search
        ? [{ serial: { contains: filter.search, mode: 'insensitive' } }, { currentTid: { contains: filter.search, mode: 'insensitive' } }]
        : undefined
    },
    orderBy: { id: 'asc' }
  });
  // Resolve FK names (chủng loại / NCC / khách / đại lý) — join ở service layer (resilient soft-delete).
  const modelIds = [...new Set(rows.map((r) => r.posModelId).filter((x): x is number => x != null))];
  const supplierIds = [...new Set(rows.map((r) => r.supplierId).filter((x): x is number => x != null))];
  const customerIds = [...new Set(rows.map((r) => r.currentCustomerId).filter((x): x is number => x != null))];
  const agentIds = [...new Set(rows.map((r) => r.currentAgentId).filter((x): x is number => x != null))];
  const maps: PosNameMaps = {
    models: new Map((await g.db.posModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, code: true, name: true } })).map((x) => [x.id, { code: x.code, name: x.name }])),
    suppliers: new Map((await g.db.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, code: true, name: true } })).map((x) => [x.id, { code: x.code, name: x.name }])),
    customers: new Map((await g.db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, nickname: true, fullName: true } })).map((x) => [x.id, x.nickname || x.fullName])),
    agents: new Map((await g.db.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]))
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
  // Resolve tên kho (join tại service layer — resilient soft-delete).
  const whIds = [...new Set(events.map((e) => e.fromWarehouseId).filter((x): x is number => x != null))];
  const whMap = new Map(
    (await g.db.warehouse.findMany({ where: { id: { in: whIds } }, select: { id: true, code: true, name: true } })).map((w) => [w.id, `${w.code} · ${w.name}`])
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
      actorUserId: e.actorUserId,
      occurredAt: e.occurredAt.toISOString(),
      note: e.note,
      tid: e.tid,
      fromWarehouseId: e.fromWarehouseId,
      warehouseName: e.fromWarehouseId != null ? whMap.get(e.fromWarehouseId) ?? null : null,
      deliveryAddress: e.deliveryAddress
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

/** POS_MANAGE — register a new device (IN_STOCK) + STOCK_IN event + audit. */
export async function createPos(input: CreatePosInput): Promise<MutationResult> {
  const g = await requirePermission('POS_MANAGE', { action: 'POS_CREATED', targetType: 'PosDevice' });
  if (!g.ok) return g;
  const { db, user } = g;

  const serial = input.serial?.trim();
  if (!serial) return { ok: false, error: 'VALIDATION', message: 'Serial máy POS bắt buộc.' };
  const dup = await db.posDevice.findUnique({ where: { serial } });
  if (dup) return { ok: false, error: 'DUPLICATE', message: `Serial POS "${serial}" đã tồn tại.` };

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

export interface TransitionInput {
  occurredAt?: string | null;
  note?: string | null;
  agentId?: number | null; // deploy / transferAgent target
  customerId?: number | null; // deploy target
  fromWarehouseId?: number | null; // R27 (§4) — giao/đổi-khách: kho xuất (địa chỉ snapshot theo kho)
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
  const unbinds = event === 'recall' || event === 'retire';
  // changeCustomer KHÔNG unbind nhưng CÓ đụng hàng tids (đổi customerId TID theo khách) → phải khóa
  // hàng tids TRƯỚC pos_devices như nhánh unbind (chống ABBA + TOCTOU currentTid đổi giữa chừng).
  const touchesTid = unbinds || event === 'changeCustomer';

  const occurredAt = parseWhen(input.occurredAt);
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
        customerId = input.customerId ?? null;
        toAgentId = (input.agentId ?? dev.currentAgentId) ?? null;
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

      // R27 (§4): giao/đổi-khách ghi KHO XUẤT + SNAPSHOT địa chỉ kho (chọn kho → địa chỉ theo kho).
      if ((event === 'deploy' || event === 'changeCustomer') && input.fromWarehouseId != null) {
        const wh = await tx.warehouse.findFirst({ where: { id: input.fromWarehouseId, deletedAt: null }, select: { id: true, address: true } });
        if (!wh) throw new TransitionAbort({ ok: false, error: 'NOT_FOUND', message: 'Kho xuất đã chọn không tồn tại (hoặc đã bị xóa).' });
        eventWarehouseId = wh.id;
        eventDeliveryAddress = wh.address;
      }

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
          actorUserId: user.id,
          occurredAt,
          note: input.note ?? null,
          beforeJson: JSON.stringify(before),
          afterJson: JSON.stringify(auditSnapshot({ status: toState, currentAgentId: patch.currentAgentId ?? dev.currentAgentId, currentCustomerId: patch.currentCustomerId ?? dev.currentCustomerId }))
        }
      });
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

/** Parse an optional ISO/date string; fall back to now. Invalid → now (never throws). */
function parseWhen(iso?: string | null): Date {
  if (!iso) return new Date();
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date() : d;
}
