// User/Manager scope rules (IMS_SPEC §12). Pure predicate helpers, unit-tested.
// Full CRUD wiring lands in Phase B; these predicates are the enforceable core.
import { hasPermission, ADMIN_ROLE_CODE, MANAGER_ROLE_CODE } from '@glb/shared';
import type { AuthUser } from '@glb/shared';

/**
 * Can `actor` create a user with the given target role codes? (R_MANAGER_001..004, R006)
 * - Admin: yes if has USER_CREATE.
 * - Manager: only with USER_CREATE_LIMITED, and NEVER create ADMIN or MANAGER (R_MANAGER_002/003).
 * - Nobody may grant a role they do not themselves hold at equal-or-higher level (R_MANAGER_004 / R006).
 */
export function canCreateUserWithRoles(actor: AuthUser, targetRoleCodes: string[]): boolean {
  const isAdmin = actor.roles.includes(ADMIN_ROLE_CODE);
  if (isAdmin) {
    return hasPermission(actor, 'USER_CREATE');
  }
  const isManager = actor.roles.includes(MANAGER_ROLE_CODE);
  if (isManager) {
    if (!hasPermission(actor, 'USER_CREATE_LIMITED')) return false;
    // R_MANAGER_002/003: manager cannot create Admin or Manager accounts.
    if (targetRoleCodes.some((r) => r === ADMIN_ROLE_CODE || r === MANAGER_ROLE_CODE)) return false;
    return true;
  }
  // Any other role: needs an explicit full USER_CREATE grant (default none).
  return hasPermission(actor, 'USER_CREATE');
}

/** R004/R005: cannot delete or lock the last remaining Admin. */
export function canRemoveOrLockAdmin(targetIsAdmin: boolean, remainingActiveAdmins: number): boolean {
  if (!targetIsAdmin) return true;
  return remainingActiveAdmins > 1;
}

/** R006: no user may escalate their own permissions / edit their own roles upward. */
export function isSelfPrivilegeEscalation(actorId: number, targetId: number, changingRoles: boolean): boolean {
  return actorId === targetId && changingRoles;
}

/**
 * R_MANAGER_004: an actor must not grant a role that carries permissions the actor does not
 * themselves hold. Admin (who holds every permission) always passes.
 * Returns the list of permission codes that would be escalated (empty ⇒ allowed).
 */
export function escalatedPermissions(actor: AuthUser, grantedRolePermissionCodes: string[]): string[] {
  if (actor.roles.includes(ADMIN_ROLE_CODE)) return [];
  const held = new Set(actor.permissions);
  return [...new Set(grantedRolePermissionCodes)].filter((p) => !held.has(p));
}

/** Convenience predicate over {@link escalatedPermissions}. */
export function grantsExceedActor(actor: AuthUser, grantedRolePermissionCodes: string[]): boolean {
  return escalatedPermissions(actor, grantedRolePermissionCodes).length > 0;
}
