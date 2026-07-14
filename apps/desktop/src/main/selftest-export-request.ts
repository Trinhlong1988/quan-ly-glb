// PHASE 1 — Yêu cầu xuất kho POS/TID → Duyệt → đối trừ tồn kho — self-test (headless, GLB_SELFTEST=43).
// MONEY-EXACT: assert doanh thu / quỹ / tồn kho / trạng thái CHÍNH XÁC. Money-model TÁI DÙNG device-sale +
// applyHandover(RENT) + openDeposit — selftest này là "lưới an toàn" chống drift khi duyệt trừ tiền/kho.
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as customerSvc from './customer-service.js';
import * as posSvc from './pos-service.js';
import * as warehouseSvc from './warehouse-service.js';
import * as bankSvc from './bank-config-service.js';
import * as userSvc from './user-service.js';
import * as exportReqSvc from './export-request-service.js';
import type { Db } from '@glb/database';

let failures = 0;
function assert(name: string, cond: boolean, extra?: unknown): void {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  // eslint-disable-next-line no-console
  console.log(`YCXK43 ${status} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';

/** Doanh thu accrual = Σ CashEntry POSTED THU với category affectsPnl=true (VND). */
async function doanhThu(db: Db): Promise<bigint> {
  const cats = await db.cashCategory.findMany({ where: { affectsPnl: true, kind: 'THU', deletedAt: null }, select: { id: true } });
  const ids = cats.map((c) => c.id);
  const agg = await db.cashEntry.aggregate({ where: { status: 'POSTED', kind: 'THU', categoryId: { in: ids }, deletedAt: null }, _sum: { amount: true } });
  return agg._sum.amount ?? 0n;
}
/** Số dư quỹ = Σ THU − Σ CHI theo fundId. */
async function fundBalance(db: Db, fundId: number): Promise<bigint> {
  const thu = await db.cashEntry.aggregate({ where: { status: 'POSTED', kind: 'THU', fundId, deletedAt: null }, _sum: { amount: true } });
  const chi = await db.cashEntry.aggregate({ where: { status: 'POSTED', kind: 'CHI', fundId, deletedAt: null }, _sum: { amount: true } });
  return (thu._sum.amount ?? 0n) - (chi._sum.amount ?? 0n);
}
/** Số máy IN_STOCK trong 1 kho (tồn kho). */
async function stockCount(db: Db, warehouseId: number): Promise<number> {
  return db.posDevice.count({ where: { status: 'IN_STOCK', warehouseId, deletedAt: null } });
}

export async function runExportRequestSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', PW);

  const cust = await customerSvc.createCustomer({ fullName: 'YCXK Khách', nickname: 'YCXK Khách' });
  const fund = await db.fund.create({ data: { code: 'QUYCXK', name: 'Quỹ YCXK', type: 'CASH', openingBalance: 0n } });
  const whMain = await warehouseSvc.createWarehouse({ code: 'YCXKWH', name: 'Kho YCXK', address: 'YCXK · 1 Đại lộ Kho' });
  assert('kho có địa chỉ tạo được', whMain.ok === true, whMain.error);
  const appBank = await bankSvc.createBank({ name: 'NH App YCXK', code: 'NHYCXK43' });
  const appBank2 = await bankSvc.createBank({ name: 'NH App YCXK 2', code: 'NHYCXKB43' });
  const partner = await bankSvc.createPartner({ name: 'Đối tác YCXK', code: 'DTYCXK43' });
  assert('bank/partner test tạo được', appBank.ok === true && appBank2.ok === true && partner.ok === true);

  let sn = 0;
  /** Tạo 1 máy IN_STOCK trong whMain, cài app `bankId`, currentTid null. */
  async function stock(bankId: number): Promise<string> {
    const serial = `YCXK-SN-${++sn}`;
    const c = await posSvc.createPos({ serial, occurredAt: '2026-07-01T09:00:00Z' });
    await posSvc.updatePos(c.id!, { bankId });
    await posSvc.deployPos(serial, { customerId: cust.id!, fromWarehouseId: whMain.id!, occurredAt: '2026-07-02T09:00:00Z' });
    await posSvc.recallPos(serial, { toWarehouseId: whMain.id!, occurredAt: '2026-07-03T09:00:00Z' });
    return serial;
  }
  /** Tạo 1 TID UNASSIGNED (chưa giao) với bank + đối tác. */
  async function mkTid(tid: string, bankId: number, partnerId: number): Promise<void> {
    await db.tid.create({ data: { tid, bankId, partnerId, status: 'UNASSIGNED', openedAt: new Date('2026-06-01T00:00:00Z') } });
  }

  // ══ Ca 1: POS SALE q=3 đơn giá 2tr, thu đủ 6tr → 3 máy SOLD + DT 6tr + quỹ 6tr + tồn −3 ══
  const sA = [await stock(appBank.id!), await stock(appBank.id!), await stock(appBank.id!)];
  const dt0 = await doanhThu(db); const fb0 = await fundBalance(db, fund.id); const tồn0 = await stockCount(db, whMain.id!);
  const reqSale = await exportReqSvc.createExportRequest({ kind: 'POS', handoverKind: 'SALE', bankId: appBank.id!, customerId: cust.id!, unitPrice: 2_000_000, quantity: 3, paidAmount: 6_000_000, fundId: fund.id });
  assert('tạo YCXK POS SALE q=3 ok', reqSale.ok === true, reqSale.error);
  const apSale = await exportReqSvc.approveExportRequest(reqSale.id!, [{ seq: 1, posSerial: sA[0] }, { seq: 2, posSerial: sA[1] }, { seq: 3, posSerial: sA[2] }], PW);
  assert('duyệt POS SALE 3 seri ok', apSale.ok === true, apSale.error);
  const soldAll = await db.posDevice.findMany({ where: { serial: { in: sA } } });
  assert('3 máy → SOLD, khách = người nhận, rời kho', soldAll.every((d) => d.status === 'SOLD' && d.currentCustomerId === cust.id && d.warehouseId === null), { st: soldAll.map((d) => d.status) });
  assert('doanh thu +6tr (accrual đủ giá)', (await doanhThu(db)) - dt0 === 6_000_000n, { delta: Number((await doanhThu(db)) - dt0) });
  assert('quỹ +6tr (thu đủ khi duyệt)', (await fundBalance(db, fund.id)) - fb0 === 6_000_000n);
  assert('tồn kho −3 (3 máy xuất khỏi kho)', (await stockCount(db, whMain.id!)) === tồn0 - 3, { before: tồn0, after: await stockCount(db, whMain.id!) });
  const lines = await db.exportRequestLine.findMany({ where: { exportRequestId: reqSale.id! }, orderBy: { seq: 'asc' } });
  assert('ghi 3 dòng ExportRequestLine đúng seri', lines.length === 3 && lines.map((l) => l.posSerial).join(',') === sA.join(','), { lines: lines.map((l) => l.posSerial) });
  const reReq = await db.exportRequest.findUnique({ where: { id: reqSale.id! } });
  assert('phiếu → APPROVED + decidedBy/At', reReq?.status === 'APPROVED' && reReq?.decidedBy != null && reReq?.decidedAt != null);

  // ══ Ca 2: lines≠qty → lỗi; đã duyệt rồi duyệt lại → INVALID_STATE ══
  const reqBad = await exportReqSvc.createExportRequest({ kind: 'POS', handoverKind: 'SALE', bankId: appBank.id!, customerId: cust.id!, unitPrice: 1_000_000, quantity: 2, paidAmount: 0, fundId: fund.id });
  const apBad = await exportReqSvc.approveExportRequest(reqBad.id!, [{ seq: 1, posSerial: 'X' }], PW);
  assert('duyệt lines≠qty → VALIDATION', apBad.ok === false && apBad.error === 'VALIDATION', { err: apBad.error });
  const apDup = await exportReqSvc.approveExportRequest(reqSale.id!, [{ seq: 1, posSerial: sA[0] }, { seq: 2, posSerial: sA[1] }, { seq: 3, posSerial: sA[2] }], PW);
  assert('duyệt phiếu đã APPROVED → INVALID_STATE', apDup.ok === false && apDup.error === 'INVALID_STATE', { err: apDup.error });
  const cancelBad = await exportReqSvc.cancelExportRequest(reqBad.id!, 'dọn test');
  assert('hủy phiếu chờ duyệt ok → CANCELLED', cancelBad.ok === true, cancelBad.error);

  // ══ Ca 3: seri sai trạng thái (đã giao) / khác app (bank mismatch) → lỗi, ABORT toàn bộ ══
  const snDeployed = `YCXK-SN-DEP`;
  await posSvc.createPos({ serial: snDeployed, occurredAt: '2026-07-01T09:00:00Z' });
  await posSvc.updatePos((await db.posDevice.findUnique({ where: { serial: snDeployed } }))!.id, { bankId: appBank.id! });
  await posSvc.deployPos(snDeployed, { customerId: cust.id!, fromWarehouseId: whMain.id!, occurredAt: '2026-07-02T09:00:00Z' }); // để DEPLOYED (chưa recall)
  const snWrongBank = await stock(appBank2.id!); // IN_STOCK nhưng app khác bank
  const reqErr = await exportReqSvc.createExportRequest({ kind: 'POS', handoverKind: 'SALE', bankId: appBank.id!, customerId: cust.id!, unitPrice: 500_000, quantity: 1, paidAmount: 0, fundId: fund.id });
  const errDeployed = await exportReqSvc.approveExportRequest(reqErr.id!, [{ seq: 1, posSerial: snDeployed }], PW);
  assert('duyệt seri đã giao (không IN_STOCK) → INVALID_STATE', errDeployed.ok === false && errDeployed.error === 'INVALID_STATE', { err: errDeployed.error });
  const errBank = await exportReqSvc.approveExportRequest(reqErr.id!, [{ seq: 1, posSerial: snWrongBank }], PW);
  assert('duyệt seri khác app ngân hàng → BANK_MISMATCH', errBank.ok === false && errBank.error === 'BANK_MISMATCH', { err: errBank.error });
  const reErr = await db.exportRequest.findUnique({ where: { id: reqErr.id! } });
  assert('phiếu lỗi VẪN PENDING (ABORT toàn bộ, không nửa vời)', reErr?.status === 'PENDING');
  await exportReqSvc.rejectExportRequest(reqErr.id!, 'không có máy phù hợp'); // → REJECTED (dùng cho Ca reject luôn)

  // ══ Ca 4: POS RENT q=2 đơn giá 500k → 2 máy DEPLOYED + DT +1tr + quỹ +1tr (không trừ tồn kho vật lý dạng SOLD) ══
  const sR = [await stock(appBank.id!), await stock(appBank.id!)];
  const dt1 = await doanhThu(db); const fb1 = await fundBalance(db, fund.id); const tồn1 = await stockCount(db, whMain.id!);
  const reqRent = await exportReqSvc.createExportRequest({ kind: 'POS', handoverKind: 'RENT', bankId: appBank.id!, customerId: cust.id!, unitPrice: 500_000, quantity: 2, fundId: fund.id });
  assert('tạo YCXK POS RENT q=2 ok', reqRent.ok === true, reqRent.error);
  // wrong-pw trước (WRONG_PASSWORD), rồi duyệt đúng mật khẩu.
  const rentBadPw = await exportReqSvc.approveExportRequest(reqRent.id!, [{ seq: 1, posSerial: sR[0] }, { seq: 2, posSerial: sR[1] }], 'sai-mat-khau');
  assert('duyệt sai mật khẩu → WRONG_PASSWORD', rentBadPw.ok === false && rentBadPw.error === 'WRONG_PASSWORD', { err: rentBadPw.error });
  const apRent = await exportReqSvc.approveExportRequest(reqRent.id!, [{ seq: 1, posSerial: sR[0] }, { seq: 2, posSerial: sR[1] }], PW);
  assert('duyệt POS RENT 2 seri ok', apRent.ok === true, apRent.error);
  const rentDevs = await db.posDevice.findMany({ where: { serial: { in: sR } } });
  assert('2 máy → DEPLOYED, khách = người thuê', rentDevs.every((d) => d.status === 'DEPLOYED' && d.currentCustomerId === cust.id), { st: rentDevs.map((d) => d.status) });
  assert('doanh thu cho thuê +1tr (2 × 500k)', (await doanhThu(db)) - dt1 === 1_000_000n, { delta: Number((await doanhThu(db)) - dt1) });
  assert('quỹ +1tr (thu thuê 1 lần)', (await fundBalance(db, fund.id)) - fb1 === 1_000_000n);
  assert('tồn kho −2 (2 máy rời kho khi giao thuê)', (await stockCount(db, whMain.id!)) === tồn1 - 2);

  // ══ Ca 5: Cọc → DeviceDeposit KHÔNG doanh thu (Bán TID q1 100k CÓ doanh thu 100k; cọc 500k KHÔNG cộng DT) ══
  await mkTid('YCXK-TID-DEP', appBank.id!, partner.id!);
  const dt2 = await doanhThu(db); const fb2 = await fundBalance(db, fund.id);
  const reqDep = await exportReqSvc.createExportRequest({ kind: 'TID', handoverKind: 'SALE', bankId: appBank.id!, partnerId: partner.id!, customerId: cust.id!, unitPrice: 100_000, quantity: 1, depositAmount: 500_000, fundId: fund.id });
  assert('tạo YCXK TID + cọc ok', reqDep.ok === true, reqDep.error);
  const apDep = await exportReqSvc.approveExportRequest(reqDep.id!, [{ seq: 1, tid: 'YCXK-TID-DEP' }], PW);
  assert('duyệt TID + cọc ok', apDep.ok === true, apDep.error);
  const tidDep = await db.tid.findUnique({ where: { tid: 'YCXK-TID-DEP' } });
  assert('TID được giao (deliveredAt set, khách = người nhận)', tidDep?.deliveredAt != null && tidDep?.customerId === cust.id, { del: tidDep?.deliveredAt });
  const depDoc = await db.deviceDeposit.findFirst({ where: { customerId: cust.id!, status: 'OPEN', amount: 500_000n }, orderBy: { id: 'desc' } });
  assert('cọc → DeviceDeposit(OPEN) 500k', depDoc != null && depDoc?.amount === 500_000n, { dep: depDoc?.amount });
  // #2 (Mr.Long "Bán TID có doanh thu"): DT +100k (bán TID) — cọc 500k KHÔNG cộng (nếu cộng thì delta=600k).
  assert('Bán TID +100k DT, cọc KHÔNG cộng doanh thu', (await doanhThu(db)) - dt2 === 100_000n, { delta: Number((await doanhThu(db)) - dt2) });
  assert('quỹ +500k (thu cọc vào quỹ; bán TID paid=0 không vào quỹ)', (await fundBalance(db, fund.id)) - fb2 === 500_000n);

  // ══ Ca 6: BÁN TID riêng q=2 → delivered + doanh thu +200k (#2); sai đối tác → PARTNER_MISMATCH ══
  await mkTid('YCXK-TID-1', appBank.id!, partner.id!);
  await mkTid('YCXK-TID-2', appBank.id!, partner.id!);
  const dt3 = await doanhThu(db);
  const reqTid = await exportReqSvc.createExportRequest({ kind: 'TID', handoverKind: 'SALE', bankId: appBank.id!, partnerId: partner.id!, customerId: cust.id!, unitPrice: 100_000, quantity: 2 });
  assert('tạo YCXK TID q=2 ok', reqTid.ok === true, reqTid.error);
  const apTid = await exportReqSvc.approveExportRequest(reqTid.id!, [{ seq: 1, tid: 'YCXK-TID-1' }, { seq: 2, tid: 'YCXK-TID-2' }], PW);
  assert('duyệt TID q=2 → delivered ok', apTid.ok === true, apTid.error);
  const t1 = await db.tid.findUnique({ where: { tid: 'YCXK-TID-1' } });
  const t2 = await db.tid.findUnique({ where: { tid: 'YCXK-TID-2' } });
  assert('2 TID đã giao (deliveredAt set)', t1?.deliveredAt != null && t2?.deliveredAt != null);
  assert('BÁN TID q=2 → doanh thu +200k (#2)', (await doanhThu(db)) - dt3 === 200_000n, { delta: Number((await doanhThu(db)) - dt3) });
  // sai đối tác
  await mkTid('YCXK-TID-WP', appBank.id!, partner.id!);
  const partner2 = await bankSvc.createPartner({ name: 'Đối tác YCXK 2', code: 'DTYCXK2B' });
  const reqTidWP = await exportReqSvc.createExportRequest({ kind: 'TID', handoverKind: 'SALE', bankId: appBank.id!, partnerId: partner2.id!, customerId: cust.id!, unitPrice: 100_000, quantity: 1 });
  const apTidWP = await exportReqSvc.approveExportRequest(reqTidWP.id!, [{ seq: 1, tid: 'YCXK-TID-WP' }], PW);
  assert('duyệt TID sai đối tác → PARTNER_MISMATCH', apTidWP.ok === false && apTidWP.error === 'PARTNER_MISMATCH', { err: apTidWP.error });
  await exportReqSvc.cancelExportRequest(reqTidWP.id!, 'dọn test');

  // ══ Ca 7: SELF-duyệt bởi người TẠO (không phải Admin) → FORBIDDEN ══
  await userSvc.createUser({ fullName: 'YCXK Kho', phone: '0900000431', email: null, username: 'ycxkwh01', password: 'Pass@1234', roleCodes: ['WAREHOUSE'] });
  await logout();
  await login('ycxkwh01', 'Pass@1234');
  const snWh = `YCXK-SN-WH`;
  // whuser tạo phiếu (có quyền CREATE); dùng máy có sẵn IN_STOCK.
  const reqSelf = await exportReqSvc.createExportRequest({ kind: 'POS', handoverKind: 'SALE', bankId: appBank.id!, customerId: cust.id!, unitPrice: 100_000, quantity: 1, paidAmount: 0, fundId: fund.id });
  assert('WAREHOUSE tạo phiếu ok (quyền CREATE)', reqSelf.ok === true, reqSelf.error);
  const selfAp = await exportReqSvc.approveExportRequest(reqSelf.id!, [{ seq: 1, posSerial: snWh }], 'Pass@1234');
  assert('WAREHOUSE tự duyệt phiếu của mình → SELF_APPROVAL_FORBIDDEN', selfAp.ok === false && selfAp.error === 'SELF_APPROVAL_FORBIDDEN', { err: selfAp.error });
  const selfCancel = await exportReqSvc.cancelExportRequest(reqSelf.id!, 'người tạo tự hủy');
  assert('người tạo tự hủy phiếu mình ok → CANCELLED', selfCancel.ok === true, selfCancel.error);
  await logout();
  await login('adminroot', PW);

  // ══ Ca 8: KPI đúng — KPI khớp đếm thực tế từ danh sách ══
  const listAll = await exportReqSvc.listExportRequests({});
  assert('list + kpi trả về ok', listAll.ok === true && !!listAll.kpi && !!listAll.data, listAll.error);
  const manual = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
  for (const d of listAll.data ?? []) {
    if (d.status === 'PENDING') manual.pending++;
    else if (d.status === 'APPROVED') manual.approved++;
    else if (d.status === 'REJECTED') manual.rejected++;
    else if (d.status === 'CANCELLED') manual.cancelled++;
  }
  const kpi = listAll.kpi!;
  assert('KPI khớp đếm thực tế theo trạng thái', kpi.pending === manual.pending && kpi.approved === manual.approved && kpi.rejected === manual.rejected && kpi.cancelled === manual.cancelled, { kpi, manual });
  assert('KPI total = tổng bản ghi', kpi.total === (listAll.data?.length ?? -1) && kpi.total === manual.pending + manual.approved + manual.rejected + manual.cancelled, { total: kpi.total });
  assert('có ≥4 phiếu APPROVED (SALE+RENT+TID cọc+TID q2)', kpi.approved >= 4, { approved: kpi.approved });
  assert('có ≥1 REJECTED và ≥2 CANCELLED', kpi.rejected >= 1 && kpi.cancelled >= 2, { rejected: kpi.rejected, cancelled: kpi.cancelled });
  // KPI lọc theo kind = TID.
  const listTid = await exportReqSvc.listExportRequests({ kind: 'TID' });
  assert('KPI lọc kind=TID chỉ đếm phiếu TID', (listTid.data ?? []).every((d) => d.kind === 'TID') && listTid.kpi!.total === (listTid.data?.length ?? -1));

  // eslint-disable-next-line no-console
  console.log(`YCXK43 SUMMARY | failures=${failures}`);
  return failures === 0 ? 0 : 1;
}
