// G-CFG.4 Tài khoản nhận tiền – ủy quyền — self-test 50+ ĐÚNG + 50+ SAI (R_LINK_VERIFY, GLB_SELFTEST=8).
// Nguồn TK (§8a) + TK nhận tiền (§8b) + đính kèm CCCD 2 mặt (file-store, tên chuẩn, đọc lại data URL,
// thay/gỡ ảnh). Cần GLB_UPLOADS_DIR trỏ tới thư mục tạm (kiểm thử đính kèm không cần dialog).
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import * as rcv from './receive-account-service.js';
import { uploadsRoot, fileSize, readAttachmentDataUrl } from './file-store.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`GCFG8 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';

/** Tạo file ảnh nguồn tạm để thử đính kèm (nội dung không quan trọng, chỉ cần đuôi hợp lệ). */
function mkSrc(ext: string, tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'glb-src-'));
  const p = join(dir, `nguon_${tag}${ext}`);
  writeFileSync(p, Buffer.from(`fake-image-${tag}-${ext}`));
  return p;
}

export async function runReceiveAccountSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', PW);
  uploadsRoot(); // bảo đảm thư mục uploads tồn tại (dùng GLB_UPLOADS_DIR)

  // ── SETUP nền: 1 ngân hàng + 1 khách hàng ──
  const vcb = await db.bank.create({ data: { name: 'Vietcombank', code: 'VCB' } });
  const cus = await db.customer.create({ data: { code: 'KH01', fullName: 'Nguyễn Văn A', nickname: 'Anh A' } });
  const frontSrc = mkSrc('.png', 'front');
  const backSrc = mkSrc('.jpg', 'back');

  // ═══════════ 50+ ĐÚNG ═══════════
  // (1) 8 nguồn tài khoản (8)
  const srcIds: number[] = [];
  const srcNames = ['Khách hàng', 'Nội bộ', 'Ủy quyền', 'Đối tác', 'Chi nhánh', 'Kế toán', 'Kho quỹ', 'Tạm ứng'];
  for (const nm of srcNames) {
    const r = await rcv.createSource({ name: nm });
    ok(`tạo nguồn "${nm}" → ok`, r.ok === true, r);
    if (r.id) srcIds.push(r.id);
  }
  ok('list nguồn = 8', (await rcv.listSources()).data?.length === 8);
  ok('sửa nguồn[0] → ok', (await rcv.updateSource(srcIds[0], { name: 'Khách hàng (VIP)' })).ok === true);

  // (2) 30 tài khoản nhận tiền (30) — xoay vòng nguồn, vài TK gắn khách, vài TK nội bộ
  const acctIds: number[] = [];
  for (let i = 0; i < 30; i++) {
    const r = await rcv.createAccount({
      sourceId: srcIds[i % srcIds.length],
      accountName: `Chủ TK ${i}`,
      accountNumber: `007000${1000 + i}`,
      bankId: vcb.id,
      branch: i % 2 === 0 ? 'CN Hà Nội' : null,
      cccdNumber: `0010012${String(10000 + i)}`,
      cccdIssuePlace: 'Cục CSQLHC',
      phone: `09${String(10000000 + i)}`,
      email: i % 3 === 0 ? `tk${i}@glb.vn` : null,
      customerId: i % 2 === 0 ? cus.id : null
    });
    ok(`tạo TK #${i} → ok`, r.ok === true, r);
    if (r.id) acctIds.push(r.id);
  }
  ok('list TK = 30', (await rcv.listAccounts()).data?.length === 30);
  ok('lọc theo nguồn[1] = 30/8≈', ((await rcv.listAccounts({ sourceId: srcIds[1] })).data?.length ?? 0) > 0);
  ok('lọc theo ngân hàng VCB = 30', (await rcv.listAccounts({ bankId: vcb.id })).data?.length === 30);
  ok('tìm theo STK "0070001005" = 1', (await rcv.listAccounts({ search: '0070001005' })).data?.length === 1);
  ok('lọc theo khách hàng = 15', (await rcv.listAccounts({ customerId: cus.id })).data?.length === 15);

  // (3) đính kèm CCCD mặt trước — tạo TK có ảnh, kiểm tra tên file chuẩn + đọc lại (4)
  const withFront = await rcv.createAccount({ sourceId: srcIds[0], accountName: 'Trần Thị B', accountNumber: '0070002001', bankId: vcb.id, cccdFrontSrc: frontSrc });
  ok('tạo TK kèm CCCD mặt trước → ok', withFront.ok === true, withFront);
  const fRow = (await rcv.listAccounts({ search: '0070002001' })).data?.[0];
  const expectFront = `receiveAccount/${withFront.id}/1. CCCD MT - Trần Thị B.png`;
  ok('path CCCD mặt trước đúng chuẩn tên', fRow?.cccdFrontPath === expectFront, fRow?.cccdFrontPath);
  ok('file CCCD mặt trước tồn tại (>0 byte)', fileSize(fRow?.cccdFrontPath ?? '') > 0);
  ok('đọc lại CCCD mặt trước → data URL PNG', readAttachmentDataUrl(fRow?.cccdFrontPath ?? '').dataUrl?.startsWith('data:image/png;base64,') === true);

  // (4) đính kèm cả 2 mặt (2)
  const withBoth = await rcv.createAccount({ sourceId: srcIds[0], accountName: 'Lê Văn C', accountNumber: '0070002002', bankId: vcb.id, cccdFrontSrc: frontSrc, cccdBackSrc: backSrc });
  ok('tạo TK kèm CCCD 2 mặt → ok', withBoth.ok === true);
  const bRow = (await rcv.listAccounts({ search: '0070002002' })).data?.[0];
  ok('TK có cả path mặt trước & mặt sau', !!bRow?.cccdFrontPath && bRow?.cccdBackPath === `receiveAccount/${withBoth.id}/2. CCCD MS - Lê Văn C.jpg`, { f: bRow?.cccdFrontPath, b: bRow?.cccdBackPath });

  // (5) cập nhật: đổi tên TK (1)
  ok('sửa tên TK → ok', (await rcv.updateAccount(acctIds[0], { sourceId: srcIds[0], accountName: 'Chủ TK 0 (sửa)', accountNumber: '0070001000', bankId: vcb.id })).ok === true);

  // (6) cập nhật: thêm ảnh mặt sau vào TK vốn chỉ có mặt trước (2)
  ok('thêm CCCD mặt sau khi cập nhật → ok', (await rcv.updateAccount(withFront.id!, { sourceId: srcIds[0], accountName: 'Trần Thị B', accountNumber: '0070002001', bankId: vcb.id, cccdBackSrc: backSrc })).ok === true);
  const fRow2 = (await rcv.listAccounts({ search: '0070002001' })).data?.[0];
  ok('sau cập nhật đã có CCCD mặt sau', !!fRow2?.cccdBackPath && fileSize(fRow2?.cccdBackPath ?? '') > 0, fRow2?.cccdBackPath);

  // (7) cập nhật: gỡ ảnh mặt trước (null) → path về null (2)
  ok('gỡ CCCD mặt trước (null) → ok', (await rcv.updateAccount(withBoth.id!, { sourceId: srcIds[0], accountName: 'Lê Văn C', accountNumber: '0070002002', bankId: vcb.id, cccdFrontSrc: null })).ok === true);
  const bRow2 = (await rcv.listAccounts({ search: '0070002002' })).data?.[0];
  ok('sau gỡ, CCCD mặt trước = null (mặt sau còn)', bRow2?.cccdFrontPath === null && !!bRow2?.cccdBackPath, { f: bRow2?.cccdFrontPath, b: bRow2?.cccdBackPath });

  // (8) xóa hợp lệ (2)
  ok('xóa 1 TK (đúng mk) → deleted=1', (await rcv.deleteAccounts([acctIds[29]], PW)).deleted === 1);
  ok('TK đã xóa rời danh sách', (await rcv.listAccounts()).data?.some((a) => a.id === acctIds[29]) === false);

  // (9) xóa nguồn[7] hợp lệ (chuẩn bị test DUPLICATE_TRASH) (1)
  ok('xóa nguồn[7] "Tạm ứng" (đúng mk) → deleted=1', (await rcv.deleteSources([srcIds[7]], PW)).deleted === 1);

  // ═══════════ 50+ SAI ═══════════
  // (A) Nguồn tài khoản (6)
  ok('SAI nguồn thiếu tên → VALIDATION', (await rcv.createSource({ name: '  ' })).error === 'VALIDATION');
  ok('SAI nguồn trùng "Nội bộ" → DUPLICATE', (await rcv.createSource({ name: 'Nội bộ' })).error === 'DUPLICATE');
  ok('SAI sửa nguồn không tồn tại → NOT_FOUND', (await rcv.updateSource(999001, { name: 'Z' })).error === 'NOT_FOUND');
  ok('SAI sửa nguồn trùng tên khác → DUPLICATE', (await rcv.updateSource(srcIds[1], { name: 'Đối tác' })).error === 'DUPLICATE');
  ok('SAI xóa nguồn không chọn → VALIDATION', (await rcv.deleteSources([], PW)).error === 'VALIDATION');
  ok('SAI xóa nguồn sai mật khẩu → WRONG_PASSWORD', (await rcv.deleteSources([srcIds[2]], 'sai')).error === 'WRONG_PASSWORD');
  ok('SAI tái tạo nguồn đã xóa "Tạm ứng" → DUPLICATE_TRASH', (await rcv.createSource({ name: 'Tạm ứng' })).error === 'DUPLICATE_TRASH');

  // (B) Tài khoản — validation/tham chiếu (12)
  const baseA = { sourceId: srcIds[0], accountName: 'X', accountNumber: '999', bankId: vcb.id };
  ok('SAI TK thiếu nguồn → VALIDATION', (await rcv.createAccount({ ...baseA, sourceId: 0 })).error === 'VALIDATION');
  ok('SAI TK thiếu tên → VALIDATION', (await rcv.createAccount({ ...baseA, accountName: ' ' })).error === 'VALIDATION');
  ok('SAI TK thiếu số TK → VALIDATION', (await rcv.createAccount({ ...baseA, accountNumber: ' ' })).error === 'VALIDATION');
  ok('SAI TK thiếu ngân hàng → VALIDATION', (await rcv.createAccount({ ...baseA, bankId: 0 })).error === 'VALIDATION');
  ok('SAI TK nguồn không tồn tại → NOT_FOUND', (await rcv.createAccount({ ...baseA, sourceId: 999002 })).error === 'NOT_FOUND');
  ok('SAI TK ngân hàng không tồn tại → NOT_FOUND', (await rcv.createAccount({ ...baseA, bankId: 999003 })).error === 'NOT_FOUND');
  ok('SAI TK khách hàng không tồn tại → NOT_FOUND', (await rcv.createAccount({ ...baseA, customerId: 999004 })).error === 'NOT_FOUND');
  ok('SAI TK nguồn đã xóa mềm → NOT_FOUND', (await rcv.createAccount({ ...baseA, sourceId: srcIds[7] })).error === 'NOT_FOUND');
  ok('SAI sửa TK không tồn tại → NOT_FOUND', (await rcv.updateAccount(999005, baseA)).error === 'NOT_FOUND');
  ok('SAI sửa TK tên rỗng → VALIDATION', (await rcv.updateAccount(acctIds[1], { ...baseA, accountName: '  ', accountNumber: '0070001001' })).error === 'VALIDATION');
  ok('SAI sửa TK số rỗng → VALIDATION', (await rcv.updateAccount(acctIds[1], { ...baseA, accountNumber: '  ' })).error === 'VALIDATION');
  ok('SAI sửa TK ngân hàng không tồn tại → NOT_FOUND', (await rcv.updateAccount(acctIds[1], { ...baseA, accountNumber: '0070001001', bankId: 999006 })).error === 'NOT_FOUND');
  ok('SAI xóa TK không chọn → VALIDATION', (await rcv.deleteAccounts([], PW)).error === 'VALIDATION');
  ok('SAI xóa TK sai mật khẩu → WRONG_PASSWORD', (await rcv.deleteAccounts([acctIds[1]], 'sai')).error === 'WRONG_PASSWORD');

  // (C) 25 lần tạo nguồn trùng đang hoạt động → DUPLICATE (25)
  for (let i = 0; i < 25; i++) {
    const nm = srcNames[i % 6 + 1]; // 1..6 đang active (né index 0 đã đổi tên, 7 đã xóa)
    ok(`SAI tạo trùng nguồn "${nm}" #${i} → DUPLICATE`, (await rcv.createSource({ name: nm })).error === 'DUPLICATE');
  }

  // (D) Không quyền: SALES → FORBIDDEN (8)
  await userSvc.createUser({ fullName: 'NV Sales Rcv', username: 'salesrcv', password: 'Sales@123456', roleCodes: ['SALES'] }).catch(() => undefined);
  await logout();
  await login('salesrcv', 'Sales@123456');
  ok('SAI SALES list nguồn → FORBIDDEN', (await rcv.listSources()).error === 'FORBIDDEN');
  ok('SAI SALES list TK → FORBIDDEN', (await rcv.listAccounts()).error === 'FORBIDDEN');
  ok('SAI SALES tạo nguồn → FORBIDDEN', (await rcv.createSource({ name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES sửa nguồn → FORBIDDEN', (await rcv.updateSource(srcIds[1], { name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES xóa nguồn → FORBIDDEN', (await rcv.deleteSources([srcIds[1]], PW)).error === 'FORBIDDEN');
  ok('SAI SALES tạo TK → FORBIDDEN', (await rcv.createAccount(baseA)).error === 'FORBIDDEN');
  ok('SAI SALES sửa TK → FORBIDDEN', (await rcv.updateAccount(acctIds[1], baseA)).error === 'FORBIDDEN');
  ok('SAI SALES xóa TK → FORBIDDEN', (await rcv.deleteAccounts([acctIds[1]], PW)).error === 'FORBIDDEN');
  await logout();

  // eslint-disable-next-line no-console
  console.log(`GCFG8 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
