// R34 (Mr.Long 11/7) — Duyệt HỦY (xóa mềm khỏi hệ thống) cho TID / POS / Khách hàng / Nhân sự.
// Tái dùng bảng ApprovalRequest (generic, action='CANCEL'). Mô hình phân vai GIỐNG duyệt hủy bill:
//   • người yêu cầu ≠ người duyệt; yêu cầu do Quản lý/Admin (có APPROVE) tạo → cần cấp Admin (ELEVATED);
//   • fallback: nếu chỉ 1 người có ELEVATED và chính họ tạo → tự duyệt được.
//   • APPROVE gán ADMIN + MANAGER (Mr.Long "admin và manager mới có quyền duyệt"); ELEVATED chỉ ADMIN.
//   • Mật khẩu người DUYỆT nhập khi bấm Duyệt (Q2). Bill vẫn ở approval-service.ts (chứng từ bất biến).
// "Hủy" = soft-delete: Tid/PosDevice/Customer set deletedAt; User set status='DELETED' + deletedAt.
// Chống trùng: cấm tạo yêu cầu thứ 2 khi entity đã có 1 yêu cầu PENDING. Guard đặc thù (POS đang gắn TID,
// User: không tự xóa / không xóa Admin cuối / Manager không xóa Admin) kiểm ở CẢ request và apply.
import { auditSnapshot } from '@glb/business-rules';
import { hasPermission, type AuthUser, type AuditAction } from '@glb/shared';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit, writeAuditStrict, bumpChangeToken } from './audit.js';
import { me } from './auth-service.js';
import { getDb } from './db.js';
import { customerLiveRelationGuard } from './customer-service.js';

const ADMIN_ROLE_CODE = 'ADMIN';

// Client bên trong interactive $transaction (thiếu các $-method) — dùng cho applyCancel + guard helper.
// Db đầy đủ vẫn gán được vào TxClient (nhiều thuộc tính hơn) nên helper nhận cả 2.
type TxClient = Omit<Db, '$connect' | '$disconnect' | '$on' | '$use' | '$transaction' | '$extends'>;

class TxGuardError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string
  ) {
    super(code);
    this.name = 'TxGuardError';
  }
}

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY — mỗi entity: bộ 3 quyền + nhãn + precheck (lúc tạo yêu cầu) + applyCancel (lúc duyệt).
// ─────────────────────────────────────────────────────────────────────────────
interface EntityConfig {
  entityType: string; // 'Tid' | 'PosDevice' | 'Customer' | 'User'
  label: string; // tên loại hiển thị
  perms: { request: string; approve: string; elevated: string };
  auditRequested: AuditAction;
  auditApproved: AuditAction;
  auditRejected: AuditAction;
  /** Hiển thị + thông báo: mã/tên gọn của thực thể. null nếu không còn. */
  display: (db: Db, id: number) => Promise<string | null>;
  /** Kiểm ở lúc TẠO yêu cầu (tồn tại + hủy được). requester dùng cho guard đặc thù (User). */
  precheck: (db: Db, id: number, requester: AuthUser) => Promise<{ ok: true } | { ok: false; error: string; message: string }>;
  /** Thực thi xóa mềm trong $transaction thắng. Ném TxGuardError nếu thua điều kiện. approver cho guard User. */
  applyCancel: (txc: TxClient, id: number, approver: AuthUser, reason: string) => Promise<void>;
}

async function userIsAdmin(db: TxClient, id: number): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
  return !!u && u.roles.some((ur) => ur.role.code === ADMIN_ROLE_CODE);
}
/** Số Admin CÒN SỐNG + ACTIVE, KHÔNG tính user `excludeId`. */
async function countOtherActiveAdmins(db: TxClient, excludeId: number): Promise<number> {
  const users = await db.user.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, include: { roles: { include: { role: true } } } });
  return users.filter((u) => u.id !== excludeId && u.roles.some((ur) => ur.role.code === ADMIN_ROLE_CODE)).length;
}

const REGISTRY: Record<string, EntityConfig> = {
  Tid: {
    entityType: 'Tid',
    label: 'TID',
    perms: { request: 'TID_CANCEL_REQUEST', approve: 'TID_CANCEL_APPROVE', elevated: 'TID_CANCEL_APPROVE_ELEVATED' },
    auditRequested: 'TID_CANCEL_REQUESTED',
    auditApproved: 'TID_CANCEL_APPROVED',
    auditRejected: 'TID_CANCEL_REJECTED',
    display: async (db, id) => {
      const t = await db.tid.findUnique({ where: { id } });
      return t ? t.tid : null;
    },
    precheck: async (db, id) => {
      const t = await db.tid.findUnique({ where: { id } });
      if (!t || t.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'TID không tồn tại hoặc đã xóa.' };
      // P1-08 (invariant #7): chặn xóa TID còn quan hệ SỐNG → tránh mồ côi dữ liệu.
      if (t.posSerial != null) return { ok: false, error: 'IN_USE', message: `TID đang gắn máy POS ${t.posSerial}. Thu hồi TID khỏi máy trước khi hủy.` };
      const openDep = await db.deviceDeposit.count({ where: { tid: t.tid, status: 'OPEN' } });
      if (openDep > 0) return { ok: false, error: 'IN_USE', message: `TID còn ${openDep} khoản cọc chưa tất toán. Xử lý cọc trước khi hủy.` };
      const pendIds = (await db.exportRequest.findMany({ where: { status: 'PENDING' }, select: { id: true } })).map((r) => r.id);
      const pendReq = pendIds.length ? await db.exportRequestLine.count({ where: { tid: t.tid, exportRequestId: { in: pendIds } } }) : 0;
      if (pendReq > 0) return { ok: false, error: 'IN_USE', message: 'TID đang nằm trong yêu cầu xuất kho CHỜ DUYỆT. Xử lý phiếu trước khi hủy.' };
      return { ok: true };
    },
    applyCancel: async (txc, id, approver) => {
      // P1-08: re-guard TRONG tx lúc DUYỆT (quan hệ có thể phát sinh giữa yêu cầu→duyệt).
      const t = await txc.tid.findUnique({ where: { id }, select: { tid: true, posSerial: true } });
      if (t?.posSerial != null) throw new TxGuardError('IN_USE', `TID đang gắn máy POS ${t.posSerial}. Thu hồi trước khi hủy.`);
      if (t && (await txc.deviceDeposit.count({ where: { tid: t.tid, status: 'OPEN' } })) > 0) throw new TxGuardError('IN_USE', 'TID còn cọc chưa tất toán.');
      const moved = await txc.tid.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), deletedBy: approver.id, updatedBy: approver.id } });
      if (moved.count === 0) throw new TxGuardError('INVALID_STATE', 'TID đã bị xóa hoặc đổi trạng thái.');
    }
  },
  PosDevice: {
    entityType: 'PosDevice',
    label: 'Máy POS',
    perms: { request: 'POS_CANCEL_REQUEST', approve: 'POS_CANCEL_APPROVE', elevated: 'POS_CANCEL_APPROVE_ELEVATED' },
    auditRequested: 'POS_CANCEL_REQUESTED',
    auditApproved: 'POS_CANCEL_APPROVED',
    auditRejected: 'POS_CANCEL_REJECTED',
    display: async (db, id) => {
      const p = await db.posDevice.findUnique({ where: { id } });
      return p ? p.serial : null;
    },
    precheck: async (db, id) => {
      const p = await db.posDevice.findUnique({ where: { id } });
      if (!p || p.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Máy POS không tồn tại hoặc đã xóa.' };
      if (p.currentTid != null) return { ok: false, error: 'DEVICE_HAS_TID', message: `Máy đang gắn TID ${p.currentTid}. Thu hồi TID khỏi máy trước khi hủy máy.` };
      return { ok: true };
    },
    applyCancel: async (txc, id, approver) => {
      const moved = await txc.posDevice.updateMany({ where: { id, deletedAt: null, currentTid: null }, data: { deletedAt: new Date(), deletedBy: approver.id, updatedBy: approver.id } });
      if (moved.count === 0) throw new TxGuardError('INVALID_STATE', 'Máy POS đã bị xóa hoặc đang gắn TID.');
    }
  },
  Customer: {
    entityType: 'Customer',
    label: 'Khách hàng',
    perms: { request: 'CUSTOMER_CANCEL_REQUEST', approve: 'CUSTOMER_CANCEL_APPROVE', elevated: 'CUSTOMER_CANCEL_APPROVE_ELEVATED' },
    auditRequested: 'CUSTOMER_CANCEL_REQUESTED',
    auditApproved: 'CUSTOMER_CANCEL_APPROVED',
    auditRejected: 'CUSTOMER_CANCEL_REJECTED',
    display: async (db, id) => {
      const c = await db.customer.findUnique({ where: { id } });
      return c ? `${c.code} · ${c.fullName}` : null;
    },
    precheck: async (db, id) => {
      const c = await db.customer.findUnique({ where: { id } });
      if (!c || c.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Khách hàng không tồn tại hoặc đã xóa.' };
      // P1-08 (invariant #7): chặn xóa khách còn quan hệ SỐNG (giữ máy/TID/cọc) → tránh mồ côi tham chiếu.
      const g = await customerLiveRelationGuard(db, id);
      if (g) return { ok: false, error: g.error ?? 'IN_USE', message: g.message ?? 'Khách còn quan hệ sống, không thể hủy.' };
      return { ok: true };
    },
    applyCancel: async (txc, id, approver) => {
      // P1-08: re-guard TRONG tx lúc DUYỆT — chặn mồ côi nếu khách nhận máy/TID/cọc sau khi tạo yêu cầu.
      if ((await txc.posDevice.count({ where: { currentCustomerId: id, deletedAt: null } })) > 0) throw new TxGuardError('IN_USE', 'Khách đang giữ máy POS. Thu hồi trước khi hủy.');
      if ((await txc.tid.count({ where: { customerId: id, deletedAt: null, deliveredAt: { not: null } } })) > 0) throw new TxGuardError('IN_USE', 'Khách đang giữ TID đã giao. Thu hồi trước khi hủy.');
      if ((await txc.deviceDeposit.count({ where: { customerId: id, status: 'OPEN' } })) > 0) throw new TxGuardError('IN_USE', 'Khách còn cọc chưa tất toán.');
      const moved = await txc.customer.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), deletedBy: approver.id } });
      if (moved.count === 0) throw new TxGuardError('INVALID_STATE', 'Khách hàng đã bị xóa.');
    }
  },
  User: {
    entityType: 'User',
    label: 'Nhân sự',
    perms: { request: 'USER_CANCEL_REQUEST', approve: 'USER_CANCEL_APPROVE', elevated: 'USER_CANCEL_APPROVE_ELEVATED' },
    auditRequested: 'USER_CANCEL_REQUESTED',
    auditApproved: 'USER_CANCEL_APPROVED',
    auditRejected: 'USER_CANCEL_REJECTED',
    display: async (db, id) => {
      const u = await db.user.findUnique({ where: { id } });
      return u ? u.username : null;
    },
    precheck: async (db, id, requester) => {
      const u = await db.user.findUnique({ where: { id } });
      if (!u || u.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Nhân sự không tồn tại hoặc đã xóa.' };
      if (id === requester.id) return { ok: false, error: 'SELF_DELETE', message: 'Không thể tạo yêu cầu xóa chính mình.' };
      if ((await userIsAdmin(db, id)) && (await countOtherActiveAdmins(db, id)) === 0)
        return { ok: false, error: 'LAST_ADMIN', message: 'Không thể xóa Admin cuối cùng.' };
      return { ok: true };
    },
    applyCancel: async (txc, id, approver) => {
      // Guard tại lúc DUYỆT (người thực thi = approver): không tự xóa mình, không xóa Admin cuối, Manager không xóa Admin.
      if (id === approver.id) throw new TxGuardError('SELF_DELETE', 'Không thể tự xóa chính mình.');
      // Serialize MỌI luồng duyệt-xóa User (advisory xact lock chung) — chống TOCTOU LAST_ADMIN: 2 luồng duyệt
      // xóa 2 Admin KHÁC nhau đồng thời đều đọc count admin CŨ (chưa thấy commit của nhau) → cùng qua guard →
      // về 0 Admin (khóa toàn hệ thống). Khóa giữ tới hết tx → luồng sau đọc count SAU khi luồng trước commit.
      // $executeRawUnsafe (KHÔNG $queryRaw): pg_advisory_xact_lock trả kiểu void → queryCompiler wasm không
      // deserialize được cột void; executeRaw chỉ trả số dòng nên chạy an toàn.
      await txc.$executeRawUnsafe('SELECT pg_advisory_xact_lock(748301)');
      const targetAdmin = await userIsAdmin(txc, id);
      if (targetAdmin && (await countOtherActiveAdmins(txc, id)) === 0) throw new TxGuardError('LAST_ADMIN', 'Không thể xóa Admin cuối cùng.');
      if (targetAdmin && !approver.roles.includes(ADMIN_ROLE_CODE)) throw new TxGuardError('MANAGER_SCOPE', 'Bạn không được xóa tài khoản Admin.');
      const moved = await txc.user.updateMany({ where: { id, deletedAt: null }, data: { status: 'DELETED', deletedAt: new Date() } });
      if (moved.count === 0) throw new TxGuardError('INVALID_STATE', 'Nhân sự đã bị xóa.');
    }
  }
};

export const CANCELABLE_ENTITY_TYPES = Object.keys(REGISTRY);

/** Tập quyền hiệu lực của 1 user (theo id). */
async function userPermSet(db: Db, userId: number): Promise<Set<string>> {
  const u = await db.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
  const s = new Set<string>();
  if (u) for (const ur of u.roles) for (const rp of ur.role.permissions) s.add(rp.permission.code);
  return s;
}
async function countUsersWithPerm(db: Db, code: string): Promise<number> {
  const users = await db.user.findMany({ where: { deletedAt: null }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
  let n = 0;
  for (const u of users) if (u.roles.some((ur) => ur.role.permissions.some((rp) => rp.permission.code === code))) n++;
  return n;
}
/** Người ĐƯỢC duyệt (khớp phân vai) — báo thông báo hệ thống. */
async function approverRecipients(db: Db, cfg: EntityConfig, requestedBy: number): Promise<number[]> {
  const reqPerms = await userPermSet(db, requestedBy);
  const needCode = reqPerms.has(cfg.perms.approve) ? cfg.perms.elevated : cfg.perms.approve;
  const users = await db.user.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
  const ids: number[] = [];
  for (const u of users) {
    if (u.id === requestedBy) continue;
    if (u.roles.some((ur) => ur.role.permissions.some((rp) => rp.permission.code === needCode))) ids.push(u.id);
  }
  return ids;
}
async function pushSystemNotice(db: Db, recipientIds: number[], category: string, subject: string, body: string): Promise<void> {
  const ids = [...new Set(recipientIds)];
  if (ids.length === 0) return;
  try {
    await db.message.createMany({ data: ids.map((rid) => ({ kind: 'SYSTEM', category, subject, body, senderId: null, recipientId: rid })) });
  } catch {
    // Thông báo phụ trợ — không chặn luồng chính.
  }
}

function cfgOf(entityType: string): EntityConfig | null {
  return REGISTRY[entityType] ?? null;
}

// ═════════════════════════════════════════════════════════════════════════════
// TẠO YÊU CẦU HỦY
// ═════════════════════════════════════════════════════════════════════════════
export async function requestEntityCancel(entityType: string, entityId: number, reason: string): Promise<MutationResult> {
  const cfg = cfgOf(entityType);
  if (!cfg) return { ok: false, error: 'VALIDATION', message: 'Loại dữ liệu không hỗ trợ duyệt hủy.' };
  const g = await requirePermission(cfg.perms.request, { action: cfg.auditRequested, targetType: entityType, targetId: String(entityId) });
  if (!g.ok) return g;
  const { db, user } = g;
  const r = (reason ?? '').trim();
  if (!r) return { ok: false, error: 'VALIDATION', message: 'Vui lòng nhập lý do hủy.' };
  const pre = await cfg.precheck(db, entityId, user);
  if (!pre.ok) return pre;
  // Chống trùng: đã có 1 yêu cầu PENDING cho thực thể này → không tạo cái thứ 2.
  const existing = await db.approvalRequest.findFirst({ where: { entityType, entityId, action: 'CANCEL', status: 'PENDING' } });
  if (existing) return { ok: false, error: 'ALREADY_PENDING', message: 'Đã có yêu cầu hủy đang chờ duyệt cho mục này.' };

  let req: { id: number };
  try {
    req = await db.$transaction(async (txc) => {
      const dup = await txc.approvalRequest.findFirst({ where: { entityType, entityId, action: 'CANCEL', status: 'PENDING' } });
      if (dup) throw new TxGuardError('ALREADY_PENDING', 'Đã có yêu cầu hủy đang chờ duyệt cho mục này.');
      return txc.approvalRequest.create({ data: { entityType, entityId, action: 'CANCEL', reason: r, requestedBy: user.id } });
    });
  } catch (e) {
    if (e instanceof TxGuardError) return { ok: false, error: e.code, message: e.userMessage };
    // Backstop cấp DB: partial unique `approval_requests_pending_cancel_uq` bắn P2002 nếu 2 luồng cùng tạo
    // yêu cầu hủy PENDING trùng (race qua khỏi findFirst) — quy về cùng thông báo ALREADY_PENDING.
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002')
      return { ok: false, error: 'ALREADY_PENDING', message: 'Đã có yêu cầu hủy đang chờ duyệt cho mục này.' };
    throw e;
  }
  const label = (await cfg.display(db, entityId)) ?? String(entityId);
  await writeAudit(db, { actorUserId: user.id, action: cfg.auditRequested, targetType: entityType, targetId: String(entityId), after: auditSnapshot({ requestId: req.id, label, reason: r }) });
  try {
    const recipients = await approverRecipients(db, cfg, user.id);
    await pushSystemNotice(db, recipients, cfg.auditRequested, `Yêu cầu hủy ${cfg.label} ${label}`, `${user.fullName} đề nghị hủy ${cfg.label} ${label}. Lý do: ${r}. Vào mục Duyệt Hủy để xử lý.`);
  } catch {
    // phụ trợ
  }
  return { ok: true, id: req.id };
}

// ═════════════════════════════════════════════════════════════════════════════
// DUYỆT / TỪ CHỐI
// ═════════════════════════════════════════════════════════════════════════════
type OneResult = { ok: true; id: number } | { ok: false; error: string; message: string };

async function approveOne(db: Db, cfg: EntityConfig, user: AuthUser, requestId: number, decisionNote?: string): Promise<OneResult> {
  const req = await db.approvalRequest.findUnique({ where: { id: requestId } });
  if (!req || req.action !== 'CANCEL' || req.entityType !== cfg.entityType) return { ok: false, error: 'NOT_FOUND', message: 'Yêu cầu hủy không tồn tại.' };
  const requesterPerms = await userPermSet(db, req.requestedBy);
  const requesterIsApprover = requesterPerms.has(cfg.perms.approve);
  const approverElevated = hasPermission(user, cfg.perms.elevated);
  const isSelf = user.id === req.requestedBy;
  let selfNote: string | null = null;

  if (isSelf) {
    // Mr.Long 13/7: ADMIN (elevated) ĐƯỢC tự duyệt yêu cầu của mình — chốt kiểm soát = nhập mật khẩu khi duyệt
    // (approveEntityCancel đã verifyActorPassword). Manager/không-elevated vẫn KHÔNG tự duyệt được.
    if (approverElevated) selfNote = 'Admin tự duyệt (đã nhập mật khẩu)';
    else {
      await writeAudit(db, { actorUserId: user.id, action: cfg.auditApproved, targetType: 'ApprovalRequest', targetId: String(req.id), after: { denied: true, reason: 'SELF_APPROVAL_FORBIDDEN' } });
      return { ok: false, error: 'SELF_APPROVAL_FORBIDDEN', message: 'Chỉ Admin mới được tự duyệt yêu cầu của chính mình (cần nhập mật khẩu).' };
    }
  } else if (requesterIsApprover && !approverElevated) {
    await writeAudit(db, { actorUserId: user.id, action: cfg.auditApproved, targetType: 'ApprovalRequest', targetId: String(req.id), after: { denied: true, reason: 'NEED_ELEVATED', requestedBy: req.requestedBy } });
    return { ok: false, error: 'NEED_ELEVATED', message: 'Yêu cầu do Quản lý/Admin tạo — cần cấp Admin duyệt.' };
  }

  const label = (await cfg.display(db, req.entityId)) ?? String(req.entityId);
  const note = [decisionNote?.trim() || null, selfNote].filter(Boolean).join(' · ') || null;
  const decidedAt = new Date();
  try {
    await db.$transaction(async (txc) => {
      const reqMoved = await txc.approvalRequest.updateMany({ where: { id: req.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedBy: user.id, decidedAt, decisionNote: note } });
      if (reqMoved.count === 0) throw new TxGuardError('ALREADY_DECIDED', 'Yêu cầu đã được xử lý (không còn chờ duyệt).');
      await cfg.applyCancel(txc, req.entityId, user, req.reason);
      // G1: audit NGHIÊM trong tx (tier-1 approval/hủy) — audit fail → rollback cả việc xóa mềm entity.
      await writeAuditStrict(txc, { actorUserId: user.id, action: cfg.auditApproved, targetType: cfg.entityType, targetId: String(req.entityId), after: auditSnapshot({ requestId: req.id, label, note }) });
    });
  } catch (e) {
    if (e instanceof TxGuardError) return { ok: false, error: e.code, message: e.userMessage };
    throw e;
  }
  await bumpChangeToken(db, cfg.entityType);
  try {
    await pushSystemNotice(db, [req.requestedBy], cfg.auditApproved, `Yêu cầu hủy ${cfg.label} ${label} đã được DUYỆT`, `Yêu cầu hủy ${cfg.label} ${label} của bạn đã được duyệt.${note ? ' Ghi chú: ' + note + '.' : ''}`);
  } catch {
    // phụ trợ
  }
  return { ok: true, id: req.id };
}

async function rejectOne(db: Db, cfg: EntityConfig, user: AuthUser, requestId: number, decisionNote: string): Promise<OneResult> {
  const req = await db.approvalRequest.findUnique({ where: { id: requestId } });
  if (!req || req.action !== 'CANCEL' || req.entityType !== cfg.entityType) return { ok: false, error: 'NOT_FOUND', message: 'Yêu cầu hủy không tồn tại.' };
  const note = (decisionNote ?? '').trim();
  if (!note) return { ok: false, error: 'VALIDATION', message: 'Vui lòng nhập lý do từ chối.' };
  const decidedAt = new Date();
  try {
    await db.$transaction(async (txc) => {
      const reqMoved = await txc.approvalRequest.updateMany({ where: { id: req.id, status: 'PENDING' }, data: { status: 'REJECTED', decidedBy: user.id, decidedAt, decisionNote: note } });
      if (reqMoved.count === 0) throw new TxGuardError('INVALID_STATE', 'Yêu cầu đã được xử lý.');
    });
  } catch (e) {
    if (e instanceof TxGuardError) return { ok: false, error: e.code, message: e.userMessage };
    throw e;
  }
  const label = (await cfg.display(db, req.entityId)) ?? String(req.entityId);
  await writeAudit(db, { actorUserId: user.id, action: cfg.auditRejected, targetType: cfg.entityType, targetId: String(req.entityId), after: auditSnapshot({ requestId: req.id, label, note }) });
  try {
    await pushSystemNotice(db, [req.requestedBy], cfg.auditRejected, `Yêu cầu hủy ${cfg.label} ${label} bị TỪ CHỐI`, `Yêu cầu hủy ${cfg.label} ${label} của bạn đã bị từ chối. Lý do: ${note}.`);
  } catch {
    // phụ trợ
  }
  return { ok: true, id: req.id };
}

/** Duyệt 1 yêu cầu hủy entity — Q2: BẮT BUỘC nhập đúng mật khẩu người duyệt. */
export async function approveEntityCancel(entityType: string, requestId: number, password: string, decisionNote?: string): Promise<MutationResult> {
  const cfg = cfgOf(entityType);
  if (!cfg) return { ok: false, error: 'VALIDATION', message: 'Loại dữ liệu không hỗ trợ duyệt hủy.' };
  const g = await requirePermission(cfg.perms.approve, { action: cfg.auditApproved, targetType: 'ApprovalRequest', targetId: String(requestId) });
  if (!g.ok) return g;
  if (!(await verifyActorPassword(g.user, password ?? ''))) {
    await writeAudit(g.db, { actorUserId: g.user.id, action: cfg.auditApproved, targetType: 'ApprovalRequest', targetId: String(requestId), after: { denied: true, reason: 'WRONG_PASSWORD' } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  const r = await approveOne(g.db, cfg, g.user, requestId, decisionNote);
  return r.ok ? { ok: true, id: r.id } : { ok: false, error: r.error, message: r.message };
}

export async function rejectEntityCancel(entityType: string, requestId: number, decisionNote: string): Promise<MutationResult> {
  const cfg = cfgOf(entityType);
  if (!cfg) return { ok: false, error: 'VALIDATION', message: 'Loại dữ liệu không hỗ trợ duyệt hủy.' };
  const g = await requirePermission(cfg.perms.approve, { action: cfg.auditRejected, targetType: 'ApprovalRequest', targetId: String(requestId) });
  if (!g.ok) return g;
  const r = await rejectOne(g.db, cfg, g.user, requestId, decisionNote);
  return r.ok ? { ok: true, id: r.id } : { ok: false, error: r.error, message: r.message };
}

// ═════════════════════════════════════════════════════════════════════════════
// DANH SÁCH yêu cầu hủy entity (cho trung tâm Duyệt Hủy) — gộp mọi loại user ĐƯỢC duyệt.
// ═════════════════════════════════════════════════════════════════════════════
export interface EntityCancelRequestDto {
  id: number;
  entityType: string;
  entityTypeLabel: string;
  entityId: number;
  entityLabel: string | null;
  reason: string;
  status: string;
  requestedBy: number;
  requestedByName: string | null;
  requestedAt: string;
  decidedByName: string | null; // người DUYỆT (danh sách "đã duyệt/đã xóa")
  decidedAt: string | null;
  decisionNote: string | null;
  canApprove: boolean;
  isSelf: boolean; // bạn là người TẠO yêu cầu này (chặn tự-duyệt R34) → hiện để bạn biết phiếu đang chờ người khác duyệt.
}

/**
 * Liệt kê yêu cầu hủy của 4 entity theo `status`. Chỉ trả loại mà user hiện tại có quyền APPROVE;
 * `canApprove` áp phân vai (loại self + yêu cầu-của-approver-cần-elevated). `entityTypeFilter` optional.
 */
export async function listEntityCancelRequests(status = 'PENDING', entityTypeFilter?: string): Promise<{ ok: boolean; error?: string; message?: string; data?: EntityCancelRequestDto[] }> {
  // Bất kỳ quyền *_CANCEL_APPROVE nào cũng vào được (any-of); lọc chi tiết theo từng loại bên dưới.
  const user = me();
  if (!user) return { ok: false, error: 'NOT_AUTHENTICATED', message: 'Bạn chưa đăng nhập.' };
  const db = getDb();
  const types = entityTypeFilter ? [entityTypeFilter].filter((t) => REGISTRY[t]) : CANCELABLE_ENTITY_TYPES;
  const allowed = types.filter((t) => hasPermission(user, REGISTRY[t].perms.approve));
  if (allowed.length === 0) return { ok: false, error: 'FORBIDDEN', message: 'Bạn không có quyền duyệt hủy.' };

  const rows = await db.approvalRequest.findMany({ where: { entityType: { in: allowed }, action: 'CANCEL', status }, orderBy: { requestedAt: 'desc' } });
  const reqUserIds = [...new Set(rows.map((r) => r.requestedBy))];
  const nameIds = [...new Set([...reqUserIds, ...rows.map((r) => r.decidedBy).filter((x): x is number => x != null)])];
  const names = new Map((await db.user.findMany({ where: { id: { in: nameIds } }, select: { id: true, fullName: true, username: true } })).map((u) => [u.id, u.fullName || u.username]));

  const data: EntityCancelRequestDto[] = [];
  for (const r of rows) {
    const cfg = REGISTRY[r.entityType];
    if (!cfg) continue;
    const requesterPerms = await userPermSet(db, r.requestedBy);
    const requesterIsApprover = requesterPerms.has(cfg.perms.approve);
    const approverElevated = hasPermission(user, cfg.perms.elevated);
    const isSelf = user.id === r.requestedBy;
    let canApprove = true;
    // Mr.Long 13/7: ADMIN (elevated) ĐƯỢC tự duyệt yêu cầu của mình (chốt = nhập mật khẩu khi duyệt).
    // Manager/không-elevated: vẫn KHÔNG tự duyệt (cần Admin) + yêu cầu của approver cần Admin duyệt.
    if (isSelf) canApprove = approverElevated;
    else if (requesterIsApprover && !approverElevated) canApprove = false;
    data.push({
      id: r.id,
      entityType: r.entityType,
      entityTypeLabel: cfg.label,
      entityId: r.entityId,
      entityLabel: await cfg.display(db, r.entityId),
      reason: r.reason,
      status: r.status,
      requestedBy: r.requestedBy,
      requestedByName: names.get(r.requestedBy) ?? null,
      requestedAt: r.requestedAt.toISOString(),
      decidedByName: r.decidedBy != null ? names.get(r.decidedBy) ?? null : null,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decisionNote: r.decisionNote ?? null,
      canApprove,
      isSelf
    });
  }
  return { ok: true, data };
}
