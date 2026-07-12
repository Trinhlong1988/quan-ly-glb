// PHASE K1 — Hợp nhất POS integration self-test (headless, GLB_SELFTEST=29). Drives the REAL service
// layer against a throwaway Postgres DB (GLB_DB_URL + GLB_ROLE=server) to prove the K1 rules:
//   (1) createPosIntake tạo PosDevice IN_STOCK + AssetEvent(STOCK_IN) + hiện ở listPosDevices (desync #22)
//   (2) gán TID lên máy VỪA nhập kho chạy được → máy DEPLOYED + currentTid, event TID_ASSIGN đủ field
//   (3) backfillPosDevicesFromIntakes idempotent (chạy 2 lần KHÔNG nhân đôi PosDevice/STOCK_IN)
//   (4) recallPos GỠ currentTid (TID về "chưa gán máy"); retirePos BẮT BUỘC gỡ + đóng TID (RECALLED);
//       reportDamage/sendRepair GIỮ currentTid (Q-P6)
//   (5) concurrency: 2 createPosIntake cùng serial → 1 thắng, KHÔNG tạo 2 PosDevice/2 PosIntake
//   (6) MỌI máy đều có ≥1 AssetEvent STOCK_IN (timeline gốc)
import { login, logout } from './auth-service.js';
import { getDb, backfillPosDevicesFromIntakes } from './db.js';
import * as customerSvc from './customer-service.js';
import * as posSvc from './pos-service.js';
import * as tidSvc from './tid-service.js';
import * as supplySvc from './pos-supply-service.js';
import * as warehouseSvc from './warehouse-service.js';

let failures = 0;
function assert(name: string, cond: boolean, extra?: unknown): void {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  // eslint-disable-next-line no-console
  console.log(`SELFTEST29 ${status} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

const ADMIN = { u: 'adminroot', p: 'Admin@123456' };

export async function runPosUnifySelfTest(): Promise<number> {
  const db = getDb();
  await login(ADMIN.u, ADMIN.p);

  // ── Master data ────────────────────────────────────────────────────────
  const model = await supplySvc.createPosModel({ code: 'PM-K1', name: 'Máy POS K1' });
  const supplier = await supplySvc.createSupplier({ code: 'SUP-K1', name: 'NCC K1' });
  assert('master data created', model.ok && supplier.ok, { model: model.error, supplier: supplier.error });
  const modelId = model.id!;
  const supplierId = supplier.id!;
  const statuses = await supplySvc.listIntakeStatuses();
  const statusId = statuses.data?.[0]?.id;
  assert('seeded intake status available', typeof statusId === 'number', { count: statuses.data?.length });
  const cust = await customerSvc.createCustomer({ fullName: 'Khách K1', nickname: 'Anh K1' });
  const customerId = cust.id!;
  assert('customer created', cust.ok, cust.error);

  // ── (1) createPosIntake → PosDevice IN_STOCK + STOCK_IN + hiện ở list ───
  const s1 = 'SN-K1-001';
  const i1 = await supplySvc.createPosIntake({ posModelId: modelId, serial: s1, intakeStatusId: statusId!, supplierId, importPrice: 1_500_000, importedAt: '2026-07-01' });
  assert('createPosIntake ok', i1.ok, i1.error);
  const dev1 = await db.posDevice.findUnique({ where: { serial: s1 } });
  assert('intake → PosDevice IN_STOCK', dev1?.status === 'IN_STOCK', { status: dev1?.status });
  assert('PosDevice điền cột nhập (model/NCC/giá/ngày)', dev1?.posModelId === modelId && dev1?.supplierId === supplierId && dev1?.importPrice === 1_500_000 && dev1?.importedAt != null);
  const stockIn1 = await db.assetEvent.findMany({ where: { deviceSerial: s1, eventType: 'STOCK_IN' } });
  assert('đúng 1 AssetEvent STOCK_IN', stockIn1.length === 1, { count: stockIn1.length });
  const list1 = await posSvc.listPosDevices({ search: s1 });
  assert('máy nhập kho HIỆN ở listPosDevices (desync #22 fixed)', list1.ok === true && (list1.data ?? []).some((d) => d.serial === s1));

  // ── (2) gán TID lên máy vừa nhập kho ───────────────────────────────────
  await tidSvc.createTid({ tid: 'TID-K1-001' });
  const assign = await tidSvc.assignTid('TID-K1-001', { posSerial: s1, customerId, occurredAt: '2026-07-02' });
  assert('assign TID lên máy vừa nhập kho chạy được', assign.ok === true, assign.error);
  const dev1b = await db.posDevice.findUnique({ where: { serial: s1 } });
  assert('máy IN_STOCK → DEPLOYED + currentTid sau gán', dev1b?.status === 'DEPLOYED' && dev1b?.currentTid === 'TID-K1-001', { status: dev1b?.status, tid: dev1b?.currentTid });
  const assignEvt = await db.assetEvent.findFirst({ where: { deviceSerial: s1, eventType: 'TID_ASSIGN' } });
  assert('TID_ASSIGN event đủ deviceSerial/tid/customerId', assignEvt?.tid === 'TID-K1-001' && assignEvt?.customerId === customerId && assignEvt?.deviceSerial === s1);

  // ── (4a) reportDamage / sendRepair GIỮ currentTid (Q-P6) ───────────────
  const dmg = await posSvc.reportPosDamage(s1, { occurredAt: '2026-07-03' });
  assert('reportDamage ok', dmg.ok === true, dmg.error);
  const devDmg = await db.posDevice.findUnique({ where: { serial: s1 } });
  assert('reportDamage GIỮ currentTid (Q-P6)', devDmg?.status === 'DAMAGED' && devDmg?.currentTid === 'TID-K1-001', { status: devDmg?.status, tid: devDmg?.currentTid });
  const snd = await posSvc.sendPosRepair(s1, { occurredAt: '2026-07-04' });
  assert('sendRepair ok', snd.ok === true, snd.error);
  const devSnd = await db.posDevice.findUnique({ where: { serial: s1 } });
  assert('sendRepair GIỮ currentTid (Q-P6)', devSnd?.status === 'IN_REPAIR' && devSnd?.currentTid === 'TID-K1-001', { status: devSnd?.status, tid: devSnd?.currentTid });

  // ── (4b) recallPos GỠ currentTid (TID về "chưa gán máy") ───────────────
  const s2 = 'SN-K1-002';
  await supplySvc.createPosIntake({ posModelId: modelId, serial: s2, intakeStatusId: statusId!, supplierId, importPrice: 1_200_000, importedAt: '2026-07-01' });
  await tidSvc.createTid({ tid: 'TID-K1-002' });
  await tidSvc.assignTid('TID-K1-002', { posSerial: s2, customerId, occurredAt: '2026-07-02' });
  const whU = await warehouseSvc.createWarehouse({ code: 'PUK0', name: 'Kho PosUnify' }); // Model 1 — thu hồi BẮT BUỘC có kho
  const recall = await posSvc.recallPos(s2, { toWarehouseId: whU.id!, occurredAt: '2026-07-05' });
  assert('recallPos ok', recall.ok === true, recall.error);
  const devRec = await db.posDevice.findUnique({ where: { serial: s2 } });
  assert('recallPos: máy về IN_STOCK + currentTid=null', devRec?.status === 'IN_STOCK' && devRec?.currentTid === null, { status: devRec?.status, tid: devRec?.currentTid });
  const tidRec = await db.tid.findUnique({ where: { tid: 'TID-K1-002' } });
  assert('recallPos: TID gỡ khỏi máy (posSerial=null), GIỮ sống', tidRec?.posSerial === null && tidRec?.status === 'ACTIVE', { posSerial: tidRec?.posSerial, status: tidRec?.status });
  const unbindEvt = await db.assetEvent.findFirst({ where: { tid: 'TID-K1-002', eventType: 'TID_UNBIND' } });
  assert('recallPos ghi AssetEvent TID_UNBIND', !!unbindEvt);
  const openBind2 = await db.posTidBinding.findFirst({ where: { tid: 'TID-K1-002', unboundAt: null } });
  assert('recallPos đóng PosTidBinding', openBind2 === null);

  // ── FIX 1 REGRESSION: TID thu hồi khỏi máy PHẢI lắp lại được máy khác (spec §2.5) ──────
  // (a) TID-K1-002 (ACTIVE, posSerial=null sau recallPos) → gán sang máy B IN_STOCK PHẢI ok.
  const s2b = 'SN-K1-002B';
  await supplySvc.createPosIntake({ posModelId: modelId, serial: s2b, intakeStatusId: statusId!, supplierId, importPrice: 1_000_000, importedAt: '2026-07-01' });
  const reassign = await tidSvc.assignTid('TID-K1-002', { posSerial: s2b, customerId, occurredAt: '2026-07-06' });
  assert('FIX1(a): TID thu hồi khỏi máy gán LẠI được máy khác', reassign.ok === true, reassign.error);
  const devB = await db.posDevice.findUnique({ where: { serial: s2b } });
  const tid002 = await db.tid.findUnique({ where: { tid: 'TID-K1-002' } });
  assert('FIX1(a): máy B → DEPLOYED + currentTid, TID.posSerial=B', devB?.status === 'DEPLOYED' && devB?.currentTid === 'TID-K1-002' && tid002?.posSerial === s2b, { statusB: devB?.status, posSerial: tid002?.posSerial });

  // (b) TID đang GẮN trên máy (posSerial!=null) → gán máy khác → reject TID_ON_DEVICE.
  const s2c = 'SN-K1-002C';
  await supplySvc.createPosIntake({ posModelId: modelId, serial: s2c, intakeStatusId: statusId!, supplierId, importPrice: 800_000, importedAt: '2026-07-01' });
  const onDevice = await tidSvc.assignTid('TID-K1-002', { posSerial: s2c, customerId, occurredAt: '2026-07-06' });
  assert('FIX1(b): TID đang trên máy → gán máy khác bị chặn TID_ON_DEVICE', onDevice.ok === false && onDevice.error === 'TID_ON_DEVICE', { error: onDevice.error });

  // (c) TID DEAD/CLOSED/RECALLED → gán → reject (INVALID_STATE ở state machine).
  const sRec = 'SN-K1-REC';
  await supplySvc.createPosIntake({ posModelId: modelId, serial: sRec, intakeStatusId: statusId!, supplierId, importPrice: 700_000, importedAt: '2026-07-01' });
  await tidSvc.createTid({ tid: 'TID-K1-REC' });
  await tidSvc.assignTid('TID-K1-REC', { posSerial: sRec, customerId, occurredAt: '2026-07-02' });
  await tidSvc.recallTid('TID-K1-REC', { occurredAt: '2026-07-03' }); // TID → RECALLED
  const sRecFree = 'SN-K1-RECFREE';
  await supplySvc.createPosIntake({ posModelId: modelId, serial: sRecFree, intakeStatusId: statusId!, supplierId, importPrice: 600_000, importedAt: '2026-07-01' });
  const recalledAssign = await tidSvc.assignTid('TID-K1-REC', { posSerial: sRecFree, customerId, occurredAt: '2026-07-07' });
  assert('FIX1(c): TID RECALLED → gán bị chặn (INVALID_STATE)', recalledAssign.ok === false && recalledAssign.error === 'INVALID_STATE', { error: recalledAssign.error });

  // (d) Chống ô nhiễm query "TID chưa giao": TID-K1-002 đã giao (deliveredAt) → KHÔNG hiện dù status ACTIVE.
  await tidSvc.markTidDelivered('TID-K1-002', { deliveredAt: '2026-07-08' });
  const undel = await tidSvc.listUndeliveredTids();
  const polluted = (undel.data ?? []).some((t) => t.tid === 'TID-K1-002');
  assert('FIX1(d): TID đã giao (ACTIVE, đã gán lại) KHÔNG lọt list "chưa giao"', !polluted, { inUndelivered: polluted });

  // (e) BACK-PORT (K2 hardening): assignTid lên máy ĐANG MANG TID khác → chặn DEVICE_HAS_TID (bất
  //     biến 1 máy 1 TID; chống mồ côi TID + 2 binding mở). s2b hiện DEPLOYED + currentTid=TID-K1-002.
  await tidSvc.createTid({ tid: 'TID-K1-DHT' });
  const devHasTid = await tidSvc.assignTid('TID-K1-DHT', { posSerial: s2b, customerId, occurredAt: '2026-07-09' });
  assert('FIX1(e): gán TID mới lên máy đã có TID → chặn DEVICE_HAS_TID', devHasTid.ok === false && devHasTid.error === 'DEVICE_HAS_TID', { error: devHasTid.error });
  const devS2b = await db.posDevice.findUnique({ where: { serial: s2b } });
  assert('FIX1(e): máy vẫn trỏ TID cũ (TID-K1-002), không mồ côi', devS2b?.currentTid === 'TID-K1-002', { tid: devS2b?.currentTid });
  const openBindS2b = await db.posTidBinding.count({ where: { posSerial: s2b, unboundAt: null } });
  assert('FIX1(e): chỉ 1 binding mở cho máy', openBindS2b === 1, { openBindS2b });

  // ── (4c) retirePos BẮT BUỘC gỡ + đóng TID (RECALLED) ───────────────────
  const s3 = 'SN-K1-003';
  await supplySvc.createPosIntake({ posModelId: modelId, serial: s3, intakeStatusId: statusId!, supplierId, importPrice: 900_000, importedAt: '2026-07-01' });
  await tidSvc.createTid({ tid: 'TID-K1-003' });
  await tidSvc.assignTid('TID-K1-003', { posSerial: s3, customerId, occurredAt: '2026-07-02' });
  const badPw = await posSvc.retirePos(s3, 'wrong-password', {});
  assert('retirePos sai mật khẩu bị chặn', badPw.ok === false && badPw.error === 'WRONG_PASSWORD');
  const retire = await posSvc.retirePos(s3, ADMIN.p, { occurredAt: '2026-07-06' });
  assert('retirePos ok', retire.ok === true, retire.error);
  const devRet = await db.posDevice.findUnique({ where: { serial: s3 } });
  assert('retirePos: máy RETIRED + currentTid=null', devRet?.status === 'RETIRED' && devRet?.currentTid === null, { status: devRet?.status, tid: devRet?.currentTid });
  const tidRet = await db.tid.findUnique({ where: { tid: 'TID-K1-003' } });
  assert('retirePos: TID đóng/thu hồi (RECALLED) + posSerial=null', tidRet?.status === 'RECALLED' && tidRet?.posSerial === null, { status: tidRet?.status, posSerial: tidRet?.posSerial });

  // ── (3) backfill idempotent (legacy intake KHÔNG có PosDevice) ─────────
  // Chèn phiếu nhập trực tiếp (mô phỏng DB cũ tạo qua đường nhập cũ chưa upsert máy).
  await db.posIntake.create({ data: { posModelId: modelId, serial: 'SN-K1-LEGACY', intakeStatusId: statusId!, supplierId, importPrice: 500_000, importedAt: new Date('2026-06-01'), createdBy: null } });
  const r1 = await backfillPosDevicesFromIntakes(db);
  const devL1 = await db.posDevice.findUnique({ where: { serial: 'SN-K1-LEGACY' } });
  assert('backfill tạo PosDevice IN_STOCK từ legacy intake', devL1?.status === 'IN_STOCK' && devL1?.posModelId === modelId, { created: r1.created });
  const r2 = await backfillPosDevicesFromIntakes(db);
  const devCount = await db.posDevice.count({ where: { serial: 'SN-K1-LEGACY' } });
  const stockLegacy = await db.assetEvent.count({ where: { deviceSerial: 'SN-K1-LEGACY', eventType: 'STOCK_IN' } });
  assert('backfill idempotent: KHÔNG nhân đôi PosDevice', devCount === 1, { devCount });
  assert('backfill idempotent: KHÔNG nhân đôi STOCK_IN', stockLegacy === 1, { stockLegacy });
  assert('backfill lần 2 created=0 filled=0 stockInAdded=0', r2.created === 0 && r2.filled === 0 && r2.stockInAdded === 0, r2 as unknown as Record<string, unknown>);
  assert('backfill đối soát serial khớp', r2.intakeSerials === r2.deviceSerials, { intakeSerials: r2.intakeSerials, deviceSerials: r2.deviceSerials });

  // ── (5) concurrency: 2 createPosIntake cùng serial → 1 thắng ───────────
  const sc = 'SN-K1-CONC';
  const [c1, c2] = await Promise.all([
    supplySvc.createPosIntake({ posModelId: modelId, serial: sc, intakeStatusId: statusId!, supplierId, importPrice: 111, importedAt: '2026-07-01' }),
    supplySvc.createPosIntake({ posModelId: modelId, serial: sc, intakeStatusId: statusId!, supplierId, importPrice: 222, importedAt: '2026-07-01' })
  ]);
  const okCount = [c1, c2].filter((r) => r.ok).length;
  assert('concurrency: đúng 1 createPosIntake thắng', okCount === 1, { c1: c1.ok, c2: c2.ok, e1: c1.error, e2: c2.error });
  const concDevices = await db.posDevice.count({ where: { serial: sc } });
  const concIntakes = await db.posIntake.count({ where: { serial: sc } });
  assert('concurrency: KHÔNG tạo 2 PosDevice', concDevices === 1, { concDevices });
  assert('concurrency: KHÔNG tạo 2 PosIntake', concIntakes === 1, { concIntakes });

  // ── (6) MỌI máy đều có ≥1 AssetEvent STOCK_IN ──────────────────────────
  const allDevices = await db.posDevice.findMany({ select: { serial: true } });
  let missingStockIn = 0;
  for (const d of allDevices) {
    const has = await db.assetEvent.findFirst({ where: { deviceSerial: d.serial, eventType: 'STOCK_IN' }, select: { id: true } });
    if (!has) missingStockIn++;
  }
  assert('MỌI máy đều có AssetEvent STOCK_IN', missingStockIn === 0, { devices: allDevices.length, missingStockIn });

  await logout();
  // eslint-disable-next-line no-console
  console.log(`SELFTEST29 SUMMARY | failures=${failures}`);
  return failures === 0 ? 0 : 1;
}
