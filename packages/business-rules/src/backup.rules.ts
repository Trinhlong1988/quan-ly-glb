// Backup rules (IMS_SPEC §17, R_BACKUP_001..006). Pure logic — checksum + manifest shape.
// Actual file IO (zip, copy) lives in the main process backup-service; these helpers are testable.
import { createHash } from 'node:crypto';

export interface BackupManifest {
  /** Manifest schema version (bump if the shape changes). */
  version: number;
  /** When the backup was produced (ISO-8601). */
  createdAt: string;
  /** username of the actor who created it. */
  createdBy: string;
  /** Original DB filename inside the archive. */
  databaseFile: string;
  /** SHA-256 of the raw SQLite file (integrity check on restore). */
  checksum: string;
  /** App/schema version for forward-compat on restore. */
  appVersion: string;
  schemaVersion: number;
  note?: string;
}

/** SHA-256 hex digest of a buffer — the backup integrity checksum (R_BACKUP: checksum). */
export function sha256Hex(data: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface BuildManifestInput {
  createdBy: string;
  checksum: string;
  databaseFile?: string;
  appVersion?: string;
  schemaVersion?: number;
  note?: string;
  now?: Date;
}

export function buildBackupManifest(input: BuildManifestInput): BackupManifest {
  return {
    version: 1,
    createdAt: (input.now ?? new Date()).toISOString(),
    createdBy: input.createdBy,
    databaseFile: input.databaseFile ?? 'glb.db',
    checksum: input.checksum,
    appVersion: input.appVersion ?? '0.2.0-phaseB',
    schemaVersion: input.schemaVersion ?? 1,
    note: input.note
  };
}

/** Backup filename convention: 2026-07-09_093000_ims_backup.zip (IMS_SPEC §17). */
export function backupFileName(now: Date = new Date()): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  const stamp =
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${stamp}_ims_backup.zip`;
}

/** R_BACKUP: verify a restored/loaded DB against the checksum recorded in its manifest. */
export function verifyChecksum(data: Buffer | Uint8Array | string, expected: string): boolean {
  return sha256Hex(data) === expected;
}

/**
 * R_BACKUP_006: interface designed now, implemented at G10 (VPS/PostgreSQL sync).
 * Kept here so the type is shared; the main process ships a no-op implementation.
 */
export interface FutureSyncService {
  /** Whether remote sync is configured/enabled (always false in G1). */
  isEnabled(): boolean;
  /** Push a local backup archive to the remote (throws NOT_IMPLEMENTED in G1). */
  push(localBackupPath: string): Promise<void>;
  /** Pull the latest remote backup (throws NOT_IMPLEMENTED in G1). */
  pull(): Promise<string>;
}
