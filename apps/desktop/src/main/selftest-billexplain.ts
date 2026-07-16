// Bill giải trình — self-test (headless, GLB_SELFTEST=44). Mr.Long 16/7.
// Phủ: (A) Thư viện SP CRUD + validate + import + xóa (mật khẩu). (B) Sinh bill giải trình money-EXACT
// (Σ đơn giá×SL = số tiền), tab theo dõi (join nhãn HKD/ngành/TID), xóa. (C) Guard quyền (SALES→FORBIDDEN),
// NO_PRODUCTS khi ngành trống. Engine composition assert TRỰC TIẾP generateLineItems (không parse xlsx).
import { existsSync } from 'node:fs';
import { login, logout } from './auth-service.js';
import { getDb, seedBillExplainLibrary } from './db.js';
import * as ind from './industry-service.js';
import * as dsr from './dossier-service.js';
import * as tidSvc from './tid-service.js';
import * as userSvc from './user-service.js';
import * as be from './bill-explain-service.js';
import { generateLineItems, type ProductLite } from './billexplain/lineitem-gen.js';

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
    { name: '', unit: 'vé', price: 50_000 },
    { name: 'SP Lỗi', unit: 'vé', price: 'abc' },
    { name: 'SP Lỗi 2', unit: 'vé', price: 0 }
  ]);
  assert('import SP: imported=2 skipped=3', imp.ok === true && imp.imported === 2 && imp.skipped === 3, { imp });

  // xóa: sai mật khẩu → WRONG_PASSWORD; đúng → deleted (xóa 2 SP nhập, còn 6 SP gốc).
  const impIds = (await be.listProducts({ industryId: indMain.id!, search: 'SP Nhập' })).data!.map((x) => x.id);
  assert('sai mật khẩu xóa SP → WRONG_PASSWORD', (await be.deleteProducts(impIds, 'sai-mat-khau')).error === 'WRONG_PASSWORD');
  const del = await be.deleteProducts(impIds, PW);
  assert('xóa 2 SP nhập ok', del.ok === true && del.deleted === 2, { del });
  assert('sau xóa còn 6 SP gốc', (await be.listProducts({ industryId: indMain.id! })).data?.length === 6);

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

  // ══ (D) SEED THƯ VIỆN GỐC RENBILL (Mr.Long 16/7) — 5 ngành + 199 SP Siêu thị thật ══════════════
  // seedIfEmpty ĐÃ seed lúc boot máy chủ (cờ AppSetting) → verify TRẠNG THÁI + idempotency (gọi lại = no-op).
  const seedNames = ['Vận tải', 'Thu hộ', 'Gas', 'Siêu thị', 'Cà phê'];
  const seededInds = await db.industry.findMany({ where: { name: { in: seedNames }, deletedAt: null }, select: { name: true } });
  assert('seed thư viện: đủ 5 ngành renbill tồn tại', new Set(seededInds.map((x) => x.name)).size === 5, seededInds.map((x) => x.name));
  const reseed = await seedBillExplainLibrary(db);
  assert('seed idempotent (đã seed lúc boot → gọi lại no-op)', reseed.industries === 0 && reseed.products === 0, reseed);
  const sieuThi = await db.industry.findFirst({ where: { name: 'Siêu thị', deletedAt: null }, select: { id: true } });
  assert('ngành Siêu thị có 199 SP ACTIVE (giá/ĐVT thật)', (await be.listProducts({ industryId: sieuThi!.id })).data?.length === 199);
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
