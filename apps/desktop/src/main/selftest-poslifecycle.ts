// POS #1 + #2 lifecycle self-test (headless, GLB_SELFTEST=39). Drives the REAL service layer against
// a throwaway DB (GLB_DB_URL). Proves:
//   POS #1 — bất biến "1 máy 1 TID SỐNG":
//     • máy đã có TID → gán TID khác bị chặn DEVICE_HAS_TID (guard tầng service)
//     • TID đang trên máy → lắp máy khác bị chặn TID_ON_DEVICE
//     • chỉ 1 pos_tid_binding còn mở / máy
//     • DB BACKSTOP: chèn thẳng binding mở thứ 2 (raw SQL) → vi phạm partial-unique (23505)
//     • tháo TID (recall) xong mới lắp được sang máy khác (unbind-before-bind)
//   POS #2 — đổi khách giữ máy (changeCustomer):
//     • DEPLOYED giữ nguyên DEPLOYED, giữ TID, currentCustomerId + tid.customerId đổi sang khách mới
//     • sự kiện CHANGE_CUSTOMER ghi customerId = khách mới, TID không đổi
//     • đổi sang chính khách đang giữ → VALIDATION; thiếu khách → VALIDATION
//     • máy IN_STOCK → INVALID_STATE; khách mới không tồn tại → NOT_FOUND
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as customerSvc from './customer-service.js';
import * as posSvc from './pos-service.js';
import * as tidSvc from './tid-service.js';

let failures = 0;
function assert(name: string, cond: boolean, extra?: unknown): void {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  // eslint-disable-next-line no-console
  console.log(`POSLIFE39 ${status} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

export async function runPosLifecycleSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', 'Admin@123456');

  const c1 = await customerSvc.createCustomer({ fullName: 'PL Khách Một', nickname: 'PL Khách Một' });
  const c2 = await customerSvc.createCustomer({ fullName: 'PL Khách Hai', nickname: 'PL Khách Hai' });
  assert('2 khách test tạo được', c1.ok && c2.ok, { c1: c1.error, c2: c2.error });

  // ── POS #1: 1 máy 1 TID sống ─────────────────────────────────────────────
  const A = 'SN-PL-A';
  const B = 'SN-PL-B';
  await posSvc.createPos({ serial: A, occurredAt: '2026-06-01T09:00:00Z' });
  await posSvc.createPos({ serial: B, occurredAt: '2026-06-01T09:00:00Z' });
  await posSvc.deployPos(A, { customerId: c1.id!, occurredAt: '2026-06-02T09:00:00Z' });
  await tidSvc.createTid({ tid: 'PL-TID-1', bank: 'VCB', openedAt: '2026-05-01T00:00:00Z' });
  await tidSvc.createTid({ tid: 'PL-TID-2', bank: 'VCB', openedAt: '2026-05-01T00:00:00Z' });

  const asg1 = await tidSvc.assignTid('PL-TID-1', { posSerial: A, customerId: c1.id!, occurredAt: '2026-06-03T09:00:00Z' });
  assert('gán PL-TID-1 lên máy A ok', asg1.ok === true, asg1.error);

  // máy A đã có TID → gán TID khác lên A bị chặn
  const asg2 = await tidSvc.assignTid('PL-TID-2', { posSerial: A, customerId: c1.id!, occurredAt: '2026-06-03T10:00:00Z' });
  assert('máy A đã có TID → gán TID-2 lên A bị chặn DEVICE_HAS_TID', asg2.ok === false && asg2.error === 'DEVICE_HAS_TID', { err: asg2.error });

  // PL-TID-1 đang trên máy A → lắp sang máy B bị chặn
  const move = await tidSvc.assignTid('PL-TID-1', { posSerial: B, customerId: c1.id!, occurredAt: '2026-06-03T11:00:00Z' });
  assert('TID-1 đang trên máy A → lắp sang B bị chặn TID_ON_DEVICE', move.ok === false && move.error === 'TID_ON_DEVICE', { err: move.error });

  const openA = await db.posTidBinding.count({ where: { posSerial: A, unboundAt: null } });
  assert('máy A chỉ có 1 binding còn mở', openA === 1, { openA });

  // DB BACKSTOP: chèn thẳng binding mở thứ 2 cho máy A → vi phạm partial-unique
  let dbBlocked = false;
  try {
    await db.$executeRaw`INSERT INTO pos_tid_bindings (pos_serial, tid, bound_at) VALUES (${A}, ${'PL-TID-99'}, now())`;
  } catch (e) {
    dbBlocked = (e as { code?: string })?.code === '23505' || /unique|duplicate/i.test(String((e as Error)?.message));
  }
  assert('DB backstop: binding mở thứ 2/máy bị partial-unique chặn (23505)', dbBlocked);

  // unbind-before-bind: thu hồi máy A (gỡ TID-1) rồi mới lắp TID-1 sang B được
  const recall = await posSvc.recallPos(A, { occurredAt: '2026-06-04T09:00:00Z' });
  assert('thu hồi máy A ok (gỡ TID-1)', recall.ok === true, recall.error);
  const devA = await db.posDevice.findUnique({ where: { serial: A } });
  assert('máy A về IN_STOCK, currentTid null sau thu hồi', devA?.status === 'IN_STOCK' && devA?.currentTid === null, { s: devA?.status, tid: devA?.currentTid });
  await posSvc.deployPos(B, { customerId: c2.id!, occurredAt: '2026-06-04T10:00:00Z' });
  const moveOk = await tidSvc.assignTid('PL-TID-1', { posSerial: B, customerId: c2.id!, occurredAt: '2026-06-04T11:00:00Z' });
  assert('sau thu hồi, lắp TID-1 sang máy B ok (unbind-before-bind)', moveOk.ok === true, moveOk.error);
  const openBindingsTid1 = await db.posTidBinding.count({ where: { tid: 'PL-TID-1', unboundAt: null } });
  assert('TID-1 vẫn chỉ 1 binding mở (trên B)', openBindingsTid1 === 1, { openBindingsTid1 });

  // ── POS #2: đổi khách giữ máy (máy B đang giữ c2 + PL-TID-1) ─────────────
  const evBefore = await db.assetEvent.count({ where: { deviceSerial: B, eventType: 'CHANGE_CUSTOMER' } });
  const chg = await posSvc.changeCustomerPos(B, { customerId: c1.id!, occurredAt: '2026-06-05T09:00:00Z', note: 'đổi khách' });
  assert('đổi khách máy B (c2 → c1) ok', chg.ok === true, chg.error);
  const devB = await db.posDevice.findUnique({ where: { serial: B } });
  assert('máy B GIỮ DEPLOYED + GIỮ TID-1 sau đổi khách', devB?.status === 'DEPLOYED' && devB?.currentTid === 'PL-TID-1', { s: devB?.status, tid: devB?.currentTid });
  assert('máy B currentCustomerId = khách mới c1', devB?.currentCustomerId === c1.id, { cur: devB?.currentCustomerId, want: c1.id });
  const tid1 = await db.tid.findUnique({ where: { tid: 'PL-TID-1' } });
  assert('TID-1 đi theo khách mới: tid.customerId = c1', tid1?.customerId === c1.id, { cur: tid1?.customerId, want: c1.id });
  const evAfter = await db.assetEvent.findMany({ where: { deviceSerial: B, eventType: 'CHANGE_CUSTOMER' }, orderBy: { id: 'desc' }, take: 1 });
  assert('sự kiện CHANGE_CUSTOMER được ghi (+1)', evAfter.length === 1 && (await db.assetEvent.count({ where: { deviceSerial: B, eventType: 'CHANGE_CUSTOMER' } })) === evBefore + 1);
  assert('sự kiện CHANGE_CUSTOMER: customerId = khách mới, tid = TID-1, DEPLOYED→DEPLOYED', evAfter[0]?.customerId === c1.id && evAfter[0]?.tid === 'PL-TID-1' && evAfter[0]?.fromState === 'DEPLOYED' && evAfter[0]?.toState === 'DEPLOYED', { ev: evAfter[0] });

  // đổi sang chính khách đang giữ → VALIDATION
  const same = await posSvc.changeCustomerPos(B, { customerId: c1.id!, occurredAt: '2026-06-05T10:00:00Z' });
  assert('đổi sang chính khách đang giữ → VALIDATION', same.ok === false && same.error === 'VALIDATION', { err: same.error });
  // thiếu khách → VALIDATION
  const noCust = await posSvc.changeCustomerPos(B, { occurredAt: '2026-06-05T10:00:00Z' });
  assert('đổi khách thiếu khách hàng mới → VALIDATION', noCust.ok === false && noCust.error === 'VALIDATION', { err: noCust.error });
  // khách mới không tồn tại → NOT_FOUND
  const ghost = await posSvc.changeCustomerPos(B, { customerId: 999999, occurredAt: '2026-06-05T10:00:00Z' });
  assert('khách mới không tồn tại → NOT_FOUND', ghost.ok === false && ghost.error === 'NOT_FOUND', { err: ghost.error });
  // máy IN_STOCK (A) đổi khách → INVALID_STATE
  const onStock = await posSvc.changeCustomerPos(A, { customerId: c2.id!, occurredAt: '2026-06-05T10:00:00Z' });
  assert('đổi khách trên máy IN_STOCK → INVALID_STATE', onStock.ok === false && onStock.error === 'INVALID_STATE', { err: onStock.error });

  await logout();
  // eslint-disable-next-line no-console
  console.log(`POSLIFE39 SUMMARY | failures=${failures}`);
  return failures === 0 ? 0 : 1;
}
