// G10.C — gia cố tương tranh (concurrency-correctness) — self-test tất định (GLB_SELFTEST=21).
// Số thật, real service, DB throwaway. SQLite serialize nên đây là logic GUARD tất định
// (conditional transition + $transaction). Race THẬT (2 phiên song song) kiểm ở G10.5 (=20) trên Postgres.
// Phủ 3 ca dispatch ④:
//  (a) tạo yêu cầu hủy khi bill đã CANCEL_PENDING → INVALID_STATE, KHÔNG tạo request thứ 2.
//  (b) duyệt 1 request 2 lần → lần 2 ALREADY_DECIDED, KHÔNG audit/notify lần 2, bill chỉ CANCELLED 1 lần.
//  (c) từ chối → bill quay lại POSTED, có thể tạo yêu cầu hủy mới.
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
  console.log(`GUARD21 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const ADMIN_PW = 'Admin@123456';
const PW = 'User@123456';

export async function runGuardSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', ADMIN_PW);

  // ═══ SETUP: phí + tid + user (acc = nhân viên tạo yêu cầu, mgr = duyệt) ═══
  const bank = await db.bank.create({ data: { name: 'NH Guard', code: 'GDBANK' } });
  const card = await db.cardType.create({ data: { name: 'Thẻ Guard', code: 'GDND', bankId: bank.id } });
  const partner = await db.partner.create({ data: { name: 'Đối tác Guard', code: 'GDP' } });
  await db.partnerBank.create({ data: { partnerId: partner.id, bankId: bank.id } });
  await db.feeRate.create({ data: { partnerId: partner.id, cardTypeId: card.id, phiMua: 3000, phiCaiMay: 1000, phiBan: 2500, effectiveFrom: new Date('1970-01-01T00:00:00.000Z') } });
  const cust = await db.customer.create({ data: { code: 'KHGD', fullName: 'Khách Guard', nickname: 'KGD' } });
  const tid = await db.tid.create({ data: { tid: 'TIDGD', mid: 'MIDGD', hkdName: 'HKD Guard', bankId: bank.id, partnerId: partner.id, customerId: cust.id } });

  const acc = await userSvc.createUser({ fullName: 'Kế Toán GD', username: 'gdaccuser1', password: PW, roleCodes: ['ACCOUNTANT'] });
  const mgr = await userSvc.createUser({ fullName: 'Quản Lý GD', username: 'gdmgruser1', password: PW, roleCodes: ['MANAGER'] });
  const accId = (acc as { id: number }).id;
  ok('setup: tạo user acc + mgr', !!accId && !!(mgr as { id?: number }).id);

  const mkBill = async (): Promise<number> => {
    const c = await createTransaction({ tidId: tid.id, cardTypeId: card.id, amount: 10_000_000, txnDate: '2026-07-01T00:00:00.000Z' });
    if (!c.ok || !c.id) throw new Error('mkBill thất bại: ' + JSON.stringify(c));
    return c.id;
  };
  const reqCount = (billId: number): Promise<number> => db.approvalRequest.count({ where: { entityType: 'Transaction', entityId: billId } });

  // ═══ (a) TẠO YÊU CẦU KHI ĐÃ CANCEL_PENDING → INVALID_STATE, KHÔNG tạo request thứ 2 ═══
  await logout();
  await login('gdaccuser1', PW);
  const bA = await mkBill();
  const rA1 = await requestCancelBill(bA, 'lần 1 hợp lệ');
  ok('(a) yêu cầu lần 1 → ok', rA1.ok === true, rA1);
  const bARow1 = await db.transaction.findUnique({ where: { id: bA } });
  ok('(a) bill sang CANCEL_PENDING', bARow1?.status === 'CANCEL_PENDING', { status: bARow1?.status });
  const rA2 = await requestCancelBill(bA, 'lần 2 trùng');
  ok('(a) yêu cầu lần 2 (đã CANCEL_PENDING) → INVALID_STATE', rA2.ok === false && rA2.error === 'INVALID_STATE', rA2);
  ok('(a) CHỈ có đúng 1 ApprovalRequest cho bill (không tạo request thứ 2)', (await reqCount(bA)) === 1, { count: await reqCount(bA) });

  // ═══ (b) DUYỆT 2 LẦN → lần 2 ALREADY_DECIDED, KHÔNG audit/notify thêm, bill CANCELLED đúng 1 lần ═══
  await logout();
  await login('gdmgruser1', PW);
  const apv1 = await approveCancelBill(rA1.id!);
  ok('(b) duyệt lần 1 → ok', apv1.ok === true, apv1);
  const bAAfter1 = await db.transaction.findUnique({ where: { id: bA } });
  ok('(b) bill CANCELLED sau duyệt lần 1', bAAfter1?.status === 'CANCELLED', { status: bAAfter1?.status });
  // Snapshot side-effects TRƯỚC lần duyệt thứ 2.
  const auditBefore = await db.auditLog.count();
  const notifyApvBefore = await db.message.count({ where: { recipientId: accId, category: 'BILL_CANCEL_APPROVED', kind: 'SYSTEM', senderId: null } });
  ok('(b) người tạo có đúng 1 thông báo ĐÃ DUYỆT sau lần 1', notifyApvBefore === 1, { notifyApvBefore });
  const cancelledAt1 = bAAfter1?.cancelledAt?.getTime();
  const apv2 = await approveCancelBill(rA1.id!);
  ok('(b) duyệt lần 2 → ALREADY_DECIDED', apv2.ok === false && apv2.error === 'ALREADY_DECIDED', apv2);
  const auditAfter = await db.auditLog.count();
  ok('(b) KHÔNG ghi thêm audit ở lần duyệt thứ 2', auditAfter === auditBefore, { auditBefore, auditAfter });
  const notifyApvAfter = await db.message.count({ where: { recipientId: accId, category: 'BILL_CANCEL_APPROVED', kind: 'SYSTEM', senderId: null } });
  ok('(b) KHÔNG đẩy thêm thông báo ĐÃ DUYỆT (vẫn = 1)', notifyApvAfter === 1, { notifyApvAfter });
  const bAAfter2 = await db.transaction.findUnique({ where: { id: bA } });
  ok('(b) bill vẫn CANCELLED và cancelledAt KHÔNG bị ghi đè lần 2', bAAfter2?.status === 'CANCELLED' && bAAfter2?.cancelledAt?.getTime() === cancelledAt1, { status: bAAfter2?.status });

  // ═══ (c) TỪ CHỐI → bill về POSTED → tạo được yêu cầu hủy MỚI ═══
  await logout();
  await login('gdaccuser1', PW);
  const bC = await mkBill();
  const rC1 = await requestCancelBill(bC, 'sẽ bị từ chối');
  ok('(c) yêu cầu hủy → ok', rC1.ok === true, rC1);
  await logout();
  await login('gdmgruser1', PW);
  const rej = await rejectCancelBill(rC1.id!, 'không đủ căn cứ');
  ok('(c) từ chối → ok', rej.ok === true, rej);
  const bCAfterRej = await db.transaction.findUnique({ where: { id: bC } });
  const rC1Row = await db.approvalRequest.findUnique({ where: { id: rC1.id! } });
  ok('(c) sau từ chối: bill QUAY LẠI POSTED + request REJECTED', bCAfterRej?.status === 'POSTED' && rC1Row?.status === 'REJECTED', { bill: bCAfterRej?.status, req: rC1Row?.status });
  // từ chối lại yêu cầu đã xử lý → INVALID_STATE (không hoàn/không notify thêm).
  const rejAgain = await rejectCancelBill(rC1.id!, 'lần 2');
  ok('(c) từ chối lại yêu cầu đã xử lý → INVALID_STATE', rejAgain.ok === false && rejAgain.error === 'INVALID_STATE', rejAgain);
  // Bill đã POSTED → tạo yêu cầu hủy MỚI được (chu trình khép kín).
  await logout();
  await login('gdaccuser1', PW);
  const rC2 = await requestCancelBill(bC, 'yêu cầu mới sau khi bị từ chối');
  ok('(c) tạo yêu cầu hủy MỚI sau khi bill về POSTED → ok', rC2.ok === true, rC2);
  const bCAfterReq2 = await db.transaction.findUnique({ where: { id: bC } });
  ok('(c) bill lại sang CANCEL_PENDING theo yêu cầu mới', bCAfterReq2?.status === 'CANCEL_PENDING', { status: bCAfterReq2?.status });
  ok('(c) có đúng 2 ApprovalRequest cho bill (1 REJECTED + 1 PENDING)', (await reqCount(bC)) === 2, { count: await reqCount(bC) });

  await logout();
  // eslint-disable-next-line no-console
  console.log(`GUARD21 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
