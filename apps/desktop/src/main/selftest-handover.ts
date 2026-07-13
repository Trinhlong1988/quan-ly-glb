// LOẠI GIAO MÁY (Mr.Long) — Bán/Cho thuê/Mượn/Cọc — self-test (headless, GLB_SELFTEST=42).
// MONEY CLASS: assert SỐ chính xác (doanh thu / quỹ / cọc / hoàn cọc) + trạng thái máy theo loại giao.
// Input HỢP LỆ: username ≥8 ký tự, mật khẩu có chữ + số (validator §A).
import { login } from './auth-service.js';
import { getDb } from './db.js';
import * as customerSvc from './customer-service.js';
import * as posSvc from './pos-service.js';
import * as tidSvc from './tid-service.js';
import * as saleSvc from './device-sale-service.js';
import * as warehouseSvc from './warehouse-service.js';
import * as handoverSvc from './handover-service.js';
import * as depositSvc from './deposit-service.js';
import * as bankSvc from './bank-config-service.js';
import * as dashboardSvc from './dashboard-service.js';
import type { Db } from '@glb/database';

let failures = 0;
function assert(name: string, cond: boolean, extra?: unknown): void {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  // eslint-disable-next-line no-console
  console.log(`HANDOVER42 ${status} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';

/** Doanh thu accrual = Σ CashEntry POSTED THU với category affectsPnl=true (VND). */
async function doanhThu(db: Db): Promise<bigint> {
  const cats = await db.cashCategory.findMany({ where: { affectsPnl: true, kind: 'THU', deletedAt: null }, select: { id: true } });
  const ids = cats.map((c) => c.id);
  const agg = await db.cashEntry.aggregate({ where: { status: 'POSTED', kind: 'THU', categoryId: { in: ids }, deletedAt: null }, _sum: { amount: true } });
  return agg._sum.amount ?? 0n;
}
/** Số dư quỹ = Σ THU − Σ CHI theo fundId (POSTED). */
async function fundBalance(db: Db, fundId: number): Promise<bigint> {
  const thu = await db.cashEntry.aggregate({ where: { status: 'POSTED', kind: 'THU', fundId, deletedAt: null }, _sum: { amount: true } });
  const chi = await db.cashEntry.aggregate({ where: { status: 'POSTED', kind: 'CHI', fundId, deletedAt: null }, _sum: { amount: true } });
  return (thu._sum.amount ?? 0n) - (chi._sum.amount ?? 0n);
}
async function monthProfit(): Promise<number> {
  const r = await dashboardSvc.getMonthlyProfit();
  return r.data?.current.profit ?? 0;
}

export async function runHandoverSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', PW);

  const cust = await customerSvc.createCustomer({ fullName: 'HO Khách', nickname: 'HO Khách' });
  const cid = cust.id!;
  const fund = await db.fund.create({ data: { code: 'QUHO', name: 'Quỹ test loại giao', type: 'CASH', openingBalance: 0n } });
  const whMain = await warehouseSvc.createWarehouse({ code: 'HOMAIN', name: 'Kho HO chính', address: 'HO · 1 Phố Giao' });
  const whBack = await warehouseSvc.createWarehouse({ code: 'HOBACK', name: 'Kho HO thu về', address: 'HO · 2 Ngõ Về' });
  // Cài APP (Mr.Long 13/7) — máy gán TID kèm giao (Ca6) phải cài app cùng bank với TID. 1 bank app dùng chung.
  const appBank = await bankSvc.createBank({ name: 'NH App HO', code: 'NHAPHO42' });
  assert('bank app test tạo được', appBank.ok === true, appBank.error);

  // Loại giao builtin (seed): tra theo moneyKind.
  const types = (await handoverSvc.listHandoverTypes()).data ?? [];
  const tRent = types.find((t) => t.moneyKind === 'RENT');
  const tDeposit = types.find((t) => t.moneyKind === 'DEPOSIT');
  const tNone = types.find((t) => t.moneyKind === 'NONE');
  const tSale = types.find((t) => t.moneyKind === 'SALE');
  assert('seed đủ 4 loại giao builtin (SALE/RENT/DEPOSIT/NONE)', !!tRent && !!tDeposit && !!tNone && !!tSale && types.filter((t) => t.isBuiltin).length >= 4, { count: types.length });

  // ══ Ca 1: CHO THUÊ — thu 1 lần lúc giao = DOANH THU (affectsPnl=true, vào lợi nhuận tháng) ══
  const dt0 = await doanhThu(db); const fb0 = await fundBalance(db, fund.id); const pf0 = await monthProfit();
  const nowIso = new Date().toISOString();
  await posSvc.createPos({ serial: 'SN-HO-1' });
  const rent = await posSvc.deployPos('SN-HO-1', { customerId: cid, fromWarehouseId: whMain.id!, handoverTypeId: tRent!.id, handoverAmount: 1_500_000, fundId: fund.id, method: 'CASH', occurredAt: nowIso });
  assert('thuê: deploy ok', rent.ok === true, rent.error);
  const dev1 = await db.posDevice.findUnique({ where: { serial: 'SN-HO-1' } });
  assert('thuê: máy DEPLOYED (vẫn tài sản công ty)', dev1?.status === 'DEPLOYED' && dev1?.currentCustomerId === cid, { st: dev1?.status });
  assert('thuê: doanh thu +1,5tr (affectsPnl=true)', (await doanhThu(db)) - dt0 === 1_500_000n, { delta: Number((await doanhThu(db)) - dt0) });
  assert('thuê: quỹ +1,5tr', (await fundBalance(db, fund.id)) - fb0 === 1_500_000n);
  assert('thuê: lợi nhuận tháng +1,5tr (dashboard accrual)', (await monthProfit()) - pf0 === 1_500_000, { delta: (await monthProfit()) - pf0 });
  const rentEntry = await db.cashEntry.findFirst({ where: { sourceType: 'RENT', status: 'POSTED' }, orderBy: { id: 'desc' } });
  assert('thuê: CashEntry sourceType=RENT đúng số 1,5tr', rentEntry != null && rentEntry.amount === 1_500_000n && rentEntry.kind === 'THU', { amt: Number(rentEntry?.amount) });

  // ══ Ca 2: CỌC — nợ phải trả (KHÔNG doanh thu) + recall hoàn cọc ══
  const dt1 = await doanhThu(db); const fb1 = await fundBalance(db, fund.id);
  await posSvc.createPos({ serial: 'SN-HO-2' });
  const dep = await posSvc.deployPos('SN-HO-2', { customerId: cid, fromWarehouseId: whMain.id!, handoverTypeId: tDeposit!.id, handoverAmount: 2_000_000, fundId: fund.id, method: 'CASH', occurredAt: '2026-06-05T09:00:00Z' });
  assert('cọc: deploy ok', dep.ok === true, dep.error);
  const dev2 = await db.posDevice.findUnique({ where: { serial: 'SN-HO-2' } });
  assert('cọc: máy DEPLOYED (vẫn tài sản công ty)', dev2?.status === 'DEPLOYED', { st: dev2?.status });
  const deposit = await db.deviceDeposit.findFirst({ where: { deviceSerial: 'SN-HO-2', status: 'OPEN' } });
  assert('cọc: DeviceDeposit OPEN đúng 2tr', deposit != null && deposit.amount === 2_000_000n, { amt: Number(deposit?.amount) });
  assert('cọc: KHÔNG cộng doanh thu (affectsPnl=false)', (await doanhThu(db)) - dt1 === 0n, { delta: Number((await doanhThu(db)) - dt1) });
  assert('cọc: quỹ +2tr (nhận tiền cọc)', (await fundBalance(db, fund.id)) - fb1 === 2_000_000n);
  const depEntry = await db.cashEntry.findFirst({ where: { sourceType: 'DEVICE_DEPOSIT', sourceId: deposit!.id, kind: 'THU' } });
  assert('cọc: CashEntry THU DEVICE_DEPOSIT đúng 2tr', depEntry != null && depEntry.amount === 2_000_000n, { amt: Number(depEntry?.amount) });

  // recall (thu máy về) → HOÀN cọc phần còn giữ (2tr) + quỹ giảm về mức trước cọc + deposit REFUNDED
  const rec = await posSvc.recallPos('SN-HO-2', { toWarehouseId: whBack.id!, occurredAt: '2026-06-20T09:00:00Z' });
  assert('cọc: recall ok', rec.ok === true, rec.error);
  const dev2b = await db.posDevice.findUnique({ where: { serial: 'SN-HO-2' } });
  assert('cọc: recall → máy IN_STOCK về kho', dev2b?.status === 'IN_STOCK' && dev2b?.warehouseId === whBack.id, { st: dev2b?.status });
  const deposit2 = await db.deviceDeposit.findUnique({ where: { id: deposit!.id } });
  assert('cọc: deposit → REFUNDED sau recall', deposit2?.status === 'REFUNDED', { st: deposit2?.status });
  const refunds = await db.deviceDepositRefund.findMany({ where: { deviceDepositId: deposit!.id } });
  const refundSum = refunds.reduce((s, r) => s + r.amount, 0n);
  assert('cọc: DeviceDepositRefund = đúng remaining 2tr (1 dòng, không hoàn quá)', refunds.length === 1 && refundSum === 2_000_000n, { count: refunds.length, sum: Number(refundSum) });
  const refundEntry = await db.cashEntry.findFirst({ where: { sourceType: 'DEVICE_DEPOSIT', sourceId: deposit!.id, kind: 'CHI' } });
  assert('cọc: CashEntry CHI DEPOSIT_REFUND đúng 2tr', refundEntry != null && refundEntry.amount === 2_000_000n && refundEntry.fundId === fund.id, { amt: Number(refundEntry?.amount) });
  assert('cọc: quỹ HOÀN về mức trước cọc (net 0)', (await fundBalance(db, fund.id)) - fb1 === 0n, { delta: Number((await fundBalance(db, fund.id)) - fb1) });
  // recall lại (không còn cọc OPEN) → không hoàn thêm (chống hoàn quá). Máy IN_STOCK → deploy rồi recall.
  await posSvc.deployPos('SN-HO-2', { customerId: cid, fromWarehouseId: whBack.id!, occurredAt: '2026-06-21T09:00:00Z' });
  await posSvc.recallPos('SN-HO-2', { toWarehouseId: whBack.id!, occurredAt: '2026-06-22T09:00:00Z' });
  const refunds2 = await db.deviceDepositRefund.findMany({ where: { deviceDepositId: deposit!.id } });
  assert('cọc: recall vòng 2 KHÔNG hoàn thêm (cọc đã REFUNDED)', refunds2.length === 1, { count: refunds2.length });

  // ══ Ca 3: MƯỢN — 0đ, không tiền ══
  const dt2 = await doanhThu(db); const fb2 = await fundBalance(db, fund.id);
  await posSvc.createPos({ serial: 'SN-HO-3' });
  const lend = await posSvc.deployPos('SN-HO-3', { customerId: cid, fromWarehouseId: whMain.id!, handoverTypeId: tNone!.id, handoverAmount: 0, occurredAt: '2026-06-06T09:00:00Z' });
  assert('mượn: deploy 0đ ok', lend.ok === true, lend.error);
  const dev3 = await db.posDevice.findUnique({ where: { serial: 'SN-HO-3' } });
  assert('mượn: máy DEPLOYED, không tiền', dev3?.status === 'DEPLOYED' && (await doanhThu(db)) - dt2 === 0n && (await fundBalance(db, fund.id)) - fb2 === 0n);
  await posSvc.createPos({ serial: 'SN-HO-3B' });
  const lendBad = await posSvc.deployPos('SN-HO-3B', { customerId: cid, fromWarehouseId: whMain.id!, handoverTypeId: tNone!.id, handoverAmount: 500_000, fundId: fund.id, occurredAt: '2026-06-06T09:00:00Z' });
  assert('mượn: amount>0 → VALIDATION (chặn)', lendBad.ok === false && lendBad.error === 'VALIDATION', { err: lendBad.error });
  const dev3b = await db.posDevice.findUnique({ where: { serial: 'SN-HO-3B' } });
  assert('mượn: deploy bị chặn → máy KHÔNG deployed (vẫn IN_STOCK)', dev3b?.status === 'IN_STOCK', { st: dev3b?.status });
  // Không chọn loại giao + amount>0 → VALIDATION
  await posSvc.createPos({ serial: 'SN-HO-3C' });
  const noTypeMoney = await posSvc.deployPos('SN-HO-3C', { customerId: cid, fromWarehouseId: whMain.id!, handoverAmount: 100_000, fundId: fund.id, occurredAt: '2026-06-06T09:00:00Z' });
  assert('không loại giao + tiền>0 → VALIDATION', noTypeMoney.ok === false && noTypeMoney.error === 'VALIDATION', { err: noTypeMoney.error });
  // Không chọn loại giao (mặc định Mượn 0đ) → deploy nội bộ vẫn chạy (tương thích selftest cũ)
  const noType = await posSvc.deployPos('SN-HO-3C', { customerId: cid, fromWarehouseId: whMain.id!, occurredAt: '2026-06-06T10:00:00Z' });
  assert('không loại giao, 0đ → deploy nội bộ OK (tương thích cũ)', noType.ok === true, noType.error);

  // ══ Ca 4: BÁN qua loại giao → CHẶN deploy (dùng luồng Bán), rồi sellPos → SOLD ══
  await posSvc.createPos({ serial: 'SN-HO-4' });
  const saleDeploy = await posSvc.deployPos('SN-HO-4', { customerId: cid, fromWarehouseId: whMain.id!, handoverTypeId: tSale!.id, handoverAmount: 3_000_000, fundId: fund.id, occurredAt: '2026-06-07T09:00:00Z' });
  assert('bán: deploy hình thức Bán → USE_SALE_FLOW (chặn, hướng dùng Bán)', saleDeploy.ok === false && saleDeploy.error === 'USE_SALE_FLOW', { err: saleDeploy.error });
  const dev4a = await db.posDevice.findUnique({ where: { serial: 'SN-HO-4' } });
  assert('bán: máy chưa đổi trạng thái khi bị chặn (IN_STOCK)', dev4a?.status === 'IN_STOCK', { st: dev4a?.status });
  const sell = await saleSvc.sellPos('SN-HO-4', { customerId: cid, salePrice: 3_000_000, paidNow: 3_000_000, fundId: fund.id, method: 'CASH', occurredAt: '2026-06-07T10:00:00Z' }, PW);
  assert('bán: sellPos ok (luồng device-sale)', sell.ok === true, sell.error);
  const dev4 = await db.posDevice.findUnique({ where: { serial: 'SN-HO-4' } });
  assert('bán: máy → SOLD (bán đứt)', dev4?.status === 'SOLD', { st: dev4?.status });

  // ══ Ca 5: builtin lock + tạo/xóa custom ══
  const delBuiltin = await handoverSvc.deleteHandoverTypes([tRent!.id], PW);
  assert('builtin: cấm xóa loại giao mặc định → BUILTIN_LOCKED', delBuiltin.ok === false && delBuiltin.error === 'BUILTIN_LOCKED', { err: delBuiltin.error });
  const chgKind = await handoverSvc.updateHandoverType(tRent!.id, { moneyKind: 'NONE' });
  assert('builtin: cấm đổi moneyKind → BUILTIN_LOCKED', chgKind.ok === false && chgKind.error === 'BUILTIN_LOCKED', { err: chgKind.error });
  const chgName = await handoverSvc.updateHandoverType(tRent!.id, { sortOrder: 9 });
  assert('builtin: đổi sortOrder OK (cho phép)', chgName.ok === true, chgName.error);
  const custom = await handoverSvc.createHandoverType({ name: 'Thuê ngày', moneyKind: 'RENT', sortOrder: 5 });
  assert('custom: tạo loại giao mới OK', custom.ok === true, custom.error);
  const delCustom = await handoverSvc.deleteHandoverTypes([custom.id!], PW);
  assert('custom: xóa loại giao mới OK (không phải builtin)', delCustom.ok === true, delCustom.error);

  // ══ Ca 6: GIAO TID KÈM MÁY — Thuê / Cọc / Bán(chặn) ══
  const dt3 = await doanhThu(db); const fb3 = await fundBalance(db, fund.id);
  const posHo5 = await posSvc.createPos({ serial: 'SN-HO-5' });
  await posSvc.updatePos(posHo5.id!, { bankId: appBank.id! }); // cài app cùng bank với HO-TID-1
  await tidSvc.createTid({ tid: 'HO-TID-1', bank: 'VCB', bankId: appBank.id!, openedAt: '2026-05-01T00:00:00Z' });
  const assignRent = await tidSvc.assignTid('HO-TID-1', { posSerial: 'SN-HO-5', customerId: cid, handoverTypeId: tRent!.id, handoverAmount: 500_000, fundId: fund.id, method: 'CASH', occurredAt: '2026-06-08T09:00:00Z' });
  assert('TID+thuê: assign ok', assignRent.ok === true, assignRent.error);
  const dev5 = await db.posDevice.findUnique({ where: { serial: 'SN-HO-5' } });
  assert('TID+thuê: máy DEPLOYED + gán TID', dev5?.status === 'DEPLOYED' && dev5?.currentTid === 'HO-TID-1');
  assert('TID+thuê: doanh thu +500k', (await doanhThu(db)) - dt3 === 500_000n, { delta: Number((await doanhThu(db)) - dt3) });
  assert('TID+thuê: quỹ +500k', (await fundBalance(db, fund.id)) - fb3 === 500_000n);

  const fb4 = await fundBalance(db, fund.id);
  const posHo6 = await posSvc.createPos({ serial: 'SN-HO-6' });
  await posSvc.updatePos(posHo6.id!, { bankId: appBank.id! }); // cài app cùng bank với HO-TID-2
  await tidSvc.createTid({ tid: 'HO-TID-2', bank: 'VCB', bankId: appBank.id!, openedAt: '2026-05-01T00:00:00Z' });
  const assignDep = await tidSvc.assignTid('HO-TID-2', { posSerial: 'SN-HO-6', customerId: cid, handoverTypeId: tDeposit!.id, handoverAmount: 700_000, fundId: fund.id, method: 'CASH', occurredAt: '2026-06-09T09:00:00Z' });
  assert('TID+cọc: assign ok', assignDep.ok === true, assignDep.error);
  const dep6 = await db.deviceDeposit.findFirst({ where: { deviceSerial: 'SN-HO-6', tid: 'HO-TID-2', status: 'OPEN' } });
  assert('TID+cọc: DeviceDeposit OPEN gắn máy+TID đúng 700k', dep6 != null && dep6.amount === 700_000n, { amt: Number(dep6?.amount) });
  assert('TID+cọc: quỹ +700k', (await fundBalance(db, fund.id)) - fb4 === 700_000n);

  const posHo7 = await posSvc.createPos({ serial: 'SN-HO-7' });
  await posSvc.updatePos(posHo7.id!, { bankId: appBank.id! }); // cài app bankX để chạm đúng USE_SALE_FLOW (không phải MACHINE_BLANK)
  await tidSvc.createTid({ tid: 'HO-TID-3', bank: 'VCB', bankId: appBank.id!, openedAt: '2026-05-01T00:00:00Z' });
  const assignSale = await tidSvc.assignTid('HO-TID-3', { posSerial: 'SN-HO-7', customerId: cid, handoverTypeId: tSale!.id, handoverAmount: 100_000, fundId: fund.id, occurredAt: '2026-06-10T09:00:00Z' });
  assert('TID+bán: assign hình thức Bán → USE_SALE_FLOW (chặn)', assignSale.ok === false && assignSale.error === 'USE_SALE_FLOW', { err: assignSale.error });

  // ══ Ca 7: báo cáo cọc đang giữ + doanh thu theo loại giao ══
  const held = await depositSvc.depositsHeld(cid);
  const heldRow = (held.data ?? []).find((r) => r.customerId === cid);
  assert('báo cáo: cọc đang giữ khách = 700k (SN-HO-6 còn OPEN; SN-HO-2 đã hoàn)', heldRow?.remaining === 700_000, { heldRow });
  const rev = await depositSvc.revenueByHandoverType({});
  const revRent = (rev.data ?? []).find((r) => r.moneyKind === 'RENT');
  const revSale = (rev.data ?? []).find((r) => r.moneyKind === 'SALE');
  assert('báo cáo: doanh thu Cho thuê = 1,5tr + 500k = 2tr', revRent?.revenue === 2_000_000, { revRent });
  assert('báo cáo: doanh thu Bán ≥ 3tr (SN-HO-4)', (revSale?.revenue ?? 0) >= 3_000_000, { revSale });

  // eslint-disable-next-line no-console
  console.log(`HANDOVER42 SUMMARY | failures=${failures}`);
  return failures === 0 ? 0 : 1;
}
