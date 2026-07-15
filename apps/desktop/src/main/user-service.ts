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
import { validateCurrentSession } from './auth-service.js';
import { getDb } from './db.js';
import { writeAudit } from './audit.js';
import { nextCode } from './code-service.js';
import { staleGuard } from './optimistic-lock.js';

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
  updatedAt: string; // R48 #2 optimistic-lock — client echo lại khi Lưu để chống sửa đè
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
    updatedAt: u.updatedAt.toISOString(),
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

// Kiểu client dùng chung cho cả PrismaClient lẫn transaction client (AUTH-05 advisory-lock tx).
type TxClient = Omit<Db, '$connect' | '$disconnect' | '$on' | '$use' | '$transaction' | '$extends'>;

/** How many ACTIVE admins remain (for R004/R005). */
async function countActiveAdmins(db: TxClient, excludeUserId?: number): Promise<number> {
  return db.user.count({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      id: excludeUserId ? { not: excludeUserId } : undefined,
      roles: { some: { role: { code: ADMIN_ROLE_CODE } } }
    }
  });
}

async function targetIsAdmin(db: TxClient, userId: number): Promise<boolean> {
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
  // R48 (#3/#4) — BẮT BUỘC qua session guard DB (TTL/khóa/xóa/buộc-đổi-mật-khẩu) như mọi handler khác;
  // KHÔNG tin mỗi in-memory me(). Vì có 2 quyền vào nên tự validate session tại đây thay cho requirePermission(1 quyền).
  const v = await validateCurrentSession();
  if (!v) return { ok: false, error: 'NOT_AUTHENTICATED', message: 'Phiên đã kết thúc hoặc bạn chưa đăng nhập. Hãy đăng nhập lại.' };
  if (v.forceChangePassword) return { ok: false, error: 'MUST_CHANGE_PASSWORD', message: 'Bạn phải đổi mật khẩu (lần đầu / được cấp lại) trước khi thực hiện thao tác.' };
  const actor = v.user;
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
        // Production: user mới BUỘC đổi mật khẩu lần đầu (guard R48 chặn thao tác tới khi đổi). Selftest: bỏ cờ
        // để test được thao tác/permission-gating của user tạo trong test (block đã test riêng ở selftest-session #11).
        forceChangePassword: !process.env['GLB_SELFTEST'],
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
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock — mốc updatedAt client giữ lúc mở form
}

/** USER_UPDATE + R006 (no self privilege escalation) + audit before/after (R_AUDIT_002). */
export async function updateUser(id: number, input: UpdateUserInput): Promise<MutationResult> {
  const g = await requirePermission('USER_UPDATE', { action: 'USER_UPDATED', targetType: 'User', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Nhân sự không tồn tại.' };
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;

  // AUTH-02 (audit 15/7, Codex) — đổi TRẠNG THÁI qua form update phải chịu ĐÚNG guard như khóa/mở chuyên:
  // cần quyền USER_LOCK (→ không-hoạt-động) / USER_UNLOCK (→ ACTIVE) + chặn Admin cuối. Không có guard này
  // thì actor chỉ có USER_UPDATE có thể khóa/vô-hiệu Admin cuối, bỏ qua setUserLock.
  if (input.status !== undefined && input.status !== row.status) {
    const toInactive = input.status !== 'ACTIVE';
    const needPerm = toInactive ? 'USER_LOCK' : 'USER_UNLOCK';
    if (!hasPermission(user, needPerm)) {
      await auditDenied(db, user, 'USER_UPDATED', 'STATUS_PERM_DENIED', String(id));
      return { ok: false, error: 'FORBIDDEN', message: `Đổi trạng thái nhân sự cần quyền ${needPerm}.` };
    }
    if (toInactive) {
      const isAdmin = await targetIsAdmin(db, id);
      const remaining = await countActiveAdmins(db, id);
      if (!canRemoveOrLockAdmin(isAdmin, remaining + (isAdmin && row.status === 'ACTIVE' ? 1 : 0))) {
        return { ok: false, error: 'LAST_ADMIN', message: 'Không thể khóa/vô hiệu Admin cuối cùng.' };
      }
    }
  }

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

  // AUTH-05 (audit 15/7, Codex) — serialize kiểm-và-ghi invariant "Admin cuối" bằng advisory xact lock
  // CHUNG (748301, cùng entity-cancel-service) trong 1 transaction → chống TOCTOU: 2 client khóa 2 Admin
  // đồng thời cùng vượt kiểm tra last-admin rồi cùng ghi → 0 Admin.
  return await db.$transaction(async (txc) => {
    await txc.$executeRawUnsafe('SELECT pg_advisory_xact_lock(748301)');
    const row = await txc.user.findUnique({ where: { id } });
    if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Nhân sự không tồn tại.' };

    if (lock) {
      const isAdmin = await targetIsAdmin(txc, id);
      const remaining = await countActiveAdmins(txc, id); // admins remaining if we lock this one
      if (!canRemoveOrLockAdmin(isAdmin, remaining + (isAdmin && row.status === 'ACTIVE' ? 1 : 0))) {
        return { ok: false, error: 'LAST_ADMIN', message: 'Không thể khóa Admin cuối cùng.' };
      }
    }
    return await applyUserLock(txc, id, lock, row.status, user.id, action);
  });
}

/** Ghi trạng thái khóa/mở + audit trong CÙNG transaction (đã cầm advisory lock). */
async function applyUserLock(txc: TxClient, id: number, lock: boolean, prevStatus: string, actorId: number, action: 'USER_LOCKED' | 'USER_UNLOCKED'): Promise<MutationResult> {
  // P0-01: `lockedAt` LÀ MỎ NEO tự-mở-khóa của khóa-TẠM (auth failure). Khóa/mở TAY của Admin PHẢI
  // đặt lockedAt=null → login (auth-service #1) chỉ tự mở khi lockedAt!=null → khóa tay KHÔNG BAO GIỜ tự mở.
  // Nếu không clear, một lần auto-lock cũ để lại lockedAt=T1; admin mở rồi khóa lại → login thấy lockedAt cũ
  // >15′ → tự mở khóa tay của admin (bug lệch chính sách khóa). Mở tay cũng reset bộ đếm sai.
  await txc.user.update({
    where: { id },
    data: lock
      ? { status: 'LOCKED', lockedAt: null, lockReason: 'ADMIN_LOCK' } // khóa TAY → không có mỏ neo tự-mở
      : { status: 'ACTIVE', lockedAt: null, lockReason: null, failedAttempts: 0 }
  });
  await writeAudit(txc, {
    actorUserId: actorId,
    action,
    targetType: 'User',
    targetId: String(id),
    before: { status: prevStatus },
    after: { status: lock ? 'LOCKED' : 'ACTIVE', manual: true }
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

  // AUTH-05 (audit 15/7, Codex) — serialize invariant "Admin cuối" bằng advisory xact lock CHUNG (748301)
  // trong transaction → chống 2 client xóa 2 Admin đồng thời cùng vượt kiểm tra.
  return await db.$transaction(async (txc) => {
    await txc.$executeRawUnsafe('SELECT pg_advisory_xact_lock(748301)');
    const row = await txc.user.findUnique({ where: { id } });
    if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Nhân sự không tồn tại.' };

    const isAdmin = await targetIsAdmin(txc, id);
    const remaining = await countActiveAdmins(txc, id);
    if (!canRemoveOrLockAdmin(isAdmin, remaining + (isAdmin && row.status === 'ACTIVE' ? 1 : 0))) {
      return { ok: false, error: 'LAST_ADMIN', message: 'Không thể xóa Admin cuối cùng.' };
    }
    // R_MANAGER_005: manager cannot delete an Admin.
    if (isAdmin && !user.roles.includes(ADMIN_ROLE_CODE)) {
      await auditDenied(txc, user, 'USER_DELETED', 'MANAGER_SCOPE', String(id));
      return { ok: false, error: 'MANAGER_SCOPE', message: 'Bạn không được xóa tài khoản Admin.' };
    }

    await txc.user.update({ where: { id }, data: { status: 'DELETED', deletedAt: new Date() } });
    await writeAudit(txc, {
      actorUserId: user.id,
      action: 'USER_DELETED',
      targetType: 'User',
      targetId: String(id),
      before: auditSnapshot({ username: row.username, fullName: row.fullName })
    });
    return { ok: true, id };
  });
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

  // AUTH-05 (audit 15/7, Codex) — cả loạt xóa chạy trong 1 transaction cầm advisory lock CHUNG (748301):
  // đếm-Admin làm mới mỗi vòng dưới lock → không có 2 client song song cùng xóa Admin cuối. Skip-per-id giữ
  // nguyên (chỉ `continue`, không throw → không rollback cả loạt); mọi xóa thành công commit ở cuối tx.
  const skipped: { id: number; reason: string; message?: string }[] = [];
  const deleted = await db.$transaction(async (txc) => {
    await txc.$executeRawUnsafe('SELECT pg_advisory_xact_lock(748301)');
    let n = 0;
    for (const id of [...new Set(ids)]) {
      // KHÔNG tự xóa tài khoản của chính mình.
      if (id === user.id) {
        await auditDenied(txc, user, 'USER_DELETED', 'SELF_DELETE', String(id));
        skipped.push({ id, reason: 'SELF_DELETE', message: 'Không thể tự xóa tài khoản của chính mình.' });
        continue;
      }
      const row = await txc.user.findUnique({ where: { id } });
      if (!row || row.deletedAt) {
        skipped.push({ id, reason: 'NOT_FOUND', message: 'Nhân sự không tồn tại hoặc đã bị xóa.' });
        continue;
      }
      const isAdmin = await targetIsAdmin(txc, id);
      const remaining = await countActiveAdmins(txc, id);
      if (!canRemoveOrLockAdmin(isAdmin, remaining + (isAdmin && row.status === 'ACTIVE' ? 1 : 0))) {
        skipped.push({ id, reason: 'LAST_ADMIN', message: `Không thể xóa Admin cuối cùng (${row.username}).` });
        continue;
      }
      // R_MANAGER_005: manager không được xóa Admin.
      if (isAdmin && !user.roles.includes(ADMIN_ROLE_CODE)) {
        await auditDenied(txc, user, 'USER_DELETED', 'MANAGER_SCOPE', String(id));
        skipped.push({ id, reason: 'MANAGER_SCOPE', message: `Bạn không được xóa tài khoản Admin (${row.username}).` });
        continue;
      }
      await txc.user.update({ where: { id }, data: { status: 'DELETED', deletedAt: new Date() } });
      await writeAudit(txc, {
        actorUserId: user.id,
        action: 'USER_DELETED',
        targetType: 'User',
        targetId: String(id),
        before: auditSnapshot({ username: row.username, fullName: row.fullName })
      });
      n++;
    }
    return n;
  });
  return { ok: true, deleted, skipped };
}

// --- helpers -------------------------------------------------------------

async function auditDenied(db: TxClient, user: AuthUser, action: 'USER_CREATED' | 'USER_UPDATED' | 'USER_DELETED', reason: string, targetId?: string): Promise<void> {
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'PERMISSION_DENIED',
    targetType: 'User',
    targetId: targetId ?? null,
    after: { deniedAction: action, reason, actor: user.username }
  });
}
