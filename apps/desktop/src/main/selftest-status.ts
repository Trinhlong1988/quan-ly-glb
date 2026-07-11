// R14 — Danh mục trạng thái tùy biến + trạng thái Đối tác (R13) — self-test (GLB_SELFTEST=32).
// Số thật, service thật, DB throwaway. Phủ: seed builtin · thêm custom · chống trùng · builtin khóa xóa ·
// đổi nhãn builtin không đổi code · xóa custom đang-dùng bị chặn · validate status Đối tác · lọc theo status.
import { login, logout } from './auth-service.js';
import { listStatusOptions, isValidStatus, createStatusOption, updateStatusOption, deleteStatusOption } from './status-catalog-service.js';
import { createPartner, listPartners } from './bank-config-service.js';

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++;
  else fail++;
  // eslint-disable-next-line no-console
  console.log(`STATUS32 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const ADMIN_PW = 'Admin@123456';

export async function runStatusSelfTest(): Promise<number> {
  await login('adminroot', ADMIN_PW);

  // ═══ 1) SEED builtin đủ theo entity ═══
  const bank = await listStatusOptions('BANK');
  const cust = await listStatusOptions('CUSTOMER');
  const part = await listStatusOptions('PARTNER');
  ok('BANK có 2 builtin (ACTIVE/INACTIVE)', bank.ok && bank.data?.length === 2, bank.data?.map((o) => o.code));
  ok('CUSTOMER có 3 builtin (ACTIVE/LOCKED/CANCELLED)', cust.ok && cust.data?.length === 3, cust.data?.map((o) => o.code));
  ok('PARTNER có 3 builtin (SIGNED/UNSIGNED/TERMINATED)', part.ok && part.data?.length === 3 && part.data.every((o) => o.isBuiltin), part.data?.map((o) => o.code));

  // ═══ 2) isValidStatus ═══
  ok('isValidStatus PARTNER/SIGNED = true', await isValidStatus('PARTNER', 'SIGNED'));
  ok('isValidStatus PARTNER/BOGUS = false', !(await isValidStatus('PARTNER', 'BOGUS')));

  // ═══ 3) Thêm trạng thái custom cho PARTNER (master-data) ═══
  const c1 = await createStatusOption({ entity: 'PARTNER', label: 'Tạm ngưng hợp tác', tone: 'amber' });
  ok('thêm custom PARTNER → ok + có id', c1.ok && !!c1.id, c1);
  const partAfter = await listStatusOptions('PARTNER', { includeInactive: true });
  const custom = partAfter.data?.find((o) => o.id === c1.id);
  ok('custom mới có code CUSTOM_1, không builtin', custom?.code === 'CUSTOM_1' && custom?.isBuiltin === false, custom);
  const dupLabel = await createStatusOption({ entity: 'PARTNER', label: 'Tạm ngưng hợp tác' });
  ok('thêm trùng nhãn → DUPLICATE', dupLabel.ok === false && dupLabel.error === 'DUPLICATE', dupLabel);
  const badEntity = await createStatusOption({ entity: 'XYZ', label: 'x' });
  ok('entity không hợp lệ → VALIDATION', badEntity.ok === false && badEntity.error === 'VALIDATION', badEntity);

  // ═══ 4) Đổi nhãn builtin: được, nhưng code GIỮ NGUYÊN; xóa builtin bị chặn ═══
  const signed = part.data!.find((o) => o.code === 'SIGNED')!;
  const upd = await updateStatusOption(signed.id, { label: 'Đã ký HĐ hợp tác', tone: 'emerald' });
  ok('đổi nhãn builtin → ok', upd.ok === true, upd);
  const partReload = await listStatusOptions('PARTNER', { includeInactive: true });
  const signedReload = partReload.data?.find((o) => o.id === signed.id);
  ok('builtin đổi nhãn nhưng code vẫn SIGNED', signedReload?.code === 'SIGNED' && signedReload?.label === 'Đã ký HĐ hợp tác', signedReload);
  const delBuiltin = await deleteStatusOption(signed.id);
  ok('xóa builtin → BUILTIN_LOCKED', delBuiltin.ok === false && delBuiltin.error === 'BUILTIN_LOCKED', delBuiltin);

  // ═══ 5) Đối tác: validate status khi tạo + lọc theo status ═══
  const pOk = await createPartner({ name: 'ĐT Đã ký', code: 'PSIGN', status: 'SIGNED' });
  ok('tạo đối tác status SIGNED → ok', pOk.ok === true, pOk);
  const pBad = await createPartner({ name: 'ĐT Lỗi', code: 'PBAD', status: 'NOPE' });
  ok('tạo đối tác status không hợp lệ → VALIDATION', pBad.ok === false && pBad.error === 'VALIDATION', pBad);
  const pDefault = await createPartner({ name: 'ĐT Mặc định', code: 'PDEF' });
  ok('tạo đối tác không truyền status → mặc định UNSIGNED', pDefault.ok === true, pDefault);
  const signedList = await listPartners({ status: 'SIGNED' });
  ok('lọc đối tác status=SIGNED chỉ trả đúng', signedList.ok === true && (signedList.data ?? []).every((p) => p.status === 'SIGNED') && (signedList.data ?? []).some((p) => p.code === 'PSIGN'), signedList.data?.map((p) => p.code));

  // ═══ 6) Gán đối tác vào trạng thái custom → xóa custom đang-dùng bị chặn ═══
  const pCustom = await createPartner({ name: 'ĐT Tạm ngưng', code: 'PTN', status: 'CUSTOM_1' });
  ok('gán đối tác vào status custom CUSTOM_1 → ok', pCustom.ok === true, pCustom);
  const delUsed = await deleteStatusOption(c1.id!);
  ok('xóa trạng thái đang dùng → IN_USE', delUsed.ok === false && delUsed.error === 'IN_USE', delUsed);

  // ═══ 7) Thêm custom KHÔNG dùng → xóa được (soft) ═══
  const c2 = await createStatusOption({ entity: 'PARTNER', label: 'Nháp bỏ đi', tone: 'slate' });
  const delUnused = await deleteStatusOption(c2.id!);
  ok('xóa trạng thái chưa dùng → ok', delUnused.ok === true, delUnused);
  const afterDel = await listStatusOptions('PARTNER', { includeInactive: true });
  ok('trạng thái đã xóa không còn trong danh sách', !afterDel.data?.some((o) => o.id === c2.id), afterDel.data?.map((o) => o.code));

  await logout();
  // eslint-disable-next-line no-console
  console.log(`STATUS32 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
