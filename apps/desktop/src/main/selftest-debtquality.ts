// PHASE H2b — Phân loại chất lượng công nợ + Ghi giảm nợ xấu self-test (GLB_SELFTEST=28).
// Phủ task §8:
//  • classify ghi DebtQualityLog + audit + đổi Transaction.debtQuality; history đúng (mới→cũ).
//  • chặn classify GD thu đủ net (DEBT_FULLY_PAID, KHÔNG dùng cờ settled); quality không hợp lệ → VALIDATION.
//  • debtByQuality tổng net theo mức (GOOD/HARD/BAD/UNCLASSIFIED) khớp.
//  • write-off: BAD + còn nợ → sinh CashEntry CHI "Chi phí nợ xấu" affectsPnl=true = nợ net; GD rớt khỏi
//    công nợ (debtSummary/debtOpen loại writtenOff); lợi nhuận GIẢM đúng số (getMonthlyProfit trước/sau);
//    idempotent (ghi giảm 2 lần → ALREADY_WRITTEN_OFF); sai mật khẩu → WRONG_ACTOR_PASSWORD; non-BAD → NOT_BAD_DEBT;
//    fundId=null (không trừ số dư quỹ nào).
//  • HARDEN QA (FIX 1-4): RACE write-off ⨯ createDebtReceipt(full) cùng GD BAD → ĐÚNG 1 thắng (TXN_WRITTEN_OFF
//    hoặc DEBT_FULLY_PAID), quỹ+lợi nhuận nhất quán (không trừ oan); write-off GD BAD đã thu 1 phần → amount = net
//    còn lại; createDebtReceipt trên GD đã write-off → TXN_WRITTEN_OFF; write-off net=0 → DEBT_FULLY_PAID;
//    cashflowReport LOẠI bút toán fundId=null nhưng getMonthlyProfit VẪN trừ chi phí nợ xấu; đổi affectsPnl
//    danh mục BAD_DEBT (isSystem) → SYSTEM_LOCKED.
//  • SALES FORBIDDEN + PERMISSION_DENIED audit. DB-evolution grant idempotent + whitelist (ACCOUNTANT KHÔNG có DEBT_WRITEOFF).
import { login, logout, me } from './auth-service.js';
import { getDb, grantDebtQualityPermsToExistingRoles } from './db.js';
import * as userSvc from './user-service.js';
import * as fundSvc from './fund-service.js';
import * as ce from './cash-entry-service.js';
import * as txn from './transaction-service.js';
import * as ccat from './cash-category-service.js';
import { getMonthlyProfit } from './dashboard-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`DEBTQUALITY ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';

async function auditCount(db: ReturnType<typeof getDb>, action: string): Promise<number> {
  return db.auditLog.count({ where: { action } });
}
async function roleHasPerm(db: ReturnType<typeof getDb>, roleCode: string, permCode: string): Promise<boolean> {
  const role = await db.role.findUnique({ where: { code: roleCode }, select: { id: true } });
  if (!role) return false;
  const perm = await db.permission.findUnique({ where: { code: permCode }, select: { id: true } });
  if (!perm) return false;
  return !!(await db.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } } }));
}
/** 'YYYY-MM-DD' tháng hiện tại, ngày `d` (local). */
function dateStr(d: number): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function monthDate(d: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), d);
}

export async function runDebtQualitySelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', PW);

  // ═══════════ Danh mục hệ thống "Chi phí nợ xấu" (BAD_DEBT, affectsPnl=true) ═══════════
  const badCat = await db.cashCategory.findFirst({ where: { isSystem: true, kind: 'CHI', sourceKind: 'BAD_DEBT', deletedAt: null }, select: { id: true, affectsPnl: true } });
  ok('có danh mục hệ thống CHI "Chi phí nợ xấu" (BAD_DEBT)', !!badCat, { id: badCat?.id });
  ok('BAD_DEBT affectsPnl=true (là chi phí thật — trừ lợi nhuận)', badCat?.affectsPnl === true);
  const debtPartnerCat = await db.cashCategory.findFirst({ where: { isSystem: true, kind: 'THU', sourceKind: 'DEBT_PARTNER', deletedAt: null }, select: { id: true } });

  // Đối tượng: đối tác + TID + khách.
  const partner = await db.partner.create({ data: { name: 'ĐT Chất Lượng 28', code: 'PTNST28_' + Date.now() } });
  const cust = await db.customer.create({ data: { code: 'KHST28_' + Date.now(), fullName: 'KH Chất Lượng 28', nickname: 'CL28' } });
  const tid = await db.tid.create({ data: { tid: 'TIDST28_' + Date.now(), partnerId: partner.id, customerId: cust.id, hkdName: 'HKD ST28' } });
  const fundId = (await fundSvc.createFund({ name: 'Quỹ ST28', type: 'CASH', openingBalance: 0 })).id!;

  // GD A: revenuePartner=Pa, revenueSell=Sa → dùng để classify (còn nợ).
  const Pa = 3_000_000, Sa = 2_000_000;
  const gdA = await db.transaction.create({ data: { code: 'GD_ST28A_' + Date.now(), tidId: tid.id, customerId: cust.id, amount: Pa + Sa, revenuePartner: Pa, revenueSell: Sa, revenueAmount: Pa + Sa, txnDate: monthDate(10), status: 'POSTED', settled: false } });
  const fltA: txn.TransactionFilter = { customerId: cust.id };

  // ═══════════ CLASSIFY — GD còn nợ: null → HARD (ghi log + audit + đổi debtQuality) ═══════════
  const auditBefore = await auditCount(db, 'DEBT_CLASSIFIED');
  const c1 = await txn.classifyDebt(gdA.id, 'HARD', 'khách hẹn trả chậm');
  ok('classify null→HARD → ok', c1.ok === true, c1);
  ok('Transaction.debtQuality = HARD', (await db.transaction.findUnique({ where: { id: gdA.id }, select: { debtQuality: true } }))!.debtQuality === 'HARD');
  ok('DebtQualityLog +1 (from=null, to=HARD, reason)', (await db.debtQualityLog.count({ where: { transactionId: gdA.id, fromQuality: null, toQuality: 'HARD' } })) === 1);
  ok('audit DEBT_CLASSIFIED +1', (await auditCount(db, 'DEBT_CLASSIFIED')) === auditBefore + 1);

  // Đổi tiếp HARD → BAD (chuẩn bị write-off + kiểm history 2 dòng).
  const c2 = await txn.classifyDebt(gdA.id, 'BAD', 'mất liên lạc');
  ok('classify HARD→BAD → ok', c2.ok === true, c2);
  ok('debtQuality = BAD', (await db.transaction.findUnique({ where: { id: gdA.id }, select: { debtQuality: true } }))!.debtQuality === 'BAD');

  // history: 2 dòng, mới nhất (BAD) trước.
  const hist = await txn.debtQualityHistory(gdA.id);
  ok('history 2 dòng', hist.ok && hist.data!.length === 2, hist.data?.length);
  ok('history[0] = HARD→BAD (mới nhất trước)', hist.data![0].fromQuality === 'HARD' && hist.data![0].toQuality === 'BAD');
  ok('history[1] = null→HARD', hist.data![1].fromQuality === null && hist.data![1].toQuality === 'HARD');
  ok('history có actorName', hist.data![0].actorName != null);

  // quality không hợp lệ → VALIDATION.
  ok('classify quality lạ → VALIDATION', (await txn.classifyDebt(gdA.id, 'MAYBE', 'x')).error === 'VALIDATION');

  // ═══════════ chặn classify GD THU ĐỦ net (DEBT_FULLY_PAID) ═══════════
  // GD B: revenuePartner=Rb, thu đủ qua createDebtReceipt (net=0) → classify chặn.
  const Rb = 1_000_000;
  const gdB = await db.transaction.create({ data: { code: 'GD_ST28B_' + Date.now(), tidId: tid.id, customerId: null, amount: Rb, revenuePartner: Rb, revenueSell: 0, revenueAmount: Rb, txnDate: monthDate(10), status: 'POSTED', settled: false } });
  const payB = await ce.createDebtReceipt({ categoryId: debtPartnerCat!.id, fundId, method: 'CASH', entryDate: dateStr(10), partnerId: partner.id, lines: [{ transactionId: gdB.id, side: 'PARTNER', amount: Rb }] });
  ok('thu đủ GD B → ok', payB.ok === true, payB);
  ok('classify GD thu đủ net → DEBT_FULLY_PAID', (await txn.classifyDebt(gdB.id, 'GOOD')).error === 'DEBT_FULLY_PAID');

  // ═══════════ debtByQuality tổng net theo mức ═══════════
  // GD C: chưa phân loại (UNCLASSIFIED). GD A đã BAD.
  const Pc = 500_000;
  const gdC = await db.transaction.create({ data: { code: 'GD_ST28C_' + Date.now(), tidId: tid.id, customerId: cust.id, amount: Pc, revenuePartner: Pc, revenueSell: 0, revenueAmount: Pc, txnDate: monthDate(10), status: 'POSTED', settled: false } });
  const bq = await txn.debtByQuality(fltA);
  ok('debtByQuality → ok', bq.ok === true, bq.error);
  ok('BAD net = Pa+Sa (GD A còn nguyên nợ)', bq.data!.BAD.debtTotal === Pa + Sa && bq.data!.BAD.count === 1, bq.data!.BAD);
  ok('UNCLASSIFIED net = Pc (GD C)', bq.data!.UNCLASSIFIED.debtTotal === Pc && bq.data!.UNCLASSIFIED.count === 1, bq.data!.UNCLASSIFIED);
  ok('HARD/GOOD net = 0 (không GD nào)', bq.data!.HARD.debtTotal === 0 && bq.data!.GOOD.debtTotal === 0);

  // ═══════════ WRITE-OFF — non-BAD chặn ═══════════
  ok('write-off GD chưa BAD (gdC) → NOT_BAD_DEBT', (await txn.writeOffBadDebt(gdC.id, PW)).error === 'NOT_BAD_DEBT');

  // ═══════════ WRITE-OFF — sai mật khẩu → WRONG_ACTOR_PASSWORD + audit denied ═══════════
  const denyBefore = await auditCount(db, 'DEBT_WRITTEN_OFF');
  ok('write-off sai mật khẩu → WRONG_ACTOR_PASSWORD', (await txn.writeOffBadDebt(gdA.id, 'SAI@123456')).error === 'WRONG_ACTOR_PASSWORD');
  ok('audit DEBT_WRITTEN_OFF (denied) +1', (await auditCount(db, 'DEBT_WRITTEN_OFF')) === denyBefore + 1);
  ok('GD A CHƯA writtenOff sau khi sai mật khẩu', (await db.transaction.findUnique({ where: { id: gdA.id }, select: { writtenOffAt: true } }))!.writtenOffAt === null);

  // ═══════════ WRITE-OFF — BAD + còn nợ → CashEntry CHI = nợ net; GD rớt khỏi công nợ; lợi nhuận GIẢM ═══════════
  const profBefore = (await getMonthlyProfit()).data!.current.profit;
  const balBefore = await fundSvc.fundCurrentBalance(db, fundId);
  const netA = Pa + Sa; // GD A chưa settle → nợ net = toàn bộ revenue
  const wr = await txn.writeOffBadDebt(gdA.id, PW);
  ok('write-off BAD + còn nợ → ok', wr.ok === true, wr);
  const entry = await db.cashEntry.findUnique({ where: { id: wr.id! }, select: { kind: true, categoryId: true, amount: true, fundId: true, sourceType: true, sourceId: true, status: true } });
  ok('sinh CashEntry CHI "Chi phí nợ xấu" đúng danh mục', entry!.kind === 'CHI' && entry!.categoryId === badCat!.id, entry);
  ok('amount = nợ còn lại net (Pa+Sa)', entry!.amount === netA, { amount: entry!.amount, netA });
  ok('fundId = null (bút toán phi tiền mặt)', entry!.fundId === null);
  ok('sourceType=BAD_DEBT + sourceId=GD A', entry!.sourceType === 'BAD_DEBT' && entry!.sourceId === gdA.id);
  ok('Transaction.writtenOffAt/By set', await (async () => { const t = await db.transaction.findUnique({ where: { id: gdA.id }, select: { writtenOffAt: true, writtenOffBy: true } }); return t!.writtenOffAt != null && t!.writtenOffBy != null; })());

  // GD rớt khỏi công nợ (debtSummary + debtOpen loại writtenOff).
  const dSum = await txn.debtSummary(fltA);
  ok('GD A rớt khỏi debtSummary (chỉ còn GD C = Pc)', dSum.ok && dSum.data!.debtTotal === Pc, dSum.data);
  const dOpen = await txn.debtOpenTransactions(fltA);
  ok('GD A rớt khỏi debtOpenTransactions', !dOpen.data!.some((x) => x.id === gdA.id));
  const bq2 = await txn.debtByQuality(fltA);
  ok('debtByQuality: BAD = 0 sau write-off', bq2.data!.BAD.debtTotal === 0 && bq2.data!.BAD.count === 0, bq2.data!.BAD);

  // Lợi nhuận GIẢM đúng nợ net (affectsPnl=true → CHI trừ vào lợi nhuận accrual).
  const profAfter = (await getMonthlyProfit()).data!.current.profit;
  ok('lợi nhuận GIẢM đúng nợ net (Δ = −netA)', profBefore - profAfter === netA, { profBefore, profAfter, netA });
  ok('số dư quỹ KHÔNG đổi (write-off phi tiền mặt, fundId=null)', (await fundSvc.fundCurrentBalance(db, fundId)) === balBefore);
  ok('audit DEBT_WRITTEN_OFF (thành công) +1', (await auditCount(db, 'DEBT_WRITTEN_OFF')) === denyBefore + 2);

  // ═══════════ WRITE-OFF idempotent — ghi giảm lần 2 → ALREADY_WRITTEN_OFF ═══════════
  ok('write-off lần 2 → ALREADY_WRITTEN_OFF', (await txn.writeOffBadDebt(gdA.id, PW)).error === 'ALREADY_WRITTEN_OFF');
  ok('KHÔNG sinh CashEntry BAD_DEBT thứ 2 cho GD A', (await db.cashEntry.count({ where: { sourceType: 'BAD_DEBT', sourceId: gdA.id } })) === 1);

  // classify sau khi đã write-off → chặn (ALREADY_WRITTEN_OFF).
  ok('classify GD đã write-off → ALREADY_WRITTEN_OFF', (await txn.classifyDebt(gdA.id, 'GOOD')).error === 'ALREADY_WRITTEN_OFF');

  // ═══════════ FIX 2 — createDebtReceipt trên GD ĐÃ write-off → TXN_WRITTEN_OFF ═══════════
  const payWO = await ce.createDebtReceipt({ categoryId: debtPartnerCat!.id, fundId, method: 'CASH', entryDate: dateStr(11), partnerId: partner.id, lines: [{ transactionId: gdA.id, side: 'PARTNER', amount: 1 }] });
  ok('createDebtReceipt trên GD đã write-off → TXN_WRITTEN_OFF', payWO.error === 'TXN_WRITTEN_OFF', payWO);

  // ═══════════ FIX 1 — write-off trên GD BAD đã thu MỘT PHẦN → amount = nợ NET còn lại ═══════════
  const Pd = 4_000_000, payPartial = 1_000_000;
  const gdD = await db.transaction.create({ data: { code: 'GD_ST28D_' + Date.now(), tidId: tid.id, customerId: null, amount: Pd, revenuePartner: Pd, revenueSell: 0, revenueAmount: Pd, txnDate: monthDate(10), status: 'POSTED', settled: false } });
  await txn.classifyDebt(gdD.id, 'BAD', 'khó đòi');
  const payD = await ce.createDebtReceipt({ categoryId: debtPartnerCat!.id, fundId, method: 'CASH', entryDate: dateStr(11), partnerId: partner.id, lines: [{ transactionId: gdD.id, side: 'PARTNER', amount: payPartial }] });
  ok('thu MỘT PHẦN GD D (BAD) → ok', payD.ok === true, payD);
  const profBeforeD = (await getMonthlyProfit()).data!.current.profit;
  const wrD = await txn.writeOffBadDebt(gdD.id, PW);
  ok('write-off GD BAD đã thu 1 phần → ok', wrD.ok === true, wrD);
  const entryD = await db.cashEntry.findUnique({ where: { id: wrD.id! }, select: { amount: true } });
  ok('amount write-off = nợ NET còn lại (Pd − payPartial), KHÔNG phải toàn revenue', entryD!.amount === Pd - payPartial, { amount: entryD!.amount, expected: Pd - payPartial });
  ok('lợi nhuận GIẢM đúng net còn lại (Pd − payPartial)', profBeforeD - (await getMonthlyProfit()).data!.current.profit === Pd - payPartial);

  // ═══════════ FIX 1 — write-off khi net=0 (BAD nhưng đã thu đủ) → DEBT_FULLY_PAID ═══════════
  const Pe = 2_000_000;
  const gdE = await db.transaction.create({ data: { code: 'GD_ST28E_' + Date.now(), tidId: tid.id, customerId: null, amount: Pe, revenuePartner: Pe, revenueSell: 0, revenueAmount: Pe, txnDate: monthDate(10), status: 'POSTED', settled: false } });
  await txn.classifyDebt(gdE.id, 'BAD', 'thử net=0'); // classify BAD khi còn nợ
  await ce.createDebtReceipt({ categoryId: debtPartnerCat!.id, fundId, method: 'CASH', entryDate: dateStr(11), partnerId: partner.id, lines: [{ transactionId: gdE.id, side: 'PARTNER', amount: Pe }] }); // thu ĐỦ → net=0
  ok('write-off GD BAD net=0 → DEBT_FULLY_PAID', (await txn.writeOffBadDebt(gdE.id, PW)).error === 'DEBT_FULLY_PAID');
  ok('GD net=0 KHÔNG bị write-off (writtenOffAt null)', (await db.transaction.findUnique({ where: { id: gdE.id }, select: { writtenOffAt: true } }))!.writtenOffAt === null);

  // ═══════════ FIX 1 RACE — write-off ⨯ createDebtReceipt(full) CÙNG GD BAD: đúng 1 thắng ═══════════
  const Pr = 5_000_000;
  const gdR = await db.transaction.create({ data: { code: 'GD_ST28R_' + Date.now(), tidId: tid.id, customerId: null, amount: Pr, revenuePartner: Pr, revenueSell: 0, revenueAmount: Pr, txnDate: monthDate(10), status: 'POSTED', settled: false } });
  await txn.classifyDebt(gdR.id, 'BAD', 'đua tranh chấp');
  const balBeforeR = await fundSvc.fundCurrentBalance(db, fundId);
  const profBeforeR = (await getMonthlyProfit()).data!.current.profit;
  const [rWr, rPay] = await Promise.all([
    txn.writeOffBadDebt(gdR.id, PW),
    ce.createDebtReceipt({ categoryId: debtPartnerCat!.id, fundId, method: 'CASH', entryDate: dateStr(11), partnerId: partner.id, lines: [{ transactionId: gdR.id, side: 'PARTNER', amount: Pr }] })
  ]);
  console.log(`DEBTQUALITY RACE | writeOff=${JSON.stringify({ ok: rWr.ok, error: rWr.error })} receipt=${JSON.stringify({ ok: rPay.ok, error: rPay.error })}`);
  ok('RACE: ĐÚNG 1 thắng (không thể vừa thu vừa ghi giảm)', rWr.ok !== rPay.ok, { writeOff: rWr.ok, receipt: rPay.ok });
  const woCount = await db.cashEntry.count({ where: { sourceType: 'BAD_DEBT', sourceId: gdR.id } });
  const balAfterR = await fundSvc.fundCurrentBalance(db, fundId);
  const profAfterR = (await getMonthlyProfit()).data!.current.profit;
  if (rWr.ok) {
    // write-off thắng: 1 bút toán nợ xấu, quỹ KHÔNG đổi, lợi nhuận GIẢM Pr, phiếu thu báo TXN_WRITTEN_OFF.
    ok('RACE write-off thắng: receipt → TXN_WRITTEN_OFF', rPay.error === 'TXN_WRITTEN_OFF', rPay);
    ok('RACE write-off thắng: 1 bút toán BAD_DEBT', woCount === 1, { woCount });
    ok('RACE write-off thắng: quỹ KHÔNG đổi (phi tiền mặt)', balAfterR === balBeforeR, { balBeforeR, balAfterR });
    ok('RACE write-off thắng: lợi nhuận GIẢM đúng Pr (không trừ oan)', profBeforeR - profAfterR === Pr, { profBeforeR, profAfterR, Pr });
  } else {
    // phiếu thu thắng: quỹ +Pr, KHÔNG bút toán nợ xấu, lợi nhuận KHÔNG đổi, write-off báo DEBT_FULLY_PAID.
    ok('RACE receipt thắng: write-off → DEBT_FULLY_PAID', rWr.error === 'DEBT_FULLY_PAID', rWr);
    ok('RACE receipt thắng: KHÔNG bút toán BAD_DEBT', woCount === 0, { woCount });
    ok('RACE receipt thắng: quỹ +Pr (tiền thực vào)', balAfterR - balBeforeR === Pr, { balBeforeR, balAfterR, Pr });
    ok('RACE receipt thắng: lợi nhuận KHÔNG đổi (không giảm oan)', profAfterR === profBeforeR, { profBeforeR, profAfterR });
  }

  // ═══════════ FIX 3 — cashflowReport LOẠI bút toán write-off (fundId=null); getMonthlyProfit VẪN trừ ═══════════
  const cf = await ce.cashflowReport({});
  ok('cashflowReport → ok', cf.ok === true, cf.error);
  ok('cashflowReport KHÔNG chứa bút toán phi tiền mặt (fundId=null)', !cf.data!.some((d) => d.fundId == null));
  ok('cashflowReport KHÔNG chứa entry write-off gdA', !cf.data!.some((d) => d.id === wr.id));
  // getMonthlyProfit VẪN phản ánh chi phí nợ xấu — đã kiểm ở trên (profit giảm đúng netA / net còn lại).
  ok('getMonthlyProfit VẪN trừ chi phí nợ xấu (accrual, không qua cashflowReport)', (await getMonthlyProfit()).ok === true);

  // ═══════════ FIX 4 — khóa affectsPnl danh mục BAD_DEBT (isSystem) → SYSTEM_LOCKED ═══════════
  ok('đổi affectsPnl BAD_DEBT (isSystem) → SYSTEM_LOCKED', (await ccat.updateCashCategory(badCat!.id, { affectsPnl: false })).error === 'SYSTEM_LOCKED');
  ok('BAD_DEBT affectsPnl vẫn = true sau khi bị chặn', (await db.cashCategory.findUnique({ where: { id: badCat!.id }, select: { affectsPnl: true } }))!.affectsPnl === true);
  ok('cùng giá trị affectsPnl=true (không đổi) → KHÔNG lỗi (no-op hợp lệ)', (await ccat.updateCashCategory(badCat!.id, { affectsPnl: true })).ok === true);

  // ═══════════ "DB tiến hóa" — grant DEBT_CLASSIFY/DEBT_WRITEOFF cho role cũ (idempotent + whitelist) ═══════════
  const clfP = (await db.permission.findMany({ where: { code: { in: ['DEBT_CLASSIFY', 'DEBT_WRITEOFF'] } }, select: { id: true } })).map((p) => p.id);
  for (const rc of ['MANAGER', 'ACCOUNTANT']) {
    const role = await db.role.findUniqueOrThrow({ where: { code: rc }, select: { id: true } });
    await db.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { in: clfP } } });
  }
  ok('mô phỏng DB cũ: MANAGER+ACCOUNTANT KHÔNG có quyền H2b', !(await roleHasPerm(db, 'MANAGER', 'DEBT_CLASSIFY')) && !(await roleHasPerm(db, 'ACCOUNTANT', 'DEBT_CLASSIFY')));
  ok('grantDebtQualityPermsToExistingRoles cấp 3 (MANAGER 2 + ACCOUNTANT 1)', (await grantDebtQualityPermsToExistingRoles(db)) === 3);
  ok('sau grant: MANAGER có DEBT_CLASSIFY + DEBT_WRITEOFF', (await roleHasPerm(db, 'MANAGER', 'DEBT_CLASSIFY')) && (await roleHasPerm(db, 'MANAGER', 'DEBT_WRITEOFF')));
  ok('sau grant: ACCOUNTANT có DEBT_CLASSIFY', await roleHasPerm(db, 'ACCOUNTANT', 'DEBT_CLASSIFY'));
  ok('whitelist: ACCOUNTANT KHÔNG có DEBT_WRITEOFF (quyền cao)', !(await roleHasPerm(db, 'ACCOUNTANT', 'DEBT_WRITEOFF')));
  ok('chạy lại grant = 0 (idempotent)', (await grantDebtQualityPermsToExistingRoles(db)) === 0);

  // ═══════════ SALES FORBIDDEN + PERMISSION_DENIED audit ═══════════
  await userSvc.createUser({ fullName: 'NV Chất Lượng 28', username: 'dquser28aaa', password: 'Sales@123456', roleCodes: ['SALES'] }).catch(() => undefined);
  await logout();
  await login('dquser28aaa', 'Sales@123456');
  const dBefore = await auditCount(db, 'PERMISSION_DENIED');
  ok('SALES classifyDebt → FORBIDDEN', (await txn.classifyDebt(gdC.id, 'GOOD')).error === 'FORBIDDEN');
  ok('SALES writeOffBadDebt → FORBIDDEN', (await txn.writeOffBadDebt(gdC.id, 'Sales@123456')).error === 'FORBIDDEN');
  ok('audit PERMISSION_DENIED tăng ≥ 1', (await auditCount(db, 'PERMISSION_DENIED')) >= dBefore + 1);
  await logout();

  await login('adminroot', PW);
  ok('me() còn phiên admin', me()?.username === 'adminroot');
  await logout();

  // eslint-disable-next-line no-console
  console.log(`DEBTQUALITY SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
