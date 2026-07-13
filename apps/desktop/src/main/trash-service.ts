// Thùng rác + phục hồi (R_TRASH_RESTORE, LEAD lock 9/7).
// Soft-delete toàn hệ thống: xóa = set deletedAt (KHÔNG xóa vật lý). Admin phục hồi = clear deletedAt.
// PosDevice/Tid KHÔNG ở đây (dùng vòng đời trạng thái RETIRED/CLOSED/DEAD trong nhật ký bất biến).
// Xóa user KHÔNG ảnh hưởng dữ liệu user tạo (scalar createdBy, không cascade) — chỉ cảnh báo liên kết.
import { hasPermission } from '@glb/shared';
import { getDb } from './db.js';
import { requirePermission, verifyActorPassword, verifyActorLevel2, actorHasLevel2 } from './guard.js';
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
  | 'ReceiveAccount'
  | 'DossierSource'
  | 'Dossier'
  | 'TidConfigStatus'
  | 'Tid'
  | 'Transaction';

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
  ReceiveAccount: 'TK nhận tiền',
  DossierSource: 'Nguồn hồ sơ',
  Dossier: 'Hồ sơ HKD',
  TidConfigStatus: 'Trạng thái TID',
  Tid: 'TID (cấu hình)',
  Transaction: 'Giao dịch doanh thu'
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
  deletedBy: number | null;
  deletedByName: string | null;
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

/**
 * TRASH_VIEW — liệt kê bản ghi đã xóa mềm, mới xóa lên trước.
 * Per-user (Nhóm A #4): user thường chỉ thấy đồ MÌNH xóa; ai có TRASH_VIEW_ALL (Admin/Manager)
 * thấy thùng rác TỔNG của mọi người + hiển thị tên người xóa.
 */
export async function listTrash(): Promise<{ ok: boolean; data?: TrashRow[]; error?: string; message?: string }> {
  const g = await requirePermission('TRASH_VIEW', { action: 'TRASH_VIEW' });
  if (!g.ok) return g;
  const db = g.db;
  const viewAll = hasPermission(g.user, 'TRASH_VIEW_ALL');
  const del = viewAll ? { deletedAt: { not: null } } : { deletedAt: { not: null }, deletedBy: g.user.id };
  const [customers, agents, banks, cardTypes, partners, suppliers, posModels, intakeStatuses, posIntakes, feeTypes, feeRates, rcvSources, rcvAccounts, dossierSources, dossiers, tidStatuses, tids, transactions] = await Promise.all([
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
    db.receiveAccount.findMany({ where: del }),
    db.dossierSource.findMany({ where: del }),
    db.dossier.findMany({ where: del }),
    db.tidConfigStatus.findMany({ where: del }),
    db.tid.findMany({ where: del }),
    db.transaction.findMany({ where: del })
  ]);
  const rows: TrashRow[] = [
    ...customers.map((c) => row('Customer', c.id, c.code, `${c.nickname} (${c.fullName})`, c.deletedAt, c.deletedBy)),
    ...agents.map((a) => row('Agent', a.id, a.code, a.name, a.deletedAt, a.deletedBy)),
    ...banks.map((b) => row('Bank', b.id, b.code, b.name, b.deletedAt, b.deletedBy)),
    ...cardTypes.map((ct) => row('CardType', ct.id, ct.code, ct.name, ct.deletedAt, ct.deletedBy)),
    ...partners.map((p) => row('Partner', p.id, p.code, p.name, p.deletedAt, p.deletedBy)),
    ...suppliers.map((s) => row('Supplier', s.id, s.code, s.name, s.deletedAt, s.deletedBy)),
    ...posModels.map((m) => row('PosModel', m.id, m.code, m.name, m.deletedAt, m.deletedBy)),
    ...intakeStatuses.map((st) => row('PosIntakeStatus', st.id, null, st.name, st.deletedAt, st.deletedBy)),
    ...posIntakes.map((pi) => row('PosIntake', pi.id, pi.serial, pi.serial, pi.deletedAt, pi.deletedBy)),
    ...feeTypes.map((ft) => row('FeeType', ft.id, null, ft.name, ft.deletedAt, ft.deletedBy)),
    ...feeRates.map((fr) => row('FeeRate', fr.id, null, `Biểu phí #${fr.id}`, fr.deletedAt, fr.deletedBy)),
    ...rcvSources.map((s) => row('ReceiveAccountSource', s.id, null, s.name, s.deletedAt, s.deletedBy)),
    ...rcvAccounts.map((a) => row('ReceiveAccount', a.id, a.accountNumber, `${a.accountName} · ${a.accountNumber}`, a.deletedAt, a.deletedBy)),
    ...dossierSources.map((s) => row('DossierSource', s.id, s.code, s.code, s.deletedAt, s.deletedBy)),
    ...dossiers.map((d) => row('Dossier', d.id, null, `${d.hkdName} · ${d.ownerName}`, d.deletedAt, d.deletedBy)),
    ...tidStatuses.map((s) => row('TidConfigStatus', s.id, null, s.name, s.deletedAt, s.deletedBy)),
    ...tids.map((t) => row('Tid', t.id, t.tid, t.hkdName ? `${t.tid} · ${t.hkdName}` : t.tid, t.deletedAt, t.deletedBy)),
    ...transactions.map((tx) => row('Transaction', tx.id, tx.code, tx.code ? `${tx.code} · ${tx.amount}đ` : `Giao dịch #${tx.id}`, tx.deletedAt, tx.deletedBy))
  ].sort((x, y) => (x.deletedAt < y.deletedAt ? 1 : -1));

  // Resolve tên người xóa (1 lượt) — chỉ ý nghĩa khi xem thùng rác tổng.
  const deleterIds = [...new Set(rows.map((r) => r.deletedBy).filter((x): x is number => x !== null))];
  if (deleterIds.length) {
    const users = await db.user.findMany({ where: { id: { in: deleterIds } }, select: { id: true, fullName: true } });
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));
    for (const r of rows) r.deletedByName = r.deletedBy !== null ? (nameById.get(r.deletedBy) ?? null) : null;
  }
  return { ok: true, data: rows };
}

function row(entityType: TrashEntity, id: number, code: string | null, label: string, deletedAt: Date | null, deletedBy: number | null): TrashRow {
  return { entityType, entityLabel: LABEL[entityType], id, code, label, deletedAt: (deletedAt ?? new Date(0)).toISOString(), deletedBy: deletedBy ?? null, deletedByName: null };
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
    case 'DossierSource': return db.dossierSource.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'Dossier': return db.dossier.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'TidConfigStatus': return db.tidConfigStatus.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'Tid': return db.tid.findUnique({ where: { id }, select: { deletedAt: true } });
    case 'Transaction': return db.transaction.findUnique({ where: { id }, select: { deletedAt: true } });
  }
}

async function clearDeleted(entityType: TrashEntity, id: number): Promise<void> {
  const db = getDb();
  const data = { deletedAt: null, deletedBy: null } as const;
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
    case 'FeeRate': {
      const rate = await db.feeRate.findUnique({ where: { id }, select: { partnerId: true, cardTypeId: true, effectiveFrom: true } });
      await db.feeRate.update({ where: { id }, data });
      // FEE_MODEL — khôi phục biểu phí cũng khôi phục phí bán niêm yết CÙNG KỲ đã xóa mềm kèm (đối xứng deleteFeeRates).
      if (rate) await db.feeSellQuote.updateMany({ where: { partnerId: rate.partnerId, cardTypeId: rate.cardTypeId, effectiveFrom: rate.effectiveFrom, deletedAt: { not: null } }, data });
      return;
    }
    case 'ReceiveAccountSource': await db.receiveAccountSource.update({ where: { id }, data }); return;
    case 'ReceiveAccount': await db.receiveAccount.update({ where: { id }, data }); return;
    case 'DossierSource': await db.dossierSource.update({ where: { id }, data }); return;
    case 'Dossier': await db.dossier.update({ where: { id }, data }); return;
    case 'TidConfigStatus': await db.tidConfigStatus.update({ where: { id }, data }); return;
    case 'Tid': await db.tid.update({ where: { id }, data }); return;
    case 'Transaction': await db.transaction.update({ where: { id }, data }); return;
  }
}

/** Xóa CỨNG vĩnh viễn 1 bản ghi (không thể phục hồi). Liên kết bằng scalar-id → không cascade. */
async function hardDeleteOne(entityType: TrashEntity, id: number): Promise<void> {
  const db = getDb();
  switch (entityType) {
    case 'Customer': await db.customer.delete({ where: { id } }); return;
    case 'Agent': await db.agent.delete({ where: { id } }); return;
    case 'Bank': await db.bank.delete({ where: { id } }); return;
    case 'CardType': await db.cardType.delete({ where: { id } }); return;
    case 'Partner': await db.partner.delete({ where: { id } }); return;
    case 'Supplier': await db.supplier.delete({ where: { id } }); return;
    case 'PosModel': await db.posModel.delete({ where: { id } }); return;
    case 'PosIntakeStatus': await db.posIntakeStatus.delete({ where: { id } }); return;
    case 'PosIntake': await db.posIntake.delete({ where: { id } }); return;
    case 'FeeType': await db.feeType.delete({ where: { id } }); return;
    case 'FeeRate': await db.feeRate.delete({ where: { id } }); return;
    case 'ReceiveAccountSource': await db.receiveAccountSource.delete({ where: { id } }); return;
    case 'ReceiveAccount': await db.receiveAccount.delete({ where: { id } }); return;
    case 'DossierSource': await db.dossierSource.delete({ where: { id } }); return;
    case 'Dossier': await db.dossier.delete({ where: { id } }); return;
    case 'TidConfigStatus': await db.tidConfigStatus.delete({ where: { id } }); return;
    case 'Tid': await db.tid.delete({ where: { id } }); return;
    case 'Transaction': await db.transaction.delete({ where: { id } }); return;
  }
}

/**
 * TRASH_PURGE — XÓA VĨNH VIỄN 1 bản ghi trong thùng rác (Nhóm A #3). Yêu cầu NHẬP LẠI MẬT KHẨU (cấp 1)
 * của người thực hiện. Bản ghi PHẢI đang ở thùng rác (đã xóa mềm). Không thể phục hồi sau bước này.
 */
export async function purgeItem(entityType: string, id: number, password: string): Promise<MutationResult> {
  const g = await requirePermission('TRASH_PURGE', { action: 'TRASH_PURGED', targetType: entityType, targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!isTrashEntity(entityType)) return { ok: false, error: 'BAD_ENTITY', message: `Loại dữ liệu không hợp lệ: ${entityType}` };
  if (!(await verifyActorPassword(user, password))) {
    // R_AUDIT_003: thao tác PHÁ HỦY bị từ chối vẫn PHẢI ghi audit (audit bảo mật Nhóm E).
    await writeAudit(db, { actorUserId: user.id, action: 'TRASH_PURGED', targetType: entityType, targetId: String(id), after: { denied: true, reason: 'WRONG_PASSWORD' } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu không đúng — không thể xóa vĩnh viễn.' };
  }
  const current = await findOne(entityType, id);
  if (!current) return { ok: false, error: 'NOT_FOUND', message: 'Bản ghi không tồn tại.' };
  if (current.deletedAt === null) return { ok: false, error: 'NOT_DELETED', message: 'Chỉ được xóa vĩnh viễn bản ghi đã nằm trong thùng rác.' };

  await hardDeleteOne(entityType, id);
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'TRASH_PURGED',
    targetType: entityType,
    targetId: String(id),
    after: { purged: true, entity: entityType, by: user.username }
  });
  return { ok: true, id };
}

/**
 * TRASH_PURGE — DỌN SẠCH TOÀN BỘ thùng rác (xóa cứng MỌI bản ghi đã xóa mềm — Nhóm A #3, quyết định 1a).
 * Yêu cầu MẬT KHẨU CẤP 2 (băm bcrypt cost cao) của người thực hiện — chống phá hoại. Không thể phục hồi.
 */
export async function emptyTrash(level2Password: string): Promise<MutationResult & { purged?: number }> {
  const g = await requirePermission('TRASH_PURGE', { action: 'TRASH_EMPTIED' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!(await actorHasLevel2(user))) {
    await writeAudit(db, { actorUserId: user.id, action: 'TRASH_EMPTIED', targetType: 'System', after: { denied: true, reason: 'LEVEL2_NOT_SET' } });
    return { ok: false, error: 'LEVEL2_NOT_SET', message: 'Bạn chưa đặt mật khẩu cấp 2. Vui lòng đặt trước khi dọn sạch thùng rác.' };
  }
  if (!(await verifyActorLevel2(user, level2Password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'TRASH_EMPTIED', targetType: 'System', after: { denied: true, reason: 'WRONG_LEVEL2' } });
    return { ok: false, error: 'WRONG_LEVEL2', message: 'Mật khẩu cấp 2 không đúng — không thể dọn sạch thùng rác.' };
  }

  const del = { where: { deletedAt: { not: null } } } as const;
  const [customers, agents, banks, cardTypes, partners, suppliers, posModels, intakeStatuses, posIntakes, feeTypes, feeRates, rcvSources, rcvAccounts, dossierSources, dossiers, tidStatuses, tids, transactions] = await Promise.all([
    db.customer.deleteMany(del), db.agent.deleteMany(del), db.bank.deleteMany(del), db.cardType.deleteMany(del),
    db.partner.deleteMany(del), db.supplier.deleteMany(del), db.posModel.deleteMany(del), db.posIntakeStatus.deleteMany(del),
    db.posIntake.deleteMany(del), db.feeType.deleteMany(del), db.feeRate.deleteMany(del), db.receiveAccountSource.deleteMany(del),
    db.receiveAccount.deleteMany(del), db.dossierSource.deleteMany(del), db.dossier.deleteMany(del),
    db.tidConfigStatus.deleteMany(del), db.tid.deleteMany(del), db.transaction.deleteMany(del)
  ]);
  const purged = [customers, agents, banks, cardTypes, partners, suppliers, posModels, intakeStatuses, posIntakes, feeTypes, feeRates, rcvSources, rcvAccounts, dossierSources, dossiers, tidStatuses, tids, transactions]
    .reduce((s, r) => s + r.count, 0);

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'TRASH_EMPTIED',
    targetType: 'System',
    targetId: null,
    after: { purged, by: user.username }
  });
  return { ok: true, purged };
}
