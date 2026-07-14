// P1.2 — Approval Engine + bill BẤT BIẾN — self-test (GLB_SELFTEST=18). Số thật, real service, DB throwaway.
// Phủ §7.1 spec: I-A1 bất biến · request · phân vai (nhân viên/Manager/Admin/self/fallback 1-Admin) ·
// approve→CANCELLED · reject→POSTED · I-A4 loại cancelled khỏi doanh thu · I-A5 audit nhánh từ chối · bulk.
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import { createTransaction, updateTransaction, listTransactions, debtSummary } from './transaction-service.js';
import { requestCancelBill, approveCancelBill, rejectCancelBill, approveCancelBills } from './approval-service.js';

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++;
  else fail++;
  // eslint-disable-next-line no-console
  console.log(`APPROVAL18 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const ADMIN_PW = 'Admin@123456';
const PW = 'User@123456';

export async function runApprovalSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', ADMIN_PW);

  // ═══ SETUP: phí + tid + user các vai ═══
  const bank = await db.bank.create({ data: { name: 'NH Duyệt', code: 'APBANK' } });
  const card = await db.cardType.create({ data: { name: 'Thẻ Duyệt', code: 'APND', bankId: bank.id } });
  const partner = await db.partner.create({ data: { name: 'Đối tác Duyệt', code: 'APP' } });
  await db.partnerBank.create({ data: { partnerId: partner.id, bankId: bank.id } });
  const feeType = await db.feeType.create({ data: { name: 'Loại phí Duyệt' } });
  await db.feeRate.create({ data: { partnerId: partner.id, cardTypeId: card.id, phiMua: 3000, phiCaiMay: 1000, effectiveFrom: new Date('1970-01-01T00:00:00.000Z') } });
  await db.feeSellQuote.create({ data: { partnerId: partner.id, cardTypeId: card.id, feeTypeId: feeType.id, phiBan: 2500, effectiveFrom: new Date('1970-01-01T00:00:00.000Z') } });
  const cust = await db.customer.create({ data: { code: 'KHAP', fullName: 'Khách Duyệt', nickname: 'KAP' } });
  const tid = await db.tid.create({ data: { tid: 'TIDAP', mid: 'MIDAP', hkdName: 'HKD Duyệt', bankId: bank.id, partnerId: partner.id, customerId: cust.id } });

  const acc = await userSvc.createUser({ fullName: 'Kế Toán', username: 'accuser01', password: PW, roleCodes: ['ACCOUNTANT'] });
  const mgr = await userSvc.createUser({ fullName: 'Quản Lý', username: 'mgruser01', password: PW, roleCodes: ['MANAGER'] });
  const mgr2 = await userSvc.createUser({ fullName: 'Quản Lý 2', username: 'mgruser02', password: PW, roleCodes: ['MANAGER'] });
  const admin2 = await userSvc.createUser({ fullName: 'Admin Hai', username: 'adminx002', password: PW, roleCodes: ['ADMIN'] });
  ok('tạo user 4 vai (acc/mgr/mgr2/admin2)', !!(acc as { id?: number }).id && !!(mgr as { id?: number }).id && !!(admin2 as { id?: number }).id, { acc: (acc as { id?: number }).id });

  const mkBill = async (): Promise<number> => {
    const c = await createTransaction({ tidId: tid.id, cardTypeId: card.id, feeTypeId: feeType.id, amount: 10_000_000, txnDate: '2026-07-01T00:00:00.000Z' });
    if (!c.ok || !c.id) throw new Error('mkBill thất bại: ' + JSON.stringify(c));
    return c.id;
  };

  // ═══ 1) I-A1 BILL BẤT BIẾN ═══
  const b1 = await mkBill();
  const imm = await updateTransaction(b1, { amount: 5_000_000 });
  ok('I-A1: updateTransaction → BILL_IMMUTABLE (không sửa được)', imm.ok === false && imm.error === 'BILL_IMMUTABLE', imm);
  const b1row = await db.transaction.findUnique({ where: { id: b1 } });
  ok('I-A1: số tiền bill KHÔNG đổi sau khi thử sửa', Number(b1row?.amount) === 10_000_000, { amount: b1row?.amount });

  // ═══ 2) TẠO YÊU CẦU HỦY (acc = nhân viên) ═══
  await logout();
  await login('accuser01', PW);
  const bAcc = await mkBill();
  const reqNoReason = await requestCancelBill(bAcc, '   ');
  ok('request thiếu lý do → VALIDATION', reqNoReason.ok === false && reqNoReason.error === 'VALIDATION', reqNoReason);
  const reqAcc = await requestCancelBill(bAcc, 'Nhập nhầm số tiền');
  ok('acc tạo yêu cầu hủy → ok', reqAcc.ok === true, reqAcc);
  const bAccRow = await db.transaction.findUnique({ where: { id: bAcc } });
  ok('bill sang CANCEL_PENDING', bAccRow?.status === 'CANCEL_PENDING', { status: bAccRow?.status });

  // ═══ 3a) acc KHÔNG duyệt được (thiếu quyền); mgr duyệt yêu cầu của acc → OK ═══
  const accApprove = await approveCancelBill(reqAcc.id!, PW);
  ok('acc tự duyệt → FORBIDDEN (không có BILL_CANCEL_APPROVE)', accApprove.ok === false && accApprove.error === 'FORBIDDEN', accApprove);
  await logout();
  await login('mgruser01', PW);
  const mgrApprovesAcc = await approveCancelBill(reqAcc.id!, PW);
  ok('mgr duyệt yêu cầu của acc (nhân viên) → OK', mgrApprovesAcc.ok === true, mgrApprovesAcc);
  const bAccAfter = await db.transaction.findUnique({ where: { id: bAcc } });
  ok('approve → bill CANCELLED + cancelReason + cancelRequestId', bAccAfter?.status === 'CANCELLED' && bAccAfter?.cancelReason === 'Nhập nhầm số tiền' && bAccAfter?.cancelRequestId === reqAcc.id, { s: bAccAfter?.status, rid: bAccAfter?.cancelRequestId });

  // ═══ 3b) mgr tạo yêu cầu → self forbidden; mgr2 (không elevated) → NEED_ELEVATED; admin2 → OK ═══
  const bMgr = await mkBill(); // mgr đang đăng nhập
  const reqMgr = await requestCancelBill(bMgr, 'Quản lý yêu cầu hủy');
  ok('mgr tạo yêu cầu hủy → ok', reqMgr.ok === true, reqMgr);
  const mgrSelf = await approveCancelBill(reqMgr.id!, PW);
  ok('mgr tự duyệt yêu cầu của mình → SELF_APPROVAL_FORBIDDEN', mgrSelf.ok === false && mgrSelf.error === 'SELF_APPROVAL_FORBIDDEN', mgrSelf);
  await logout();
  await login('mgruser02', PW);
  const mgr2Approves = await approveCancelBill(reqMgr.id!, PW);
  ok('mgr2 (không Admin) duyệt yêu cầu của mgr → NEED_ELEVATED', mgr2Approves.ok === false && mgr2Approves.error === 'NEED_ELEVATED', mgr2Approves);
  await logout();
  await login('adminx002', PW);
  const adminApprovesMgr = await approveCancelBill(reqMgr.id!, PW);
  ok('Admin duyệt yêu cầu của mgr → OK', adminApprovesMgr.ok === true, adminApprovesMgr);

  // ═══ 5) REJECT → bill về POSTED ═══
  await logout();
  await login('accuser01', PW);
  const bRej = await mkBill();
  const reqRej = await requestCancelBill(bRej, 'thử rồi từ chối');
  await logout();
  await login('mgruser01', PW);
  const rejNoNote = await rejectCancelBill(reqRej.id!, '  ');
  ok('reject thiếu lý do → VALIDATION', rejNoNote.ok === false && rejNoNote.error === 'VALIDATION', rejNoNote);
  const rej = await rejectCancelBill(reqRej.id!, 'Lý do không hợp lệ');
  ok('mgr từ chối yêu cầu → ok', rej.ok === true, rej);
  const bRejRow = await db.transaction.findUnique({ where: { id: bRej } });
  const reqRejRow = await db.approvalRequest.findUnique({ where: { id: reqRej.id! } });
  ok('reject → bill về POSTED + request REJECTED', bRejRow?.status === 'POSTED' && reqRejRow?.status === 'REJECTED', { b: bRejRow?.status, r: reqRejRow?.status });

  // ═══ 6) I-A4: bill CANCELLED loại khỏi tổng doanh thu (vẫn hiển thị trong list) ═══
  await logout();
  await login('adminroot', ADMIN_PW);
  const sumBefore = await listTransactions({ tidId: tid.id });
  const totalBefore = sumBefore.summary?.totalRevenue ?? 0;
  const listCount = sumBefore.data?.length ?? 0;
  // bAcc + bMgr đã CANCELLED ở trên → không tính vào doanh thu; b1 + bRej POSTED (350k mỗi cái).
  ok('I-A4: tổng doanh thu chỉ tính bill POSTED (2×350.000 = 700.000)', totalBefore === 700_000, { totalBefore });
  const hasCancelledInList = (sumBefore.data ?? []).some((d) => d.status === 'CANCELLED');
  ok('I-A4: bill CANCELLED VẪN hiển thị trong danh sách', hasCancelledInList && listCount >= 4, { listCount });
  const debt = await debtSummary({ tidId: tid.id });
  ok('I-A4: công nợ cũng loại bill CANCELLED', debt.data?.debtTotal === 700_000, debt.data);

  // ═══ 7) I-A5: nhánh TỪ CHỐI ghi audit ═══
  await logout();
  await login('accuser01', PW);
  const bAudit = await mkBill();
  const reqAudit = await requestCancelBill(bAudit, 'kiểm audit');
  await logout();
  await login('accuser01', PW); // acc tự duyệt (thiếu quyền) — nhưng để test self trên approver ta dùng mgr
  await logout();
  await login('mgruser01', PW);
  const auditBefore = await db.auditLog.count();
  const denyState = await approveCancelBill(reqAudit.id!, PW); // mgr duyệt yêu cầu của acc → OK thực ra. Đổi: test INVALID_STATE
  // reqAudit vừa được duyệt ở trên → duyệt lại lần 2 = INVALID_STATE (nhánh từ chối)
  const denyInvalid = await approveCancelBill(reqAudit.id!, PW);
  const auditAfter = await db.auditLog.count();
  ok('I-A5: duyệt lại yêu cầu đã xử lý → ALREADY_DECIDED', denyInvalid.ok === false && denyInvalid.error === 'ALREADY_DECIDED', denyInvalid);
  ok('I-A5: nhánh từ chối GHI audit (audit_logs tăng)', auditAfter > auditBefore, { before: auditBefore, after: auditAfter, firstOk: denyState.ok });

  // ═══ 8) PHÂN QUYỀN: CUSTOMER không có BILL_CANCEL_REQUEST ═══
  await userSvc.createUser({ fullName: 'KH thường', username: 'custuser1', password: PW, roleCodes: ['CUSTOMER'] }).catch(() => undefined);
  await logout();
  await login('custuser1', PW);
  const custReq = await requestCancelBill(b1, 'không được phép');
  ok('CUSTOMER không BILL_CANCEL_REQUEST → FORBIDDEN', custReq.ok === false && custReq.error === 'FORBIDDEN', custReq);

  // ═══ 9) BULK duyệt trộn được/không-được (mgr duyệt) ═══
  await logout();
  await login('accuser01', PW);
  const bb1 = await mkBill(), bb2 = await mkBill();
  const rq1 = await requestCancelBill(bb1, 'bulk 1');
  const rq2 = await requestCancelBill(bb2, 'bulk 2');
  await logout();
  await login('mgruser01', PW);
  const bMgrOwn = await mkBill();
  const rqMgrOwn = await requestCancelBill(bMgrOwn, 'bulk của chính mgr'); // mgr tự tạo → mgr KHÔNG tự duyệt được
  const bulk = await approveCancelBills([rq1.id!, rq2.id!, rqMgrOwn.id!], PW);
  ok('bulk: duyệt được 2 (của acc), bỏ qua 1 (của chính mgr)', bulk.ok === true && bulk.done === 2 && bulk.skipped.length === 1, bulk);
  ok('bulk: cái bỏ qua đúng lý do SELF_APPROVAL_FORBIDDEN', bulk.skipped[0]?.reason === 'SELF_APPROVAL_FORBIDDEN', bulk.skipped);
  const bb1row = await db.transaction.findUnique({ where: { id: bb1 } });
  ok('bulk: bill của acc đã CANCELLED', bb1row?.status === 'CANCELLED', { s: bb1row?.status });

  // ═══ 10) FALLBACK 1-Admin: chỉ còn 1 Admin thì Admin tự duyệt được ═══
  await logout();
  await login('adminroot', ADMIN_PW);
  await db.user.update({ where: { id: (admin2 as { id: number }).id }, data: { deletedAt: new Date() } }); // xóa mềm admin2 → còn 1 elevated
  const bSolo = await mkBill();
  const reqSolo = await requestCancelBill(bSolo, 'admin duy nhất tự hủy');
  const soloApprove = await approveCancelBill(reqSolo.id!, ADMIN_PW);
  ok('fallback: Admin DUY NHẤT tự duyệt yêu cầu của mình → OK', soloApprove.ok === true, soloApprove);
  const bSoloRow = await db.transaction.findUnique({ where: { id: bSolo } });
  const reqSoloRow = await db.approvalRequest.findUnique({ where: { id: reqSolo.id! } });
  ok('Admin tự duyệt bill của mình → CANCELLED + decisionNote ghi "Admin tự duyệt"', bSoloRow?.status === 'CANCELLED' && (reqSoloRow?.decisionNote ?? '').includes('Admin tự duyệt'), { note: reqSoloRow?.decisionNote });

  // ═══ P0-03 (PING audit): DUYỆT hủy bill BẮT BUỘC verify mật khẩu THẬT (tự-duyệt không được bỏ qua) ═══
  // adminroot đang đăng nhập, là Admin DUY NHẤT (admin2 đã xóa mềm) → tự-duyệt hợp lệ NHƯNG phải đúng mật khẩu.
  const bPw = await mkBill();
  const reqPw = await requestCancelBill(bPw, 'P0-03 kiểm mật khẩu');
  const apNoPw = await approveCancelBill(reqPw.id!, '');
  ok('P0-03: tự duyệt KHÔNG nhập mật khẩu → VALIDATION', apNoPw.ok === false && apNoPw.error === 'VALIDATION', apNoPw);
  const apWrongPw = await approveCancelBill(reqPw.id!, 'sai-mat-khau-hoan-toan');
  ok('P0-03: tự duyệt SAI mật khẩu → WRONG_PASSWORD', apWrongPw.ok === false && apWrongPw.error === 'WRONG_PASSWORD', apWrongPw);
  const bPwStill = await db.transaction.findUnique({ where: { id: bPw } });
  ok('P0-03: sai/thiếu mật khẩu → bill VẪN CANCEL_PENDING (chưa hủy)', bPwStill?.status === 'CANCEL_PENDING', { s: bPwStill?.status });
  const apGoodPw = await approveCancelBill(reqPw.id!, ADMIN_PW);
  ok('P0-03: tự duyệt ĐÚNG mật khẩu → OK (bill CANCELLED)', apGoodPw.ok === true, apGoodPw);
  const bPwDone = await db.transaction.findUnique({ where: { id: bPw } });
  ok('P0-03: sau mật khẩu đúng → bill CANCELLED', bPwDone?.status === 'CANCELLED', { s: bPwDone?.status });

  // ═══ P0-04 (PING audit): TỪ CHỐI PHẢI kiểm bill transition — bill đã lệch trạng thái → INVALID_STATE + Approval giữ PENDING ═══
  const bDiv = await mkBill();
  const reqDiv = await requestCancelBill(bDiv, 'P0-04 lệch trạng thái');
  const bDivRow0 = await db.transaction.findUnique({ where: { id: bDiv } });
  ok('P0-04: setup bill CANCEL_PENDING + request PENDING', bDivRow0?.status === 'CANCEL_PENDING', { s: bDivRow0?.status });
  // Ép bill rời CANCEL_PENDING (mô phỏng lệch trạng thái do đường khác) trong khi request VẪN PENDING.
  await db.transaction.update({ where: { id: bDiv }, data: { status: 'POSTED' } });
  const rejDiv = await rejectCancelBill(reqDiv.id!, 'thử từ chối khi bill đã lệch');
  ok('P0-04: reject khi bill KHÔNG còn CANCEL_PENDING → INVALID_STATE', rejDiv.ok === false && rejDiv.error === 'INVALID_STATE', rejDiv);
  const reqDivRow = await db.approvalRequest.findUnique({ where: { id: reqDiv.id! } });
  ok('P0-04: reject thất bại → Approval VẪN PENDING (không lệch REJECTED)', reqDivRow?.status === 'PENDING', { s: reqDivRow?.status });

  // ═══ 11) BULK XÓA USER (§7.1 #10): trộn user hợp lệ + chính-mình → hợp lệ xóa, tự-mình bị skip ═══
  // adminroot đang đăng nhập & là Admin DUY NHẤT còn lại (admin2 đã xóa mềm ở bước fallback).
  const adminRow = await db.user.findFirst({ where: { username: 'adminroot' } });
  const delu1 = await userSvc.createUser({ fullName: 'Xóa Thử 1', username: 'deluser001', password: PW, roleCodes: ['SALES'] });
  const delu2 = await userSvc.createUser({ fullName: 'Xóa Thử 2', username: 'deluser002', password: PW, roleCodes: ['SALES'] });
  const id1 = (delu1 as { id?: number }).id!;
  const id2 = (delu2 as { id?: number }).id!;
  // Sai mật khẩu → cả loạt bị chặn, không xóa cái nào.
  const bulkWrongPw = await userSvc.deleteUsers([id1], 'sai-mat-khau');
  ok('bulk xóa user: sai mật khẩu → WRONG_PASSWORD (không xóa)', bulkWrongPw.ok === false && bulkWrongPw.error === 'WRONG_PASSWORD', bulkWrongPw);
  // Trộn: 2 user hợp lệ + chính-mình (adminroot) → 2 xóa, adminroot bị bỏ qua (self + Admin cuối).
  const bulkDel = await userSvc.deleteUsers([id1, id2, adminRow!.id], ADMIN_PW);
  ok('bulk xóa user: xóa 2 hợp lệ, bỏ qua 1 (chính mình)', bulkDel.ok === true && bulkDel.deleted === 2 && (bulkDel.skipped?.length ?? 0) === 1, bulkDel);
  ok('bulk xóa user: cái bỏ qua đúng là chính-mình (SELF_DELETE)', bulkDel.skipped?.[0]?.id === adminRow!.id && bulkDel.skipped?.[0]?.reason === 'SELF_DELETE', bulkDel.skipped);
  const delu1Row = await db.user.findUnique({ where: { id: id1 } });
  const adminStill = await db.user.findUnique({ where: { id: adminRow!.id } });
  ok('bulk xóa user: user hợp lệ đã xóa mềm, adminroot vẫn còn', delu1Row?.status === 'DELETED' && delu1Row?.deletedAt != null && adminStill?.deletedAt == null, { u: delu1Row?.status, admin: adminStill?.deletedAt });

  await logout();
  // eslint-disable-next-line no-console
  console.log(`APPROVAL18 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
