// Bill giải trình — self-test (headless, GLB_SELFTEST=44). Mr.Long 16/7.
// Phủ: (A) Thư viện SP CRUD + validate + import + xóa (mật khẩu). (B) Sinh bill giải trình money-EXACT
// (Σ đơn giá×SL = số tiền), tab theo dõi (join nhãn HKD/ngành/TID), xóa. (C) Guard quyền (SALES→FORBIDDEN),
// NO_PRODUCTS khi ngành trống. Engine composition assert TRỰC TIẾP generateLineItems (không parse xlsx).
import { existsSync } from 'node:fs';
import { login, logout } from './auth-service.js';
import { getDb, seedBillExplainLibrary, normIndustryName } from './db.js';
import * as ind from './industry-service.js';
import * as dsr from './dossier-service.js';
import * as tidSvc from './tid-service.js';
import * as userSvc from './user-service.js';
import * as be from './bill-explain-service.js';
import { generateLineItems, maxComposable, type ProductLite } from './billexplain/lineitem-gen.js';

let failures = 0;
function assert(name: string, cond: boolean, extra?: unknown): void {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  // eslint-disable-next-line no-console
  console.log(`BE44 ${status} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';

export async function runBillExplainSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', PW);

  // ── Seed ngành + hồ sơ HKD + TID ──────────────────────────────────────────────
  const indMain = await ind.createIndustry({ name: 'BE Ngành Vé Xe' });
  const indEmpty = await ind.createIndustry({ name: 'BE Ngành Rỗng' });
  assert('tạo 2 ngành nghề ok', indMain.ok === true && indEmpty.ok === true, { a: indMain.error, b: indEmpty.error });
  const src = await db.dossierSource.create({ data: { code: 'BEHS', discountRate: 0 } });
  const dos = await dsr.createDossier({ sourceId: src.id, hkdName: 'BE Hộ Kinh Doanh', ownerName: 'Nguyễn Văn Bill', hkdAddress: '123 Đường Giải Trình' });
  assert('tạo hồ sơ HKD ok', dos.ok === true, dos.error);
  await tidSvc.createTid({ tid: 'BE-TID-1', bank: 'VCB' });
  const tidRow = await db.tid.findUnique({ where: { tid: 'BE-TID-1' }, select: { id: true } });
  assert('tạo TID theo dõi ok', tidRow != null);

  // ══ (A) THƯ VIỆN SẢN PHẨM ══════════════════════════════════════════════════════
  // Đơn giá bội 10.000 để tổ hợp khớp chính xác targets bội 10.000.
  const prices = [10_000, 20_000, 50_000, 100_000, 250_000, 500_000];
  const created: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    const r = await be.createProduct({ industryId: indMain.id!, name: `SP Vé loại ${i + 1}`, unit: 'vé', price: prices[i] });
    assert(`tạo SP #${i + 1} (giá ${prices[i]}) ok`, r.ok === true, r.error);
    if (r.id) created.push(r.id);
  }
  // Validate: giá 0 / âm / thập phân / thiếu tên / thiếu ĐVT / ngành không tồn tại → VALIDATION.
  assert('SAI giá 0 → VALIDATION', (await be.createProduct({ industryId: indMain.id!, name: 'X', unit: 'vé', price: 0 })).error === 'VALIDATION');
  assert('SAI giá âm → VALIDATION', (await be.createProduct({ industryId: indMain.id!, name: 'X', unit: 'vé', price: -5 })).error === 'VALIDATION');
  assert('SAI giá thập phân → VALIDATION', (await be.createProduct({ industryId: indMain.id!, name: 'X', unit: 'vé', price: 1000.5 })).error === 'VALIDATION');
  assert('BILL-04(SP): giá "-100" → VALIDATION (không đổi dấu ngầm →100)', (await be.createProduct({ industryId: indMain.id!, name: 'X', unit: 'vé', price: ('-100' as unknown as number) })).error === 'VALIDATION');
  assert('BILL-04(SP): giá "1e3" → VALIDATION (không thành 13)', (await be.createProduct({ industryId: indMain.id!, name: 'X', unit: 'vé', price: ('1e3' as unknown as number) })).error === 'VALIDATION');
  assert('SP giá > MAX_SAFE → VALIDATION', (await be.createProduct({ industryId: indMain.id!, name: 'X', unit: 'vé', price: ('9007199254740993' as unknown as number) })).error === 'VALIDATION');
  assert('SAI thiếu tên → VALIDATION', (await be.createProduct({ industryId: indMain.id!, name: '  ', unit: 'vé', price: 10000 })).error === 'VALIDATION');
  assert('SAI thiếu ĐVT → VALIDATION', (await be.createProduct({ industryId: indMain.id!, name: 'Y', unit: ' ', price: 10000 })).error === 'VALIDATION');
  assert('SAI ngành không tồn tại → VALIDATION', (await be.createProduct({ industryId: 999044, name: 'Z', unit: 'vé', price: 10000 })).error === 'VALIDATION');

  // list lọc theo ngành → đúng 6 SP.
  const listMain = await be.listProducts({ industryId: indMain.id! });
  assert('list SP theo ngành = 6', listMain.ok === true && listMain.data?.length === 6, { n: listMain.data?.length });
  assert('list join tên ngành', (listMain.data ?? []).every((p) => p.industryName === 'BE Ngành Vé Xe'));

  // update: đổi giá ok; stale-write (mốc cũ) → STALE_WRITE.
  const p0 = listMain.data![0];
  const up = await be.updateProduct(p0.id, { price: 11_000, expectedUpdatedAt: p0.updatedAt });
  assert('cập nhật giá SP ok', up.ok === true, up.error);
  const stale = await be.updateProduct(p0.id, { price: 12_000, expectedUpdatedAt: p0.updatedAt });
  assert('cập nhật mốc cũ → STALE_WRITE', stale.ok === false && stale.error === 'STALE_WRITE', { err: stale.error });
  // trả lại giá 10.000 cho tổ hợp sạch (dùng mốc mới nhất).
  const p0now = (await be.listProducts({ industryId: indMain.id! })).data!.find((x) => x.id === p0.id)!;
  await be.updateProduct(p0.id, { price: 10_000, expectedUpdatedAt: p0now.updatedAt });

  // import: 2 hợp lệ + 3 lỗi (thiếu tên / giá chữ / giá 0) → imported=2, skipped=3.
  const imp = await be.importProducts(indMain.id!, [
    { name: 'SP Nhập A', unit: 'vé', price: 30_000 },
    { name: 'SP Nhập B', unit: 'vé', price: '40000' },
    { name: 'SP Nhập C', unit: 'vé', price: '45.000' }, // VN-format → 45000 (import phải nhận)
    { name: '', unit: 'vé', price: 50_000 },             // thiếu tên
    { name: 'SP Lỗi', unit: 'vé', price: 'abc' },        // chữ
    { name: 'SP Lỗi 2', unit: 'vé', price: 0 },          // 0
    { name: 'SP Lỗi 3', unit: 'vé', price: '-100' }      // âm (không được thành 100)
  ]);
  assert('import SP: imported=3 skipped=4 (VN "45.000" nhận, "-100" loại)', imp.ok === true && imp.imported === 3 && imp.skipped === 4, { imp });
  assert('import VN "45.000" lưu đúng 45000 (không mất/đổi số)', (await be.listProducts({ industryId: indMain.id!, search: 'SP Nhập C' })).data?.[0]?.price === 45_000);

  // xóa: sai mật khẩu → WRONG_PASSWORD; đúng → deleted (xóa 2 SP nhập, còn 6 SP gốc).
  const impIds = (await be.listProducts({ industryId: indMain.id!, search: 'SP Nhập' })).data!.map((x) => x.id);
  assert('sai mật khẩu xóa SP → WRONG_PASSWORD', (await be.deleteProducts(impIds, 'sai-mat-khau')).error === 'WRONG_PASSWORD');
  const del = await be.deleteProducts(impIds, PW);
  assert('xóa 3 SP nhập ok', del.ok === true && del.deleted === 3, { del });
  assert('sau xóa còn 6 SP gốc', (await be.listProducts({ industryId: indMain.id! })).data?.length === 6);

  // (A') Ưu tiên (priority, B3 Mr.Long 16/7): round-trip qua DB — tạo với priority, đọc, sửa, clamp, mặc định 0.
  const prCreate = await be.createProduct({ industryId: indMain.id!, name: 'SP Ưu Tiên', unit: 'vé', price: 100_000, priority: 50 });
  assert('tạo SP có priority ok', prCreate.ok === true, prCreate.error);
  const prRow = (await be.listProducts({ industryId: indMain.id!, search: 'SP Ưu Tiên' })).data?.[0];
  assert('priority lưu + đọc lại đúng (50)', prRow?.priority === 50, { p: prRow?.priority });
  assert('SP thường mặc định priority 0', (await be.listProducts({ industryId: indMain.id!, search: 'SP Vé loại 1' })).data?.[0]?.priority === 0);
  const prUp = await be.updateProduct(prRow!.id, { priority: 999, expectedUpdatedAt: prRow!.updatedAt });
  assert('cập nhật priority ok', prUp.ok === true, prUp.error);
  const prClamp = await be.createProduct({ industryId: indMain.id!, name: 'SP Clamp', unit: 'vé', price: 100_000, priority: (99999 as unknown as number) });
  assert('priority > 1000 bị clamp về 1000', prClamp.ok === true && (await be.listProducts({ industryId: indMain.id!, search: 'SP Clamp' })).data?.[0]?.priority === 1000);
  // dọn 2 SP phụ để giữ tổ hợp 6 SP gốc sạch cho section B.
  await be.deleteProducts([prRow!.id, ...((await be.listProducts({ industryId: indMain.id!, search: 'SP Clamp' })).data ?? []).map((x) => x.id)], PW);
  assert('dọn SP priority → còn 6 SP gốc', (await be.listProducts({ industryId: indMain.id! })).data?.length === 6);

  // ══ (B) ENGINE money-EXACT (assert trực tiếp, không parse xlsx) ═════════════════
  // Targets bội 10.000 → khớp CHÍNH XÁC được với bộ giá toàn bội 10.000.
  const lites: ProductLite[] = prices.map((pr, i) => ({ name: `SP Vé loại ${i + 1}`, unit: 'vé', price: pr }));
  for (const t of [500_000, 1_000_000, 2_500_000, 3_330_000]) {
    let okGen = false, exact = false;
    try {
      const g = generateLineItems(t, lites);
      const sum = g.lines.reduce((s, l) => s + l.price * l.qty, 0);
      okGen = true;
      exact = sum === g.subtotal && g.subtotal - g.discount_amount === t && g.lines.length >= 1;
    } catch { okGen = false; }
    assert(`engine sinh dòng khớp CHÍNH XÁC target ${t}`, okGen && exact, { t });
  }

  // ══ (B-realistic) CÂN ĐỐI + SỐ LƯỢNG hợp lý + KHÔNG treo (Mr.Long 16/7) ═══════════════════════════
  // KHÔNG tách HĐ; 1 HĐ tới 299tr; số lượng CÂN ĐỐI đều các dòng (không 1 dòng ôm hết = gốc "40 nồi cơm"),
  // ≤ HARD_UNIT_CAP (200), đa dạng SP, tiền khớp CHÍNH XÁC, và target lẻ khó ghép KHÔNG treo (deadline).
  const realyLib: ProductLite[] = [
    { name: 'Nồi cơm điện', unit: 'cái', price: 1_500_000 },
    { name: 'Tivi 43 inch', unit: 'cái', price: 8_000_000 },
    { name: 'Hành tây', unit: 'kg', price: 30_000 },
    { name: 'Gạo ST25', unit: 'kg', price: 40_000 },
    { name: 'Nước mắm', unit: 'chai', price: 60_000 },
    { name: 'Bột giặt', unit: 'hộp', price: 120_000 },
    { name: 'Dầu ăn', unit: 'lít', price: 50_000 },
    { name: 'Bàn chải', unit: 'cái', price: 20_000 },
    { name: 'Cà phê bột', unit: 'gói', price: 90_000 },
    { name: 'Đường trắng', unit: 'kg', price: 25_000 }
  ];
  let balanceOk = true, qtyOk = true, moneyOk = true, diverseOk = true, genCount = 0, worstRatio = 0, worstQty = 0;
  for (const t of [1_230_000, 11_100_000, 60_000_000, 150_000_000, 299_000_000]) {
    for (let rep = 0; rep < 8; rep++) {
      const g = generateLineItems(t, realyLib); // target thực tế ≤299tr PHẢI ghép được (throw = lỗi thật)
      genCount++;
      const sum = g.lines.reduce((s, l) => s + Math.round(l.price * l.qty), 0);
      if (sum !== g.subtotal || g.subtotal - g.discount_amount !== t) moneyOk = false;
      if (new Set(g.lines.map((l) => l.name)).size !== g.lines.length) diverseOk = false;
      const share = g.subtotal / g.lines.length;
      for (const l of g.lines) {
        const ratio = (l.price * l.qty) / share;
        worstRatio = Math.max(worstRatio, ratio);
        worstQty = Math.max(worstQty, l.qty);
        if (ratio > 3.5) balanceOk = false;
        if (l.qty > 200 || l.qty <= 0) qtyOk = false;
      }
    }
  }
  assert('B-realistic: sinh được mọi target 1.2tr→299tr (không throw)', genCount === 40, { genCount });
  assert('B-realistic: CÂN ĐỐI — không dòng nào ôm > 3.5× phần chia đều', balanceOk, { worstRatio: worstRatio.toFixed(2) });
  assert('B-realistic: số lượng KHÔNG phi lý (≤200, >0)', qtyOk, { worstQty });
  assert('B-realistic: các dòng ĐA DẠNG (khác tên nhau)', diverseOk);
  assert('B-realistic: tiền khớp CHÍNH XÁC', moneyOk);
  // KHÔNG treo: target lẻ khó ghép trả về nhanh (deadline ~300ms), không spin main process 30–50s (agent-1 HIGH).
  const tPerf = Date.now();
  try { generateLineItems(123_456_789, realyLib); } catch { /* ok nếu throw */ }
  assert('B-realistic: target lẻ khó ghép KHÔNG treo (<1.5s)', Date.now() - tPerf < 1500, { ms: Date.now() - tPerf });
  // Service chặn > trần 299tr (KHÔNG tách): báo VALIDATION rõ, không sinh.
  const over = await be.generateBills({ dossierId: dos.id!, industryId: indMain.id!, billDate: '2026-07-16', targets: [300_000_000] });
  assert('service: 1 hóa đơn > 299tr → VALIDATION (không tách, báo rõ)', over.ok === false && over.error === 'VALIDATION', { over: over.error });

  // ══ (B) SINH BILL end-to-end (xuất file thật) ══════════════════════════════════
  // ngành trống → NO_PRODUCTS.
  const noProd = await be.generateBills({ dossierId: dos.id!, industryId: indEmpty.id!, billDate: '2026-07-16', targets: [1_000_000] });
  assert('sinh bill ngành trống → NO_PRODUCTS', noProd.ok === false && noProd.error === 'NO_PRODUCTS', { err: noProd.error });
  // targets rỗng/không hợp lệ → VALIDATION.
  assert('sinh bill không có số tiền hợp lệ → VALIDATION', (await be.generateBills({ dossierId: dos.id!, industryId: indMain.id!, billDate: '2026-07-16', targets: [0, -1, 'abc'] })).error === 'VALIDATION');
  // HKD không tồn tại → VALIDATION.
  assert('sinh bill HKD không tồn tại → VALIDATION', (await be.generateBills({ dossierId: 999044, industryId: indMain.id!, billDate: '2026-07-16', targets: [1_000_000] })).error === 'VALIDATION');

  const targets = [500_000, 1_000_000, 2_500_000];
  const gen = await be.generateBills({ dossierId: dos.id!, tidId: tidRow!.id, industryId: indMain.id!, billDate: '2026-07-16', targets });
  assert('sinh 3 bill ok', gen.ok === true && gen.totalBills === 3, { gen });
  assert('không có target lỗi', (gen.errors?.length ?? 0) === 0, { errs: gen.errors });
  assert('file .xlsx tồn tại trên đĩa', !!gen.file && existsSync(gen.file), { file: gen.file });

  // tab theo dõi: list join nhãn + tổng tiền = Σ targets.
  const listBE = await be.listBillExplains({});
  const rec = listBE.data?.find((r) => r.id === gen.id);
  assert('theo dõi có bản ghi vừa sinh', rec != null);
  assert('tổng tiền = Σ số tiền (4.000.000)', rec?.totalAmount === 4_000_000, { total: rec?.totalAmount });
  assert('join nhãn HKD/ngành/TID + số bill', rec?.dossierName === 'BE Hộ Kinh Doanh' && rec?.industryName === 'BE Ngành Vé Xe' && rec?.tidCode === 'BE-TID-1' && rec?.billCount === 3, { rec });
  assert('mã bill prefix BE', (rec?.code ?? '').startsWith('BE'), { code: rec?.code });

  // số HĐ kế tiếp tăng đúng theo số bill (billNoStart cũ + 3).
  const cfg = await be.getBillExplainConfig();
  assert('billNoStart tăng +3 sau khi sinh', cfg.data?.billNoStart === 1 + 3, { start: cfg.data?.billNoStart });

  // xóa theo dõi: sai mật khẩu → WRONG_PASSWORD; đúng → deleted, list không còn.
  assert('sai mật khẩu xóa bill → WRONG_PASSWORD', (await be.deleteBillExplains([gen.id!], 'sai')).error === 'WRONG_PASSWORD');
  const delBE = await be.deleteBillExplains([gen.id!], PW);
  assert('xóa bill theo dõi ok', delBE.ok === true && delBE.deleted === 1, { delBE });
  assert('sau xóa list không còn bản ghi', (await be.listBillExplains({})).data?.find((r) => r.id === gen.id) == null);

  // ══ (B) DEGRADE DUYÊN DÁNG — số tiền bất khả thi bị bỏ vào errors[], số còn lại vẫn sinh ═══════
  // 7.777.777 KHÔNG chia hết cho bội-10.000 → engine không tổ hợp được → PHẢI vào errors[], KHÔNG crash.
  const mix = await be.generateBills({ dossierId: dos.id!, industryId: indMain.id!, billDate: '2026-07-16', targets: [1_000_000, 7_777_777] });
  assert('mix (1 khớp + 1 bất khả thi): vẫn ok, sinh 1 bill', mix.ok === true && mix.totalBills === 1, { mix });
  assert('số tiền bất khả thi vào errors[] (không crash, không sinh sai)', (mix.errors?.length ?? 0) === 1 && mix.errors?.[0]?.target === 7_777_777, { errs: mix.errors });
  if (mix.id) await be.deleteBillExplains([mix.id], PW); // dọn

  // ══ (B2) ĐỐI KHÁNG audit 0.2.53 (Codex) — REPRODUCE→FIX từng mã ═══════════════════════════════
  const baseGen = { dossierId: dos.id!, industryId: indMain.id!, billDate: '2026-07-16' };
  // BILL-01: ngành XÓA MỀM mà còn SP → VALIDATION (trước lọt vì chỉ dựa NO_PRODUCTS).
  const indDel = await ind.createIndustry({ name: 'BE Ngành Xóa' });
  await be.createProduct({ industryId: indDel.id!, name: 'SP tạm', unit: 'cái', price: 10_000 });
  await ind.deleteIndustries([indDel.id!], PW);
  assert('BILL-01: ngành xóa mềm (còn SP) → VALIDATION', (await be.generateBills({ ...baseGen, industryId: indDel.id!, targets: [500_000] })).error === 'VALIDATION');
  assert('BILL-01: ngành không tồn tại → VALIDATION', (await be.generateBills({ ...baseGen, industryId: 999044, targets: [500_000] })).error === 'VALIDATION');
  // BILL-02: TID thuộc HKD KHÁC → VALIDATION.
  const dos2 = await dsr.createDossier({ sourceId: src.id, hkdName: 'BE HKD 2', ownerName: 'Người Hai' });
  await tidSvc.createTid({ tid: 'BE-TID-2', bank: 'VCB' });
  const tid2 = await db.tid.findUnique({ where: { tid: 'BE-TID-2' }, select: { id: true } });
  await db.tid.update({ where: { id: tid2!.id }, data: { dossierId: dos2.id! } });
  assert('BILL-02: TID thuộc HKD khác → VALIDATION', (await be.generateBills({ ...baseGen, tidId: tid2!.id, targets: [500_000] })).error === 'VALIDATION');
  // BILL-03: ngày sai → VALIDATION (không cuộn ngầm / không về hôm nay).
  for (const bad of ['', '2026-02-31', '2026-13-01', '2026-2-3', '2026/07/16', 'hôm nay']) {
    assert(`BILL-03: ngày "${bad}" → VALIDATION`, (await be.generateBills({ ...baseGen, billDate: bad, targets: [500_000] })).error === 'VALIDATION');
  }
  assert('BILL-03: ngày nhuận thật 2028-02-29 → hợp lệ', (await be.generateBills({ ...baseGen, billDate: '2028-02-29', targets: [500_000] })).ok === true);
  // BILL-04: tiền dị dạng → VALIDATION (KHÔNG strip/mutate; cũ '-100'→100 đổi dấu ngầm).
  for (const bad of ['-100', '1.5', '1e3', '1,000', 'abc', '  ', '0']) {
    assert(`BILL-04: số tiền "${bad}" → VALIDATION`, (await be.generateBills({ ...baseGen, targets: [bad] })).error === 'VALIDATION');
  }
  // BILL-05: > MAX_SAFE (mất chữ số khi qua Number) → VALIDATION.
  assert('BILL-05: 9007199254740993 (>2^53) → VALIDATION', (await be.generateBills({ ...baseGen, targets: ['9007199254740993'] })).error === 'VALIDATION');
  // BILL-09: IPC dị dạng → VALIDATION, KHÔNG TypeError.
  assert('BILL-09: targets object → VALIDATION', (await be.generateBills({ ...baseGen, targets: ({} as unknown as (number | string)[]) })).error === 'VALIDATION');
  assert('BILL-09: targets null → VALIDATION', (await be.generateBills({ ...baseGen, targets: (null as unknown as (number | string)[]) })).error === 'VALIDATION');
  assert('BILL-09: dossierId chuỗi → VALIDATION', (await be.generateBills({ ...baseGen, dossierId: ('1' as unknown as number), targets: [500_000] })).error === 'VALIDATION');

  // ══ (B3) BILL-06 CONCURRENCY THẬT (PostgreSQL đồng thời) — số HĐ dải KHÔNG chồng ═════════════════
  const sieuThiIdC = (await db.industry.findFirst({ where: { name: 'Siêu thị', deletedAt: null }, select: { id: true } }))!.id;
  const K_NO = 'billexplain.billNoStart';
  const before = Number((await db.appSetting.findUnique({ where: { key: K_NO } }))?.value) || 1;
  const conc = await Promise.all([
    be.generateBills({ dossierId: dos.id!, industryId: sieuThiIdC, billDate: '2026-07-16', targets: [500_000, 1_000_000, 1_500_000] }),
    be.generateBills({ dossierId: dos.id!, industryId: sieuThiIdC, billDate: '2026-07-16', targets: [600_000, 1_100_000, 1_600_000] })
  ]);
  assert('BILL-06: 2 generate đồng thời đều ok (không crash)', conc.every((r) => r.ok === true), conc.map((r) => r.error));
  const after = Number((await db.appSetting.findUnique({ where: { key: K_NO } }))?.value) || 1;
  assert('BILL-06: số HĐ cấp ATOMIC — tăng đúng tổng dải 6 (không cấp trùng)', after === before + 6, { before, after });
  for (const r of conc) if (r.id) await be.deleteBillExplains([r.id], PW);

  // ══ (D) SEED THƯ VIỆN GỐC RENBILL — CHỈ ngành CÓ sản phẩm (Siêu thị), khớp case-insensitive (B71) ══
  // seedIfEmpty ĐÃ seed lúc boot (cờ AppSetting). B71: KHÔNG tạo ngành rỗng dư + khớp tên hoa/thường.
  const sieuThi = await db.industry.findFirst({ where: { name: { equals: 'Siêu thị', mode: 'insensitive' }, deletedAt: null }, select: { id: true } });
  assert('seed: ngành Siêu thị tồn tại', sieuThi != null);
  assert('seed: Siêu thị có 199 SP ACTIVE (giá/ĐVT thật)', (await be.listProducts({ industryId: sieuThi!.id })).data?.length === 199);
  const reseed = await seedBillExplainLibrary(db);
  assert('seed idempotent (gọi lại no-op)', reseed.industries === 0 && reseed.products === 0, reseed);
  assert('B71: chỉ 1 ngành Siêu thị (không trùng hoa/thường)', (await db.industry.findMany({ where: { name: { equals: 'Siêu thị', mode: 'insensitive' }, deletedAt: null } })).length === 1);
  // B71 regression trực tiếp: đổi tên thành HOA "Siêu Thị" rồi seed lại → PHẢI tái dùng (không đẻ bản mới).
  await db.industry.update({ where: { id: sieuThi!.id }, data: { name: 'Siêu Thị' } });
  const reseed2 = await seedBillExplainLibrary(db);
  assert('B71: seed khớp case-insensitive "Siêu Thị" → KHÔNG tạo ngành mới', reseed2.industries === 0, reseed2);
  assert('B71: vẫn chỉ 1 ngành Siêu thị sau seed lại (hoa/thường)', (await db.industry.findMany({ where: { name: { equals: 'Siêu thị', mode: 'insensitive' }, deletedAt: null } })).length === 1);
  // F4 (16/7): dedup seed KHÔNG chỉ hoa/thường — còn NFD (dấu tổ hợp) + khoảng trắng thừa. normIndustryName
  // chuẩn hóa NFC + gộp space + trim + lower → biến thể "Siêu  thị " (2 space + NFD) PHẢI tái dùng, không đẻ mới.
  await db.industry.update({ where: { id: sieuThi!.id }, data: { name: '  Siêu  thị  '.normalize('NFD') } });
  const reseed3 = await seedBillExplainLibrary(db);
  assert('F4: seed khớp NFD + khoảng trắng thừa → KHÔNG tạo ngành mới', reseed3.industries === 0, reseed3);
  // Đếm bằng CHUẨN HÓA (normIndustryName) chứ không so tên thô — vì tên trong DB đang ở dạng NFD/space vừa set,
  // query equals thô sẽ trượt. Bản chất kiểm: đúng 1 ngành chuẩn hóa về "siêu thị" (không đẻ trùng).
  const allInd = await db.industry.findMany({ where: { deletedAt: null }, select: { name: true } });
  assert('F4: vẫn chỉ 1 ngành Siêu thị sau seed lại (NFD/space)', allInd.filter((i) => normIndustryName(i.name) === 'siêu thị').length === 1);
  await db.industry.update({ where: { id: sieuThi!.id }, data: { name: 'Siêu thị' } });
  // engine khớp CHÍNH XÁC với thư viện SIÊU THỊ THẬT (giá lẻ 464..850k) — chọn target cấu trúc từ chính SP.
  const realLites = (await be.listProducts({ industryId: sieuThi!.id })).data!.map((p) => ({ name: p.name, unit: p.unit, price: p.price }));
  const t0 = realLites[0].price * 3 + realLites[5].price * 2 + realLites[10].price; // tồn tại nghiệm
  let realExact = false;
  try { const g = generateLineItems(t0, realLites); realExact = g.lines.reduce((s, l) => s + l.price * l.qty, 0) === g.subtotal && g.subtotal - g.discount_amount === t0; } catch { realExact = false; }
  assert('engine khớp chính xác trên thư viện Siêu thị thật', realExact, { t0 });

  // ══ (C) GUARD QUYỀN — SALES không có quyền Bill giải trình → FORBIDDEN ══════════
  await userSvc.createUser({ fullName: 'BE Sales', phone: '0900000440', email: null, username: 'besales01', password: 'Pass@1234', roleCodes: ['SALES'] });
  await logout();
  await login('besales01', 'Pass@1234');
  assert('SALES xem thư viện SP → FORBIDDEN', (await be.listProducts({})).error === 'FORBIDDEN');
  assert('SALES tạo SP → FORBIDDEN', (await be.createProduct({ industryId: indMain.id!, name: 'Hack', unit: 'vé', price: 10000 })).error === 'FORBIDDEN');
  assert('SALES sinh bill → FORBIDDEN', (await be.generateBills({ dossierId: dos.id!, industryId: indMain.id!, billDate: '2026-07-16', targets: [1_000_000] })).error === 'FORBIDDEN');
  await logout();
  await login('adminroot', PW);

  // eslint-disable-next-line no-console
  console.log(`BE44 SUMMARY | failures=${failures}`);
  return failures === 0 ? 0 : 1;
}
