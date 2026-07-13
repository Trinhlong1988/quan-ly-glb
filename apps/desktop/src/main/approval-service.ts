// P1.2 — Approval Engine + bill BẤT BIẾN (main). LEAD chốt 10/7: ghi bill tính ngay; CHỈ HỦY cần duyệt.
// Phân vai (②B): người tạo yêu cầu ≠ người duyệt; requester cấp Manager/Admin (có BILL_CANCEL_APPROVE)
// cần approver cấp Admin (BILL_CANCEL_APPROVE_ELEVATED); fallback: 1-Admin duy nhất tự duyệt được.
// Kiểm quyền bằng PERMISSION, KHÔNG bằng tên role. Mọi nhánh từ chối vẫn ghi audit (R_AUDIT_003).
import { auditSnapshot } from '@glb/business-rules';
import { hasPermission, type AuthUser } from '@glb/shared';
import type { Db } from '@glb/database';
import { requirePermission } from './guard.js';
import { writeAudit } from './audit.js';

const REQUEST = 'BILL_CANCEL_REQUEST';
const APPROVE = 'BILL_CANCEL_APPROVE';
const ELEVATED = 'BILL_CANCEL_APPROVE_ELEVATED';

/**
 * G10.C — gia cố tương tranh (concurrency-correctness). Ném BÊN TRONG `db.$transaction`
 * để (a) rollback nguyên tử khi conditional transition THUA (updateMany count===0), và
 * (b) mang mã lỗi ra ngoài để trả về cho client. KHÔNG audit/notify ở nhánh thua.
 * SQLite serialize nên đây là logic tất định; race thật kiểm ở G10.5 trên Postgres.
 */
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
export interface BulkResult {
  ok: boolean;
  error?: string;
  message?: string;
  done: number; // số approve/reject thành công
  skipped: { id: number; reason: string; message?: string }[];
}

/** Tập quyền hiệu lực của 1 user (theo id) — user → roles → role.permissions. */
async function userPermSet(db: Db, userId: number): Promise<Set<string>> {
  const u = await db.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } }
  });
  const s = new Set<string>();
  if (u) for (const ur of u.roles) for (const rp of ur.role.permissions) s.add(rp.permission.code);
  return s;
}

/** Số user CÒN SỐNG có 1 quyền cụ thể (để xét fallback "Admin duy nhất"). */
async function countUsersWithPerm(db: Db, code: string): Promise<number> {
  const users = await db.user.findMany({
    where: { deletedAt: null },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } }
  });
  let n = 0;
  for (const u of users) if (u.roles.some((ur) => ur.role.permissions.some((rp) => rp.permission.code === code))) n++;
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// THÔNG BÁO HỆ THỐNG (F-NOTIF) — đẩy sự kiện hủy bill vào hòm thư (bảng messages,
// kind=SYSTEM, senderId=null). Dùng lại chuông/badge/MessagesDrawer sẵn có.
// Phụ trợ tuyệt đối: nuốt lỗi — KHÔNG bao giờ làm hỏng luồng hủy/duyệt/từ chối.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Người ĐƯỢC duyệt 1 yêu cầu hủy — khớp phân vai của `listCancelRequests`/`canApprove`:
 * loại chính người tạo; yêu cầu do Quản lý/Admin (có APPROVE) tạo → chỉ cấp ELEVATED,
 * ngược lại mọi người có APPROVE. Chỉ user còn sống + ACTIVE (mới đăng nhập xử lý được).
 */
async function cancelApproverRecipients(db: Db, requestedBy: number): Promise<number[]> {
  const requesterPerms = await userPermSet(db, requestedBy);
  const needCode = requesterPerms.has(APPROVE) ? ELEVATED : APPROVE;
  const users = await db.user.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } }
  });
  const ids: number[] = [];
  for (const u of users) {
    if (u.id === requestedBy) continue; // loại chính người tạo (§②a)
    if (u.roles.some((ur) => ur.role.permissions.some((rp) => rp.permission.code === needCode))) ids.push(u.id);
  }
  return ids;
}

/** Chèn thông báo hệ thống tới danh sách người nhận (idempotent theo lần gọi sự kiện). */
async function pushSystemNotice(
  db: Db,
  recipientIds: number[],
  category: string,
  subject: string,
  body: string
): Promise<void> {
  const ids = [...new Set(recipientIds)];
  if (ids.length === 0) return;
  try {
    await db.message.createMany({
      data: ids.map((rid) => ({ kind: 'SYSTEM', category, subject, body, senderId: null, recipientId: rid }))
    });
  } catch {
    // Thông báo là phụ trợ — không được làm hỏng luồng chính (hủy/duyệt/từ chối bill).
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TẠO YÊU CẦU HỦY
// ═════════════════════════════════════════════════════════════════════════════
export async function requestCancelBill(transactionId: number, reason: string): Promise<MutationResult> {
  const g = await requirePermission(REQUEST, { action: 'BILL_CANCEL_REQUESTED', targetType: 'Transaction', targetId: String(transactionId) });
  if (!g.ok) return g;
  const { db, user } = g;
  const r = (reason ?? '').trim();
  if (!r) return { ok: false, error: 'VALIDATION', message: 'Vui lòng nhập lý do hủy bill.' };
  const tx = await db.transaction.findUnique({ where: { id: transactionId } });
  if (!tx || tx.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Giao dịch không tồn tại.' };
  if (tx.status !== 'POSTED')
    return { ok: false, error: 'INVALID_STATE', message: 'Chỉ bill đang hiệu lực mới tạo được yêu cầu hủy (đang chờ duyệt hoặc đã hủy).' };
  // CRITICAL-A: bọc chuyển-trạng-thái + tạo yêu cầu trong 1 interactive $transaction với
  // conditional transition (chống TOCTOU). 2 client cùng lúc → chỉ 1 chuyển được POSTED→CANCEL_PENDING;
  // client thua nhận count===0 → INVALID_STATE, KHÔNG tạo ApprovalRequest thứ 2.
  let req: { id: number };
  try {
    req = await db.$transaction(async (txc) => {
      const moved = await txc.transaction.updateMany({
        where: { id: transactionId, status: 'POSTED', deletedAt: null },
        data: { status: 'CANCEL_PENDING', updatedBy: user.id }
      });
      if (moved.count === 0)
        throw new TxGuardError('INVALID_STATE', 'Chỉ bill đang hiệu lực mới tạo được yêu cầu hủy (đang chờ duyệt hoặc đã hủy).');
      // Chỉ tạo yêu cầu KHI transition THẮNG — cùng transaction (nguyên tử).
      return txc.approvalRequest.create({
        data: { entityType: 'Transaction', entityId: transactionId, action: 'CANCEL', reason: r, requestedBy: user.id }
      });
    });
  } catch (e) {
    if (e instanceof TxGuardError) return { ok: false, error: e.code, message: e.userMessage };
    throw e;
  }
  // THẮNG → audit + notify (SAU khi transition thành công; nhánh thua đã return ở trên).
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'BILL_CANCEL_REQUESTED',
    targetType: 'Transaction',
    targetId: String(tx.id),
    after: auditSnapshot({ requestId: req.id, code: tx.code, reason: r })
  });
  // F-NOTIF: báo cho người ĐƯỢC duyệt yêu cầu này (phân vai) — đúng 1 lần/sự kiện.
  try {
    const recipients = await cancelApproverRecipients(db, user.id);
    await pushSystemNotice(
      db,
      recipients,
      'BILL_CANCEL_REQUEST',
      `Yêu cầu hủy bill ${tx.code}`,
      `${user.fullName} đề nghị hủy bill ${tx.code}. Lý do: ${r}. Vào mục Duyệt hủy bill để xử lý.`
    );
  } catch {
    // Thông báo phụ trợ — không chặn việc tạo yêu cầu.
  }
  return { ok: true, id: req.id };
}

// ═════════════════════════════════════════════════════════════════════════════
// DUYỆT / TỪ CHỐI (single) — phân vai
// ═════════════════════════════════════════════════════════════════════════════
type OneResult = { ok: true; id: number } | { ok: false; error: string; message: string };

/** Lõi duyệt 1 yêu cầu (đã có db + approver). Áp phân vai, ghi audit cả nhánh từ chối. */
async function approveOne(db: Db, user: AuthUser, requestId: number, decisionNote?: string): Promise<OneResult> {
  const req = await db.approvalRequest.findUnique({ where: { id: requestId } });
  if (!req || req.action !== 'CANCEL' || req.entityType !== 'Transaction')
    return { ok: false, error: 'NOT_FOUND', message: 'Yêu cầu hủy không tồn tại.' };
  // Phân vai (permission-based). Nhánh TỪ CHỐI CHÍNH SÁCH (self/elevated) VẪN ghi audit (R_AUDIT_003).
  // KHÁC với "đã xử lý/race thua" (ALREADY_DECIDED) — đó là no-op tương tranh, không ghi audit.
  const requesterPerms = await userPermSet(db, req.requestedBy);
  const requesterIsApprover = requesterPerms.has(APPROVE); // requester là Manager/Admin
  const approverElevated = hasPermission(user, ELEVATED); // approver là Admin
  const isSelf = user.id === req.requestedBy;
  let selfNote: string | null = null;

  if (isSelf) {
    // Mr.Long 13/7: ADMIN (elevated) ĐƯỢC tự duyệt yêu cầu của mình (chốt = nhập mật khẩu khi duyệt).
    if (approverElevated) {
      selfNote = 'Admin tự duyệt (đã nhập mật khẩu)';
    } else {
      await writeAudit(db, { actorUserId: user.id, action: 'BILL_CANCEL_APPROVED', targetType: 'ApprovalRequest', targetId: String(req.id), after: { denied: true, reason: 'SELF_APPROVAL_FORBIDDEN' } });
      return { ok: false, error: 'SELF_APPROVAL_FORBIDDEN', message: 'Chỉ Admin mới được tự duyệt yêu cầu của chính mình.' };
    }
  } else if (requesterIsApprover && !approverElevated) {
    // Yêu cầu do Manager/Admin tạo → cần cấp Admin (ELEVATED) duyệt.
    await writeAudit(db, { actorUserId: user.id, action: 'BILL_CANCEL_APPROVED', targetType: 'ApprovalRequest', targetId: String(req.id), after: { denied: true, reason: 'NEED_ELEVATED', requestedBy: req.requestedBy } });
    return { ok: false, error: 'NEED_ELEVATED', message: 'Yêu cầu do Quản lý/Admin tạo — cần cấp Admin duyệt.' };
  }

  const tx = await db.transaction.findUnique({ where: { id: req.entityId } });
  if (!tx || tx.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Bill không tồn tại.' };
  const note = [decisionNote?.trim() || null, selfNote].filter(Boolean).join(' · ') || null;
  const decidedAt = new Date();
  // CRITICAL-A: conditional transition trong 1 interactive $transaction (chống TOCTOU / duyệt 2 lần).
  //  (a) ApprovalRequest PENDING→APPROVED (count===0 → ALREADY_DECIDED, đã bị xử lý);
  //  (b) Transaction CANCEL_PENDING→CANCELLED (count===0 → INVALID_STATE).
  // Cả 2 cùng transaction → chỉ NGƯỜI THẮNG mới ghi audit + notify (nhánh thua rollback, return trước).
  try {
    await db.$transaction(async (txc) => {
      const reqMoved = await txc.approvalRequest.updateMany({
        where: { id: req.id, status: 'PENDING' },
        data: { status: 'APPROVED', decidedBy: user.id, decidedAt, decisionNote: note }
      });
      if (reqMoved.count === 0)
        throw new TxGuardError('ALREADY_DECIDED', 'Yêu cầu đã được xử lý (không còn chờ duyệt).');
      const billMoved = await txc.transaction.updateMany({
        where: { id: tx.id, status: 'CANCEL_PENDING', deletedAt: null },
        data: { status: 'CANCELLED', cancelledAt: decidedAt, cancelReason: req.reason, cancelRequestId: req.id, updatedBy: user.id }
      });
      if (billMoved.count === 0)
        throw new TxGuardError('INVALID_STATE', 'Bill không ở trạng thái chờ hủy (có thể đã đổi trạng thái).');
    });
  } catch (e) {
    if (e instanceof TxGuardError) return { ok: false, error: e.code, message: e.userMessage };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'BILL_CANCEL_APPROVED', targetType: 'Transaction', targetId: String(tx.id), before: auditSnapshot({ status: tx.status, revenueAmount: tx.revenueAmount }), after: auditSnapshot({ status: 'CANCELLED', requestId: req.id, note }) });
  // F-NOTIF: báo kết quả cho người tạo yêu cầu (§②b) — chỉ chạy ở nhánh thành công.
  try {
    await pushSystemNotice(
      db,
      [req.requestedBy],
      'BILL_CANCEL_APPROVED',
      `Yêu cầu hủy bill ${tx.code} đã được DUYỆT`,
      `Yêu cầu hủy bill ${tx.code} của bạn đã được duyệt.${note ? ' Ghi chú: ' + note + '.' : ''}`
    );
  } catch {
    // Thông báo phụ trợ — không chặn việc duyệt.
  }
  return { ok: true, id: req.id };
}

async function rejectOne(db: Db, user: AuthUser, requestId: number, decisionNote: string): Promise<OneResult> {
  const req = await db.approvalRequest.findUnique({ where: { id: requestId } });
  if (!req || req.action !== 'CANCEL' || req.entityType !== 'Transaction') return { ok: false, error: 'NOT_FOUND', message: 'Yêu cầu hủy không tồn tại.' };
  const note = (decisionNote ?? '').trim();
  if (!note) return { ok: false, error: 'VALIDATION', message: 'Vui lòng nhập lý do từ chối.' };
  const decidedAt = new Date();
  // CRITICAL-A: conditional transition trong 1 interactive $transaction (chống TOCTOU / từ chối 2 lần).
  // ApprovalRequest PENDING→REJECTED (count===0 → INVALID_STATE, đã bị xử lý) + HOÀN bill CANCEL_PENDING→POSTED.
  // Chỉ NGƯỜI THẮNG mới ghi audit + notify (nhánh thua rollback, return trước).
  try {
    await db.$transaction(async (txc) => {
      const reqMoved = await txc.approvalRequest.updateMany({
        where: { id: req.id, status: 'PENDING' },
        data: { status: 'REJECTED', decidedBy: user.id, decidedAt, decisionNote: note }
      });
      if (reqMoved.count === 0) throw new TxGuardError('INVALID_STATE', 'Yêu cầu đã được xử lý.');
      // Hoàn bill về POSTED — chỉ khi đang chờ hủy (guard theo trạng thái, không ép trạng thái khác).
      await txc.transaction.updateMany({
        where: { id: req.entityId, status: 'CANCEL_PENDING' },
        data: { status: 'POSTED', updatedBy: user.id }
      });
    });
  } catch (e) {
    if (e instanceof TxGuardError) return { ok: false, error: e.code, message: e.userMessage };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'BILL_CANCEL_REJECTED', targetType: 'Transaction', targetId: String(req.entityId), after: auditSnapshot({ requestId: req.id, note }) });
  // F-NOTIF: báo kết quả cho người tạo yêu cầu (§②b) — chỉ chạy ở nhánh thành công.
  try {
    const txForNotice = await db.transaction.findUnique({ where: { id: req.entityId }, select: { code: true } });
    const code = txForNotice?.code ?? String(req.entityId);
    await pushSystemNotice(
      db,
      [req.requestedBy],
      'BILL_CANCEL_REJECTED',
      `Yêu cầu hủy bill ${code} bị TỪ CHỐI`,
      `Yêu cầu hủy bill ${code} của bạn đã bị từ chối. Lý do: ${note}.`
    );
  } catch {
    // Thông báo phụ trợ — không chặn việc từ chối.
  }
  return { ok: true, id: req.id };
}

export async function approveCancelBill(requestId: number, decisionNote?: string): Promise<MutationResult> {
  const g = await requirePermission(APPROVE, { action: 'BILL_CANCEL_APPROVED', targetType: 'ApprovalRequest', targetId: String(requestId) });
  if (!g.ok) return g;
  const r = await approveOne(g.db, g.user, requestId, decisionNote);
  return r.ok ? { ok: true, id: r.id } : { ok: false, error: r.error, message: r.message };
}

export async function rejectCancelBill(requestId: number, decisionNote: string): Promise<MutationResult> {
  const g = await requirePermission(APPROVE, { action: 'BILL_CANCEL_REJECTED', targetType: 'ApprovalRequest', targetId: String(requestId) });
  if (!g.ok) return g;
  const r = await rejectOne(g.db, g.user, requestId, decisionNote);
  return r.ok ? { ok: true, id: r.id } : { ok: false, error: r.error, message: r.message };
}

// ═════════════════════════════════════════════════════════════════════════════
// DUYỆT / TỪ CHỐI HÀNG LOẠT (§4.4b) — mỗi cái áp phân vai riêng, cái không được phép thì SKIP
// ═════════════════════════════════════════════════════════════════════════════
export async function approveCancelBills(requestIds: number[], decisionNote?: string): Promise<BulkResult> {
  const g = await requirePermission(APPROVE, { action: 'BILL_CANCEL_APPROVED', targetType: 'ApprovalRequest' });
  if (!g.ok) return { ...g, done: 0, skipped: [] };
  if (!requestIds || requestIds.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn yêu cầu.', done: 0, skipped: [] };
  let done = 0;
  const skipped: BulkResult['skipped'] = [];
  for (const id of requestIds) {
    const r = await approveOne(g.db, g.user, id, decisionNote);
    if (r.ok) done++;
    else skipped.push({ id, reason: r.error, message: r.message });
  }
  return { ok: true, done, skipped };
}

export async function rejectCancelBills(requestIds: number[], decisionNote: string): Promise<BulkResult> {
  const g = await requirePermission(APPROVE, { action: 'BILL_CANCEL_REJECTED', targetType: 'ApprovalRequest' });
  if (!g.ok) return { ...g, done: 0, skipped: [] };
  if (!requestIds || requestIds.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn yêu cầu.', done: 0, skipped: [] };
  let done = 0;
  const skipped: BulkResult['skipped'] = [];
  for (const id of requestIds) {
    const r = await rejectOne(g.db, g.user, id, decisionNote);
    if (r.ok) done++;
    else skipped.push({ id, reason: r.error, message: r.message });
  }
  return { ok: true, done, skipped };
}

// ═════════════════════════════════════════════════════════════════════════════
// DANH SÁCH yêu cầu (cho UI Duyệt hủy) — lọc theo phân vai: chỉ trả yêu cầu approver ĐƯỢC PHÉP duyệt.
// ═════════════════════════════════════════════════════════════════════════════
export interface CancelRequestDto {
  id: number;
  transactionId: number;
  billCode: string | null;
  amount: number;
  reason: string;
  status: string;
  requestedBy: number;
  requestedByName: string | null;
  requestedAt: string;
  canApprove: boolean; // approver hiện tại có được duyệt cái này không (phân vai)
  isSelf: boolean; // bạn là người tạo yêu cầu này → hiện để biết đang chờ người khác duyệt (không tự duyệt được).
}

export async function listCancelRequests(status = 'PENDING'): Promise<{ ok: boolean; error?: string; message?: string; data?: CancelRequestDto[] }> {
  const g = await requirePermission(APPROVE, { action: APPROVE });
  if (!g.ok) return g;
  const { db, user } = g;
  const approverElevated = hasPermission(user, ELEVATED);
  const rows = await db.approvalRequest.findMany({ where: { entityType: 'Transaction', action: 'CANCEL', status }, orderBy: { requestedAt: 'desc' } });
  const txIds = [...new Set(rows.map((r) => r.entityId))];
  const txs = new Map((await db.transaction.findMany({ where: { id: { in: txIds } }, select: { id: true, code: true, amount: true } })).map((t) => [t.id, t]));
  const reqUserIds = [...new Set(rows.map((r) => r.requestedBy))];
  const names = new Map((await db.user.findMany({ where: { id: { in: reqUserIds } }, select: { id: true, fullName: true, username: true } })).map((u) => [u.id, u.fullName || u.username]));
  const data: CancelRequestDto[] = [];
  for (const r of rows) {
    const requesterPerms = await userPermSet(db, r.requestedBy);
    const requesterIsApprover = requesterPerms.has(APPROVE);
    const isSelf = user.id === r.requestedBy;
    // Mr.Long 13/7: ADMIN (elevated) được tự duyệt yêu cầu của mình (chốt = nhập mật khẩu khi duyệt).
    let canApprove = true;
    if (isSelf) canApprove = approverElevated;
    else if (requesterIsApprover && !approverElevated) canApprove = false;
    const t = txs.get(r.entityId);
    data.push({
      id: r.id,
      transactionId: r.entityId,
      billCode: t?.code ?? null,
      amount: Number(t?.amount ?? 0),
      reason: r.reason,
      status: r.status,
      requestedBy: r.requestedBy,
      requestedByName: names.get(r.requestedBy) ?? null,
      requestedAt: r.requestedAt.toISOString(),
      canApprove,
      isSelf
    });
  }
  return { ok: true, data };
}
