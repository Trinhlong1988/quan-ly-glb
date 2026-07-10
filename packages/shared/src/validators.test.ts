import { describe, it, expect } from 'vitest';
import {
  isValidUsername,
  validateUsername,
  validatePassword,
  isValidEmail,
  validateServerConfig,
  DEFAULT_SERVER_PORT,
  DEFAULT_SERVER_DATABASE,
  DEFAULT_SERVER_USER
} from './validators.js';

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

describe('server config validation (G10.3 — cấu hình máy chủ)', () => {
  it('accepts a full valid config and normalizes it', () => {
    const r = validateServerConfig({
      host: '192.168.1.6',
      port: 5432,
      database: 'glb',
      user: 'postgres',
      password: 'Glb@Pg2026'
    });
    expect(r.valid).toBe(true);
    expect(r.config).toEqual({
      host: '192.168.1.6',
      port: 5432,
      database: 'glb',
      user: 'postgres',
      password: 'Glb@Pg2026'
    });
  });

  it('trims host and applies defaults for empty port/database/user', () => {
    const r = validateServerConfig({ host: '  192.168.1.6  ', password: 'x1' });
    expect(r.valid).toBe(true);
    expect(r.config?.host).toBe('192.168.1.6');
    expect(r.config?.port).toBe(DEFAULT_SERVER_PORT);
    expect(r.config?.database).toBe(DEFAULT_SERVER_DATABASE);
    expect(r.config?.user).toBe(DEFAULT_SERVER_USER);
  });

  it('accepts port passed as a numeric string', () => {
    const r = validateServerConfig({ host: 'db.lan', port: '6543', password: 'x1' });
    expect(r.valid).toBe(true);
    expect(r.config?.port).toBe(6543);
  });

  it('rejects a missing host', () => {
    expect(validateServerConfig({ password: 'x1' }).valid).toBe(false);
    expect(validateServerConfig({ host: '   ', password: 'x1' }).valid).toBe(false);
  });

  it('rejects a host containing whitespace', () => {
    expect(validateServerConfig({ host: '192.168 .1.6', password: 'x1' }).valid).toBe(false);
  });

  it('rejects a missing password', () => {
    expect(validateServerConfig({ host: '192.168.1.6' }).valid).toBe(false);
    expect(validateServerConfig({ host: '192.168.1.6', password: '' }).valid).toBe(false);
  });

  it('rejects out-of-range or non-integer ports', () => {
    expect(validateServerConfig({ host: 'db', port: 0, password: 'x1' }).valid).toBe(false);
    expect(validateServerConfig({ host: 'db', port: 70000, password: 'x1' }).valid).toBe(false);
    expect(validateServerConfig({ host: 'db', port: 'abc', password: 'x1' }).valid).toBe(false);
    expect(validateServerConfig({ host: 'db', port: 5432.5, password: 'x1' }).valid).toBe(false);
  });
});
