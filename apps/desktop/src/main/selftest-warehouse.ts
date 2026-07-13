// R27 Danh mục Kho self-test (headless, GLB_SELFTEST=40). Drives the REAL service layer against a
// throwaway DB (GLB_DB_URL). Chứng minh:
//   • CRUD kho + validate mã/tên + DUPLICATE + optimistic-lock (stale → STALE_WRITE)
//   • lite chỉ trả kho ACTIVE; xóa cần đúng mật khẩu
//   • DB-tiến-hóa (bug class test còn nợ): gỡ quyền kho khỏi role CŨ → grantWarehousePermsToExistingRoles
//     cấp lại (MANAGER/WAREHOUSE view+manage, D_MANAGER chỉ view) — idempotent
//   • WIRE giao máy: deploy/changeCustomer với fromWarehouseId → AssetEvent ghi kho + SNAPSHOT địa chỉ,
//     getDeviceTimeline trả warehouseName + deliveryAddress (chọn kho → hiện địa chỉ)
//   • non-permission → FORBIDDEN
import { login, logout } from './auth-service.js';
import { getDb, grantWarehousePermsToExistingRoles } from './db.js';
import * as whSvc from './warehouse-service.js';
import * as posSvc from './pos-service.js';
import * as customerSvc from './customer-service.js';
import * as userSvc from './user-service.js';
import * as tidCfgSvc from './tid-config-service.js';

let failures = 0;
function assert(name: string, cond: boolean, extra?: unknown): void {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  // eslint-disable-next-line no-console
  console.log(`WAREHOUSE40 ${status} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

export async function runWarehouseSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', 'Admin@123456');

  // ── CRUD + validate ──────────────────────────────────────────────────────
  const noCode = await whSvc.createWarehouse({ code: '', name: 'Kho X' });
  assert('thiếu mã kho → VALIDATION', noCode.ok === false && noCode.error === 'VALIDATION');
  const noName = await whSvc.createWarehouse({ code: 'KHO-HN', name: '' });
  assert('thiếu tên kho → VALIDATION', noName.ok === false && noName.error === 'VALIDATION');

  const w1 = await whSvc.createWarehouse({ code: 'kho-hn', name: 'Kho Hà Nội', address: '12 Láng Hạ, Hà Nội', phone: '0900000001' });
  assert('tạo kho ok', w1.ok === true, w1.error);
  const w1row = await db.warehouse.findUnique({ where: { id: w1.id! } });
  assert('mã kho lưu UPPERCASE', w1row?.code === 'KHO-HN', { code: w1row?.code });
  const dup = await whSvc.createWarehouse({ code: 'KHO-HN', name: 'Trùng' });
  assert('trùng mã kho → DUPLICATE', dup.ok === false && dup.error === 'DUPLICATE');

  const w2 = await whSvc.createWarehouse({ code: 'KHO-HCM', name: 'Kho Hồ Chí Minh', address: '99 CMT8, Q3' });
  assert('tạo kho 2 ok', w2.ok === true, w2.error);

  const list = await whSvc.listWarehouses({});
  assert('list có 2 kho', (list.data ?? []).length >= 2 && (list.data ?? []).some((w) => w.code === 'KHO-HN'));
  const lite = await whSvc.listWarehousesLite();
  assert('lite có KHO-HN kèm địa chỉ', (lite.data ?? []).some((w) => w.code === 'KHO-HN' && w.address === '12 Láng Hạ, Hà Nội'));

  // ── optimistic-lock ──────────────────────────────────────────────────────
  const staleTs = new Date(Date.now() - 60000).toISOString();
  const staleUpd = await whSvc.updateWarehouse(w1.id!, { address: 'ghi đè', expectedUpdatedAt: staleTs });
  assert('sửa với mốc CŨ → STALE_WRITE', staleUpd.ok === false && staleUpd.error === 'STALE_WRITE', { err: staleUpd.error });
  const fresh = await db.warehouse.findUnique({ where: { id: w1.id! } });
  const okUpd = await whSvc.updateWarehouse(w1.id!, { address: '12 Láng Hạ (mới)', expectedUpdatedAt: fresh!.updatedAt.toISOString() });
  assert('sửa với mốc ĐÚNG → ok', okUpd.ok === true, okUpd.error);
  const noTsUpd = await whSvc.updateWarehouse(w1.id!, { phone: '0911111111' });
  assert('sửa KHÔNG gửi mốc → ok (tương thích ngược)', noTsUpd.ok === true, noTsUpd.error);

  // INACTIVE rơi khỏi lite
  await whSvc.updateWarehouse(w2.id!, { status: 'INACTIVE' });
  const lite2 = await whSvc.listWarehousesLite();
  assert('kho INACTIVE không xuất hiện trong lite', !(lite2.data ?? []).some((w) => w.code === 'KHO-HCM'));

  // ── xóa cần mật khẩu ─────────────────────────────────────────────────────
  const delBad = await whSvc.deleteWarehouses([w2.id!], 'sai-mat-khau');
  assert('xóa sai mật khẩu → WRONG_PASSWORD', delBad.ok === false && delBad.error === 'WRONG_PASSWORD');
  const delOk = await whSvc.deleteWarehouses([w2.id!], 'Admin@123456');
  assert('xóa đúng mật khẩu → ok', delOk.ok === true && delOk.deleted === 1, delOk);
  const afterDel = await db.warehouse.findUnique({ where: { id: w2.id! } });
  assert('kho đã xóa mềm (deletedAt set)', afterDel?.deletedAt != null);

  // ── DB-tiến-hóa: cấp quyền kho cho role CŨ (đóng nợ test class) ────────────
  const mgr = await db.role.findUnique({ where: { code: 'MANAGER' } });
  const dmgr = await db.role.findUnique({ where: { code: 'D_MANAGER' } });
  const permView = await db.permission.findUnique({ where: { code: 'CONFIG_WAREHOUSE_VIEW' } });
  const permManage = await db.permission.findUnique({ where: { code: 'CONFIG_WAREHOUSE_MANAGE' } });
  if (mgr && dmgr && permView && permManage) {
    // Gỡ quyền kho khỏi MANAGER + D_MANAGER (mô phỏng DB tạo trước feature kho).
    await db.rolePermission.deleteMany({ where: { roleId: mgr.id, permissionId: { in: [permView.id, permManage.id] } } });
    await db.rolePermission.deleteMany({ where: { roleId: dmgr.id, permissionId: { in: [permView.id, permManage.id] } } });
    const granted = await grantWarehousePermsToExistingRoles(db);
    assert('grant cấp lại quyền kho (granted > 0)', granted >= 3, { granted });
    const mgrView = await db.rolePermission.findFirst({ where: { roleId: mgr.id, permissionId: permView.id } });
    const mgrManage = await db.rolePermission.findFirst({ where: { roleId: mgr.id, permissionId: permManage.id } });
    assert('MANAGER được cấp CẢ view+manage', mgrView != null && mgrManage != null);
    const dmgrView = await db.rolePermission.findFirst({ where: { roleId: dmgr.id, permissionId: permView.id } });
    const dmgrManage = await db.rolePermission.findFirst({ where: { roleId: dmgr.id, permissionId: permManage.id } });
    assert('D_MANAGER chỉ được view (KHÔNG manage)', dmgrView != null && dmgrManage == null, { view: dmgrView != null, manage: dmgrManage != null });
    const granted2 = await grantWarehousePermsToExistingRoles(db);
    assert('grant chạy lại idempotent (granted2 = 0)', granted2 === 0, { granted2 });
  }

  // ── WIRE giao máy: deploy/changeCustomer ghi kho + snapshot địa chỉ ────────
  const c1 = await customerSvc.createCustomer({ fullName: 'WH Khách 1', nickname: 'WH Khách 1' });
  const c2 = await customerSvc.createCustomer({ fullName: 'WH Khách 2', nickname: 'WH Khách 2' });
  const serial = 'SN-WH-1';
  await posSvc.createPos({ serial, occurredAt: '2026-06-01T09:00:00Z' });
  const dep = await posSvc.deployPos(serial, { customerId: c1.id!, fromWarehouseId: w1.id!, occurredAt: '2026-06-02T09:00:00Z', note: 'giao từ kho HN' });
  assert('deploy kèm Từ kho ok', dep.ok === true, dep.error);
  const tl1 = await posSvc.getDeviceTimeline(serial);
  const depEv = (tl1.data ?? []).find((e) => e.eventType === 'DEPLOY');
  assert('sự kiện DEPLOY ghi fromWarehouseId', depEv?.fromWarehouseId === w1.id, { got: depEv?.fromWarehouseId });
  assert('DEPLOY có warehouseName (MÃ · Tên)', depEv?.warehouseName === 'KHO-HN · Kho Hà Nội', { got: depEv?.warehouseName });
  assert('DEPLOY snapshot địa chỉ kho lúc giao', depEv?.deliveryAddress === '12 Láng Hạ (mới)', { got: depEv?.deliveryAddress });

  // đổi địa chỉ kho SAU khi giao → snapshot cũ KHÔNG đổi (bằng chứng snapshot)
  await whSvc.updateWarehouse(w1.id!, { address: 'ĐỊA CHỈ ĐỔI SAU' });
  const tl1b = await posSvc.getDeviceTimeline(serial);
  const depEv2 = (tl1b.data ?? []).find((e) => e.eventType === 'DEPLOY');
  assert('snapshot địa chỉ giao KHÔNG đổi khi kho sửa địa chỉ sau', depEv2?.deliveryAddress === '12 Láng Hạ (mới)', { got: depEv2?.deliveryAddress });

  const chg = await posSvc.changeCustomerPos(serial, { customerId: c2.id!, fromWarehouseId: w1.id!, occurredAt: '2026-06-03T09:00:00Z' });
  assert('đổi khách kèm Từ kho ok', chg.ok === true, chg.error);
  const tl2 = await posSvc.getDeviceTimeline(serial);
  const chgEv = (tl2.data ?? []).find((e) => e.eventType === 'CHANGE_CUSTOMER');
  assert('CHANGE_CUSTOMER ghi kho + địa chỉ mới snapshot', chgEv?.fromWarehouseId === w1.id && chgEv?.deliveryAddress === 'ĐỊA CHỈ ĐỔI SAU', { wh: chgEv?.fromWarehouseId, addr: chgEv?.deliveryAddress });

  // kho không tồn tại → NOT_FOUND (máy đang DEPLOYED giữ c2 → đổi sang c1 với kho rác)
  const ghost = await posSvc.changeCustomerPos(serial, { customerId: c1.id!, fromWarehouseId: 999999, occurredAt: '2026-06-04T09:00:00Z' });
  assert('giao với kho không tồn tại → NOT_FOUND', ghost.ok === false && ghost.error === 'NOT_FOUND', { err: ghost.error });

  // ══ Nhóm 1 (Mr.Long 12/7) — §4 kho gán User quản lý (địa chỉ/SĐT theo hồ sơ user) ══
  const mgrUser = await userSvc.createUser({ fullName: 'WH Quản Lý', phone: '0900000942', address: '88 Trần Duy Hưng, Hà Nội', email: null, username: 'whmgr001', password: 'Pass@1234', roleCodes: ['WAREHOUSE'] });
  assert('tạo user quản lý kho ok', mgrUser.ok === true, mgrUser.error);
  const whMgr = await whSvc.createWarehouse({ code: 'KHO-MGR', name: 'Kho theo user', managerUserId: mgrUser.id! });
  assert('tạo kho gán user quản lý ok', whMgr.ok === true, whMgr.error);
  const listMgr = (await whSvc.listWarehouses({})).data?.find((w) => w.id === whMgr.id);
  assert('§4 kho gán user → địa chỉ lấy từ hồ sơ user', listMgr?.address === '88 Trần Duy Hưng, Hà Nội', { addr: listMgr?.address });
  assert('§4 kho gán user → SĐT lấy từ hồ sơ user', listMgr?.phone === '0900000942', { phone: listMgr?.phone });
  assert('§4 kho gán user → tên user quản lý hiển thị', listMgr?.managerUserName === 'WH Quản Lý', { n: listMgr?.managerUserName });
  const liteMgr = (await whSvc.listWarehousesLite()).data?.find((w) => w.id === whMgr.id);
  assert('§4 lite kho gán user → địa chỉ theo user (dùng khi giao máy)', liteMgr?.address === '88 Trần Duy Hưng, Hà Nội', { addr: liteMgr?.address });
  const badMgr = await whSvc.createWarehouse({ code: 'KHO-BADMGR', name: 'x', managerUserId: 999999 });
  assert('§4 gán user quản lý không tồn tại → NOT_FOUND', badMgr.ok === false && badMgr.error === 'NOT_FOUND', badMgr.error);

  // ══ Nhóm 1 §5 — GIAO máy cho khách BẮT BUỘC máy ở kho CÓ ĐỊA CHỈ cụ thể (enforce backend) ══
  const whNoAddr = await whSvc.createWarehouse({ code: 'KHO-NOADDR', name: 'Kho không địa chỉ' });
  const cust5 = await customerSvc.createCustomer({ fullName: 'WH Khách 5', nickname: 'WH Khách 5' });
  await posSvc.createPos({ serial: 'SN-WH-5', occurredAt: '2026-06-01T09:00:00Z' });
  const depNoWh = await posSvc.deployPos('SN-WH-5', { customerId: cust5.id!, occurredAt: '2026-06-02T09:00:00Z' });
  assert('§5 giao máy KHÔNG chọn kho → chặn NO_WAREHOUSE', depNoWh.ok === false && depNoWh.error === 'NO_WAREHOUSE', { err: depNoWh.error });
  const depNoAddr = await posSvc.deployPos('SN-WH-5', { customerId: cust5.id!, fromWarehouseId: whNoAddr.id!, occurredAt: '2026-06-02T10:00:00Z' });
  assert('§5 giao máy từ kho KHÔNG địa chỉ → chặn WAREHOUSE_NO_ADDRESS', depNoAddr.ok === false && depNoAddr.error === 'WAREHOUSE_NO_ADDRESS', { err: depNoAddr.error });
  const depAddr = await posSvc.deployPos('SN-WH-5', { customerId: cust5.id!, fromWarehouseId: w1.id!, occurredAt: '2026-06-02T11:00:00Z' });
  assert('§5 giao máy từ kho CÓ địa chỉ → ok', depAddr.ok === true, depAddr.error);
  // kho gán user quản lý KHÔNG địa chỉ → cũng chặn (địa chỉ hiệu lực rỗng)
  const mgrNoAddr = await userSvc.createUser({ fullName: 'WH QL Không ĐC', phone: '0900000943', email: null, username: 'whmgr002', password: 'Pass@1234', roleCodes: ['WAREHOUSE'] });
  const whMgrNoAddr = await whSvc.createWarehouse({ code: 'KHO-MGRNOADDR', name: 'Kho user không ĐC', managerUserId: mgrNoAddr.id! });
  await posSvc.createPos({ serial: 'SN-WH-6', occurredAt: '2026-06-01T09:00:00Z' });
  const depMgrNoAddr = await posSvc.deployPos('SN-WH-6', { customerId: cust5.id!, fromWarehouseId: whMgrNoAddr.id!, occurredAt: '2026-06-02T12:00:00Z' });
  assert('§5 kho gán user quản lý KHÔNG địa chỉ → chặn WAREHOUSE_NO_ADDRESS', depMgrNoAddr.ok === false && depMgrNoAddr.error === 'WAREHOUSE_NO_ADDRESS', { err: depMgrNoAddr.error });

  // ══ Nhóm 1 §1 — sửa HỒ SƠ máy POS full-field (updatePos) ══
  const dev5Id = (await db.posDevice.findUnique({ where: { serial: 'SN-WH-5' } }))!.id;
  const upd = await posSvc.updatePos(dev5Id, { model: 'PAX A920', importPrice: 3_500_000, note: 'hồ sơ sửa' });
  assert('§1 updatePos hồ sơ ok', upd.ok === true, upd.error);
  const dev5 = await db.posDevice.findUnique({ where: { serial: 'SN-WH-5' } });
  assert('§1 updatePos ghi model/giá/ghi chú', dev5?.model === 'PAX A920' && dev5?.importPrice === 3_500_000 && dev5?.note === 'hồ sơ sửa', { m: dev5?.model, p: dev5?.importPrice });

  // ══ Nhóm 1 §1 — sửa FULL thông tin TID (updateConfigTid mở rộng: ngành nghề + MID + ghi chú) ══
  const bankT = await db.bank.create({ data: { code: 'WHBANK', name: 'NH Kho Test' } });
  const partnerT = await db.partner.create({ data: { code: 'WHPTN', name: 'Đối tác Kho Test' } });
  const indT = await db.industry.create({ data: { code: 'WHIND', name: 'Ngành Test', active: true } });
  const cfgCreate = await tidCfgSvc.createConfigTid({ tid: 'WH-TID-CFG', bankId: bankT.id, partnerId: partnerT.id, hkdName: 'HKD Kho Test' });
  assert('§1 tạo TID cấu hình ok', cfgCreate.ok === true, cfgCreate.error);
  const cfgUpd = await tidCfgSvc.updateConfigTid(cfgCreate.id!, { tid: 'WH-TID-CFG', bankId: bankT.id, partnerId: partnerT.id, hkdName: 'HKD Kho Test SỬA', industryId: indT.id, mid: 'MID-999', note: 'ghi chú sửa' });
  assert('§1 updateConfigTid full-field ok', cfgUpd.ok === true, cfgUpd.error);
  const tidRow = await db.tid.findUnique({ where: { id: cfgCreate.id! } });
  assert('§1 updateConfigTid ghi ngành nghề + MID + HKD + ghi chú', tidRow?.industryId === indT.id && tidRow?.mid === 'MID-999' && tidRow?.hkdName === 'HKD Kho Test SỬA' && tidRow?.note === 'ghi chú sửa', { ind: tidRow?.industryId, mid: tidRow?.mid });

  // ── non-permission → FORBIDDEN ───────────────────────────────────────────
  await userSvc.createUser({ fullName: 'WH Sales', phone: '0900000940', email: null, username: 'whsales01', password: 'Pass@1234', roleCodes: ['SALES'] });
  await logout();
  await login('whsales01', 'Pass@1234');
  const salesCreate = await whSvc.createWarehouse({ code: 'HACK-KHO', name: 'x' });
  assert('SALES không tạo được kho → FORBIDDEN', salesCreate.ok === false && salesCreate.error === 'FORBIDDEN', salesCreate.error);
  const salesList = await whSvc.listWarehouses({});
  assert('SALES không xem được kho → FORBIDDEN', salesList.ok === false && salesList.error === 'FORBIDDEN');
  const salesUpdPos = await posSvc.updatePos(dev5Id, { note: 'hack' });
  assert('§1 SALES không sửa được hồ sơ máy → FORBIDDEN', salesUpdPos.ok === false && salesUpdPos.error === 'FORBIDDEN', salesUpdPos.error);
  await logout();

  // eslint-disable-next-line no-console
  console.log(`WAREHOUSE40 SUMMARY | failures=${failures}`);
  return failures === 0 ? 0 : 1;
}
