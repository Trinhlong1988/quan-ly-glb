import { describe, it, expect } from 'vitest';
import { canCreateUserWithRoles, canRemoveOrLockAdmin, isSelfPrivilegeEscalation } from './user.rules.js';
import type { AuthUser } from '@glb/shared';
import { DEFAULT_ROLE_PERMISSIONS } from '@glb/shared';

function user(roles: string[]): AuthUser {
  const perms = [...new Set(roles.flatMap((r) => DEFAULT_ROLE_PERMISSIONS[r] ?? []))];
  return {
    id: roles.includes('ADMIN') ? 1 : 2,
    username: 'u',
    fullName: 'U',
    status: 'ACTIVE',
    forceChangePassword: false,
    roles,
    permissions: perms
  };
}

describe('manager / user creation scope (IMS_SPEC §12)', () => {
  it('Admin can create any user', () => {
    expect(canCreateUserWithRoles(user(['ADMIN']), ['SALES'])).toBe(true);
    expect(canCreateUserWithRoles(user(['ADMIN']), ['MANAGER'])).toBe(true);
  });

  it('Manager (limited) can create a normal-role user', () => {
    expect(canCreateUserWithRoles(user(['MANAGER']), ['SALES'])).toBe(true);
  });

  it('Manager cannot create Admin (R_MANAGER_002)', () => {
    expect(canCreateUserWithRoles(user(['MANAGER']), ['ADMIN'])).toBe(false);
  });

  it('Manager cannot create another Manager (R_MANAGER_003)', () => {
    expect(canCreateUserWithRoles(user(['MANAGER']), ['MANAGER'])).toBe(false);
  });

  it('Support / Sales / Customer cannot create users by default', () => {
    expect(canCreateUserWithRoles(user(['SUPPORT']), ['SALES'])).toBe(false);
    expect(canCreateUserWithRoles(user(['SALES']), ['SALES'])).toBe(false);
    expect(canCreateUserWithRoles(user(['CUSTOMER']), ['SALES'])).toBe(false);
  });
});

describe('last-admin protection (R004/R005)', () => {
  it('blocks removing/locking the last active Admin', () => {
    expect(canRemoveOrLockAdmin(true, 1)).toBe(false);
  });
  it('allows removing an Admin when others remain', () => {
    expect(canRemoveOrLockAdmin(true, 2)).toBe(true);
  });
  it('always allows for non-admin targets', () => {
    expect(canRemoveOrLockAdmin(false, 1)).toBe(true);
  });
});

describe('self privilege escalation (R006)', () => {
  it('flags a user editing their own roles', () => {
    expect(isSelfPrivilegeEscalation(5, 5, true)).toBe(true);
  });
  it('does not flag editing own non-role fields', () => {
    expect(isSelfPrivilegeEscalation(5, 5, false)).toBe(false);
  });
  it('does not flag editing another user roles', () => {
    expect(isSelfPrivilegeEscalation(5, 6, true)).toBe(false);
  });
});
