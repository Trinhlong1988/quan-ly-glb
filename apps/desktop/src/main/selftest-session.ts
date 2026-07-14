// R46/R41 — 1 tài khoản 1 thiết bị + nhịp tim + danh sách đang đăng nhập — self-test (GLB_SELFTEST=35).
// DB throwaway Postgres (advisory lock cần Postgres). Số thật, real service.
import { login, logout, heartbeat, listOnlineUsers } from './auth-service.js';
import { lockUser as adminLockUser } from './user-service.js';
import { getDb, ensureCriticalSchema } from './db.js';
import { hashPassword } from '@glb/business-rules';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`SESSION35 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';

export async function runSessionSelfTest(): Promise<number> {
  const db = getDb();
  const admin = await db.user.findFirstOrThrow({ where: { username: 'adminroot' } });
  const uid = admin.id;
  const countSessions = async (): Promise<number> => db.loginSession.count({ where: { userId: uid } });
  const countLive = async (): Promise<number> => db.loginSession.count({ where: { userId: uid, expiresAt: { gt: new Date() }, lastSeenAt: { gt: new Date(Date.now() - 45_000) } } });

  // ═══ 0) BUG DB-TIẾN-HÓA (0.2.34): thiếu cột users.lock_reason → login ném "column does not exist"
  //        ("Lỗi hệ thống khi đăng nhập"); ensureCriticalSchema PHẢI tự thêm lại cột → login OK. ═══
  await db.$executeRawUnsafe('ALTER TABLE "users" DROP COLUMN IF EXISTS "lock_reason"');
  let brokeErr = '';
  try { await login('adminroot', PW, { deviceId: 'G-BREAK' }); } catch (e) { brokeErr = e instanceof Error ? e.message : String(e); }
  ok('DB-tiến-hóa: thiếu lock_reason → login NÉM (mô phỏng đúng lỗi 0.2.34)', /lock_reason|column/i.test(brokeErr), { err: brokeErr.slice(0, 80) });
  await ensureCriticalSchema(db);
  const healLogin = await login('adminroot', PW, { deviceId: 'G-HEAL' });
  ok('DB-tiến-hóa: sau ensureCriticalSchema (self-heal cột) → login THÀNH CÔNG (hết "Lỗi hệ thống")', healLogin.ok === true, { err: healLogin.error });
  await logout();

  // ═══ 1) Đăng nhập lần đầu → tạo 1 phiên ═══
  const r1 = await login('adminroot', PW, { deviceInfo: 'MAY-A' });
  ok('đăng nhập lần đầu ok', r1.ok === true, { err: r1.error });
  ok('có đúng 1 phiên', (await countSessions()) === 1, { n: await countSessions() });

  // ═══ 2) Danh sách đang đăng nhập chứa adminroot ═══
  const on1 = await listOnlineUsers();
  ok('online list ok + chứa adminroot', on1.ok === true && (on1.data ?? []).some((u) => u.username === 'adminroot'), on1.data);
  ok('online list gắn deviceInfo MAY-A', (on1.data ?? []).find((u) => u.username === 'adminroot')?.deviceInfo === 'MAY-A');

  // ═══ 3) Đăng nhập LẠI (chưa force) → chặn SESSION_ACTIVE_ELSEWHERE, KHÔNG tạo phiên 2 ═══
  const r2 = await login('adminroot', PW, { deviceInfo: 'MAY-B' });
  ok('đăng nhập nơi khác (chưa xác nhận) → SESSION_ACTIVE_ELSEWHERE', r2.ok === false && r2.error === 'SESSION_ACTIVE_ELSEWHERE', { err: r2.error });
  ok('thông báo kèm tên thiết bị đang đăng nhập (MAY-A)', r2.otherDevice === 'MAY-A', { otherDevice: r2.otherDevice });
  ok('vẫn chỉ 1 phiên (không tạo phiên 2)', (await countSessions()) === 1, { n: await countSessions() });

  // ═══ 4) Đăng nhập FORCE (đã xác nhận) → đá phiên cũ, còn đúng 1 phiên ═══
  const before = await db.loginSession.findFirstOrThrow({ where: { userId: uid } });
  const r3 = await login('adminroot', PW, { force: true, deviceInfo: 'MAY-B' });
  ok('đăng nhập force ok', r3.ok === true, { err: r3.error });
  ok('vẫn đúng 1 phiên sống (phiên cũ bị đá)', (await countLive()) === 1, { n: await countLive() });
  ok('phiên cũ (MAY-A) đã bị xóa', (await db.loginSession.findUnique({ where: { id: before.id } })) === null);
  ok('phiên mới gắn MAY-B', (await db.loginSession.findFirstOrThrow({ where: { userId: uid } })).deviceInfo === 'MAY-B');

  // ═══ 5) Nhịp tim cập nhật lastSeenAt cho phiên hiện tại ═══
  const cur = await db.loginSession.findFirstOrThrow({ where: { userId: uid } });
  await db.loginSession.update({ where: { id: cur.id }, data: { lastSeenAt: new Date(Date.now() - 20_000) } });
  const hb = await heartbeat();
  ok('heartbeat ok (phiên còn)', hb.ok === true && !hb.kicked, hb);
  const after = await db.loginSession.findFirstOrThrow({ where: { userId: uid } });
  ok('heartbeat làm mới lastSeenAt', after.lastSeenAt.getTime() > cur.lastSeenAt.getTime() - 20_000 && after.lastSeenAt.getTime() > Date.now() - 5_000);

  // ═══ 6) Phiên bị đá (xóa khỏi DB) → heartbeat báo kicked ═══
  await db.loginSession.deleteMany({ where: { userId: uid } });
  const hb2 = await heartbeat();
  ok('heartbeat sau khi bị đá → kicked', hb2.ok === false && hb2.kicked === true, hb2);

  // ═══ 7) Phiên CŨ (nhịp tim quá hạn) KHÔNG chặn đăng nhập nơi khác + không tính online ═══
  await db.loginSession.deleteMany({ where: { userId: uid } });
  await db.loginSession.create({ data: { id: 'stale-sess-1', userId: uid, expiresAt: new Date(Date.now() + 3_600_000), lastSeenAt: new Date(Date.now() - 120_000), deviceInfo: 'MAY-CU' } });
  const rStale = await login('adminroot', PW, { deviceInfo: 'MAY-MOI' });
  ok('phiên quá hạn nhịp tim KHÔNG chặn → đăng nhập ok', rStale.ok === true, { err: rStale.error });
  ok('phiên chết không tính vào online', (await countLive()) === 1, { live: await countLive() });

  // ═══ 8) TƯƠNG TRANH: 2 lệnh force song song cùng user → CHÍNH XÁC 1 phiên sống (advisory lock) ═══
  await db.loginSession.deleteMany({ where: { userId: uid } });
  await login('adminroot', PW, { deviceInfo: 'MAY-X' });
  const [f1, f2] = await Promise.all([
    login('adminroot', PW, { force: true, deviceInfo: 'MAY-Y' }),
    login('adminroot', PW, { force: true, deviceInfo: 'MAY-Z' })
  ]);
  ok('2 force song song đều ok', f1.ok === true && f2.ok === true, { f1: f1.error, f2: f2.error });
  ok('sau tương tranh: đúng 1 phiên sống (không nhân đôi)', (await countLive()) === 1, { live: await countLive() });

  // ═══ 9) R48 Pha 2 — device-GUID: cùng GUID (dù hostname đổi) = same device; khác GUID = thiết bị khác ═══
  await db.loginSession.deleteMany({ where: { userId: uid } });
  await login('adminroot', PW, { deviceId: 'GUID-A', deviceInfo: 'MAY-1' });
  const sameG = await login('adminroot', PW, { deviceId: 'GUID-A', deviceInfo: 'MAY-1-DOI-TEN' });
  ok('cùng deviceId (GUID) dù hostname đổi → thay thế im lặng', sameG.ok === true, sameG);
  ok('vẫn 1 phiên (không nhân đôi)', (await countLive()) === 1, { live: await countLive() });
  const otherG = await login('adminroot', PW, { deviceId: 'GUID-B', deviceInfo: 'MAY-2' });
  ok('khác deviceId → SESSION_ACTIVE_ELSEWHERE (chống giả mạo hostname)', otherG.ok === false && otherG.error === 'SESSION_ACTIVE_ELSEWHERE', otherG);

  // ═══ 10) R48 Pha 2 (#3) — guard re-validate: phiên bị xóa (kick) → thao tác có quyền BỊ THU HỒI ngay ═══
  await db.loginSession.deleteMany({ where: { userId: uid } });
  await login('adminroot', PW, { deviceId: 'GUID-A' });
  await db.loginSession.deleteMany({ where: { userId: uid } }); // mô phỏng bị đá khỏi DB
  const gone = await listOnlineUsers(); // gated bởi requirePermission → validateCurrentSession thấy phiên chết
  ok('phiên bị xóa → thao tác có quyền NOT_AUTHENTICATED (không chờ nhịp tim)', gone.ok === false && gone.error === 'NOT_AUTHENTICATED', gone);

  // ═══ 11) R48 Pha 2 (#4) — forceChangePassword CHẶN mọi thao tác qua guard ═══
  await login('adminroot', PW, { deviceId: 'GUID-A' });
  await db.user.create({ data: { username: 'fcptest001', fullName: 'FCP Test', passwordHash: hashPassword('User@123456'), status: 'ACTIVE', forceChangePassword: true } });
  await login('fcptest001', 'User@123456', { deviceId: 'G-FCP' });
  const blocked = await listOnlineUsers();
  ok('user còn forceChangePassword → thao tác bị chặn MUST_CHANGE_PASSWORD', blocked.ok === false && blocked.error === 'MUST_CHANGE_PASSWORD', blocked);

  // ═══ 12) R48 Pha 2 (#1) — khóa TẠM THỜI: sai 5 lần → khóa; quá cooldown + đúng → TỰ MỞ ═══
  const lockUser = await db.user.create({ data: { username: 'locktest001', fullName: 'Lock Test', passwordHash: hashPassword('User@123456'), status: 'ACTIVE', forceChangePassword: false } });
  for (let i = 0; i < 5; i++) await login('locktest001', 'SAI_MAT_KHAU', {});
  const lu = await db.user.findUnique({ where: { id: lockUser.id } });
  ok('sai 5 lần → tài khoản LOCKED', lu?.status === 'LOCKED', { status: lu?.status });
  const stillLocked = await login('locktest001', 'User@123456', {});
  ok('trong cooldown → vẫn khóa (chưa tự mở)', stillLocked.ok === false, { err: stillLocked.error });
  await db.user.update({ where: { id: lockUser.id }, data: { lockedAt: new Date(Date.now() - 20 * 60 * 1000) } });
  const unlocked = await login('locktest001', 'User@123456', { deviceId: 'G-LOCK' });
  ok('quá cooldown (>15p) + mật khẩu đúng → TỰ MỞ KHÓA + đăng nhập ok', unlocked.ok === true, { err: unlocked.error });
  const lu2 = await db.user.findUnique({ where: { id: lockUser.id } });
  ok('tự mở khóa → status ACTIVE + reset đếm sai', lu2?.status === 'ACTIVE' && lu2?.failedAttempts === 0, { status: lu2?.status, fa: lu2?.failedAttempts });

  // ═══ 13) P0-01 (PING) — khóa TAY của Admin (ADMIN_LOCK) KHÔNG tự mở qua login dù quá cooldown ═══
  await login('adminroot', PW, { force: true, deviceId: 'GUID-ADM' }); // đảm bảo phiên adminroot để gọi service
  const mUser = await db.user.create({ data: { username: 'manlock0001', fullName: 'Manual Lock', passwordHash: hashPassword('User@123456'), status: 'ACTIVE' } });
  const lk = await adminLockUser(mUser.id);
  ok('P0-01: admin khóa tay ok', lk.ok === true, lk);
  const mrow = await db.user.findUnique({ where: { id: mUser.id } });
  ok('P0-01: khóa tay → LOCKED + lockReason ADMIN_LOCK + lockedAt null', mrow?.status === 'LOCKED' && mrow?.lockReason === 'ADMIN_LOCK' && mrow?.lockedAt === null, { s: mrow?.status, lr: mrow?.lockReason, la: mrow?.lockedAt });
  // Ép "quá cooldown" (đặt lockedAt quá khứ) — khóa TAY vẫn KHÔNG được tự mở vì lockReason≠AUTH_FAILURE.
  await db.user.update({ where: { id: mUser.id }, data: { lockedAt: new Date(Date.now() - 60 * 60 * 1000) } });
  const tryMan = await login('manlock0001', 'User@123456', { deviceId: 'G-MAN' });
  ok('P0-01: khóa tay + quá cooldown → VẪN không đăng nhập (không tự mở)', tryMan.ok === false, { err: tryMan.error });
  ok('P0-01: sau login, tài khoản khóa tay VẪN LOCKED', (await db.user.findUnique({ where: { id: mUser.id } }))?.status === 'LOCKED');

  // ═══ 13b) P0-01 — kịch bản mỏ-neo-cũ: auto-lock → admin mở → admin khóa lại → login KHÔNG tự mở ═══
  const stale = await db.user.create({ data: { username: 'stalelk0001', fullName: 'Stale Lock', passwordHash: hashPassword('User@123456'), status: 'LOCKED', lockReason: 'AUTH_FAILURE', lockedAt: new Date(Date.now() - 60 * 60 * 1000), failedAttempts: 5 } });
  await login('adminroot', PW, { force: true, deviceId: 'GUID-ADM2' });
  // admin khóa TAY (dù đang auto-lock) → chuyển thành ADMIN_LOCK, lockedAt=null → không còn mỏ neo tự-mở.
  await adminLockUser(stale.id);
  const staleRow = await db.user.findUnique({ where: { id: stale.id } });
  ok('P0-01: khóa tay đè auto-lock cũ → ADMIN_LOCK + lockedAt null (xóa mỏ neo)', staleRow?.lockReason === 'ADMIN_LOCK' && staleRow?.lockedAt === null, { lr: staleRow?.lockReason, la: staleRow?.lockedAt });
  const tryStale = await login('stalelk0001', 'User@123456', { deviceId: 'G-STALE' });
  ok('P0-01: login sau khóa-tay-đè → KHÔNG tự mở (giữ khóa)', tryStale.ok === false && (await db.user.findUnique({ where: { id: stale.id } }))?.status === 'LOCKED', { err: tryStale.error });

  // ═══ 14) P0-02 (PING) — N login sai SONG SONG: bộ đếm đúng bằng N (atomic increment, không mất lần) ═══
  const raceU = await db.user.create({ data: { username: 'racefail01', fullName: 'Race Fail', passwordHash: hashPassword('User@123456'), status: 'ACTIVE' } });
  const N = 4; // < ngưỡng 5 → chưa khóa, kiểm counter chính xác
  await Promise.all(Array.from({ length: N }, () => login('racefail01', 'SAI_MK', { deviceId: 'G-RACE' })));
  const rrow = await db.user.findUnique({ where: { id: raceU.id } });
  ok('P0-02: N=4 login sai SONG SONG → failedAttempts === 4 (không mất lần do race)', rrow?.failedAttempts === N, { fa: rrow?.failedAttempts });
  // Chạm ngưỡng song song → CHỈ 1 transition LOCKED + lockReason AUTH_FAILURE.
  const raceL = await db.user.create({ data: { username: 'racelock01', fullName: 'Race Lock', passwordHash: hashPassword('User@123456'), status: 'ACTIVE', failedAttempts: 4 } });
  await Promise.all(Array.from({ length: 4 }, () => login('racelock01', 'SAI_MK', { deviceId: 'G-RACE2' })));
  const rlrow = await db.user.findUnique({ where: { id: raceL.id } });
  ok('P0-02: chạm ngưỡng song song → LOCKED + AUTH_FAILURE (đúng 1 transition)', rlrow?.status === 'LOCKED' && rlrow?.lockReason === 'AUTH_FAILURE', { s: rlrow?.status, lr: rlrow?.lockReason, fa: rlrow?.failedAttempts });

  await logout();
  // eslint-disable-next-line no-console
  console.log(`SESSION35 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
