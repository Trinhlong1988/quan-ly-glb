// R34 — Duyệt hủy (xóa qua duyệt) TID/POS/Khách/Nhân sự — self-test (GLB_SELFTEST=34).
// Số thật, real service, DB throwaway. Phủ: request tạo yêu cầu · chống trùng PENDING · phân vai
// (warehouse/manager/admin, self-forbidden, need-elevated) · mật khẩu người duyệt (Q2) · guard POS-đang-gắn-TID
// · guard User self-delete · approve → soft-delete thật · reject → giữ nguyên.
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import { requestEntityCancel, approveEntityCancel, rejectEntityCancel, listEntityCancelRequests } from './entity-cancel-service.js';

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++;
  else fail++;
  // eslint-disable-next-line no-console
  console.log(`ENTITYCANCEL34 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const ADMIN_PW = 'Admin@123456';
const PW = 'User@123456';

export async function runEntityCancelSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', ADMIN_PW);

  // ═══ SETUP ═══
  const bank = await db.bank.create({ data: { name: 'NH Hủy', code: 'CXBANK' } });
  const partner = await db.partner.create({ data: { name: 'Đối tác Hủy', code: 'CXP' } });
  const cust = await db.customer.create({ data: { code: 'KHCX', fullName: 'Khách Hủy', nickname: 'KCX' } });
  const cust2 = await db.customer.create({ data: { code: 'KHCX2', fullName: 'Khách Hủy 2', nickname: 'KCX2' } });
  const tid = await db.tid.create({ data: { tid: 'TIDCX', hkdName: 'HKD Hủy', bankId: bank.id, partnerId: partner.id } });
  const posClean = await db.posDevice.create({ data: { serial: 'POSCLEAN', status: 'IN_STOCK', bankId: bank.id } });
  const posWithTid = await db.posDevice.create({ data: { serial: 'POSBUSY', status: 'DEPLOYED', bankId: bank.id, currentTid: 'TIDCX' } });

  const wh = await userSvc.createUser({ fullName: 'Kho Vận', username: 'whouse01', password: PW, roleCodes: ['WAREHOUSE'] });
  const mgr = await userSvc.createUser({ fullName: 'Quản Lý', username: 'mgrcx001', password: PW, roleCodes: ['MANAGER'] });
  const mgr2 = await userSvc.createUser({ fullName: 'Quản Lý 2', username: 'mgrcx002', password: PW, roleCodes: ['MANAGER'] });
  const victim = await userSvc.createUser({ fullName: 'Nhân Viên Bị Xóa', username: 'victim01', password: PW, roleCodes: ['ACCOUNTANT'] });
  ok('tạo user (wh/mgr/mgr2/victim)', !!(wh as { id?: number }).id && !!(mgr as { id?: number }).id && !!(mgr2 as { id?: number }).id && !!(victim as { id?: number }).id);
  const victimId = (victim as { id: number }).id;

  // ═══ 1) TID — warehouse REQUEST (không có APPROVE) → manager duyệt (không cần elevated) ═══
  await logout();
  await login('whouse01', PW);
  const reqNoReason = await requestEntityCancel('Tid', tid.id, '  ');
  ok('request thiếu lý do → VALIDATION', reqNoReason.ok === false && reqNoReason.error === 'VALIDATION', reqNoReason);
  const reqTid = await requestEntityCancel('Tid', tid.id, 'TID nhập sai, cần hủy');
  ok('warehouse tạo yêu cầu hủy TID → ok', reqTid.ok === true, reqTid);
  const dupTid = await requestEntityCancel('Tid', tid.id, 'lần 2');
  ok('yêu cầu trùng khi đang PENDING → ALREADY_PENDING', dupTid.ok === false && dupTid.error === 'ALREADY_PENDING', dupTid);
  const tidStillThere = await db.tid.findUnique({ where: { id: tid.id } });
  ok('TID CHƯA bị xóa khi mới tạo yêu cầu', tidStillThere?.deletedAt == null);

  // ═══ 2) POS đang gắn TID → precheck DEVICE_HAS_TID ═══
  const reqPosBusy = await requestEntityCancel('PosDevice', posWithTid.id, 'thử hủy máy đang gắn TID');
  ok('hủy POS đang gắn TID → DEVICE_HAS_TID', reqPosBusy.ok === false && reqPosBusy.error === 'DEVICE_HAS_TID', reqPosBusy);
  const reqPosClean = await requestEntityCancel('PosDevice', posClean.id, 'máy hỏng thanh lý khỏi hệ thống');
  ok('warehouse tạo yêu cầu hủy POS sạch → ok', reqPosClean.ok === true, reqPosClean);

  // ═══ 3) Manager DUYỆT (mật khẩu Q2) — sai mật khẩu chặn, tự duyệt của người khác thì được ═══
  await logout();
  await login('mgrcx001', PW);
  const badPw = await approveEntityCancel('Tid', reqTid.id!, 'SAI_MAT_KHAU');
  ok('duyệt sai mật khẩu → WRONG_PASSWORD', badPw.ok === false && badPw.error === 'WRONG_PASSWORD', badPw);
  const tidAfterBadPw = await db.tid.findUnique({ where: { id: tid.id } });
  ok('sai mật khẩu KHÔNG xóa TID', tidAfterBadPw?.deletedAt == null);
  const apprTid = await approveEntityCancel('Tid', reqTid.id!, PW, 'duyệt hủy TID');
  ok('manager duyệt đúng mật khẩu → ok', apprTid.ok === true, apprTid);
  const tidDeleted = await db.tid.findUnique({ where: { id: tid.id } });
  ok('TID đã bị XÓA MỀM sau duyệt', tidDeleted?.deletedAt != null && tidDeleted?.deletedBy != null, { deletedAt: !!tidDeleted?.deletedAt });
  const apprPos = await approveEntityCancel('PosDevice', reqPosClean.id!, PW);
  ok('manager duyệt hủy POS → ok', apprPos.ok === true, apprPos);
  const posDeleted = await db.posDevice.findUnique({ where: { id: posClean.id } });
  ok('POS đã bị XÓA MỀM sau duyệt', posDeleted?.deletedAt != null);

  // ═══ 4) Customer — manager tạo yêu cầu (có APPROVE) → manager2 NEED_ELEVATED → admin duyệt ═══
  const reqCust = await requestEntityCancel('Customer', cust.id, 'khách trùng, gộp hồ sơ');
  ok('manager tạo yêu cầu hủy khách → ok', reqCust.ok === true, reqCust);
  await logout();
  await login('mgrcx002', PW);
  const needElev = await approveEntityCancel('Customer', reqCust.id!, PW);
  ok('manager khác duyệt yêu cầu do manager tạo → NEED_ELEVATED', needElev.ok === false && needElev.error === 'NEED_ELEVATED', needElev);
  await logout();
  await login('adminroot', ADMIN_PW);
  const adminApprCust = await approveEntityCancel('Customer', reqCust.id!, ADMIN_PW, 'admin duyệt');
  ok('admin (elevated) duyệt hủy khách → ok', adminApprCust.ok === true, adminApprCust);
  const custDeleted = await db.customer.findUnique({ where: { id: cust.id } });
  ok('khách hàng đã bị XÓA MỀM sau duyệt', custDeleted?.deletedAt != null);

  // ═══ 5) Self-approve bị chặn (manager tự duyệt yêu cầu của chính mình) ═══
  await logout();
  await login('mgrcx001', PW);
  const reqCust2 = await requestEntityCancel('Customer', cust2.id, 'khách 2 cần hủy');
  ok('manager tạo yêu cầu hủy khách 2 → ok', reqCust2.ok === true, reqCust2);
  const selfAppr = await approveEntityCancel('Customer', reqCust2.id!, PW);
  ok('tự duyệt yêu cầu của chính mình → SELF_APPROVAL_FORBIDDEN', selfAppr.ok === false && selfAppr.error === 'SELF_APPROVAL_FORBIDDEN', selfAppr);
  // admin TỪ CHỐI → khách 2 KHÔNG bị xóa, yêu cầu REJECTED.
  await logout();
  await login('adminroot', ADMIN_PW);
  const rejCust2 = await rejectEntityCancel('Customer', reqCust2.id!, 'khách vẫn dùng, không hủy');
  ok('admin từ chối yêu cầu → ok', rejCust2.ok === true, rejCust2);
  const cust2Alive = await db.customer.findUnique({ where: { id: cust2.id } });
  ok('khách 2 KHÔNG bị xóa sau từ chối', cust2Alive?.deletedAt == null);

  // ═══ 6) User — self-delete chặn; manager tạo yêu cầu xóa victim → admin duyệt → DELETED ═══
  await logout();
  await login('mgrcx001', PW);
  const selfDel = await requestEntityCancel('User', (mgr as { id: number }).id, 'tự xóa mình');
  ok('tạo yêu cầu tự xóa mình → SELF_DELETE', selfDel.ok === false && selfDel.error === 'SELF_DELETE', selfDel);
  const reqUser = await requestEntityCancel('User', victimId, 'nhân viên nghỉ việc');
  ok('manager tạo yêu cầu hủy nhân sự → ok', reqUser.ok === true, reqUser);
  await logout();
  await login('adminroot', ADMIN_PW);
  const apprUser = await approveEntityCancel('User', reqUser.id!, ADMIN_PW);
  ok('admin duyệt hủy nhân sự → ok', apprUser.ok === true, apprUser);
  const victimRow = await db.user.findUnique({ where: { id: victimId } });
  ok('nhân sự đã bị xóa (status DELETED + deletedAt)', victimRow?.status === 'DELETED' && victimRow?.deletedAt != null, { status: victimRow?.status });

  // ═══ 7) listEntityCancelRequests: admin thấy PENDING còn lại (đã xử lý hết → rỗng) ═══
  const inbox = await listEntityCancelRequests('PENDING');
  ok('inbox PENDING trả ok (đã xử lý hết)', inbox.ok === true && (inbox.data ?? []).length === 0, { n: inbox.data?.length });

  // ═══ 8) BACKSTOP TƯƠNG TRANH (audit đợt 4): partial-unique 1 yêu cầu CANCEL PENDING / (loại,id) ═══
  const idx = await db.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes WHERE tablename='approval_requests' AND indexname='approval_requests_pending_cancel_uq'`
  );
  ok('tồn tại partial-unique index approval_requests_pending_cancel_uq', Array.isArray(idx) && idx.length === 1, idx);

  // ═══ 9) BULK yêu cầu hủy (Nhóm 1) — lặp requestEntityCancel cho nhiều id (mô phỏng nút "Yêu cầu hủy (n)"):
  //       mỗi id 1 yêu cầu PENDING, KHÔNG xóa cứng — đúng luồng Duyệt Hủy R34. ═══
  const p1 = await db.posDevice.create({ data: { serial: 'POSBULK1', status: 'IN_STOCK', bankId: bank.id } });
  const p2 = await db.posDevice.create({ data: { serial: 'POSBULK2', status: 'IN_STOCK', bankId: bank.id } });
  let bulkOk = 0;
  for (const id of [p1.id, p2.id]) {
    const r = await requestEntityCancel('PosDevice', id, 'bulk hủy máy tồn');
    if (r.ok) bulkOk++;
  }
  ok('bulk: 2 yêu cầu hủy POS tạo được (lặp từng id)', bulkOk === 2, { bulkOk });
  const pend = await db.approvalRequest.count({ where: { entityType: 'PosDevice', action: 'CANCEL', status: 'PENDING', entityId: { in: [p1.id, p2.id] } } });
  ok('bulk: đúng 2 yêu cầu PENDING (đi qua duyệt, chưa xóa)', pend === 2, { pend });
  const p1Alive = await db.posDevice.findUnique({ where: { id: p1.id } });
  const p2Alive = await db.posDevice.findUnique({ where: { id: p2.id } });
  ok('bulk: 2 máy CHƯA bị xóa (không xóa cứng, chờ duyệt)', p1Alive?.deletedAt == null && p2Alive?.deletedAt == null);

  await logout();
  // eslint-disable-next-line no-console
  console.log(`ENTITYCANCEL34 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
