// R46/R41 — 1 tài khoản 1 thiết bị + nhịp tim + danh sách đang đăng nhập — self-test (GLB_SELFTEST=35).
// DB throwaway Postgres (advisory lock cần Postgres). Số thật, real service.
import { login, logout, heartbeat, listOnlineUsers } from './auth-service.js';
import { getDb } from './db.js';

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

  await logout();
  // eslint-disable-next-line no-console
  console.log(`SESSION35 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
