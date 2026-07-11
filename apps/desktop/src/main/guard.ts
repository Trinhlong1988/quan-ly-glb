// Permission guard (main). Enforces §13 permission checks and R_AUDIT_003:
// a mutation refused for lack of permission is STILL written to the audit log.
import { hasPermission, type AuthUser } from '@glb/shared';
import { verifyPassword, verifyLevel2 } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { getDb } from './db.js';
import { validateCurrentSession, penalizeFailedAuth } from './auth-service.js';
import { writeAudit } from './audit.js';

export interface GuardOk {
  ok: true;
  user: AuthUser;
  db: Db;
}
export interface GuardErr {
  ok: false;
  error: string;
  message: string;
}
export type GuardResult = GuardOk | GuardErr;

/**
 * Require the current session user to hold `permission`.
 * - Not authenticated → NOT_AUTHENTICATED (no audit; there is no actor).
 * - Authenticated but missing permission → FORBIDDEN + audit PERMISSION_DENIED (R_AUDIT_003).
 */
export async function requirePermission(
  permission: string,
  context?: { action?: string; targetType?: string; targetId?: string }
): Promise<GuardResult> {
  // R48 (#3): xác thực phiên còn sống trong DB + làm mới cờ (không tin mỗi in-memory `current`).
  const v = await validateCurrentSession();
  if (!v) {
    return { ok: false, error: 'NOT_AUTHENTICATED', message: 'Phiên đã kết thúc hoặc bạn chưa đăng nhập. Hãy đăng nhập lại.' };
  }
  const user = v.user;
  const db = getDb();
  // R48 (#4): còn BUỘC ĐỔI MẬT KHẨU → chặn MỌI thao tác có quyền (chỉ được đổi mật khẩu) — chống bypass IPC trực tiếp.
  if (v.forceChangePassword) {
    return { ok: false, error: 'MUST_CHANGE_PASSWORD', message: 'Bạn phải đổi mật khẩu (lần đầu / được cấp lại) trước khi thực hiện thao tác.' };
  }
  if (!hasPermission(user, permission)) {
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'PERMISSION_DENIED',
      targetType: context?.targetType ?? 'System',
      targetId: context?.targetId ?? null,
      after: {
        deniedAction: context?.action ?? permission,
        requiredPermission: permission,
        actor: user.username
      }
    });
    return {
      ok: false,
      error: 'FORBIDDEN',
      message: 'Bạn không có quyền thực hiện thao tác này.'
    };
  }
  return { ok: true, user, db };
}

/** Server-side re-verification of the acting user's password (xóa/khóa/restore — §14).
 *  R48 (#4): SAI → tính vào bộ đếm khóa (chống brute-force mật khẩu qua các nút xác nhận thao tác). */
export async function verifyActorPassword(user: AuthUser, password: string): Promise<boolean> {
  const db = getDb();
  const row = await db.user.findUnique({ where: { id: user.id } });
  if (!row) return false;
  const okPw = verifyPassword(password, row.passwordHash);
  if (!okPw) await penalizeFailedAuth(user.id, 'sai mật khẩu khi xác nhận thao tác');
  return okPw;
}

/** Người đang đăng nhập ĐÃ đặt mật khẩu cấp 2 chưa? (để UI chọn form đặt / đổi). */
export async function actorHasLevel2(user: AuthUser): Promise<boolean> {
  const row = await getDb().user.findUnique({ where: { id: user.id }, select: { level2Hash: true } });
  return !!row?.level2Hash;
}

/** Xác thực mật khẩu CẤP 2 của người đang đăng nhập (dọn sạch thùng rác — Nhóm A #3).
 *  R48 (#4): SAI → tính vào bộ đếm khóa (mật khẩu cấp 2 gác xóa vĩnh viễn — chống brute-force). */
export async function verifyActorLevel2(user: AuthUser, level2: string): Promise<boolean> {
  const row = await getDb().user.findUnique({ where: { id: user.id }, select: { level2Hash: true } });
  const okL2 = verifyLevel2(level2, row?.level2Hash ?? null);
  if (!okL2) await penalizeFailedAuth(user.id, 'sai mật khẩu cấp 2 khi xác nhận');
  return okL2;
}
