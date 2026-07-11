// R48 — Hardening backup: C5 re-insert đủ log sau restore (bug B20 mở rộng) + C2 watchdog quá hạn +
// C1 báo lỗi khi backup tự động thất bại. Self-test (GLB_SELFTEST=36). Cần pg_dump/pg_restore (DB throwaway).
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import { createBackup, restoreBackup } from './backup-service.js';
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

  await logout();
  // eslint-disable-next-line no-console
  console.log(`BACKUP36 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
