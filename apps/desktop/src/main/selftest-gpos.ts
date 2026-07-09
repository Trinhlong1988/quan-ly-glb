// G-POS.1 integration self-test (headless, GLB_SELFTEST=3). Drives the REAL service layer against
// the live DB (run on a throwaway copy via GLB_DB_URL) to prove the enforceable G-POS rules:
//   - mã NV/KH sinh liên tục 01→02→03, đúng prefix, không trùng (§D)
//   - KH thiếu nickname bị chặn với message cụ thể (R_UX_WARN)
//   - POS: create → deploy → reportDamage → sendRepair → receiveRepaired = 4 asset_event (+STOCK_IN) có occurredAt
//   - đổi TID → old DEAD + new ACTIVE + 2 pos_tid_binding
//   - listUndeliveredTids đúng
//   - non-permission → FORBIDDEN + audit (R_AUDIT_003)
//   - duplicate serial/tid/customer nickname → message cụ thể (R_UX_WARN)
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import * as customerSvc from './customer-service.js';
import * as posSvc from './pos-service.js';
import * as tidSvc from './tid-service.js';
import * as auditSvc from './audit-service.js';
import { nextCode } from './code-service.js';

let failures = 0;
function assert(name: string, cond: boolean, extra?: unknown): void {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  // eslint-disable-next-line no-console
  console.log(`SELFTEST3 ${status} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

export async function runGposSelfTest(): Promise<number> {
  const db = getDb();
  const ADMIN = { u: 'adminroot', p: 'Admin@123456' };
  await login(ADMIN.u, ADMIN.p);

  // ── §D: code counters continuous & prefixed ────────────────────────────
  const kh1 = await nextCode('KH', db);
  const kh2 = await nextCode('KH', db);
  const kh3 = await nextCode('KH', db);
  assert('KH codes are continuous & prefixed', /^KH\d{2,}$/.test(kh1) && /^KH\d{2,}$/.test(kh2) && /^KH\d{2,}$/.test(kh3));
  assert('KH codes strictly increase (no dup/no wrong prefix)', num(kh2) === num(kh1) + 1 && num(kh3) === num(kh2) + 1, { kh1, kh2, kh3 });

  // adminroot backfilled to NV01
  const admin = await db.user.findFirst({ where: { username: 'adminroot' } });
  assert('adminroot has employee_code NV01', admin?.employeeCode === 'NV01', { code: admin?.employeeCode });

  // creating users mints sequential NV codes
  const u1 = await userSvc.createUser({ fullName: 'NV Một', phone: '0900000101', email: 'nv1@glb.test', username: 'gposuser1', password: 'Pass@1234', roleCodes: ['SALES'] });
  const u2 = await userSvc.createUser({ fullName: 'NV Hai', phone: '0900000102', email: 'nv2@glb.test', username: 'gposuser2', password: 'Pass@1234', roleCodes: ['SALES'] });
  assert('user creates succeed', u1.ok && u2.ok, { u1: u1.error, u2: u2.error });
  const nv1 = (await db.user.findUnique({ where: { id: u1.id! } }))?.employeeCode;
  const nv2 = (await db.user.findUnique({ where: { id: u2.id! } }))?.employeeCode;
  assert('new users get sequential NV codes', !!nv1 && !!nv2 && num(nv2!) === num(nv1!) + 1, { nv1, nv2 });

  // ── §D + R_UX_WARN: customer nickname mandatory, auto KH code ───────────
  const noNick = await customerSvc.createCustomer({ fullName: 'Nguyễn Văn Thanh', nickname: '' });
  assert('customer without nickname blocked', noNick.ok === false && noNick.error === 'VALIDATION');
  assert('nickname block has specific VN message', typeof noNick.message === 'string' && noNick.message!.includes('Biệt danh'), { message: noNick.message });

  const c1 = await customerSvc.createCustomer({ fullName: 'Nguyễn Văn Thanh', nickname: 'Anh Thanh Hải Phòng', phone: '0900001111' });
  assert('customer create ok', c1.ok === true, c1.error);
  const c1row = await db.customer.findUnique({ where: { id: c1.id! } });
  assert('customer got auto KH code', /^KH\d{2,}$/.test(c1row?.code ?? ''), { code: c1row?.code });
  const c2 = await customerSvc.createCustomer({ fullName: 'Trần Thị B', nickname: 'Chị B Cầu Giấy' });
  assert('second customer code increments', c2.ok && num((await db.customer.findUnique({ where: { id: c2.id! } }))!.code) === num(c1row!.code) + 1);

  // ── §A: POS lifecycle produces asset_events with occurredAt ─────────────
  const serial = 'SN-SELFTEST-001';
  const posC = await posSvc.createPos({ serial, occurredAt: '2026-06-01T09:00:00Z' });
  assert('POS create ok', posC.ok === true, posC.error);
  const dupSerial = await posSvc.createPos({ serial });
  assert('duplicate serial blocked with specific message', dupSerial.ok === false && dupSerial.error === 'DUPLICATE' && !!dupSerial.message?.includes(serial), { message: dupSerial.message });

  const dep = await posSvc.deployPos(serial, { customerId: c1.id!, occurredAt: '2026-07-01T09:00:00Z', note: 'giao khách' });
  assert('deploy ok', dep.ok === true, dep.error);
  const badRecall = await posSvc.receivePosRepaired(serial, {}); // invalid from DEPLOYED
  assert('invalid transition blocked (DEPLOYED cannot receiveRepaired)', badRecall.ok === false && badRecall.error === 'INVALID_STATE', { message: badRecall.message });
  const dmg = await posSvc.reportPosDamage(serial, { occurredAt: '2026-07-02T09:00:00Z' });
  assert('reportDamage ok', dmg.ok === true, dmg.error);
  const snd = await posSvc.sendPosRepair(serial, { occurredAt: '2026-07-03T09:00:00Z' });
  assert('sendRepair ok', snd.ok === true, snd.error);
  const rcv = await posSvc.receivePosRepaired(serial, { occurredAt: '2026-07-04T09:00:00Z' });
  assert('receiveRepaired ok', rcv.ok === true, rcv.error);

  const devNow = await db.posDevice.findUnique({ where: { serial } });
  assert('device projected back to IN_STOCK', devNow?.status === 'IN_STOCK', { status: devNow?.status });

  const events = await db.assetEvent.findMany({ where: { deviceSerial: serial }, orderBy: { occurredAt: 'asc' } });
  const types = events.map((e) => e.eventType);
  assert('5 asset events recorded (STOCK_IN + 4 transitions)', events.length === 5, { types });
  assert('event types in correct order', JSON.stringify(types) === JSON.stringify(['STOCK_IN', 'DEPLOY', 'REPORT_DAMAGE', 'SEND_REPAIR', 'RECEIVE_REPAIRED']), { types });
  assert('every event has occurredAt', events.every((e) => e.occurredAt instanceof Date && !isNaN(e.occurredAt.getTime())));

  const timeline = await posSvc.getDeviceTimeline(serial);
  assert('getDeviceTimeline returns the chain', timeline.ok && (timeline.data?.length ?? 0) === 5);

  // ── §A: TID assign then replace → DEAD + ACTIVE + 2 bindings ────────────
  // Redeploy so the device has a customer, then assign a TID.
  await posSvc.deployPos(serial, { customerId: c1.id!, occurredAt: '2026-07-05T09:00:00Z' });
  const tCreate1 = await tidSvc.createTid({ tid: 'TID-A-001', bank: 'VCB', openedAt: '2026-05-01T00:00:00Z' });
  const tCreate2 = await tidSvc.createTid({ tid: 'TID-A-002', bank: 'VCB', openedAt: '2026-07-01T00:00:00Z' });
  assert('two TIDs created', tCreate1.ok && tCreate2.ok);
  const dupTid = await tidSvc.createTid({ tid: 'TID-A-001' });
  assert('duplicate TID blocked with specific message', dupTid.ok === false && dupTid.error === 'DUPLICATE' && !!dupTid.message?.includes('TID-A-001'));

  const assign = await tidSvc.assignTid('TID-A-001', { posSerial: serial, customerId: c1.id!, occurredAt: '2026-07-06T09:00:00Z' });
  assert('assign TID ok', assign.ok === true, assign.error);
  const devAfterAssign = await db.posDevice.findUnique({ where: { serial } });
  assert('device currentTid = TID-A-001', devAfterAssign?.currentTid === 'TID-A-001');

  const replace = await tidSvc.replaceTid('TID-A-001', { newTid: 'TID-A-002', occurredAt: '2026-07-07T09:00:00Z', unbindReason: 'TID chết' });
  assert('replace TID ok', replace.ok === true, replace.error);
  const oldTid = await db.tid.findUnique({ where: { tid: 'TID-A-001' } });
  const newTid = await db.tid.findUnique({ where: { tid: 'TID-A-002' } });
  assert('old TID → DEAD', oldTid?.status === 'DEAD', { status: oldTid?.status });
  assert('new TID → ACTIVE', newTid?.status === 'ACTIVE', { status: newTid?.status });
  const bindings = await db.posTidBinding.findMany({ where: { posSerial: serial }, orderBy: { id: 'asc' } });
  assert('2 pos_tid_bindings exist', bindings.length === 2, { count: bindings.length });
  assert('old binding is unbound, new binding open', bindings[0]?.tid === 'TID-A-001' && bindings[0]?.unboundAt !== null && bindings[1]?.tid === 'TID-A-002' && bindings[1]?.unboundAt === null);
  const devAfterReplace = await db.posDevice.findUnique({ where: { serial } });
  assert('device currentTid now TID-A-002', devAfterReplace?.currentTid === 'TID-A-002');

  // ── §A5: undelivered list ──────────────────────────────────────────────
  // TID-A-002 is ACTIVE but never delivered → should appear; mark delivered → disappears.
  const undel1 = await tidSvc.listUndeliveredTids();
  const inList = (undel1.data ?? []).some((t) => t.tid === 'TID-A-002');
  assert('undelivered list includes never-delivered active TID', inList);
  assert('undelivered rows carry agingDays', (undel1.data ?? []).every((t) => typeof t.agingDays === 'number' && t.agingDays >= 0));
  const deliver = await tidSvc.markTidDelivered('TID-A-002', { deliveredAt: '2026-07-08T09:00:00Z' });
  assert('markDelivered ok', deliver.ok === true, deliver.error);
  const undel2 = await tidSvc.listUndeliveredTids();
  assert('delivered TID drops out of undelivered list', !(undel2.data ?? []).some((t) => t.tid === 'TID-A-002'));

  // ── R_AUDIT_003: non-permission user → FORBIDDEN + audited ──────────────
  const auditBefore = await auditSvc.listAudit({ action: 'PERMISSION_DENIED', limit: 2000 });
  const deniedBefore = auditBefore.ok ? (auditBefore.data ?? []).length : -1;
  await logout();

  await login('gposuser1', 'Pass@1234'); // SALES: has CUSTOMER_VIEW/CREATE but NOT POS/TID manage
  const salesPos = await posSvc.listPosDevices({});
  assert('SALES cannot view POS → FORBIDDEN', salesPos.ok === false && salesPos.error === 'FORBIDDEN', salesPos.error);
  const salesTidCreate = await tidSvc.createTid({ tid: 'HACK-1' });
  assert('SALES cannot create TID → FORBIDDEN', salesTidCreate.ok === false && salesTidCreate.error === 'FORBIDDEN');
  const salesCustCreate = await customerSvc.createCustomer({ fullName: 'X', nickname: 'Y' });
  assert('SALES (has CUSTOMER_CREATE) can create customer', salesCustCreate.ok === true, salesCustCreate.error);
  await logout();

  await login(ADMIN.u, ADMIN.p);
  const auditAfter = await auditSvc.listAudit({ action: 'PERMISSION_DENIED', limit: 2000 });
  const deniedAfter = auditAfter.ok ? (auditAfter.data ?? []).length : -1;
  assert('permission denials were audited (R_AUDIT_003)', deniedAfter > deniedBefore, { deniedBefore, deniedAfter });
  await logout();

  // eslint-disable-next-line no-console
  console.log(`SELFTEST3 SUMMARY | failures=${failures}`);
  return failures === 0 ? 0 : 1;
}

/** Numeric tail of a code like NV07 → 7. */
function num(code: string): number {
  return Number(code.replace(/^[A-Z]+/, ''));
}
