// Permission guard (main). Enforces §13 permission checks and R_AUDIT_003:
// a mutation refused for lack of permission is STILL written to the audit log.
import { hasPermission, type AuthUser } from '@glb/shared';
import { verifyPassword, verifyLevel2 } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { getDb } from './db.js';
import { me } from './auth-service.js';
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
  const user = me();
  if (!user) {
    return { ok: false, error: 'NOT_AUTHENTICATED', message: 'Bạn chưa đăng nhập.' };
  }
  const db = getDb();
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

/** Server-side re-verification of the acting user's password (xóa/khóa/restore — §14). */
export async function verifyActorPassword(user: AuthUser, password: string): Promise<boolean> {
  const db = getDb();
  const row = await db.user.findUnique({ where: { id: user.id } });
  if (!row) return false;
  return verifyPassword(password, row.passwordHash);
}

/** Người đang đăng nhập ĐÃ đặt mật khẩu cấp 2 chưa? (để UI chọn form đặt / đổi). */
export async function actorHasLevel2(user: AuthUser): Promise<boolean> {
  const row = await getDb().user.findUnique({ where: { id: user.id }, select: { level2Hash: true } });
  return !!row?.level2Hash;
}

/** Xác thực mật khẩu CẤP 2 của người đang đăng nhập (dọn sạch thùng rác — Nhóm A #3). */
export async function verifyActorLevel2(user: AuthUser, level2: string): Promise<boolean> {
  const row = await getDb().user.findUnique({ where: { id: user.id }, select: { level2Hash: true } });
  return verifyLevel2(level2, row?.level2Hash ?? null);
}
