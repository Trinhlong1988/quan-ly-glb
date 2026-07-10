// F-NOTIF — Thông báo sự kiện hủy bill vào hòm thư — self-test (GLB_SELFTEST=19).
// Số thật, real service, DB throwaway. Kiểm ĐÚNG người nhận 3 nhánh (NV/Manager/Admin tạo)
// + duyệt/từ chối gửi về requester + idempotent (duyệt lại KHÔNG đẩy thêm thông báo).
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import { createTransaction } from './transaction-service.js';
import { requestCancelBill, approveCancelBill, rejectCancelBill } from './approval-service.js';

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++;
  else fail++;
  // eslint-disable-next-line no-console
  console.log(`NOTIFY19 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const ADMIN_PW = 'Admin@123456';
const PW = 'User@123456';

export async function runNotifySelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', ADMIN_PW);
  const adminRoot = await db.user.findFirst({ where: { username: 'adminroot' }, select: { id: true } });

  // ═══ SETUP: phí + tid + user các vai ═══
  const bank = await db.bank.create({ data: { name: 'NH Notify', code: 'NFBANK' } });
  const card = await db.cardType.create({ data: { name: 'Thẻ Notify', code: 'NFND', bankId: bank.id } });
  const partner = await db.partner.create({ data: { name: 'Đối tác Notify', code: 'NFP' } });
  await db.partnerBank.create({ data: { partnerId: partner.id, bankId: bank.id } });
  await db.feeRate.create({ data: { partnerId: partner.id, cardTypeId: card.id, phiMua: 3000, phiCaiMay: 1000, phiBan: 2500, effectiveFrom: new Date('1970-01-01T00:00:00.000Z') } });
  const cust = await db.customer.create({ data: { code: 'KHNF', fullName: 'Khách Notify', nickname: 'KNF' } });
  const tid = await db.tid.create({ data: { tid: 'TIDNF', mid: 'MIDNF', hkdName: 'HKD Notify', bankId: bank.id, partnerId: partner.id, customerId: cust.id } });

  const acc = await userSvc.createUser({ fullName: 'Kế Toán NF', username: 'nfaccuser1', password: PW, roleCodes: ['ACCOUNTANT'] });
  const mgrA = await userSvc.createUser({ fullName: 'Quản Lý A', username: 'nfmgruser1', password: PW, roleCodes: ['MANAGER'] });
  const mgrB = await userSvc.createUser({ fullName: 'Quản Lý B', username: 'nfmgruser2', password: PW, roleCodes: ['MANAGER'] });
  const adminX = await userSvc.createUser({ fullName: 'Admin NF', username: 'nfadminx01', password: PW, roleCodes: ['ADMIN'] });
  const accId = (acc as { id: number }).id;
  const mgrAId = (mgrA as { id: number }).id;
  const mgrBId = (mgrB as { id: number }).id;
  const adminXId = (adminX as { id: number }).id;
  const adminRootId = adminRoot!.id;
  ok('tạo user 4 vai (acc/mgrA/mgrB/adminX)', !!accId && !!mgrAId && !!mgrBId && !!adminXId);
  // Vai (theo DEFAULT_ROLE_PERMISSIONS): ACCOUNTANT=REQUEST; MANAGER=REQUEST+APPROVE; ADMIN=+ELEVATED.
  // ⇒ APPROVE holders = {mgrA, mgrB, adminX, adminRoot}; ELEVATED holders = {adminX, adminRoot}.

  const mkBill = async (): Promise<number> => {
    const c = await createTransaction({ tidId: tid.id, cardTypeId: card.id, amount: 10_000_000, txnDate: '2026-07-01T00:00:00.000Z' });
    if (!c.ok || !c.id) throw new Error('mkBill thất bại: ' + JSON.stringify(c));
    return c.id;
  };
  const cnt = (recipientId: number, category: string): Promise<number> => db.message.count({ where: { recipientId, category, kind: 'SYSTEM', senderId: null } });
  const REQ = 'BILL_CANCEL_REQUEST';
  const APV = 'BILL_CANCEL_APPROVED';
  const REJ = 'BILL_CANCEL_REJECTED';

  // Đo bằng DELTA mỗi sự kiện (approver tích lũy qua nhiều request nên đếm tuyệt đối gây nhiễu):
  // snapshot trước → tạo request → assert phần TĂNG THÊM đúng người nhận của CHÍNH request đó.
  const snap = async (): Promise<Record<number, number>> => ({
    [accId]: await cnt(accId, REQ),
    [mgrAId]: await cnt(mgrAId, REQ),
    [mgrBId]: await cnt(mgrBId, REQ),
    [adminXId]: await cnt(adminXId, REQ),
    [adminRootId]: await cnt(adminRootId, REQ)
  });
  const delta = async (before: Record<number, number>, id: number): Promise<number> => (await cnt(id, REQ)) - before[id];

  // ═══ 1) NV (acc) tạo yêu cầu → mọi APPROVE holder (mgrA/mgrB/adminX/adminRoot) +1; acc +0 ═══
  await logout();
  await login('nfaccuser1', PW);
  const s1 = await snap();
  const bAcc = await mkBill();
  const reqAcc = await requestCancelBill(bAcc, 'Nhân viên nhập nhầm');
  ok('acc tạo yêu cầu → ok', reqAcc.ok === true, reqAcc);
  ok('1) mgrA +1 (approver)', (await delta(s1, mgrAId)) === 1);
  ok('1) mgrB +1 (approver)', (await delta(s1, mgrBId)) === 1);
  ok('1) adminX +1 (approver)', (await delta(s1, adminXId)) === 1);
  ok('1) adminRoot +1 (approver)', (await delta(s1, adminRootId)) === 1);
  ok('1) acc (người tạo) +0', (await delta(s1, accId)) === 0);

  // ═══ 2) Manager (mgrA) tạo yêu cầu → CHỈ ELEVATED (adminX/adminRoot) +1; mgrB & mgrA +0 ═══
  await logout();
  await login('nfmgruser1', PW);
  const s2 = await snap();
  const bMgr = await mkBill();
  const reqMgr = await requestCancelBill(bMgr, 'Quản lý yêu cầu hủy');
  ok('mgrA tạo yêu cầu → ok', reqMgr.ok === true, reqMgr);
  ok('2) adminX +1 (ELEVATED)', (await delta(s2, adminXId)) === 1);
  ok('2) adminRoot +1 (ELEVATED)', (await delta(s2, adminRootId)) === 1);
  ok('2) mgrB (Manager, không ELEVATED) +0', (await delta(s2, mgrBId)) === 0);
  ok('2) mgrA (người tạo) +0', (await delta(s2, mgrAId)) === 0);

  // ═══ 3) Admin (adminX) tạo yêu cầu → CHỈ ELEVATED khác (adminRoot) +1; adminX (self) +0; mgrA/mgrB +0 ═══
  await logout();
  await login('nfadminx01', PW);
  const s3 = await snap();
  const bAdm = await mkBill();
  const reqAdm = await requestCancelBill(bAdm, 'Admin yêu cầu hủy');
  ok('adminX tạo yêu cầu → ok', reqAdm.ok === true, reqAdm);
  ok('3) adminRoot +1 (ELEVATED)', (await delta(s3, adminRootId)) === 1);
  ok('3) adminX (người tạo) +0', (await delta(s3, adminXId)) === 0);
  ok('3) mgrA (không ELEVATED) +0', (await delta(s3, mgrAId)) === 0);
  ok('3) mgrB (không ELEVATED) +0', (await delta(s3, mgrBId)) === 0);

  // ═══ 4) DUYỆT yêu cầu của acc (mgrA duyệt) → acc nhận APPROVED (=1) ═══
  await logout();
  await login('nfmgruser1', PW);
  const apv = await approveCancelBill(reqAcc.id!);
  ok('mgrA duyệt yêu cầu của acc → ok', apv.ok === true, apv);
  ok('4) acc nhận thông báo ĐÃ DUYỆT (=1)', (await cnt(accId, APV)) === 1);

  // ═══ 6) IDEMPOTENT: duyệt lại yêu cầu đã xử lý → INVALID_STATE, KHÔNG đẩy thêm ═══
  const apvAgain = await approveCancelBill(reqAcc.id!);
  ok('6) duyệt lại → ALREADY_DECIDED', apvAgain.ok === false && apvAgain.error === 'ALREADY_DECIDED', apvAgain);
  ok('6) acc VẪN chỉ có 1 thông báo ĐÃ DUYỆT (không nhân đôi)', (await cnt(accId, APV)) === 1);

  // ═══ 5) TỪ CHỐI yêu cầu của mgrA (adminX từ chối) → mgrA nhận REJECTED (=1) ═══
  await logout();
  await login('nfadminx01', PW);
  const rej = await rejectCancelBill(reqMgr.id!, 'Không đủ căn cứ');
  ok('adminX từ chối yêu cầu của mgrA → ok', rej.ok === true, rej);
  ok('5) mgrA nhận thông báo BỊ TỪ CHỐI (=1)', (await cnt(mgrAId, REJ)) === 1);
  ok('5) từ chối KHÔNG tạo thông báo ĐÃ DUYỆT cho mgrA (=0)', (await cnt(mgrAId, APV)) === 0);
  // idempotent reject: từ chối lại → INVALID_STATE, không đẩy thêm.
  const rejAgain = await rejectCancelBill(reqMgr.id!, 'lần 2');
  ok('5) từ chối lại → INVALID_STATE', rejAgain.ok === false && rejAgain.error === 'INVALID_STATE', rejAgain);
  ok('5) mgrA VẪN chỉ 1 thông báo BỊ TỪ CHỐI', (await cnt(mgrAId, REJ)) === 1);

  await logout();
  // eslint-disable-next-line no-console
  console.log(`NOTIFY19 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
