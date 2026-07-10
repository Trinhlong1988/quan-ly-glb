import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  isBcryptHash,
  decideLogin,
  hashLevel2,
  verifyLevel2,
  reachesLockout,
  MAX_FAILED_ATTEMPTS,
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

describe('mật khẩu cấp 2 (Nhóm A #3 — băm 1 chiều cost cao)', () => {
  it('băm cấp 2 là bcrypt cost 12, không phải plaintext', () => {
    const h = hashLevel2('Xoa@Vinhvien#2026');
    expect(h).not.toBe('Xoa@Vinhvien#2026');
    expect(isBcryptHash(h)).toBe(true);
    expect(h.startsWith('$2')).toBe(true);
    expect(h.slice(4, 6)).toBe('12'); // cost 12
  });
  it('verify đúng/sai', () => {
    const h = hashLevel2('Xoa@Vinhvien#2026');
    expect(verifyLevel2('Xoa@Vinhvien#2026', h)).toBe(true);
    expect(verifyLevel2('sai', h)).toBe(false);
  });
  it('verify với hash null/rỗng → false (không crash)', () => {
    expect(verifyLevel2('bất kỳ', null)).toBe(false);
    expect(verifyLevel2('bất kỳ', '')).toBe(false);
    expect(verifyLevel2('bất kỳ', undefined)).toBe(false);
  });
});

describe('ngưỡng khóa (Nhóm A #2)', () => {
  it(`chưa khóa khi < ${MAX_FAILED_ATTEMPTS}, khóa khi >= ${MAX_FAILED_ATTEMPTS}`, () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) expect(reachesLockout(i)).toBe(false);
    expect(reachesLockout(MAX_FAILED_ATTEMPTS)).toBe(true);
    expect(reachesLockout(MAX_FAILED_ATTEMPTS + 3)).toBe(true);
  });
});
