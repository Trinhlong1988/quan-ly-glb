// PHASE K2 — Hợp nhất TID integration self-test (headless, GLB_SELFTEST=30). Drives the REAL service
// layer against a throwaway Postgres DB (GLB_DB_URL + GLB_ROLE=server) to prove K2 rules:
//   (1) 4 tổ hợp Gán máy × Giao khách đếm/lọc đúng — gồm "chưa gán + đã giao" = máy khách
//   (2) tạo TID chưa gán → assign sau (2 thao tác độc lập)
//   (3) giao khi CHƯA gán (máy khách): customerId + toAgentId + customerDeviceSerial, posSerial null
//   (4) sự kiện Giao (TID_DELIVERED) ghi ĐỦ customerId + toAgentId
//   (5) tidTimeline đủ mốc đúng thứ tự
//   (6) regression assign / replace / recall / deliver còn chạy
//   (7) tương thích K1: recallPos→reassign OK; recallTid→RECALLED→assign FORBIDDEN (INVALID_STATE)
//   (8) "chưa giao" loại DEAD/CLOSED/RECALLED + soft-deleted, khớp badge notification
//   (9) quyền vai: WAREHOUSE tạo (chưa gán) + tidRefs OK, assign/deliver FORBIDDEN; SALES FORBIDDEN
//  (10) D4: recallTid clear posSerial + agentId
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as customerSvc from './customer-service.js';
import * as posSvc from './pos-service.js';
import * as tidSvc from './tid-service.js';
import * as supplySvc from './pos-supply-service.js';
import * as bankSvc from './bank-config-service.js';
import * as userSvc from './user-service.js';
import * as notifySvc from './notification-service.js';

let failures = 0;
function assert(name: string, cond: boolean, extra?: unknown): void {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  // eslint-disable-next-line no-console
  console.log(`SELFTEST30 ${status} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

const ADMIN = { u: 'adminroot', p: 'Admin@123456' };

export async function runTidUnifySelfTest(): Promise<number> {
  const db = getDb();
  await login(ADMIN.u, ADMIN.p);

  // ── Master data ────────────────────────────────────────────────────────
  const bank = await bankSvc.createBank({ name: 'Ngân hàng K2', code: 'BKK2' });
  const bank2 = await bankSvc.createBank({ name: 'Ngân hàng K2b', code: 'BKK2B' });
  const partner = await bankSvc.createPartner({ name: 'Đối tác K2', code: 'PTK2' });
  assert('master bank/partner created', bank.ok && bank2.ok && partner.ok, { bank: bank.error, partner: partner.error });
  const bankId = bank.id!;
  const partnerId = partner.id!;
  const linkRes = await bankSvc.setPartnerBanks(partnerId, [bankId, bank2.id!]);
  assert('liên kết PartnerBank (2 ngân hàng)', linkRes.ok === true, linkRes.error);

  const src = await db.dossierSource.create({ data: { code: 'NGK2' } });
  const dossier = await db.dossier.create({ data: { sourceId: src.id, hkdName: 'HKD Xưởng K2', ownerName: 'Chủ K2' } });
  const agent = await db.agent.create({ data: { name: 'Đại lý K2', code: 'DLK2' } });

  const model = await supplySvc.createPosModel({ code: 'PM-K2', name: 'Máy POS K2' });
  const supplier = await supplySvc.createSupplier({ code: 'SUP-K2', name: 'NCC K2' });
  const statuses = await supplySvc.listIntakeStatuses();
  const statusId = statuses.data?.[0]?.id;
  const modelId = model.id!;
  const supplierId = supplier.id!;
  const cust = await customerSvc.createCustomer({ fullName: 'Khách K2', nickname: 'Anh K2' });
  const customerId = cust.id!;
  assert('master model/supplier/customer created', model.ok && supplier.ok && cust.ok && typeof statusId === 'number');

  const mkDevice = async (serial: string): Promise<void> => {
    await supplySvc.createPosIntake({ posModelId: modelId, serial, intakeStatusId: statusId!, supplierId, importPrice: 1_000_000, importedAt: '2026-07-01' });
  };
  const baseCfg = { hkdName: 'HKD Xưởng K2', dossierId: dossier.id, partnerId, bankId };

  // ── (9-refs) tidRefs endpoint (D1) ─────────────────────────────────────
  const refs = await tidSvc.tidRefs();
  assert('tidRefs OK trả HKD/partner/bank', refs.ok === true && (refs.data?.dossiers.length ?? 0) >= 1 && (refs.data?.partners.length ?? 0) >= 1 && (refs.data?.banks.length ?? 0) >= 2, { d: refs.data?.dossiers.length });
  assert('tidRefs partnerBanks map đúng (2 bank cho đối tác)', (refs.data?.partnerBanks[partnerId] ?? []).length === 2, { link: refs.data?.partnerBanks[partnerId] });

  // ── (1) 4 tổ hợp Gán máy × Giao khách ───────────────────────────────────
  const sA = 'SN-K2-A';
  await mkDevice(sA);
  const cA = await tidSvc.createTidUnified({ tid: 'TID-K2-A', ...baseCfg, assign: { posSerial: sA, customerId }, deliver: { deliveredAt: '2026-07-03', customerId } });
  assert('tạo TID_A (gán + giao)', cA.ok === true, cA.error);

  const sB = 'SN-K2-B';
  await mkDevice(sB);
  const cB = await tidSvc.createTidUnified({ tid: 'TID-K2-B', ...baseCfg, assign: { posSerial: sB, customerId } });
  assert('tạo TID_B (gán, chưa giao)', cB.ok === true, cB.error);

  const cC = await tidSvc.createTidUnified({ tid: 'TID-K2-C', ...baseCfg });
  assert('tạo TID_C (chưa gán, chưa giao)', cC.ok === true, cC.error);

  // TID_D = MÁY CỦA KHÁCH: chưa gán máy ta + đã giao (customerDeviceSerial + toAgentId)
  const cD = await tidSvc.createTidUnified({ tid: 'TID-K2-D', ...baseCfg, customerDeviceSerial: 'CUST-DEV-999', deliver: { deliveredAt: '2026-07-04', customerId, toAgentId: agent.id } });
  assert('tạo TID_D (máy khách: chưa gán + đã giao)', cD.ok === true, cD.error);

  const all = await tidSvc.listTids({ search: 'TID-K2-' });
  const byTid = new Map((all.data ?? []).map((t) => [t.tid, t]));
  const A = byTid.get('TID-K2-A'), B = byTid.get('TID-K2-B'), C = byTid.get('TID-K2-C'), D = byTid.get('TID-K2-D');
  assert('TID_A derive: đã gán + đã giao', A?.deviceAssigned === true && A?.delivered === true, { a: A?.deviceAssigned, d: A?.delivered });
  assert('TID_B derive: đã gán + chưa giao', B?.deviceAssigned === true && B?.delivered === false);
  assert('TID_C derive: chưa gán + chưa giao', C?.deviceAssigned === false && C?.delivered === false);
  assert('TID_D derive: CHƯA gán + ĐÃ giao (máy khách) + posSerial null + customerDeviceSerial', D?.deviceAssigned === false && D?.delivered === true && D?.posSerial === null && D?.customerDeviceSerial === 'CUST-DEV-999', { d: D });

  // Lọc 2 chiều độc lập
  const fAssigned = await tidSvc.listTids({ search: 'TID-K2-', deviceAssigned: true });
  assert('lọc Đã gán máy → A,B', new Set((fAssigned.data ?? []).map((t) => t.tid)).size >= 2 && (fAssigned.data ?? []).every((t) => t.deviceAssigned), { rows: (fAssigned.data ?? []).map((t) => t.tid) });
  const fCustomerMachine = await tidSvc.listTids({ search: 'TID-K2-', deviceAssigned: false, delivered: true });
  assert('lọc (chưa gán + đã giao) → chỉ máy khách TID_D', (fCustomerMachine.data ?? []).some((t) => t.tid === 'TID-K2-D') && (fCustomerMachine.data ?? []).every((t) => !t.deviceAssigned && t.delivered), { rows: (fCustomerMachine.data ?? []).map((t) => t.tid) });

  // ── (3)+(4) sự kiện Giao TID_D ghi đủ customerId + toAgentId ─────────────
  const delEvtD = await db.assetEvent.findFirst({ where: { tid: 'TID-K2-D', eventType: 'TID_DELIVERED' } });
  assert('TID_D: sự kiện Giao đủ customerId + toAgentId', delEvtD?.customerId === customerId && delEvtD?.toAgentId === agent.id, { c: delEvtD?.customerId, a: delEvtD?.toAgentId });
  const rowD = await db.tid.findUnique({ where: { tid: 'TID-K2-D' } });
  assert('TID_D: posSerial null (không tạo PosDevice máy khách)', rowD?.posSerial === null && rowD?.deliveredAt != null);

  // ── (2) tạo TID chưa gán → assign SAU ───────────────────────────────────
  const sE = 'SN-K2-E';
  await mkDevice(sE);
  const cE = await tidSvc.createTidUnified({ tid: 'TID-K2-E', ...baseCfg });
  const asgE = await tidSvc.assignTid('TID-K2-E', { posSerial: sE, customerId, occurredAt: '2026-07-05' });
  assert('tạo chưa gán rồi assign sau', cE.ok === true && asgE.ok === true, { c: cE.error, a: asgE.error });
  const rowE = await db.tid.findUnique({ where: { tid: 'TID-K2-E' } });
  assert('TID_E sau assign: ACTIVE + posSerial', rowE?.status === 'ACTIVE' && rowE?.posSerial === sE);

  // ── (5) tidTimeline đủ mốc đúng thứ tự ─────────────────────────────────
  const delE = await tidSvc.markTidDelivered('TID-K2-E', { deliveredAt: '2026-07-06', customerId });
  assert('markTidDelivered TID_E ok', delE.ok === true, delE.error);
  const tlE = await tidSvc.tidTimeline('TID-K2-E');
  const typesE = (tlE.data ?? []).map((e) => e.eventType);
  assert('timeline TID_E có TID_ASSIGN trước TID_DELIVERED', typesE.indexOf('TID_ASSIGN') >= 0 && typesE.indexOf('TID_DELIVERED') > typesE.indexOf('TID_ASSIGN'), { types: typesE });

  // ── (6) regression assign / replace / recall / deliver ──────────────────
  const sF = 'SN-K2-F';
  await mkDevice(sF);
  await tidSvc.createTidUnified({ tid: 'TID-K2-F', ...baseCfg });
  const asgF = await tidSvc.assignTid('TID-K2-F', { posSerial: sF, customerId, occurredAt: '2026-07-05' });
  await tidSvc.createTidUnified({ tid: 'TID-K2-F2', ...baseCfg });
  const repF = await tidSvc.replaceTid('TID-K2-F', { newTid: 'TID-K2-F2', occurredAt: '2026-07-06' });
  assert('regression assign + replace', asgF.ok === true && repF.ok === true, { a: asgF.error, r: repF.error });
  const oldF = await db.tid.findUnique({ where: { tid: 'TID-K2-F' } });
  const newF = await db.tid.findUnique({ where: { tid: 'TID-K2-F2' } });
  assert('replace: cũ DEAD, mới ACTIVE trên cùng máy', oldF?.status === 'DEAD' && newF?.status === 'ACTIVE' && newF?.posSerial === sF);

  // ── (10) D4: recallTid clear posSerial + agentId ───────────────────────
  const rcF2 = await tidSvc.recallTid('TID-K2-F2', { occurredAt: '2026-07-07' });
  assert('recallTid ok', rcF2.ok === true, rcF2.error);
  const recF2 = await db.tid.findUnique({ where: { tid: 'TID-K2-F2' } });
  assert('D4: recallTid → RECALLED + posSerial null + agentId null', recF2?.status === 'RECALLED' && recF2?.posSerial === null && recF2?.agentId === null, { s: recF2?.status, p: recF2?.posSerial, a: recF2?.agentId });

  // ── (7) tương thích K1 ─────────────────────────────────────────────────
  // recallPos → máy về IN_STOCK, TID gỡ (posSerial null, GIỮ sống) → reassign máy khác OK.
  const sG = 'SN-K2-G';
  await mkDevice(sG);
  await tidSvc.createTidUnified({ tid: 'TID-K2-G', ...baseCfg });
  await tidSvc.assignTid('TID-K2-G', { posSerial: sG, customerId, occurredAt: '2026-07-05' });
  const rcPos = await posSvc.recallPos(sG, { occurredAt: '2026-07-06' });
  const sG2 = 'SN-K2-G2';
  await mkDevice(sG2);
  const reasgG = await tidSvc.assignTid('TID-K2-G', { posSerial: sG2, customerId, occurredAt: '2026-07-07' });
  assert('K1 compat: recallPos → reassign TID sang máy khác OK', rcPos.ok === true && reasgG.ok === true, { rc: rcPos.error, re: reasgG.error });
  // recallTid → RECALLED → assign lại bị chặn INVALID_STATE.
  await tidSvc.recallTid('TID-K2-G', { occurredAt: '2026-07-08' });
  const sG3 = 'SN-K2-G3';
  await mkDevice(sG3);
  const asgRecalled = await tidSvc.assignTid('TID-K2-G', { posSerial: sG3, customerId, occurredAt: '2026-07-09' });
  assert('K1 compat: TID RECALLED → assign bị chặn (INVALID_STATE)', asgRecalled.ok === false && asgRecalled.error === 'INVALID_STATE', { e: asgRecalled.error });

  // ── (8) "chưa giao" loại DEAD/CLOSED/RECALLED + soft-deleted + khớp badge ─
  // TID_C (UNASSIGNED, chưa giao) → PHẢI lọt. TID_D (đã giao) → KHÔNG. TID_F2 (RECALLED) → KHÔNG.
  const undel = await tidSvc.listUndeliveredTids();
  const undelSet = new Set((undel.data ?? []).map((t) => t.tid));
  assert('chưa giao: TID_C lọt', undelSet.has('TID-K2-C'));
  assert('chưa giao: TID_D (đã giao) KHÔNG lọt', !undelSet.has('TID-K2-D'));
  assert('chưa giao: TID_F2 (RECALLED) KHÔNG lọt', !undelSet.has('TID-K2-F2'));
  // soft-delete 1 tid chưa giao → rớt khỏi list + badge.
  await db.tid.update({ where: { tid: 'TID-K2-C' }, data: { deletedAt: new Date() } });
  const undel2 = await tidSvc.listUndeliveredTids();
  assert('chưa giao: soft-deleted TID_C rớt khỏi list', !(undel2.data ?? []).some((t) => t.tid === 'TID-K2-C'));
  const badge = await notifySvc.getUndeliveredSummary();
  assert('badge notification khớp count listUndeliveredTids', badge.ok === true && badge.data?.count === (undel2.data ?? []).length, { badge: badge.data?.count, list: (undel2.data ?? []).length });

  // ── HARDENING FIX1 — bất biến 1 máy 1 TID (createTidUnified nhánh assign) ─
  const sInv = 'SN-K2-INV';
  await mkDevice(sInv);
  const inv1 = await tidSvc.createTidUnified({ tid: 'TID-K2-INV1', ...baseCfg, assign: { posSerial: sInv, customerId } });
  assert('FIX1: gán TID_INV1 lên máy trống OK', inv1.ok === true, inv1.error);
  const inv2 = await tidSvc.createTidUnified({ tid: 'TID-K2-INV2', ...baseCfg, assign: { posSerial: sInv, customerId } });
  assert('FIX1: gán TID_INV2 lên máy ĐÃ CÓ TID → chặn DEVICE_HAS_TID', inv2.ok === false && inv2.error === 'DEVICE_HAS_TID', { e: inv2.error });
  const devInv = await db.posDevice.findUnique({ where: { serial: sInv } });
  assert('FIX1: máy vẫn trỏ TID_INV1 (không mồ côi)', devInv?.currentTid === 'TID-K2-INV1', { tid: devInv?.currentTid });
  const invRolled = await db.tid.findUnique({ where: { tid: 'TID-K2-INV2' } });
  assert('FIX1: TID_INV2 rollback (không tạo row mồ côi)', invRolled === null);
  const openBindInv = await db.posTidBinding.count({ where: { posSerial: sInv, unboundAt: null } });
  assert('FIX1: chỉ 1 binding mở cho máy', openBindInv === 1, { openBindInv });

  // ── HARDENING FIX2 — validate customer/agent tồn tại ────────────────────
  const badCust = await tidSvc.createTidUnified({ tid: 'TID-K2-BADC', ...baseCfg, deliver: { deliveredAt: '2026-07-03', customerId: 999999 } });
  assert('FIX2: deliver.customerId không tồn tại → NOT_FOUND', badCust.ok === false && badCust.error === 'NOT_FOUND', { e: badCust.error });
  const badAgent = await tidSvc.createTidUnified({ tid: 'TID-K2-BADA', ...baseCfg, deliver: { deliveredAt: '2026-07-03', customerId, toAgentId: 999999 } });
  assert('FIX2: deliver.toAgentId không tồn tại → NOT_FOUND', badAgent.ok === false && badAgent.error === 'NOT_FOUND', { e: badAgent.error });
  const sBadFree = 'SN-K2-BADFREE'; // máy TRỐNG (chưa có TID) để test đúng nhánh validate khách.
  await mkDevice(sBadFree);
  const badAsgCust = await tidSvc.createTidUnified({ tid: 'TID-K2-BADAC', ...baseCfg, assign: { posSerial: sBadFree, customerId: 999999 } });
  assert('FIX2: assign.customerId không tồn tại → NOT_FOUND', badAsgCust.ok === false && badAsgCust.error === 'NOT_FOUND', { e: badAsgCust.error });

  // ── HARDENING FIX3 — timeline TID_A (assign + deliver lùi ngày) đúng thứ tự ─
  const tlA = await tidSvc.tidTimeline('TID-K2-A');
  const typesA = (tlA.data ?? []).map((e) => e.eventType);
  assert('FIX3: timeline TID_A có TID_ASSIGN TRƯỚC TID_DELIVERED dù deliveredAt lùi ngày', typesA.indexOf('TID_ASSIGN') >= 0 && typesA.indexOf('TID_DELIVERED') > typesA.indexOf('TID_ASSIGN'), { types: typesA });

  // ── (9) quyền vai ──────────────────────────────────────────────────────
  await userSvc.createUser({ fullName: 'Kho K2', username: 'whk2user', password: 'Ware@123456', roleCodes: ['WAREHOUSE'] }).catch(() => undefined);
  await userSvc.createUser({ fullName: 'Sale K2', username: 'salesk2user', password: 'Sales@123456', roleCodes: ['SALES'] }).catch(() => undefined);
  await logout();

  await login('whk2user', 'Ware@123456');
  const whRefs = await tidSvc.tidRefs();
  assert('WAREHOUSE: tidRefs OK (CONFIG_TID_VIEW)', whRefs.ok === true, whRefs.error);
  const whCreate = await tidSvc.createTidUnified({ tid: 'TID-K2-WH', ...baseCfg });
  assert('WAREHOUSE: tạo TID (chưa gán) OK (CONFIG_TID_MANAGE)', whCreate.ok === true, whCreate.error);
  const whAssign = await tidSvc.createTidUnified({ tid: 'TID-K2-WH2', ...baseCfg, assign: { posSerial: sA, customerId } });
  assert('WAREHOUSE: tạo kèm GÁN bị chặn FORBIDDEN (thiếu TID_MANAGE)', whAssign.ok === false && whAssign.error === 'FORBIDDEN', { e: whAssign.error });
  await logout();

  await login('salesk2user', 'Sales@123456');
  const slRefs = await tidSvc.tidRefs();
  const slList = await tidSvc.listTids({});
  const slCreate = await tidSvc.createTidUnified({ tid: 'TID-K2-SL', ...baseCfg });
  assert('SALES: tidRefs FORBIDDEN', slRefs.ok === false && slRefs.error === 'FORBIDDEN');
  assert('SALES: listTids FORBIDDEN', slList.ok === false && slList.error === 'FORBIDDEN');
  assert('SALES: createTidUnified FORBIDDEN', slCreate.ok === false && slCreate.error === 'FORBIDDEN');
  await logout();

  await login(ADMIN.u, ADMIN.p);
  await logout();
  // eslint-disable-next-line no-console
  console.log(`SELFTEST30 SUMMARY | failures=${failures}`);
  return failures === 0 ? 0 : 1;
}
