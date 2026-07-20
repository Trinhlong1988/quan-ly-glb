// Nhóm E — Storage-Guard — self-test (GLB_SELFTEST=16).
// Chứng minh bằng SỐ THẬT:
//   • getStorageStatus trả cấu trúc (dbBytes>0, cleanable counts).
//   • updateStorageConfig lưu ngưỡng/hạn lưu.
//   • cleanable đếm ĐÚNG audit cũ + thùng rác cũ (theo hạn lưu).
//   • runCleanup: sai mật khẩu → WRONG_PASSWORD; đúng → BACKUP trước rồi xóa CHỈ dữ liệu cũ (giữ dữ liệu mới).
//   • systemBackupIfDue: lần đầu chạy, lần 2 trong chu kỳ → KHÔNG chạy lại.
//   • systemStorageCheck: ngưỡng 1% → vượt → thông báo Admin 1 lần, lần 2 trong 24h → không lặp.
//   • Phân quyền STORAGE_VIEW / STORAGE_CLEANUP.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import { getStorageStatus, runCleanup, updateStorageConfig, systemBackupIfDue, systemStorageCheck, systemWeeklyMaintenanceIfDue } from './storage-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`STG16 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

const ADMIN_PW = 'Admin@123456';
const DAY = 86400_000;

export async function runStorageSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', ADMIN_PW);

  // ═══════════ A) STATUS + CẤU HÌNH ═══════════
  const cfg = await updateStorageConfig({ thresholdPct: 80, auditRetentionDays: 30, trashRetentionDays: 30, backupIntervalHours: 24 });
  ok('updateStorageConfig → ok', cfg.ok === true, cfg);
  const s0 = await getStorageStatus();
  ok('getStorageStatus → ok', s0.ok === true, s0.error);
  ok('dbBytes > 0', (s0.data?.dbBytes ?? 0) > 0, { dbBytes: s0.data?.dbBytes });
  ok('ngưỡng = 80, hạn audit = 30, hạn trash = 30', s0.data?.thresholdPct === 80 && s0.data?.cleanable.auditRetentionDays === 30 && s0.data?.cleanable.trashRetentionDays === 30, s0.data?.cleanable);
  const baseAuditOld = s0.data?.cleanable.auditOld ?? 0;
  const baseTrashOld = s0.data?.cleanable.trashOld ?? 0;

  // ═══════════ B) TẠO DỮ LIỆU CŨ + MỚI → cleanable đếm đúng ═══════════
  const old = new Date(Date.now() - 60 * DAY); // 60 ngày > hạn 30 → CŨ
  const recent = new Date(Date.now() - 5 * DAY); // 5 ngày < hạn 30 → MỚI
  // 3 audit cũ + 2 audit mới
  for (let i = 0; i < 3; i++) await db.auditLog.create({ data: { action: 'LOGIN_SUCCESS', ipAddress: 'local', deviceInfo: 'test', createdAt: old } });
  for (let i = 0; i < 2; i++) await db.auditLog.create({ data: { action: 'LOGIN_SUCCESS', ipAddress: 'local', deviceInfo: 'test', createdAt: recent } });
  // 2 khách trong thùng rác CŨ + 1 MỚI
  const oldCust1 = await db.customer.create({ data: { code: 'STGOLD1', fullName: 'Cũ 1', nickname: 'c1', deletedAt: old } });
  const oldCust2 = await db.customer.create({ data: { code: 'STGOLD2', fullName: 'Cũ 2', nickname: 'c2', deletedAt: old } });
  await db.customer.create({ data: { code: 'STGNEW1', fullName: 'Mới 1', nickname: 'n1', deletedAt: recent } });

  const s1 = await getStorageStatus();
  ok('cleanable.auditOld tăng đúng +3', s1.data?.cleanable.auditOld === baseAuditOld + 3, { before: baseAuditOld, after: s1.data?.cleanable.auditOld });
  ok('cleanable.trashOld tăng đúng +2', s1.data?.cleanable.trashOld === baseTrashOld + 2, { before: baseTrashOld, after: s1.data?.cleanable.trashOld });

  // ═══════════ C) CLEANUP AN TOÀN ═══════════
  const cBad = await runCleanup({ clearHistory: true, purgeTrash: true, password: 'sai-mat-khau' });
  ok('cleanup sai mật khẩu → WRONG_PASSWORD', cBad.ok === false && cBad.error === 'WRONG_PASSWORD', cBad);

  const cNone = await runCleanup({ password: ADMIN_PW });
  ok('cleanup không chọn mục nào → NOTHING_SELECTED', cNone.ok === false && cNone.error === 'NOTHING_SELECTED', cNone);

  const backupsBefore = await db.backupLog.count();
  const c1 = await runCleanup({ clearHistory: true, purgeTrash: true, password: ADMIN_PW });
  ok('cleanup đúng mật khẩu → ok + có backupFile', c1.ok === true && !!c1.backupFile, c1);
  ok('cleanup xóa ≥3 audit cũ', (c1.auditDeleted ?? 0) >= 3, { auditDeleted: c1.auditDeleted });
  ok('cleanup xóa đúng 2 bản ghi thùng rác cũ (ít nhất)', (c1.trashDeleted ?? 0) >= 2, { trashDeleted: c1.trashDeleted });
  const backupsAfter = await db.backupLog.count();
  ok('ĐÃ backup TRƯỚC khi xóa (backup_logs +1)', backupsAfter === backupsBefore + 1, { before: backupsBefore, after: backupsAfter });

  // dữ liệu CŨ đã bị xóa, dữ liệu MỚI còn nguyên
  ok('khách cũ 1 đã xóa vĩnh viễn', (await db.customer.findUnique({ where: { id: oldCust1.id } })) === null, {});
  ok('khách cũ 2 đã xóa vĩnh viễn', (await db.customer.findUnique({ where: { id: oldCust2.id } })) === null, {});
  ok('khách MỚI (trong hạn) VẪN còn', (await db.customer.findFirst({ where: { code: 'STGNEW1' } })) !== null, {});
  const auditRecentLeft = await db.auditLog.count({ where: { createdAt: { gte: new Date(Date.now() - 10 * DAY) } } });
  ok('audit MỚI (trong hạn) VẪN còn', auditRecentLeft >= 2, { auditRecentLeft });

  // ═══════════ D) BACKUP ĐỊNH KỲ ═══════════
  // reset cờ để test "due"
  await db.appSetting.deleteMany({ where: { key: 'backup.lastAt' } });
  const b1 = await systemBackupIfDue(db);
  ok('systemBackupIfDue lần đầu (chưa từng backup) → CHẠY', b1.ran === true, b1);
  const b2 = await systemBackupIfDue(db);
  ok('systemBackupIfDue lần 2 (trong 24h) → KHÔNG chạy lại', b2.ran === false, b2);

  // ═══════════ E) CẢNH BÁO NGƯỠNG ═══════════
  await updateStorageConfig({ thresholdPct: 1 }); // ép vượt ngưỡng
  await db.appSetting.deleteMany({ where: { key: 'storage.lastAlertAt' } });
  const chk = await systemStorageCheck(db);
  if (chk.usedPct == null) {
    ok('nền tảng không hỗ trợ statfs → bỏ qua test cảnh báo (không tính fail)', true, { note: 'diskUsedPct null' });
    ok('(skip) cảnh báo lặp', true);
  } else {
    ok('vượt ngưỡng 1% → thông báo Admin (notified)', chk.over === true && chk.notified === true, chk);
    const admin = await db.user.findFirst({ where: { username: 'adminroot' }, select: { id: true } });
    const alertMsg = await db.message.count({ where: { recipientId: admin!.id, category: 'STORAGE_ALERT' } });
    ok('có thư cảnh báo trong hòm thư Admin', alertMsg >= 1, { alertMsg });
    const chk2 = await systemStorageCheck(db);
    ok('cảnh báo lần 2 trong 24h → KHÔNG lặp', chk2.notified === false, chk2);
  }
  await updateStorageConfig({ thresholdPct: 80 }); // trả lại mặc định

  // ═══════════ E1b) #3 (audit 0.2.57): MÁY TRẠM KHÔNG ĐO Ổ ĐĨA ═══════════
  // `SHOW data_directory` là đường dẫn TRÊN MÁY CHỦ PG. Máy trạm (GLB_ROLE≠server) statfs đường đó = đo NHẦM
  // ổ máy trạm → cảnh báo sai. Fix: máy trạm trả disk*=null (thành thật), nhưng dbBytes (pg_database_size) vẫn đúng.
  // B83 (20/7): isServerRole() có fallback marker FILE — cô lập ca "máy trạm" khỏi marker thật của máy
  // chạy selftest (vd chính máy chủ) bằng cách trỏ GLB_ROLE_MARKER sang đường chắc chắn không tồn tại.
  const savedRole3 = process.env['GLB_ROLE'];
  const savedMarker3 = process.env['GLB_ROLE_MARKER'];
  delete process.env['GLB_ROLE'];
  process.env['GLB_ROLE_MARKER'] = join(tmpdir(), '__glb_no_such_marker__.flag');
  const cliStatus = await getStorageStatus();
  ok('#3: máy trạm → disk*=null (không đo nhầm ổ) + over=false', cliStatus.ok === true && cliStatus.data!.diskFreeBytes === null && cliStatus.data!.diskTotalBytes === null && cliStatus.data!.diskUsedPct === null && cliStatus.data!.over === false, cliStatus.data);
  ok('#3: máy trạm vẫn đọc được dbBytes qua pg_database_size', cliStatus.ok === true && (cliStatus.data!.dbBytes ?? 0) > 0, { dbBytes: cliStatus.data?.dbBytes });
  if (savedRole3 === undefined) delete process.env['GLB_ROLE']; else process.env['GLB_ROLE'] = savedRole3;
  if (savedMarker3 === undefined) delete process.env['GLB_ROLE_MARKER']; else process.env['GLB_ROLE_MARKER'] = savedMarker3;

  // ═══════════ E2) BẢO TRÌ ĐỊNH KỲ (thứ/giờ/bật-tắt/auto-purge + VACUUM) ═══════════
  // Tạo lại dữ liệu quá hạn để weekly auto-purge có việc để làm.
  for (let i = 0; i < 4; i++) await db.auditLog.create({ data: { action: 'LOGIN_SUCCESS', ipAddress: 'local', deviceInfo: 'test', createdAt: old } });
  await db.customer.create({ data: { code: 'STGWK1', fullName: 'Tuần cũ', nickname: 'wk1', deletedAt: old } });
  await db.appSetting.deleteMany({ where: { key: 'maintenance.lastAt' } });

  // TẮT tự động → không chạy
  await updateStorageConfig({ maintenanceEnabled: false });
  const wOff = await systemWeeklyMaintenanceIfDue(db);
  ok('bảo trì TẮT tự động → KHÔNG chạy', wOff.ran === false, wOff);

  // BẬT + lịch = hôm nay lúc 00:00 (mốc lịch ≤ now) + auto-purge ON → chạy
  const today = new Date().getDay();
  await updateStorageConfig({ maintenanceEnabled: true, maintenanceDayOfWeek: today, maintenanceHour: 0, autoPurgeWeekly: true });
  const wRun = await systemWeeklyMaintenanceIfDue(db);
  ok('bảo trì BẬT + đến lịch → CHẠY', wRun.ran === true, wRun);
  ok('weekly auto-purge xóa ≥4 audit quá hạn', (wRun.auditDeleted ?? 0) >= 4, { auditDeleted: wRun.auditDeleted });
  ok('weekly xóa ≥1 bản ghi thùng rác quá hạn', (wRun.trashDeleted ?? 0) >= 1, { trashDeleted: wRun.trashDeleted });
  ok('weekly VACUUM thành công', wRun.vacuumed === true, wRun);
  const wAgain = await systemWeeklyMaintenanceIfDue(db);
  ok('bảo trì lần 2 trong tuần → KHÔNG chạy lại', wAgain.ran === false, wAgain);

  const sMt = await getStorageStatus();
  ok('status phản ánh lịch bảo trì (thứ hôm nay, giờ 0, đã bật)', sMt.data?.maintenanceEnabled === true && sMt.data?.maintenanceDayOfWeek === today && sMt.data?.maintenanceHour === 0, sMt.data);
  ok('status có mốc bảo trì gần nhất', !!sMt.data?.lastMaintenanceAt, { lastMaintenanceAt: sMt.data?.lastMaintenanceAt });

  const cfgBad = await updateStorageConfig({ maintenanceHour: 99 });
  ok('giờ bảo trì > 23 → VALIDATION', cfgBad.ok === false && cfgBad.error === 'VALIDATION', cfgBad);
  const cfgBadDay = await updateStorageConfig({ maintenanceDayOfWeek: 9 });
  ok('thứ bảo trì > 6 → VALIDATION', cfgBadDay.ok === false && cfgBadDay.error === 'VALIDATION', cfgBadDay);

  // E3) SÀN AN TOÀN chống xóa sạch (regression audit Nhóm E): retention/interval = 0 bị CHẶN.
  ok('hạn lưu nhật ký = 0 → VALIDATION (chống xóa sạch)', (await updateStorageConfig({ auditRetentionDays: 0 })).error === 'VALIDATION');
  ok('hạn lưu thùng rác = 0 → VALIDATION', (await updateStorageConfig({ trashRetentionDays: 0 })).error === 'VALIDATION');
  ok('chu kỳ backup = 0 → VALIDATION', (await updateStorageConfig({ backupIntervalHours: 0 })).error === 'VALIDATION');
  // Dù giá trị 0 lỡ lọt vào DB (dữ liệu cũ), purge vẫn KẸP SÀN → không xóa dữ liệu vừa tạo.
  await db.appSetting.upsert({ where: { key: 'storage.auditRetentionDays' }, update: { value: '0' }, create: { key: 'storage.auditRetentionDays', value: '0' } });
  const freshAudit = await db.auditLog.create({ data: { action: 'LOGIN_SUCCESS', ipAddress: 'local', deviceInfo: 'test' } });
  const cleanFloor = await runCleanup({ clearHistory: true, password: ADMIN_PW });
  ok('purge với hạn=0 trong DB → vẫn KẸP SÀN, KHÔNG xóa nhật ký vừa tạo', cleanFloor.ok === true && (await db.auditLog.findUnique({ where: { id: freshAudit.id } })) !== null, { auditDeleted: cleanFloor.auditDeleted });
  await db.appSetting.update({ where: { key: 'storage.auditRetentionDays' }, data: { value: '30' } });

  // ═══════════ F) PHÂN QUYỀN ═══════════
  await userSvc.createUser({ fullName: 'KH ngoài stg', username: 'custnostg', password: 'Cust@12345', roleCodes: ['CUSTOMER'] }).catch(() => undefined);
  await logout();
  await login('custnostg', 'Cust@12345');
  const forbView = await getStorageStatus();
  ok('CUSTOMER không STORAGE_VIEW → FORBIDDEN', forbView.ok === false && forbView.error === 'FORBIDDEN', forbView.error);
  const forbClean = await runCleanup({ clearHistory: true, password: 'Cust@12345' });
  ok('CUSTOMER không STORAGE_CLEANUP → FORBIDDEN', forbClean.ok === false && forbClean.error === 'FORBIDDEN', forbClean.error);

  await logout();
  // eslint-disable-next-line no-console
  console.log(`STG16 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
