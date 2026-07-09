// Backup / Restore service (main). IMS_SPEC §17, R_BACKUP_001..006.
// - createBackup: BACKUP_CREATE → zip(SQLite db + manifest) into backups/, checksum, backup_logs, audit.
// - restoreBackup: BACKUP_RESTORE → re-verify admin password (R_BACKUP_002), self-backup first (R_BACKUP_003),
//   verify checksum, stage restored db; audit RESTORE_EXECUTED.
// - FutureSyncService: interface designed now, no-op in G1 (R_BACKUP_006).
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { app } from 'electron';
import {
  sha256Hex,
  verifyChecksum,
  buildBackupManifest,
  backupFileName,
  type FutureSyncService
} from '@glb/business-rules';
import { resolveDatabaseUrl } from './db.js';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { zipStore, unzip } from './zip.js';

const MANIFEST_NAME = 'backup_manifest.json';

export interface BackupDto {
  id: number;
  filePath: string;
  fileName: string;
  fileSize: number | null;
  checksum: string | null;
  createdBy: number | null;
  createdAt: string;
  note: string | null;
  exists: boolean;
}

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  filePath?: string;
}

function dbFilePath(): string {
  return resolveDatabaseUrl().replace(/^file:/, '');
}

export function backupsDir(): string {
  // Dev: repo-root/backups. Prod: userData/backups.
  const base = app.isPackaged ? app.getPath('userData') : process.cwd();
  const dir = join(base, 'backups');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** R_BACKUP_001 — create a local backup archive. */
export async function createBackup(note?: string): Promise<MutationResult> {
  const g = await requirePermission('BACKUP_CREATE', { action: 'BACKUP_CREATED', targetType: 'System' });
  if (!g.ok) return g;
  const { db, user } = g;
  try {
    const out = await writeBackupArchive(db, user.username, note);
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'BACKUP_CREATED',
      targetType: 'System',
      targetId: basename(out.filePath),
      after: { file: basename(out.filePath), size: out.size, checksum: out.checksum }
    });
    return { ok: true, filePath: out.filePath };
  } catch (err) {
    return { ok: false, error: 'BACKUP_FAILED', message: `Tạo backup thất bại: ${(err as Error).message}` };
  }
}

/** Core archive writer (also reused by restore's pre-backup). Records backup_logs. */
async function writeBackupArchive(
  db: import('@glb/database').Db,
  actorUsername: string,
  note?: string
): Promise<{ filePath: string; size: number; checksum: string }> {
  const dbPath = dbFilePath();
  if (!existsSync(dbPath)) throw new Error(`DB file not found: ${dbPath}`);
  const dbBytes = readFileSync(dbPath);
  const checksum = sha256Hex(dbBytes);
  const manifest = buildBackupManifest({ createdBy: actorUsername, checksum, databaseFile: 'glb.db', note });
  const zip = zipStore([
    { name: 'glb.db', data: dbBytes },
    { name: MANIFEST_NAME, data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') }
  ]);
  const fileName = backupFileName();
  const filePath = join(backupsDir(), fileName);
  writeFileSync(filePath, zip);

  await db.backupLog.create({
    data: {
      filePath,
      fileSize: zip.length,
      checksum,
      createdBy: null, // FK is nullable; actor recorded in audit
      note: note ?? null
    }
  });
  return { filePath, size: zip.length, checksum };
}

/** List recorded backups (BACKUP_CREATE gate is enough to view them). */
export async function listBackups(): Promise<{ ok: boolean; data?: BackupDto[]; error?: string; message?: string }> {
  const g = await requirePermission('BACKUP_CREATE', { action: 'BACKUP_LIST' });
  if (!g.ok) return g;
  const rows = await g.db.backupLog.findMany({ orderBy: { id: 'desc' } });
  const data: BackupDto[] = rows.map((r) => ({
    id: r.id,
    filePath: r.filePath,
    fileName: basename(r.filePath),
    fileSize: r.fileSize,
    checksum: r.checksum,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    note: r.note,
    exists: existsSync(r.filePath)
  }));
  return { ok: true, data };
}

/** R_BACKUP_002/003 — restore from an archive: verify password, self-backup, verify checksum, stage. */
export async function restoreBackup(filePath: string, password: string): Promise<MutationResult> {
  const g = await requirePermission('BACKUP_RESTORE', { action: 'RESTORE_EXECUTED', targetType: 'System' });
  if (!g.ok) return g;
  const { db, user } = g;

  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'RESTORE_EXECUTED',
      targetType: 'System',
      after: { denied: true, reason: 'WRONG_PASSWORD', file: basename(filePath) }
    });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  if (!existsSync(filePath)) {
    return { ok: false, error: 'NOT_FOUND', message: 'File backup không tồn tại.' };
  }

  try {
    const entries = unzip(readFileSync(filePath));
    const dbEntry = entries.find((e) => e.name === 'glb.db');
    const manEntry = entries.find((e) => e.name === MANIFEST_NAME);
    if (!dbEntry) return { ok: false, error: 'INVALID_ARCHIVE', message: 'Archive không chứa cơ sở dữ liệu.' };
    if (manEntry) {
      const manifest = JSON.parse(manEntry.data.toString('utf8')) as { checksum?: string };
      if (manifest.checksum && !verifyChecksum(dbEntry.data, manifest.checksum)) {
        return { ok: false, error: 'CHECKSUM_MISMATCH', message: 'Checksum không khớp — archive có thể đã hỏng.' };
      }
    }

    // R_BACKUP_003: snapshot current state BEFORE overwriting.
    await writeBackupArchive(db, user.username, 'auto pre-restore snapshot');

    // Stage restored DB next to the live DB (.restored). Applied on next launch to avoid
    // corrupting an open SQLite handle. (Phase C: swap-on-restart wiring.)
    const staged = dbFilePath() + '.restored';
    writeFileSync(staged, dbEntry.data);
    // Also copy the manifest for traceability.
    if (manEntry) copyFileSync(filePath, dbFilePath() + '.restored.zip');

    await writeAudit(db, {
      actorUserId: user.id,
      action: 'RESTORE_EXECUTED',
      targetType: 'System',
      targetId: basename(filePath),
      after: { file: basename(filePath), staged, note: 'pre-restore snapshot created' }
    });
    return {
      ok: true,
      filePath: staged,
      message: 'Đã kiểm tra & tạo bản sao lưu hiện trạng. Bản khôi phục sẽ áp dụng khi khởi động lại ứng dụng.'
    };
  } catch (err) {
    return { ok: false, error: 'RESTORE_FAILED', message: `Khôi phục thất bại: ${(err as Error).message}` };
  }
}

/** R_BACKUP_006 — no-op sync service for G1; real impl arrives at G10 (VPS/PostgreSQL). */
export const futureSyncService: FutureSyncService = {
  isEnabled(): boolean {
    return false;
  },
  async push(): Promise<void> {
    throw new Error('NOT_IMPLEMENTED: remote sync arrives in G10');
  },
  async pull(): Promise<string> {
    throw new Error('NOT_IMPLEMENTED: remote sync arrives in G10');
  }
};
