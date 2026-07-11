// TID service (main). IMS_SPEC §A. Event-sourced: assign/replace/recall/markDelivered each write an
// immutable asset_event + pos_tid_binding rows, project TID + POS state, and audit. Guarded (TID_VIEW/TID_MANAGE).
import { decideTidTransition, auditSnapshot, type TidStatus } from '@glb/business-rules';
import { requirePermission } from './guard.js';
import { writeAudit } from './audit.js';
import { dateRange } from './customer-service.js';

export interface TidDto {
  id: number;
  tid: string;
  mid: string | null;
  bank: string | null;
  status: string;
  posSerial: string | null;
  customerId: number | null;
  agentId: number | null;
  openedAt: string | null;
  deliveredAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface UndeliveredTidDto extends TidDto {
  /** Days since openedAt (or createdAt) — the "waste" aging metric (§A5). */
  agingDays: number;
}

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

export interface TidFilter {
  search?: string;
  bank?: string;
  status?: string;
  /** ISO date bounds on openedAt (R_UX_FILTER). */
  fromDate?: string;
  toDate?: string;
}

function toDto(t: {
  id: number;
  tid: string;
  mid: string | null;
  bank: string | null;
  status: string;
  posSerial: string | null;
  customerId: number | null;
  agentId: number | null;
  openedAt: Date | null;
  deliveredAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
}): TidDto {
  return {
    id: t.id,
    tid: t.tid,
    mid: t.mid,
    bank: t.bank,
    status: t.status,
    posSerial: t.posSerial,
    customerId: t.customerId,
    agentId: t.agentId,
    openedAt: t.openedAt ? t.openedAt.toISOString() : null,
    deliveredAt: t.deliveredAt ? t.deliveredAt.toISOString() : null,
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString()
  };
}

/** TID_VIEW — list TIDs with search (tid/mid) + bank/status filters. */
export async function listTids(filter: TidFilter = {}): Promise<{ ok: boolean; data?: TidDto[]; error?: string; message?: string }> {
  const g = await requirePermission('TID_VIEW', { action: 'TID_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.tid.findMany({
    where: {
      deletedAt: null,
      bank: filter.bank || undefined,
      status: filter.status || undefined,
      openedAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search ? [{ tid: { contains: filter.search, mode: 'insensitive' } }, { mid: { contains: filter.search, mode: 'insensitive' } }] : undefined
    },
    orderBy: { id: 'asc' }
  });
  return { ok: true, data: rows.map(toDto) };
}

/** TID_VIEW — "TID chưa giao" (§A5): UNASSIGNED or never delivered, with aging (waste) days. */
export async function listUndeliveredTids(): Promise<{ ok: boolean; data?: UndeliveredTidDto[]; error?: string; message?: string }> {
  const g = await requirePermission('TID_VIEW', { action: 'TID_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.tid.findMany({
    where: {
      status: { notIn: ['CLOSED', 'RECALLED'] },
      OR: [{ status: 'UNASSIGNED' }, { deliveredAt: null }]
    },
    orderBy: { openedAt: 'asc' }
  });
  const now = Date.now();
  const data = rows.map((t) => {
    const base = (t.openedAt ?? t.createdAt).getTime();
    const agingDays = Math.max(0, Math.floor((now - base) / 86_400_000));
    return { ...toDto(t), agingDays };
  });
  // Longest-waiting first — most wasteful at the top.
  data.sort((a, b) => b.agingDays - a.agingDays);
  return { ok: true, data };
}

export interface CreateTidInput {
  tid: string;
  mid?: string | null;
  bank?: string | null;
  openedAt?: string | null;
}

/** TID_MANAGE — register a TID (UNASSIGNED) + TID_CREATED audit. */
export async function createTid(input: CreateTidInput): Promise<MutationResult> {
  const g = await requirePermission('TID_MANAGE', { action: 'TID_CREATED', targetType: 'Tid' });
  if (!g.ok) return g;
  const { db, user } = g;

  const tid = input.tid?.trim();
  if (!tid) return { ok: false, error: 'VALIDATION', message: 'Số TID bắt buộc.' };
  const dup = await db.tid.findUnique({ where: { tid } });
  if (dup) return { ok: false, error: 'DUPLICATE', message: `TID "${tid}" đã tồn tại.` };

  const created = await db.tid.create({
    data: {
      tid,
      mid: input.mid ?? null,
      bank: input.bank ?? null,
      status: 'UNASSIGNED',
      openedAt: input.openedAt ? parseWhen(input.openedAt) : new Date()
    }
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'TID_CREATED',
    targetType: 'Tid',
    targetId: String(created.id),
    after: auditSnapshot({ tid, bank: created.bank, status: 'UNASSIGNED' })
  });
  return { ok: true, id: created.id };
}

export interface AssignTidInput {
  posSerial: string;
  customerId: number;
  occurredAt?: string | null;
  note?: string | null;
}

/** TID_MANAGE — bind a UNASSIGNED TID to a POS + customer → ACTIVE (§A3). */
export async function assignTid(tid: string, input: AssignTidInput): Promise<MutationResult> {
  const g = await requirePermission('TID_MANAGE', { action: 'TID_ASSIGNED', targetType: 'Tid' });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.tid.findUnique({ where: { tid } });
  if (!row) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy TID "${tid}".` };
  const decision = decideTidTransition(row.status as TidStatus, 'assign');
  if (!decision.allowed) {
    // Còn lại DEAD/CLOSED/RECALLED (UNASSIGNED + ACTIVE đã cho phép ở state machine K1).
    return { ok: false, error: decision.reason, message: `Không thể gán TID đang ở trạng thái ${row.status} (đã chết/đóng/thu hồi).` };
  }
  // FIX 1 (K1): TID đang gắn trên 1 máy (posSerial!=null) PHẢI thu hồi khỏi máy đó trước khi lắp máy
  // khác — chống 1 TID trên 2 máy. TID mới (UNASSIGNED) và TID đã tháo khỏi máy (ACTIVE, posSerial=null)
  // đều có posSerial=null → gán được.
  if (row.posSerial != null) {
    return { ok: false, error: 'TID_ON_DEVICE', message: `TID "${tid}" đang gắn trên máy ${row.posSerial}. Thu hồi khỏi máy đó trước khi lắp máy khác.` };
  }
  if (!input.posSerial?.trim()) return { ok: false, error: 'VALIDATION', message: 'Phải chọn máy POS để gán TID.' };
  if (input.customerId == null) return { ok: false, error: 'VALIDATION', message: 'Phải chọn khách hàng nhận TID.' };

  const serial = input.posSerial.trim();
  const devPre = await db.posDevice.findUnique({ where: { serial } });
  if (!devPre) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy máy POS serial "${input.posSerial}".` };
  if (devPre.status === 'RETIRED') return { ok: false, error: 'INVALID_STATE', message: `Máy POS "${serial}" đã thanh lý, không thể gán TID.` };

  const occurredAt = parseWhen(input.occurredAt);
  let devAgentId: number | null = null;
  await db.$transaction(async (tx) => {
    // PHASE K1: khóa hàng tid + máy FOR UPDATE (TOCTOU) rồi re-đọc trong transaction.
    await tx.$queryRaw`SELECT id FROM tids WHERE tid = ${tid} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM pos_devices WHERE serial = ${serial} FOR UPDATE`;
    const dev = await tx.posDevice.findUnique({ where: { serial } });
    devAgentId = dev?.currentAgentId ?? null;
    await tx.tid.update({
      where: { id: row.id },
      data: { status: 'ACTIVE', posSerial: serial, customerId: input.customerId, agentId: devAgentId }
    });
    // Q-P/§2.4: máy vừa nhập kho (IN_STOCK) → DEPLOYED khi gán TID + giao khách; giữ nếu đã DEPLOYED.
    const posPatch: Record<string, unknown> = { currentTid: tid, currentCustomerId: input.customerId, updatedBy: user.id };
    if (dev && dev.status === 'IN_STOCK') posPatch.status = 'DEPLOYED';
    await tx.posDevice.update({ where: { id: dev!.id }, data: posPatch });
    await tx.posTidBinding.create({ data: { posSerial: serial, tid, boundAt: occurredAt } });
    await tx.assetEvent.create({
      data: {
        deviceSerial: serial,
        tid,
        eventType: decision.eventType!,
        fromState: row.status,
        toState: 'ACTIVE',
        customerId: input.customerId,
        toAgentId: devAgentId,
        actorUserId: user.id,
        occurredAt,
        note: input.note ?? null,
        afterJson: JSON.stringify(auditSnapshot({ tid, posSerial: serial, status: 'ACTIVE' }))
      }
    });
  });

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'TID_ASSIGNED',
    targetType: 'Tid',
    targetId: String(row.id),
    before: { status: row.status },
    after: auditSnapshot({ status: 'ACTIVE', posSerial: serial, customerId: input.customerId })
  });
  return { ok: true, id: row.id };
}

export interface ReplaceTidInput {
  newTid: string;
  occurredAt?: string | null;
  note?: string | null;
  unbindReason?: string | null;
}

/** TID_MANAGE — swap: old ACTIVE → DEAD + unbind; new UNASSIGNED → ACTIVE + bind to same POS/customer (§A3). */
export async function replaceTid(oldTid: string, input: ReplaceTidInput): Promise<MutationResult> {
  const g = await requirePermission('TID_MANAGE', { action: 'TID_REPLACED', targetType: 'Tid' });
  if (!g.ok) return g;
  const { db, user } = g;

  const newTidStr = input.newTid?.trim();
  if (!newTidStr) return { ok: false, error: 'VALIDATION', message: 'Phải nhập TID mới để thay thế.' };
  if (newTidStr === oldTid) return { ok: false, error: 'VALIDATION', message: 'TID mới phải khác TID cũ.' };

  const oldRow = await db.tid.findUnique({ where: { tid: oldTid } });
  if (!oldRow) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy TID cũ "${oldTid}".` };
  const oldDecision = decideTidTransition(oldRow.status as TidStatus, 'markDead');
  if (!oldDecision.allowed) {
    return { ok: false, error: oldDecision.reason, message: `TID cũ đang ở trạng thái ${oldRow.status}, chỉ TID đang hoạt động mới thay được.` };
  }
  const newRow = await db.tid.findUnique({ where: { tid: newTidStr } });
  if (!newRow) return { ok: false, error: 'NOT_FOUND', message: `TID mới "${newTidStr}" chưa có trong hệ thống — hãy tạo trước.` };
  const newDecision = decideTidTransition(newRow.status as TidStatus, 'activateReplacement');
  if (!newDecision.allowed) {
    return { ok: false, error: newDecision.reason, message: `TID mới "${newTidStr}" đang ở trạng thái ${newRow.status}, chỉ TID chưa gán mới dùng thay thế được.` };
  }

  const posSerial = oldRow.posSerial;
  const customerId = oldRow.customerId;
  const occurredAt = parseWhen(input.occurredAt);

  await db.$transaction(async (tx) => {
    // Old TID → DEAD + unbind.
    await tx.tid.update({ where: { id: oldRow.id }, data: { status: 'DEAD', closedAt: occurredAt } });
    if (posSerial) {
      await tx.posTidBinding.updateMany({
        where: { posSerial, tid: oldTid, unboundAt: null },
        data: { unboundAt: occurredAt, unbindReason: input.unbindReason ?? 'TID_REPLACE' }
      });
    }
    await tx.assetEvent.create({
      data: {
        deviceSerial: posSerial,
        tid: oldTid,
        eventType: oldDecision.eventType!, // TID_DEAD
        fromState: oldRow.status,
        toState: 'DEAD',
        customerId,
        actorUserId: user.id,
        occurredAt,
        note: input.note ?? null
      }
    });
    // New TID → ACTIVE + bind to the same POS/customer.
    await tx.tid.update({
      where: { id: newRow.id },
      data: { status: 'ACTIVE', posSerial, customerId, agentId: oldRow.agentId }
    });
    if (posSerial) {
      await tx.posTidBinding.create({ data: { posSerial, tid: newTidStr, boundAt: occurredAt } });
      await tx.posDevice.updateMany({ where: { serial: posSerial }, data: { currentTid: newTidStr } });
    }
    await tx.assetEvent.create({
      data: {
        deviceSerial: posSerial,
        tid: newTidStr,
        eventType: newDecision.eventType!, // TID_REPLACE
        fromState: newRow.status,
        toState: 'ACTIVE',
        customerId,
        actorUserId: user.id,
        occurredAt,
        note: input.note ?? null,
        afterJson: JSON.stringify(auditSnapshot({ tid: newTidStr, replaces: oldTid, posSerial }))
      }
    });
  });

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'TID_REPLACED',
    targetType: 'Tid',
    targetId: String(oldRow.id),
    before: auditSnapshot({ oldTid, oldStatus: oldRow.status }),
    after: auditSnapshot({ oldTid, oldStatus: 'DEAD', newTid: newTidStr, newStatus: 'ACTIVE' })
  });
  return { ok: true, id: newRow.id };
}

export interface RecallTidInput {
  occurredAt?: string | null;
  note?: string | null;
}

/** TID_MANAGE — recall (thu hồi) an ACTIVE/DEAD/CLOSED TID → RECALLED + unbind. */
export async function recallTid(tid: string, input: RecallTidInput = {}): Promise<MutationResult> {
  const g = await requirePermission('TID_MANAGE', { action: 'TID_RECALLED', targetType: 'Tid' });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.tid.findUnique({ where: { tid } });
  if (!row) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy TID "${tid}".` };
  const decision = decideTidTransition(row.status as TidStatus, 'recall');
  if (!decision.allowed) {
    return { ok: false, error: decision.reason, message: `Không thể thu hồi TID đang ở trạng thái ${row.status}.` };
  }

  const occurredAt = parseWhen(input.occurredAt);
  await db.$transaction(async (tx) => {
    await tx.tid.update({ where: { id: row.id }, data: { status: 'RECALLED', closedAt: occurredAt } });
    if (row.posSerial) {
      await tx.posTidBinding.updateMany({
        where: { posSerial: row.posSerial, tid, unboundAt: null },
        data: { unboundAt: occurredAt, unbindReason: input.note ?? 'TID_RECALL' }
      });
      await tx.posDevice.updateMany({ where: { serial: row.posSerial, currentTid: tid }, data: { currentTid: null } });
    }
    await tx.assetEvent.create({
      data: {
        deviceSerial: row.posSerial,
        tid,
        eventType: decision.eventType!,
        fromState: row.status,
        toState: 'RECALLED',
        customerId: row.customerId,
        actorUserId: user.id,
        occurredAt,
        note: input.note ?? null
      }
    });
  });

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'TID_RECALLED',
    targetType: 'Tid',
    targetId: String(row.id),
    before: { status: row.status },
    after: auditSnapshot({ status: 'RECALLED' })
  });
  return { ok: true, id: row.id };
}

export interface MarkDeliveredInput {
  deliveredAt?: string | null;
  note?: string | null;
}

/** TID_MANAGE — mark a TID physically delivered to the customer (sets deliveredAt; §A5). */
export async function markTidDelivered(tid: string, input: MarkDeliveredInput = {}): Promise<MutationResult> {
  const g = await requirePermission('TID_MANAGE', { action: 'TID_DELIVERED', targetType: 'Tid' });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.tid.findUnique({ where: { tid } });
  if (!row) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy TID "${tid}".` };
  if (row.deliveredAt) return { ok: false, error: 'ALREADY_DELIVERED', message: `TID "${tid}" đã được đánh dấu đã giao.` };

  const deliveredAt = parseWhen(input.deliveredAt);
  await db.$transaction(async (tx) => {
    await tx.tid.update({ where: { id: row.id }, data: { deliveredAt } });
    await tx.assetEvent.create({
      data: {
        deviceSerial: row.posSerial,
        tid,
        eventType: 'TID_DELIVERED',
        fromState: row.status,
        toState: row.status,
        customerId: row.customerId,
        actorUserId: user.id,
        occurredAt: deliveredAt,
        note: input.note ?? null
      }
    });
  });

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'TID_DELIVERED',
    targetType: 'Tid',
    targetId: String(row.id),
    after: auditSnapshot({ tid, deliveredAt: deliveredAt.toISOString() })
  });
  return { ok: true, id: row.id };
}

function parseWhen(iso?: string | null): Date {
  if (!iso) return new Date();
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date() : d;
}
