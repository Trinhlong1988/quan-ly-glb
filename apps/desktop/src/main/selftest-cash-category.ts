// PHASE H1 — Thu–Chi: danh mục thu/chi self-test (GLB_SELFTEST=25).
// Phủ: CRUD (create/list/lọc kind+active/update/soft-delete) · chống trùng tên trong loại ·
// BẤT BIẾN affectsPnl I#12 (create & update chặn nguồn nội bộ affectsPnl=true → PNL_FLAG_FORBIDDEN) ·
// danh mục HỆ THỐNG không xóa được (SYSTEM_LOCKED) + không đổi nguồn · seed hệ thống idempotent ·
// AUDIT mọi nhánh (kể cả từ chối) · FORBIDDEN (role không quyền) ·
// bug class "DB tiến hóa" (H7): quyền CASHCAT_* MỚI phải cấp cho role CŨ (MANAGER) idempotent.
import { hasPermission } from '@glb/shared';
import { login, logout, me } from './auth-service.js';
import { getDb, grantCashCatPermsToExistingRoles, seedSystemCashCategories } from './db.js';
import * as userSvc from './user-service.js';
import * as cc from './cash-category-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`CASHCAT ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';
const CASHCAT_PERMS = ['CASHCAT_VIEW', 'CASHCAT_CREATE', 'CASHCAT_UPDATE', 'CASHCAT_DELETE'];

async function auditCount(db: ReturnType<typeof getDb>, action: string): Promise<number> {
  return db.auditLog.count({ where: { action } });
}
async function roleHasPerm(db: ReturnType<typeof getDb>, roleCode: string, permCode: string): Promise<boolean> {
  const role = await db.role.findUnique({ where: { code: roleCode }, select: { id: true } });
  if (!role) return false;
  const perm = await db.permission.findUnique({ where: { code: permCode }, select: { id: true } });
  if (!perm) return false;
  const rp = await db.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } } });
  return !!rp;
}

export async function runCashCategorySelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', PW);

  // ═══════════ SEED hệ thống (đã chạy ở seedIfEmpty vì GLB_ROLE=server) ═══════════
  const systemCount0 = await db.cashCategory.count({ where: { isSystem: true, deletedAt: null } });
  ok('seed danh mục hệ thống ≥ 15', systemCount0 >= 15, { systemCount0 });
  // Idempotent: chạy lại seed → tạo mới 0, count không đổi.
  ok('seedSystemCashCategories chạy lại = 0 (idempotent)', (await seedSystemCashCategories(db)) === 0);
  ok('count hệ thống không đổi sau seed lại', (await db.cashCategory.count({ where: { isSystem: true, deletedAt: null } })) === systemCount0);
  // Seed gán affectsPnl đúng bất biến: mọi danh mục nguồn nội bộ phải affectsPnl=false.
  const internalSeed = await db.cashCategory.findMany({ where: { isSystem: true, sourceKind: { in: ['DEBT_CUSTOMER', 'DEBT_PARTNER', 'DEPOSIT', 'DEPOSIT_REFUND', 'ADVANCE', 'DEVICE_DEPOSIT', 'FUND_TRANSFER'] } }, select: { affectsPnl: true } });
  ok('seed: danh mục nguồn nội bộ đều affectsPnl=false', internalSeed.length > 0 && internalSeed.every((r) => r.affectsPnl === false));
  const salarySeed = await db.cashCategory.findFirst({ where: { isSystem: true, sourceKind: 'SALARY' }, select: { affectsPnl: true } });
  ok('seed: chi lương (SALARY) affectsPnl=true', salarySeed?.affectsPnl === true);

  // ═══════════ ĐÚNG — CRUD ═══════════
  const c1 = await cc.createCashCategory({ kind: 'THU', name: 'Thu bán phụ kiện', sourceKind: 'MANUAL', affectsPnl: true, unit: 'đồng' });
  ok('tạo danh mục THU (MANUAL) → ok', c1.ok === true, c1);
  const c2 = await cc.createCashCategory({ kind: 'CHI', name: 'Chi tiếp khách', sourceKind: 'MANUAL', affectsPnl: true });
  ok('tạo danh mục CHI (MANUAL) → ok', c2.ok === true, c2);
  const c3 = await cc.createCashCategory({ kind: 'THU', name: 'Thu nợ KH ngoài sổ', sourceKind: 'DEBT_CUSTOMER', affectsPnl: false });
  ok('tạo danh mục THU (DEBT_CUSTOMER, affectsPnl=false) → ok', c3.ok === true, c3);

  ok('list toàn bộ = hệ thống + 3', ((await cc.listCashCategories()).data?.length ?? 0) === systemCount0 + 3);
  ok('lọc kind=THU đếm đúng', ((await cc.listCashCategories({ kind: 'THU' })).data ?? []).every((r) => r.kind === 'THU'));
  ok('lọc kind=CHI đếm đúng', ((await cc.listCashCategories({ kind: 'CHI' })).data ?? []).every((r) => r.kind === 'CHI'));
  ok('tìm theo tên "phụ kiện" ≥ 1', ((await cc.listCashCategories({ search: 'phụ kiện' })).data?.length ?? 0) >= 1);

  // update: đổi tên + tắt active
  ok('sửa tên c1 → ok', (await cc.updateCashCategory(c1.id!, { name: 'Thu bán phụ kiện (sửa)' })).ok === true);
  ok('tắt active c2 → ok', (await cc.updateCashCategory(c2.id!, { active: false })).ok === true);
  ok('lọc active=false ≥ 1', ((await cc.listCashCategories({ active: false })).data?.length ?? 0) >= 1);

  // ═══════════ BẤT BIẾN affectsPnl (I#12) ═══════════
  const badCreate = await cc.createCashCategory({ kind: 'THU', name: 'Thu công nợ sai cờ', sourceKind: 'DEBT_CUSTOMER', affectsPnl: true });
  ok('SAI tạo DEBT_CUSTOMER + affectsPnl=true → PNL_FLAG_FORBIDDEN', badCreate.error === 'PNL_FLAG_FORBIDDEN', badCreate);
  const badCreate2 = await cc.createCashCategory({ kind: 'CHI', name: 'Chuyển quỹ sai cờ', sourceKind: 'FUND_TRANSFER', affectsPnl: true });
  ok('SAI tạo FUND_TRANSFER + affectsPnl=true → PNL_FLAG_FORBIDDEN', badCreate2.error === 'PNL_FLAG_FORBIDDEN');
  // update: bật affectsPnl trên danh mục nguồn nội bộ (c3 = DEBT_CUSTOMER) → chặn.
  const badUpdate = await cc.updateCashCategory(c3.id!, { affectsPnl: true });
  ok('SAI bật affectsPnl trên DEBT_CUSTOMER → PNL_FLAG_FORBIDDEN', badUpdate.error === 'PNL_FLAG_FORBIDDEN', badUpdate);
  // update: đổi nguồn c1 (MANUAL, affectsPnl=true) sang ADVANCE mà vẫn giữ affectsPnl=true → chặn.
  const badUpdate2 = await cc.updateCashCategory(c1.id!, { sourceKind: 'ADVANCE', affectsPnl: true });
  ok('SAI đổi nguồn sang ADVANCE giữ affectsPnl=true → PNL_FLAG_FORBIDDEN', badUpdate2.error === 'PNL_FLAG_FORBIDDEN');

  // ═══════════ HỆ THỐNG (isSystem) không xóa / không đổi nguồn ═══════════
  const sysCat = await db.cashCategory.findFirst({ where: { isSystem: true, deletedAt: null }, select: { id: true, sourceKind: true } });
  ok('có danh mục hệ thống để test', !!sysCat);
  const delSys = await cc.deleteCashCategories([sysCat!.id], PW);
  ok('SAI xóa danh mục hệ thống → SYSTEM_LOCKED', delSys.error === 'SYSTEM_LOCKED', delSys);
  ok('danh mục hệ thống vẫn còn sau khi bị chặn xóa', (await db.cashCategory.findUnique({ where: { id: sysCat!.id } }))?.deletedAt == null);
  const nextSrc = sysCat!.sourceKind === 'MANUAL' ? 'SALE_POS' : 'MANUAL';
  ok('SAI đổi nguồn danh mục hệ thống → SYSTEM_LOCKED', (await cc.updateCashCategory(sysCat!.id, { sourceKind: nextSrc })).error === 'SYSTEM_LOCKED');

  // ═══════════ CHỐNG TRÙNG + VALIDATION ═══════════
  ok('SAI trùng tên trong loại THU → DUPLICATE', (await cc.createCashCategory({ kind: 'THU', name: 'Thu bán phụ kiện (sửa)' })).error === 'DUPLICATE');
  ok('OK trùng tên nhưng KHÁC loại (THU vs CHI) → cho phép', (await cc.createCashCategory({ kind: 'CHI', name: 'Thu bán phụ kiện (sửa)', sourceKind: 'MANUAL', affectsPnl: true })).ok === true);
  ok('SAI kind không hợp lệ → VALIDATION', (await cc.createCashCategory({ kind: 'XX', name: 'Z' })).error === 'VALIDATION');
  ok('SAI tên rỗng → VALIDATION', (await cc.createCashCategory({ kind: 'THU', name: '   ' })).error === 'VALIDATION');
  ok('SAI sourceKind không hợp lệ → VALIDATION', (await cc.createCashCategory({ kind: 'THU', name: 'Z2', sourceKind: 'FOO' })).error === 'VALIDATION');
  ok('SAI sửa không tồn tại → NOT_FOUND', (await cc.updateCashCategory(999001, { name: 'X' })).error === 'NOT_FOUND');

  // xóa mềm danh mục THƯỜNG hợp lệ
  ok('xóa danh mục thường (đúng mk) → deleted=1', (await cc.deleteCashCategories([c2.id!], PW)).deleted === 1);
  ok('danh mục đã xóa rời danh sách', (await cc.listCashCategories()).data?.some((r) => r.id === c2.id) === false);
  // tái tạo tên đã xóa (cùng loại) → DUPLICATE_TRASH
  ok('SAI tái tạo tên đã xóa → DUPLICATE_TRASH', (await cc.createCashCategory({ kind: 'CHI', name: 'Chi tiếp khách', sourceKind: 'MANUAL', affectsPnl: true })).error === 'DUPLICATE_TRASH');

  // ═══════════ IN_USE — danh mục còn phiếu thu/chi tham chiếu KHÔNG xóa được ═══════════
  const usedCat = await cc.createCashCategory({ kind: 'CHI', name: 'Chi có phiếu ST25', sourceKind: 'MANUAL', affectsPnl: true });
  ok('tạo danh mục để test IN_USE → ok', usedCat.ok === true, usedCat);
  const refEntry = await db.cashEntry.create({ data: { code: 'PC-INUSE-ST25', kind: 'CHI', categoryId: usedCat.id!, fundId: null, amount: 10_000, method: 'CASH', entryDate: new Date('2026-01-15T00:00:00'), status: 'POSTED', createdBy: me()!.id } });
  ok('SAI xóa danh mục đang có phiếu → IN_USE', (await cc.deleteCashCategories([usedCat.id!], PW)).error === 'IN_USE');
  ok('danh mục IN_USE VẪN còn (không bị xóa)', (await db.cashCategory.findUnique({ where: { id: usedCat.id! } }))?.deletedAt == null);
  // Xóa mềm phiếu tham chiếu → danh mục hết "đang dùng" → xóa được.
  await db.cashEntry.update({ where: { id: refEntry.id }, data: { deletedAt: new Date() } });
  ok('sau khi phiếu bị xóa mềm → xóa danh mục được (deleted=1)', (await cc.deleteCashCategories([usedCat.id!], PW)).deleted === 1);

  // ═══════════ AUDIT ═══════════
  ok('audit CASH_CATEGORY_CREATED ≥ 4', (await auditCount(db, 'CASH_CATEGORY_CREATED')) >= 4);
  ok('audit CASH_CATEGORY_UPDATED ≥ 2', (await auditCount(db, 'CASH_CATEGORY_UPDATED')) >= 2);
  ok('audit CASH_CATEGORY_DELETED ≥ 1', (await auditCount(db, 'CASH_CATEGORY_DELETED')) >= 1);
  const beforeDenied = await auditCount(db, 'CASH_CATEGORY_DELETED');
  ok('SAI xóa sai mật khẩu → WRONG_PASSWORD', (await cc.deleteCashCategories([c1.id!], 'sai')).error === 'WRONG_PASSWORD');
  ok('audit ghi cả nhánh xóa bị từ chối', (await auditCount(db, 'CASH_CATEGORY_DELETED')) === beforeDenied + 1);

  // ═══════════ FORBIDDEN (role không quyền) ═══════════
  await userSvc.createUser({ fullName: 'NV Sales TC', username: 'salescashcat', password: 'Sales@123456', roleCodes: ['SALES'] }).catch(() => undefined);
  await logout();
  await login('salescashcat', 'Sales@123456');
  const beforeDenyAudit = await auditCount(db, 'PERMISSION_DENIED');
  ok('SAI SALES list → FORBIDDEN', (await cc.listCashCategories()).error === 'FORBIDDEN');
  ok('SAI SALES tạo → FORBIDDEN', (await cc.createCashCategory({ kind: 'THU', name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES sửa → FORBIDDEN', (await cc.updateCashCategory(c1.id!, { name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES xóa → FORBIDDEN', (await cc.deleteCashCategories([c1.id!], PW)).error === 'FORBIDDEN');
  ok('audit PERMISSION_DENIED tăng ≥ 3 (list không audit)', (await auditCount(db, 'PERMISSION_DENIED')) >= beforeDenyAudit + 3);
  await logout();

  // ═══════════ "DB tiến hóa" — quyền CASHCAT_* cho role CŨ (H7) ═══════════
  await login('adminroot', PW);
  const admin = me();
  ok('ADMIN có đủ 4 quyền CASHCAT (superuser-sync)', CASHCAT_PERMS.every((p) => hasPermission(admin, p)));
  // Mô phỏng DB CŨ: gỡ hết 4 quyền của MANAGER.
  const mgr = await db.role.findUniqueOrThrow({ where: { code: 'MANAGER' }, select: { id: true } });
  const permRows = await db.permission.findMany({ where: { code: { in: CASHCAT_PERMS } }, select: { id: true } });
  await db.rolePermission.deleteMany({ where: { roleId: mgr.id, permissionId: { in: permRows.map((p) => p.id) } } });
  const lacksAll = (await Promise.all(CASHCAT_PERMS.map((p) => roleHasPerm(db, 'MANAGER', p)))).every((h) => h === false);
  ok('mô phỏng DB cũ: MANAGER KHÔNG có quyền CASHCAT', lacksAll);
  // Cấp lại qua db-evolution → MANAGER được cấp đủ 4.
  ok('grantCashCatPermsToExistingRoles cấp 4 quyền cho MANAGER', (await grantCashCatPermsToExistingRoles(db)) === 4);
  const hasAll = (await Promise.all(CASHCAT_PERMS.map((p) => roleHasPerm(db, 'MANAGER', p)))).every((h) => h === true);
  ok('sau grant: MANAGER có ĐỦ 4 quyền CASHCAT', hasAll);
  // Idempotent: chạy lại → 0.
  ok('chạy lại grant = 0 (idempotent)', (await grantCashCatPermsToExistingRoles(db)) === 0);
  await logout();

  // eslint-disable-next-line no-console
  console.log(`CASHCAT SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
