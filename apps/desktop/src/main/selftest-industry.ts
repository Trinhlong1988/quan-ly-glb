// G-CFG.7 §11 Pha I1 Cấu hình ngành nghề — self-test (GLB_SELFTEST=24).
// Phủ: CRUD (mã NGH## auto atomic + list + lọc active + update + soft-delete) · chống trùng tên
// (active/trash) · validation · sai mật khẩu · FORBIDDEN (role không quyền) · AUDIT mọi nhánh ·
// và **bug class "DB tiến hóa"** (memory 9/7 H7): quyền industry MỚI phải cấp cho role CŨ
// (ADMIN qua superuser-sync + MANAGER qua grant idempotent), KHÔNG chỉ role tạo mới.
import { hasPermission } from '@glb/shared';
import { login, logout, me } from './auth-service.js';
import { getDb, grantIndustryPermsToExistingRoles } from './db.js';
import * as userSvc from './user-service.js';
import * as ind from './industry-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`INDUSTRY ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';
const INDUSTRY_PERMS = ['CONFIG_INDUSTRY_VIEW', 'CONFIG_INDUSTRY_CREATE', 'CONFIG_INDUSTRY_UPDATE', 'CONFIG_INDUSTRY_DELETE'];

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

export async function runIndustrySelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', PW);

  // ═══════════ ĐÚNG — CRUD ═══════════
  // BASELINE trước khi tạo: seed nghiệp vụ (vd Bill Giải Trình) có thể đã tạo sẵn ngành CÓ sản phẩm →
  // KHÔNG hardcode tổng số. Đếm TƯƠNG ĐỐI so với baseline để test bền với seed (bài học ST24 rotted 20/7).
  const base = (await ind.listIndustries()).data?.length ?? 0;
  const baseActive = (await ind.listIndustries({ active: true })).data?.length ?? 0;
  const baseInactive = (await ind.listIndustries({ active: false })).data?.length ?? 0;
  const commonNames = ['Vận tải', 'Tạp hóa', 'Cà phê', 'Ăn uống', 'Thời trang', 'Điện tử'];
  const ids: number[] = [];
  const codes: string[] = [];
  for (const nm of commonNames) {
    const r = await ind.createIndustry({ name: nm });
    ok(`tạo ngành "${nm}" → ok`, r.ok === true, r);
    if (r.id) ids.push(r.id);
  }
  ok('list = baseline + 6 (test tạo 6)', (await ind.listIndustries()).data?.length === base + 6);

  // Mã NGH## auto tuần tự (atomic $transaction, §D)
  const listed = (await ind.listIndustries()).data ?? [];
  for (const row of listed) codes.push(row.code);
  ok('mọi mã khớp NGH\\d+', codes.every((c) => /^NGH\d{2,}$/.test(c)), codes);
  ok('mã KHÔNG trùng nhau', new Set(codes).size === codes.length, codes);
  ok('mã đầu = NGH01', codes[0] === 'NGH01', codes[0]);

  // active mặc định = true (chỉ xét ngành TEST vừa tạo — không phụ thuộc seed)
  ok('mặc định active = true', listed.filter((r) => ids.includes(r.id)).every((r) => r.active === true));

  // update: đổi tên
  ok('sửa tên ngành[0] → ok', (await ind.updateIndustry(ids[0], { name: 'Vận tải (sửa)' })).ok === true);
  // update: tắt active
  ok('tắt active ngành[1] → ok', (await ind.updateIndustry(ids[1], { active: false })).ok === true);
  ok('lọc active=false = baseline + 1 (test tắt 1)', (await ind.listIndustries({ active: false })).data?.length === baseInactive + 1);
  ok('lọc active=true = baseline + 5 (6 tạo − 1 tắt)', (await ind.listIndustries({ active: true })).data?.length === baseActive + 5);
  // update: ghi chú
  ok('sửa ghi chú ngành[2] → ok', (await ind.updateIndustry(ids[2], { note: 'Đồ uống' })).ok === true);
  ok('ghi chú đã lưu', (await ind.listIndustries({ search: 'Cà phê' })).data?.[0]?.note === 'Đồ uống');

  // tìm theo mã + tên
  ok('tìm theo "NGH01" ≥ 1', ((await ind.listIndustries({ search: 'NGH01' })).data?.length ?? 0) >= 1);
  ok('tìm theo "Điện" ≥ 1', ((await ind.listIndustries({ search: 'Điện' })).data?.length ?? 0) >= 1);

  // xóa mềm hợp lệ
  ok('xóa 1 ngành (đúng mk) → deleted=1', (await ind.deleteIndustries([ids[5]], PW)).deleted === 1);
  ok('ngành đã xóa rời danh sách', (await ind.listIndustries()).data?.some((r) => r.id === ids[5]) === false);

  // ═══════════ AUDIT ═══════════
  ok('audit INDUSTRY_CREATED = 6', (await auditCount(db, 'INDUSTRY_CREATED')) === 6);
  ok('audit INDUSTRY_UPDATED = 3', (await auditCount(db, 'INDUSTRY_UPDATED')) === 3);
  ok('audit INDUSTRY_DELETED ≥ 1', (await auditCount(db, 'INDUSTRY_DELETED')) >= 1);

  // ═══════════ SAI ═══════════
  ok('SAI tên rỗng → VALIDATION', (await ind.createIndustry({ name: '  ' })).error === 'VALIDATION');
  ok('SAI trùng tên "Tạp hóa" → DUPLICATE', (await ind.createIndustry({ name: 'Tạp hóa' })).error === 'DUPLICATE');
  ok('SAI trùng tên khác hoa/thường "tạp hóa" → DUPLICATE', (await ind.createIndustry({ name: 'tạp hóa' })).error === 'DUPLICATE');
  ok('SAI tái tạo tên đã xóa "Điện tử" → DUPLICATE_TRASH', (await ind.createIndustry({ name: 'Điện tử' })).error === 'DUPLICATE_TRASH');
  ok('SAI sửa không tồn tại → NOT_FOUND', (await ind.updateIndustry(999001, { name: 'X' })).error === 'NOT_FOUND');
  ok('SAI sửa tên rỗng → VALIDATION', (await ind.updateIndustry(ids[2], { name: '  ' })).error === 'VALIDATION');
  ok('SAI sửa ngành[2] trùng tên "Tạp hóa" → DUPLICATE', (await ind.updateIndustry(ids[2], { name: 'Tạp hóa' })).error === 'DUPLICATE');
  ok('SAI xóa không chọn → VALIDATION', (await ind.deleteIndustries([], PW)).error === 'VALIDATION');
  const beforeDenied = await auditCount(db, 'INDUSTRY_DELETED');
  ok('SAI xóa sai mật khẩu → WRONG_PASSWORD', (await ind.deleteIndustries([ids[2]], 'sai')).error === 'WRONG_PASSWORD');
  ok('audit ghi cả nhánh xóa bị từ chối', (await auditCount(db, 'INDUSTRY_DELETED')) === beforeDenied + 1);

  // ═══════════ FORBIDDEN (role không quyền) ═══════════
  await userSvc.createUser({ fullName: 'NV Sales Ngành', username: 'salesngh', password: 'Sales@123456', roleCodes: ['SALES'] }).catch(() => undefined);
  await logout();
  await login('salesngh', 'Sales@123456');
  const beforeDenyAudit = await auditCount(db, 'PERMISSION_DENIED');
  ok('SAI SALES list → FORBIDDEN', (await ind.listIndustries()).error === 'FORBIDDEN');
  ok('SAI SALES tạo → FORBIDDEN', (await ind.createIndustry({ name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES sửa → FORBIDDEN', (await ind.updateIndustry(ids[3], { name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES xóa → FORBIDDEN', (await ind.deleteIndustries([ids[3]], PW)).error === 'FORBIDDEN');
  ok('audit PERMISSION_DENIED tăng ≥ 3 (list không audit)', (await auditCount(db, 'PERMISSION_DENIED')) >= beforeDenyAudit + 3);
  await logout();

  // ═══════════ "DB tiến hóa" — quyền mới cho role CŨ (H7) ═══════════
  await login('adminroot', PW);
  // (1) ADMIN (superuser-sync mỗi boot) đã có ĐỦ 4 quyền industry ngay lập tức.
  const admin = me();
  ok('ADMIN có đủ 4 quyền industry (superuser-sync)', INDUSTRY_PERMS.every((p) => hasPermission(admin, p)), admin?.permissions.filter((p) => p.startsWith('CONFIG_INDUSTRY')));

  // (2) Mô phỏng DB CŨ: MANAGER từng tồn tại TRƯỚC khi có quyền industry → gỡ hết 4 quyền của MANAGER.
  const mgr = await db.role.findUniqueOrThrow({ where: { code: 'MANAGER' }, select: { id: true } });
  const permRows = await db.permission.findMany({ where: { code: { in: INDUSTRY_PERMS } }, select: { id: true } });
  await db.rolePermission.deleteMany({ where: { roleId: mgr.id, permissionId: { in: permRows.map((p) => p.id) } } });
  const lacksAll = (await Promise.all(INDUSTRY_PERMS.map((p) => roleHasPerm(db, 'MANAGER', p)))).every((h) => h === false);
  ok('mô phỏng DB cũ: MANAGER KHÔNG có quyền industry', lacksAll);

  // (3) Chạy bước cấp quyền db-evolution → MANAGER phải được cấp lại đủ 4.
  const granted = await grantIndustryPermsToExistingRoles(db);
  ok('grantIndustryPermsToExistingRoles cấp 4 quyền cho MANAGER', granted === 4, { granted });
  const hasAll = (await Promise.all(INDUSTRY_PERMS.map((p) => roleHasPerm(db, 'MANAGER', p)))).every((h) => h === true);
  ok('sau grant: MANAGER có ĐỦ 4 quyền industry', hasAll);

  // (4) Idempotent: chạy lại → 0 (không nhân đôi, không lỗi).
  ok('chạy lại grant = 0 (idempotent)', (await grantIndustryPermsToExistingRoles(db)) === 0);
  await logout();

  // eslint-disable-next-line no-console
  console.log(`INDUSTRY SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
