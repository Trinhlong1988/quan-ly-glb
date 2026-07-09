import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  isBcryptHash,
  decideLogin,
  type AuthUserRecord
} from './auth.rules.js';
import type { UserStatus } from '@glb/shared';

function rec(status: UserStatus, hash: string, force = false): AuthUserRecord {
  return { id: 1, username: 'adminroot', passwordHash: hash, status, forceChangePassword: force };
}

describe('bcrypt hashing (R002)', () => {
  const hash = hashPassword('Admin@123456');

  it('produces a real bcrypt hash, not plaintext', () => {
    expect(hash).not.toBe('Admin@123456');
    expect(isBcryptHash(hash)).toBe(true);
  });

  it('verifies the correct password', () => {
    expect(verifyPassword('Admin@123456', hash)).toBe(true);
  });

  it('rejects a wrong password', () => {
    expect(verifyPassword('wrongpass', hash)).toBe(false);
  });

  it('rejects verify against an empty hash', () => {
    expect(verifyPassword('anything', '')).toBe(false);
  });
});

describe('login decision (IMS_SPEC §5/§11)', () => {
  const hash = hashPassword('Admin@123456');

  it('allows ACTIVE user with correct password (login đúng Admin)', () => {
    const d = decideLogin(rec('ACTIVE', hash), 'Admin@123456');
    expect(d.allowed).toBe(true);
    expect(d.reason).toBeUndefined();
  });

  it('flags mustChangePassword when force_change_password (R003)', () => {
    const d = decideLogin(rec('ACTIVE', hash, true), 'Admin@123456');
    expect(d.allowed).toBe(true);
    expect(d.mustChangePassword).toBe(true);
  });

  it('blocks wrong password (login sai password bị chặn)', () => {
    const d = decideLogin(rec('ACTIVE', hash), 'nope');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('INVALID_CREDENTIALS');
  });

  it('blocks a missing user without leaking status', () => {
    const d = decideLogin(null, 'whatever');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('INVALID_CREDENTIALS');
  });

  it('blocks LOCKED user even with correct password (R_USER_STATUS_003)', () => {
    const d = decideLogin(rec('LOCKED', hash), 'Admin@123456');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('STATUS_LOCKED');
  });

  it('blocks PENDING user (R_USER_STATUS_001)', () => {
    const d = decideLogin(rec('PENDING', hash), 'Admin@123456');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('STATUS_PENDING');
  });

  it('blocks DISABLED user (R_USER_STATUS_004)', () => {
    const d = decideLogin(rec('DISABLED', hash), 'Admin@123456');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('STATUS_DISABLED');
  });

  it('blocks DELETED user (R_USER_STATUS_005)', () => {
    const d = decideLogin(rec('DELETED', hash), 'Admin@123456');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('STATUS_DELETED');
  });

  it('does not reveal status when password is wrong on a locked account', () => {
    const d = decideLogin(rec('LOCKED', hash), 'wrongpass');
    expect(d.reason).toBe('INVALID_CREDENTIALS');
  });
});
