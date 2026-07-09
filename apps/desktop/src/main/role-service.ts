// Role CRUD service (main). IMS_SPEC §8, R_ROLE_001..010.
// Every mutation is permission-guarded (§13) and audited (R_ROLE_008); destructive ops re-verify password.
import {
  canDeleteRole,
  canLockRole,
  canUnlockRole,
  roleDenyMessage,
  isValidRoleCode,
  auditSnapshot
} from '@glb/business-rules';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';

export interface RoleDto {
  id: number;
  name: string;
  code: string;
  description: string | null;
  status: string;
  isSystem: boolean;
  userCount: number;
  permissions: string[]; // permission codes
}

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

export interface PermissionDto {
  code: string;
  name: string;
  group: string | null;
}

/** ROLE_READ — list roles with their permission codes + live user count. */
export async function listRoles(): Promise<{ ok: boolean; data?: RoleDto[]; error?: string; message?: string }> {
  const g = await requirePermission('ROLE_READ', { action: 'ROLE_READ' });
  if (!g.ok) return g;
  const rows = await g.db.role.findMany({
    where: { deletedAt: null },
    orderBy: { id: 'asc' },
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } }
  });
  const data: RoleDto[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    description: r.description,
    status: r.status,
    isSystem: r.isSystem,
    userCount: r._count.users,
    permissions: r.permissions.map((p) => p.permission.code)
  }));
  return { ok: true, data };
}

/** ROLE_READ — the full permission catalog (for the assign UI). */
export async function listPermissions(): Promise<{ ok: boolean; data?: PermissionDto[]; error?: string; message?: string }> {
  const g = await requirePermission('ROLE_READ', { action: 'ROLE_READ' });
  if (!g.ok) return g;
  const rows = await g.db.permission.findMany({ orderBy: { id: 'asc' } });
  return { ok: true, data: rows.map((p) => ({ code: p.code, name: p.name, group: p.group })) };
}

export interface RoleInput {
  name: string;
  code: string;
  description?: string;
  status?: string; // ACTIVE | LOCKED
  permissionCodes: string[];
}

/** R_ROLE_001 create role (+ ROLE_ASSIGN via permissionCodes). */
export async function createRole(input: RoleInput): Promise<MutationResult> {
  const g = await requirePermission('ROLE_CREATE', { action: 'ROLE_CREATED', targetType: 'Role' });
  if (!g.ok) return g;
  const { db, user } = g;

  if (!input.name?.trim()) return { ok: false, error: 'VALIDATION', message: 'Tên vai trò bắt buộc.' };
  if (!isValidRoleCode(input.code)) {
    return { ok: false, error: 'VALIDATION', message: 'Mã vai trò: CHỮ HOA/số/gạch dưới, không dấu, ≥2 ký tự.' };
  }
  const existing = await db.role.findUnique({ where: { code: input.code } });
  if (existing) return { ok: false, error: 'DUPLICATE', message: `Mã vai trò "${input.code}" đã tồn tại.` };

  const perms = await db.permission.findMany({ where: { code: { in: input.permissionCodes ?? [] } } });
  const role = await db.role.create({
    data: {
      name: input.name.trim(),
      code: input.code,
      description: input.description ?? null,
      status: input.status === 'LOCKED' ? 'LOCKED' : 'ACTIVE',
      isSystem: false,
      createdBy: user.id,
      permissions: { create: perms.map((p) => ({ permissionId: p.id })) }
    }
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'ROLE_CREATED',
    targetType: 'Role',
    targetId: String(role.id),
    after: { name: role.name, code: role.code, status: role.status, permissions: perms.map((p) => p.code) }
  });
  return { ok: true, id: role.id };
}

/** R_ROLE_002 update role (name/desc/status/permissions) — audited with before/after (R_AUDIT_002). */
export async function updateRole(id: number, input: RoleInput): Promise<MutationResult> {
  const g = await requirePermission('ROLE_UPDATE', { action: 'ROLE_UPDATED', targetType: 'Role', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const role = await db.role.findUnique({
    where: { id },
    include: { permissions: { include: { permission: true } } }
  });
  if (!role || role.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Vai trò không tồn tại.' };
  if (!input.name?.trim()) return { ok: false, error: 'VALIDATION', message: 'Tên vai trò bắt buộc.' };

  const before = {
    name: role.name,
    description: role.description,
    status: role.status,
    permissions: role.permissions.map((p) => p.permission.code)
  };

  const perms = await db.permission.findMany({ where: { code: { in: input.permissionCodes ?? [] } } });
  // The protected ADMIN role must never lose permissions or be locked via update.
  const isAdminSystem = role.code === 'ADMIN' && role.isSystem;
  const nextStatus = isAdminSystem ? 'ACTIVE' : input.status === 'LOCKED' ? 'LOCKED' : 'ACTIVE';

  await db.$transaction([
    db.role.update({
      where: { id },
      data: { name: input.name.trim(), description: input.description ?? null, status: nextStatus }
    }),
    ...(isAdminSystem
      ? [] // never rewrite ADMIN permissions
      : [
          db.rolePermission.deleteMany({ where: { roleId: id } }),
          db.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) })
        ])
  ]);

  const after = {
    name: input.name.trim(),
    description: input.description ?? null,
    status: nextStatus,
    permissions: isAdminSystem ? before.permissions : perms.map((p) => p.code)
  };
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'ROLE_UPDATED',
    targetType: 'Role',
    targetId: String(id),
    before: auditSnapshot(before),
    after: auditSnapshot(after)
  });
  return { ok: true, id };
}

async function setRoleStatus(id: number, lock: boolean): Promise<MutationResult> {
  const perm = lock ? 'ROLE_LOCK' : 'ROLE_UNLOCK';
  const action = lock ? 'ROLE_LOCKED' : 'ROLE_UNLOCKED';
  const g = await requirePermission(perm, { action, targetType: 'Role', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const role = await db.role.findUnique({ where: { id } });
  if (!role || role.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Vai trò không tồn tại.' };

  const decision = lock
    ? canLockRole({ code: role.code, isSystem: role.isSystem, status: role.status })
    : canUnlockRole({ code: role.code, isSystem: role.isSystem, status: role.status });
  if (!decision.allowed) {
    return { ok: false, error: decision.reason, message: roleDenyMessage(decision.reason!) };
  }

  await db.role.update({ where: { id }, data: { status: lock ? 'LOCKED' : 'ACTIVE' } });
  await writeAudit(db, {
    actorUserId: user.id,
    action,
    targetType: 'Role',
    targetId: String(id),
    before: { status: role.status },
    after: { status: lock ? 'LOCKED' : 'ACTIVE' }
  });
  return { ok: true, id };
}

export const lockRole = (id: number): Promise<MutationResult> => setRoleStatus(id, true);
export const unlockRole = (id: number): Promise<MutationResult> => setRoleStatus(id, false);

/** R_ROLE_004 + R_ROLE_005/006 + R_ROLE_009 (re-enter admin password). */
export async function deleteRole(id: number, password: string): Promise<MutationResult> {
  const g = await requirePermission('ROLE_DELETE', { action: 'ROLE_DELETED', targetType: 'Role', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'ROLE_DELETED',
      targetType: 'Role',
      targetId: String(id),
      after: { denied: true, reason: 'WRONG_PASSWORD' }
    });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }

  const role = await db.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!role || role.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Vai trò không tồn tại.' };

  const decision = canDeleteRole({ code: role.code, isSystem: role.isSystem }, role._count.users);
  if (!decision.allowed) {
    return { ok: false, error: decision.reason, message: roleDenyMessage(decision.reason!, role._count.users) };
  }

  // Soft delete (consistent with users; keeps referential history).
  await db.$transaction([
    db.rolePermission.deleteMany({ where: { roleId: id } }),
    db.role.update({ where: { id }, data: { deletedAt: new Date(), status: 'LOCKED' } })
  ]);
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'ROLE_DELETED',
    targetType: 'Role',
    targetId: String(id),
    before: { name: role.name, code: role.code }
  });
  return { ok: true, id };
}
