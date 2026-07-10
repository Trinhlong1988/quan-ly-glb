// Nhóm A #4 — Thùng rác per-user + tên người xóa — self-test (GLB_SELFTEST=13).
// Chạy trên DB throwaway. Chứng minh bằng SỐ LIỆU THẬT:
//  • Service xóa mềm ghi ĐÚNG deletedBy = người thực hiện.
//  • User thường CHỈ thấy đồ MÌNH xóa; Admin/Manager (TRASH_VIEW_ALL) thấy TỔNG + tên người xóa.
//  • Phục hồi → xóa deletedBy.
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import * as customerSvc from './customer-service.js';
import * as trash from './trash-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`NHOMA13 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
async function mkUser(fullName: string, username: string, password: string, role: string): Promise<number> {
  await login('adminroot', 'Admin@123456');
  const res = await userSvc.createUser({ fullName, username, password, roleCodes: [role] });
  if (!res.ok) throw new Error(`createUser ${username}: ${res.error} ${res.message}`);
  const u = await getDb().user.findUnique({ where: { username }, select: { id: true } });
  return u!.id;
}

export async function runNhomA3SelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', 'Admin@123456');
  const adminId = (await db.user.findUnique({ where: { username: 'adminroot' }, select: { id: true } }))!.id;

  // ═══════════ A) SERVICE XÓA MỀM GHI ĐÚNG deletedBy ═══════════
  const c1 = await db.customer.create({ data: { code: 'KHSVC1', fullName: 'KH Service', nickname: 'Svc' } });
  const delRes = await customerSvc.deleteCustomer(c1.id, 'Admin@123456');
  ok('adminroot xóa khách qua service → ok', delRes.ok === true, delRes);
  const c1row = await db.customer.findUnique({ where: { id: c1.id }, select: { deletedAt: true, deletedBy: true } });
  ok('service ghi ĐÚNG deletedBy = adminroot + có deletedAt', c1row?.deletedBy === adminId && c1row?.deletedAt !== null, c1row);

  // ═══════════ B) TẠO DỮ LIỆU XÓA MỀM CỦA NHIỀU USER ═══════════
  const userA = await mkUser('NV A', 'useralpha', 'Alpha@12345', 'SALES');
  const userB = await mkUser('NV B', 'userbeta', 'Beta@123456', 'SALES');
  // 3 của A, 2 của B (mô phỏng nhiều người xóa)
  for (let i = 0; i < 3; i++) await db.customer.create({ data: { code: `KHA${i}`, fullName: `A${i}`, nickname: `A${i}`, deletedAt: new Date(), deletedBy: userA } });
  for (let i = 0; i < 2; i++) await db.bank.create({ data: { name: `NH B${i}`, code: `NHB${i}`, deletedAt: new Date(), deletedBy: userB } });

  // ═══════════ C) USER THƯỜNG CHỈ THẤY ĐỒ MÌNH XÓA ═══════════
  await logout();
  await login('useralpha', 'Alpha@12345');
  const aList = await trash.listTrash();
  const aRows = aList.data ?? [];
  ok('userA xem thùng rác → ok', aList.ok === true);
  ok('userA CHỈ thấy đồ mình xóa (3 bản ghi)', aRows.length === 3, { count: aRows.length });
  ok('userA: mọi bản ghi có deletedBy = userA', aRows.every((r) => r.deletedBy === userA), aRows.map((r) => r.deletedBy));
  ok('userA KHÔNG thấy đồ của userB/admin', !aRows.some((r) => r.deletedBy === userB || r.deletedBy === adminId));

  await logout();
  await login('userbeta', 'Beta@123456');
  const bRows = (await trash.listTrash()).data ?? [];
  ok('userB CHỈ thấy đồ mình xóa (2 bản ghi)', bRows.length === 2, { count: bRows.length });
  ok('userB: mọi bản ghi có deletedBy = userB', bRows.every((r) => r.deletedBy === userB));

  // ═══════════ D) ADMIN THẤY TỔNG + TÊN NGƯỜI XÓA ═══════════
  await logout();
  await login('adminroot', 'Admin@123456');
  const allRows = (await trash.listTrash()).data ?? [];
  ok('admin thấy thùng rác TỔNG (≥ 6: 1 admin + 3 A + 2 B)', allRows.length >= 6, { count: allRows.length });
  ok('admin thấy bản ghi của userA', allRows.some((r) => r.deletedBy === userA));
  ok('admin thấy bản ghi của userB', allRows.some((r) => r.deletedBy === userB));
  const aRow = allRows.find((r) => r.deletedBy === userA);
  ok('admin thấy TÊN người xóa (NV A)', aRow?.deletedByName === 'NV A', { name: aRow?.deletedByName });
  const adminRow = allRows.find((r) => r.deletedBy === adminId);
  ok('admin thấy tên chính mình cho bản ghi tự xóa', adminRow?.deletedByName === 'Quản trị hệ thống', { name: adminRow?.deletedByName });

  // ═══════════ E) MANAGER cũng thấy TỔNG ═══════════
  await mkUser('QL M', 'managerm', 'Mgr@123456', 'MANAGER');
  await logout();
  await login('managerm', 'Mgr@123456');
  const mRows = (await trash.listTrash()).data ?? [];
  ok('manager thấy thùng rác TỔNG (≥ 6)', mRows.length >= 6, { count: mRows.length });

  // ═══════════ F) PHỤC HỒI → XÓA deletedBy ═══════════
  await logout();
  await login('adminroot', 'Admin@123456');
  const target = allRows.find((r) => r.entityType === 'Customer' && r.deletedBy === userA)!;
  const rr = await trash.restoreItem('Customer', target.id);
  ok('admin phục hồi bản ghi của userA → ok', rr.ok === true, rr);
  const restored = await db.customer.findUnique({ where: { id: target.id }, select: { deletedAt: true, deletedBy: true } });
  ok('sau phục hồi: deletedAt=null VÀ deletedBy=null', restored?.deletedAt === null && restored?.deletedBy === null, restored);

  await logout();
  // eslint-disable-next-line no-console
  console.log(`NHOMA13 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
