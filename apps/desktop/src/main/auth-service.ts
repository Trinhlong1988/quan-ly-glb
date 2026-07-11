// Auth service (main process). Wraps @glb/business-rules decisions with DB access + audit.
import { randomUUID } from 'node:crypto';
import type { Db } from '@glb/database';
import {
  decideLogin,
  loginDenyMessage,
  hashPassword,
  verifyPassword,
  hashLevel2,
  verifyLevel2,
  reachesLockout,
  MAX_FAILED_ATTEMPTS,
  type AuthUserRecord
} from '@glb/business-rules';
import { hasPermission, validatePassword, type AuthUser, type UserStatus } from '@glb/shared';
import { getDb } from './db.js';
import { writeAudit } from './audit.js';
import { requirePermission, verifyActorPassword } from './guard.js';
import { notifyAdmins } from './message-service.js';

/**
 * Ghi nhận 1 lần xác thực SAI (đăng nhập / đổi mật khẩu / pass cấp 2). Tăng bộ đếm; chạm ngưỡng
 * MAX_FAILED_ATTEMPTS → tự khóa (status=LOCKED) + push hòm thư thông báo cho Admin/Manager.
 * Bỏ qua nếu tài khoản đã LOCKED/DELETED. Trả về true nếu vừa bị khóa ở lần này.
 */
async function registerFailedAuth(db: Db, userId: number, reasonLabel: string): Promise<boolean> {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, fullName: true, status: true, failedAttempts: true }
  });
  if (!row) return false;
  if (row.status === 'LOCKED' || row.status === 'DELETED') return false;
  const failed = row.failedAttempts + 1;
  const lock = reachesLockout(failed);
  await db.user.update({
    where: { id: userId },
    data: lock
      ? { failedAttempts: failed, status: 'LOCKED', lockedAt: new Date() }
      : { failedAttempts: failed }
  });
  if (lock) {
    await writeAudit(db, {
      actorUserId: userId,
      action: 'USER_AUTO_LOCKED',
      targetType: 'User',
      targetId: String(userId),
      after: { username: row.username, reason: reasonLabel, failedAttempts: failed }
    });
    await notifyAdmins(db, {
      category: 'SECURITY_LOCK',
      subject: `Tài khoản bị tự khóa: ${row.fullName} (${row.username})`,
      body:
        `Tài khoản "${row.username}" (${row.fullName}) đã bị TỰ ĐỘNG KHÓA sau ${failed} lần xác thực sai ` +
        `(${reasonLabel}). Vui lòng kiểm tra và mở khóa nếu hợp lệ.`
    });
  }
  return lock;
}

/** Xác thực đúng → xóa bộ đếm sai (nếu đang > 0). */
async function clearFailedAttempts(db: Db, userId: number, current: number): Promise<void> {
  if (current > 0) await db.user.update({ where: { id: userId }, data: { failedAttempts: 0 } });
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
// R46: phiên coi là CÒN SỐNG nếu nhịp tim (lastSeenAt) trong vòng STALE. Renderer heartbeat mỗi ~15s →
// bỏ lỡ 3 nhịp (45s) coi như thiết bị đã tắt/mất mạng → phiên chết, không chặn đăng nhập nơi khác.
const SESSION_STALE_MS = 45 * 1000;
// Khóa advisory 2-int (key1 cố định, key2 = userId) serialize mọi luồng đăng nhập CÙNG 1 user → chống race
// tạo 2 phiên (mỗi thiết bị đọc "chưa có phiên" rồi cùng tạo). Cùng lớp bài học B27 (TOCTOU).
const LOGIN_LOCK_KEY = 918273;

interface SessionState {
  sessionId: string;
  user: AuthUser;
}
let current: SessionState | null = null;

/** Danh sách phiên CÒN SỐNG (chưa hết hạn + nhịp tim còn) của 1 user — trừ phiên `exceptId` nếu có. */
async function liveSessionsOf(db: Db, userId: number, exceptId?: string): Promise<{ id: string; deviceInfo: string | null; deviceId: string | null; lastSeenAt: Date }[]> {
  const now = Date.now();
  const rows = await db.loginSession.findMany({
    where: { userId, expiresAt: { gt: new Date(now) }, lastSeenAt: { gt: new Date(now - SESSION_STALE_MS) }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, deviceInfo: true, deviceId: true, lastSeenAt: true }
  });
  return rows;
}
// Khóa nhận diện thiết bị: ưu tiên deviceId (GUID bền, chống giả mạo); selftest/không có GUID → dùng deviceInfo.
const deviceKey = (deviceId: string | null | undefined, deviceInfo: string | null | undefined): string | null => deviceId ?? deviceInfo ?? null;

/** Build the flattened AuthUser (roles + effective permissions) from the DB. */
async function buildAuthUser(db: Db, userId: number): Promise<AuthUser> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      roles: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } }
        }
      }
    }
  });
  const roleCodes: string[] = [];
  const permSet = new Set<string>();
  for (const ur of user.roles) {
    // Only ACTIVE roles grant access (LOCKED role contributes nothing).
    if (ur.role.status !== 'ACTIVE') continue;
    roleCodes.push(ur.role.code);
    for (const rp of ur.role.permissions) permSet.add(rp.permission.code);
  }
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    status: user.status as UserStatus,
    forceChangePassword: user.forceChangePassword,
    roles: roleCodes,
    permissions: [...permSet]
  };
}

export interface LoginOutcome {
  ok: boolean;
  user?: AuthUser;
  mustChangePassword?: boolean;
  error?: string;
  message?: string;
  /** R46: khi tài khoản đang đăng nhập ở thiết bị khác — tên thiết bị đó để hiển thị xác nhận. */
  otherDevice?: string;
}

export interface LoginOpts {
  /** true = đăng nhập tại đây, ĐĂNG XUẤT thiết bị đang đăng nhập (sau khi người dùng xác nhận). */
  force?: boolean;
  /** Tên máy/thiết bị (os.hostname) để HIỂN THỊ + lưu vào phiên (nhãn, có thể giả mạo). */
  deviceInfo?: string;
  /** R48 — GUID/1-cài-đặt (userData): KHÓA nhận diện thiết bị (same-device detect chống giả mạo hostname). */
  deviceId?: string;
}

// R48 Pha 2 — KHÓA TẠM THỜI: sai ≥5 lần → khóa, nhưng TỰ MỞ sau LOCKOUT_COOLDOWN (chống DoS khóa vĩnh viễn
// mọi admin). Admin vẫn mở tay sớm được. Attacker chỉ khóa được 1 nạn nhân tối đa cooldown, không vĩnh viễn.
const LOCKOUT_COOLDOWN_MS = 15 * 60 * 1000;

export async function login(username: string, password: string, opts: LoginOpts = {}): Promise<LoginOutcome> {
  const db = getDb();
  let row = await db.user.findFirst({ where: { username, deletedAt: null } });

  // #1 — Nếu đang LOCKED do sai mật khẩu nhưng ĐÃ QUA cooldown → tự mở khóa rồi mới xét đăng nhập.
  if (row && row.status === 'LOCKED' && row.lockedAt && Date.now() - row.lockedAt.getTime() >= LOCKOUT_COOLDOWN_MS) {
    await db.user.update({ where: { id: row.id }, data: { status: 'ACTIVE', failedAttempts: 0, lockedAt: null } });
    await writeAudit(db, { actorUserId: row.id, action: 'USER_AUTO_UNLOCKED', targetType: 'User', targetId: String(row.id), after: { username: row.username, reason: 'hết thời gian tạm khóa' } });
    row = await db.user.findFirst({ where: { username, deletedAt: null } });
  }

  const record: AuthUserRecord | null = row
    ? {
        id: row.id,
        username: row.username,
        passwordHash: row.passwordHash,
        status: row.status as UserStatus,
        forceChangePassword: row.forceChangePassword
      }
    : null;

  const decision = decideLogin(record, password);

  if (!decision.allowed) {
    // R_AUDIT: failed login is logged. Do NOT leak status on wrong password.
    await writeAudit(db, {
      actorUserId: row?.id ?? null,
      action: 'LOGIN_FAILED',
      targetType: 'User',
      targetId: row ? String(row.id) : null,
      after: { username, reason: decision.reason }
    });
    // Sai MẬT KHẨU trên tài khoản có thật → tính vào bộ đếm khóa (5 lần → tự khóa + báo admin).
    // reason INVALID_CREDENTIALS + row tồn tại = sai mật khẩu (không phải username không tồn tại).
    if (row && decision.reason === 'INVALID_CREDENTIALS') {
      const justLocked = await registerFailedAuth(db, row.id, 'đăng nhập sai mật khẩu');
      if (justLocked) {
        return {
          ok: false,
          error: 'STATUS_LOCKED',
          message: `Tài khoản tạm khóa do sai mật khẩu quá ${MAX_FAILED_ATTEMPTS} lần. Tự mở sau 15 phút, hoặc liên hệ quản trị mở sớm.`
        };
      }
    }
    return {
      ok: false,
      error: decision.reason,
      message: decision.reason ? loginDenyMessage(decision.reason) : 'Đăng nhập không hợp lệ.'
    };
  }

  // Đăng nhập thành công → xóa bộ đếm sai.
  if (row && row.failedAttempts > 0) await clearFailedAttempts(db, row.id, row.failedAttempts);

  const authUser = await buildAuthUser(db, record!.id);
  const userId = record!.id;
  const sessionId = randomUUID();

  // R46 — 1 tài khoản 1 thiết bị. Serialize theo user (advisory lock) rồi kiểm/ghi phiên trong CÙNG transaction.
  // Đăng nhập lại trên CÙNG thiết bị (khớp deviceInfo) → thay thế IM LẶNG (app khởi động lại / đăng nhập lại
  // không cần hỏi). Chỉ CHẶN + hỏi khi đang đăng nhập ở thiết bị KHÁC.
  const myKey = deviceKey(opts.deviceId, opts.deviceInfo); // khóa nhận diện thiết bị (GUID ưu tiên)
  const outcome = await db.$transaction(async (txc) => {
    await txc.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1, $2)', LOGIN_LOCK_KEY, userId);
    const live = await liveSessionsOf(txc as unknown as Db, userId);
    const sameDevice = live.filter((o) => deviceKey(o.deviceId, o.deviceInfo) === myKey);
    const otherDevices = live.filter((o) => deviceKey(o.deviceId, o.deviceInfo) !== myKey);
    if (otherDevices.length > 0 && !opts.force) {
      // Đang đăng nhập ở thiết bị KHÁC (khác GUID) + CHƯA xác nhận → KHÔNG tạo phiên, trả tên thiết bị để hỏi.
      return { blocked: true as const, otherDevice: otherDevices[0].deviceInfo ?? 'thiết bị khác' };
    }
    // Xóa phiên cùng thiết bị (thay thế) + (nếu force) phiên thiết bị khác (đá ra → kick ở heartbeat).
    const toDelete = [...sameDevice, ...(opts.force ? otherDevices : [])].map((o) => o.id);
    if (toDelete.length > 0) await txc.loginSession.deleteMany({ where: { userId, id: { in: toDelete } } });
    await txc.loginSession.create({
      data: { id: sessionId, userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS), lastSeenAt: new Date(), deviceInfo: opts.deviceInfo ?? null, deviceId: opts.deviceId ?? null }
    });
    return { blocked: false as const };
  });

  if (outcome.blocked) {
    return {
      ok: false,
      error: 'SESSION_ACTIVE_ELSEWHERE',
      message: `Tài khoản đang đăng nhập ở ${outcome.otherDevice}. Xác nhận đăng nhập tại đây sẽ đăng xuất thiết bị kia.`,
      otherDevice: outcome.otherDevice
    };
  }

  current = { sessionId, user: authUser };
  await writeAudit(db, {
    actorUserId: userId,
    action: 'LOGIN_SUCCESS',
    targetType: 'User',
    targetId: String(userId),
    after: { username: authUser.username, device: opts.deviceInfo ?? null, kickedOther: opts.force === true }
  });

  return { ok: true, user: authUser, mustChangePassword: decision.mustChangePassword };
}

/**
 * R46 — nhịp tim: renderer gọi định kỳ. Cập nhật lastSeenAt cho phiên hiện tại. Nếu phiên KHÔNG còn trong DB
 * (bị thiết bị khác đăng nhập đá ra / hết hạn) → trả kicked=true để renderer buộc về màn đăng nhập.
 */
export async function heartbeat(): Promise<{ ok: boolean; kicked?: boolean; byDevice?: string }> {
  if (!current) return { ok: false };
  const db = getDb();
  const res = await db.loginSession.updateMany({
    where: { id: current.sessionId, expiresAt: { gt: new Date() } },
    data: { lastSeenAt: new Date() }
  });
  if (res.count === 0) {
    const uid = current.user.id;
    current = null;
    // C7 (R48) — cho renderer biết THIẾT BỊ nào vừa đăng nhập đè để báo rõ ràng.
    const live = await liveSessionsOf(db, uid);
    return { ok: false, kicked: true, byDevice: live[0]?.deviceInfo ?? undefined };
  }
  return { ok: true };
}

export interface OnlineUserDto {
  userId: number;
  username: string;
  fullName: string;
  deviceInfo: string | null;
  since: string; // ISO createdAt của phiên còn sống mới nhất
}

/** R41 — danh sách user ĐANG đăng nhập (phiên còn nhịp tim), gộp theo user (1 dòng/1 user). */
export async function listOnlineUsers(): Promise<{ ok: boolean; error?: string; message?: string; data?: OnlineUserDto[] }> {
  const g = await requirePermission('USER_READ', { action: 'LOGIN_SUCCESS', targetType: 'User' });
  if (!g.ok) return g;
  const { db } = g;
  const now = Date.now();
  const rows = await db.loginSession.findMany({
    where: { expiresAt: { gt: new Date(now) }, lastSeenAt: { gt: new Date(now - SESSION_STALE_MS) } },
    include: { user: { select: { id: true, username: true, fullName: true } } },
    orderBy: { createdAt: 'desc' }
  });
  const byUser = new Map<number, OnlineUserDto>();
  for (const s of rows) {
    if (!s.user || byUser.has(s.userId)) continue; // giữ phiên mới nhất/1 user
    byUser.set(s.userId, { userId: s.userId, username: s.user.username, fullName: s.user.fullName, deviceInfo: s.deviceInfo, since: s.createdAt.toISOString() });
  }
  return { ok: true, data: [...byUser.values()] };
}

export function me(): AuthUser | null {
  return current?.user ?? null;
}

/**
 * R48 Pha 2 (#3) — GUARD AUTHORITATIVE: xác thực phiên hiện tại còn SỐNG trong DB (id + chưa hết hạn) trên
 * MỖI thao tác có quyền → kick (đăng nhập thiết bị khác) hoặc hết hạn TTL THU HỒI quyền ngay (không chờ nhịp
 * tim renderer). Đồng thời làm mới status + forceChangePassword từ DB. Trả null (và null hóa current) nếu phiên
 * chết / user bị khóa/xóa. 1 truy vấn có index.
 */
export async function validateCurrentSession(): Promise<{ user: AuthUser; forceChangePassword: boolean } | null> {
  if (!current) return null;
  const db = getDb();
  const s = await db.loginSession.findFirst({
    where: { id: current.sessionId, expiresAt: { gt: new Date() } },
    include: { user: { select: { status: true, deletedAt: true, forceChangePassword: true } } }
  });
  if (!s || !s.user || s.user.deletedAt || s.user.status === 'DELETED' || s.user.status === 'LOCKED') {
    current = null;
    return null;
  }
  current.user.forceChangePassword = s.user.forceChangePassword;
  return { user: current.user, forceChangePassword: s.user.forceChangePassword };
}

/** R48 Pha 2 (#4) — cho guard tính lần re-auth SAI (mật khẩu/level2 khi xác nhận thao tác) vào bộ đếm khóa. */
export async function penalizeFailedAuth(userId: number, label: string): Promise<void> {
  await registerFailedAuth(getDb(), userId, label);
}

export async function logout(): Promise<void> {
  if (!current) return;
  const db = getDb();
  try {
    await db.loginSession.deleteMany({ where: { id: current.sessionId } });
  } catch {
    /* session already gone */
  }
  current = null;
}

export interface ChangePasswordOutcome {
  ok: boolean;
  error?: string;
  message?: string;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  confirmPassword?: string
): Promise<ChangePasswordOutcome> {
  if (!current) {
    return { ok: false, error: 'NOT_AUTHENTICATED', message: 'Chưa đăng nhập.' };
  }
  const db = getDb();
  const row = await db.user.findUniqueOrThrow({ where: { id: current.user.id } });

  // 1) Xác thực mật khẩu HIỆN TẠI — sai thì tính vào bộ đếm khóa (quyết định 3b).
  if (!verifyPassword(currentPassword, row.passwordHash)) {
    const justLocked = await registerFailedAuth(db, row.id, 'đổi mật khẩu sai mật khẩu cũ');
    if (justLocked) {
      return {
        ok: false,
        error: 'ACCOUNT_LOCKED',
        message: `Tài khoản đã bị khóa do sai mật khẩu quá ${MAX_FAILED_ATTEMPTS} lần. Vui lòng liên hệ quản trị để mở khóa.`
      };
    }
    return { ok: false, error: 'WRONG_CURRENT_PASSWORD', message: 'Mật khẩu hiện tại không đúng.' };
  }

  // 2) Xác nhận lại mật khẩu mới phải KHỚP.
  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    return { ok: false, error: 'PASSWORD_MISMATCH', message: 'Mật khẩu mới và xác nhận không khớp nhau.' };
  }
  // 3) Mật khẩu mới đủ mạnh.
  const v = validatePassword(newPassword);
  if (!v.valid) {
    return { ok: false, error: 'WEAK_PASSWORD', message: v.error };
  }
  // 4) Phải khác mật khẩu hiện tại.
  if (verifyPassword(newPassword, row.passwordHash)) {
    return {
      ok: false,
      error: 'SAME_PASSWORD',
      message: 'Mật khẩu mới phải khác mật khẩu hiện tại.'
    };
  }

  await db.user.update({
    where: { id: row.id },
    data: { passwordHash: hashPassword(newPassword), forceChangePassword: false, failedAttempts: 0 }
  });

  // refresh session user snapshot
  current.user = await buildAuthUser(db, row.id);

  await writeAudit(db, {
    actorUserId: row.id,
    action: 'PASSWORD_CHANGED',
    targetType: 'User',
    targetId: String(row.id),
    after: { username: row.username }
  });

  return { ok: true };
}

/**
 * Admin/Manager ĐẶT LẠI mật khẩu cho user KHÁC (USER_RESET_PASSWORD).
 * Không cần mật khẩu cũ của user đó; đặt mật khẩu mới + ÉP đổi ở lần đăng nhập kế + mở khóa + xóa bộ đếm sai.
 * Gửi thông báo vào hòm thư của user bị đặt lại.
 *
 * BẢO MẬT (B19): thao tác nhạy cảm trên tài khoản NGƯỜI KHÁC PHẢI re-auth chính actor đang đăng nhập —
 * bắt actor nhập lại MẬT KHẨU ĐĂNG NHẬP của mình (chống chiếm tài khoản qua phiên bỏ ngỏ). Tái dùng đúng
 * pattern verifyActorPassword như thao tác xóa (không tính vào bộ đếm khóa — nhất quán với delete).
 */
export async function adminResetPassword(
  targetUserId: number,
  newPassword: string,
  actorPassword: string
): Promise<ChangePasswordOutcome> {
  const g = await requirePermission('USER_RESET_PASSWORD', {
    action: 'PASSWORD_RESET_BY_ADMIN',
    targetType: 'User',
    targetId: String(targetUserId)
  });
  if (!g.ok) return g;
  const { db, user: actor } = g;

  // Re-auth actor: sai mật khẩu của chính mình → KHÔNG đổi gì DB (chỉ ghi audit từ chối), như thao tác xóa.
  if (!(await verifyActorPassword(actor, actorPassword))) {
    await writeAudit(db, {
      actorUserId: actor.id,
      action: 'PERMISSION_DENIED',
      targetType: 'User',
      targetId: String(targetUserId),
      after: { deniedAction: 'PASSWORD_RESET_BY_ADMIN', reason: 'WRONG_ACTOR_PASSWORD', actor: actor.username }
    });
    return {
      ok: false,
      error: 'WRONG_ACTOR_PASSWORD',
      message: 'Mật khẩu của bạn không đúng — không thể đặt lại mật khẩu người dùng.'
    };
  }

  const target = await db.user.findFirst({ where: { id: targetUserId, deletedAt: null } });
  if (!target) return { ok: false, error: 'NOT_FOUND', message: 'Không tìm thấy nhân sự cần đặt lại mật khẩu.' };

  const v = validatePassword(newPassword);
  if (!v.valid) return { ok: false, error: 'WEAK_PASSWORD', message: v.error };

  await db.user.update({
    where: { id: target.id },
    data: {
      passwordHash: hashPassword(newPassword),
      forceChangePassword: true,
      failedAttempts: 0,
      // Đặt lại mật khẩu cũng MỞ KHÓA nếu tài khoản đang bị tự khóa.
      ...(target.status === 'LOCKED' ? { status: 'ACTIVE', lockedAt: null } : {})
    }
  });

  await writeAudit(db, {
    actorUserId: actor.id,
    action: 'PASSWORD_RESET_BY_ADMIN',
    targetType: 'User',
    targetId: String(target.id),
    after: { username: target.username, by: actor.username, unlocked: target.status === 'LOCKED' }
  });

  // Báo cho user bị đặt lại (hòm thư).
  try {
    await db.message.create({
      data: {
        kind: 'SYSTEM',
        category: 'SECURITY_RESET',
        subject: 'Mật khẩu của bạn đã được đặt lại',
        body:
          `Quản trị viên "${actor.fullName}" đã đặt lại mật khẩu đăng nhập của bạn. ` +
          `Bạn sẽ được yêu cầu đổi mật khẩu mới ngay ở lần đăng nhập kế tiếp.`,
        senderId: null,
        recipientId: target.id
      }
    });
  } catch {
    /* thông báo phụ trợ — không chặn luồng chính */
  }

  return { ok: true };
}

// ══════════════════ MẬT KHẨU CẤP 2 (Nhóm A #3 — chỉ Admin/Manager) ══════════════════

export interface Level2StatusOutcome {
  ok: boolean;
  hasLevel2?: boolean;
  error?: string;
  message?: string;
}

/** LEVEL2_MANAGE — người đang đăng nhập đã đặt mật khẩu cấp 2 chưa (để UI chọn form Đặt / Đổi). */
export async function getLevel2Status(): Promise<Level2StatusOutcome> {
  const g = await requirePermission('LEVEL2_MANAGE', { action: 'LEVEL2_STATUS' });
  if (!g.ok) return g;
  const row = await g.db.user.findUnique({ where: { id: g.user.id }, select: { level2Hash: true } });
  return { ok: true, hasLevel2: !!row?.level2Hash };
}

/**
 * ĐẶT mật khẩu cấp 2 lần đầu (LEVEL2_MANAGE). Xác thực mật khẩu CẤP 1 (đăng nhập) + cấp 2 mới ×2 khớp.
 * Nếu đã có pass cấp 2 → dùng resetLevel2Password. Sai mật khẩu cấp 1 → tính vào khóa.
 */
export async function setLevel2Password(
  level1Password: string,
  newLevel2: string,
  confirmLevel2: string
): Promise<ChangePasswordOutcome> {
  const g = await requirePermission('LEVEL2_MANAGE', { action: 'LEVEL2_SET' });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (row.level2Hash) return { ok: false, error: 'ALREADY_SET', message: 'Bạn đã có mật khẩu cấp 2. Vui lòng dùng chức năng Đổi mật khẩu cấp 2.' };

  if (!verifyPassword(level1Password, row.passwordHash)) {
    const locked = await registerFailedAuth(db, row.id, 'đặt mật khẩu cấp 2 sai mật khẩu cấp 1');
    if (locked) return { ok: false, error: 'ACCOUNT_LOCKED', message: `Tài khoản đã bị khóa do sai quá ${MAX_FAILED_ATTEMPTS} lần.` };
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu đăng nhập (cấp 1) không đúng.' };
  }
  if (newLevel2 !== confirmLevel2) return { ok: false, error: 'PASSWORD_MISMATCH', message: 'Mật khẩu cấp 2 và xác nhận không khớp nhau.' };
  const v = validatePassword(newLevel2);
  if (!v.valid) return { ok: false, error: 'WEAK_PASSWORD', message: v.error };

  await db.user.update({ where: { id: row.id }, data: { level2Hash: hashLevel2(newLevel2), level2SetAt: new Date(), failedAttempts: 0 } });
  await writeAudit(db, { actorUserId: row.id, action: 'LEVEL2_SET', targetType: 'User', targetId: String(row.id), after: { username: row.username } });
  return { ok: true };
}

/**
 * ĐỔI/ĐẶT LẠI mật khẩu cấp 2 (LEVEL2_MANAGE). Yêu cầu: mật khẩu CẤP 1 + cấp 2 CŨ + cấp 2 MỚI ×2 khớp.
 * Sai mật khẩu cấp 1 HOẶC cấp 2 cũ → tính vào bộ đếm khóa; quá 5 lần → khóa tài khoản.
 */
export async function resetLevel2Password(
  level1Password: string,
  oldLevel2: string,
  newLevel2: string,
  confirmLevel2: string
): Promise<ChangePasswordOutcome> {
  const g = await requirePermission('LEVEL2_MANAGE', { action: 'LEVEL2_RESET' });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!row.level2Hash) return { ok: false, error: 'NOT_SET', message: 'Bạn chưa có mật khẩu cấp 2. Vui lòng dùng chức năng Đặt mật khẩu cấp 2.' };

  // Sai mật khẩu cấp 1 → tính vào khóa.
  if (!verifyPassword(level1Password, row.passwordHash)) {
    const locked = await registerFailedAuth(db, row.id, 'đổi mật khẩu cấp 2 sai mật khẩu cấp 1');
    if (locked) return { ok: false, error: 'ACCOUNT_LOCKED', message: `Tài khoản đã bị khóa do sai quá ${MAX_FAILED_ATTEMPTS} lần.` };
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu đăng nhập (cấp 1) không đúng.' };
  }
  // Sai mật khẩu cấp 2 CŨ → tính vào khóa.
  if (!verifyLevel2(oldLevel2, row.level2Hash)) {
    const locked = await registerFailedAuth(db, row.id, 'đổi mật khẩu cấp 2 sai mật khẩu cấp 2 cũ');
    if (locked) return { ok: false, error: 'ACCOUNT_LOCKED', message: `Tài khoản đã bị khóa do sai quá ${MAX_FAILED_ATTEMPTS} lần.` };
    return { ok: false, error: 'WRONG_LEVEL2', message: 'Mật khẩu cấp 2 cũ không đúng.' };
  }
  if (newLevel2 !== confirmLevel2) return { ok: false, error: 'PASSWORD_MISMATCH', message: 'Mật khẩu cấp 2 mới và xác nhận không khớp nhau.' };
  const v = validatePassword(newLevel2);
  if (!v.valid) return { ok: false, error: 'WEAK_PASSWORD', message: v.error };
  if (verifyLevel2(newLevel2, row.level2Hash)) return { ok: false, error: 'SAME_PASSWORD', message: 'Mật khẩu cấp 2 mới phải khác mật khẩu cấp 2 cũ.' };

  await db.user.update({ where: { id: row.id }, data: { level2Hash: hashLevel2(newLevel2), level2SetAt: new Date(), failedAttempts: 0 } });
  await writeAudit(db, { actorUserId: row.id, action: 'LEVEL2_RESET', targetType: 'User', targetId: String(row.id), after: { username: row.username } });
  return { ok: true };
}
