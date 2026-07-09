// POS device service (main). IMS_SPEC §A. Event-sourced lifecycle: every transition writes an
// immutable asset_event (with occurredAt = real operation time) + updates the projected status,
// and also writes a governance audit row. Permission-guarded (POS_VIEW / POS_MANAGE), R_UX_WARN.
import { decidePosTransition, auditSnapshot, type PosEvent, type PosStatus } from '@glb/business-rules';
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

function toDto(d: {
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
}): PosDto {
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
    createdAt: d.createdAt.toISOString()
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
      bank: filter.bank || undefined,
      status: filter.status || undefined,
      currentAgentId: filter.agentId ?? undefined,
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search
        ? [{ serial: { contains: filter.search } }, { currentTid: { contains: filter.search } }]
        : undefined
    },
    orderBy: { id: 'asc' }
  });
  return { ok: true, data: rows.map(toDto) };
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
      note: e.note
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
  reportDamage: 'Báo hỏng',
  sendRepair: 'Gửi bảo trì',
  receiveRepaired: 'Nhận sửa xong',
  retire: 'Thanh lý'
};

/** Core: validate + write asset_event + project new status + audit. Shared by all transitions. */
async function applyTransition(serial: string, event: PosEvent, input: TransitionInput): Promise<MutationResult> {
  const g = await requirePermission('POS_MANAGE', { action: 'POS_TRANSITION', targetType: 'PosDevice' });
  if (!g.ok) return g;
  const { db, user } = g;

  const dev = await db.posDevice.findUnique({ where: { serial } });
  if (!dev) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy máy POS serial "${serial}".` };

  const decision = decidePosTransition(dev.status as PosStatus, event);
  if (!decision.allowed) {
    return { ok: false, error: decision.reason, message: transitionDenyMessage(decision.reason, dev.status, event) };
  }
  if (event === 'deploy' && (input.customerId == null)) {
    return { ok: false, error: 'VALIDATION', message: 'Triển khai máy phải chọn khách hàng nhận máy.' };
  }
  if (event === 'transferAgent' && input.agentId == null) {
    return { ok: false, error: 'VALIDATION', message: 'Chuyển đại lý phải chọn đại lý đích.' };
  }

  const occurredAt = parseWhen(input.occurredAt);
  const fromState = dev.status;
  const toState = decision.to!;
  const before = auditSnapshot({ status: fromState, currentAgentId: dev.currentAgentId, currentCustomerId: dev.currentCustomerId });

  // Project the device fields per event.
  const patch: Record<string, unknown> = { status: toState };
  let toAgentId: number | null = null;
  let customerId: number | null = null;
  if (event === 'deploy') {
    patch.currentCustomerId = input.customerId ?? null;
    patch.currentAgentId = input.agentId ?? dev.currentAgentId;
    customerId = input.customerId ?? null;
    toAgentId = (input.agentId ?? dev.currentAgentId) ?? null;
  } else if (event === 'transferAgent') {
    patch.currentAgentId = input.agentId ?? null;
    toAgentId = input.agentId ?? null;
  } else if (event === 'recall') {
    patch.currentCustomerId = null;
    patch.currentAgentId = null;
    patch.warehouseLoc = dev.warehouseLoc;
  } else if (event === 'retire') {
    patch.currentCustomerId = null;
    patch.currentAgentId = null;
  }

  await db.$transaction(async (tx) => {
    await tx.posDevice.update({ where: { id: dev.id }, data: patch });
    await tx.assetEvent.create({
      data: {
        deviceSerial: serial,
        eventType: decision.eventType!,
        fromState,
        toState,
        fromAgentId: dev.currentAgentId,
        toAgentId,
        customerId,
        actorUserId: user.id,
        occurredAt,
        note: input.note ?? null,
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify(auditSnapshot({ status: toState, currentAgentId: patch.currentAgentId ?? dev.currentAgentId, currentCustomerId: patch.currentCustomerId ?? dev.currentCustomerId }))
      }
    });
  });

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'POS_TRANSITION',
    targetType: 'PosDevice',
    targetId: String(dev.id),
    before,
    after: auditSnapshot({ event: decision.eventType, status: toState })
  });
  return { ok: true, id: dev.id };
}

export const deployPos = (serial: string, input: TransitionInput): Promise<MutationResult> => applyTransition(serial, 'deploy', input);
export const recallPos = (serial: string, input: TransitionInput): Promise<MutationResult> => applyTransition(serial, 'recall', input);
export const transferPosAgent = (serial: string, input: TransitionInput): Promise<MutationResult> => applyTransition(serial, 'transferAgent', input);
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
