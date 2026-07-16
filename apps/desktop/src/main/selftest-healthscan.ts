// Nhóm E — Quét sức khỏe hệ thống (Health-Scan) — self-test (GLB_SELFTEST=17).
// KIỂM THỬ BẰNG CÁCH NHỒI DỮ LIỆU SAI (LEAD 9/7): mỗi loại lỗi cố ý tạo ra PHẢI bị bắt đúng
// mã + đúng mức độ, có đề xuất fix; mục tự sửa được thì autoFix phải khắc phục. Lưu lịch sử bảo trì.
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import { runScan, listRuns, getRun, persistScheduledRun, collectFindings } from './health-scan.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`HSC17 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const has = (arr: { code: string }[], code: string): boolean => arr.some((x) => x.code === code);
const find = (arr: { code: string; count: number; severity: string; autoFixable: boolean; suggestion: string }[], code: string) => arr.find((x) => x.code === code);

const ADMIN_PW = 'Admin@123456';

export async function runHealthScanSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', ADMIN_PW);

  // ═══════════ SETUP tối thiểu để có TID/loại thẻ hợp lệ ═══════════
  const bank = await db.bank.create({ data: { name: 'NH Scan', code: 'SCANB' } });
  const card = await db.cardType.create({ data: { name: 'Thẻ scan', code: 'SCANC', bankId: bank.id } });
  const partner = await db.partner.create({ data: { name: 'ĐT scan', code: 'SCANP' } });
  const cust = await db.customer.create({ data: { code: 'KHSCAN', fullName: 'Khách Scan', nickname: 'ksc' } });
  const tid = await db.tid.create({ data: { tid: 'TIDSCAN', bankId: bank.id, partnerId: partner.id, customerId: cust.id } });

  // ═══════════ NHỒI DỮ LIỆU SAI ═══════════
  // (a) doanh thu sai công thức
  const txMismatch = await db.transaction.create({ data: { tidId: tid.id, cardTypeId: card.id, amount: 1_000_000, partnerMarginMilli: 2000, sellMarginMilli: 1500, revenuePartner: 1, revenueSell: 1, revenueAmount: 999, txnDate: new Date() } });
  // (b) số tiền âm
  await db.transaction.create({ data: { tidId: tid.id, cardTypeId: card.id, amount: -500, partnerMarginMilli: 0, sellMarginMilli: 0, revenuePartner: 0, revenueSell: 0, revenueAmount: 0, txnDate: new Date() } });
  // (c) orphan TID
  await db.transaction.create({ data: { tidId: 999999, cardTypeId: card.id, amount: 1000, partnerMarginMilli: 0, sellMarginMilli: 0, revenuePartner: 0, revenueSell: 0, revenueAmount: 0, txnDate: new Date() } });
  // (d) orphan khách + orphan loại thẻ
  await db.transaction.create({ data: { tidId: tid.id, cardTypeId: 888888, customerId: 777777, amount: 2000, partnerMarginMilli: 0, sellMarginMilli: 0, revenuePartner: 0, revenueSell: 0, revenueAmount: 0, txnDate: new Date() } });
  // (e) biểu phí orphan (đối tác 555555 không tồn tại)
  await db.feeRate.create({ data: { partnerId: 555555, cardTypeId: card.id, phiMua: 3000, phiCaiMay: 1000, effectiveFrom: new Date('1970-01-01T00:00:00.000Z') } });
  // (f) user bị khóa
  const lockedUser = await userSvc.createUser({ fullName: 'Bị khóa', username: 'lockeduser1', password: 'Lock@12345', roleCodes: ['SALES'] }).catch(() => null);
  if (lockedUser && 'id' in lockedUser && lockedUser.id) await db.user.update({ where: { id: lockedUser.id as number }, data: { lockedAt: new Date(), failedAttempts: 5 } });

  // ═══════════ QUÉT (không tự sửa) → bắt đủ lỗi ═══════════
  const scan = await runScan({ autoFix: false });
  ok('runScan → ok', scan.ok === true, scan.error);
  const F = scan.data!.findings;
  ok('bắt REVENUE_MISMATCH (ERROR, tự sửa được)', find(F, 'REVENUE_MISMATCH')?.severity === 'ERROR' && find(F, 'REVENUE_MISMATCH')?.autoFixable === true, find(F, 'REVENUE_MISMATCH'));
  ok('bắt TXN_NEGATIVE_AMOUNT (ERROR)', find(F, 'TXN_NEGATIVE_AMOUNT')?.severity === 'ERROR', find(F, 'TXN_NEGATIVE_AMOUNT'));
  ok('bắt TXN_ORPHAN_TID (ERROR)', find(F, 'TXN_ORPHAN_TID')?.severity === 'ERROR', find(F, 'TXN_ORPHAN_TID'));
  ok('bắt TXN_ORPHAN_CUSTOMER (WARN)', has(F, 'TXN_ORPHAN_CUSTOMER'), find(F, 'TXN_ORPHAN_CUSTOMER'));
  ok('bắt TXN_ORPHAN_CARDTYPE (WARN)', has(F, 'TXN_ORPHAN_CARDTYPE'), find(F, 'TXN_ORPHAN_CARDTYPE'));
  ok('bắt FEERATE_ORPHAN (WARN)', has(F, 'FEERATE_ORPHAN'), find(F, 'FEERATE_ORPHAN'));
  ok('bắt USERS_LOCKED (WARN)', has(F, 'USERS_LOCKED'), find(F, 'USERS_LOCKED'));
  ok('mỗi phát hiện đều có đề xuất fix', F.every((x) => x.suggestion && x.suggestion.length > 0), {});
  // #1 (audit 0.2.57): checksTotal lấy ĐỘNG = số mục thực chạy (11 sau khi bỏ 2 PRAGMA SQLite). Nếu ai thêm/bớt
  // check, con số này tự đổi theo → test buộc cập nhật (chống "đếm lệch" tái diễn).
  ok('checksTotal khớp số check ĐỘNG (11 mục sau khi bỏ 2 PRAGMA)', scan.data!.checksTotal === 11, { checksTotal: scan.data!.checksTotal });
  // REGRESSION cốt lõi: trên PostgreSQL, KHÔNG check nào được ném lỗi rồi bị nuốt im. PRAGMA SQLite trước đây
  // văng lỗi trên PG → nay hiện thành CHECK_FAILED → test FAIL nếu ai lại nhét câu truy vấn lệch engine.
  ok('KHÔNG check nào bị nuốt lỗi trên PostgreSQL (không có CHECK_FAILED)', !has(F, 'CHECK_FAILED'), F.filter((x) => x.code === 'CHECK_FAILED'));
  ok('đã gỡ 2 check PRAGMA SQLite (không còn DB_INTEGRITY / DB_FOREIGN_KEY)', !has(F, 'DB_INTEGRITY') && !has(F, 'DB_FOREIGN_KEY'), F.map((x) => x.code));
  ok('trạng thái tổng = ERROR (có lỗi nghiêm trọng)', scan.data!.status === 'ERROR', { status: scan.data!.status });
  ok('lưu 1 dòng lịch sử (runId > 0)', scan.data!.runId > 0, { runId: scan.data!.runId });

  // ═══════════ TỰ SỬA → doanh thu được tính lại (BACKUP trước khi ghi đè) ═══════════
  const bkBefore = await db.backupLog.count();
  const scanFix = await runScan({ autoFix: true });
  ok('runScan autoFix → sửa ≥1 giao dịch doanh thu', (scanFix.data?.autoFixed ?? 0) >= 1, { autoFixed: scanFix.data?.autoFixed });
  ok('autoFix ĐÃ backup TRƯỚC khi ghi đè doanh thu (backup_logs +1)', (await db.backupLog.count()) >= bkBefore + 1, { before: bkBefore });
  ok('sau tự sửa: REVENUE_MISMATCH KHÔNG còn', !has(scanFix.data!.findings, 'REVENUE_MISMATCH'), scanFix.data!.findings.map((x) => x.code));
  const fixed = await db.transaction.findUnique({ where: { id: txMismatch.id } });
  ok('doanh thu giao dịch được tính lại đúng (20000+15000=35000)', Number(fixed?.revenuePartner) === 20000 && Number(fixed?.revenueSell) === 15000 && Number(fixed?.revenueAmount) === 35000, { p: fixed?.revenuePartner, s: fixed?.revenueSell, t: fixed?.revenueAmount });

  // ═══════════ LỊCH SỬ BẢO TRÌ ═══════════
  const runs = await listRuns(10);
  ok('listRuns trả ≥2 lần quét', (runs.data?.length ?? 0) >= 2, { len: runs.data?.length });
  const detail = await getRun(scan.data!.runId);
  ok('getRun trả báo cáo findings đầy đủ', (detail.data?.findings?.length ?? 0) >= 5, { len: detail.data?.findings?.length });

  // ═══════════ BẢO TRÌ ĐỊNH KỲ ghi lịch sử kind=SCHEDULED ═══════════
  const sched = await persistScheduledRun(db, { backupFile: '/tmp/x.zip', auditDeleted: 3, trashDeleted: 2, vacuumed: true });
  ok('persistScheduledRun tạo run kind SCHEDULED', sched.runId > 0, { runId: sched.runId });
  const schedRow = await db.maintenanceRun.findUnique({ where: { id: sched.runId } });
  ok('run định kỳ lưu đúng số liệu backup/purge/vacuum', schedRow?.kind === 'SCHEDULED' && schedRow?.auditDeleted === 3 && schedRow?.trashDeleted === 2 && schedRow?.vacuumed === true, schedRow);

  // ═══════════ CLEAN scan sau khi dọn dữ liệu sai → còn ít lỗi hơn ═══════════
  // xóa cứng các bản ghi orphan/âm để chứng minh scan phản ánh trạng thái sạch hơn
  await db.transaction.deleteMany({ where: { OR: [{ amount: { lt: 0 } }, { tidId: 999999 }, { cardTypeId: 888888 }] } });
  await db.feeRate.deleteMany({ where: { partnerId: 555555 } });
  const after = (await collectFindings(db)).findings;
  ok('sau dọn dữ liệu sai: hết TXN_ORPHAN_TID', !has(after, 'TXN_ORPHAN_TID'), after.map((x) => x.code));
  ok('sau dọn: hết TXN_NEGATIVE_AMOUNT', !has(after, 'TXN_NEGATIVE_AMOUNT'), {});

  // ═══════════ PHÂN QUYỀN ═══════════
  await userSvc.createUser({ fullName: 'KH ngoài hsc', username: 'custnohsc', password: 'Cust@12345', roleCodes: ['CUSTOMER'] }).catch(() => undefined);
  await logout();
  await login('custnohsc', 'Cust@12345');
  const forbScan = await runScan({ autoFix: false });
  ok('CUSTOMER không STORAGE_VIEW → runScan FORBIDDEN', forbScan.ok === false && forbScan.error === 'FORBIDDEN', forbScan.error);
  const forbRuns = await listRuns();
  ok('CUSTOMER → listRuns FORBIDDEN', forbRuns.ok === false && forbRuns.error === 'FORBIDDEN', forbRuns.error);

  await logout();
  // eslint-disable-next-line no-console
  console.log(`HSC17 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
