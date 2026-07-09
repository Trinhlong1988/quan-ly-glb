// Role CRUD rules (IMS_SPEC §8, R_ROLE_001..010). Pure logic — no DB, no Electron.
// The DB service fetches the role row + user count and delegates decisions here.
import { ADMIN_ROLE_CODE } from '@glb/shared';

/** Minimal role shape the role rules need. */
export interface RoleRuleRecord {
  code: string;
  isSystem: boolean;
  status: string; // ACTIVE | LOCKED
}

export type RoleDenyReason =
  | 'ROLE_IS_SYSTEM_ADMIN' // R_ROLE_006/007 — the original ADMIN role is untouchable
  | 'ROLE_HAS_USERS' // R_ROLE_005 — role still assigned to ≥1 user
  | 'ROLE_ALREADY_LOCKED'
  | 'ROLE_ALREADY_ACTIVE';

export interface RoleDecision {
  allowed: boolean;
  reason?: RoleDenyReason;
}

/** True for the original, protected ADMIN system role (R_ROLE_006/007). */
export function isProtectedAdminRole(role: Pick<RoleRuleRecord, 'code' | 'isSystem'>): boolean {
  return role.code === ADMIN_ROLE_CODE && role.isSystem;
}

/**
 * R_ROLE_005 + R_ROLE_006: a role may be deleted only when it is not the protected ADMIN role
 * AND no user currently uses it.
 */
export function canDeleteRole(
  role: Pick<RoleRuleRecord, 'code' | 'isSystem'>,
  userCount: number
): RoleDecision {
  if (isProtectedAdminRole(role)) return { allowed: false, reason: 'ROLE_IS_SYSTEM_ADMIN' };
  if (userCount > 0) return { allowed: false, reason: 'ROLE_HAS_USERS' };
  return { allowed: true };
}

/** R_ROLE_007: the protected ADMIN role can never be locked. */
export function canLockRole(role: RoleRuleRecord): RoleDecision {
  if (isProtectedAdminRole(role)) return { allowed: false, reason: 'ROLE_IS_SYSTEM_ADMIN' };
  if (role.status === 'LOCKED') return { allowed: false, reason: 'ROLE_ALREADY_LOCKED' };
  return { allowed: true };
}

/** Unlock is always allowed for a currently-locked role (the ADMIN role is never locked anyway). */
export function canUnlockRole(role: RoleRuleRecord): RoleDecision {
  if (role.status !== 'LOCKED') return { allowed: false, reason: 'ROLE_ALREADY_ACTIVE' };
  return { allowed: true };
}

/** Vietnamese message for a role deny reason (toast / audit note). */
export function roleDenyMessage(reason: RoleDenyReason, userCount = 0): string {
  switch (reason) {
    case 'ROLE_IS_SYSTEM_ADMIN':
      return 'Không thể thao tác trên vai trò ADMIN gốc của hệ thống.';
    case 'ROLE_HAS_USERS':
      return `Không thể xóa vai trò đang có ${userCount} nhân sự sử dụng.`;
    case 'ROLE_ALREADY_LOCKED':
      return 'Vai trò đã ở trạng thái khóa.';
    case 'ROLE_ALREADY_ACTIVE':
      return 'Vai trò đang hoạt động.';
    default:
      return 'Thao tác vai trò không hợp lệ.';
  }
}

/** Role code rule (IMS_SPEC §8): no diacritics, no whitespace, UPPER_SNAKE-ish. */
export const ROLE_CODE_REGEX = /^[A-Z][A-Z0-9_]{1,31}$/;

export function isValidRoleCode(code: string): boolean {
  return typeof code === 'string' && ROLE_CODE_REGEX.test(code);
}
