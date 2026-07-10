// Nhóm A #3 — Pass cấp 2 + Xóa vĩnh viễn + Dọn sạch thùng rác — self-test (GLB_SELFTEST=12).
// Chạy trên DB throwaway. Chứng minh bằng SỐ LIỆU THẬT:
//  • Đặt/đổi pass cấp 2 (cấp 1 + cấp 2 cũ + mới ×2), sai cấp 1/cấp 2 cũ 5 lần → khóa.
//  • Xóa vĩnh viễn từng mục (mật khẩu cấp 1) — bản ghi biến mất khỏi DB.
//  • Dọn sạch toàn bộ (mật khẩu cấp 2) — thùng rác về 0; chưa đặt cấp 2 → chặn.
//  • Phân quyền TRASH_PURGE / LEVEL2_MANAGE.
import { login, logout, getLevel2Status, setLevel2Password, resetLevel2Password } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import * as trash from './trash-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`NHOMA12 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
async function mkUser(fullName: string, username: string, password: string, role: string): Promise<number> {
  await login('adminroot', 'Admin@123456');
  const res = await userSvc.createUser({ fullName, username, password, roleCodes: [role] });
  if (!res.ok) throw new Error(`createUser ${username}: ${res.error} ${res.message}`);
  const u = await getDb().user.findUnique({ where: { username }, select: { id: true } });
  return u!.id;
}
async function statusOf(id: number): Promise<{ status: string; failedAttempts: number }> {
  const u = await getDb().user.findUnique({ where: { id }, select: { status: true, failedAttempts: true } });
  return u!;
}

export async function runNhomA2SelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', 'Admin@123456');

  // ═══════════ A) ĐẶT / ĐỔI MẬT KHẨU CẤP 2 (adminroot) ═══════════
  const st0 = await getLevel2Status();
  ok('ban đầu adminroot CHƯA có pass cấp 2', st0.ok === true && st0.hasLevel2 === false, st0);
  ok('đặt cấp 2: sai mật khẩu cấp 1 → WRONG_PASSWORD', (await setLevel2Password('sai-cap-1', 'L2@123456', 'L2@123456')).error === 'WRONG_PASSWORD');
  ok('đặt cấp 2: xác nhận lệch → PASSWORD_MISMATCH', (await setLevel2Password('Admin@123456', 'L2@123456', 'Khac@999')).error === 'PASSWORD_MISMATCH');
  ok('đặt cấp 2: yếu → WEAK_PASSWORD', (await setLevel2Password('Admin@123456', '123', '123')).error === 'WEAK_PASSWORD');
  ok('đặt cấp 2 hợp lệ → ok', (await setLevel2Password('Admin@123456', 'L2@123456', 'L2@123456')).ok === true);
  ok('sau đặt: hasLevel2 = true', (await getLevel2Status()).hasLevel2 === true);
  ok('đặt lại lần nữa → ALREADY_SET', (await setLevel2Password('Admin@123456', 'X@1234567', 'X@1234567')).error === 'ALREADY_SET');
  ok('đổi cấp 2: sai cấp 1 → WRONG_PASSWORD', (await resetLevel2Password('sai', 'L2@123456', 'New2@123456', 'New2@123456')).error === 'WRONG_PASSWORD');
  ok('đổi cấp 2: sai cấp 2 cũ → WRONG_LEVEL2', (await resetLevel2Password('Admin@123456', 'sai-cu', 'New2@123456', 'New2@123456')).error === 'WRONG_LEVEL2');
  ok('đổi cấp 2: xác nhận lệch → PASSWORD_MISMATCH', (await resetLevel2Password('Admin@123456', 'L2@123456', 'New2@123456', 'Khac@1')).error === 'PASSWORD_MISMATCH');
  ok('đổi cấp 2: trùng cũ → SAME_PASSWORD', (await resetLevel2Password('Admin@123456', 'L2@123456', 'L2@123456', 'L2@123456')).error === 'SAME_PASSWORD');
  ok('đổi cấp 2 hợp lệ → ok', (await resetLevel2Password('Admin@123456', 'L2@123456', 'New2@123456', 'New2@123456')).ok === true);
  ok('audit LEVEL2_SET + LEVEL2_RESET tồn tại', (await db.auditLog.count({ where: { action: { in: ['LEVEL2_SET', 'LEVEL2_RESET'] } } })) >= 2);

  // ═══════════ B) SAI CẤP 2 CŨ 5 LẦN → KHÓA TÀI KHOẢN (manager) ═══════════
  const mgrId = await mkUser('QL Cấp2', 'l2locktest', 'Mgr@123456', 'MANAGER');
  await logout();
  await login('l2locktest', 'Mgr@123456');
  ok('manager đặt cấp 2 → ok', (await setLevel2Password('Mgr@123456', 'Sec@123456', 'Sec@123456')).ok === true);
  for (let i = 1; i <= 4; i++) {
    const r = await resetLevel2Password('Mgr@123456', 'sai-cu-hoai', 'New@123456', 'New@123456');
    const s = await statusOf(mgrId);
    ok(`đổi cấp 2 sai cũ lần ${i} → WRONG_LEVEL2, còn ACTIVE (đếm=${i})`, r.error === 'WRONG_LEVEL2' && s.status === 'ACTIVE' && s.failedAttempts === i, s);
  }
  const r5 = await resetLevel2Password('Mgr@123456', 'sai-cu-hoai', 'New@123456', 'New@123456');
  const sLock = await statusOf(mgrId);
  ok('đổi cấp 2 sai cũ lần 5 → ACCOUNT_LOCKED + status LOCKED', r5.error === 'ACCOUNT_LOCKED' && sLock.status === 'LOCKED', sLock);

  // ═══════════ C) XÓA VĨNH VIỄN TỪNG MỤC (mật khẩu cấp 1) ═══════════
  await logout();
  await login('adminroot', 'Admin@123456');
  const bankDel = await db.bank.create({ data: { name: 'NH Purge', code: 'PURGE1', deletedAt: new Date() } });
  const bankAlive = await db.bank.create({ data: { name: 'NH Sống', code: 'ALIVE1' } });
  ok('xóa vĩnh viễn: sai mật khẩu → WRONG_PASSWORD', (await trash.purgeItem('Bank', bankDel.id, 'sai-mk')).error === 'WRONG_PASSWORD');
  ok('xóa vĩnh viễn bản chưa xóa mềm → NOT_DELETED', (await trash.purgeItem('Bank', bankAlive.id, 'Admin@123456')).error === 'NOT_DELETED');
  ok('xóa vĩnh viễn id không tồn tại → NOT_FOUND', (await trash.purgeItem('Bank', 987654, 'Admin@123456')).error === 'NOT_FOUND');
  ok('xóa vĩnh viễn loại sai → BAD_ENTITY', (await trash.purgeItem('Xyz', 1, 'Admin@123456')).error === 'BAD_ENTITY');
  ok('xóa vĩnh viễn hợp lệ (đúng mật khẩu) → ok', (await trash.purgeItem('Bank', bankDel.id, 'Admin@123456')).ok === true);
  ok('bản ghi ĐÃ biến mất khỏi DB (xóa cứng)', (await db.bank.findUnique({ where: { id: bankDel.id } })) === null);
  ok('audit TRASH_PURGED tồn tại', (await db.auditLog.count({ where: { action: 'TRASH_PURGED' } })) >= 1);

  // ═══════════ D) DỌN SẠCH TOÀN BỘ (mật khẩu cấp 2) ═══════════
  // tạo nhiều bản ghi xóa mềm
  for (let i = 0; i < 8; i++) await db.customer.create({ data: { code: `KHP${i}`, fullName: `KH ${i}`, nickname: `N${i}`, deletedAt: new Date() } });
  for (let i = 0; i < 3; i++) await db.agent.create({ data: { name: `ĐL ${i}`, code: `DLP${i}`, deletedAt: new Date() } });
  const beforeList = await trash.listTrash();
  const beforeCount = (beforeList.data ?? []).length;
  ok('trước dọn: thùng rác có bản ghi', beforeCount >= 11, { beforeCount });
  ok('dọn sạch: sai mật khẩu cấp 2 → WRONG_LEVEL2', (await trash.emptyTrash('sai-cap-2')).error === 'WRONG_LEVEL2');
  const emptied = await trash.emptyTrash('New2@123456'); // pass cấp 2 hiện tại của adminroot
  ok('dọn sạch: đúng mật khẩu cấp 2 → ok', emptied.ok === true, emptied);
  ok('dọn sạch: purged đúng số (≥ beforeCount)', (emptied.purged ?? 0) >= beforeCount, { purged: emptied.purged, beforeCount });
  const afterList = await trash.listTrash();
  ok('sau dọn: thùng rác TRỐNG', (afterList.data ?? []).length === 0, { after: (afterList.data ?? []).length });
  ok('audit TRASH_EMPTIED tồn tại', (await db.auditLog.count({ where: { action: 'TRASH_EMPTIED' } })) >= 1);

  // chưa đặt cấp 2 → chặn dọn sạch
  await db.bank.create({ data: { name: 'NH X', code: 'X1', deletedAt: new Date() } });
  await mkUser('QL KhôngCấp2', 'nol2manager', 'Mgr2@12345', 'MANAGER');
  await logout();
  await login('nol2manager', 'Mgr2@12345');
  ok('chưa đặt cấp 2 → dọn sạch bị chặn LEVEL2_NOT_SET', (await trash.emptyTrash('bất kỳ')).error === 'LEVEL2_NOT_SET');

  // ═══════════ E) PHÂN QUYỀN: SALES không TRASH_PURGE / LEVEL2_MANAGE ═══════════
  await mkUser('NV Sale', 'salepurge', 'Sale@12345', 'SALES');
  await logout();
  await login('salepurge', 'Sale@12345');
  ok('SALES xóa vĩnh viễn → FORBIDDEN', (await trash.purgeItem('Bank', 1, 'Sale@12345')).error === 'FORBIDDEN');
  ok('SALES dọn sạch → FORBIDDEN', (await trash.emptyTrash('x')).error === 'FORBIDDEN');
  ok('SALES đặt cấp 2 → FORBIDDEN', (await setLevel2Password('Sale@12345', 'L2@123456', 'L2@123456')).error === 'FORBIDDEN');

  await logout();
  // eslint-disable-next-line no-console
  console.log(`NHOMA12 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
