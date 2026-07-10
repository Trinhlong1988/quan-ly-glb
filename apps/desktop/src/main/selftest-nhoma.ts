// Nhóm A — Bảo mật & tài khoản — self-test tích hợp (GLB_SELFTEST=11).
// Chạy trên DB throwaway (GLB_DB_URL). Chứng minh bằng SỐ LIỆU THẬT (đọc lại DB):
//  • Sai xác thực 5 lần (đăng nhập / đổi mật khẩu sai mật khẩu cũ) → TỰ KHÓA + audit + báo hòm thư admin.
//  • Đăng nhập đúng → xóa bộ đếm sai.
//  • Đổi mật khẩu: cũ + mới + xác nhận KHỚP (lệch → báo lỗi), khác mật khẩu cũ.
//  • Admin/Manager đặt lại mật khẩu user khác → ép đổi + mở khóa + báo hòm thư user đó.
//  • Hòm thư: đếm chưa đọc, đánh dấu đã đọc, gửi thư nội bộ; thông báo bảo mật CHỈ tới admin.
import { login, logout, changePassword, adminResetPassword } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import * as msg from './message-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`NHOMA11 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

async function mkUser(fullName: string, username: string, password: string, role = 'SALES'): Promise<number> {
  // Tạo user cần session có quyền USER_CREATE → luôn đăng nhập admin trước (caller tự login lại actor sau đó).
  await login('adminroot', 'Admin@123456');
  const res = await userSvc.createUser({ fullName, username, password, roleCodes: [role] });
  if (!res.ok) throw new Error(`createUser("${username}") thất bại: ${res.error ?? ''} ${res.message ?? ''}`);
  const u = await getDb().user.findUnique({ where: { username }, select: { id: true } });
  if (!u) throw new Error(`không tìm thấy user "${username}" sau khi tạo`);
  return u.id;
}
async function statusOf(id: number): Promise<{ status: string; failedAttempts: number; forceChangePassword: boolean; lockedAt: Date | null }> {
  const u = await getDb().user.findUnique({ where: { id }, select: { status: true, failedAttempts: true, forceChangePassword: true, lockedAt: true } });
  return u!;
}

export async function runNhomASelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', 'Admin@123456');

  // ═══════════ A) ĐĂNG NHẬP SAI 5 LẦN → TỰ KHÓA + THÔNG BÁO ADMIN ═══════════
  const lockId = await mkUser('NV Khóa', 'locktest', 'Lock@123456');
  await logout();
  for (let i = 1; i <= 4; i++) {
    const r = await login('locktest', 'sai-mat-khau');
    const s = await statusOf(lockId);
    ok(`đăng nhập sai lần ${i} → từ chối INVALID_CREDENTIALS`, r.ok === false && r.error === 'INVALID_CREDENTIALS', r.error);
    ok(`sau sai lần ${i}: đếm=${i}, còn ACTIVE`, s.failedAttempts === i && s.status === 'ACTIVE', s);
  }
  const r5 = await login('locktest', 'sai-mat-khau');
  const sLocked = await statusOf(lockId);
  ok('sai lần 5 → trả STATUS_LOCKED', r5.ok === false && r5.error === 'STATUS_LOCKED', r5.error);
  ok('sau sai lần 5: status=LOCKED, đếm=5, có lockedAt', sLocked.status === 'LOCKED' && sLocked.failedAttempts === 5 && sLocked.lockedAt !== null, sLocked);
  const autoLockAudit = await db.auditLog.count({ where: { action: 'USER_AUTO_LOCKED', targetId: String(lockId) } });
  ok('có audit USER_AUTO_LOCKED', autoLockAudit === 1, { autoLockAudit });
  // đúng mật khẩu nhưng đã khóa → vẫn từ chối
  const rAfterLock = await login('locktest', 'Lock@123456');
  ok('đúng mật khẩu nhưng đã khóa → vẫn từ chối', rAfterLock.ok === false, rAfterLock.error);

  // thông báo bảo mật đến hòm thư ADMIN (login admin để đọc)
  await logout();
  await login('adminroot', 'Admin@123456');
  const adminInbox1 = await msg.listInbox();
  const lockMsg = (adminInbox1.data ?? []).find((m) => m.category === 'SECURITY_LOCK' && m.subject.includes('locktest'));
  ok('hòm thư admin có thông báo SECURITY_LOCK về locktest', !!lockMsg, { found: !!lockMsg });
  ok('thông báo bảo mật là kind=SYSTEM, người gửi=Hệ thống', lockMsg?.kind === 'SYSTEM' && lockMsg?.senderName === 'Hệ thống', { kind: lockMsg?.kind, sender: lockMsg?.senderName });

  // ═══════════ B) ĐĂNG NHẬP ĐÚNG → XÓA BỘ ĐẾM SAI ═══════════
  const resetId = await mkUser('NV Reset', 'resettest', 'Reset@123456');
  await logout();
  for (let i = 1; i <= 3; i++) await login('resettest', 'sai-nhe');
  const sBefore = await statusOf(resetId);
  ok('sau 3 lần sai: đếm=3 còn ACTIVE', sBefore.failedAttempts === 3 && sBefore.status === 'ACTIVE', sBefore);
  const good = await login('resettest', 'Reset@123456');
  const sAfter = await statusOf(resetId);
  ok('đăng nhập đúng → ok', good.ok === true, good.error);
  ok('đăng nhập đúng → bộ đếm sai về 0', sAfter.failedAttempts === 0 && sAfter.status === 'ACTIVE', sAfter);

  // ═══════════ C) ĐỔI MẬT KHẨU: CŨ + MỚI + XÁC NHẬN KHỚP ═══════════
  // đang đăng nhập resettest. Sai mật khẩu cũ 2 lần (đếm tăng, chưa khóa).
  for (let i = 1; i <= 2; i++) {
    const c = await changePassword('sai-cu', 'MoiMoi@123', 'MoiMoi@123');
    ok(`đổi MK: sai mật khẩu cũ lần ${i} → WRONG_CURRENT_PASSWORD`, c.ok === false && c.error === 'WRONG_CURRENT_PASSWORD', c.error);
  }
  // xác nhận KHÔNG khớp → PASSWORD_MISMATCH
  const cMis = await changePassword('Reset@123456', 'MoiMoi@123', 'Khac@456789');
  ok('đổi MK: xác nhận không khớp → PASSWORD_MISMATCH', cMis.ok === false && cMis.error === 'PASSWORD_MISMATCH', cMis.error);
  // mật khẩu mới = mật khẩu cũ → SAME_PASSWORD
  const cSame = await changePassword('Reset@123456', 'Reset@123456', 'Reset@123456');
  ok('đổi MK: mới trùng cũ → SAME_PASSWORD', cSame.ok === false && cSame.error === 'SAME_PASSWORD', cSame.error);
  // mật khẩu yếu → WEAK_PASSWORD
  const cWeak = await changePassword('Reset@123456', '123', '123');
  ok('đổi MK: mật khẩu yếu → WEAK_PASSWORD', cWeak.ok === false && cWeak.error === 'WEAK_PASSWORD', cWeak.error);
  // hợp lệ → ok, đổi thật + đếm về 0
  const cOk = await changePassword('Reset@123456', 'MoiMoi@123', 'MoiMoi@123');
  ok('đổi MK hợp lệ (khớp xác nhận) → ok', cOk.ok === true, cOk.error);
  const sAfterChg = await statusOf(resetId);
  ok('đổi MK thành công → đếm sai về 0', sAfterChg.failedAttempts === 0, sAfterChg);
  await logout();
  const loginNew = await login('resettest', 'MoiMoi@123');
  ok('đăng nhập bằng mật khẩu MỚI → ok', loginNew.ok === true, loginNew.error);
  await logout();
  const loginOld = await login('resettest', 'Reset@123456');
  ok('đăng nhập bằng mật khẩu CŨ → từ chối', loginOld.ok === false, loginOld.error);

  // ═══════════ D) ĐỔI MẬT KHẨU SAI MK CŨ 5 LẦN → KHÓA (quyết định 3b) ═══════════
  const chgLockId = await mkUser('NV ĐổiKhóa', 'chglockusr', 'Chg@123456');
  await logout();
  await login('chglockusr', 'Chg@123456');
  for (let i = 1; i <= 4; i++) {
    const c = await changePassword('sai-cu-hoai', 'Moi@123456', 'Moi@123456');
    ok(`đổi MK sai cũ lần ${i} → WRONG_CURRENT_PASSWORD`, c.ok === false && c.error === 'WRONG_CURRENT_PASSWORD', c.error);
  }
  const c5 = await changePassword('sai-cu-hoai', 'Moi@123456', 'Moi@123456');
  const sChgLock = await statusOf(chgLockId);
  ok('đổi MK sai cũ lần 5 → ACCOUNT_LOCKED', c5.ok === false && c5.error === 'ACCOUNT_LOCKED', c5.error);
  ok('đổi MK sai cũ 5 lần → status=LOCKED', sChgLock.status === 'LOCKED', sChgLock);

  // ═══════════ E) ADMIN ĐẶT LẠI MẬT KHẨU USER KHÁC (ép đổi + mở khóa + báo hòm thư) ═══════════
  await logout();
  await login('adminroot', 'Admin@123456');
  const rReset = await adminResetPassword(lockId, 'Fresh@123456'); // locktest đang LOCKED
  const sReset = await statusOf(lockId);
  ok('admin đặt lại mật khẩu locktest → ok', rReset.ok === true, rReset.error);
  ok('sau đặt lại: forceChangePassword=true', sReset.forceChangePassword === true, sReset);
  ok('sau đặt lại: đã MỞ KHÓA (LOCKED→ACTIVE)', sReset.status === 'ACTIVE' && sReset.lockedAt === null, sReset);
  ok('sau đặt lại: đếm sai về 0', sReset.failedAttempts === 0, sReset);
  const resetAudit = await db.auditLog.count({ where: { action: 'PASSWORD_RESET_BY_ADMIN', targetId: String(lockId) } });
  ok('có audit PASSWORD_RESET_BY_ADMIN', resetAudit === 1, { resetAudit });
  // locktest đăng nhập bằng mật khẩu mới → ok + ép đổi
  await logout();
  const relog = await login('locktest', 'Fresh@123456');
  ok('locktest đăng nhập MK mới sau reset → ok', relog.ok === true, relog.error);
  ok('locktest bị ép đổi mật khẩu (mustChangePassword)', relog.mustChangePassword === true, { must: relog.mustChangePassword });
  // hòm thư locktest có SECURITY_RESET
  const lockUserInbox = await msg.listInbox();
  const resetMsg = (lockUserInbox.data ?? []).find((m) => m.category === 'SECURITY_RESET');
  ok('hòm thư locktest có thông báo SECURITY_RESET', !!resetMsg, { found: !!resetMsg });

  // ═══════════ F) PHÂN QUYỀN: SALES KHÔNG được đặt lại mật khẩu ═══════════
  await mkUser('NV Sales2', 'salesusr2', 'Sales@123456');
  await logout();
  await login('salesusr2', 'Sales@123456');
  const forb = await adminResetPassword(resetId, 'Hack@123456');
  ok('SALES đặt lại mật khẩu user khác → FORBIDDEN', forb.ok === false && forb.error === 'FORBIDDEN', forb.error);

  // ═══════════ G) HÒM THƯ: gửi thư nội bộ + đếm chưa đọc + đánh dấu đã đọc ═══════════
  // thông báo bảo mật CHỈ tới admin: SALES sales2 KHÔNG nhận SECURITY_LOCK
  const salesInbox = await msg.listInbox();
  const salesHasSecurity = (salesInbox.data ?? []).some((m) => m.category === 'SECURITY_LOCK');
  ok('SALES KHÔNG nhận thông báo bảo mật (chỉ admin/manager)', salesHasSecurity === false, { count: (salesInbox.data ?? []).length });
  // gửi thư thiếu tiêu đề/nội dung → lỗi rõ
  const eSub = await msg.sendMessage({ recipientId: resetId, subject: '  ', body: 'x' });
  ok('gửi thư thiếu tiêu đề → EMPTY_SUBJECT', eSub.ok === false && eSub.error === 'EMPTY_SUBJECT', eSub.error);
  const eRcpt = await msg.sendMessage({ recipientId: 999999, subject: 'Chào', body: 'Nội dung' });
  ok('gửi thư người nhận không tồn tại → NO_RECIPIENT', eRcpt.ok === false && eRcpt.error === 'NO_RECIPIENT', eRcpt.error);
  // gửi hợp lệ sales2 → resettest
  const sent = await msg.sendMessage({ recipientId: resetId, subject: 'Xin chào nội bộ', body: 'Thư kiểm thử realtime.' });
  ok('gửi thư nội bộ hợp lệ → ok', sent.ok === true, sent.error);
  // resettest đọc hòm thư
  await logout();
  await login('resettest', 'MoiMoi@123');
  const rInbox = await msg.listInbox();
  const gotMsg = (rInbox.data ?? []).find((m) => m.subject === 'Xin chào nội bộ');
  ok('resettest nhận được thư', !!gotMsg, { found: !!gotMsg });
  ok('thư hiển thị đúng tên người gửi (NV Sales2)', gotMsg?.senderName === 'NV Sales2', { sender: gotMsg?.senderName });
  const uc1 = await msg.unreadCount();
  ok('đếm chưa đọc ≥ 1', (uc1.data ?? 0) >= 1, uc1.data);
  const mr = await msg.markRead(gotMsg!.id);
  ok('đánh dấu đã đọc → ok', mr.ok === true, mr.error);
  await msg.markAllRead();
  const uc2 = await msg.unreadCount();
  ok('sau đánh dấu tất cả đã đọc → chưa đọc = 0', (uc2.data ?? -1) === 0, uc2.data);
  // không được đánh dấu đọc thư của người khác
  const otherMsg = await db.message.findFirst({ where: { recipientId: lockId }, select: { id: true } });
  if (otherMsg) {
    const badMark = await msg.markRead(otherMsg.id);
    ok('không đánh dấu đọc thư của người khác → NOT_FOUND', badMark.ok === false && badMark.error === 'NOT_FOUND', badMark.error);
  } else {
    ok('không đánh dấu đọc thư của người khác → NOT_FOUND (bỏ qua: không có thư)', true);
  }

  await logout();
  // eslint-disable-next-line no-console
  console.log(`NHOMA11 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
