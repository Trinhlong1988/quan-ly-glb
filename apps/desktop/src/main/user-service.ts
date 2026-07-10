// User CRUD service (main). IMS_SPEC §9/§11/§12. Permission-guarded (§13), audited (R007/R_AUDIT_002),
// soft-delete (R_USER_STATUS_006), last-admin protection (R004/R005), no self-escalation (R006),
// manager scope (R_MANAGER_001..006). Destructive ops re-verify password (§14).
import {
  hashPassword,
  canCreateUserWithRoles,
  canRemoveOrLockAdmin,
  grantsExceedActor,
  isSelfPrivilegeEscalation,
  auditSnapshot
} from '@glb/business-rules';
import { hasPermission, validateUsername, validatePassword, isValidEmail, ADMIN_ROLE_CODE } from '@glb/shared';
import type { AuthUser } from '@glb/shared';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { me } from './auth-service.js';
import { getDb } from './db.js';
import { writeAudit } from './audit.js';
import { nextCode } from './code-service.js';

export interface UserDto {
  id: number;
  employeeCode: string | null;
  fullName: string;
  birthDate: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  username: string;
  status: string;
  forceChangePassword: boolean;
  joinedAt: string | null;
  createdAt: string;
  roles: string[]; // role codes
}

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

export interface UserFilter {
  roleCode?: string;
  status?: string;
  search?: string;
}

function toDto(u: {
  id: number;
  employeeCode: string | null;
  fullName: string;
  birthDate: Date | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  joinDate: Date | null;
  username: string;
  status: string;
  forceChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
  roles: { role: { code: string } }[];
}): UserDto {
  return {
    id: u.id,
    employeeCode: u.employeeCode,
    fullName: u.fullName,
    birthDate: u.birthDate ? u.birthDate.toISOString() : null,
    gender: u.gender,
    phone: u.phone,
    email: u.email,
    address: u.address,
    username: u.username,
    status: u.status,
    forceChangePassword: u.forceChangePassword,
    joinedAt: u.joinDate ? u.joinDate.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    roles: u.roles.map((r) => r.role.code)
  };
}

/** USER_READ — list users, excluding soft-deleted by default (R_USER_STATUS_005). */
export async function listUsers(
  filter: UserFilter = {}
): Promise<{ ok: boolean; data?: UserDto[]; error?: string; message?: string }> {
  const g = await requirePermission('USER_READ', { action: 'USER_READ' });
  if (!g.ok) return g;
  const includeDeleted = filter.status === 'DELETED';
  const rows = await g.db.user.findMany({
    where: {
      deletedAt: includeDeleted ? undefined : null,
      status: filter.status ? filter.status : undefined,
      roles: filter.roleCode ? { some: { role: { code: filter.roleCode } } } : undefined,
      OR: filter.search
        ? [
            { fullName: { contains: filter.search, mode: 'insensitive' } },
            { username: { contains: filter.search, mode: 'insensitive' } },
            { email: { contains: filter.search, mode: 'insensitive' } },
            { phone: { contains: filter.search, mode: 'insensitive' } }
          ]
        : undefined
    },
    orderBy: { id: 'asc' },
    include: { roles: { include: { role: true } } }
  });
  return { ok: true, data: rows.map(toDto) };
}

/** How many ACTIVE admins remain (for R004/R005). */
async function countActiveAdmins(db: Db, excludeUserId?: number): Promise<number> {
  return db.user.count({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      id: excludeUserId ? { not: excludeUserId } : undefined,
      roles: { some: { role: { code: ADMIN_ROLE_CODE } } }
    }
  });
}

async function targetIsAdmin(db: Db, userId: number): Promise<boolean> {
  const n = await db.userRole.count({ where: { userId, role: { code: ADMIN_ROLE_CODE } } });
  return n > 0;
}

/** Flatten the ACTIVE-role permission codes carried by a set of role codes. */
async function permsForRoleCodes(db: Db, roleCodes: string[]): Promise<string[]> {
  const roles = await db.role.findMany({
    where: { code: { in: roleCodes } },
    include: { permissions: { include: { permission: true } } }
  });
  const set = new Set<string>();
  for (const r of roles) for (const p of r.permissions) set.add(p.permission.code);
  return [...set];
}

export interface CreateUserInput {
  fullName: string;
  birthDate?: string | null;
  gender?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  joinDate?: string | null;
  username: string;
  password: string;
  status?: string; // ACTIVE | PENDING
  roleCodes: string[];
}

/** R_MANAGER_001..004 + username/email validation + audit USER_CREATED (R007). */
export async function createUser(input: CreateUserInput): Promise<MutationResult> {
  // USER_CREATE (full) OR USER_CREATE_LIMITED (manager) — either grants entry; scope enforced below.
  const actor = me();
  if (!actor) return { ok: false, error: 'NOT_AUTHENTICATED', message: 'Bạn chưa đăng nhập.' };
  const db = getDb();
  if (!hasPermission(actor, 'USER_CREATE') && !hasPermission(actor, 'USER_CREATE_LIMITED')) {
    await writeAudit(db, {
      actorUserId: actor.id,
      action: 'PERMISSION_DENIED',
      targetType: 'User',
      after: { deniedAction: 'USER_CREATED', requiredPermission: 'USER_CREATE|USER_CREATE_LIMITED', actor: actor.username }
    });
    return { ok: false, error: 'FORBIDDEN', message: 'Bạn không có quyền tạo nhân sự.' };
  }
  const user = actor;

  const roleCodes = [...new Set(input.roleCodes ?? [])];
  if (roleCodes.length === 0) return { ok: false, error: 'VALIDATION', message: 'Phải chọn ít nhất 1 vai trò.' };

  // R_MANAGER_002/003 + role-scope
  if (!canCreateUserWithRoles(user, roleCodes)) {
    await auditDenied(db, user, 'USER_CREATED', 'MANAGER_SCOPE');
    return { ok: false, error: 'MANAGER_SCOPE', message: 'Bạn không được phép tạo user với vai trò này.' };
  }
  // R_MANAGER_004: cannot grant permissions above the actor's own.
  const grantPerms = await permsForRoleCodes(db, roleCodes);
  if (grantsExceedActor(user, grantPerms)) {
    await auditDenied(db, user, 'USER_CREATED', 'GRANT_ESCALATION');
    return { ok: false, error: 'GRANT_ESCALATION', message: 'Không thể cấp quyền cao hơn quyền của bạn.' };
  }

  const uname = validateUsername(input.username);
  if (!uname.valid) return { ok: false, error: 'VALIDATION', message: uname.error };
  const pwd = validatePassword(input.password);
  if (!pwd.valid) return { ok: false, error: 'VALIDATION', message: pwd.error };
  if (input.email && !isValidEmail(input.email)) {
    return { ok: false, error: 'VALIDATION', message: 'Email không hợp lệ.' };
  }
  if (await db.user.findFirst({ where: { username: input.username } })) {
    return { ok: false, error: 'DUPLICATE', message: `Tên đăng nhập "${input.username}" đã tồn tại.` };
  }
  if (input.email && (await db.user.findFirst({ where: { email: input.email } }))) {
    return { ok: false, error: 'DUPLICATE', message: `Email "${input.email}" đã được sử dụng.` };
  }

  const roles = await db.role.findMany({ where: { code: { in: roleCodes } } });
  // Atomic: mint the mã NV (§D) and create the user together.
  const created = await db.$transaction(async (tx) => {
    const employeeCode = await nextCode('NV', tx);
    return tx.user.create({
      data: {
        employeeCode,
        fullName: input.fullName.trim(),
        birthDate: input.birthDate ? new Date(input.birthDate) : null,
        gender: input.gender ?? null,
        phone: input.phone ?? null,
        email: input.email || null,
        address: input.address ?? null,
        joinDate: input.joinDate ? new Date(input.joinDate) : null,
        username: input.username,
        passwordHash: hashPassword(input.password),
        status: input.status === 'PENDING' ? 'PENDING' : 'ACTIVE',
        forceChangePassword: true,
        createdBy: user.id,
        roles: { create: roles.map((r) => ({ roleId: r.id })) }
      }
    });
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'USER_CREATED',
    targetType: 'User',
    targetId: String(created.id),
    after: auditSnapshot({ employeeCode: created.employeeCode, username: created.username, fullName: created.fullName, status: created.status, roles: roleCodes })
  });
  return { ok: true, id: created.id };
}

export interface UpdateUserInput {
  fullName?: string;
  birthDate?: string | null;
  gender?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  joinDate?: string | null;
  status?: string;
  roleCodes?: string[];
}

/** USER_UPDATE + R006 (no self privilege escalation) + audit before/after (R_AUDIT_002). */
export async function updateUser(id: number, input: UpdateUserInput): Promise<MutationResult> {
  const g = await requirePermission('USER_UPDATE', { action: 'USER_UPDATED', targetType: 'User', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Nhân sự không tồn tại.' };

  const changingRoles = Array.isArray(input.roleCodes);
  const currentRoleCodes = row.roles.map((r) => r.role.code);
  const nextRoleCodes = changingRoles ? [...new Set(input.roleCodes!)] : currentRoleCodes;

  // R006: a user cannot change their OWN roles (privilege escalation vector).
  if (
    isSelfPrivilegeEscalation(user.id, id, changingRoles) &&
    JSON.stringify([...currentRoleCodes].sort()) !== JSON.stringify([...nextRoleCodes].sort())
  ) {
    await auditDenied(db, user, 'USER_UPDATED', 'SELF_ESCALATION', String(id));
    return { ok: false, error: 'SELF_ESCALATION', message: 'Bạn không thể tự thay đổi vai trò của chính mình.' };
  }

  // Manager scope on any role change.
  if (changingRoles) {
    if (!canCreateUserWithRoles(user, nextRoleCodes)) {
      await auditDenied(db, user, 'USER_UPDATED', 'MANAGER_SCOPE', String(id));
      return { ok: false, error: 'MANAGER_SCOPE', message: 'Bạn không được gán vai trò này.' };
    }
    const grantPerms = await permsForRoleCodes(db, nextRoleCodes);
    if (grantsExceedActor(user, grantPerms)) {
      await auditDenied(db, user, 'USER_UPDATED', 'GRANT_ESCALATION', String(id));
      return { ok: false, error: 'GRANT_ESCALATION', message: 'Không thể cấp quyền cao hơn quyền của bạn.' };
    }
  }

  if (input.email && !isValidEmail(input.email)) {
    return { ok: false, error: 'VALIDATION', message: 'Email không hợp lệ.' };
  }
  if (input.email && input.email !== row.email) {
    const dup = await db.user.findFirst({ where: { email: input.email, id: { not: id } } });
    if (dup) return { ok: false, error: 'DUPLICATE', message: `Email "${input.email}" đã được sử dụng.` };
  }

  const before = auditSnapshot({
    fullName: row.fullName,
    phone: row.phone,
    email: row.email,
    address: row.address,
    gender: row.gender,
    status: row.status,
    roles: currentRoleCodes
  });

  await db.user.update({
    where: { id },
    data: {
      fullName: input.fullName?.trim() ?? row.fullName,
      birthDate: input.birthDate !== undefined ? (input.birthDate ? new Date(input.birthDate) : null) : row.birthDate,
      gender: input.gender !== undefined ? input.gender : row.gender,
      phone: input.phone !== undefined ? input.phone : row.phone,
      email: input.email !== undefined ? input.email || null : row.email,
      address: input.address !== undefined ? input.address : row.address,
      joinDate: input.joinDate !== undefined ? (input.joinDate ? new Date(input.joinDate) : null) : row.joinDate,
      status: input.status ?? row.status
    }
  });
  if (changingRoles) {
    const roles = await db.role.findMany({ where: { code: { in: nextRoleCodes } } });
    await db.$transaction([
      db.userRole.deleteMany({ where: { userId: id } }),
      db.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) })
    ]);
  }

  const after = auditSnapshot({
    fullName: input.fullName?.trim() ?? row.fullName,
    phone: input.phone !== undefined ? input.phone : row.phone,
    email: input.email !== undefined ? input.email || null : row.email,
    address: input.address !== undefined ? input.address : row.address,
    gender: input.gender !== undefined ? input.gender : row.gender,
    status: input.status ?? row.status,
    roles: nextRoleCodes
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'USER_UPDATED',
    targetType: 'User',
    targetId: String(id),
    before,
    after
  });
  return { ok: true, id };
}

async function setUserLock(id: number, lock: boolean): Promise<MutationResult> {
  const perm = lock ? 'USER_LOCK' : 'USER_UNLOCK';
  const action = lock ? 'USER_LOCKED' : 'USER_UNLOCKED';
  const g = await requirePermission(perm, { action, targetType: 'User', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.user.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Nhân sự không tồn tại.' };

  if (lock) {
    const isAdmin = await targetIsAdmin(db, id);
    const remaining = await countActiveAdmins(db, id); // admins remaining if we lock this one
    if (!canRemoveOrLockAdmin(isAdmin, remaining + (isAdmin && row.status === 'ACTIVE' ? 1 : 0))) {
      return { ok: false, error: 'LAST_ADMIN', message: 'Không thể khóa Admin cuối cùng.' };
    }
  }
  await db.user.update({ where: { id }, data: { status: lock ? 'LOCKED' : 'ACTIVE' } });
  await writeAudit(db, {
    actorUserId: user.id,
    action,
    targetType: 'User',
    targetId: String(id),
    before: { status: row.status },
    after: { status: lock ? 'LOCKED' : 'ACTIVE' }
  });
  return { ok: true, id };
}

export const lockUser = (id: number): Promise<MutationResult> => setUserLock(id, true);
export const unlockUser = (id: number): Promise<MutationResult> => setUserLock(id, false);

/** USER_DELETE soft-delete (R_USER_STATUS_006) + last-admin (R004) + re-enter password (§14). */
export async function deleteUser(id: number, password: string): Promise<MutationResult> {
  const g = await requirePermission('USER_DELETE', { action: 'USER_DELETED', targetType: 'User', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  if (!(await verifyActorPassword(user, password))) {
    await auditDenied(db, user, 'USER_DELETED', 'WRONG_PASSWORD', String(id));
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }

  const row = await db.user.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Nhân sự không tồn tại.' };

  const isAdmin = await targetIsAdmin(db, id);
  const remaining = await countActiveAdmins(db, id);
  if (!canRemoveOrLockAdmin(isAdmin, remaining + (isAdmin && row.status === 'ACTIVE' ? 1 : 0))) {
    return { ok: false, error: 'LAST_ADMIN', message: 'Không thể xóa Admin cuối cùng.' };
  }
  // R_MANAGER_005: manager cannot delete an Admin.
  if (isAdmin && !user.roles.includes(ADMIN_ROLE_CODE)) {
    await auditDenied(db, user, 'USER_DELETED', 'MANAGER_SCOPE', String(id));
    return { ok: false, error: 'MANAGER_SCOPE', message: 'Bạn không được xóa tài khoản Admin.' };
  }

  await db.user.update({ where: { id }, data: { status: 'DELETED', deletedAt: new Date() } });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'USER_DELETED',
    targetType: 'User',
    targetId: String(id),
    before: auditSnapshot({ username: row.username, fullName: row.fullName })
  });
  return { ok: true, id };
}

export interface BulkDeleteUsersResult {
  ok: boolean;
  error?: string;
  message?: string;
  deleted?: number;
  skipped?: { id: number; reason: string; message?: string }[];
}

/**
 * XÓA HÀNG LOẠT nhân sự (LEAD 10/7, spec §5). Xác thực mật khẩu MỘT LẦN cho cả loạt (§14) rồi
 * lặp guard giống `deleteUser` cho TỪNG user: KHÔNG tự xóa mình, KHÔNG xóa Admin cuối còn hoạt động,
 * Manager không xóa được Admin. User vướng guard bị SKIP kèm lý do (không làm hỏng cả loạt) và ghi
 * audit nhánh từ chối (B14). Mỗi user xóa thành công ghi 1 audit USER_DELETED. Xóa mềm (R_USER_STATUS_006).
 * Đếm Admin làm mới mỗi vòng lặp → chọn nhiều Admin trong 1 loạt vẫn không thể xóa Admin cuối cùng.
 */
export async function deleteUsers(ids: number[], password: string): Promise<BulkDeleteUsersResult> {
  const g = await requirePermission('USER_DELETE', { action: 'USER_DELETED', targetType: 'User' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn nhân sự để xóa.' };

  if (!(await verifyActorPassword(user, password))) {
    await auditDenied(db, user, 'USER_DELETED', 'WRONG_PASSWORD');
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }

  let deleted = 0;
  const skipped: { id: number; reason: string; message?: string }[] = [];
  for (const id of [...new Set(ids)]) {
    // KHÔNG tự xóa tài khoản của chính mình.
    if (id === user.id) {
      await auditDenied(db, user, 'USER_DELETED', 'SELF_DELETE', String(id));
      skipped.push({ id, reason: 'SELF_DELETE', message: 'Không thể tự xóa tài khoản của chính mình.' });
      continue;
    }
    const row = await db.user.findUnique({ where: { id } });
    if (!row || row.deletedAt) {
      skipped.push({ id, reason: 'NOT_FOUND', message: 'Nhân sự không tồn tại hoặc đã bị xóa.' });
      continue;
    }
    const isAdmin = await targetIsAdmin(db, id);
    const remaining = await countActiveAdmins(db, id);
    if (!canRemoveOrLockAdmin(isAdmin, remaining + (isAdmin && row.status === 'ACTIVE' ? 1 : 0))) {
      skipped.push({ id, reason: 'LAST_ADMIN', message: `Không thể xóa Admin cuối cùng (${row.username}).` });
      continue;
    }
    // R_MANAGER_005: manager không được xóa Admin.
    if (isAdmin && !user.roles.includes(ADMIN_ROLE_CODE)) {
      await auditDenied(db, user, 'USER_DELETED', 'MANAGER_SCOPE', String(id));
      skipped.push({ id, reason: 'MANAGER_SCOPE', message: `Bạn không được xóa tài khoản Admin (${row.username}).` });
      continue;
    }
    await db.user.update({ where: { id }, data: { status: 'DELETED', deletedAt: new Date() } });
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'USER_DELETED',
      targetType: 'User',
      targetId: String(id),
      before: auditSnapshot({ username: row.username, fullName: row.fullName })
    });
    deleted++;
  }
  return { ok: true, deleted, skipped };
}

// --- helpers -------------------------------------------------------------

async function auditDenied(db: Db, user: AuthUser, action: 'USER_CREATED' | 'USER_UPDATED' | 'USER_DELETED', reason: string, targetId?: string): Promise<void> {
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'PERMISSION_DENIED',
    targetType: 'User',
    targetId: targetId ?? null,
    after: { deniedAction: action, reason, actor: user.username }
  });
}
