// R48 Pha 4 — Realtime change-token self-test (GLB_SELFTEST=38). Số thật, service thật, DB throwaway.
// Chứng minh: mỗi thao tác (qua writeAudit) tăng version ĐÚNG MIỀN (targetType); miền khác không bị đụng;
// pendingCancels là số đếm hợp lệ. Đây là nền "đo lường realtime" giữa các máy.
import { login, logout } from './auth-service.js';
import { realtimeTokens } from './realtime-service.js';
import { createCustomer, updateCustomer } from './customer-service.js';
import { createFund } from './fund-service.js';

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++;
  else fail++;
  // eslint-disable-next-line no-console
  console.log(`REALTIME38 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

export async function runRealtimeSelfTest(): Promise<number> {
  await login('adminroot', 'Admin@123456');

  const t0 = await realtimeTokens();
  ok('realtimeTokens → ok + data', t0.ok && !!t0.data, t0);
  ok('pendingCancels là số ≥ 0', typeof t0.data?.pendingCancels === 'number' && (t0.data?.pendingCancels ?? -1) >= 0, t0.data?.pendingCancels);
  const cust0 = t0.data?.byDomain['Customer'] ?? 0;
  const fund0 = t0.data?.byDomain['Fund'] ?? 0;

  const c1 = await createCustomer({ fullName: 'Realtime Một', nickname: 'RT Một' });
  ok('tạo khách → ok', c1.ok === true, c1);
  const t1 = await realtimeTokens();
  const cust1 = t1.data?.byDomain['Customer'] ?? 0;
  ok('tạo khách → version miền Customer TĂNG', cust1 > cust0, { cust0, cust1 });

  await updateCustomer(c1.id!, { phone: '0900000009' });
  const t2 = await realtimeTokens();
  const cust2 = t2.data?.byDomain['Customer'] ?? 0;
  ok('sửa khách → version Customer TĂNG tiếp', cust2 > cust1, { cust1, cust2 });

  // Miền Customer đổi KHÔNG được làm đổi version miền Fund (đúng miền, không nhiễu chéo).
  const fund2 = t2.data?.byDomain['Fund'] ?? 0;
  ok('sửa Customer KHÔNG đụng version Fund', fund2 === fund0, { fund0, fund2 });

  // Đụng Fund → version Fund mới tăng.
  await createFund({ name: 'Quỹ Realtime 38', type: 'CASH' });
  const t3 = await realtimeTokens();
  const fund3 = t3.data?.byDomain['Fund'] ?? 0;
  const cust3 = t3.data?.byDomain['Customer'] ?? 0;
  ok('tạo Fund → version Fund TĂNG', fund3 > fund2, { fund2, fund3 });
  ok('tạo Fund KHÔNG đụng version Customer', cust3 === cust2, { cust2, cust3 });

  await logout();
  // eslint-disable-next-line no-console
  console.log(`REALTIME38 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
