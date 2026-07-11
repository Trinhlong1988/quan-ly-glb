import { describe, it, expect } from 'vitest';
import {
  decidePosTransition,
  decideTidTransition,
  formatCode,
  isValidCode,
  isValidCodePrefix,
  POS_TRANSITIONS,
  TID_TRANSITIONS
} from './asset.rules.js';

describe('POS device state machine (§A3)', () => {
  it('allows the happy-path lifecycle deploy → recall', () => {
    expect(decidePosTransition('IN_STOCK', 'deploy')).toMatchObject({ allowed: true, to: 'DEPLOYED', eventType: 'DEPLOY' });
    expect(decidePosTransition('DEPLOYED', 'recall')).toMatchObject({ allowed: true, to: 'IN_STOCK' });
  });

  it('runs the repair chain deploy → damage → repair → repaired', () => {
    expect(decidePosTransition('DEPLOYED', 'reportDamage')).toMatchObject({ allowed: true, to: 'DAMAGED', eventType: 'REPORT_DAMAGE' });
    expect(decidePosTransition('DAMAGED', 'sendRepair')).toMatchObject({ allowed: true, to: 'IN_REPAIR', eventType: 'SEND_REPAIR' });
    expect(decidePosTransition('IN_REPAIR', 'receiveRepaired')).toMatchObject({ allowed: true, to: 'IN_STOCK', eventType: 'RECEIVE_REPAIRED' });
  });

  it('rejects illegal state jumps (no skipping the state machine)', () => {
    expect(decidePosTransition('IN_STOCK', 'recall')).toMatchObject({ allowed: false, reason: 'INVALID_STATE' });
    expect(decidePosTransition('RETIRED', 'deploy')).toMatchObject({ allowed: false, reason: 'INVALID_STATE' });
    expect(decidePosTransition('IN_STOCK', 'receiveRepaired')).toMatchObject({ allowed: false });
    expect(decidePosTransition('DEPLOYED', 'sendRepair')).toMatchObject({ allowed: false });
  });

  it('retire is allowed from any live state but never from RETIRED', () => {
    for (const s of ['IN_STOCK', 'DEPLOYED', 'IN_REPAIR', 'DAMAGED'] as const) {
      expect(decidePosTransition(s, 'retire')).toMatchObject({ allowed: true, to: 'RETIRED' });
    }
    expect(decidePosTransition('RETIRED', 'retire')).toMatchObject({ allowed: false });
  });

  it('every POS event maps to a valid resulting status', () => {
    for (const rule of Object.values(POS_TRANSITIONS)) {
      expect(rule.from.length).toBeGreaterThan(0);
      expect(rule.eventType).toBeTruthy();
    }
  });
});

describe('TID state machine (§A3)', () => {
  it('assign moves UNASSIGNED → ACTIVE', () => {
    expect(decideTidTransition('UNASSIGNED', 'assign')).toMatchObject({ allowed: true, to: 'ACTIVE', eventType: 'TID_ASSIGN' });
  });

  it('assign also allowed from ACTIVE (K1: TID thu hồi khỏi máy lắp máy khác); posSerial guard ở service', () => {
    expect(decideTidTransition('ACTIVE', 'assign')).toMatchObject({ allowed: true, to: 'ACTIVE', eventType: 'TID_ASSIGN' });
  });

  it('replace: old ACTIVE → DEAD, new UNASSIGNED → ACTIVE', () => {
    expect(decideTidTransition('ACTIVE', 'markDead')).toMatchObject({ allowed: true, to: 'DEAD', eventType: 'TID_DEAD' });
    expect(decideTidTransition('UNASSIGNED', 'activateReplacement')).toMatchObject({ allowed: true, to: 'ACTIVE', eventType: 'TID_REPLACE' });
  });

  it('recall works from ACTIVE/DEAD/CLOSED, close only from ACTIVE', () => {
    expect(decideTidTransition('ACTIVE', 'recall')).toMatchObject({ allowed: true, to: 'RECALLED' });
    expect(decideTidTransition('DEAD', 'recall')).toMatchObject({ allowed: true, to: 'RECALLED' });
    expect(decideTidTransition('ACTIVE', 'close')).toMatchObject({ allowed: true, to: 'CLOSED' });
    expect(decideTidTransition('UNASSIGNED', 'close')).toMatchObject({ allowed: false });
  });

  it('rejects assigning a dead/closed/recalled TID', () => {
    expect(decideTidTransition('DEAD', 'assign')).toMatchObject({ allowed: false, reason: 'INVALID_STATE' });
    expect(decideTidTransition('CLOSED', 'assign')).toMatchObject({ allowed: false, reason: 'INVALID_STATE' });
    expect(decideTidTransition('RECALLED', 'assign')).toMatchObject({ allowed: false, reason: 'INVALID_STATE' });
  });

  it('every TID event maps to a valid resulting status', () => {
    for (const rule of Object.values(TID_TRANSITIONS)) {
      expect(rule.from.length).toBeGreaterThan(0);
      expect(rule.eventType).toBeTruthy();
    }
  });
});

describe('identifier code format (§D)', () => {
  it('formats with min 2-digit zero-pad and overflows past 99', () => {
    expect(formatCode('NV', 1)).toBe('NV01');
    expect(formatCode('KH', 3)).toBe('KH03');
    expect(formatCode('NV', 99)).toBe('NV99');
    expect(formatCode('NV', 100)).toBe('NV100');
  });

  it('rejects bad prefixes/values', () => {
    expect(() => formatCode('nv', 1)).toThrow();
    expect(() => formatCode('NV', 0)).toThrow();
    expect(() => formatCode('N1', 1)).toThrow();
    expect(isValidCodePrefix('KH')).toBe(true);
    expect(isValidCodePrefix('kh')).toBe(false);
  });

  it('validates codes against their prefix', () => {
    expect(isValidCode('NV', 'NV01')).toBe(true);
    expect(isValidCode('KH', 'KH100')).toBe(true);
    expect(isValidCode('NV', 'KH01')).toBe(false);
    expect(isValidCode('NV', 'NV1')).toBe(false); // needs ≥2 digits
  });
});
