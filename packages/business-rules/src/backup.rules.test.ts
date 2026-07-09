import { describe, it, expect } from 'vitest';
import {
  sha256Hex,
  verifyChecksum,
  buildBackupManifest,
  backupFileName
} from './backup.rules.js';

describe('backup checksum (IMS_SPEC §17)', () => {
  it('sha256Hex is deterministic and 64 hex chars', () => {
    const a = sha256Hex('hello');
    const b = sha256Hex(Buffer.from('hello'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    // known vector for "hello"
    expect(a).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('verifyChecksum detects tampering', () => {
    const data = Buffer.from('sqlite-db-bytes');
    const sum = sha256Hex(data);
    expect(verifyChecksum(data, sum)).toBe(true);
    expect(verifyChecksum(Buffer.from('tampered'), sum)).toBe(false);
  });
});

describe('backup manifest', () => {
  it('builds a manifest carrying checksum + actor', () => {
    const now = new Date('2026-07-09T09:30:00Z');
    const m = buildBackupManifest({ createdBy: 'adminroot', checksum: 'abc', now });
    expect(m.version).toBe(1);
    expect(m.createdBy).toBe('adminroot');
    expect(m.checksum).toBe('abc');
    expect(m.databaseFile).toBe('glb.db');
    expect(m.createdAt).toBe('2026-07-09T09:30:00.000Z');
  });

  it('backupFileName matches the §17 convention', () => {
    const name = backupFileName(new Date('2026-07-09T09:30:05'));
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}_ims_backup\.zip$/);
    expect(name.endsWith('_ims_backup.zip')).toBe(true);
  });
});
