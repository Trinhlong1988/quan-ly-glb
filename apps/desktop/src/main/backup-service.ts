// Backup / Restore service (main). IMS_SPEC §17, R_BACKUP_001..006 — G10: PostgreSQL (pg_dump/pg_restore).
// - createBackup: BACKUP_CREATE → pg_dump (custom format) → zip(dump + manifest) vào backups/, checksum, backup_logs, audit.
// - restoreBackup: BACKUP_RESTORE → verify admin password (R_BACKUP_002), self-backup first (R_BACKUP_003),
//   verify checksum, pg_restore --clean --single-transaction; audit RESTORE_EXECUTED.
// - FutureSyncService: interface designed now, no-op in G1 (R_BACKUP_006).
// NGUYÊN TẮC (CRITICAL-B): KHÔNG chết-lặng. pg_dump/pg_restore thiếu hoặc lỗi → NÉM/ trả lỗi rõ ràng.
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
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
const DUMP_ENTRY = 'glb.dump';

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

interface PgConn {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

/** Phân rã postgresql:// → tham số kết nối (URL-decode user/password). */
function pgConn(): PgConn {
  const u = new URL(resolveDatabaseUrl());
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') {
    throw new Error(`Chuỗi kết nối không phải PostgreSQL: ${u.protocol}`);
  }
  return {
    host: u.hostname || 'localhost',
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '')
  };
}

/** Định vị binary pg_dump/pg_restore: env GLB_PG_BIN → cài đặt mặc định → PATH. */
function pgToolPath(tool: 'pg_dump' | 'pg_restore'): string {
  const exe = process.platform === 'win32' ? `${tool}.exe` : tool;
  const override = process.env['GLB_PG_BIN'];
  const candidates: string[] = [];
  if (override) candidates.push(join(override, exe));
  candidates.push(join('D:/PostgreSQL16/pgsql/bin', exe));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return exe; // fallback: dựa vào PATH (spawnSync sẽ báo lỗi rõ nếu không thấy)
}

export function backupsDir(): string {
  // Dev: repo-root/backups. Prod: userData/backups.
  const base = app.isPackaged ? app.getPath('userData') : process.cwd();
  const dir = join(base, 'backups');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** R_BACKUP_001 — create a local backup archive (pg_dump custom format zipped + manifest). */
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

/** Metadata của 1 dòng backup_logs vừa ghi — đủ để RE-INSERT lại sau pg_restore (B20). */
interface BackupLogSnapshot {
  filePath: string;
  fileSize: number | null;
  checksum: string | null;
  createdBy: number | null;
  note: string | null;
  createdAt: Date;
}

/** Core archive writer (also reused by restore's pre-backup). Records backup_logs. */
async function writeBackupArchive(
  db: import('@glb/database').Db,
  actorUsername: string,
  note?: string
): Promise<{ filePath: string; size: number; checksum: string; logRow: BackupLogSnapshot }> {
  const conn = pgConn();
  const bin = pgToolPath('pg_dump');
  const dumpTmp = join(backupsDir(), `.pgdump_${Date.now()}_${process.pid}.tmp`);
  const args = [
    '-h', conn.host, '-p', conn.port, '-U', conn.user, '-d', conn.database,
    '--format=custom', '--no-owner', '--no-privileges', '-f', dumpTmp
  ];
  const res = spawnSync(bin, args, {
    env: { ...process.env, PGPASSWORD: conn.password },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (res.error) throw new Error(`Không chạy được pg_dump (${bin}): ${res.error.message}`);
  if (res.status !== 0) throw new Error(`pg_dump lỗi (exit ${res.status}): ${(res.stderr || '').toString().trim()}`);
  if (!existsSync(dumpTmp)) throw new Error('pg_dump không tạo được file dump.');

  const dumpBytes = readFileSync(dumpTmp);
  // C3 (R48) — KIỂM TOÀN VẸN NGAY KHI TẠO: dump không được rỗng/cụt + `pg_restore --list` phải parse được TOC.
  // Chống "backup sai/hỏng vẫn ghi nhận thành công" (yêu cầu tối thượng của Mr.Long).
  if (dumpBytes.length < 512) {
    try { unlinkSync(dumpTmp); } catch { /* bỏ qua */ }
    throw new Error(`Bản dump quá nhỏ (${dumpBytes.length} bytes) — nghi cụt/rỗng, TỪ CHỐI ghi nhận.`);
  }
  const listRes = spawnSync(pgToolPath('pg_restore'), ['--list', dumpTmp], {
    env: { ...process.env, PGPASSWORD: conn.password }, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024
  });
  try { unlinkSync(dumpTmp); } catch { /* dọn tạm — bỏ qua nếu fail */ }
  if (listRes.error || listRes.status !== 0) {
    throw new Error(`Bản dump KHÔNG đọc được bằng pg_restore --list (nghi hỏng): ${(listRes.stderr || listRes.error?.message || '').toString().trim()}`);
  }

  const checksum = sha256Hex(dumpBytes);
  const manifest = buildBackupManifest({ createdBy: actorUsername, checksum, databaseFile: DUMP_ENTRY, note });
  const zip = zipStore([
    { name: DUMP_ENTRY, data: dumpBytes },
    { name: MANIFEST_NAME, data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') }
  ]);
  const fileName = backupFileName();
  const filePath = join(backupsDir(), fileName);
  writeFileSync(filePath, zip);

  const logRow = await db.backupLog.create({
    data: {
      filePath,
      fileSize: zip.length,
      checksum,
      createdBy: null, // FK is nullable; actor recorded in audit
      note: note ?? null
    }
  });
  return {
    filePath,
    size: zip.length,
    checksum,
    logRow: {
      filePath: logRow.filePath,
      fileSize: logRow.fileSize,
      checksum: logRow.checksum,
      createdBy: logRow.createdBy,
      note: logRow.note,
      createdAt: logRow.createdAt
    }
  };
}

/**
 * Backup do HỆ THỐNG khởi tạo (scheduler ngày / trước khi dọn dẹp) — KHÔNG cần phiên đăng nhập.
 * Dùng cho auto-backup định kỳ & "backup trước khi xóa" của Storage-Guard. Trả về đường dẫn + size.
 */
export async function systemBackup(db: import('@glb/database').Db, note: string): Promise<{ ok: boolean; filePath?: string; size?: number; error?: string }> {
  try {
    const out = await writeBackupArchive(db, 'system', note);
    await writeAudit(db, {
      actorUserId: null,
      action: 'AUTO_BACKUP',
      targetType: 'System',
      targetId: basename(out.filePath),
      after: { file: basename(out.filePath), size: out.size, checksum: out.checksum, note }
    });
    return { ok: true, filePath: out.filePath, size: out.size };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
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

/** R_BACKUP_002/003 — restore từ archive: verify password, self-backup, verify checksum, pg_restore. */
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

  let restoreTmp: string | null = null;
  try {
    const entries = unzip(readFileSync(filePath));
    const dumpEntry = entries.find((e) => e.name === DUMP_ENTRY);
    const manEntry = entries.find((e) => e.name === MANIFEST_NAME);
    if (!dumpEntry) return { ok: false, error: 'INVALID_ARCHIVE', message: 'Archive không chứa bản dump cơ sở dữ liệu.' };
    if (manEntry) {
      const manifest = JSON.parse(manEntry.data.toString('utf8')) as { checksum?: string };
      if (manifest.checksum && !verifyChecksum(dumpEntry.data, manifest.checksum)) {
        return { ok: false, error: 'CHECKSUM_MISMATCH', message: 'Checksum không khớp — archive có thể đã hỏng.' };
      }
    }

    // R_BACKUP_003: snapshot current state BEFORE overwriting.
    const preRestore = await writeBackupArchive(db, user.username, 'auto pre-restore snapshot');
    // C5 (R48) — chụp TOÀN BỘ backup_logs hiện tại (pre-restore snapshot + mọi bản trước) để re-insert
    // dòng bị mất sau pg_restore (bug B20 mở rộng: dump chỉ chứa các bản CŨ hơn nó → mọi bản MỚI hơn bị mất log).
    const priorLogs = await db.backupLog.findMany();

    // pg_restore --clean --if-exists --single-transaction: drop+recreate objects rồi nạp dữ liệu.
    // Khác SQLite (không swap-on-restart): Postgres áp dụng NGAY, không cần khởi động lại.
    const conn = pgConn();
    const bin = pgToolPath('pg_restore');
    restoreTmp = join(backupsDir(), `.pgrestore_${Date.now()}_${process.pid}.tmp`);
    writeFileSync(restoreTmp, dumpEntry.data);
    const args = [
      '-h', conn.host, '-p', conn.port, '-U', conn.user, '-d', conn.database,
      '--clean', '--if-exists', '--no-owner', '--single-transaction', restoreTmp
    ];
    const res = spawnSync(bin, args, {
      env: { ...process.env, PGPASSWORD: conn.password },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    });
    if (res.error) return { ok: false, error: 'RESTORE_FAILED', message: `Không chạy được pg_restore (${bin}): ${res.error.message}` };
    if (res.status !== 0) return { ok: false, error: 'RESTORE_FAILED', message: `pg_restore lỗi (exit ${res.status}): ${(res.stderr || '').toString().trim()}` };

    // B20/C5: sau pg_restore, bảng backup_logs = nội dung CŨ trong dump. Re-insert MỌI dòng đã có trước
    // restore mà nay không còn (theo filePath) — giữ nguyên metadata — để không mất bản ghi bản sao lưu nào
    // (file ZIP vẫn trên đĩa). Không chỉ pre-restore snapshot mà cả các bản mới hơn dump được chọn.
    void preRestore; // metadata pre-restore đã nằm trong priorLogs
    const afterFiles = new Set((await db.backupLog.findMany({ select: { filePath: true } })).map((r) => r.filePath));
    for (const r of priorLogs) {
      if (afterFiles.has(r.filePath)) continue;
      await db.backupLog.create({
        data: { filePath: r.filePath, fileSize: r.fileSize, checksum: r.checksum, createdBy: r.createdBy, note: r.note, createdAt: r.createdAt }
      });
    }

    await writeAudit(db, {
      actorUserId: user.id,
      action: 'RESTORE_EXECUTED',
      targetType: 'System',
      targetId: basename(filePath),
      after: { file: basename(filePath), note: 'pre-restore snapshot created; pg_restore applied; snapshot log re-inserted (B20)' }
    });
    return {
      ok: true,
      filePath,
      message: 'Đã kiểm tra checksum, tạo bản sao lưu hiện trạng và khôi phục dữ liệu vào PostgreSQL.'
    };
  } catch (err) {
    return { ok: false, error: 'RESTORE_FAILED', message: `Khôi phục thất bại: ${(err as Error).message}` };
  } finally {
    if (restoreTmp) { try { unlinkSync(restoreTmp); } catch { /* bỏ qua dọn tạm */ } }
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
