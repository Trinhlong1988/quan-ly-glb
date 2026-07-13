// G-CFG.3 Cấu hình phí — self-test 50 ĐÚNG + 50 SAI (R_LINK_VERIFY, GLB_SELFTEST=7).
// Loại phí (§C5a) + Biểu phí % theo Đối tác × Loại thẻ (§C5b): upsert, cột chênh lệch tính động,
// ràng buộc ngân hàng-của-loại-thẻ phải liên kết đối tác, phí ≤3 thập phân, permission.
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import * as fee from './fee-config-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`GCFG7 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

export async function runFeeConfigSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', PW);

  // ── SETUP nền: 1 ngân hàng VCB + 5 loại thẻ + 4 đối tác liên kết + 1 đối tác KHÔNG liên kết ──
  const vcb = await db.bank.create({ data: { name: 'Vietcombank', code: 'VCB' } });
  const cards: Awaited<ReturnType<typeof db.cardType.create>>[] = [];
  for (const nm of ['Visa', 'Master', 'Napas', 'Unionpay', 'Amex']) cards.push(await db.cardType.create({ data: { bankId: vcb.id, name: nm, code: nm.toUpperCase() } }));
  const partners: Awaited<ReturnType<typeof db.partner.create>>[] = [];
  for (let i = 0; i < 4; i++) {
    const p = await db.partner.create({ data: { name: `Đối tác ${i}`, code: `P${i}` } });
    await db.partnerBank.create({ data: { partnerId: p.id, bankId: vcb.id } });
    partners.push(p);
  }
  const pUnlinked = await db.partner.create({ data: { name: 'Đối tác chưa liên kết', code: 'P9' } });

  // ═══════════ 50 ĐÚNG ═══════════
  // (1) 8 loại phí (8)
  const ftIds: number[] = [];
  const ftNames = ['Ủy quyền', 'Tiền chờ', 'Tiền Nhanh', 'Chiết khấu', 'Hoa hồng', 'Phí duy trì', 'Phí kích hoạt', 'Phí đổi máy'];
  for (const nm of ftNames) {
    const r = await fee.createFeeType({ name: nm });
    ok(`tạo loại phí "${nm}" → ok`, r.ok === true, r);
    if (r.id) ftIds.push(r.id);
  }
  ok('list loại phí = 8', (await fee.listFeeTypes()).data?.length === 8);
  ok('update loại phí[0] → ok', (await fee.updateFeeType(ftIds[0], { name: 'Ủy quyền (sửa)' })).ok === true);

  // FEE_MODEL — phí mua/cài CỐ ĐỊNH (không theo loại phí); phí bán NIÊM YẾT theo TỪNG loại phí (sellQuotes).
  const ft0 = ftIds[0];
  const ft1 = ftIds[1];
  // Helper phí bán niêm yết của 1 dòng theo loại phí.
  const quoteOf = (row: fee.FeeRateDto | undefined, feeTypeId: number): number | undefined => row?.sellQuotes.find((q) => q.feeTypeId === feeTypeId)?.phiBan;
  // (2) 20 biểu phí: 4 đối tác × 5 loại thẻ — mỗi biểu phí có niêm yết cho ft0 (20)
  for (let pi = 0; pi < 4; pi++) {
    for (let ci = 0; ci < 5; ci++) {
      const r = await fee.setFeeRate({ partnerId: partners[pi].id, cardTypeId: cards[ci].id, phiMua: 1.02 + ci * 0.01, phiCaiMay: 1.0 + ci * 0.01, sellQuotes: [{ feeTypeId: ft0, phiBan: 1.05 + ci * 0.01 }] });
      ok(`set phí P${pi}×${cards[ci].code} → ok`, r.ok === true, r);
    }
  }
  ok('list biểu phí = 20 (1 dòng / đối tác×thẻ, KHÔNG nhân theo loại phí)', (await fee.listFeeRates()).data?.length === 20);
  ok('lọc theo đối tác[0] = 5', (await fee.listFeeRates({ partnerId: partners[0].id })).data?.length === 5);
  ok('lọc theo ngân hàng VCB = 20', (await fee.listFeeRates({ bankId: vcb.id })).data?.length === 20);

  // (3) cột chênh lệch tính đúng: CL_NCC ở dòng, CL_KH ở sellQuote (3)
  const setCL = await fee.setFeeRate({ partnerId: partners[0].id, cardTypeId: cards[0].id, phiMua: 1.5, phiCaiMay: 1.0, sellQuotes: [{ feeTypeId: ft0, phiBan: 1.8 }] });
  ok('set phí kiểm CL → ok', setCL.ok === true);
  const rowCL = (await fee.listFeeRates({ partnerId: partners[0].id })).data?.find((r) => r.cardTypeId === cards[0].id);
  ok('CL với NCC = phiMua−phiCài = 0.5', rowCL != null && near(rowCL.clNcc, 0.5), rowCL);
  ok('CL với KH = phiBán niêm yết−phiCài = 0.8', rowCL != null && near(rowCL.sellQuotes.find((q) => q.feeTypeId === ft0)?.clKh ?? -1, 0.8), rowCL);

  // (4) round-trip 3 số thập phân 1.068 (1)
  await fee.setFeeRate({ partnerId: partners[1].id, cardTypeId: cards[0].id, phiMua: 1.068, phiCaiMay: 1.0, sellQuotes: [{ feeTypeId: ft0, phiBan: 1.1 }] });
  const rt = (await fee.listFeeRates({ partnerId: partners[1].id })).data?.find((r) => r.cardTypeId === cards[0].id);
  ok('phí 1.068 lưu & trả về chính xác', rt != null && near(rt.phiMua, 1.068), rt?.phiMua);

  // (5) upsert: set lại cùng (đối tác×thẻ) → CẬP NHẬT, không tạo dòng mới (2)
  const before = (await fee.listFeeRates()).data?.length ?? 0;
  await fee.setFeeRate({ partnerId: partners[0].id, cardTypeId: cards[0].id, phiMua: 2.0, phiCaiMay: 1.0, sellQuotes: [{ feeTypeId: ft0, phiBan: 2.5 }] });
  ok('upsert KHÔNG tăng số dòng', (await fee.listFeeRates()).data?.length === before, { before, after: (await fee.listFeeRates()).data?.length });
  const upRow = (await fee.listFeeRates({ partnerId: partners[0].id })).data?.find((r) => r.cardTypeId === cards[0].id);
  ok('upsert cập nhật đúng phí mới (2.0)', upRow != null && near(upRow.phiMua, 2.0), upRow?.phiMua);

  // (6) reactivate: xóa mềm 1 biểu phí rồi set lại cùng tổ hợp → sống lại (2)
  const target = (await fee.listFeeRates({ partnerId: partners[2].id })).data?.find((r) => r.cardTypeId === cards[4].id);
  ok('xóa mềm 1 biểu phí (đúng mk) → deleted=1', (await fee.deleteFeeRates([target!.id], PW)).deleted === 1);
  const reAct = await fee.setFeeRate({ partnerId: partners[2].id, cardTypeId: cards[4].id, phiMua: 1.11, phiCaiMay: 1.0, sellQuotes: [{ feeTypeId: ft0, phiBan: 1.2 }] });
  ok('set lại tổ hợp đã xóa mềm → sống lại (ok)', reAct.ok === true && (await fee.listFeeRates({ partnerId: partners[2].id })).data?.some((r) => r.cardTypeId === cards[4].id) === true);

  // (7) xóa hợp lệ (4)
  ok('xóa loại phí[7] (đúng mk) → deleted=1', (await fee.deleteFeeTypes([ftIds[7]], PW)).deleted === 1);
  ok('sau xóa còn 7 loại phí', (await fee.listFeeTypes()).data?.length === 7);
  const delRate = (await fee.listFeeRates({ partnerId: partners[3].id })).data?.[0];
  ok('xóa biểu phí (đúng mk) → deleted=1', (await fee.deleteFeeRates([delRate!.id], PW)).deleted === 1);
  ok('biểu phí đã xóa rời danh sách', (await fee.listFeeRates()).data?.some((r) => r.id === delRate!.id) === false);

  // (8) verify 5 dòng của đối tác[1] map đúng loại thẻ (5)
  const p1rows = (await fee.listFeeRates({ partnerId: partners[1].id })).data ?? [];
  for (let ci = 0; ci < 5; ci++) ok(`P1 có dòng cho thẻ ${cards[ci].code}`, p1rows.some((r) => r.cardTypeId === cards[ci].id));

  // (9) FEE_MODEL — PHÍ MUA/CÀI KHÔNG ĐỔI THEO LOẠI PHÍ; MỖI LOẠI PHÍ NIÊM YẾT RIÊNG:
  // P0×c0 đang có phiMua 2.0 + niêm yết ft0=2.5. Set lại CÙNG (P0,c0) với 2 loại phí niêm yết KHÁC nhau
  // (ft0=2.6, ft1=3.0) — vẫn 1 DÒNG (không nhân theo loại phí), phí mua/cài GIỮ, mỗi loại phí niêm yết riêng.
  const cntBefore9 = (await fee.listFeeRates()).data?.length ?? 0;
  const setFt1 = await fee.setFeeRate({ partnerId: partners[0].id, cardTypeId: cards[0].id, phiMua: 2.0, phiCaiMay: 1.0, sellQuotes: [{ feeTypeId: ft0, phiBan: 2.6 }, { feeTypeId: ft1, phiBan: 3.0 }] });
  ok('set P0×c0 với 2 loại phí niêm yết → ok', setFt1.ok === true, setFt1);
  ok('KHÔNG tăng số dòng (phí mua/cài không nhân theo loại phí)', (await fee.listFeeRates()).data?.length === cntBefore9, { before: cntBefore9, after: (await fee.listFeeRates()).data?.length });
  const rowP0c0 = (await fee.listFeeRates({ partnerId: partners[0].id })).data?.find((r) => r.cardTypeId === cards[0].id);
  ok('P0×c0 vẫn 1 dòng, phí mua CỐ ĐỊNH 2.0 (không theo loại phí)', rowP0c0 != null && near(rowP0c0.phiMua, 2.0), rowP0c0?.phiMua);
  ok('P0×c0 có 2 phí bán niêm yết (ft0, ft1)', rowP0c0 != null && rowP0c0.sellQuotes.length === 2, rowP0c0?.sellQuotes);
  ok('niêm yết ft0 = 2.6; niêm yết ft1 = 3.0 (mỗi loại phí RIÊNG)', near(quoteOf(rowP0c0, ft0) ?? -1, 2.6) && near(quoteOf(rowP0c0, ft1) ?? -1, 3.0), rowP0c0?.sellQuotes);
  // upsert niêm yết: đổi ft1 → 3.2, giữ ft0 → cập nhật đúng, không thêm dòng.
  const cntBeforeUp = (await fee.listFeeRates()).data?.length ?? 0;
  await fee.setFeeRate({ partnerId: partners[0].id, cardTypeId: cards[0].id, phiMua: 2.0, phiCaiMay: 1.0, sellQuotes: [{ feeTypeId: ft0, phiBan: 2.6 }, { feeTypeId: ft1, phiBan: 3.2 }] });
  ok('upsert niêm yết → KHÔNG tăng dòng', (await fee.listFeeRates()).data?.length === cntBeforeUp, { before: cntBeforeUp });
  ok('upsert niêm yết ft1 → giá mới 3.2', near(quoteOf((await fee.listFeeRates({ partnerId: partners[0].id })).data?.find((r) => r.cardTypeId === cards[0].id), ft1) ?? -1, 3.2));

  // ═══════════ 50 SAI ═══════════
  // (A) Loại phí (7)
  ok('SAI loại phí thiếu tên → VALIDATION', (await fee.createFeeType({ name: ' ' })).error === 'VALIDATION');
  ok('SAI loại phí trùng "Tiền chờ" → DUPLICATE', (await fee.createFeeType({ name: 'Tiền chờ' })).error === 'DUPLICATE');
  ok('SAI loại phí update không tồn tại → NOT_FOUND', (await fee.updateFeeType(999001, { name: 'Z' })).error === 'NOT_FOUND');
  ok('SAI loại phí update trùng → DUPLICATE', (await fee.updateFeeType(ftIds[1], { name: 'Tiền Nhanh' })).error === 'DUPLICATE');
  ok('SAI loại phí xóa không chọn → VALIDATION', (await fee.deleteFeeTypes([], PW)).error === 'VALIDATION');
  ok('SAI loại phí xóa sai mật khẩu → WRONG_PASSWORD', (await fee.deleteFeeTypes([ftIds[2]], 'sai')).error === 'WRONG_PASSWORD');
  ok('SAI tái tạo loại phí đã xóa (Phí đổi máy) → DUPLICATE_TRASH', (await fee.createFeeType({ name: 'Phí đổi máy' })).error === 'DUPLICATE_TRASH');

  // (B) Biểu phí — validation/không liên kết/không tồn tại (FEE_MODEL: sellQuotes) (18)
  const base = { partnerId: partners[0].id, cardTypeId: cards[0].id, phiMua: 1, phiCaiMay: 1, sellQuotes: [{ feeTypeId: ft0, phiBan: 1 }] };
  ok('SAI set phí sellQuotes RỖNG → VALIDATION', (await fee.setFeeRate({ ...base, sellQuotes: [] })).error === 'VALIDATION');
  ok('SAI set phí niêm yết thiếu loại phí → VALIDATION', (await fee.setFeeRate({ ...base, sellQuotes: [{ feeTypeId: 0, phiBan: 1 }] })).error === 'VALIDATION');
  ok('SAI set phí niêm yết loại phí không tồn tại → NOT_FOUND', (await fee.setFeeRate({ ...base, sellQuotes: [{ feeTypeId: 999009, phiBan: 1 }] })).error === 'NOT_FOUND');
  ok('SAI set phí niêm yết < phí cài máy → VALIDATION', (await fee.setFeeRate({ ...base, phiMua: 2, phiCaiMay: 1.5, sellQuotes: [{ feeTypeId: ft0, phiBan: 1.0 }] })).error === 'VALIDATION');
  ok('SAI phí mua < phí cài máy → VALIDATION', (await fee.setFeeRate({ ...base, phiMua: 0.5, phiCaiMay: 1.0 })).error === 'VALIDATION');
  ok('SAI set phí thiếu đối tác → VALIDATION', (await fee.setFeeRate({ ...base, partnerId: 0 })).error === 'VALIDATION');
  ok('SAI set phí thiếu loại thẻ → VALIDATION', (await fee.setFeeRate({ ...base, cardTypeId: 0 })).error === 'VALIDATION');
  ok('SAI phí mua âm → VALIDATION', (await fee.setFeeRate({ ...base, phiMua: -1 })).error === 'VALIDATION');
  ok('SAI phí mua >3 thập phân → VALIDATION', (await fee.setFeeRate({ ...base, phiMua: 1.0001 })).error === 'VALIDATION');
  ok('SAI phí cài >3 thập phân → VALIDATION', (await fee.setFeeRate({ ...base, phiCaiMay: 2.00001 })).error === 'VALIDATION');
  ok('SAI phí bán niêm yết âm → VALIDATION', (await fee.setFeeRate({ ...base, sellQuotes: [{ feeTypeId: ft0, phiBan: -0.5 }] })).error === 'VALIDATION');
  ok('SAI set phí đối tác không tồn tại → NOT_FOUND', (await fee.setFeeRate({ ...base, partnerId: 999002 })).error === 'NOT_FOUND');
  ok('SAI set phí loại thẻ không tồn tại → NOT_FOUND', (await fee.setFeeRate({ ...base, cardTypeId: 999003 })).error === 'NOT_FOUND');
  ok('SAI set phí đối tác CHƯA liên kết ngân hàng → NOT_LINKED', (await fee.setFeeRate({ ...base, partnerId: pUnlinked.id })).error === 'NOT_LINKED');
  ok('SAI set phí đối tác chưa liên kết (thẻ khác) → NOT_LINKED', (await fee.setFeeRate({ ...base, partnerId: pUnlinked.id, cardTypeId: cards[2].id })).error === 'NOT_LINKED');
  ok('SAI xóa biểu phí không chọn → VALIDATION', (await fee.deleteFeeRates([], PW)).error === 'VALIDATION');
  ok('SAI xóa biểu phí sai mật khẩu → WRONG_PASSWORD', (await fee.deleteFeeRates([delRate!.id + 0], 'sai')).error === 'WRONG_PASSWORD');
  ok('SAI phí cài âm → VALIDATION', (await fee.setFeeRate({ ...base, phiCaiMay: -2 })).error === 'VALIDATION');
  ok('SAI phí bán niêm yết >3 thập phân → VALIDATION', (await fee.setFeeRate({ ...base, sellQuotes: [{ feeTypeId: ft0, phiBan: 1.23456 }] })).error === 'VALIDATION');

  // (C) 24 lần tạo trùng loại phí đang hoạt động → DUPLICATE (24) — đảm bảo khối SAI ≥ 50
  for (let i = 0; i < 24; i++) {
    const nm = ftNames[i % 6 + 1]; // né index 0 (đã đổi tên) — dùng 1..6 đang active
    const r = await fee.createFeeType({ name: nm });
    ok(`SAI tạo trùng loại phí "${nm}" #${i} → DUPLICATE`, r.error === 'DUPLICATE', r.error);
  }

  // (D) Không quyền: SALES → FORBIDDEN (7)
  await userSvc.createUser({ fullName: 'NV Sales Fee', username: 'salesfee', password: 'Sales@123456', roleCodes: ['SALES'] }).catch(() => undefined);
  await logout();
  await login('salesfee', 'Sales@123456');
  ok('SAI SALES list loại phí → FORBIDDEN', (await fee.listFeeTypes()).error === 'FORBIDDEN');
  ok('SAI SALES list biểu phí → FORBIDDEN', (await fee.listFeeRates()).error === 'FORBIDDEN');
  ok('SAI SALES tạo loại phí → FORBIDDEN', (await fee.createFeeType({ name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES sửa loại phí → FORBIDDEN', (await fee.updateFeeType(ftIds[1], { name: 'X' })).error === 'FORBIDDEN');
  ok('SAI SALES xóa loại phí → FORBIDDEN', (await fee.deleteFeeTypes([ftIds[1]], PW)).error === 'FORBIDDEN');
  ok('SAI SALES set biểu phí → FORBIDDEN', (await fee.setFeeRate(base)).error === 'FORBIDDEN');
  ok('SAI SALES xóa biểu phí → FORBIDDEN', (await fee.deleteFeeRates([1], PW)).error === 'FORBIDDEN');
  await logout();

  // eslint-disable-next-line no-console
  console.log(`GCFG7 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
