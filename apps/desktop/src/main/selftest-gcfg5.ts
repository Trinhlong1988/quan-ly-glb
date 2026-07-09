// G-CFG.5 Quản lý Hồ sơ HKD — self-test 50+ ĐÚNG + 50+ SAI (R_LINK_VERIFY, GLB_SELFTEST=9).
// Nguồn hồ sơ (§10a/b: mã @unique + chiết khấu % ≤3 thập phân) + Hồ sơ HKD (§10c/d: trường đầy đủ
// + đính kèm ĐKKD/CCCD 4 mặt — ĐKKD đặt tên theo Tên HKD, CCCD theo Tên chủ hộ; thay/gỡ ảnh).
// Cần GLB_UPLOADS_DIR trỏ thư mục tạm.
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import * as dsr from './dossier-service.js';
import { uploadsRoot, fileSize, readAttachmentDataUrl } from './file-store.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`GCFG9 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

function mkSrc(ext: string, tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'glb-dsr-'));
  const p = join(dir, `nguon_${tag}${ext}`);
  writeFileSync(p, Buffer.from(`fake-${tag}-${ext}`));
  return p;
}

export async function runDossierSelfTest(): Promise<number> {
  await login('adminroot', PW);
  uploadsRoot();
  const dkkdSrc = mkSrc('.pdf', 'dkkd');
  const cccdSrc = mkSrc('.png', 'cccd');

  // ═══════════ 50+ ĐÚNG ═══════════
  // (1) 8 nguồn hồ sơ (8) — mã + chiết khấu %
  const srcIds: number[] = [];
  const srcCodes = ['NGUON01', 'NGUON02', 'NGUON03', 'NGUON04', 'NGUON05', 'NGUON06', 'NGUON07', 'NGUON08'];
  for (let i = 0; i < srcCodes.length; i++) {
    const r = await dsr.createSource({ code: srcCodes[i], discountRate: 0.05 + i * 0.001 });
    ok(`tạo nguồn hồ sơ "${srcCodes[i]}" → ok`, r.ok === true, r);
    if (r.id) srcIds.push(r.id);
  }
  ok('list nguồn hồ sơ = 8', (await dsr.listSources()).data?.length === 8);
  ok('sửa nguồn[0] mã + chiết khấu → ok', (await dsr.updateSource(srcIds[0], { code: 'NGUON01B', discountRate: 0.5 })).ok === true);

  // (2) chiết khấu 3 thập phân round-trip (2)
  ok('tạo nguồn chiết khấu 0.003 → ok', (await dsr.createSource({ code: 'KM003', discountRate: 0.003 })).ok === true);
  const km = (await dsr.listSources()).data?.find((s) => s.code === 'KM003');
  ok('chiết khấu 0.003 lưu & trả về chính xác', km != null && near(km.discountRate, 0.003), km?.discountRate);

  // (3) 30 hồ sơ HKD (30)
  const dosIds: number[] = [];
  for (let i = 0; i < 30; i++) {
    const r = await dsr.createDossier({
      sourceId: srcIds[i % srcIds.length],
      hkdName: `HKD Số ${i}`,
      hkdAddress: `Số ${i} Đường Lê Lợi`,
      taxCode: `010012${String(3000 + i)}`,
      ownerName: `Chủ hộ ${i}`,
      gender: i % 2 === 0 ? 'Nam' : 'Nữ',
      ethnicity: 'Kinh',
      cccdNumber: `0010012${String(20000 + i)}`,
      permanentAddress: `Thường trú ${i}`,
      currentAddress: i % 3 === 0 ? `Hiện tại ${i}` : null
    });
    ok(`tạo hồ sơ #${i} → ok`, r.ok === true, r);
    if (r.id) dosIds.push(r.id);
  }
  ok('list hồ sơ = 30', (await dsr.listDossiers()).data?.length === 30);
  ok('lọc theo nguồn[1] > 0', ((await dsr.listDossiers({ sourceId: srcIds[1] })).data?.length ?? 0) > 0);
  ok('tìm theo tên HKD "HKD Số 5" = 1', (await dsr.listDossiers({ search: 'HKD Số 5' })).data?.filter((d) => d.hkdName === 'HKD Số 5').length === 1);
  ok('tìm theo chủ hộ "Chủ hộ 7" ≥ 1', ((await dsr.listDossiers({ search: 'Chủ hộ 7' })).data?.length ?? 0) >= 1);

  // (4) đính kèm ĐKKD (tên theo Tên HKD) + CCCD (tên theo Tên chủ hộ) — kiểm tên chuẩn + đọc lại (6)
  const withDoc = await dsr.createDossier({ sourceId: srcIds[0], hkdName: 'Hộ Cửa Hàng An', ownerName: 'Nguyễn Văn Bình', dkkdFrontSrc: dkkdSrc, cccdFrontSrc: cccdSrc });
  ok('tạo hồ sơ kèm ĐKKD + CCCD mặt trước → ok', withDoc.ok === true, withDoc);
  const dRow = (await dsr.listDossiers({ search: 'Hộ Cửa Hàng An' })).data?.[0];
  ok('path ĐKKD đặt tên theo Tên HKD', dRow?.dkkdFrontPath === `dossier/${withDoc.id}/1. ĐKKD MT - Hộ Cửa Hàng An.pdf`, dRow?.dkkdFrontPath);
  ok('path CCCD đặt tên theo Tên chủ hộ', dRow?.cccdFrontPath === `dossier/${withDoc.id}/1. CCCD MT - Nguyễn Văn Bình.png`, dRow?.cccdFrontPath);
  ok('file ĐKKD tồn tại (>0 byte)', fileSize(dRow?.dkkdFrontPath ?? '') > 0);
  ok('đọc lại ĐKKD → data URL PDF', readAttachmentDataUrl(dRow?.dkkdFrontPath ?? '').dataUrl?.startsWith('data:application/pdf;base64,') === true);
  ok('đọc lại CCCD → data URL PNG', readAttachmentDataUrl(dRow?.cccdFrontPath ?? '').dataUrl?.startsWith('data:image/png;base64,') === true);

  // (5) đủ 4 mặt (2)
  const full4 = await dsr.createDossier({ sourceId: srcIds[0], hkdName: 'Hộ Bốn Mặt', ownerName: 'Trần Bốn', dkkdFrontSrc: dkkdSrc, dkkdBackSrc: dkkdSrc, cccdFrontSrc: cccdSrc, cccdBackSrc: cccdSrc });
  ok('tạo hồ sơ đủ 4 mặt ảnh → ok', full4.ok === true);
  const f4 = (await dsr.listDossiers({ search: 'Hộ Bốn Mặt' })).data?.[0];
  ok('có đủ 4 path ảnh', !!f4?.dkkdFrontPath && !!f4?.dkkdBackPath && !!f4?.cccdFrontPath && !!f4?.cccdBackPath, f4);

  // (6) cập nhật: đổi tên HKD (1)
  ok('sửa tên HKD → ok', (await dsr.updateDossier(dosIds[0], { sourceId: srcIds[0], hkdName: 'HKD Số 0 (sửa)', ownerName: 'Chủ hộ 0' })).ok === true);

  // (7) cập nhật: thêm ảnh CCCD mặt sau vào hồ sơ vốn chỉ có mặt trước (2)
  ok('thêm CCCD mặt sau khi cập nhật → ok', (await dsr.updateDossier(withDoc.id!, { sourceId: srcIds[0], hkdName: 'Hộ Cửa Hàng An', ownerName: 'Nguyễn Văn Bình', cccdBackSrc: cccdSrc })).ok === true);
  const dRow2 = (await dsr.listDossiers({ search: 'Hộ Cửa Hàng An' })).data?.[0];
  ok('sau cập nhật đã có CCCD mặt sau', !!dRow2?.cccdBackPath && fileSize(dRow2?.cccdBackPath ?? '') > 0, dRow2?.cccdBackPath);

  // (8) cập nhật: gỡ ảnh ĐKKD mặt trước (null) → path null (2)
  ok('gỡ ĐKKD mặt trước (null) → ok', (await dsr.updateDossier(full4.id!, { sourceId: srcIds[0], hkdName: 'Hộ Bốn Mặt', ownerName: 'Trần Bốn', dkkdFrontSrc: null })).ok === true);
  const f4b = (await dsr.listDossiers({ search: 'Hộ Bốn Mặt' })).data?.[0];
  ok('sau gỡ, ĐKKD mặt trước = null (3 mặt còn lại)', f4b?.dkkdFrontPath === null && !!f4b?.dkkdBackPath && !!f4b?.cccdFrontPath, f4b);

  // (9) xóa hợp lệ (3)
  ok('xóa 1 hồ sơ (đúng mk) → deleted=1', (await dsr.deleteDossiers([dosIds[29]], PW)).deleted === 1);
  ok('hồ sơ đã xóa rời danh sách', (await dsr.listDossiers()).data?.some((d) => d.id === dosIds[29]) === false);
  ok('xóa nguồn[7] (đúng mk) → deleted=1', (await dsr.deleteSources([srcIds[7]], PW)).deleted === 1);

  // ═══════════ 50+ SAI ═══════════
  // (A) Nguồn hồ sơ (8)
  ok('SAI nguồn thiếu mã → VALIDATION', (await dsr.createSource({ code: '  ', discountRate: 0.1 })).error === 'VALIDATION');
  ok('SAI chiết khấu âm → VALIDATION', (await dsr.createSource({ code: 'XZ', discountRate: -1 })).error === 'VALIDATION');
  ok('SAI chiết khấu >3 thập phân → VALIDATION', (await dsr.createSource({ code: 'XZ2', discountRate: 0.0001 })).error === 'VALIDATION');
  ok('SAI nguồn trùng mã "NGUON02" → DUPLICATE', (await dsr.createSource({ code: 'NGUON02', discountRate: 0.1 })).error === 'DUPLICATE');
  ok('SAI sửa nguồn không tồn tại → NOT_FOUND', (await dsr.updateSource(999001, { code: 'Z' })).error === 'NOT_FOUND');
  ok('SAI sửa nguồn trùng mã khác → DUPLICATE', (await dsr.updateSource(srcIds[1], { code: 'NGUON03' })).error === 'DUPLICATE');
  ok('SAI xóa nguồn không chọn → VALIDATION', (await dsr.deleteSources([], PW)).error === 'VALIDATION');
  ok('SAI xóa nguồn sai mật khẩu → WRONG_PASSWORD', (await dsr.deleteSources([srcIds[2]], 'sai')).error === 'WRONG_PASSWORD');
  ok('SAI tái tạo nguồn đã xóa "NGUON08" → DUPLICATE_TRASH', (await dsr.createSource({ code: 'NGUON08', discountRate: 0.1 })).error === 'DUPLICATE_TRASH');

  // (B) Hồ sơ HKD (10)
  const baseD = { sourceId: srcIds[0], hkdName: 'X', ownerName: 'Y' };
  ok('SAI hồ sơ thiếu nguồn → VALIDATION', (await dsr.createDossier({ ...baseD, sourceId: 0 })).error === 'VALIDATION');
  ok('SAI hồ sơ thiếu tên HKD → VALIDATION', (await dsr.createDossier({ ...baseD, hkdName: ' ' })).error === 'VALIDATION');
  ok('SAI hồ sơ thiếu chủ hộ → VALIDATION', (await dsr.createDossier({ ...baseD, ownerName: '  ' })).error === 'VALIDATION');
  ok('SAI hồ sơ nguồn không tồn tại → NOT_FOUND', (await dsr.createDossier({ ...baseD, sourceId: 999002 })).error === 'NOT_FOUND');
  ok('SAI hồ sơ nguồn đã xóa mềm → NOT_FOUND', (await dsr.createDossier({ ...baseD, sourceId: srcIds[7] })).error === 'NOT_FOUND');
  ok('SAI sửa hồ sơ không tồn tại → NOT_FOUND', (await dsr.updateDossier(999003, baseD)).error === 'NOT_FOUND');
  ok('SAI sửa hồ sơ tên HKD rỗng → VALIDATION', (await dsr.updateDossier(dosIds[1], { ...baseD, hkdName: '  ' })).error === 'VALIDATION');
  ok('SAI sửa hồ sơ chủ hộ rỗng → VALIDATION', (await dsr.updateDossier(dosIds[1], { ...baseD, ownerName: '  ' })).error === 'VALIDATION');
  ok('SAI sửa hồ sơ nguồn không tồn tại → NOT_FOUND', (await dsr.updateDossier(dosIds[1], { ...baseD, sourceId: 999004 })).error === 'NOT_FOUND');
  ok('SAI xóa hồ sơ không chọn → VALIDATION', (await dsr.deleteDossiers([], PW)).error === 'VALIDATION');
  ok('SAI xóa hồ sơ sai mật khẩu → WRONG_PASSWORD', (await dsr.deleteDossiers([dosIds[1]], 'sai')).error === 'WRONG_PASSWORD');

  // (C) 25 lần tạo trùng mã nguồn đang hoạt động → DUPLICATE (25)
  for (let i = 0; i < 25; i++) {
    const code = srcCodes[i % 6 + 1]; // 1..6 đang active (né 0 đã đổi mã, 7 đã xóa)
    ok(`SAI tạo trùng mã nguồn "${code}" #${i} → DUPLICATE`, (await dsr.createSource({ code, discountRate: 0.1 })).error === 'DUPLICATE');
  }

  // (D) Không quyền: SALES → FORBIDDEN (8)
  await userSvc.createUser({ fullName: 'NV Sales Dsr', username: 'salesdsr', password: 'Sales@123456', roleCodes: ['SALES'] }).catch(() => undefined);
  await logout();
  await login('salesdsr', 'Sales@123456');
  ok('SAI SALES list nguồn hồ sơ → FORBIDDEN', (await dsr.listSources()).error === 'FORBIDDEN');
  ok('SAI SALES list hồ sơ → FORBIDDEN', (await dsr.listDossiers()).error === 'FORBIDDEN');
  ok('SAI SALES tạo nguồn → FORBIDDEN', (await dsr.createSource({ code: 'X', discountRate: 0 })).error === 'FORBIDDEN');
  ok('SAI SALES sửa nguồn → FORBIDDEN', (await dsr.updateSource(srcIds[1], { code: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES xóa nguồn → FORBIDDEN', (await dsr.deleteSources([srcIds[1]], PW)).error === 'FORBIDDEN');
  ok('SAI SALES tạo hồ sơ → FORBIDDEN', (await dsr.createDossier(baseD)).error === 'FORBIDDEN');
  ok('SAI SALES sửa hồ sơ → FORBIDDEN', (await dsr.updateDossier(dosIds[1], baseD)).error === 'FORBIDDEN');
  ok('SAI SALES xóa hồ sơ → FORBIDDEN', (await dsr.deleteDossiers([dosIds[1]], PW)).error === 'FORBIDDEN');
  await logout();

  // eslint-disable-next-line no-console
  console.log(`GCFG9 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
