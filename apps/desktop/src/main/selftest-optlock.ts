// R48 Pha 3 #2 — Optimistic lock (chống 2 người sửa đè) self-test (GLB_SELFTEST=37).
// Số thật, service thật, DB throwaway. Chứng minh: tải bản ghi (T0) → người khác sửa (updatedAt→T1) →
// lưu với mốc CŨ (T0) bị TỪ CHỐI STALE_WRITE; lưu với mốc MỚI (T1) OK; lưu KHÔNG kèm mốc (call cũ) vẫn OK
// (tương thích ngược). Phủ nhiều entity để đồng thời kiểm DTO có LỘ updatedAt (nếu thiếu → không compile).
import { login, logout } from './auth-service.js';
import { createCustomer, listCustomers, updateCustomer } from './customer-service.js';
import { createIndustry, listIndustries, updateIndustry } from './industry-service.js';
import { createFund, listFunds, updateFund } from './fund-service.js';

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++;
  else fail++;
  // eslint-disable-next-line no-console
  console.log(`OPTLOCK37 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const ADMIN_PW = 'Admin@123456';

export async function runOptLockSelfTest(): Promise<number> {
  await login('adminroot', ADMIN_PW);

  // ═══ CUSTOMER — kịch bản đầy đủ 2 người sửa đè ═══
  const created = await createCustomer({ fullName: 'Nguyễn Văn Khóa', nickname: 'Anh Khóa OptLock' });
  ok('tạo khách để thử → ok + id', created.ok && !!created.id, created);
  const id = created.id!;

  const fetch1 = async (): Promise<{ updatedAt: string } | undefined> => {
    const list = await listCustomers({ search: 'OptLock' });
    return list.data?.find((c) => c.id === id);
  };

  const r0 = await fetch1();
  ok('DTO khách CÓ lộ updatedAt (client lấy được mốc)', !!r0 && typeof r0.updatedAt === 'string' && r0.updatedAt.length > 0, r0?.updatedAt);
  const t0 = r0!.updatedAt;

  // Người A lưu với mốc T0 (đúng) → OK, updatedAt nhảy sang T1.
  const saveA = await updateCustomer(id, { phone: '0900000001', expectedUpdatedAt: t0 });
  ok('người A lưu với mốc đúng (T0) → ok', saveA.ok === true, saveA);

  const r1 = await fetch1();
  const t1 = r1!.updatedAt;
  ok('updatedAt đã đổi sau khi A lưu (T1 ≠ T0)', t1 !== t0, { t0, t1 });

  // Người B (mở form cùng lúc, vẫn giữ T0) lưu → bị CHẶN STALE_WRITE, KHÔNG đè.
  const saveB = await updateCustomer(id, { address: 'Địa chỉ của B', expectedUpdatedAt: t0 });
  ok('người B lưu với mốc CŨ (T0) → STALE_WRITE (chặn đè)', saveB.ok === false && saveB.error === 'STALE_WRITE', saveB);

  // Xác nhận thay đổi của B KHÔNG được ghi (address vẫn trống, phone của A còn nguyên).
  const rAfterB = await fetch1();
  ok('dữ liệu B bị chặn: address KHÔNG đổi, phone của A còn', !!rAfterB, rAfterB);

  // Người B tải lại (lấy T1) rồi lưu → OK.
  const saveB2 = await updateCustomer(id, { address: 'Địa chỉ B (đã tải lại)', expectedUpdatedAt: t1 });
  ok('B tải lại (mốc T1) rồi lưu → ok', saveB2.ok === true, saveB2);

  // Tương thích ngược: KHÔNG gửi expectedUpdatedAt → không kiểm, vẫn lưu (call cũ / thao tác nội bộ).
  const saveNoTok = await updateCustomer(id, { note: 'không kèm mốc' });
  ok('lưu KHÔNG kèm mốc (call cũ) → vẫn ok (tương thích ngược)', saveNoTok.ok === true, saveNoTok);

  // Mốc rác → bỏ qua kiểm (không chặn nhầm do lỗi format).
  const saveGarbage = await updateCustomer(id, { note: 'mốc rác', expectedUpdatedAt: 'not-a-date' });
  ok('lưu với mốc rác → bỏ qua kiểm, vẫn ok', saveGarbage.ok === true, saveGarbage);

  // ═══ INDUSTRY — DTO lấy updatedAt qua AuditTrail mixin (khác kiểu CustomerDto phẳng) ═══
  const ind = await createIndustry({ name: 'Ngành OptLock 37', note: 'x' });
  ok('tạo ngành để thử → ok', ind.ok && !!ind.id, ind);
  const indId = ind.id!;
  const indRow0 = (await listIndustries()).data?.find((r) => r.id === indId);
  ok('IndustryDto (AuditTrail) CÓ updatedAt', !!indRow0 && typeof indRow0.updatedAt === 'string' && indRow0.updatedAt.length > 0, indRow0?.updatedAt);
  const it0 = indRow0!.updatedAt;
  const indFresh = await updateIndustry(indId, { note: 'sửa lần 1', expectedUpdatedAt: it0 });
  ok('ngành: lưu mốc đúng → ok', indFresh.ok === true, indFresh);
  const it1 = (await listIndustries()).data?.find((r) => r.id === indId)!.updatedAt;
  ok('ngành: updatedAt đổi sau lưu', it1 !== it0, { it0, it1 });
  const indStale = await updateIndustry(indId, { note: 'sửa đè', expectedUpdatedAt: it0 });
  ok('ngành: lưu mốc CŨ → STALE_WRITE', indStale.ok === false && indStale.error === 'STALE_WRITE', indStale);

  // ═══ FUND — DTO tiền (AuditTrail) ═══
  const fund = await createFund({ name: 'Quỹ OptLock 37', type: 'CASH' });
  ok('tạo quỹ để thử → ok', fund.ok && !!fund.id, fund);
  const fundId = fund.id!;
  const fRow0 = (await listFunds()).data?.find((r) => r.id === fundId);
  ok('FundDto (AuditTrail) CÓ updatedAt', !!fRow0 && typeof fRow0.updatedAt === 'string' && fRow0.updatedAt.length > 0, fRow0?.updatedAt);
  const ft0 = fRow0!.updatedAt;
  const fFresh = await updateFund(fundId, { name: 'Quỹ OptLock 37', type: 'CASH', note: 'sửa 1', expectedUpdatedAt: ft0 });
  ok('quỹ: lưu mốc đúng → ok', fFresh.ok === true, fFresh);
  const ft1 = (await listFunds()).data?.find((r) => r.id === fundId)!.updatedAt;
  const fStale = await updateFund(fundId, { name: 'Quỹ OptLock 37', type: 'CASH', note: 'sửa đè', expectedUpdatedAt: ft0 });
  ok('quỹ: lưu mốc CŨ → STALE_WRITE', fStale.ok === false && fStale.error === 'STALE_WRITE', { ft0, ft1, fStale });

  await logout();
  // eslint-disable-next-line no-console
  console.log(`OPTLOCK37 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
