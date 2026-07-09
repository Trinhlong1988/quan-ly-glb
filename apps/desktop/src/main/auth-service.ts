// Auth service (main process). Wraps @glb/business-rules decisions with DB access + audit.
import { randomUUID } from 'node:crypto';
import type { Db } from '@glb/database';
import {
  decideLogin,
  loginDenyMessage,
  hashPassword,
  verifyPassword,
  type AuthUserRecord
} from '@glb/business-rules';
import { validatePassword, type AuthUser, type UserStatus } from '@glb/shared';
import { getDb } from './db.js';
import { writeAudit } from './audit.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

interface SessionState {
  sessionId: string;
  user: AuthUser;
}
let current: SessionState | null = null;

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
}

export async function login(username: string, password: string): Promise<LoginOutcome> {
  const db = getDb();
  const row = await db.user.findFirst({ where: { username, deletedAt: null } });

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
    return {
      ok: false,
      error: decision.reason,
      message: decision.reason ? loginDenyMessage(decision.reason) : 'Đăng nhập không hợp lệ.'
    };
  }

  const authUser = await buildAuthUser(db, record!.id);
  const sessionId = randomUUID();
  await db.loginSession.create({
    data: {
      id: sessionId,
      userId: record!.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS)
    }
  });
  current = { sessionId, user: authUser };

  await writeAudit(db, {
    actorUserId: record!.id,
    action: 'LOGIN_SUCCESS',
    targetType: 'User',
    targetId: String(record!.id),
    after: { username: authUser.username }
  });

  return { ok: true, user: authUser, mustChangePassword: decision.mustChangePassword };
}

export function me(): AuthUser | null {
  return current?.user ?? null;
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
  newPassword: string
): Promise<ChangePasswordOutcome> {
  if (!current) {
    return { ok: false, error: 'NOT_AUTHENTICATED', message: 'Chưa đăng nhập.' };
  }
  const db = getDb();
  const row = await db.user.findUniqueOrThrow({ where: { id: current.user.id } });

  if (!verifyPassword(currentPassword, row.passwordHash)) {
    return { ok: false, error: 'WRONG_CURRENT_PASSWORD', message: 'Mật khẩu hiện tại không đúng.' };
  }
  const v = validatePassword(newPassword);
  if (!v.valid) {
    return { ok: false, error: 'WEAK_PASSWORD', message: v.error };
  }
  if (verifyPassword(newPassword, row.passwordHash)) {
    return {
      ok: false,
      error: 'SAME_PASSWORD',
      message: 'Mật khẩu mới phải khác mật khẩu hiện tại.'
    };
  }

  await db.user.update({
    where: { id: row.id },
    data: { passwordHash: hashPassword(newPassword), forceChangePassword: false }
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
