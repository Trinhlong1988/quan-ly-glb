// PHASE H2-core — Thu–Chi: Quỹ + Phiếu thu/chi + lợi nhuận accrual self-test (GLB_SELFTEST=26).
// Phủ bất biến spec §4: I#1 quỹ cân (+hủy cập nhật số dư) · I#3 người chi bắt buộc · I#4 tiền>0
// nguyên không tràn · I#10 ngày local không nhảy tháng · category sai kind / công nợ chặn
// (DEBT_RECEIPT_DEFERRED) · I#13 lợi nhuận KHÔNG double-count · mã QU/PT/PC unique+đúng prefix ·
// xóa quỹ đang dùng → IN_USE · hủy sai/đúng mật khẩu · SALES FORBIDDEN + audit · "DB tiến hóa"
// quyền FUND_*/CASHENTRY_* cho MANAGER/ACCOUNTANT cũ (idempotent).
import { hasPermission } from '@glb/shared';
import { login, logout, me } from './auth-service.js';
import { getDb, grantCashflowPermsToExistingRoles } from './db.js';
import * as userSvc from './user-service.js';
import * as fundSvc from './fund-service.js';
import * as ce from './cash-entry-service.js';
import { getMonthlyProfit } from './dashboard-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`CASHENTRY ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';
const CASHFLOW_PERMS = ['FUND_VIEW', 'FUND_CREATE', 'FUND_UPDATE', 'FUND_DELETE', 'CASHENTRY_VIEW', 'CASHENTRY_CREATE', 'CASHENTRY_CANCEL'];

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

export async function runCashEntrySelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', PW);

  // Danh mục hệ thống (seed H1): THU MANUAL affectsPnl=true, CHI MANUAL affectsPnl=true, THU DEBT_CUSTOMER affectsPnl=false.
  const thuCat = await db.cashCategory.findFirst({ where: { isSystem: true, kind: 'THU', sourceKind: 'MANUAL', deletedAt: null }, select: { id: true, affectsPnl: true } });
  const chiCat = await db.cashCategory.findFirst({ where: { isSystem: true, kind: 'CHI', sourceKind: 'MANUAL', deletedAt: null }, select: { id: true, affectsPnl: true } });
  const debtCat = await db.cashCategory.findFirst({ where: { isSystem: true, kind: 'THU', sourceKind: 'DEBT_CUSTOMER', deletedAt: null }, select: { id: true, affectsPnl: true } });
  ok('có danh mục THU/CHI/DEBT hệ thống', !!thuCat && !!chiCat && !!debtCat, { thu: thuCat?.affectsPnl, chi: chiCat?.affectsPnl, debt: debtCat?.affectsPnl });
  ok('THU/CHI MANUAL affectsPnl=true, DEBT affectsPnl=false', thuCat?.affectsPnl === true && chiCat?.affectsPnl === true && debtCat?.affectsPnl === false);

  // User NV để làm người chi / người giữ quỹ (username ≥8 ký tự, riêng cho selftest 26).
  await userSvc.createUser({ fullName: 'NV Thu Chi 26', username: 'cashuser26aaa', password: 'Sales@123456', roleCodes: ['SALES'] }).catch(() => undefined);
  const payer = await db.user.findUnique({ where: { username: 'cashuser26aaa' }, select: { id: true } });
  ok('tạo user NV người chi', !!payer);
  const payerId = payer!.id;

  // ═══════════ MÃ QUỸ QU## (không throw + prefix) ═══════════
  const f1r = await fundSvc.createFund({ name: 'Quỹ tiền mặt ST26', type: 'CASH', keeperUserId: payerId, openingBalance: 1_000_000 });
  ok('tạo quỹ F1 (opening 1.000.000) → ok', f1r.ok === true, f1r);
  const f2r = await fundSvc.createFund({ name: 'Quỹ VCB ST26', type: 'BANK', openingBalance: 0 });
  ok('tạo quỹ F2 → ok', f2r.ok === true, f2r);
  const f1 = await db.fund.findUnique({ where: { id: f1r.id! }, select: { code: true } });
  const f2 = await db.fund.findUnique({ where: { id: f2r.id! }, select: { code: true } });
  ok('mã quỹ F1 đúng prefix QU', !!f1?.code && f1.code.startsWith('QU'), f1?.code);
  ok('mã quỹ F1 ≠ F2 (unique)', !!f1?.code && !!f2?.code && f1.code !== f2.code, { f1: f1?.code, f2: f2?.code });

  // ═══════════ I#1 QUỸ CÂN ═══════════
  const t1 = await ce.createCashEntry({ kind: 'THU', categoryId: thuCat!.id, fundId: f1r.id!, amount: 500_000, method: 'CASH', entryDate: dateStr(15) });
  const t2 = await ce.createCashEntry({ kind: 'THU', categoryId: thuCat!.id, fundId: f1r.id!, amount: 300_000, method: 'CK', entryDate: dateStr(15) });
  const c1 = await ce.createCashEntry({ kind: 'CHI', categoryId: chiCat!.id, fundId: f1r.id!, amount: 200_000, method: 'CASH', entryDate: dateStr(15), payerUserId: payerId });
  ok('lập 2 phiếu THU + 1 phiếu CHI → ok', t1.ok && t2.ok && c1.ok, { t1, t2, c1 });
  ok('I#1 số dư quỹ = 1.000.000 + 800.000 − 200.000 = 1.600.000', (await fundSvc.fundCurrentBalance(db, f1r.id!)) === 1_600_000);
  // Mã phiếu prefix.
  const t1row = await db.cashEntry.findUnique({ where: { id: t1.id! }, select: { code: true } });
  const c1row = await db.cashEntry.findUnique({ where: { id: c1.id! }, select: { code: true } });
  ok('mã phiếu THU đúng prefix PT', !!t1row?.code && t1row.code.startsWith('PT'), t1row?.code);
  ok('mã phiếu CHI đúng prefix PC', !!c1row?.code && c1row.code.startsWith('PC'), c1row?.code);

  // ═══════════ HỦY PHIẾU (sai/đúng mật khẩu) + số dư cập nhật ═══════════
  ok('SAI hủy phiếu sai mật khẩu → WRONG_PASSWORD', (await ce.cancelCashEntry(t2.id!, 'nhầm', 'sai-mk')).error === 'WRONG_PASSWORD');
  const cancelBefore = await auditCount(db, 'CASH_ENTRY_CANCELLED');
  ok('hủy phiếu THU 300.000 (đúng mk) → ok', (await ce.cancelCashEntry(t2.id!, 'ghi nhầm số tiền', PW)).ok === true);
  ok('audit CASH_ENTRY_CANCELLED tăng', (await auditCount(db, 'CASH_ENTRY_CANCELLED')) >= cancelBefore + 1);
  ok('I#1 sau hủy: số dư = 1.300.000 (phiếu CANCELLED không tính)', (await fundSvc.fundCurrentBalance(db, f1r.id!)) === 1_300_000);

  // ═══════════ REGRESSION (audit 15/7) — CHẶN hủy TRỰC TIẾP phiếu sinh từ nghiệp vụ khác ═══════════
  // Bug: cancelCashEntry không xét sourceType → hủy phiếu THU cọc (DEVICE_DEPOSIT) làm quỹ lệch tiền
  // thật + mồ côi DeviceDeposit. Fix = chỉ cho hủy sourceType null | SALE_COLLECT. Test mô phỏng phiếu
  // hệ thống bằng insert thẳng (createCashEntry không set sourceType), rồi khẳng định hủy bị chặn.
  const sysCode = `PT-DEP-ST26-${payerId}`;
  const sysEntry = await db.cashEntry.create({
    data: { code: sysCode, kind: 'THU', categoryId: thuCat!.id, fundId: f1r.id!, amount: 250_000, method: 'CASH', entryDate: new Date(dateStr(15)), sourceType: 'DEVICE_DEPOSIT', sourceId: 999999, status: 'POSTED', createdBy: payerId }
  });
  ok('phiếu hệ thống POSTED tính vào quỹ → 1.550.000', (await fundSvc.fundCurrentBalance(db, f1r.id!)) === 1_550_000);
  const lockRes = await ce.cancelCashEntry(sysEntry.id, 'thử hủy phiếu cọc', PW);
  ok('CHẶN hủy phiếu DEVICE_DEPOSIT → SOURCE_LOCKED', lockRes.error === 'SOURCE_LOCKED', lockRes);
  const sysAfter = await db.cashEntry.findUnique({ where: { id: sysEntry.id }, select: { status: true } });
  ok('phiếu hệ thống VẪN POSTED sau khi bị chặn', sysAfter?.status === 'POSTED', sysAfter);
  ok('quỹ KHÔNG đổi sau khi chặn = 1.550.000', (await fundSvc.fundCurrentBalance(db, f1r.id!)) === 1_550_000);
  // Dọn để không lệch các phép so số dư phía sau (đưa về CANCELLED thủ công qua DB, không qua service).
  await db.cashEntry.update({ where: { id: sysEntry.id }, data: { status: 'CANCELLED', cancelReason: 'dọn test' } });
  ok('sau dọn: số dư về 1.300.000', (await fundSvc.fundCurrentBalance(db, f1r.id!)) === 1_300_000);
  ok('SAI hủy lại phiếu đã hủy → INVALID_STATE', (await ce.cancelCashEntry(t2.id!, 'x', PW)).error === 'INVALID_STATE');

  // ═══════════ I#3 người chi bắt buộc ═══════════
  ok('I#3 SAI phiếu CHI thiếu người chi → PAYER_REQUIRED', (await ce.createCashEntry({ kind: 'CHI', categoryId: chiCat!.id, fundId: f1r.id!, amount: 100_000, method: 'CASH', entryDate: dateStr(15) })).error === 'PAYER_REQUIRED');

  // ═══════════ I#4 tiền > 0 nguyên không tràn ═══════════
  ok('I#4 SAI amount=0 → VALIDATION', (await ce.createCashEntry({ kind: 'THU', categoryId: thuCat!.id, fundId: f1r.id!, amount: 0, method: 'CASH', entryDate: dateStr(15) })).error === 'VALIDATION');
  ok('I#4 SAI amount âm → VALIDATION', (await ce.createCashEntry({ kind: 'THU', categoryId: thuCat!.id, fundId: f1r.id!, amount: -100, method: 'CASH', entryDate: dateStr(15) })).error === 'VALIDATION');
  ok('I#4 SAI amount thập phân → VALIDATION', (await ce.createCashEntry({ kind: 'THU', categoryId: thuCat!.id, fundId: f1r.id!, amount: 1.5, method: 'CASH', entryDate: dateStr(15) })).error === 'VALIDATION');
  const big = await ce.createCashEntry({ kind: 'THU', categoryId: thuCat!.id, fundId: f2r.id!, amount: 1_000_000_000, method: 'CK', entryDate: dateStr(15) });
  ok('I#4 amount lớn hợp lệ → ok', big.ok === true, big);

  // ═══════════ category sai kind / công nợ chặn ═══════════
  ok('SAI phiếu CHI dùng danh mục THU → VALIDATION', (await ce.createCashEntry({ kind: 'CHI', categoryId: thuCat!.id, fundId: f1r.id!, amount: 100_000, method: 'CASH', entryDate: dateStr(15), payerUserId: payerId })).error === 'VALIDATION');
  ok('SAI phiếu THU danh mục công nợ → DEBT_RECEIPT_DEFERRED', (await ce.createCashEntry({ kind: 'THU', categoryId: debtCat!.id, fundId: f1r.id!, amount: 100_000, method: 'CASH', entryDate: dateStr(15) })).error === 'DEBT_RECEIPT_DEFERRED');

  // ═══════════ I#10 ngày local không nhảy tháng ═══════════
  const march = await ce.createCashEntry({ kind: 'THU', categoryId: thuCat!.id, fundId: f2r.id!, amount: 111_000, method: 'CASH', entryDate: '2026-03-31' });
  ok('I#10 phiếu ngày 2026-03-31 → ok', march.ok === true, march);
  const marchRow = await db.cashEntry.findUnique({ where: { id: march.id! }, select: { entryDate: true } });
  ok('I#10 lưu đúng ngày local (tháng 3, ngày 31 — KHÔNG nhảy sang tháng 4)', marchRow!.entryDate.getMonth() === 2 && marchRow!.entryDate.getDate() === 31, { m: marchRow!.entryDate.getMonth(), d: marchRow!.entryDate.getDate() });

  // ═══════════ TRƯỜNG "CỦA AI" (đối tác): partnerLite · partnerId · partnerText · loại trừ · none ═══════════
  const partner = await db.partner.upsert({ where: { code: 'DTPC-ST26' }, update: {}, create: { name: 'Đối tác Phí Chênh ST26', code: 'DTPC-ST26', status: 'SIGNED', createdBy: me()!.id } });
  const pl = await ce.listPartnersLite();
  ok('partnerLite trả danh sách đối tác (quyền CASHENTRY_VIEW, không cần CONFIG_BANK_VIEW)', pl.ok === true && (pl.data?.some((p) => p.id === partner.id) ?? false), pl.error);
  // (a) chọn từ danh sách → lưu partnerId, partnerText=null
  const pA = await ce.createCashEntry({ kind: 'THU', categoryId: thuCat!.id, fundId: f2r.id!, amount: 120_000, method: 'CASH', entryDate: dateStr(15), partnerId: partner.id });
  ok('phiếu THU chọn đối tác từ danh sách → ok', pA.ok === true, pA);
  const pArow = await db.cashEntry.findUnique({ where: { id: pA.id! }, select: { partnerId: true, partnerText: true } });
  ok('lưu partnerId, partnerText=null khi chọn danh sách', pArow?.partnerId === partner.id && pArow?.partnerText === null, pArow);
  // (b) nhập tay "Khác" → lưu partnerText (đã trim), partnerId=null
  const pB = await ce.createCashEntry({ kind: 'CHI', categoryId: chiCat!.id, fundId: f2r.id!, amount: 90_000, method: 'CASH', entryDate: dateStr(15), payerUserId: payerId, partnerText: '  Đối tác lẻ ABC  ' });
  ok('phiếu CHI nhập tay đối tác → ok', pB.ok === true, pB);
  const pBrow = await db.cashEntry.findUnique({ where: { id: pB.id! }, select: { partnerId: true, partnerText: true } });
  ok('lưu partnerText (trim), partnerId=null khi nhập tay', pBrow?.partnerId === null && pBrow?.partnerText === 'Đối tác lẻ ABC', pBrow);
  // (c) vừa chọn vừa nhập tay → PARTNER_SOURCE_CONFLICT (không lưu)
  ok('SAI vừa chọn vừa nhập tay → PARTNER_SOURCE_CONFLICT', (await ce.createCashEntry({ kind: 'THU', categoryId: thuCat!.id, fundId: f2r.id!, amount: 50_000, method: 'CASH', entryDate: dateStr(15), partnerId: partner.id, partnerText: 'X' })).error === 'PARTNER_SOURCE_CONFLICT');
  // (d) không chọn → mặc định none (cả hai null)
  const pD = await ce.createCashEntry({ kind: 'THU', categoryId: thuCat!.id, fundId: f2r.id!, amount: 40_000, method: 'CASH', entryDate: dateStr(15) });
  const pDrow = await db.cashEntry.findUnique({ where: { id: pD.id! }, select: { partnerId: true, partnerText: true } });
  ok('không chọn đối tác → partnerId & partnerText đều null (mặc định)', pDrow?.partnerId === null && pDrow?.partnerText === null, pDrow);
  // (e) partnerText chỉ khoảng trắng → coi như none (null)
  const pE = await ce.createCashEntry({ kind: 'THU', categoryId: thuCat!.id, fundId: f2r.id!, amount: 30_000, method: 'CASH', entryDate: dateStr(15), partnerText: '   ' });
  const pErow = await db.cashEntry.findUnique({ where: { id: pE.id! }, select: { partnerText: true } });
  ok('partnerText chỉ khoảng trắng → null', pErow?.partnerText === null, pErow);
  // (f) đối tác không tồn tại → VALIDATION
  ok('SAI partnerId không tồn tại → VALIDATION', (await ce.createCashEntry({ kind: 'THU', categoryId: thuCat!.id, fundId: f2r.id!, amount: 20_000, method: 'CASH', entryDate: dateStr(15), partnerId: 999_999 })).error === 'VALIDATION');

  // ═══════════ XÓA QUỸ đang có phiếu → IN_USE; quỹ trống → xóa được ═══════════
  const emptyR = await fundSvc.createFund({ name: 'Quỹ trống ST26', type: 'EWALLET', openingBalance: 0 });
  ok('SAI xóa quỹ F1 (đang có phiếu) → IN_USE', (await fundSvc.deleteFunds([f1r.id!], PW)).error === 'IN_USE');
  ok('xóa quỹ trống (đúng mk) → deleted=1', (await fundSvc.deleteFunds([emptyR.id!], PW)).deleted === 1);
  ok('SAI xóa quỹ sai mật khẩu → WRONG_PASSWORD', (await fundSvc.deleteFunds([f2r.id!], 'sai')).error === 'WRONG_PASSWORD');

  // ═══════════ I#13 LỢI NHUẬN KHÔNG DOUBLE-COUNT ═══════════
  // baseline profit tháng hiện tại → tạo R(Transaction) + A(THU affectsPnl) + B(THU DEBT affectsPnl=false, chèn thẳng DB)
  //  + C(CHI affectsPnl) → delta phải = R + A − C (KHÔNG cộng B).
  const R = 7_000_000, A = 3_000_000, B = 5_000_000, C = 2_000_000;
  const base = await getMonthlyProfit();
  ok('lấy lợi nhuận baseline → ok', base.ok === true, base.data?.current);
  const baseProfit = base.data!.current.profit;
  const baseRev = base.data!.current.revenueAccrual;
  // R = doanh thu ghi nhận (Transaction) txnDate tháng này.
  await db.transaction.create({ data: { code: 'GD_ST26_' + Date.now(), tidId: 1, amount: R, revenuePartner: 0, revenueSell: R, revenueAmount: R, txnDate: monthDate(15), status: 'POSTED' } });
  // A = phiếu THU affectsPnl=true.
  ok('tạo phiếu THU affectsPnl (A) → ok', (await ce.createCashEntry({ kind: 'THU', categoryId: thuCat!.id, fundId: f2r.id!, amount: A, method: 'CASH', entryDate: dateStr(15) })).ok === true);
  // B = phiếu THU công nợ affectsPnl=false — service CHẶN nên chèn thẳng DB (mô phỏng chứng từ thu công nợ pha sau).
  await db.cashEntry.create({ data: { code: 'PT_ST26_DEBT', kind: 'THU', categoryId: debtCat!.id, fundId: f2r.id!, amount: B, method: 'CASH', entryDate: monthDate(15), status: 'POSTED', createdBy: me()!.id } });
  // C = phiếu CHI affectsPnl=true.
  ok('tạo phiếu CHI affectsPnl (C) → ok', (await ce.createCashEntry({ kind: 'CHI', categoryId: chiCat!.id, fundId: f2r.id!, amount: C, method: 'CASH', entryDate: dateStr(15), payerUserId: payerId })).ok === true);
  const after = await getMonthlyProfit();
  const dProfit = after.data!.current.profit - baseProfit;
  const dRev = after.data!.current.revenueAccrual - baseRev;
  ok('I#13 Δlợi nhuận = R + A − C = 8.000.000 (KHÔNG cộng công nợ B)', dProfit === R + A - C, { dProfit, expected: R + A - C });
  ok('I#13 Δdoanh thu ghi nhận = R + A (KHÔNG cộng công nợ B)', dRev === R + A, { dRev, expected: R + A });

  // ═══════════ FORBIDDEN (SALES) + audit PERMISSION_DENIED ═══════════
  await logout();
  await login('cashuser26aaa', 'Sales@123456');
  const denyBefore = await auditCount(db, 'PERMISSION_DENIED');
  ok('SAI SALES xem quỹ → FORBIDDEN', (await fundSvc.listFunds()).error === 'FORBIDDEN');
  ok('SAI SALES tạo quỹ → FORBIDDEN', (await fundSvc.createFund({ name: 'X', type: 'CASH' })).error === 'FORBIDDEN');
  ok('SAI SALES xem phiếu → FORBIDDEN', (await ce.listCashEntries({})).error === 'FORBIDDEN');
  ok('SAI SALES lập phiếu → FORBIDDEN', (await ce.createCashEntry({ kind: 'THU', categoryId: thuCat!.id, fundId: f2r.id!, amount: 1000, method: 'CASH', entryDate: dateStr(15) })).error === 'FORBIDDEN');
  ok('SAI SALES hủy phiếu → FORBIDDEN', (await ce.cancelCashEntry(t1.id!, 'x', 'Sales@123456')).error === 'FORBIDDEN');
  ok('audit PERMISSION_DENIED tăng ≥ 4', (await auditCount(db, 'PERMISSION_DENIED')) >= denyBefore + 4);
  await logout();

  // ═══════════ "DB tiến hóa" — quyền FUND_*/CASHENTRY_* cho MANAGER + ACCOUNTANT cũ (H7) ═══════════
  await login('adminroot', PW);
  const admin = me();
  ok('ADMIN có đủ 7 quyền thu-chi (superuser-sync)', CASHFLOW_PERMS.every((p) => hasPermission(admin, p)));
  // Mô phỏng DB CŨ: gỡ 7 quyền của MANAGER + ACCOUNTANT.
  const permRows = await db.permission.findMany({ where: { code: { in: CASHFLOW_PERMS } }, select: { id: true } });
  for (const rc of ['MANAGER', 'ACCOUNTANT']) {
    const role = await db.role.findUniqueOrThrow({ where: { code: rc }, select: { id: true } });
    await db.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { in: permRows.map((p) => p.id) } } });
  }
  const lacks = (await Promise.all(['MANAGER', 'ACCOUNTANT'].flatMap((rc) => CASHFLOW_PERMS.map((p) => roleHasPerm(db, rc, p))))).every((h) => h === false);
  ok('mô phỏng DB cũ: MANAGER+ACCOUNTANT KHÔNG có quyền thu-chi', lacks);
  ok('grantCashflowPermsToExistingRoles cấp 14 (7×2 role)', (await grantCashflowPermsToExistingRoles(db)) === 14);
  const hasAll = (await Promise.all(['MANAGER', 'ACCOUNTANT'].flatMap((rc) => CASHFLOW_PERMS.map((p) => roleHasPerm(db, rc, p))))).every((h) => h === true);
  ok('sau grant: MANAGER+ACCOUNTANT có ĐỦ 7 quyền', hasAll);
  ok('chạy lại grant = 0 (idempotent)', (await grantCashflowPermsToExistingRoles(db)) === 0);

  // ═══════════ AUDIT tổng ═══════════
  ok('audit FUND_CREATED ≥ 3', (await auditCount(db, 'FUND_CREATED')) >= 3);
  ok('audit CASH_ENTRY_CREATED ≥ 5', (await auditCount(db, 'CASH_ENTRY_CREATED')) >= 5);
  await logout();

  // eslint-disable-next-line no-console
  console.log(`CASHENTRY SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}

/** 'YYYY-MM-DD' tháng hiện tại, ngày `d` (local) — cho createCashEntry (parse local). */
function dateStr(d: number): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** Date object ngày `d` tháng hiện tại (local) — cho insert Transaction/CashEntry thẳng DB. */
function monthDate(d: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), d);
}
