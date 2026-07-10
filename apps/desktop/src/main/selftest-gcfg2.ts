// G-CFG.2 Cấu hình cung ứng POS — self-test 50 ĐÚNG + 50 SAI (R_LINK_VERIFY, GLB_SELFTEST=5).
// Chạy DB throwaway (GLB_DB_URL). Qua tầng service THẬT: NCC (§C6) · Chủng loại (§C7) ·
// Trạng thái nhập (§C8a) · Nhập kho (§C8b) — map khóa tham chiếu, unique+DUPLICATE_TRASH, permission.
import { login, logout } from './auth-service.js';
import * as userSvc from './user-service.js';
import * as sup from './pos-supply-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`GCFG5 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';

export async function runPosSupplySelfTest(): Promise<number> {
  await login('adminroot', PW);

  // ═══════════ 50 ĐÚNG ═══════════
  // (1) 12 NCC (12)
  const supIds: number[] = [];
  for (let i = 0; i < 12; i++) {
    const r = await sup.createSupplier({ name: `NCC ${i}`, code: `ncc${i}`, phone: `0900${i}` });
    ok(`tạo NCC ncc${i} → ok`, r.ok === true, r);
    if (r.id) supIds.push(r.id);
  }
  ok('list NCC = 12', (await sup.listSuppliers()).data?.length === 12);
  ok('lite NCC = 12', (await sup.listSuppliersLite()).data?.length === 12);
  ok('update NCC[0] → ok', (await sup.updateSupplier(supIds[0], { name: 'NCC đổi tên' })).ok === true);

  // (2) 10 chủng loại (10)
  const modelIds: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await sup.createPosModel({ code: `model${i}`, name: `Máy POS ${i}` });
    ok(`tạo chủng loại model${i} → ok`, r.ok === true, r);
    if (r.id) modelIds.push(r.id);
  }
  ok('list chủng loại = 10', (await sup.listPosModels()).data?.length === 10);
  ok('update chủng loại[0] → ok', (await sup.updatePosModel(modelIds[0], { name: 'Máy đổi tên' })).ok === true);

  // (3) 4 trạng thái nhập — nay SEED sẵn trong seedIfEmpty (seedDefaultIntakeStatusesIfMissing).
  // Test đọc lại 4 bản đã seed (giữ đúng thứ tự tên) thay vì tự tạo (tạo lại = DUPLICATE).
  const statusIds: number[] = [];
  const seededStatuses = (await sup.listIntakeStatuses()).data ?? [];
  for (const nm of ['Máy mới', 'Máy cũ', 'Máy đổi', 'Máy thuê']) {
    const found = seededStatuses.find((s) => s.name === nm);
    ok(`trạng thái "${nm}" đã seed sẵn`, !!found, found);
    if (found) statusIds.push(found.id);
  }
  ok('list trạng thái = 4 (từ seed)', (await sup.listIntakeStatuses()).data?.length === 4);

  // (4) 15 nhập kho (15) — map model/supplier/status vòng
  const intakeIds: number[] = [];
  for (let i = 0; i < 15; i++) {
    const r = await sup.createPosIntake({
      posModelId: modelIds[i % modelIds.length],
      serial: `SN${i}`,
      intakeStatusId: statusIds[i % statusIds.length],
      supplierId: supIds[i % supIds.length],
      importPrice: 5000000 + i * 1000,
      importedAt: '2026-07-01'
    });
    ok(`nhập kho SN${i} → ok`, r.ok === true, r);
    if (r.id) intakeIds.push(r.id);
  }
  ok('list nhập kho = 15', (await sup.listPosIntakes()).data?.length === 15);
  const bySup = await sup.listPosIntakes({ supplierId: supIds[0] });
  ok('lọc nhập kho theo NCC[0] map đúng', (bySup.data?.length ?? 0) > 0 && bySup.data!.every((x) => x.supplierId === supIds[0]), bySup.data?.length);
  ok('nhập kho có join tên chủng loại + NCC + trạng thái', (await sup.listPosIntakes()).data?.[0]?.posModelName != null && (await sup.listPosIntakes()).data?.[0]?.supplierName != null);
  ok('sửa nhập kho[0] chuyển NCC (§C8 b2) → ok', (await sup.updatePosIntake(intakeIds[0], { supplierId: supIds[5] })).ok === true);
  ok('sửa nhập kho[0] giá + ngày → ok', (await sup.updatePosIntake(intakeIds[0], { importPrice: 9999000, importedAt: '2026-06-15' })).ok === true);

  // (5) xóa hợp lệ (đúng mật khẩu) (4)
  ok('xóa NCC[11] (đúng mk) → deleted=1', (await sup.deleteSuppliers([supIds[11]], PW)).deleted === 1);
  ok('sau xóa còn 11 NCC', (await sup.listSuppliers()).data?.length === 11);
  ok('xóa chủng loại[9] → deleted=1', (await sup.deletePosModels([modelIds[9]], PW)).deleted === 1);
  ok('xóa trạng thái[3] → deleted=1', (await sup.deleteIntakeStatuses([statusIds[3]], PW)).deleted === 1);
  ok('xóa nhập kho[14] → deleted=1', (await sup.deletePosIntakes([intakeIds[14]], PW)).deleted === 1);

  // ═══════════ 50 SAI ═══════════
  // (A) NCC (8)
  ok('SAI NCC thiếu tên → VALIDATION', (await sup.createSupplier({ name: ' ', code: 'x' })).error === 'VALIDATION');
  ok('SAI NCC thiếu mã → VALIDATION', (await sup.createSupplier({ name: 'X', code: ' ' })).error === 'VALIDATION');
  ok('SAI NCC trùng mã NCC2 → DUPLICATE', (await sup.createSupplier({ name: 'X', code: 'ncc2' })).error === 'DUPLICATE');
  ok('SAI NCC update không tồn tại → NOT_FOUND', (await sup.updateSupplier(999001, { name: 'Z' })).error === 'NOT_FOUND');
  ok('SAI NCC update tên rỗng → VALIDATION', (await sup.updateSupplier(supIds[1], { name: ' ' })).error === 'VALIDATION');
  ok('SAI NCC update trùng mã NCC3 → DUPLICATE', (await sup.updateSupplier(supIds[1], { code: 'ncc3' })).error === 'DUPLICATE');
  ok('SAI NCC xóa không chọn → VALIDATION', (await sup.deleteSuppliers([], PW)).error === 'VALIDATION');
  ok('SAI NCC xóa sai mật khẩu → WRONG_PASSWORD', (await sup.deleteSuppliers([supIds[2]], 'sai')).error === 'WRONG_PASSWORD');

  // (B) Chủng loại (6)
  ok('SAI chủng loại thiếu mã → VALIDATION', (await sup.createPosModel({ code: ' ', name: 'X' })).error === 'VALIDATION');
  ok('SAI chủng loại thiếu tên → VALIDATION', (await sup.createPosModel({ code: 'X', name: ' ' })).error === 'VALIDATION');
  ok('SAI chủng loại trùng mã MODEL2 → DUPLICATE', (await sup.createPosModel({ code: 'model2', name: 'X' })).error === 'DUPLICATE');
  ok('SAI chủng loại update không tồn tại → NOT_FOUND', (await sup.updatePosModel(999002, { name: 'Z' })).error === 'NOT_FOUND');
  ok('SAI chủng loại update trùng mã MODEL3 → DUPLICATE', (await sup.updatePosModel(modelIds[1], { code: 'model3' })).error === 'DUPLICATE');
  ok('SAI chủng loại xóa sai mật khẩu → WRONG_PASSWORD', (await sup.deletePosModels([modelIds[2]], 'sai')).error === 'WRONG_PASSWORD');

  // (C) Trạng thái (4)
  ok('SAI trạng thái thiếu tên → VALIDATION', (await sup.createIntakeStatus({ name: ' ' })).error === 'VALIDATION');
  ok('SAI trạng thái trùng "Máy mới" → DUPLICATE', (await sup.createIntakeStatus({ name: 'Máy mới' })).error === 'DUPLICATE');
  ok('SAI trạng thái update không tồn tại → NOT_FOUND', (await sup.updateIntakeStatus(999003, { name: 'Z' })).error === 'NOT_FOUND');
  ok('SAI trạng thái xóa sai mật khẩu → WRONG_PASSWORD', (await sup.deleteIntakeStatuses([statusIds[0]], 'sai')).error === 'WRONG_PASSWORD');

  // (D) Nhập kho (12)
  const okRefs = { posModelId: modelIds[0], serial: 'TMP', intakeStatusId: statusIds[0], supplierId: supIds[0], importPrice: 1000, importedAt: '2026-07-01' };
  ok('SAI nhập kho thiếu chủng loại → VALIDATION', (await sup.createPosIntake({ ...okRefs, posModelId: 0, serial: 'A1' })).error === 'VALIDATION');
  ok('SAI nhập kho thiếu seri → VALIDATION', (await sup.createPosIntake({ ...okRefs, serial: ' ' })).error === 'VALIDATION');
  ok('SAI nhập kho thiếu trạng thái → VALIDATION', (await sup.createPosIntake({ ...okRefs, intakeStatusId: 0, serial: 'A2' })).error === 'VALIDATION');
  ok('SAI nhập kho thiếu NCC → VALIDATION', (await sup.createPosIntake({ ...okRefs, supplierId: 0, serial: 'A3' })).error === 'VALIDATION');
  ok('SAI nhập kho giá âm → VALIDATION', (await sup.createPosIntake({ ...okRefs, importPrice: -5, serial: 'A4' })).error === 'VALIDATION');
  ok('SAI nhập kho giá không nguyên → VALIDATION', (await sup.createPosIntake({ ...okRefs, importPrice: 1.5, serial: 'A5' })).error === 'VALIDATION');
  ok('SAI nhập kho ngày sai → VALIDATION', (await sup.createPosIntake({ ...okRefs, importedAt: 'xx/yy/zz', serial: 'A6' })).error === 'VALIDATION');
  ok('SAI nhập kho chủng loại không tồn tại → NOT_FOUND', (await sup.createPosIntake({ ...okRefs, posModelId: 999004, serial: 'A7' })).error === 'NOT_FOUND');
  ok('SAI nhập kho NCC không tồn tại → NOT_FOUND', (await sup.createPosIntake({ ...okRefs, supplierId: 999005, serial: 'A8' })).error === 'NOT_FOUND');
  ok('SAI nhập kho trạng thái không tồn tại → NOT_FOUND', (await sup.createPosIntake({ ...okRefs, intakeStatusId: 999006, serial: 'A9' })).error === 'NOT_FOUND');
  ok('SAI nhập kho trùng seri SN0 → DUPLICATE', (await sup.createPosIntake({ ...okRefs, serial: 'SN0' })).error === 'DUPLICATE');
  ok('SAI nhập kho update không tồn tại → NOT_FOUND', (await sup.updatePosIntake(999007, { serial: 'Z' })).error === 'NOT_FOUND');

  // (E) DUPLICATE_TRASH — tái tạo mã/seri đang trong Thùng rác (3)
  ok('SAI tái tạo mã NCC đã xóa (ncc11) → DUPLICATE_TRASH', (await sup.createSupplier({ name: 'X', code: 'ncc11' })).error === 'DUPLICATE_TRASH');
  ok('SAI tái tạo mã chủng loại đã xóa (model9) → DUPLICATE_TRASH', (await sup.createPosModel({ code: 'model9', name: 'X' })).error === 'DUPLICATE_TRASH');
  ok('SAI tái tạo seri đã xóa (SN14) → DUPLICATE_TRASH', (await sup.createPosIntake({ ...okRefs, serial: 'SN14' })).error === 'DUPLICATE_TRASH');

  // (F) Không quyền: SALES → FORBIDDEN toàn bộ (17)
  await userSvc.createUser({ fullName: 'NV Sales Supply', username: 'salessupply', password: 'Sales@123456', roleCodes: ['SALES'] }).catch(() => undefined);
  await logout();
  await login('salessupply', 'Sales@123456');
  ok('SAI SALES list NCC → FORBIDDEN', (await sup.listSuppliers()).error === 'FORBIDDEN');
  ok('SAI SALES lite NCC → FORBIDDEN', (await sup.listSuppliersLite()).error === 'FORBIDDEN');
  ok('SAI SALES list chủng loại → FORBIDDEN', (await sup.listPosModels()).error === 'FORBIDDEN');
  ok('SAI SALES lite chủng loại → FORBIDDEN', (await sup.listPosModelsLite()).error === 'FORBIDDEN');
  ok('SAI SALES list trạng thái → FORBIDDEN', (await sup.listIntakeStatuses()).error === 'FORBIDDEN');
  ok('SAI SALES list nhập kho → FORBIDDEN', (await sup.listPosIntakes()).error === 'FORBIDDEN');
  ok('SAI SALES tạo NCC → FORBIDDEN', (await sup.createSupplier({ name: 'X', code: 'zz' })).error === 'FORBIDDEN');
  ok('SAI SALES sửa NCC → FORBIDDEN', (await sup.updateSupplier(supIds[0], { name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES xóa NCC → FORBIDDEN', (await sup.deleteSuppliers([supIds[0]], PW)).error === 'FORBIDDEN');
  ok('SAI SALES tạo chủng loại → FORBIDDEN', (await sup.createPosModel({ code: 'zz', name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES sửa chủng loại → FORBIDDEN', (await sup.updatePosModel(modelIds[0], { name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES xóa chủng loại → FORBIDDEN', (await sup.deletePosModels([modelIds[0]], PW)).error === 'FORBIDDEN');
  ok('SAI SALES tạo trạng thái → FORBIDDEN', (await sup.createIntakeStatus({ name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES xóa trạng thái → FORBIDDEN', (await sup.deleteIntakeStatuses([statusIds[0]], PW)).error === 'FORBIDDEN');
  ok('SAI SALES nhập kho → FORBIDDEN', (await sup.createPosIntake(okRefs)).error === 'FORBIDDEN');
  ok('SAI SALES sửa nhập kho → FORBIDDEN', (await sup.updatePosIntake(intakeIds[1], { serial: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES xóa nhập kho → FORBIDDEN', (await sup.deletePosIntakes([intakeIds[1]], PW)).error === 'FORBIDDEN');
  await logout();

  // eslint-disable-next-line no-console
  console.log(`GCFG5 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
