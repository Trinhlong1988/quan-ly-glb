// G-CFG.1 Cấu hình ngân hàng — self-test tích hợp 50 ĐÚNG + 50 SAI (R_LINK_VERIFY, GLB_SELFTEST=4).
// Chạy trên DB throwaway (GLB_DB_URL). Chứng minh qua tầng service THẬT (permission + audit + soft-delete):
//   C1/C2 Ngân hàng · C3 Loại thẻ (map bankId) · C4 Đối tác · C4c liên kết Đối tác↔Ngân hàng (map n-n).
// Mọi thao tác sai bị chặn đúng error code; SALES (không quyền) bị FORBIDDEN toàn bộ.
import { login, logout } from './auth-service.js';
import * as userSvc from './user-service.js';
import * as cfg from './bank-config-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`GCFG4 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

const PW = 'Admin@123456';

export async function runBankConfigSelfTest(): Promise<number> {
  await login('adminroot', PW);

  // ===================== 50 CASE ĐÚNG =====================
  // (1) Tạo 15 ngân hàng hợp lệ (15)
  const bankIds: number[] = [];
  const bankCodes = ['vcb', 'tcb', 'bidv', 'vtb', 'acb', 'mb', 'vpb', 'tpb', 'stb', 'shb', 'hdb', 'ocb', 'eib', 'msb', 'lpb'];
  for (const c of bankCodes) {
    const r = await cfg.createBank({ name: `Ngân hàng ${c.toUpperCase()}`, code: c });
    ok(`tạo ngân hàng ${c} → ok`, r.ok === true && typeof r.id === 'number', r);
    if (r.id) bankIds.push(r.id);
  }

  // (2) list trả đúng 15 + mã đã chuẩn hóa HOA (2)
  let banks = await cfg.listBanks();
  ok('list ngân hàng = 15', banks.ok === true && banks.data?.length === 15, banks.data?.length);
  ok('mã ngân hàng chuẩn hóa in HOA (vcb→VCB)', banks.data?.some((b) => b.code === 'VCB') === true);

  // (3) search theo mã trả đúng 1 (1)
  const searchVcb = await cfg.listBanks({ search: 'VCB' });
  ok('search "VCB" → 1 kết quả', searchVcb.data?.length === 1, searchVcb.data?.length);

  // (4) update tên + mã ngân hàng đầu → ok (2)
  const upBank = await cfg.updateBank(bankIds[0], { name: 'Ngoại thương VN', code: 'vcbx' });
  ok('update ngân hàng đầu → ok', upBank.ok === true, upBank);
  const afterUp = await cfg.listBanks({ search: 'VCBX' });
  ok('update ngân hàng: mã mới VCBX hiển thị', afterUp.data?.[0]?.name === 'Ngoại thương VN', afterUp.data?.[0]);

  // (5) listBanksLite = 15 (1)
  const lite = await cfg.listBanksLite();
  ok('listBanksLite = 15', lite.data?.length === 15, lite.data?.length);

  // (6) Tạo 12 loại thẻ hợp lệ, phân bổ vào 3 ngân hàng đầu (12)
  const ctIds: number[] = [];
  for (let i = 0; i < 12; i++) {
    const bankId = bankIds[i % 3];
    const r = await cfg.createCardType({ bankId, name: `Loại thẻ ${i}`, code: `CT${i}` });
    ok(`tạo loại thẻ CT${i} (bank ${bankId}) → ok`, r.ok === true, r);
    if (r.id) ctIds.push(r.id);
  }

  // (7) list loại thẻ lọc theo bankId[0] → đúng số (map bankId chính xác) (2)
  const ctBank0 = await cfg.listCardTypes({ bankId: bankIds[0] });
  ok('loại thẻ lọc theo bank[0] = 4 (i=0,3,6,9)', ctBank0.data?.length === 4, ctBank0.data?.length);
  ok('loại thẻ mang đúng bankCode của bank[0]', ctBank0.data?.every((c) => c.bankId === bankIds[0]) === true);

  // (8) update loại thẻ (đổi tên) → ok (1)
  const upCt = await cfg.updateCardType(ctIds[0], { name: 'Napas nội địa' });
  ok('update loại thẻ → ok', upCt.ok === true, upCt);

  // (9) chuyển loại thẻ sang ngân hàng khác (re-map bankId) → ok (1)
  const moveCt = await cfg.updateCardType(ctIds[1], { bankId: bankIds[5] });
  ok('đổi ngân hàng của loại thẻ → ok', moveCt.ok === true, moveCt);

  // (10) Tạo 10 đối tác hợp lệ (10)
  const partnerIds: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await cfg.createPartner({ name: `Đối tác ${i}`, code: `dt${i}`, phone: `090000000${i}`, contactPerson: `Liên hệ ${i}` });
    ok(`tạo đối tác dt${i} → ok`, r.ok === true, r);
    if (r.id) partnerIds.push(r.id);
  }

  // (11) liên kết đối tác[0] với 3 ngân hàng → linked=3 (1)
  const link1 = await cfg.setPartnerBanks(partnerIds[0], [bankIds[0], bankIds[1], bankIds[2]]);
  ok('liên kết đối tác[0] ↔ 3 ngân hàng → linked=3', link1.ok === true && link1.linked === 3, link1);

  // (12) ma trận: hàng đối tác[0] có đúng 3 bankIds (2)
  let matrix = await cfg.getPartnerBankMatrix();
  const row0 = matrix.data?.rows.find((r) => r.partnerId === partnerIds[0]);
  ok('ma trận: đối tác[0] có 3 liên kết', row0?.bankIds.length === 3, row0);
  ok('ma trận: banks = 15 cột', matrix.data?.banks.length === 15, matrix.data?.banks.length);

  // (13) đổi tập liên kết đối tác[0] → giữ bank0, bỏ bank1+2, thêm bank3+4 (linked=2, unlinked=2) (1)
  const link2 = await cfg.setPartnerBanks(partnerIds[0], [bankIds[0], bankIds[3], bankIds[4]]);
  ok('đổi liên kết đối tác[0] → linked=2 unlinked=2', link2.ok === true && link2.linked === 2 && link2.unlinked === 2, link2);

  // (14) listPartners: đối tác[0] bankIds length = 3 sau khi đổi (1)
  const plist = await cfg.listPartners();
  const p0 = plist.data?.find((p) => p.id === partnerIds[0]);
  ok('đối tác[0] hiện có 3 ngân hàng liên kết', p0?.bankIds.length === 3, p0?.bankIds);

  // (15) update đối tác (đổi tên+sđt) → ok (1)
  const upP = await cfg.updatePartner(partnerIds[1], { name: 'Đối tác đổi tên', phone: '0999999999' });
  ok('update đối tác → ok', upP.ok === true, upP);

  // (16) xóa 1 ngân hàng chưa dùng (bank cuối) đúng mật khẩu → deleted=1 (2)
  const delBank = await cfg.deleteBanks([bankIds[14]], PW);
  ok('xóa ngân hàng (đúng mk) → deleted=1', delBank.ok === true && delBank.deleted === 1, delBank);
  banks = await cfg.listBanks();
  ok('sau xóa: còn 14 ngân hàng', banks.data?.length === 14, banks.data?.length);

  // (17) xóa 1 loại thẻ đúng mật khẩu → deleted=1 (1)
  const delCt = await cfg.deleteCardTypes([ctIds[11]], PW);
  ok('xóa loại thẻ (đúng mk) → deleted=1', delCt.ok === true && delCt.deleted === 1, delCt);

  // (18) xóa đối tác[9] đúng mật khẩu → deleted=1 + liên kết bị hủy (1)
  const delP = await cfg.deletePartners([partnerIds[9]], PW);
  ok('xóa đối tác (đúng mk) → deleted=1', delP.ok === true && delP.deleted === 1, delP);

  // ===================== 50 CASE SAI =====================
  // (BUG G-CFG-B01) tái tạo mã đang nằm Thùng rác KHÔNG được phép + KHÔNG crash → DUPLICATE_TRASH (2)
  const reuseBank = await cfg.createBank({ name: 'LienVietPost tái lập', code: 'lpb' });
  ok('SAI tái tạo mã ngân hàng đã xóa mềm (LPB) → DUPLICATE_TRASH (không crash)', reuseBank.error === 'DUPLICATE_TRASH', reuseBank);
  const reusePartner = await cfg.createPartner({ name: 'ĐT tái lập', code: 'dt9' });
  ok('SAI tái tạo mã đối tác đã xóa mềm (DT9) → DUPLICATE_TRASH (không crash)', reusePartner.error === 'DUPLICATE_TRASH', reusePartner);
  // (A) Ngân hàng — validation/duplicate/not-found (8)
  ok('SAI tạo ngân hàng thiếu tên → VALIDATION', (await cfg.createBank({ name: '  ', code: 'x1' })).error === 'VALIDATION');
  ok('SAI tạo ngân hàng thiếu mã → VALIDATION', (await cfg.createBank({ name: 'X', code: '  ' })).error === 'VALIDATION');
  ok('SAI tạo ngân hàng trùng mã TCB → DUPLICATE', (await cfg.createBank({ name: 'X', code: 'tcb' })).error === 'DUPLICATE');
  ok('SAI update ngân hàng không tồn tại → NOT_FOUND', (await cfg.updateBank(999001, { name: 'Z' })).error === 'NOT_FOUND');
  ok('SAI update ngân hàng thành tên rỗng → VALIDATION', (await cfg.updateBank(bankIds[1], { name: '   ' })).error === 'VALIDATION');
  ok('SAI update ngân hàng thành mã rỗng → VALIDATION', (await cfg.updateBank(bankIds[1], { code: '   ' })).error === 'VALIDATION');
  ok('SAI update ngân hàng trùng mã hiện có (BIDV) → DUPLICATE', (await cfg.updateBank(bankIds[1], { code: 'bidv' })).error === 'DUPLICATE');
  ok('SAI xóa ngân hàng không chọn id → VALIDATION', (await cfg.deleteBanks([], PW)).error === 'VALIDATION');

  // (B) Loại thẻ (7)
  ok('SAI tạo loại thẻ không chọn bank → VALIDATION', (await cfg.createCardType({ bankId: 0, name: 'A', code: 'A' })).error === 'VALIDATION');
  ok('SAI tạo loại thẻ thiếu tên → VALIDATION', (await cfg.createCardType({ bankId: bankIds[0], name: ' ', code: 'A' })).error === 'VALIDATION');
  ok('SAI tạo loại thẻ thiếu mã → VALIDATION', (await cfg.createCardType({ bankId: bankIds[0], name: 'A', code: ' ' })).error === 'VALIDATION');
  ok('SAI tạo loại thẻ bank không tồn tại → NOT_FOUND', (await cfg.createCardType({ bankId: 999002, name: 'A', code: 'A' })).error === 'NOT_FOUND');
  ok('SAI tạo loại thẻ trùng (bank+code CT0) → DUPLICATE', (await cfg.createCardType({ bankId: bankIds[0], name: 'dup', code: 'CT0' })).error === 'DUPLICATE');
  ok('SAI update loại thẻ không tồn tại → NOT_FOUND', (await cfg.updateCardType(999003, { name: 'Z' })).error === 'NOT_FOUND');
  ok('SAI xóa loại thẻ sai mật khẩu → WRONG_PASSWORD', (await cfg.deleteCardTypes([ctIds[2]], 'sai_mat_khau')).error === 'WRONG_PASSWORD');

  // (C) Đối tác (7)
  ok('SAI tạo đối tác thiếu tên → VALIDATION', (await cfg.createPartner({ name: ' ', code: 'p1' })).error === 'VALIDATION');
  ok('SAI tạo đối tác thiếu mã → VALIDATION', (await cfg.createPartner({ name: 'P', code: ' ' })).error === 'VALIDATION');
  ok('SAI tạo đối tác trùng mã DT0 → DUPLICATE', (await cfg.createPartner({ name: 'P', code: 'dt0' })).error === 'DUPLICATE');
  ok('SAI update đối tác không tồn tại → NOT_FOUND', (await cfg.updatePartner(999004, { name: 'Z' })).error === 'NOT_FOUND');
  ok('SAI update đối tác trùng mã DT2 → DUPLICATE', (await cfg.updatePartner(partnerIds[3], { code: 'dt2' })).error === 'DUPLICATE');
  ok('SAI xóa đối tác không chọn id → VALIDATION', (await cfg.deletePartners([], PW)).error === 'VALIDATION');
  ok('SAI xóa đối tác sai mật khẩu → WRONG_PASSWORD', (await cfg.deletePartners([partnerIds[2]], 'sai')).error === 'WRONG_PASSWORD');

  // (D) Liên kết đối tác↔ngân hàng (3)
  ok('SAI liên kết: đối tác không tồn tại → NOT_FOUND', (await cfg.setPartnerBanks(999005, [bankIds[0]])).error === 'NOT_FOUND');
  ok('SAI liên kết: ngân hàng không tồn tại → NOT_FOUND', (await cfg.setPartnerBanks(partnerIds[0], [999006])).error === 'NOT_FOUND');
  ok('SAI liên kết: đối tác đã xóa → NOT_FOUND', (await cfg.setPartnerBanks(partnerIds[9], [bankIds[0]])).error === 'NOT_FOUND');

  // (E) 10 lần tạo trùng mã ngân hàng ĐANG hoạt động → DUPLICATE (10)
  // Dùng index 1..10 (bỏ vcb đã đổi tên ở case 4, bỏ lpb đã xóa) để chắc chắn mã còn active.
  for (let i = 0; i < 10; i++) {
    const code = bankCodes[i + 1];
    const r = await cfg.createBank({ name: `dup ${i}`, code });
    ok(`SAI tạo trùng mã ${code} #${i} → DUPLICATE`, r.error === 'DUPLICATE', r.error);
  }

  // (F) Không quyền: SALES (chỉ DASHBOARD/CUSTOMER) → mọi thao tác cfg FORBIDDEN (15)
  await userSvc.createUser({ fullName: 'NV Sales CFG', username: 'salescfg', password: 'Sales@123456', roleCodes: ['SALES'] }).catch(() => undefined);
  await logout();
  await login('salescfg', 'Sales@123456');
  ok('SAI SALES list ngân hàng → FORBIDDEN', (await cfg.listBanks()).error === 'FORBIDDEN');
  ok('SAI SALES list loại thẻ → FORBIDDEN', (await cfg.listCardTypes()).error === 'FORBIDDEN');
  ok('SAI SALES list đối tác → FORBIDDEN', (await cfg.listPartners()).error === 'FORBIDDEN');
  ok('SAI SALES ma trận → FORBIDDEN', (await cfg.getPartnerBankMatrix()).error === 'FORBIDDEN');
  ok('SAI SALES listLite → FORBIDDEN', (await cfg.listBanksLite()).error === 'FORBIDDEN');
  ok('SAI SALES tạo ngân hàng → FORBIDDEN', (await cfg.createBank({ name: 'X', code: 'zzz' })).error === 'FORBIDDEN');
  ok('SAI SALES update ngân hàng → FORBIDDEN', (await cfg.updateBank(bankIds[0], { name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES xóa ngân hàng → FORBIDDEN', (await cfg.deleteBanks([bankIds[0]], PW)).error === 'FORBIDDEN');
  ok('SAI SALES tạo loại thẻ → FORBIDDEN', (await cfg.createCardType({ bankId: bankIds[0], name: 'X', code: 'ZZ' })).error === 'FORBIDDEN');
  ok('SAI SALES update loại thẻ → FORBIDDEN', (await cfg.updateCardType(ctIds[0], { name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES xóa loại thẻ → FORBIDDEN', (await cfg.deleteCardTypes([ctIds[0]], PW)).error === 'FORBIDDEN');
  ok('SAI SALES tạo đối tác → FORBIDDEN', (await cfg.createPartner({ name: 'X', code: 'zzp' })).error === 'FORBIDDEN');
  ok('SAI SALES update đối tác → FORBIDDEN', (await cfg.updatePartner(partnerIds[0], { name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES xóa đối tác → FORBIDDEN', (await cfg.deletePartners([partnerIds[0]], PW)).error === 'FORBIDDEN');
  ok('SAI SALES set liên kết → FORBIDDEN', (await cfg.setPartnerBanks(partnerIds[0], [bankIds[0]])).error === 'FORBIDDEN');
  await logout();

  // eslint-disable-next-line no-console
  console.log(`GCFG4 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
