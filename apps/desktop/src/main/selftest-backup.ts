// R48 — Hardening backup: C5 re-insert đủ log sau restore (bug B20 mở rộng) + C2 watchdog quá hạn +
// C1 báo lỗi khi backup tự động thất bại. Self-test (GLB_SELFTEST=36). Cần pg_dump/pg_restore (DB throwaway).
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { readdirSync, writeFileSync } from 'node:fs';
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import { createBackup, restoreBackup, setBackupMirrorConfig } from './backup-service.js';
import { backupWatchdog, systemBackupIfDue } from './storage-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`BACKUP36 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';

export async function runBackupSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', PW);

  // ═══ C3 + tạo 3 backup hợp lệ ═══
  const b1 = await createBackup('B1');
  const b2 = await createBackup('B2');
  const b3 = await createBackup('B3');
  ok('tạo 3 backup ok (qua verify pg_restore --list)', b1.ok && b2.ok && b3.ok && !!b1.filePath, { b1: b1.error, b2: b2.error, b3: b3.error });
  ok('backup_logs có ≥3 dòng', (await db.backupLog.count()) >= 3, { n: await db.backupLog.count() });

  // ═══ C5: restore từ backup CŨ NHẤT → MỌI dòng backup_logs vẫn còn (không mất B2/B3) ═══
  const before = await db.backupLog.count();
  const rs = await restoreBackup(b1.filePath!, PW);
  ok('restore từ B1 ok', rs.ok === true, rs);
  const afterCount = await db.backupLog.count();
  ok('C5: sau restore backup_logs KHÔNG mất dòng nào (≥ trước restore)', afterCount >= before, { before, afterCount });
  const files = new Set((await db.backupLog.findMany({ select: { filePath: true } })).map((r) => r.filePath));
  ok('C5: cả B2 và B3 (mới hơn dump B1) vẫn còn bản ghi', files.has(b2.filePath!) && files.has(b3.filePath!), { b2: files.has(b2.filePath!), b3: files.has(b3.filePath!) });

  // Restore có thể đã revert session (login_sessions) — re-login cho các bước sau (dùng db trực tiếp là chính).
  await login('adminroot', PW);

  // ═══ C6 (R48 Pha 5): Sao lưu TẦNG 2 — bật mirror, nhân bản, rotation, lỗi mirror KHÔNG hỏng backup gốc ═══
  const mirrorDir = join(tmpdir(), `glb_mirror_${process.pid}_${Date.now()}`);
  const SUFFIX = '_ims_backup.zip';
  const setCfg = await setBackupMirrorConfig({ mirrorDir, keep: 2 }, PW);
  ok('C6: bật mirror (probe ghi được thư mục) ok', setCfg.ok === true, setCfg);
  const mBefore = await db.auditLog.count({ where: { action: 'BACKUP_MIRRORED' } });
  const bm1 = await createBackup('mirror-1');
  const mf1 = readdirSync(mirrorDir).filter((f) => f.endsWith(SUFFIX));
  ok('C6: backup được NHÂN BẢN sang mirror', bm1.ok === true && mf1.includes(basename(bm1.filePath!)), { mf1, file: bm1.filePath && basename(bm1.filePath) });
  ok('C6: ghi audit BACKUP_MIRRORED', (await db.auditLog.count({ where: { action: 'BACKUP_MIRRORED' } })) > mBefore);
  // rotation keep=2: tạo thêm 2 bản (pg_dump giãn cách >1s → tên file khác nhau) → mirror giữ ≤2, còn bản mới nhất
  await createBackup('mirror-2');
  const bm3 = await createBackup('mirror-3');
  const mf2 = readdirSync(mirrorDir).filter((f) => f.endsWith(SUFFIX));
  ok('C6: rotation giữ ≤ keep(2) bản trong mirror', mf2.length <= 2, mf2);
  ok('C6: bản mới nhất vẫn còn trong mirror sau rotation', mf2.includes(basename(bm3.filePath!)), { newest: basename(bm3.filePath!), have: mf2 });
  // lỗi mirror: trỏ mirrorDir vào đường dẫn KHÔNG tạo được (nằm dưới 1 FILE) — set TRỰC TIẾP (bỏ qua probe của setter)
  const blocker = join(tmpdir(), `glb_blk_${process.pid}_${Date.now()}`);
  writeFileSync(blocker, 'x');
  const badDir = join(blocker, 'sub');
  await db.appSetting.upsert({ where: { key: 'backup.mirrorDir' }, update: { value: badDir }, create: { key: 'backup.mirrorDir', value: badDir } });
  const fBefore = await db.auditLog.count({ where: { action: 'BACKUP_MIRROR_FAILED' } });
  const bmFail = await createBackup('mirror-fail');
  ok('C6: mirror LỖI nhưng BACKUP GỐC vẫn thành công (non-fatal)', bmFail.ok === true, bmFail);
  ok('C6: ghi audit BACKUP_MIRROR_FAILED (không lặng)', (await db.auditLog.count({ where: { action: 'BACKUP_MIRROR_FAILED' } })) > fBefore);
  // dọn: tắt mirror để không ảnh hưởng C1/C2
  await db.appSetting.deleteMany({ where: { key: { in: ['backup.mirrorDir', 'backup.mirrorKeep'] } } });

  // ═══ C2: watchdog — đặt lastBackupAt cũ (>2×chu kỳ) → stale + ghi audit BACKUP_STALE ═══
  await db.appSetting.upsert({ where: { key: 'backup.lastAt' }, update: { value: new Date(Date.now() - 1000 * 3600 * 1000).toISOString() }, create: { key: 'backup.lastAt', value: new Date(Date.now() - 1000 * 3600 * 1000).toISOString() } });
  await db.appSetting.deleteMany({ where: { key: 'backup.lastStaleAlertAt' } });
  const wd = await backupWatchdog(db);
  ok('C2: backup quá cũ → stale=true', wd.stale === true, wd);
  ok('C2: ghi audit BACKUP_STALE', (await db.auditLog.count({ where: { action: 'BACKUP_STALE' } })) >= 1);

  // ═══ C1: backup tự động THẤT BẠI (pg_dump trỏ DB không tồn tại) → audit AUTO_BACKUP_FAILED, KHÔNG lặng ═══
  // Chỉ đổi GLB_DB_URL (pgConn đọc lại tươi cho pg_dump); client getDb() vẫn nối DB test → audit ghi được.
  const savedUrl = process.env['GLB_DB_URL'];
  process.env['GLB_DB_URL'] = (savedUrl ?? '').replace(/\/[^/]+$/, '/glb_khong_ton_tai_xyz');
  await db.appSetting.deleteMany({ where: { key: 'backup.lastAt' } }); // ép "đến hạn"
  const due = await systemBackupIfDue(db);
  process.env['GLB_DB_URL'] = savedUrl;
  ok('C1: backup lỗi → ran=false', due.ran === false, due);
  ok('C1: ghi audit AUTO_BACKUP_FAILED (không lặng)', (await db.auditLog.count({ where: { action: 'AUTO_BACKUP_FAILED' } })) >= 1);

  // ═══ A1 (audit 0.2.57): SAO LƯU CHỈ Ở MÁY CHỦ — máy trạm (GLB_ROLE≠server) bị chặn server-only ═══
  const savedRole = process.env['GLB_ROLE'];
  delete process.env['GLB_ROLE'];
  const clientBk = await createBackup('client-should-block');
  ok('A1: máy trạm createBackup bị chặn (BACKUP_SERVER_ONLY)', clientBk.ok === false && clientBk.error === 'BACKUP_SERVER_ONLY', clientBk);
  await db.appSetting.deleteMany({ where: { key: 'backup.lastAt' } }); // ép "đến hạn"
  const clientDue = await systemBackupIfDue(db);
  ok('A1: máy trạm backup định kỳ KHÔNG chạy (ran=false)', clientDue.ran === false, clientDue);
  if (savedRole === undefined) delete process.env['GLB_ROLE']; else process.env['GLB_ROLE'] = savedRole;

  await logout();
  // eslint-disable-next-line no-console
  console.log(`BACKUP36 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
