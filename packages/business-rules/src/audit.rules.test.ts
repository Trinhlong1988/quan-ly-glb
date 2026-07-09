import { describe, it, expect } from 'vitest';
import { auditSnapshot, diffChanges } from './audit.rules.js';

describe('audit snapshot (R_AUDIT — never store plaintext password)', () => {
  it('redacts password fields', () => {
    const snap = auditSnapshot({ username: 'u', passwordHash: '$2a$10$xxx', password: 'secret' });
    expect(snap).toEqual({ username: 'u', passwordHash: '***', password: '***' });
  });
  it('returns null for null', () => {
    expect(auditSnapshot(null)).toBeNull();
  });
});

describe('diffChanges (R_AUDIT_002 before/after)', () => {
  it('captures only changed fields', () => {
    const before = { fullName: 'A', status: 'ACTIVE', phone: '1' };
    const after = { fullName: 'A', status: 'LOCKED', phone: '2' };
    const d = diffChanges(before, after);
    expect(Object.keys(d).sort()).toEqual(['phone', 'status']);
    expect(d.status).toEqual({ before: 'ACTIVE', after: 'LOCKED' });
  });
  it('empty when nothing changed', () => {
    expect(diffChanges({ a: 1 }, { a: 1 })).toEqual({});
  });
});
