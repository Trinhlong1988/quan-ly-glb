// #3/#6 Bán máy/TID + công nợ mua thiết bị + hủy khách — self-test (headless, GLB_SELFTEST=41).
// MONEY CLASS: assert SỐ chính xác (doanh thu / quỹ / công nợ) theo POS_SALE_DEBT_SPEC §1.
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as customerSvc from './customer-service.js';
import * as posSvc from './pos-service.js';
import * as tidSvc from './tid-service.js';
import * as saleSvc from './device-sale-service.js';
import * as warehouseSvc from './warehouse-service.js';
import * as userSvc from './user-service.js';
import type { Db } from '@glb/database';

let failures = 0;
function assert(name: string, cond: boolean, extra?: unknown): void {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  // eslint-disable-next-line no-console
  console.log(`DEVSALE41 ${status} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';

/** Doanh thu accrual = Σ CashEntry POSTED THU với category affectsPnl=true (VND). */
async function doanhThu(db: Db): Promise<bigint> {
  const cats = await db.cashCategory.findMany({ where: { affectsPnl: true, kind: 'THU', deletedAt: null }, select: { id: true } });
  const ids = cats.map((c) => c.id);
  const agg = await db.cashEntry.aggregate({ where: { status: 'POSTED', kind: 'THU', categoryId: { in: ids }, deletedAt: null }, _sum: { amount: true } });
  return agg._sum.amount ?? 0n;
}
/** Số dư quỹ = Σ THU − Σ CHI theo fundId (opening 0 trong test). */
async function fundBalance(db: Db, fundId: number): Promise<bigint> {
  const thu = await db.cashEntry.aggregate({ where: { status: 'POSTED', kind: 'THU', fundId, deletedAt: null }, _sum: { amount: true } });
  const chi = await db.cashEntry.aggregate({ where: { status: 'POSTED', kind: 'CHI', fundId, deletedAt: null }, _sum: { amount: true } });
  return (thu._sum.amount ?? 0n) - (chi._sum.amount ?? 0n);
}

export async function runDeviceSaleSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', PW);

  const buyer = await customerSvc.createCustomer({ fullName: 'DS Khách Mua', nickname: 'DS Khách Mua' });
  const buyer2 = await customerSvc.createCustomer({ fullName: 'DS Khách 2', nickname: 'DS Khách 2' });
  const fund = await db.fund.create({ data: { code: 'QUDS', name: 'Quỹ test bán', type: 'CASH', openingBalance: 0n } });

  // ══ Ca 1: BÁN MÁY THU ĐỦ NGAY (giá 2tr, thu 2tr) ══
  const dt0 = await doanhThu(db); const fb0 = await fundBalance(db, fund.id);
  await posSvc.createPos({ serial: 'SN-DS-1', occurredAt: '2026-06-01T09:00:00Z' });
  const s1 = await saleSvc.sellPos('SN-DS-1', { customerId: buyer.id!, salePrice: 2_000_000, paidNow: 2_000_000, fundId: fund.id, method: 'CASH', occurredAt: '2026-06-02T09:00:00Z' }, PW);
  assert('bán máy thu đủ ok', s1.ok === true, s1.error);
  const dev1 = await db.posDevice.findUnique({ where: { serial: 'SN-DS-1' } });
  assert('máy → SOLD, khách = người mua', dev1?.status === 'SOLD' && dev1?.currentCustomerId === buyer.id, { st: dev1?.status });
  assert('doanh thu +2tr sau bán đủ', (await doanhThu(db)) - dt0 === 2_000_000n, { delta: Number((await doanhThu(db)) - dt0) });
  assert('quỹ +2tr sau bán đủ', (await fundBalance(db, fund.id)) - fb0 === 2_000_000n);
  const sales1 = await saleSvc.listDeviceSales({ customerId: buyer.id! });
  const sale1 = (sales1.data ?? []).find((x) => x.deviceSerial === 'SN-DS-1');
  assert('chứng từ bán: remaining = 0 (thu đủ)', sale1?.remaining === 0 && sale1?.salePrice === 2_000_000, { sale1 });

  // ══ Ca 2: BÁN CHỊU HOÀN TOÀN (giá 3tr, thu 0) ══
  const dt1 = await doanhThu(db); const fb1 = await fundBalance(db, fund.id);
  await posSvc.createPos({ serial: 'SN-DS-2', occurredAt: '2026-06-01T09:00:00Z' });
  const s2 = await saleSvc.sellPos('SN-DS-2', { customerId: buyer2.id!, salePrice: 3_000_000, paidNow: 0, occurredAt: '2026-06-03T09:00:00Z' }, PW);
  assert('bán chịu (thu 0) ok', s2.ok === true, s2.error);
  assert('doanh thu +3tr NGAY dù chưa thu (⓵A accrual)', (await doanhThu(db)) - dt1 === 3_000_000n, { delta: Number((await doanhThu(db)) - dt1) });
  assert('quỹ KHÔNG đổi khi bán chịu (fundId=null)', (await fundBalance(db, fund.id)) - fb1 === 0n);
  const rec2 = await saleSvc.customerDeviceReceivables();
  const r2 = (rec2.data ?? []).find((x) => x.customerId === buyer2.id);
  assert('công nợ mua thiết bị khách2 = 3tr', r2?.remaining === 3_000_000, { r2 });

  // ══ Ca 3: THU 1 PHẦN (giá 2tr, thu 500k) → còn nợ 1,5tr ══
  const dt2 = await doanhThu(db); const fb2 = await fundBalance(db, fund.id);
  await posSvc.createPos({ serial: 'SN-DS-3', occurredAt: '2026-06-01T09:00:00Z' });
  const s3 = await saleSvc.sellPos('SN-DS-3', { customerId: buyer.id!, salePrice: 2_000_000, paidNow: 500_000, fundId: fund.id, method: 'CK', occurredAt: '2026-06-04T09:00:00Z' }, PW);
  assert('bán thu 1 phần ok', s3.ok === true, s3.error);
  assert('doanh thu +2tr (đủ giá, dù thu 500k)', (await doanhThu(db)) - dt2 === 2_000_000n);
  assert('quỹ +500k (phần đã thu)', (await fundBalance(db, fund.id)) - fb2 === 500_000n);
  const sale3 = (await saleSvc.listDeviceSales({ customerId: buyer.id!, onlyDebt: true })).data?.find((x) => x.deviceSerial === 'SN-DS-3');
  assert('chứng từ bán #3: còn nợ 1,5tr', sale3?.remaining === 1_500_000, { sale3 });

  // ══ Ca 4: THU THÊM (thu 1tr → còn 500k; thu 600k → vượt; thu 500k → hết) ══
  const c1 = await saleSvc.collectDeviceSaleDebt({ deviceSaleId: sale3!.id, amount: 1_000_000, fundId: fund.id, method: 'CASH' });
  assert('thu thêm 1tr ok', c1.ok === true, c1.error);
  const over = await saleSvc.collectDeviceSaleDebt({ deviceSaleId: sale3!.id, amount: 600_000, fundId: fund.id });
  assert('thu vượt công nợ còn lại → chặn', over.ok === false && over.error === 'VALIDATION', { err: over.error });
  const c2 = await saleSvc.collectDeviceSaleDebt({ deviceSaleId: sale3!.id, amount: 500_000, fundId: fund.id });
  assert('thu nốt 500k ok', c2.ok === true, c2.error);
  const sale3b = (await saleSvc.listDeviceSales({ customerId: buyer.id! })).data?.find((x) => x.id === sale3!.id);
  assert('chứng từ #3 hết nợ (remaining 0)', sale3b?.remaining === 0, { sale3b });
  const over2 = await saleSvc.collectDeviceSaleDebt({ deviceSaleId: sale3!.id, amount: 1000, fundId: fund.id });
  assert('thu khi đã đủ → ALREADY_SETTLED', over2.ok === false && over2.error === 'ALREADY_SETTLED', { err: over2.error });
  assert('thu nợ KHÔNG cộng doanh thu (SALE_COLLECT affectsPnl=false)', (await doanhThu(db)) - dt2 === 2_000_000n, { note: 'vẫn 2tr sau khi thu thêm 1,5tr' });

  // ══ Ca 5: BÁN MÁY KÈM TID ══
  await posSvc.createPos({ serial: 'SN-DS-4', occurredAt: '2026-06-01T09:00:00Z' });
  await posSvc.deployPos('SN-DS-4', { customerId: buyer.id!, occurredAt: '2026-06-02T09:00:00Z' });
  await tidSvc.createTid({ tid: 'DS-TID-1', bank: 'VCB', openedAt: '2026-05-01T00:00:00Z' });
  await tidSvc.assignTid('DS-TID-1', { posSerial: 'SN-DS-4', customerId: buyer.id!, occurredAt: '2026-06-03T09:00:00Z' });
  const s5 = await saleSvc.sellPos('SN-DS-4', { customerId: buyer2.id!, salePrice: 5_000_000, paidNow: 5_000_000, fundId: fund.id, method: 'CASH', occurredAt: '2026-06-05T09:00:00Z' }, PW);
  assert('bán máy kèm TID ok', s5.ok === true, s5.error);
  const tid1 = await db.tid.findUnique({ where: { tid: 'DS-TID-1' } });
  assert('TID bán kèm → SOLD, rời máy (posSerial null), sang khách mua', tid1?.status === 'SOLD' && tid1?.posSerial === null && tid1?.customerId === buyer2.id, { tid1 });
  const openBind = await db.posTidBinding.count({ where: { tid: 'DS-TID-1', unboundAt: null } });
  assert('binding TID đã đóng khi bán kèm', openBind === 0, { openBind });
  const dev4 = await db.posDevice.findUnique({ where: { serial: 'SN-DS-4' } });
  assert('máy SN-DS-4 → SOLD, currentTid null', dev4?.status === 'SOLD' && dev4?.currentTid === null);

  // ══ Ca 6: BÁN TID RIÊNG ══
  await tidSvc.createTid({ tid: 'DS-TID-2', bank: 'VCB', openedAt: '2026-05-01T00:00:00Z' });
  const s6 = await saleSvc.sellTid('DS-TID-2', { customerId: buyer.id!, salePrice: 800_000, paidNow: 800_000, fundId: fund.id, method: 'CASH', occurredAt: '2026-06-06T09:00:00Z' }, PW);
  assert('bán TID riêng ok', s6.ok === true, s6.error);
  const tid2 = await db.tid.findUnique({ where: { tid: 'DS-TID-2' } });
  assert('TID bán riêng → SOLD, sang khách mua', tid2?.status === 'SOLD' && tid2?.customerId === buyer.id);
  // TID đang trên máy → bán TID riêng bị chặn
  await posSvc.createPos({ serial: 'SN-DS-5', occurredAt: '2026-06-01T09:00:00Z' });
  await tidSvc.createTid({ tid: 'DS-TID-3', bank: 'VCB', openedAt: '2026-05-01T00:00:00Z' });
  await tidSvc.assignTid('DS-TID-3', { posSerial: 'SN-DS-5', customerId: buyer.id!, occurredAt: '2026-06-03T09:00:00Z' });
  const s6b = await saleSvc.sellTid('DS-TID-3', { customerId: buyer.id!, salePrice: 100_000, paidNow: 0, occurredAt: '2026-06-06T09:00:00Z' }, PW);
  assert('bán TID đang trên máy riêng lẻ → chặn TID_ON_DEVICE', s6b.ok === false && s6b.error === 'TID_ON_DEVICE', { err: s6b.error });

  // ══ Ca 7: HỦY KHÁCH GIỮ MÁY ══
  await posSvc.createPos({ serial: 'SN-DS-6', occurredAt: '2026-06-01T09:00:00Z' });
  await posSvc.deployPos('SN-DS-6', { customerId: buyer.id!, occurredAt: '2026-06-02T09:00:00Z' });
  const cc = await posSvc.cancelCustomerPos('SN-DS-6', { occurredAt: '2026-06-07T09:00:00Z', note: 'khách nghỉ' });
  assert('hủy khách ok', cc.ok === true, cc.error);
  const dev6 = await db.posDevice.findUnique({ where: { serial: 'SN-DS-6' } });
  assert('hủy khách: máy VẪN DEPLOYED + GIỮ khách (để thu về) + recallPending=true', dev6?.status === 'DEPLOYED' && dev6?.currentCustomerId === buyer.id && dev6?.recallPending === true, { dev6: { st: dev6?.status, cust: dev6?.currentCustomerId, rp: dev6?.recallPending } });
  // hủy khách máy chưa có khách → VALIDATION
  await posSvc.createPos({ serial: 'SN-DS-7', occurredAt: '2026-06-01T09:00:00Z' });
  const ccNo = await posSvc.cancelCustomerPos('SN-DS-7', { occurredAt: '2026-06-07T09:00:00Z' });
  assert('hủy khách máy chưa gán khách → VALIDATION', ccNo.ok === false && ccNo.error === 'VALIDATION', { err: ccNo.error });
  // thu hồi → recallPending false
  await posSvc.recallPos('SN-DS-6', { occurredAt: '2026-06-08T09:00:00Z' });
  const dev6b = await db.posDevice.findUnique({ where: { serial: 'SN-DS-6' } });
  assert('thu hồi máy → recallPending=false, về IN_STOCK', dev6b?.recallPending === false && dev6b?.status === 'IN_STOCK');

  // ══ Ca 8: QUYỀN + mật khẩu ══
  const badPw = await saleSvc.sellPos('SN-DS-7', { customerId: buyer.id!, salePrice: 1_000_000, paidNow: 0, occurredAt: '2026-06-09T09:00:00Z' }, 'sai-mk');
  assert('bán sai mật khẩu → WRONG_PASSWORD', badPw.ok === false && badPw.error === 'WRONG_PASSWORD', { err: badPw.error });
  await userSvc.createUser({ fullName: 'DS Sales', phone: '0900000941', email: null, username: 'dssales01', password: 'Pass@1234', roleCodes: ['SALES'] });
  await logout();
  await login('dssales01', 'Pass@1234');
  const salesSell = await saleSvc.sellPos('SN-DS-7', { customerId: buyer.id!, salePrice: 1_000_000, paidNow: 0, occurredAt: '2026-06-09T09:00:00Z' }, 'Pass@1234');
  assert('SALES không có DEVICE_SALE_MANAGE → FORBIDDEN', salesSell.ok === false && salesSell.error === 'FORBIDDEN', { err: salesSell.error });
  await logout();
  await login('adminroot', PW);

  // ── Model 1: bán máy XÓA kho vật lý + ghi kho xuất = kho đang chứa (đồng bộ) ──
  const whS = await warehouseSvc.createWarehouse({ code: 'DSK1', name: 'Kho DS' });
  assert('kho test tạo được', whS.ok === true, whS.error);
  await posSvc.createPos({ serial: 'SN-DS-8', occurredAt: '2026-06-01T09:00:00Z' });
  await posSvc.deployPos('SN-DS-8', { customerId: buyer.id!, occurredAt: '2026-06-02T09:00:00Z' });
  await posSvc.recallPos('SN-DS-8', { toWarehouseId: whS.id!, occurredAt: '2026-06-03T09:00:00Z' }); // vào kho DSK1
  const dev8Before = await db.posDevice.findUnique({ where: { serial: 'SN-DS-8' } });
  assert('trước bán: máy trong kho DSK1 (IN_STOCK)', dev8Before?.warehouseId === whS.id && dev8Before?.status === 'IN_STOCK', { wh: dev8Before?.warehouseId, s: dev8Before?.status });
  const s8 = await saleSvc.sellPos('SN-DS-8', { customerId: buyer.id!, salePrice: 1_000_000, paidNow: 0, occurredAt: '2026-06-10T09:00:00Z' }, PW);
  assert('bán máy trong kho ok', s8.ok === true, s8);
  const dev8 = await db.posDevice.findUnique({ where: { serial: 'SN-DS-8' } });
  assert('bán máy → warehouseId null (rời kho, giữ bất biến)', dev8?.warehouseId == null && dev8?.status === 'SOLD', { wh: dev8?.warehouseId, s: dev8?.status });
  const sale8 = await db.deviceSale.findFirst({ where: { deviceSerial: 'SN-DS-8' } });
  assert('đơn bán ghi kho xuất = kho đang chứa DSK1 (đồng bộ, không cần chọn tay)', sale8?.warehouseId === whS.id, { got: sale8?.warehouseId, want: whS.id });

  // eslint-disable-next-line no-console
  console.log(`DEVSALE41 SUMMARY | failures=${failures}`);
  return failures === 0 ? 0 : 1;
}
