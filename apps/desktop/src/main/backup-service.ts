// Backup / Restore service (main). IMS_SPEC §17, R_BACKUP_001..006 — G10: PostgreSQL (pg_dump/pg_restore).
// - createBackup: BACKUP_CREATE → pg_dump (custom format) → zip(dump + manifest) vào backups/, checksum, backup_logs, audit.
// - restoreBackup: BACKUP_RESTORE → verify admin password (R_BACKUP_002), self-backup first (R_BACKUP_003),
//   verify checksum, pg_restore --clean --single-transaction; audit RESTORE_EXECUTED.
// - FutureSyncService: interface designed now, no-op in G1 (R_BACKUP_006).
// NGUYÊN TẮC (CRITICAL-B): KHÔNG chết-lặng. pg_dump/pg_restore thiếu hoặc lỗi → NÉM/ trả lỗi rõ ràng.
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, copyFileSync, statSync, readdirSync } from 'node:fs';
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
import { resolveDatabaseUrl, isServerRole } from './db.js';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { notifyAdmins } from './message-service.js';
import { zipStore, unzip } from './zip.js';

const MANIFEST_NAME = 'backup_manifest.json';
const DUMP_ENTRY = 'glb.dump';

// ── R48 Pha 5 — Sao lưu TẦNG 2 (nhân bản ra nơi khác: ổ ngoài/NAS) ──
// Chống "hỏng ổ mất cả gốc lẫn backup": sau MỖI backup thành công, copy file .zip ra thư mục mirror.
// Cấu hình lưu AppSetting (Admin đặt trong Cấu hình hệ thống). Mirror TẮT khi mirrorDir rỗng.
const BACKUP_MIRROR_DIR_KEY = 'backup.mirrorDir';
const BACKUP_MIRROR_KEEP_KEY = 'backup.mirrorKeep';
const BACKUP_MIRROR_KEEP_DEFAULT = 30;
const BACKUP_FILE_SUFFIX = '_ims_backup.zip'; // theo backupFileName() §17

export interface BackupMirrorConfig {
  mirrorDir: string | null;
  keep: number;
  lastMirrorAt: string | null;
  lastMirrorOk: boolean | null;
  lastMirrorError: string | null;
}

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

/** Đọc đường dẫn mirror + số bản giữ (best-effort; lỗi DB → coi như tắt). */
async function readMirrorSettings(db: import('@glb/database').Db): Promise<{ dir: string | null; keep: number }> {
  try {
    const [d, k] = await Promise.all([
      db.appSetting.findUnique({ where: { key: BACKUP_MIRROR_DIR_KEY } }),
      db.appSetting.findUnique({ where: { key: BACKUP_MIRROR_KEEP_KEY } })
    ]);
    const dir = d?.value?.trim() ? d.value.trim() : null;
    const keepNum = Number(k?.value);
    const keep = Number.isInteger(keepNum) && keepNum > 0 ? keepNum : BACKUP_MIRROR_KEEP_DEFAULT;
    return { dir, keep };
  } catch {
    return { dir: null, keep: BACKUP_MIRROR_KEEP_DEFAULT };
  }
}

/** Giữ `keep` bản .zip mới nhất trong thư mục mirror (tên theo timestamp → sort chuỗi = theo thời gian). Best-effort. */
function rotateMirror(dir: string, keep: number): number {
  let removed = 0;
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(BACKUP_FILE_SUFFIX)).sort(); // cũ → mới
    const excess = files.length - keep;
    for (let i = 0; i < excess; i++) {
      try { unlinkSync(join(dir, files[i])); removed++; } catch { /* bỏ qua 1 file lỗi, tiếp tục */ }
    }
  } catch { /* thư mục không đọc được — bỏ qua, đã báo ở copy */ }
  return removed;
}

/**
 * R48 Pha 5 — nhân bản 1 archive sang thư mục mirror (nếu đã cấu hình). KHÔNG NÉM: mirror lỗi
 * KHÔNG được làm hỏng backup gốc. Ghi audit BACKUP_MIRRORED / BACKUP_MIRROR_FAILED + báo Admin khi lỗi.
 * Lưu trạng thái lần cuối vào AppSetting để watchdog/UI đọc.
 */
async function mirrorArchive(db: import('@glb/database').Db, filePath: string): Promise<{ mirrored: boolean; error?: string }> {
  const { dir, keep } = await readMirrorSettings(db);
  if (!dir) return { mirrored: false }; // mirror tắt — không phải lỗi
  const stamp = new Date().toISOString();
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const dest = join(dir, basename(filePath));
    copyFileSync(filePath, dest);
    // Verify: bản sao phải cùng kích thước với gốc (chống copy cụt do đầy ổ/rút USB giữa chừng).
    const srcSize = statSync(filePath).size;
    const dstSize = statSync(dest).size;
    if (srcSize !== dstSize) throw new Error(`Kích thước bản nhân lệch (${dstSize}≠${srcSize} bytes) — nghi copy cụt.`);
    const removed = rotateMirror(dir, keep);
    await setMirrorStatus(db, { at: stamp, ok: true, error: null });
    await writeAudit(db, {
      actorUserId: null, action: 'BACKUP_MIRRORED', targetType: 'System', targetId: basename(filePath),
      after: { mirrorDir: dir, size: dstSize, rotatedRemoved: removed }
    });
    return { mirrored: true };
  } catch (err) {
    const msg = (err as Error).message;
    // Best-effort ghi vết + báo Admin; KHÔNG ném để không làm hỏng backup gốc.
    try {
      await setMirrorStatus(db, { at: stamp, ok: false, error: msg });
      await writeAudit(db, {
        actorUserId: null, action: 'BACKUP_MIRROR_FAILED', targetType: 'System', targetId: basename(filePath),
        after: { mirrorDir: dir, error: msg }
      });
      await notifyAdmins(db, {
        category: 'BACKUP_MIRROR_FAILED',
        subject: 'Nhân bản sao lưu (tầng 2) THẤT BẠI',
        body: `Không nhân được bản sao lưu "${basename(filePath)}" ra "${dir}": ${msg}. Kiểm tra ổ/đường dẫn mirror — dữ liệu vẫn còn bản gốc trên máy.`
      });
    } catch { /* audit/notify best-effort */ }
    return { mirrored: false, error: msg };
  }
}

/** Ghi trạng thái mirror lần cuối vào AppSetting (best-effort). */
async function setMirrorStatus(db: import('@glb/database').Db, s: { at: string; ok: boolean; error: string | null }): Promise<void> {
  const put = async (key: string, value: string): Promise<void> => {
    await db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  };
  await put('backup.lastMirrorAt', s.at);
  await put('backup.lastMirrorOk', s.ok ? '1' : '0');
  await put('backup.lastMirrorError', s.error ?? '');
}

/** Đọc cấu hình + trạng thái mirror (cho UI). Gate BACKUP_CREATE (xem là đủ). */
export async function getBackupMirrorConfig(): Promise<{ ok: boolean; data?: BackupMirrorConfig; error?: string; message?: string }> {
  const g = await requirePermission('BACKUP_CREATE', { action: 'BACKUP_LIST' });
  if (!g.ok) return g;
  const { db } = g;
  const { dir, keep } = await readMirrorSettings(db);
  const [at, okv, errv] = await Promise.all([
    db.appSetting.findUnique({ where: { key: 'backup.lastMirrorAt' } }),
    db.appSetting.findUnique({ where: { key: 'backup.lastMirrorOk' } }),
    db.appSetting.findUnique({ where: { key: 'backup.lastMirrorError' } })
  ]);
  return {
    ok: true,
    data: {
      mirrorDir: dir, keep,
      lastMirrorAt: at?.value || null,
      lastMirrorOk: okv?.value == null || okv.value === '' ? null : okv.value === '1',
      lastMirrorError: errv?.value ? errv.value : null
    }
  };
}

/** Đặt thư mục mirror + số bản giữ. Đổi cấu hình sao lưu = việc PRIVILEGED → gate BACKUP_RESTORE + xác nhận mật khẩu. */
export async function setBackupMirrorConfig(input: { mirrorDir: string | null; keep?: number }, password: string): Promise<MutationResult> {
  const g = await requirePermission('BACKUP_RESTORE', { action: 'SETTING_UPDATED', targetType: 'System' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!(await verifyActorPassword(user, password))) return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  const dir = input.mirrorDir?.trim() || '';
  const keep = input.keep != null ? Number(input.keep) : BACKUP_MIRROR_KEEP_DEFAULT;
  if (dir && !Number.isInteger(keep)) return { ok: false, error: 'VALIDATION', message: 'Số bản giữ phải là số nguyên.' };
  if (dir && (keep < 1 || keep > 999)) return { ok: false, error: 'VALIDATION', message: 'Số bản giữ phải trong khoảng 1–999.' };
  // Nếu bật mirror: thử tạo/kiểm ghi được thư mục ngay để báo lỗi sớm (không đợi tới backup kế).
  if (dir) {
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const probe = join(dir, `.glb_mirror_probe_${Date.now()}`);
      writeFileSync(probe, 'ok'); unlinkSync(probe);
    } catch (err) {
      return { ok: false, error: 'MIRROR_UNWRITABLE', message: `Không ghi được vào thư mục mirror "${dir}": ${(err as Error).message}` };
    }
  }
  await db.appSetting.upsert({ where: { key: BACKUP_MIRROR_DIR_KEY }, update: { value: dir }, create: { key: BACKUP_MIRROR_DIR_KEY, value: dir } });
  await db.appSetting.upsert({ where: { key: BACKUP_MIRROR_KEEP_KEY }, update: { value: String(keep) }, create: { key: BACKUP_MIRROR_KEEP_KEY, value: String(keep) } });
  await writeAudit(db, { actorUserId: user.id, action: 'SETTING_UPDATED', targetType: 'System', after: { setting: 'backup.mirror', mirrorDir: dir || null, keep } });
  return { ok: true };
}

/** R_BACKUP_001 — create a local backup archive (pg_dump custom format zipped + manifest). */
export async function createBackup(note?: string): Promise<MutationResult> {
  // A1 (Mr.Long 16/7): SAO LƯU CHỈ Ở MÁY CHỦ. pg_dump/pg_restore chỉ có trên máy chủ (nơi cài PostgreSQL);
  // máy trạm không có nên sẽ fail. Fail-closed rõ ràng thay vì để pg_dump ném lỗi khó hiểu.
  if (!isServerRole()) return { ok: false, error: 'BACKUP_SERVER_ONLY', message: 'Sao lưu chỉ thực hiện trên MÁY CHỦ (nơi cài PostgreSQL). Máy trạm không chạy được pg_dump — hãy sao lưu từ máy chủ.' };
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
  // R48 Pha 5 — nhân bản TẦNG 2 ra nơi khác (best-effort, non-throwing): mọi backup (thủ công/tự động/
  // pre-restore/pre-autofix) đều đi qua đây → 1 choke-point duy nhất, không sót đường nào.
  await mirrorArchive(db, filePath);
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
  // A1: backup hệ thống (scheduler/pre-snapshot) cũng CHỈ ở máy chủ — máy trạm không có pg_dump.
  if (!isServerRole()) return { ok: false, error: 'BACKUP_SERVER_ONLY: sao lưu chỉ chạy trên máy chủ (role=server).' };
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
    // SEC-02 (audit 15/7, Codex) — manifest + checksum BẮT BUỘC: trước đây thiếu manifest / thiếu checksum
    // thì BỎ QUA kiểm tra → archive bị thay ruột (đổi glb.dump) vẫn restore được. Mọi backup app tạo đều kèm
    // manifest+checksum (createBackup) nên bắt buộc chỉ chặn file lạ/hỏng/bị sửa, không chặn backup hợp lệ.
    if (!manEntry) return { ok: false, error: 'INVALID_ARCHIVE', message: 'Archive thiếu manifest — từ chối phục hồi (không xác thực được tính toàn vẹn).' };
    let manifest: { checksum?: string };
    try {
      manifest = JSON.parse(manEntry.data.toString('utf8')) as { checksum?: string };
    } catch {
      return { ok: false, error: 'INVALID_ARCHIVE', message: 'Manifest hỏng — từ chối phục hồi.' };
    }
    if (!manifest.checksum) return { ok: false, error: 'INVALID_ARCHIVE', message: 'Manifest thiếu checksum — từ chối phục hồi.' };
    if (!verifyChecksum(dumpEntry.data, manifest.checksum)) {
      return { ok: false, error: 'CHECKSUM_MISMATCH', message: 'Checksum không khớp — archive có thể đã hỏng hoặc bị sửa.' };
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
