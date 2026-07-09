// Thùng rác + phục hồi (R_TRASH_RESTORE, LEAD lock 9/7).
// Soft-delete toàn hệ thống: xóa = set deletedAt (KHÔNG xóa vật lý). Admin phục hồi = clear deletedAt.
// PosDevice/Tid KHÔNG ở đây (dùng vòng đời trạng thái RETIRED/CLOSED/DEAD trong nhật ký bất biến).
// Xóa user KHÔNG ảnh hưởng dữ liệu user tạo (scalar createdBy, không cascade) — chỉ cảnh báo liên kết.
import { getDb } from './db.js';
import { requirePermission } from './guard.js';
import { writeAudit } from './audit.js';

/** Các thực thể có soft-delete → vào thùng rác. */
export type TrashEntity =
  | 'Customer'
  | 'Agent'
  | 'Bank'
  | 'CardType'
  | 'Partner'
  | 'Supplier'
  | 'PosModel'
  | 'PosIntakeStatus'
  | 'PosIntake'
  | 'FeeType'
  | 'FeeRate'
  | 'ReceiveAccountSource'
  | 'ReceiveAccount';

const LABEL: Record<TrashEntity, string> = {
  Customer: 'Khách hàng',
  Agent: 'Đại lý',
  Bank: 'Ngân hàng',
  CardType: 'Loại thẻ',
  Partner: 'Đối tác',
  Supplier: 'Nhà cung cấp',
  PosModel: 'Chủng loại máy POS',
  PosIntakeStatus: 'Trạng thái nhập máy',
  PosIntake: 'Máy POS nhập kho',
  FeeType: 'Loại phí',
  FeeRate: 'Biểu phí',
  ReceiveAccountSource: 'Nguồn TK nhận tiền',
  ReceiveAccount: 'TK nhận tiền'
};

export function isTrashEntity(v: string): v is TrashEntity {
  return v in LABEL;
}

export interface TrashRow {
  entityType: TrashEntity;
  entityLabel: string;
  id: number;
  code: string | null;
  label: string;
  deletedAt: string;
}

export interface LinkRef {
  label: string;
  count: number;
}

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

/** TRASH_VIEW — liệt kê mọi bản ghi đã xóa mềm, mới xóa lên trước. */
export async function listTrash(): Promise<{ ok: boolean; data?: TrashRow[]; error?: string; message?: string }> {
  const g = await requirePermission('TRASH_VIEW', { action: 'TRASH_VIEW' });
  if (!g.ok) return g;
  const db = g.db;
  const del = { deletedAt: { not: null } } as const;
  const [customers, agents, banks, cardTypes, partners, suppliers, posModels, intakeStatuses, posIntakes, feeTypes, feeRates, rcvSources, rcvAccounts] = await Promise.all([
    db.customer.findMany({ where: del }),
    db.agent.findMany({ where: del }),
    db.bank.findMany({ where: del }),
    db.cardType.findMany({ where: del }),
    db.partner.findMany({ where: del }),
    db.supplier.findMany({ where: del }),
    db.posModel.findMany({ where: del }),
    db.posIntakeStatus.findMany({ where: del }),
    db.posIntake.findMany({ where: del }),
    db.feeType.findMany({ where: del }),
    db.feeRate.findMany({ where: del }),
    db.receiveAccountSource.findMany({ where: del }),
    db.receiveAccount.findMany({ where: del })
  ]);
  const rows: TrashRow[] = [
    ...customers.map((c) => row('Customer', c.id, c.code, `${c.nickname} (${c.fullName})`, c.deletedAt)),
    ...agents.map((a) => row('Agent', a.id, a.code, a.name, a.deletedAt)),
    ...banks.map((b) => row('Bank', b.id, b.code, b.name, b.deletedAt)),
    ...cardTypes.map((ct) => row('CardType', ct.id, ct.code, ct.name, ct.deletedAt)),
    ...partners.map((p) => row('Partner', p.id, p.code, p.name, p.deletedAt)),
    ...suppliers.map((s) => row('Supplier', s.id, s.code, s.name, s.deletedAt)),
    ...posModels.map((m) => row('PosModel', m.id, m.code, m.name, m.deletedAt)),
    ...intakeStatuses.map((st) => row('PosIntakeStatus', st.id, null, st.name, st.deletedAt)),
    ...posIntakes.map((pi) => row('PosIntake', pi.id, pi.serial, pi.serial, pi.deletedAt)),
    ...feeTypes.map((ft) => row('FeeType', ft.id, null, ft.name, ft.deletedAt)),
    ...feeRates.map((fr) => row('FeeRate', fr.id, null, `Biểu phí #${fr.id}`, fr.deletedAt)),
    ...rcvSources.map((s) => row('ReceiveAccountSource', s.id, null, s.name, s.deletedAt)),
    ...rcvAccounts.map((a) => row('ReceiveAccount', a.id, a.accountNumber, `${a.accountName} · ${a.accountNumber}`, a.deletedAt))
  ].sort((x, y) => (x.deletedAt < y.deletedAt ? 1 : -1));
  return { ok: true, data: rows };
}

function row(entityType: TrashEntity, id: number, code: string | null, label: string, deletedAt: Date | null): TrashRow {
  return { entityType, entityLabel: LABEL[entityType], id, code, label, deletedAt: (deletedAt ?? new Date(0)).toISOString() };
}

/**
 * Đếm dữ liệu ĐANG liên kết tới thực thể (để cảnh báo TRƯỚC khi xóa — R_TRASH_RESTORE).
 * Không chặn xóa; chỉ cho người dùng biết ảnh hưởng. Liên kết bằng scalar-id → không cascade.
 */
export async function linkSummary(entityType: string, id: number): Promise<{ ok: boolean; data?: LinkRef[]; error?: string; message?: string }> {
  const g = await requirePermission('TRASH_VIEW', { action: 'TRASH_VIEW' });
  if (!g.ok) return g;
  if (!isTrashEntity(entityType)) return { ok: false, error: 'BAD_ENTITY', message: `Loại dữ liệu không hợp lệ: ${entityType}` };
  const db = getDb();
  const refs: LinkRef[] = [];
  const alive = { deletedAt: null } as const;
  if (entityType === 'Agent') {
    const [cus, pos, tid] = await Promise.all([
      db.customer.count({ where: { agentId: id, ...alive } }),
      db.posDevice.count({ where: { currentAgentId: id } }),
      db.tid.count({ where: { agentId: id } })
    ]);
    if (cus) refs.push({ label: 'Khách hàng thuộc đại lý', count: cus });
    if (pos) refs.push({ label: 'Máy POS đang ở đại lý', count: pos });
    if (tid) refs.push({ label: 'TID gắn đại lý', count: tid });
  } else if (entityType === 'Customer') {
    const [pos, tid] = await Promise.all([
      db.posDevice.count({ where: { currentCustomerId: id } }),
      db.tid.count({ where: { customerId: id } })
    ]);
    if (pos) refs.push({ label: 'Máy POS đang ở khách', count: pos });
    if (tid) refs.push({ label: 'TID của khách', count: tid });
  } else if (entityType === 'Bank') {
    const [ct, pb] = await Promise.all([
      db.cardType.count({ where: { bankId: id, ...alive } }),
      db.partnerBank.count({ where: { bankId: id, ...alive } })
    ]);
    if (ct) refs.push({ label: 'Loại thẻ thuộc ngân hàng', count: ct });
    if (pb) refs.push({ label: 'Liên kết đối tác–ngân hàng', count: pb });
  } else if (entityType === 'Partner') {
    const pb = await db.partnerBank.count({ where: { partnerId: id, ...alive } });
    if (pb) refs.push({ label: 'Ngân hàng liên kết đối tác', count: pb });
  }
  return { ok: true, data: refs };
}

/** TRASH_RESTORE (Admin) — phục hồi 1 bản ghi đã xóa. Audit RESTORE_EXECUTED. */
export async function restoreItem(entityType: string, id: number): Promise<MutationResult> {
  const g = await requirePermission('TRASH_RESTORE', { action: 'RESTORE_EXECUTED', targetType: entityType, targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!isTrashEntity(entityType)) return { ok: false, error: 'BAD_ENTITY', message: `Loại dữ liệu không hợp lệ: ${entityType}` };

  const current = await findOne(entityType, id);
  if (!current) return { ok: false, error: 'NOT_FOUND', message: 'Bản ghi không tồn tại.' };
  if (current.deletedAt === null) return { ok: false, error: 'NOT_DELETED', message: 'Bản ghi này chưa bị xóa nên không cần phục hồi.' };

  await clearDeleted(entityType, id);
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'RESTORE_EXECUTED',
    targetType: entityType,
    targetId: String(id),
    after: { restored: true, entity: entityType }
  });
  return { ok: true, id };
}

async function findOne(entityType: TrashEntity, id: number): Promise<{ deletedAt: Date | null } | null> {
  const db = getDb();
  switch (entityType) {
    case 'Customer': return db.customer.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'Agent': return db.agent.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'Bank': return db.bank.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'CardType': return db.cardType.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'Partner': return db.partner.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'Supplier': return db.supplier.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'PosModel': return db.posModel.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'PosIntakeStatus': return db.posIntakeStatus.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'PosIntake': return db.posIntake.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'FeeType': return db.feeType.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'FeeRate': return db.feeRate.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'ReceiveAccountSource': return db.receiveAccountSource.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'ReceiveAccount': return db.receiveAccount.findUnique({ where: { id }, select: { deletedAt: true } });
  }
}

async function clearDeleted(entityType: TrashEntity, id: number): Promise<void> {
  const db = getDb();
  const data = { deletedAt: null } as const;
  switch (entityType) {
    case 'Customer': await db.customer.update({ where: { id }, data }); return;
    case 'Agent': await db.agent.update({ where: { id }, data }); return;
    case 'Bank': await db.bank.update({ where: { id }, data }); return;
    case 'CardType': await db.cardType.update({ where: { id }, data }); return;
    case 'Partner': await db.partner.update({ where: { id }, data }); return;
    case 'Supplier': await db.supplier.update({ where: { id }, data }); return;
    case 'PosModel': await db.posModel.update({ where: { id }, data }); return;
    case 'PosIntakeStatus': await db.posIntakeStatus.update({ where: { id }, data }); return;
    case 'PosIntake': await db.posIntake.update({ where: { id }, data }); return;
    case 'FeeType': await db.feeType.update({ where: { id }, data }); return;
    case 'FeeRate': await db.feeRate.update({ where: { id }, data }); return;
    case 'ReceiveAccountSource': await db.receiveAccountSource.update({ where: { id }, data }); return;
    case 'ReceiveAccount': await db.receiveAccount.update({ where: { id }, data }); return;
  }
}
