// G-CFG.6 Cấu hình TID — self-test 50+ ĐÚNG + 50+ SAI (R_LINK_VERIFY, GLB_SELFTEST=10).
// §9a trạng thái TID (bảng riêng, @unique + B05) + §9 cấu hình TID (gộp vào bảng tids — Cách 1):
// ngân hàng/đối tác bắt buộc, TK nhận/trạng thái/nguồn hồ sơ validate-nếu-có, tid @unique + soft-delete (B05).
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import * as tc from './tid-config-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`GCFG10 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';

export async function runTidConfigSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', PW);

  // ── SETUP nền: ngân hàng + đối tác + TK nhận tiền + nguồn hồ sơ ──
  const vcb = await db.bank.create({ data: { name: 'Vietcombank', code: 'VCB' } });
  const partner = await db.partner.create({ data: { name: 'Đối tác Napas', code: 'NAPAS' } });
  const rcvSrc = await db.receiveAccountSource.create({ data: { name: 'Khách hàng' } });
  const rcvAcc = await db.receiveAccount.create({ data: { sourceId: rcvSrc.id, accountName: 'Chủ TK A', accountNumber: '007123456', bankId: vcb.id } });
  const dsrc = await db.dossierSource.create({ data: { code: 'HS01', discountRate: 50 } });

  // ═══════════ 50+ ĐÚNG ═══════════
  // (1) 8 trạng thái TID (8)
  const stIds: number[] = [];
  const stNames = ['Mới cấp', 'Thu hồi', 'Đổi đối tác', 'Tạm ngưng', 'Đang chạy', 'Hủy', 'Chờ duyệt', 'Đã đóng'];
  for (const nm of stNames) {
    const r = await tc.createStatus({ name: nm });
    ok(`tạo trạng thái "${nm}" → ok`, r.ok === true, r);
    if (r.id) stIds.push(r.id);
  }
  ok('list trạng thái = 8', (await tc.listStatuses()).data?.length === 8);
  ok('sửa trạng thái[0] → ok', (await tc.updateStatus(stIds[0], { name: 'Mới cấp (VIP)' })).ok === true);

  // (2) 30 cấu hình TID (30)
  const tidIds: number[] = [];
  for (let i = 0; i < 30; i++) {
    const r = await tc.createConfigTid({
      tid: `TID${i}`,
      bankId: vcb.id,
      partnerId: partner.id,
      hkdName: `HKD ${i}`,
      receiveAccountId: i % 2 === 0 ? rcvAcc.id : null,
      issuedAt: '2026-07-01',
      configStatusId: stIds[i % stIds.length],
      dossierSourceId: i % 3 === 0 ? dsrc.id : null
    });
    ok(`tạo cấu hình TID #${i} → ok`, r.ok === true, r);
    if (r.id) tidIds.push(r.id);
  }
  ok('list cấu hình TID = 30', (await tc.listConfigTids()).data?.length === 30);
  ok('lọc theo đối tác = 30', (await tc.listConfigTids({ partnerId: partner.id })).data?.length === 30);
  ok('lọc theo ngân hàng = 30', (await tc.listConfigTids({ bankId: vcb.id })).data?.length === 30);
  ok('tìm theo "TID5" ≥ 1', ((await tc.listConfigTids({ search: 'TID5' })).data?.length ?? 0) >= 1);
  ok('lọc theo trạng thái[1] > 0', ((await tc.listConfigTids({ configStatusId: stIds[1] })).data?.length ?? 0) > 0);

  // (3) TID đủ liên kết → verify nhãn join (2)
  const fullTid = await tc.createConfigTid({ tid: 'TID-FULL', bankId: vcb.id, partnerId: partner.id, hkdName: 'HKD Đầy Đủ', receiveAccountId: rcvAcc.id, issuedAt: '2026-07-05', configStatusId: stIds[0], dossierSourceId: dsrc.id });
  ok('tạo TID đủ liên kết → ok', fullTid.ok === true);
  const fr = (await tc.listConfigTids({ search: 'TID-FULL' })).data?.[0];
  ok('nhãn join đúng (đối tác/TK/trạng thái/nguồn hồ sơ)', fr != null && fr.partnerCode === 'NAPAS' && fr.receiveAccountLabel === 'Chủ TK A · 007123456' && fr.configStatusName === 'Mới cấp (VIP)' && fr.dossierSourceCode === 'HS01', fr);

  // (4) cập nhật: đổi tên HKD (1)
  ok('sửa tên HKD → ok', (await tc.updateConfigTid(tidIds[0], { tid: 'TID0', bankId: vcb.id, partnerId: partner.id, hkdName: 'HKD 0 (sửa)' })).ok === true);
  // (5) cập nhật: đổi trạng thái + nguồn hồ sơ (1)
  ok('sửa trạng thái + nguồn hồ sơ → ok', (await tc.updateConfigTid(tidIds[1], { tid: 'TID1', bankId: vcb.id, partnerId: partner.id, hkdName: 'HKD 1', configStatusId: stIds[2], dossierSourceId: dsrc.id })).ok === true);

  // (6) xóa hợp lệ (3)
  ok('xóa 1 TID (đúng mk) → deleted=1', (await tc.deleteConfigTids([tidIds[29]], PW)).deleted === 1);
  ok('TID đã xóa rời danh sách', (await tc.listConfigTids()).data?.some((t) => t.id === tidIds[29]) === false);
  ok('xóa trạng thái[7] (đúng mk) → deleted=1', (await tc.deleteStatuses([stIds[7]], PW)).deleted === 1);

  // ═══════════ 50+ SAI ═══════════
  // (A) Trạng thái TID (7)
  ok('SAI trạng thái thiếu tên → VALIDATION', (await tc.createStatus({ name: '  ' })).error === 'VALIDATION');
  ok('SAI trạng thái trùng "Thu hồi" → DUPLICATE', (await tc.createStatus({ name: 'Thu hồi' })).error === 'DUPLICATE');
  ok('SAI sửa trạng thái không tồn tại → NOT_FOUND', (await tc.updateStatus(999001, { name: 'Z' })).error === 'NOT_FOUND');
  ok('SAI sửa trạng thái trùng → DUPLICATE', (await tc.updateStatus(stIds[1], { name: 'Đổi đối tác' })).error === 'DUPLICATE');
  ok('SAI xóa trạng thái không chọn → VALIDATION', (await tc.deleteStatuses([], PW)).error === 'VALIDATION');
  ok('SAI xóa trạng thái sai mật khẩu → WRONG_PASSWORD', (await tc.deleteStatuses([stIds[2]], 'sai')).error === 'WRONG_PASSWORD');
  ok('SAI tái tạo trạng thái đã xóa "Đã đóng" → DUPLICATE_TRASH', (await tc.createStatus({ name: 'Đã đóng' })).error === 'DUPLICATE_TRASH');

  // (B) Cấu hình TID (16)
  const baseT = { tid: 'ZZZ', bankId: vcb.id, partnerId: partner.id, hkdName: 'HKD X' };
  ok('SAI TID thiếu chuỗi → VALIDATION', (await tc.createConfigTid({ ...baseT, tid: '  ' })).error === 'VALIDATION');
  ok('SAI TID thiếu ngân hàng → VALIDATION', (await tc.createConfigTid({ ...baseT, bankId: 0 })).error === 'VALIDATION');
  ok('SAI TID thiếu đối tác → VALIDATION', (await tc.createConfigTid({ ...baseT, partnerId: 0 })).error === 'VALIDATION');
  ok('SAI TID thiếu tên HKD → VALIDATION', (await tc.createConfigTid({ ...baseT, hkdName: ' ' })).error === 'VALIDATION');
  ok('SAI TID ngân hàng không tồn tại → NOT_FOUND', (await tc.createConfigTid({ ...baseT, bankId: 999002 })).error === 'NOT_FOUND');
  ok('SAI TID đối tác không tồn tại → NOT_FOUND', (await tc.createConfigTid({ ...baseT, partnerId: 999003 })).error === 'NOT_FOUND');
  ok('SAI TID tài khoản nhận không tồn tại → NOT_FOUND', (await tc.createConfigTid({ ...baseT, receiveAccountId: 999004 })).error === 'NOT_FOUND');
  ok('SAI TID trạng thái không tồn tại → NOT_FOUND', (await tc.createConfigTid({ ...baseT, configStatusId: 999005 })).error === 'NOT_FOUND');
  ok('SAI TID nguồn hồ sơ không tồn tại → NOT_FOUND', (await tc.createConfigTid({ ...baseT, dossierSourceId: 999006 })).error === 'NOT_FOUND');
  ok('SAI TID trùng "TID0" → DUPLICATE', (await tc.createConfigTid({ ...baseT, tid: 'TID0' })).error === 'DUPLICATE');
  ok('SAI sửa TID không tồn tại → NOT_FOUND', (await tc.updateConfigTid(999007, baseT)).error === 'NOT_FOUND');
  ok('SAI sửa TID chuỗi rỗng → VALIDATION', (await tc.updateConfigTid(tidIds[1], { ...baseT, tid: '  ' })).error === 'VALIDATION');
  ok('SAI sửa TID ngân hàng không tồn tại → NOT_FOUND', (await tc.updateConfigTid(tidIds[1], { ...baseT, tid: 'TID1', bankId: 999008 })).error === 'NOT_FOUND');
  ok('SAI xóa TID không chọn → VALIDATION', (await tc.deleteConfigTids([], PW)).error === 'VALIDATION');
  ok('SAI xóa TID sai mật khẩu → WRONG_PASSWORD', (await tc.deleteConfigTids([tidIds[1]], 'sai')).error === 'WRONG_PASSWORD');
  ok('SAI tái tạo TID đã xóa "TID29" → DUPLICATE_TRASH', (await tc.createConfigTid({ ...baseT, tid: 'TID29' })).error === 'DUPLICATE_TRASH');

  // (C) 25 lần tạo trùng chuỗi TID đang dùng → DUPLICATE (25)
  for (let i = 0; i < 25; i++) {
    ok(`SAI tạo trùng "TID${i % 6 + 1}" #${i} → DUPLICATE`, (await tc.createConfigTid({ ...baseT, tid: `TID${i % 6 + 1}` })).error === 'DUPLICATE');
  }

  // (D) Không quyền: SALES → FORBIDDEN (8)
  await userSvc.createUser({ fullName: 'NV Sales Tid', username: 'salestid', password: 'Sales@123456', roleCodes: ['SALES'] }).catch(() => undefined);
  await logout();
  await login('salestid', 'Sales@123456');
  ok('SAI SALES list trạng thái → FORBIDDEN', (await tc.listStatuses()).error === 'FORBIDDEN');
  ok('SAI SALES list TID → FORBIDDEN', (await tc.listConfigTids()).error === 'FORBIDDEN');
  ok('SAI SALES tạo trạng thái → FORBIDDEN', (await tc.createStatus({ name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES sửa trạng thái → FORBIDDEN', (await tc.updateStatus(stIds[1], { name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES xóa trạng thái → FORBIDDEN', (await tc.deleteStatuses([stIds[1]], PW)).error === 'FORBIDDEN');
  ok('SAI SALES tạo TID → FORBIDDEN', (await tc.createConfigTid(baseT)).error === 'FORBIDDEN');
  ok('SAI SALES sửa TID → FORBIDDEN', (await tc.updateConfigTid(tidIds[1], baseT)).error === 'FORBIDDEN');
  ok('SAI SALES xóa TID → FORBIDDEN', (await tc.deleteConfigTids([tidIds[1]], PW)).error === 'FORBIDDEN');
  await logout();

  // eslint-disable-next-line no-console
  console.log(`GCFG10 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
