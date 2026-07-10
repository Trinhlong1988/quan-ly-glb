// PHASE H2-debt — Thu công nợ nối Transaction (net-of-settlement) self-test (GLB_SELFTEST=27).
// Phủ bất biến spec §4: I#2 thu TỪNG PHẦN → nợ còn lại NET đúng (KHÔNG toàn bộ revenue) + DEBT_OVERPAY;
// settled là HỆ QUẢ (cả 2 side net=0 → true); I#1 quỹ tăng đúng tổng đã thu; I#13 lợi nhuận KHÔNG đổi
// trước/sau thu công nợ (category DEBT_* affectsPnl=false); M3 hủy phiếu → gỡ settlement, nợ tăng lại,
// settled=false, quỹ giảm lại; create THƯỜNG DEBT_* vẫn DEBT_RECEIPT_DEFERRED; SALES FORBIDDEN +
// PERMISSION_DENIED audit; H5 settleTransactions vô hiệu (DEBT_SETTLE_DISABLED, IPC handler đã gỡ).
//
// FIX 3 — RÀNG side ↔ danh mục: SELL ↔ DEBT_CUSTOMER (đối tượng KH), PARTNER ↔ DEBT_PARTNER (đối tượng
//   đối tác). Sai → DEBT_SIDE_CATEGORY_MISMATCH. Phiếu PARTNER dùng danh mục "Công nợ đối tác" + partnerId.
// FIX 5 — CONCURRENCY SELFTEST CLASS (bù lớp bug tuần tự không bắt được):
//   • RACE: 2 phiếu thu PARTNER=X song song cùng GD → đúng 1 thành công + 1 DEBT_OVERPAY, quỹ chỉ +X,
//     Σ settlement(PARTNER) ≤ revenuePartner (KHÔNG over-settle) — chứng minh FOR UPDATE chặn TOCTOU.
//   • Gộp nhiều line cùng side/GD trong 1 phiếu vượt tổng → DEBT_OVERPAY (path addBySide).
//   • Thu nhiều GD trong 1 phiếu (≥2 transactionId) → net + settled từng GD đúng.
//   • side↔category mismatch (FIX 3) → DEBT_SIDE_CATEGORY_MISMATCH.
//   • line amount 0/âm → VALIDATION.
//   • GD bị CANCELLED sau khi có settlement → rớt khỏi công nợ (status filter); settlement KHÔNG tự xóa
//     (chỉ xóa khi hủy PHIẾU thu — M3). Ghi nhận hành vi hiện tại.
import { login, logout, me } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import * as fundSvc from './fund-service.js';
import * as ce from './cash-entry-service.js';
import * as txn from './transaction-service.js';
import { getMonthlyProfit } from './dashboard-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`DEBTRECEIPT ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';

async function auditCount(db: ReturnType<typeof getDb>, action: string): Promise<number> {
  return db.auditLog.count({ where: { action } });
}
/** Σ settlement của 1 GD theo side (đọc trực tiếp DB). */
async function settledSum(db: ReturnType<typeof getDb>, txnId: number, side: string): Promise<number> {
  const agg = await db.cashDebtSettlement.aggregate({ where: { transactionId: txnId, side }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

export async function runDebtReceiptSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', PW);

  // Danh mục công nợ hệ thống (seed H1): THU DEBT_CUSTOMER (SELL) + DEBT_PARTNER (PARTNER), affectsPnl=false.
  const debtCat = await db.cashCategory.findFirst({ where: { isSystem: true, kind: 'THU', sourceKind: 'DEBT_CUSTOMER', deletedAt: null }, select: { id: true, affectsPnl: true } });
  const debtPartnerCat = await db.cashCategory.findFirst({ where: { isSystem: true, kind: 'THU', sourceKind: 'DEBT_PARTNER', deletedAt: null }, select: { id: true, affectsPnl: true } });
  const thuManual = await db.cashCategory.findFirst({ where: { isSystem: true, kind: 'THU', sourceKind: 'MANUAL', deletedAt: null }, select: { id: true } });
  ok('có danh mục THU DEBT_CUSTOMER (affectsPnl=false)', !!debtCat && debtCat.affectsPnl === false, { affectsPnl: debtCat?.affectsPnl });
  ok('có danh mục THU DEBT_PARTNER (affectsPnl=false)', !!debtPartnerCat && debtPartnerCat.affectsPnl === false, { affectsPnl: debtPartnerCat?.affectsPnl });

  // Quỹ nhận tiền thu công nợ (opening 1.000.000).
  const fr = await fundSvc.createFund({ name: 'Quỹ thu công nợ ST27', type: 'CASH', openingBalance: 1_000_000 });
  ok('tạo quỹ → ok', fr.ok === true, fr);
  const fundId = fr.id!;

  // Đối tác + TID (đối tượng nợ side PARTNER) + Khách hàng (đối tượng nợ side SELL) cụ thể của GD.
  const partner = await db.partner.create({ data: { name: 'ĐT Công Nợ 27', code: 'PTNST27_' + Date.now() } });
  const cust = await db.customer.create({ data: { code: 'KHST27_' + Date.now(), fullName: 'KH Công Nợ 27', nickname: 'CN27' } });
  const tid = await db.tid.create({ data: { tid: 'TIDST27_' + Date.now(), partnerId: partner.id, customerId: cust.id, hkdName: 'HKD ST27' } });

  // GD: revenuePartner=P (đối tác), revenueSell=S (KH cụ thể), tháng hiện tại.
  const P = 4_000_000, S = 6_000_000;
  const gd = await db.transaction.create({ data: { code: 'GD_ST27_' + Date.now(), tidId: tid.id, customerId: cust.id, amount: P + S, revenuePartner: P, revenueSell: S, revenueAmount: P + S, txnDate: monthDate(15), status: 'POSTED', settled: false } });
  const flt: txn.TransactionFilter = { customerId: cust.id };

  // ═══════════ Trạng thái ĐẦU: nợ = toàn bộ revenue ═══════════
  const d0 = await txn.debtSummary(flt);
  ok('debtSummary ĐẦU: partner=P, sell=S', d0.ok && d0.data!.debtPartner === P && d0.data!.debtSell === S, d0.data);

  // Baseline lợi nhuận (SAU khi seed Transaction, TRƯỚC thu công nợ) — I#13.
  const base = await getMonthlyProfit();
  const baseProfit = base.data!.current.profit;
  const baseRev = base.data!.current.revenueAccrual;
  const balBase = await fundSvc.fundCurrentBalance(db, fundId);

  // ═══════════ I#2 THU TỪNG PHẦN — thu PARTNER = P/2 (danh mục DEBT_PARTNER + partnerId) ═══════════
  const r1 = await ce.createDebtReceipt({ categoryId: debtPartnerCat!.id, fundId, method: 'CASH', entryDate: dateStr(15), partnerId: partner.id, lines: [{ transactionId: gd.id, side: 'PARTNER', amount: P / 2 }] });
  ok('thu PARTNER = P/2 (DEBT_PARTNER) → ok', r1.ok === true, r1);
  const d1 = await txn.debtSummary(flt);
  ok('I#2 debtSummary sau thu 1 phần: partner = P/2 (KHÔNG phải P), sell = S', d1.ok && d1.data!.debtPartner === P / 2 && d1.data!.debtSell === S, d1.data);
  const open1 = await txn.debtOpenTransactions(flt);
  const g1 = open1.data!.find((x) => x.id === gd.id);
  ok('I#2 GD còn nợ NET: remainingPartner=P/2, remainingSell=S, settled=false', !!g1 && g1.remainingPartner === P / 2 && g1.remainingSell === S && g1.settled === false, g1);
  const gdRow1 = await db.transaction.findUnique({ where: { id: gd.id }, select: { settled: true } });
  ok('settled vẫn false khi chưa thu đủ', gdRow1!.settled === false);
  ok('I#1 quỹ tăng đúng P/2 sau thu 1 phần', (await fundSvc.fundCurrentBalance(db, fundId)) === balBase + P / 2);

  // ═══════════ DEBT_OVERPAY — thu PARTNER vượt còn lại (P/2 + 1) ═══════════
  const over = await ce.createDebtReceipt({ categoryId: debtPartnerCat!.id, fundId, method: 'CASH', entryDate: dateStr(15), partnerId: partner.id, lines: [{ transactionId: gd.id, side: 'PARTNER', amount: P / 2 + 1 }] });
  ok('thu PARTNER vượt còn lại → DEBT_OVERPAY', over.error === 'DEBT_OVERPAY', over);
  ok('OVERPAY KHÔNG cộng quỹ (rollback)', (await fundSvc.fundCurrentBalance(db, fundId)) === balBase + P / 2);

  // ═══════════ Thu nốt PARTNER còn lại (P/2, DEBT_PARTNER) + SELL đủ (S, DEBT_CUSTOMER) → settled=true ═══════════
  const r2p = await ce.createDebtReceipt({ categoryId: debtPartnerCat!.id, fundId, method: 'CK', entryDate: dateStr(15), partnerId: partner.id, lines: [{ transactionId: gd.id, side: 'PARTNER', amount: P / 2 }] });
  ok('thu nốt PARTNER (DEBT_PARTNER) → ok', r2p.ok === true, r2p);
  const gdMid = await db.transaction.findUnique({ where: { id: gd.id }, select: { settled: true } });
  ok('settled vẫn false khi PARTNER đủ nhưng SELL còn nợ', gdMid!.settled === false);
  const r2s = await ce.createDebtReceipt({ categoryId: debtCat!.id, fundId, method: 'CK', entryDate: dateStr(15), customerId: cust.id, lines: [{ transactionId: gd.id, side: 'SELL', amount: S }] });
  ok('thu nốt SELL (DEBT_CUSTOMER) → ok', r2s.ok === true, r2s);
  const d2 = await txn.debtSummary(flt);
  ok('debtSummary sau thu đủ = 0 (count 0, partner 0, sell 0)', d2.ok && d2.data!.count === 0 && d2.data!.debtPartner === 0 && d2.data!.debtSell === 0, d2.data);
  const gdRow2 = await db.transaction.findUnique({ where: { id: gd.id }, select: { settled: true, settledAt: true } });
  ok('settled=true (HỆ QUẢ khi cả 2 side net=0)', gdRow2!.settled === true && gdRow2!.settledAt != null);
  ok('I#1 quỹ = base + P + S (tổng đã thu)', (await fundSvc.fundCurrentBalance(db, fundId)) === balBase + P + S);
  const open2 = await txn.debtOpenTransactions(flt);
  ok('GD đã thu đủ KHÔNG còn trong danh sách công nợ mở', !open2.data!.some((x) => x.id === gd.id));

  // ═══════════ I#13 LỢI NHUẬN KHÔNG ĐỔI trước/sau thu công nợ ═══════════
  const after = await getMonthlyProfit();
  ok('I#13 Δlợi nhuận = 0 (thu công nợ KHÔNG phải doanh thu mới)', after.data!.current.profit - baseProfit === 0, { d: after.data!.current.profit - baseProfit });
  ok('I#13 Δdoanh thu ghi nhận = 0', after.data!.current.revenueAccrual - baseRev === 0, { d: after.data!.current.revenueAccrual - baseRev });

  // ═══════════ HỦY phiếu thu SELL (r2s) → gỡ settlement SELL, nợ SELL tăng lại, settled=false, quỹ giảm ═══════════
  const cancel = await ce.cancelCashEntry(r2s.id!, 'hủy để kiểm hoàn settlement', PW);
  ok('hủy phiếu thu công nợ r2s (đúng mk) → ok', cancel.ok === true, cancel);
  const setlLeft = await db.cashDebtSettlement.count({ where: { cashEntryId: r2s.id! } });
  ok('M3 settlement của r2s đã bị gỡ', setlLeft === 0);
  const d3 = await txn.debtSummary(flt);
  ok('M3 nợ SELL tăng lại: partner = 0, sell = S (PARTNER đã thu đủ)', d3.ok && d3.data!.debtPartner === 0 && d3.data!.debtSell === S, d3.data);
  const gdRow3 = await db.transaction.findUnique({ where: { id: gd.id }, select: { settled: true } });
  ok('M3 settled=false sau hủy (còn nợ SELL > 0)', gdRow3!.settled === false);
  ok('M3 quỹ giảm lại = base + P (chỉ còn PARTNER đã thu)', (await fundSvc.fundCurrentBalance(db, fundId)) === balBase + P);
  ok('hủy lại r2s (đã hủy) → INVALID_STATE', (await ce.cancelCashEntry(r2s.id!, 'x', PW)).error === 'INVALID_STATE');
  ok('settlement của r1 KHÔNG bị đụng (hủy r2s không xóa nhầm)', (await db.cashDebtSettlement.count({ where: { cashEntryId: r1.id! } })) === 1);

  // ═══════════ FIX 3 — side ↔ danh mục mismatch → DEBT_SIDE_CATEGORY_MISMATCH ═══════════
  const mm1 = await ce.createDebtReceipt({ categoryId: debtCat!.id, fundId, method: 'CASH', entryDate: dateStr(15), customerId: cust.id, lines: [{ transactionId: gd.id, side: 'PARTNER', amount: 1000 }] });
  ok('DEBT_CUSTOMER + line PARTNER → DEBT_SIDE_CATEGORY_MISMATCH', mm1.error === 'DEBT_SIDE_CATEGORY_MISMATCH', mm1);
  const mm2 = await ce.createDebtReceipt({ categoryId: debtPartnerCat!.id, fundId, method: 'CASH', entryDate: dateStr(15), partnerId: partner.id, lines: [{ transactionId: gd.id, side: 'SELL', amount: 1000 }] });
  ok('DEBT_PARTNER + line SELL → DEBT_SIDE_CATEGORY_MISMATCH', mm2.error === 'DEBT_SIDE_CATEGORY_MISMATCH', mm2);
  const mm3 = await ce.createDebtReceipt({ categoryId: debtPartnerCat!.id, fundId, method: 'CASH', entryDate: dateStr(15), customerId: cust.id, lines: [{ transactionId: gd.id, side: 'PARTNER', amount: 1000 }] });
  ok('DEBT_PARTNER nhưng thiếu partnerId → DEBT_SIDE_CATEGORY_MISMATCH', mm3.error === 'DEBT_SIDE_CATEGORY_MISMATCH', mm3);

  // ═══════════ FIX 5 — line amount 0 / âm → VALIDATION ═══════════
  const bad0 = await ce.createDebtReceipt({ categoryId: debtCat!.id, fundId, method: 'CASH', entryDate: dateStr(15), customerId: cust.id, lines: [{ transactionId: gd.id, side: 'SELL', amount: 0 }] });
  ok('line amount 0 → VALIDATION', bad0.error === 'VALIDATION', bad0);
  const badNeg = await ce.createDebtReceipt({ categoryId: debtCat!.id, fundId, method: 'CASH', entryDate: dateStr(15), customerId: cust.id, lines: [{ transactionId: gd.id, side: 'SELL', amount: -1 }] });
  ok('line amount âm → VALIDATION', badNeg.error === 'VALIDATION', badNeg);

  // ═══════════ FIX 5 — RACE: 2 phiếu thu PARTNER=X song song cùng GD → 1 ok + 1 DEBT_OVERPAY ═══════════
  // (Chống TOCTOU: KHÔNG có FOR UPDATE thì cả 2 đọc remaining=X → cùng qua check → over-settle 2X.)
  const raceFundRes = await fundSvc.createFund({ name: 'Quỹ RACE ST27', type: 'CASH', openingBalance: 0 });
  const raceFund = raceFundRes.id!;
  const X = 2_000_000;
  const gd2 = await db.transaction.create({ data: { code: 'GD_ST27R_' + Date.now(), tidId: tid.id, customerId: null, amount: X, revenuePartner: X, revenueSell: 0, revenueAmount: X, txnDate: monthDate(15), status: 'POSTED', settled: false } });
  const raceInput = { categoryId: debtPartnerCat!.id, fundId: raceFund, method: 'CASH', entryDate: dateStr(15), partnerId: partner.id, lines: [{ transactionId: gd2.id, side: 'PARTNER', amount: X }] };
  const [rc1, rc2] = await Promise.all([ce.createDebtReceipt({ ...raceInput }), ce.createDebtReceipt({ ...raceInput })]);
  const okCount = [rc1, rc2].filter((r) => r.ok === true).length;
  const overCount = [rc1, rc2].filter((r) => r.error === 'DEBT_OVERPAY').length;
  ok('RACE: đúng 1 phiếu thành công', okCount === 1, { rc1, rc2 });
  ok('RACE: đúng 1 phiếu DEBT_OVERPAY (bị chặn bởi FOR UPDATE)', overCount === 1, { rc1, rc2 });
  ok('RACE: Σ settlement(gd2,PARTNER) = X (KHÔNG over-settle 2X)', (await settledSum(db, gd2.id, 'PARTNER')) === X);
  ok('RACE: Σ settlement ≤ revenuePartner', (await settledSum(db, gd2.id, 'PARTNER')) <= X);
  ok('RACE: quỹ chỉ +X (không +2X)', (await fundSvc.fundCurrentBalance(db, raceFund)) === X);
  ok('RACE: gd2 settled=true (partner net=0, sell=0)', (await db.transaction.findUnique({ where: { id: gd2.id }, select: { settled: true } }))!.settled === true);

  // ═══════════ FIX 5 — Gộp nhiều line cùng side/GD trong 1 phiếu vượt tổng → DEBT_OVERPAY (path addBySide) ═══════════
  const mergeFund = (await fundSvc.createFund({ name: 'Quỹ MERGE ST27', type: 'CASH', openingBalance: 0 })).id!;
  const gd4 = await db.transaction.create({ data: { code: 'GD_ST27M_' + Date.now(), tidId: tid.id, customerId: null, amount: 1_000_000, revenuePartner: 1_000_000, revenueSell: 0, revenueAmount: 1_000_000, txnDate: monthDate(15), status: 'POSTED', settled: false } });
  const merge = await ce.createDebtReceipt({ categoryId: debtPartnerCat!.id, fundId: mergeFund, method: 'CASH', entryDate: dateStr(15), partnerId: partner.id, lines: [{ transactionId: gd4.id, side: 'PARTNER', amount: 600_000 }, { transactionId: gd4.id, side: 'PARTNER', amount: 600_000 }] });
  ok('gộp 2 line PARTNER (600k+600k) > nợ 1tr → DEBT_OVERPAY', merge.error === 'DEBT_OVERPAY', merge);
  ok('MERGE OVERPAY: quỹ không đổi (rollback)', (await fundSvc.fundCurrentBalance(db, mergeFund)) === 0);
  ok('MERGE OVERPAY: không tạo settlement nào cho gd4', (await db.cashDebtSettlement.count({ where: { transactionId: gd4.id } })) === 0);

  // ═══════════ FIX 5 — Thu NHIỀU GD trong 1 phiếu (≥2 transactionId) → net + settled từng GD đúng ═══════════
  const multiFund = (await fundSvc.createFund({ name: 'Quỹ MULTI ST27', type: 'CASH', openingBalance: 0 })).id!;
  const gd3a = await db.transaction.create({ data: { code: 'GD_ST27A_' + Date.now(), tidId: tid.id, customerId: null, amount: 1_000_000, revenuePartner: 1_000_000, revenueSell: 0, revenueAmount: 1_000_000, txnDate: monthDate(15), status: 'POSTED', settled: false } });
  const gd3b = await db.transaction.create({ data: { code: 'GD_ST27B_' + Date.now(), tidId: tid.id, customerId: null, amount: 1_000_000, revenuePartner: 1_000_000, revenueSell: 0, revenueAmount: 1_000_000, txnDate: monthDate(15), status: 'POSTED', settled: false } });
  const multi = await ce.createDebtReceipt({ categoryId: debtPartnerCat!.id, fundId: multiFund, method: 'CASH', entryDate: dateStr(15), partnerId: partner.id, lines: [{ transactionId: gd3a.id, side: 'PARTNER', amount: 1_000_000 }, { transactionId: gd3b.id, side: 'PARTNER', amount: 1_000_000 }] });
  ok('1 phiếu thu 2 GD (mỗi GD 1tr) → ok', multi.ok === true, multi);
  ok('MULTI: quỹ += 2tr (tổng 2 line)', (await fundSvc.fundCurrentBalance(db, multiFund)) === 2_000_000);
  ok('MULTI: gd3a settled=true', (await db.transaction.findUnique({ where: { id: gd3a.id }, select: { settled: true } }))!.settled === true);
  ok('MULTI: gd3b settled=true', (await db.transaction.findUnique({ where: { id: gd3b.id }, select: { settled: true } }))!.settled === true);
  ok('MULTI: settlement gd3a=1tr, gd3b=1tr (net từng GD đúng)', (await settledSum(db, gd3a.id, 'PARTNER')) === 1_000_000 && (await settledSum(db, gd3b.id, 'PARTNER')) === 1_000_000);

  // ═══════════ FIX 5 — GD bị CANCELLED sau khi có settlement → rớt khỏi công nợ; settlement KHÔNG tự xóa ═══════════
  const gd5 = await db.transaction.create({ data: { code: 'GD_ST27C_' + Date.now(), tidId: tid.id, customerId: null, amount: 1_000_000, revenuePartner: 1_000_000, revenueSell: 0, revenueAmount: 1_000_000, txnDate: monthDate(15), status: 'POSTED', settled: false } });
  const r5 = await ce.createDebtReceipt({ categoryId: debtPartnerCat!.id, fundId: multiFund, method: 'CASH', entryDate: dateStr(15), partnerId: partner.id, lines: [{ transactionId: gd5.id, side: 'PARTNER', amount: 400_000 }] });
  ok('thu 1 phần gd5 (400k) → ok', r5.ok === true, r5);
  await db.transaction.update({ where: { id: gd5.id }, data: { status: 'CANCELLED' } });
  const openC = await txn.debtOpenTransactions({ partnerId: partner.id });
  ok('GD CANCELLED rớt khỏi danh sách công nợ mở (status filter)', !openC.data!.some((x) => x.id === gd5.id));
  ok('GD CANCELLED: settlement 400k VẪN còn (chỉ xóa khi hủy PHIẾU — M3), hành vi hiện tại', (await settledSum(db, gd5.id, 'PARTNER')) === 400_000);

  // ═══════════ create THƯỜNG với category DEBT_* vẫn DEBT_RECEIPT_DEFERRED ═══════════
  ok('create thường category DEBT_* → DEBT_RECEIPT_DEFERRED', (await ce.createCashEntry({ kind: 'THU', categoryId: debtCat!.id, fundId, amount: 100_000, method: 'CASH', entryDate: dateStr(15) })).error === 'DEBT_RECEIPT_DEFERRED');
  // Thu công nợ với danh mục KHÔNG phải DEBT_* → VALIDATION.
  ok('createDebtReceipt danh mục non-DEBT → VALIDATION', (await ce.createDebtReceipt({ categoryId: thuManual!.id, fundId, method: 'CASH', entryDate: dateStr(15), customerId: cust.id, lines: [{ transactionId: gd.id, side: 'SELL', amount: 1000 }] })).error === 'VALIDATION');

  // ═══════════ H5 — settleTransactions vô hiệu (toggle tay) ═══════════
  const h5 = await txn.settleTransactions([gd.id], true);
  ok('H5 settleTransactions → DEBT_SETTLE_DISABLED (không toggle tay)', h5.ok === false && h5.error === 'DEBT_SETTLE_DISABLED', h5);

  // ═══════════ SALES FORBIDDEN + PERMISSION_DENIED audit ═══════════
  await userSvc.createUser({ fullName: 'NV Thu CN 27', username: 'debtuser27aaa', password: 'Sales@123456', roleCodes: ['SALES'] }).catch(() => undefined);
  await logout();
  await login('debtuser27aaa', 'Sales@123456');
  const denyBefore = await auditCount(db, 'PERMISSION_DENIED');
  ok('SALES createDebtReceipt → FORBIDDEN', (await ce.createDebtReceipt({ categoryId: debtCat!.id, fundId, method: 'CASH', entryDate: dateStr(15), customerId: cust.id, lines: [{ transactionId: gd.id, side: 'SELL', amount: 1000 }] })).error === 'FORBIDDEN');
  ok('SALES debtOpenTransactions → FORBIDDEN', (await txn.debtOpenTransactions(flt)).error === 'FORBIDDEN');
  ok('audit PERMISSION_DENIED tăng ≥ 1', (await auditCount(db, 'PERMISSION_DENIED')) >= denyBefore + 1);
  await logout();

  // ═══════════ AUDIT thu công nợ ═══════════
  await login('adminroot', PW);
  ok('audit CASH_DEBT_RECEIPT_CREATED ≥ 2', (await auditCount(db, 'CASH_DEBT_RECEIPT_CREATED')) >= 2);
  ok('me() còn phiên admin', me()?.username === 'adminroot');
  await logout();

  // eslint-disable-next-line no-console
  console.log(`DEBTRECEIPT SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}

/** 'YYYY-MM-DD' tháng hiện tại, ngày `d` (local) — cho createDebtReceipt (parse local). */
function dateStr(d: number): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** Date object ngày `d` tháng hiện tại (local) — cho insert Transaction thẳng DB. */
function monthDate(d: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), d);
}
