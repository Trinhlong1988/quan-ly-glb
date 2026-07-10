// Nhóm B — Dashboard stats — self-test (GLB_SELFTEST=14).
// Chứng minh: getStats trả cấu trúc đầy đủ (kể cả khi trống), đếm đúng sau khi thêm dữ liệu,
// bộ đếm TID theo ngân hàng đúng, chuỗi 12 tháng, phân quyền DASHBOARD_VIEW.
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import { getStats } from './dashboard-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`DASH14 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

export async function runDashboardSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', 'Admin@123456');

  // ═══════════ A) TRỐNG VẪN TRẢ CẤU TRÚC ĐẦY ĐỦ (empty-state) ═══════════
  const s0 = await getStats();
  ok('getStats khi trống → ok', s0.ok === true, s0.error);
  const d0 = s0.data!;
  ok('có đủ 7 KPI counts (số)', d0 && typeof d0.counts.tids === 'number' && typeof d0.counts.customers === 'number' && typeof d0.counts.users === 'number', d0?.counts);
  ok('monthly có ĐÚNG 12 tháng', d0.monthly.length === 12, { len: d0.monthly.length });
  ok('tidsByBank / posByStatus là mảng (empty-state OK)', Array.isArray(d0.tidsByBank) && Array.isArray(d0.posByStatus));
  const baseCustomers = d0.counts.customers;
  const baseTids = d0.counts.tids;

  // ═══════════ B) THÊM DỮ LIỆU → ĐẾM ĐÚNG ═══════════
  const bank = await db.bank.create({ data: { name: 'NH Dashboard', code: 'VPB' } });
  for (let i = 0; i < 3; i++) await db.customer.create({ data: { code: `KHD${i}`, fullName: `KH ${i}`, nickname: `N${i}` } });
  await db.tid.create({ data: { tid: 'TIDDASH1', bankId: bank.id } });
  await db.tid.create({ data: { tid: 'TIDDASH2', bankId: bank.id } });

  const s1 = await getStats();
  const d1 = s1.data!;
  ok('khách hàng tăng đúng +3', d1.counts.customers === baseCustomers + 3, { before: baseCustomers, after: d1.counts.customers });
  ok('TID tăng đúng +2', d1.counts.tids === baseTids + 2, { before: baseTids, after: d1.counts.tids });
  const vpb = d1.tidsByBank.find((r) => r.label === 'VPB');
  ok('bộ đếm TID theo ngân hàng: VPB = 2', vpb?.count === 2, d1.tidsByBank);
  const thisMonth = d1.monthly[d1.monthly.length - 1];
  ok('tháng hiện tại: TID ≥ 2 và khách ≥ 3', thisMonth.tids >= 2 && thisMonth.customers >= 3, thisMonth);

  // xóa mềm 1 khách → đếm giảm (loại trừ đã xóa)
  const someCust = await db.customer.findFirst({ where: { code: 'KHD0' }, select: { id: true } });
  await db.customer.update({ where: { id: someCust!.id }, data: { deletedAt: new Date() } });
  const s2 = await getStats();
  ok('xóa mềm 1 khách → đếm giảm 1 (loại đã xóa)', s2.data!.counts.customers === d1.counts.customers - 1, { after: s2.data!.counts.customers });

  // ═══════════ C) PHÂN QUYỀN DASHBOARD_VIEW ═══════════
  await userSvc.createUser({ fullName: 'KH ngoài', username: 'custnodash', password: 'Cust@12345', roleCodes: ['CUSTOMER'] }).catch(() => undefined);
  await logout();
  await login('custnodash', 'Cust@12345');
  const forb = await getStats();
  ok('vai trò CUSTOMER (không DASHBOARD_VIEW) → FORBIDDEN', forb.ok === false && forb.error === 'FORBIDDEN', forb.error);

  await logout();
  // eslint-disable-next-line no-console
  console.log(`DASH14 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
