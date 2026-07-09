import { describe, it, expect } from 'vitest';
import {
  canDeleteRole,
  canLockRole,
  canUnlockRole,
  isProtectedAdminRole,
  isValidRoleCode
} from './role.rules.js';

describe('role delete rules (IMS_SPEC §8 R_ROLE_005/006)', () => {
  it('blocks deleting the protected ADMIN system role (R_ROLE_006)', () => {
    const d = canDeleteRole({ code: 'ADMIN', isSystem: true }, 0);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('ROLE_IS_SYSTEM_ADMIN');
  });

  it('blocks deleting a role that still has users (R_ROLE_005)', () => {
    const d = canDeleteRole({ code: 'MARKETING', isSystem: false }, 3);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('ROLE_HAS_USERS');
  });

  it('allows deleting an empty custom role', () => {
    expect(canDeleteRole({ code: 'MARKETING', isSystem: false }, 0).allowed).toBe(true);
  });

  it('a non-system role named ADMIN is not the protected role', () => {
    // Defensive: protection keys on is_system, not just the code string.
    expect(isProtectedAdminRole({ code: 'ADMIN', isSystem: false })).toBe(false);
  });
});

describe('role lock rules (R_ROLE_007)', () => {
  it('blocks locking the protected ADMIN role', () => {
    const d = canLockRole({ code: 'ADMIN', isSystem: true, status: 'ACTIVE' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('ROLE_IS_SYSTEM_ADMIN');
  });

  it('allows locking a normal active role', () => {
    expect(canLockRole({ code: 'SALES', isSystem: true, status: 'ACTIVE' }).allowed).toBe(true);
  });

  it('rejects locking an already-locked role', () => {
    expect(canLockRole({ code: 'SALES', isSystem: true, status: 'LOCKED' }).allowed).toBe(false);
  });

  it('unlock only applies to a locked role', () => {
    expect(canUnlockRole({ code: 'SALES', isSystem: true, status: 'LOCKED' }).allowed).toBe(true);
    expect(canUnlockRole({ code: 'SALES', isSystem: true, status: 'ACTIVE' }).allowed).toBe(false);
  });
});

describe('role code validation', () => {
  it('accepts UPPER_SNAKE codes', () => {
    expect(isValidRoleCode('MARKETING')).toBe(true);
    expect(isValidRoleCode('D_MANAGER')).toBe(true);
  });
  it('rejects lowercase, spaces, diacritics, leading digit', () => {
    expect(isValidRoleCode('marketing')).toBe(false);
    expect(isValidRoleCode('MY ROLE')).toBe(false);
    expect(isValidRoleCode('KẾ_TOÁN')).toBe(false);
    expect(isValidRoleCode('1ROLE')).toBe(false);
    expect(isValidRoleCode('A')).toBe(false);
  });
});
