// G10.5 — STRESS-RACE TƯƠNG TRANH THẬT trên PostgreSQL (GLB_SELFTEST=20).
// Chứng minh guard G10.C đứng vững dưới N client GHI ĐỒNG THỜI (Promise.all), đếm bằng DB thật.
//
// KHÁC selftest 21 (=deterministic guard, gọi tuần tự): ở đây N lời gọi chạy ĐỒNG THỜI:
//  • (a)/(b)/(d) approval: N=10 gọi song song trên PrismaClient TOÀN CỤC — mỗi interactive
//    `$transaction` chiếm 1 kết nối trong pool pg → race THẬT ở tầng Postgres (row-lock +
//    conditional `updateMany`). Đây là guard code THẬT (approval-service.ts), không mô phỏng lại.
//  • (c) code_counter: N=20 PrismaClient RIÊNG BIỆT (mỗi cái 1 kết nối pg độc lập) cùng gọi
//    `nextCode()` → 20 writer thật hammer 1 dòng counter. Đây là kiểm HIGH-E đúng bản chất
//    "nhiều .exe client nối chung 1 DB", + integration qua createCustomer/createUser.
//
// Đo bằng SELECT count/distinct trên DB (KHÔNG tin giá trị trả về đơn lẻ). Guard THUA phải:
//   approve/reject: đúng 1 win, N-1 nhận ALREADY_DECIDED/INVALID_STATE; audit+notify+bill CHỈ 1 lần.
//   request: đúng 1 tạo request + set CANCEL_PENDING; N-1 INVALID_STATE; đúng 1 ApprovalRequest.
//   code: mã KH/NV KHÔNG trùng (distinct = N); không P2002/crash.
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import { createPrisma, type Db } from '@glb/database';
import { nextCode } from './code-service.js';
import * as userSvc from './user-service.js';
import { createCustomer } from './customer-service.js';
import { createTransaction } from './transaction-service.js';
import { requestCancelBill, approveCancelBill, rejectCancelBill } from './approval-service.js';

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++;
  else fail++;
  // eslint-disable-next-line no-console
  console.log(`CONC20 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const ADMIN_PW = 'Admin@123456';
const PW = 'User@123456';

interface MRes {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

async function runConcurrencyCases(): Promise<number> {
  const db = getDb();
  const dbUrl = process.env['GLB_DB_URL'];
  if (!dbUrl) {
    // eslint-disable-next-line no-console
    console.error('CONC20 ABORT | thiếu GLB_DB_URL (cần Postgres throwaway) để tạo nhiều PrismaClient riêng.');
    return 2;
  }
  await login('adminroot', ADMIN_PW);

  // ═══ SETUP: phí + tid + user (acc = nhân viên tạo yêu cầu, mgr = duyệt) ═══
  const bank = await db.bank.create({ data: { name: 'NH Conc', code: 'C20BANK' } });
  const card = await db.cardType.create({ data: { name: 'Thẻ Conc', code: 'C20ND', bankId: bank.id } });
  const partner = await db.partner.create({ data: { name: 'Đối tác Conc', code: 'C20P' } });
  await db.partnerBank.create({ data: { partnerId: partner.id, bankId: bank.id } });
  const feeType = await db.feeType.create({ data: { name: 'Loại phí Conc' } });
  await db.feeRate.create({
    data: { partnerId: partner.id, cardTypeId: card.id, phiMua: 3000, phiCaiMay: 1000, effectiveFrom: new Date('1970-01-01T00:00:00.000Z') }
  });
  await db.feeSellQuote.create({
    data: { partnerId: partner.id, cardTypeId: card.id, feeTypeId: feeType.id, phiBan: 2500, effectiveFrom: new Date('1970-01-01T00:00:00.000Z') }
  });
  const cust = await db.customer.create({ data: { code: 'KHC20', fullName: 'Khách Conc', nickname: 'KC20' } });
  const tid = await db.tid.create({ data: { tid: 'TIDC20', mid: 'MIDC20', hkdName: 'HKD Conc', bankId: bank.id, partnerId: partner.id, customerId: cust.id } });

  const acc = (await userSvc.createUser({ fullName: 'Kế Toán Conc', username: 'conc20acc', password: PW, roleCodes: ['ACCOUNTANT'] })) as MRes;
  const mgr = (await userSvc.createUser({ fullName: 'Quản Lý Conc', username: 'conc20mgr', password: PW, roleCodes: ['MANAGER'] })) as MRes;
  const accId = acc.id!;
  ok('setup: tạo user acc + mgr', !!accId && !!mgr.id, { acc, mgr });

  const mkBill = async (): Promise<number> => {
    const c = await createTransaction({ tidId: tid.id, cardTypeId: card.id, feeTypeId: feeType.id, amount: 10_000_000, txnDate: '2026-07-01T00:00:00.000Z' });
    if (!c.ok || !c.id) throw new Error('mkBill thất bại: ' + JSON.stringify(c));
    return c.id;
  };
  const distinct = (xs: (string | undefined)[]): number => new Set(xs.filter((x) => x !== undefined)).size;

  // ════════════════════════════════════════════════════════════════════════════
  // (a) N=10 client cùng approveCancelBill 1 ApprovalRequest → đúng 1 win / 9 reject.
  //     bill CANCELLED đúng 1 lần; audit + notify đúng 1 bản.
  // ════════════════════════════════════════════════════════════════════════════
  const N = 10;
  {
    await logout();
    await login('conc20acc', PW);
    const billId = await mkBill();
    const req = (await requestCancelBill(billId, 'yêu cầu hủy để test duyệt song song')) as MRes;
    ok('(a) setup: tạo yêu cầu hủy → CANCEL_PENDING', req.ok === true, req);
    const reqId = req.id!;

    await logout();
    await login('conc20mgr', PW); // me() = mgr cho cả N lời gọi song song
    const results = (await Promise.all(Array.from({ length: N }, () => approveCancelBill(reqId, PW)))) as MRes[];
    const wins = results.filter((r) => r.ok).length;
    const already = results.filter((r) => !r.ok && r.error === 'ALREADY_DECIDED').length;
    const other = results.filter((r) => !r.ok && r.error !== 'ALREADY_DECIDED');
    console.log(`CONC20 CASE(a) | approve: ${wins} win / ${already} ALREADY_DECIDED / ${other.length} khác (N=${N})`);
    ok('(a) đúng 1 win, 9 ALREADY_DECIDED (không double-process)', wins === 1 && already === N - 1, { wins, already, other });

    const billCancelledCount = await db.transaction.count({ where: { id: billId, status: 'CANCELLED' } });
    ok('(a) DB: bill CANCELLED đúng 1', billCancelledCount === 1, { billCancelledCount });
    const reqApprovedCount = await db.approvalRequest.count({ where: { id: reqId, status: 'APPROVED' } });
    ok('(a) DB: ApprovalRequest APPROVED đúng 1', reqApprovedCount === 1, { reqApprovedCount });
    const auditCount = await db.auditLog.count({ where: { action: 'BILL_CANCEL_APPROVED', targetType: 'Transaction', targetId: String(billId) } });
    ok('(a) DB: audit BILL_CANCEL_APPROVED đúng 1 bản', auditCount === 1, { auditCount });
    const notifyCount = await db.message.count({ where: { recipientId: accId, category: 'BILL_CANCEL_APPROVED', kind: 'SYSTEM', senderId: null } });
    ok('(a) DB: notify người tạo đúng 1 bản', notifyCount === 1, { notifyCount });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // (b) N=10 client cùng requestCancelBill 1 bill POSTED → đúng 1 tạo request + CANCEL_PENDING;
  //     9 INVALID_STATE; chỉ 1 ApprovalRequest tồn tại cho bill đó.
  // ════════════════════════════════════════════════════════════════════════════
  {
    await logout();
    await login('conc20acc', PW);
    const billId = await mkBill();
    const results = (await Promise.all(Array.from({ length: N }, (_v, i) => requestCancelBill(billId, `đề nghị hủy song song #${i}`)))) as MRes[];
    const wins = results.filter((r) => r.ok).length;
    const invalid = results.filter((r) => !r.ok && r.error === 'INVALID_STATE').length;
    const other = results.filter((r) => !r.ok && r.error !== 'INVALID_STATE');
    console.log(`CONC20 CASE(b) | request: ${wins} win / ${invalid} INVALID_STATE / ${other.length} khác (N=${N})`);
    ok('(b) đúng 1 win, 9 INVALID_STATE (không tạo request thừa)', wins === 1 && invalid === N - 1, { wins, invalid, other });

    const reqCount = await db.approvalRequest.count({ where: { entityType: 'Transaction', entityId: billId } });
    ok('(b) DB: CHỈ 1 ApprovalRequest tồn tại cho bill', reqCount === 1, { reqCount });
    const pendingBill = await db.transaction.count({ where: { id: billId, status: 'CANCEL_PENDING' } });
    ok('(b) DB: bill sang CANCEL_PENDING đúng 1', pendingBill === 1, { pendingBill });
    const auditReq = await db.auditLog.count({ where: { action: 'BILL_CANCEL_REQUESTED', targetType: 'Transaction', targetId: String(billId) } });
    ok('(b) DB: audit BILL_CANCEL_REQUESTED đúng 1 bản', auditReq === 1, { auditReq });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // (d) N=10 client cùng rejectCancelBill 1 ApprovalRequest → đúng 1 win / 9 INVALID_STATE;
  //     bill HOÀN về POSTED; audit + notify đúng 1 bản (đối xứng (a)).
  // ════════════════════════════════════════════════════════════════════════════
  {
    await logout();
    await login('conc20acc', PW);
    const billId = await mkBill();
    const req = (await requestCancelBill(billId, 'yêu cầu hủy để test từ chối song song')) as MRes;
    ok('(d) setup: tạo yêu cầu hủy → CANCEL_PENDING', req.ok === true, req);
    const reqId = req.id!;

    await logout();
    await login('conc20mgr', PW);
    const results = (await Promise.all(Array.from({ length: N }, () => rejectCancelBill(reqId, 'từ chối song song')))) as MRes[];
    const wins = results.filter((r) => r.ok).length;
    const invalid = results.filter((r) => !r.ok && r.error === 'INVALID_STATE').length;
    const other = results.filter((r) => !r.ok && r.error !== 'INVALID_STATE');
    console.log(`CONC20 CASE(d) | reject: ${wins} win / ${invalid} INVALID_STATE / ${other.length} khác (N=${N})`);
    ok('(d) đúng 1 win, 9 INVALID_STATE (không double-reject)', wins === 1 && invalid === N - 1, { wins, invalid, other });

    const reqRejected = await db.approvalRequest.count({ where: { id: reqId, status: 'REJECTED' } });
    ok('(d) DB: ApprovalRequest REJECTED đúng 1', reqRejected === 1, { reqRejected });
    const billPosted = await db.transaction.count({ where: { id: billId, status: 'POSTED' } });
    ok('(d) DB: bill hoàn về POSTED đúng 1', billPosted === 1, { billPosted });
    const auditRej = await db.auditLog.count({ where: { action: 'BILL_CANCEL_REJECTED', targetType: 'Transaction', targetId: String(billId) } });
    ok('(d) DB: audit BILL_CANCEL_REJECTED đúng 1 bản', auditRej === 1, { auditRej });
    const notifyRej = await db.message.count({ where: { recipientId: accId, category: 'BILL_CANCEL_REJECTED', kind: 'SYSTEM', senderId: null } });
    ok('(d) DB: notify người tạo (từ chối) đúng 1 bản', notifyRej === 1, { notifyRej });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // (c) MÃ KH/NV KHÔNG TRÙNG dưới N=20 writer ĐỒNG THỜI.
  //   (c1) 20 PrismaClient RIÊNG BIỆT cùng nextCode('KH') — counter KH CHƯA tồn tại lúc này
  //        → test insert-đầu (HIGH-E): mọi client phải distinct, KHÔNG P2002.
  //   (c2) 20 PrismaClient RIÊNG BIỆT cùng nextCode('NV') — counter NV đã tồn tại (seed backfill)
  //        → test increment-branch atomic.
  //   (c3) 20 createCustomer đồng thời (integration qua service) → 20 mã KH distinct, 0 lỗi.
  //   (c4) 20 createUser đồng thời (integration qua service) → 20 mã NV distinct, 0 lỗi.
  // ════════════════════════════════════════════════════════════════════════════
  const M = 20;
  {
    // — (c1)/(c2): N=20 kết nối pg ĐỘC LẬP hammer nextCode. Đây là điểm race gắt nhất. —
    const makeClients = (): Db[] => Array.from({ length: M }, () => createPrisma(dbUrl));

    // (c1) KH — insert-đầu tương tranh (counter chưa có).
    const khCounterBefore = await db.codeCounter.findUnique({ where: { prefix: 'KH' } });
    const clientsKh = makeClients();
    let khCodes: string[] = [];
    let khP2002 = 0;
    let khOtherErr = 0;
    try {
      const settled = await Promise.allSettled(clientsKh.map((c) => nextCode('KH', c)));
      for (const s of settled) {
        if (s.status === 'fulfilled') khCodes.push(s.value);
        else {
          const code = (s.reason as { code?: string })?.code;
          if (code === 'P2002') khP2002++;
          else khOtherErr++;
        }
      }
    } finally {
      await Promise.all(clientsKh.map((c) => c.$disconnect().catch(() => {})));
    }
    const khDistinct = distinct(khCodes);
    console.log(`CONC20 CASE(c1) | KH insert-đầu: fulfilled=${khCodes.length} distinct=${khDistinct} P2002=${khP2002} otherErr=${khOtherErr} (counterBefore=${khCounterBefore ? 'CÓ' : 'CHƯA CÓ'})`);
    ok('(c1) 20 nextCode(KH) song song: distinct=20, 0 P2002, 0 lỗi', khDistinct === M && khCodes.length === M && khP2002 === 0 && khOtherErr === 0, { khDistinct, fulfilled: khCodes.length, khP2002, khOtherErr });

    // (c2) NV — increment-branch tương tranh (counter đã có sẵn).
    const clientsNv = makeClients();
    let nvCodes: string[] = [];
    let nvP2002 = 0;
    let nvOtherErr = 0;
    try {
      const settled = await Promise.allSettled(clientsNv.map((c) => nextCode('NV', c)));
      for (const s of settled) {
        if (s.status === 'fulfilled') nvCodes.push(s.value);
        else {
          const code = (s.reason as { code?: string })?.code;
          if (code === 'P2002') nvP2002++;
          else nvOtherErr++;
        }
      }
    } finally {
      await Promise.all(clientsNv.map((c) => c.$disconnect().catch(() => {})));
    }
    const nvDistinct = distinct(nvCodes);
    console.log(`CONC20 CASE(c2) | NV increment: fulfilled=${nvCodes.length} distinct=${nvDistinct} P2002=${nvP2002} otherErr=${nvOtherErr}`);
    ok('(c2) 20 nextCode(NV) song song: distinct=20, 0 P2002, 0 lỗi', nvDistinct === M && nvCodes.length === M && nvP2002 === 0 && nvOtherErr === 0, { nvDistinct, fulfilled: nvCodes.length, nvP2002, nvOtherErr });
  }

  {
    // (c3) integration: 20 createCustomer đồng thời (adminroot) → 20 mã KH distinct, 0 lỗi.
    await logout();
    await login('adminroot', ADMIN_PW);
    const results = (await Promise.all(
      Array.from({ length: M }, (_v, i) => createCustomer({ fullName: `KH Song Song ${i}`, nickname: `ss${i}` }))
    )) as MRes[];
    const okCount = results.filter((r) => r.ok).length;
    const errs = results.filter((r) => !r.ok);
    const ids = results.filter((r) => r.ok && r.id).map((r) => r.id!);
    const rows = await db.customer.findMany({ where: { id: { in: ids } }, select: { code: true } });
    const codeDistinct = distinct(rows.map((r) => r.code));
    console.log(`CONC20 CASE(c3) | createCustomer: ok=${okCount}/${M} mãKH distinct=${codeDistinct}/${ids.length} errs=${errs.length}`);
    ok('(c3) 20 createCustomer song song: tất cả ok', okCount === M, { okCount, errs });
    ok('(c3) DB: 20 mã KH distinct (không trùng)', codeDistinct === M && rows.length === M, { codeDistinct, rows: rows.length });
  }

  {
    // (c4) integration: 20 createUser đồng thời (adminroot) → 20 mã NV distinct, 0 lỗi/P2002.
    const results = (await Promise.all(
      Array.from({ length: M }, (_v, i) => userSvc.createUser({ fullName: `NV Song Song ${i}`, username: `conc20user${i}`, password: PW, roleCodes: ['ACCOUNTANT'] }))
    )) as MRes[];
    const okCount = results.filter((r) => r.ok).length;
    const errs = results.filter((r) => !r.ok);
    const ids = results.filter((r) => r.ok && r.id).map((r) => r.id!);
    const rows = await db.user.findMany({ where: { id: { in: ids } }, select: { employeeCode: true } });
    const codeDistinct = distinct(rows.map((r) => r.employeeCode ?? undefined));
    console.log(`CONC20 CASE(c4) | createUser: ok=${okCount}/${M} mãNV distinct=${codeDistinct}/${ids.length} errs=${errs.length}`);
    ok('(c4) 20 createUser song song: tất cả ok (0 P2002)', okCount === M, { okCount, errs });
    ok('(c4) DB: 20 mã NV distinct (không trùng)', codeDistinct === M && rows.length === M, { codeDistinct, rows: rows.length });
  }

  await logout();
  // eslint-disable-next-line no-console
  console.log(`CONC20 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}

/**
 * Vỏ AN TOÀN: setup/case NÉM (vd createUser fail → login fail → NOT_AUTHENTICATED) KHÔNG được
 * trở thành unhandled rejection (electron treo, không in SUMMARY). Mọi ngoại lệ → ghi FAIL +
 * LUÔN in SUMMARY + trả exit≠0 để harness thấy rõ. (CMD_AUDIT 10/7: cấm unhandled rejection.)
 */
export async function runConcurrencySelfTest(): Promise<number> {
  try {
    return await runConcurrencyCases();
  } catch (e) {
    fail++;
    // eslint-disable-next-line no-console
    console.log('CONC20 FAIL | ngoại lệ runtime (setup/case ném) | ' + ((e as Error)?.stack || String(e)));
    // eslint-disable-next-line no-console
    console.log(`CONC20 SUMMARY | pass=${pass} fail=${fail}`);
    return 1;
  }
}
