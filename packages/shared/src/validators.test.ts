import { describe, it, expect } from 'vitest';
import { isValidUsername, validateUsername, validatePassword, isValidEmail } from './validators.js';

describe('username validation (IMS_SPEC §10/§20)', () => {
  const PASS = ['nguyenvana', 'ketoan001', 'manager01', 'support01'];
  const FAIL = ['nguyen van a', 'admin@01', 'kt-001', 'abc123', 'kếtoan001'];

  it.each(PASS)('accepts valid username: %s', (u) => {
    expect(isValidUsername(u)).toBe(true);
    expect(validateUsername(u).valid).toBe(true);
  });

  it.each(FAIL)('rejects invalid username: %s', (u) => {
    expect(isValidUsername(u)).toBe(false);
    expect(validateUsername(u).valid).toBe(false);
  });

  it('rejects empty and whitespace', () => {
    expect(isValidUsername('')).toBe(false);
    expect(isValidUsername('   ')).toBe(false);
  });

  it('rejects a 7-char alnum (below min length)', () => {
    expect(isValidUsername('abc1234')).toBe(false);
  });

  it('accepts exactly 8 alnum chars', () => {
    expect(isValidUsername('abcd1234')).toBe(true);
  });
});

describe('password policy', () => {
  it('accepts the admin default password', () => {
    expect(validatePassword('Admin@123456').valid).toBe(true);
  });
  it('rejects too-short passwords', () => {
    expect(validatePassword('a1').valid).toBe(false);
  });
  it('rejects letters-only and digits-only', () => {
    expect(validatePassword('abcdefgh').valid).toBe(false);
    expect(validatePassword('12345678').valid).toBe(false);
  });
});

describe('email validation', () => {
  it('accepts a normal email', () => {
    expect(isValidEmail('a@b.com')).toBe(true);
  });
  it('rejects malformed email', () => {
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
  });
});
