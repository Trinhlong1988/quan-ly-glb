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
import * as industrySvc from './industry-service.js';

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

  // ── LANE A (#11) master: ngành nghề (1 active, 1 ngừng dùng) ────────────
  const industryRes = await industrySvc.createIndustry({ name: 'Vận tải K2' });
  assert('master: tạo ngành nghề active', industryRes.ok === true, industryRes.error);
  const industryId = industryRes.id!;
  const inactiveInd = await db.industry.create({ data: { code: 'NGHK2X', name: 'Ngành ngừng dùng K2', active: false } });

  const mkDevice = async (serial: string): Promise<void> => {
    await supplySvc.createPosIntake({ posModelId: modelId, serial, intakeStatusId: statusId!, supplierId, importPrice: 1_000_000, importedAt: '2026-07-01' });
  };
  const baseCfg = { hkdName: 'HKD Xưởng K2', dossierId: dossier.id, partnerId, bankId, industryId };

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

  // ── LANE A (#11) — Ngành nghề cho TID ──────────────────────────────────
  // tidRefs (lấy ở trên) trả industries ACTIVE, LOẠI inactive.
  assert('LANE A: tidRefs trả ngành active + loại inactive', (refs.data?.industries ?? []).some((i) => i.id === industryId) && !(refs.data?.industries ?? []).some((i) => i.id === inactiveInd.id), { n: refs.data?.industries?.length });
  // TID_A đã tạo với industryId → DTO trả industryId + industryName resolve đúng.
  assert('LANE A: DTO TID_A có industryId + industryName', A?.industryId === industryId && A?.industryName === 'Vận tải K2', { id: A?.industryId, name: A?.industryName });
  // Tạo TID THIẾU industryId → VALIDATION (bắt buộc chọn ngành nghề). Cast để bỏ field required test runtime guard.
  const noInd = await tidSvc.createTidUnified({ tid: 'TID-K2-NOIND', hkdName: 'HKD Xưởng K2', dossierId: dossier.id, partnerId, bankId } as tidSvc.CreateTidUnifiedInput);
  assert('LANE A: tạo TID thiếu ngành nghề → VALIDATION', noInd.ok === false && noInd.error === 'VALIDATION', { e: noInd.error });
  const noIndRow = await db.tid.findUnique({ where: { tid: 'TID-K2-NOIND' } });
  assert('LANE A: TID thiếu ngành nghề KHÔNG được tạo (không mồ côi)', noIndRow === null);
  // industryId KHÔNG tồn tại → VALIDATION.
  const badInd = await tidSvc.createTidUnified({ tid: 'TID-K2-BADIND', ...baseCfg, industryId: 999999 });
  assert('LANE A: industryId không tồn tại → VALIDATION', badInd.ok === false && badInd.error === 'VALIDATION', { e: badInd.error });
  // industryId KHÔNG active (ngừng dùng) → VALIDATION.
  const inactInd = await tidSvc.createTidUnified({ tid: 'TID-K2-INACTIND', ...baseCfg, industryId: inactiveInd.id });
  assert('LANE A: industryId không active → VALIDATION', inactInd.ok === false && inactInd.error === 'VALIDATION', { e: inactInd.error });
  // Lọc listTids theo ngành nghề riêng (industry2) → CHỈ TID gắn industry2.
  const industry2 = await industrySvc.createIndustry({ name: 'Tạp hóa K2' });
  const ind2Id = industry2.id!;
  const cInd2 = await tidSvc.createTidUnified({ tid: 'TID-K2-IND2', ...baseCfg, industryId: ind2Id });
  assert('LANE A: tạo TID với industry2 OK', cInd2.ok === true, cInd2.error);
  const fInd2 = await tidSvc.listTids({ industryId: ind2Id });
  assert('LANE A: lọc listTids theo industryId → đúng tập (chỉ industry2)', (fInd2.data ?? []).length >= 1 && (fInd2.data ?? []).every((t) => t.industryId === ind2Id) && (fInd2.data ?? []).some((t) => t.tid === 'TID-K2-IND2'), { rows: (fInd2.data ?? []).map((t) => t.tid) });

  // ── #13 — Xếp hạng doanh số theo TID (mặc định tháng hiện tại + lọc kỳ) ──
  const now = new Date();
  const cur = (d: number): Date => new Date(now.getFullYear(), now.getMonth(), d, 12, 0, 0);
  const prev = (d: number): Date => new Date(now.getFullYear(), now.getMonth() - 1, d, 12, 0, 0);
  const ymCur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevYm = `${prev(1).getFullYear()}-${String(prev(1).getMonth() + 1).padStart(2, '0')}`;
  const mkTxn = async (tidId: number, amt: number, when: Date, extra: Record<string, unknown> = {}): Promise<void> => {
    await db.transaction.create({ data: { code: `GD_ST30_${tidId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, tidId, customerId, amount: amt, revenuePartner: amt, revenueSell: 0, revenueAmount: amt, txnDate: when, status: 'POSTED', ...extra } });
  };
  const r1 = await tidSvc.createTidUnified({ tid: 'TID-K2-R1', ...baseCfg });
  const r2 = await tidSvc.createTidUnified({ tid: 'TID-K2-R2', ...baseCfg });
  const r3 = await tidSvc.createTidUnified({ tid: 'TID-K2-R3', ...baseCfg });
  assert('#13 seed: tạo 3 TID xếp hạng', r1.ok && r2.ok && r3.ok, { r1: r1.error, r2: r2.error, r3: r3.error });
  const r1Id = r1.id!, r2Id = r2.id!, r3Id = r3.id!;
  await db.tid.update({ where: { id: r1Id }, data: { status: 'ACTIVE', customerId } }); // active=true + có khách giữ
  await db.tid.update({ where: { id: r2Id }, data: { status: 'ACTIVE' } }); // active=true; R3 giữ UNASSIGNED → active=false
  // R1 = 5,000,000 (3M + 2M) tháng hiện tại.
  await mkTxn(r1Id, 3_000_000, cur(15));
  await mkTxn(r1Id, 2_000_000, cur(16));
  // R2 = 8,000,000 tháng hiện tại + 20,000,000 THÁNG TRƯỚC (không tính vào mặc định).
  await mkTxn(r2Id, 8_000_000, cur(10));
  await mkTxn(r2Id, 20_000_000, prev(15));
  // R3 = 1,000,000 (POSTED). Mọi trạng thái loại trừ (I-3): CANCELLED + CANCEL_PENDING + writtenOff +
  // deletedAt → CHỈ 1,000,000 được tính (khoá cứng where status='POSTED' AND writtenOffAt/deletedAt IS NULL).
  await mkTxn(r3Id, 1_000_000, cur(12));
  await mkTxn(r3Id, 9_000_000, cur(12), { status: 'CANCELLED' });
  await mkTxn(r3Id, 9_000_000, cur(12), { status: 'CANCEL_PENDING' });
  await mkTxn(r3Id, 9_000_000, cur(12), { writtenOffAt: new Date() });
  await mkTxn(r3Id, 9_000_000, cur(12), { deletedAt: new Date() });

  const rank = await tidSvc.tidRevenueRanking();
  const rmap = new Map((rank.data ?? []).map((r) => [r.tid, r]));
  assert('#13: ranking mặc định tháng hiện tại đúng 3 TID có doanh số>0', (rank.data ?? []).length === 3, { n: rank.data?.length, rows: (rank.data ?? []).map((r) => `${r.tid}:${r.revenue}`) });
  assert('#13: R2 hạng 1 = 8,000,000', rmap.get('TID-K2-R2')?.rank === 1 && rmap.get('TID-K2-R2')?.revenue === 8_000_000, { r: rmap.get('TID-K2-R2') });
  assert('#13: R1 hạng 2 = 5,000,000', rmap.get('TID-K2-R1')?.rank === 2 && rmap.get('TID-K2-R1')?.revenue === 5_000_000, { r: rmap.get('TID-K2-R1') });
  assert('#13: R3 hạng 3 = 1,000,000 (loại CANCELLED + CANCEL_PENDING + writtenOff + deleted)', rmap.get('TID-K2-R3')?.rank === 3 && rmap.get('TID-K2-R3')?.revenue === 1_000_000, { r: rmap.get('TID-K2-R3') });
  assert('#13: sắp doanh số GIẢM DẦN', (rank.data ?? []).every((r, i, a) => i === 0 || a[i - 1].revenue >= r.revenue));
  assert('#13: active flag đúng (R1/R2 ACTIVE=true, R3 UNASSIGNED=false)', rmap.get('TID-K2-R1')?.active === true && rmap.get('TID-K2-R2')?.active === true && rmap.get('TID-K2-R3')?.active === false, { a1: rmap.get('TID-K2-R1')?.active, a3: rmap.get('TID-K2-R3')?.active });
  assert('#13: DTO đủ hkd/khách/ngành', rmap.get('TID-K2-R1')?.hkdName === 'HKD Xưởng K2' && rmap.get('TID-K2-R1')?.customerName === 'Anh K2' && rmap.get('TID-K2-R1')?.industryName === 'Vận tải K2', { r: rmap.get('TID-K2-R1') });
  // Lọc kỳ THÁNG TRƯỚC → chỉ R2 (20M).
  const rankPrev = await tidSvc.tidRevenueRanking({ from: `${prevYm}-01`, to: `${prevYm}-28` });
  const pmap = new Map((rankPrev.data ?? []).map((r) => [r.tid, r]));
  assert('#13: lọc kỳ tháng trước → chỉ R2 (20,000,000) hạng 1', (rankPrev.data ?? []).length === 1 && pmap.get('TID-K2-R2')?.revenue === 20_000_000 && pmap.get('TID-K2-R2')?.rank === 1, { n: rankPrev.data?.length, rows: (rankPrev.data ?? []).map((r) => `${r.tid}:${r.revenue}`) });

  // I-2/B24 regression — BIÊN THÁNG (chống lệch múi giờ): kỳ MẶC ĐỊNH (bound local) và kỳ CHỌN-tháng-này
  // (từ/đến qua month-picker) PHẢI cho CÙNG con số. GD 00:30 mùng 1 (local, trong tháng) phải tính; GD
  // 05:00 mùng 1 tháng sau (local, ngoài tháng) KHÔNG tính — trước fix dateRange-UTC sẽ phân loại nhầm.
  const r4 = await tidSvc.createTidUnified({ tid: 'TID-K2-R4B', ...baseCfg });
  const r4Id = r4.id!;
  const firstThis = new Date(now.getFullYear(), now.getMonth(), 1, 0, 30, 0); // 00:30 mùng 1 local — TRONG kỳ
  const firstNext = new Date(now.getFullYear(), now.getMonth() + 1, 1, 5, 0, 0); // 05:00 mùng 1 tháng sau — NGOÀI
  await mkTxn(r4Id, 4_000_000, firstThis);
  await mkTxn(r4Id, 7_000_000, firstNext);
  const lastDayCur = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const rankDef = await tidSvc.tidRevenueRanking(); // đường mặc định (bound local)
  const rankExpl = await tidSvc.tidRevenueRanking({ from: `${ymCur}-01`, to: `${ymCur}-${String(lastDayCur).padStart(2, '0')}` }); // đường chọn-kỳ
  const r4Def = (rankDef.data ?? []).find((r) => r.tid === 'TID-K2-R4B')?.revenue ?? -1;
  const r4Expl = (rankExpl.data ?? []).find((r) => r.tid === 'TID-K2-R4B')?.revenue ?? -1;
  assert('#13 B24: biên tháng — kỳ mặc định == kỳ chọn-tháng-này == 4,000,000 (không lệch múi giờ, loại GD tháng sau)', r4Def === 4_000_000 && r4Expl === 4_000_000, { def: r4Def, expl: r4Expl });

  // ── #14 — "Kỳ giao" (deliveredFrom/deliveredTo) + cột "Khách hàng đang giữ" ──
  const cd1 = await tidSvc.createTidUnified({ tid: 'TID-K2-DEL1', ...baseCfg, deliver: { deliveredAt: cur(5).toISOString(), customerId } });
  const cd2 = await tidSvc.createTidUnified({ tid: 'TID-K2-DEL2', ...baseCfg, deliver: { deliveredAt: cur(20).toISOString(), customerId } });
  assert('#14 seed: tạo DEL1 (giao mùng 5) + DEL2 (giao 20)', cd1.ok && cd2.ok, { d1: cd1.error, d2: cd2.error });
  const fDel = await tidSvc.listTids({ search: 'TID-K2-DEL', deliveredFrom: `${ymCur}-01`, deliveredTo: `${ymCur}-10` });
  const delSet = new Set((fDel.data ?? []).map((t) => t.tid));
  assert('#14: lọc Kỳ giao [01..10] → DEL1 lọt, DEL2 KHÔNG', delSet.has('TID-K2-DEL1') && !delSet.has('TID-K2-DEL2'), { rows: [...delSet] });
  const del1Row = (fDel.data ?? []).find((t) => t.tid === 'TID-K2-DEL1');
  assert('#14: DEL1 đã giao & còn sống → holdingCustomerName = tên khách', del1Row?.holdingCustomerName === 'Anh K2', { h: del1Row?.holdingCustomerName });
  // TID chưa giao → holding trống.
  await tidSvc.createTidUnified({ tid: 'TID-K2-HOLD0', ...baseCfg });
  const h0 = await tidSvc.listTids({ search: 'TID-K2-HOLD0' });
  assert('#14: TID chưa giao → holdingCustomerName trống', h0.data?.[0]?.holdingCustomerName === null, { h: h0.data?.[0]?.holdingCustomerName });
  // TID gán + giao (ACTIVE) → holding = khách; sau THU HỒI (RECALLED) → holding trống.
  const sHR = 'SN-K2-HR';
  await mkDevice(sHR);
  const hr = await tidSvc.createTidUnified({ tid: 'TID-K2-HR', ...baseCfg, assign: { posSerial: sHR, customerId }, deliver: { deliveredAt: cur(5).toISOString(), customerId } });
  assert('#14 seed: TID_HR gán + giao', hr.ok === true, hr.error);
  const hrBefore = await tidSvc.listTids({ search: 'TID-K2-HR' });
  assert('#14: TID_HR ACTIVE + đã giao → holding = khách', hrBefore.data?.[0]?.holdingCustomerName === 'Anh K2', { h: hrBefore.data?.[0]?.holdingCustomerName });
  await tidSvc.recallTid('TID-K2-HR', { occurredAt: cur(6).toISOString() });
  const hrAfter = await tidSvc.listTids({ search: 'TID-K2-HR' });
  assert('#14: TID_HR sau RECALLED → holding trống (khách đã trả)', hrAfter.data?.[0]?.holdingCustomerName === null && hrAfter.data?.[0]?.status === 'RECALLED', { h: hrAfter.data?.[0]?.holdingCustomerName, s: hrAfter.data?.[0]?.status });

  // ── Mr.Long 12/7 — bộ lọc "Khách hàng giữ" (holdingCustomerId) + "Nguồn hồ sơ" (dossierSourceId) ──
  const fHold = await tidSvc.listTids({ holdingCustomerId: customerId });
  const holdSet = new Set((fHold.data ?? []).map((t) => t.tid));
  // Khách đang giữ = TID đã giao & còn sống của khách đó → DEL1/DEL2 (+ A, D đã giao trước đó) lọt; HR đã RECALLED,
  // HOLD0/C chưa giao → KHÔNG lọt. Mọi dòng trả về PHẢI có holdingCustomerName (đúng ngữ nghĩa đang giữ).
  assert('lọc Khách giữ: DEL1+DEL2 lọt; HR (thu hồi) + HOLD0 (chưa giao) KHÔNG lọt', holdSet.has('TID-K2-DEL1') && holdSet.has('TID-K2-DEL2') && !holdSet.has('TID-K2-HR') && !holdSet.has('TID-K2-HOLD0'), { rows: [...holdSet] });
  assert('lọc Khách giữ: mọi dòng đều đang giữ thật (holdingCustomerName != null, >0 dòng)', (fHold.data ?? []).length > 0 && (fHold.data ?? []).every((t) => t.holdingCustomerName != null), { n: fHold.data?.length });
  // Nguồn hồ sơ: id không tồn tại → 0 dòng (chứng minh where dossierSourceId được áp AND, không bị bỏ qua).
  const fDsrcNone = await tidSvc.listTids({ dossierSourceId: 999999 });
  assert('lọc Nguồn hồ sơ id lạ (999999) → 0 dòng (filter được áp)', (fDsrcNone.data ?? []).length === 0, { n: fDsrcNone.data?.length });

  // ── (9) quyền vai ──────────────────────────────────────────────────────
  await userSvc.createUser({ fullName: 'Kho K2', username: 'whk2user', password: 'Ware@123456', roleCodes: ['WAREHOUSE'] }).catch(() => undefined);
  await userSvc.createUser({ fullName: 'Sale K2', username: 'salesk2user', password: 'Sales@123456', roleCodes: ['SALES'] }).catch(() => undefined);
  await userSvc.createUser({ fullName: 'Kế toán K2', username: 'acck2user', password: 'Acct@123456', roleCodes: ['ACCOUNTANT'] }).catch(() => undefined);
  await logout();

  await login('whk2user', 'Ware@123456');
  const whRefs = await tidSvc.tidRefs();
  assert('WAREHOUSE: tidRefs OK (CONFIG_TID_VIEW)', whRefs.ok === true, whRefs.error);
  const whCreate = await tidSvc.createTidUnified({ tid: 'TID-K2-WH', ...baseCfg });
  assert('WAREHOUSE: tạo TID (chưa gán) OK (CONFIG_TID_MANAGE)', whCreate.ok === true, whCreate.error);
  const whAssign = await tidSvc.createTidUnified({ tid: 'TID-K2-WH2', ...baseCfg, assign: { posSerial: sA, customerId } });
  assert('WAREHOUSE: tạo kèm GÁN bị chặn FORBIDDEN (thiếu TID_MANAGE)', whAssign.ok === false && whAssign.error === 'FORBIDDEN', { e: whAssign.error });
  const whRank = await tidSvc.tidRevenueRanking({});
  assert('#13: WAREHOUSE (không REVENUE_VIEW) → ranking FORBIDDEN', whRank.ok === false && whRank.error === 'FORBIDDEN', { e: whRank.error });
  await logout();

  await login('salesk2user', 'Sales@123456');
  const slRefs = await tidSvc.tidRefs();
  const slList = await tidSvc.listTids({});
  const slCreate = await tidSvc.createTidUnified({ tid: 'TID-K2-SL', ...baseCfg });
  const slRank = await tidSvc.tidRevenueRanking({});
  assert('SALES: tidRefs FORBIDDEN', slRefs.ok === false && slRefs.error === 'FORBIDDEN');
  assert('SALES: listTids FORBIDDEN', slList.ok === false && slList.error === 'FORBIDDEN');
  assert('SALES: createTidUnified FORBIDDEN', slCreate.ok === false && slCreate.error === 'FORBIDDEN');
  assert('#13: SALES → ranking FORBIDDEN', slRank.ok === false && slRank.error === 'FORBIDDEN');
  await logout();

  // I-3 positive — ACCOUNTANT (được grant REVENUE_VIEW ở seed role cũ) PHẢI xem được ranking. Khoá cứng
  // chống hồi quy lớp bug "permission gán role cũ" (memory feedback_verify_before_claim_and_db_upgrade_gap).
  await login('acck2user', 'Acct@123456');
  const accRank = await tidSvc.tidRevenueRanking({});
  assert('#13: ACCOUNTANT (có REVENUE_VIEW) → ranking OK (positive, khoá grant role cũ)', accRank.ok === true && Array.isArray(accRank.data), { e: accRank.error, n: accRank.data?.length });
  await logout();

  await login(ADMIN.u, ADMIN.p);
  await logout();
  // eslint-disable-next-line no-console
  console.log(`SELFTEST30 SUMMARY | failures=${failures}`);
  return failures === 0 ? 0 : 1;
}
