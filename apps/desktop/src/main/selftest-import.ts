// PHASE IMPORT (#9) — self-test Nhập liệu hàng loạt từ Excel (GLB_SELFTEST=31).
// Gọi THẲNG runImport(entityKey, rows[]) với rows dạng object (bỏ tầng parse file — kiểm LOGIC import).
// Mỗi entity: (a) 3 dòng hợp lệ → created=3; (b) thiếu bắt buộc → skipped+lý do; (c) FK tên không tồn tại
// → skipped; (d) FK tên mơ hồ (2 bản trùng tên) → skipped; (e) partial 2 ok + 1 lỗi → created=2 skipped=1;
// (f) sai vai → FORBIDDEN. Tái dùng create THẬT nên mọi nghiệp vụ vẫn enforce. DB throwaway RIÊNG.
import { login, logout } from './auth-service.js';
import * as bankSvc from './bank-config-service.js';
import * as posSupplySvc from './pos-supply-service.js';
import * as dossierSvc from './dossier-service.js';
import * as industrySvc from './industry-service.js';
import * as cashCatSvc from './cash-category-service.js';
import * as fundSvc from './fund-service.js';
import * as userSvc from './user-service.js';
import { getDb } from './db.js';
import { runImport, dryRunImport, importTemplateColumns, MAX_IMPORT_ROWS } from './import-service.js';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++;
  else fail++;
  // eslint-disable-next-line no-console
  console.log(`IMPORT31 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const PW = 'Admin@123456';
const UPW = 'Glb@123456';

export async function runImportSelfTest(): Promise<number> {
  await login('adminroot', PW);

  // ═══════════ SEED dữ liệu nền ═══════════
  await bankSvc.createBank({ name: 'Ngân Hàng Chung', code: 'NHA' }); // trùng TÊN (chỉ mã @unique) → dùng test mơ hồ
  await bankSvc.createBank({ name: 'Ngân Hàng Chung', code: 'NHB' });
  await bankSvc.createBank({ name: 'Vietcombank', code: 'VCB' }); // tên duy nhất → dùng cho dòng hợp lệ
  await bankSvc.createBank({ name: 'Ngân hàng Á Châu', code: 'ACB' }); // có tiền tố → test khớp tên NGẮN "Á Châu" (Cài APP)
  await bankSvc.createPartner({ name: 'Đối Tác X', code: 'DTX' });
  await industrySvc.createIndustry({ name: 'Ăn uống' }); // active mặc định
  await posSupplySvc.createPosModel({ code: 'MDA', name: 'Model A' });
  await posSupplySvc.createSupplier({ name: 'NCC Chung', code: 'NCA' }); // trùng TÊN → test mơ hồ
  await posSupplySvc.createSupplier({ name: 'NCC Chung', code: 'NCB' });
  await posSupplySvc.createSupplier({ name: 'NCC Zét', code: 'NCZ' }); // tên duy nhất
  await posSupplySvc.createIntakeStatus({ name: 'Máy mới' });
  await dossierSvc.createSource({ code: 'NG01', discountRate: 0.05 });
  await cashCatSvc.createCashCategory({ kind: 'THU', name: 'Bán máy' });
  await cashCatSvc.createCashCategory({ kind: 'CHI', name: 'Chi phí vận hành' });
  await fundSvc.createFund({ name: 'Quỹ tiền mặt', type: 'CASH' }); // mã QU01
  // 2 user trùng TÊN (mơ hồ) + 1 tên duy nhất + 1 kỹ thuật (thiếu quyền cho test FORBIDDEN).
  // Username ≥8 ký tự (ràng buộc validateUsername).
  await userSvc.createUser({ fullName: 'Nguyễn Văn Trùng', username: 'nvtrung01', password: UPW, roleCodes: ['ACCOUNTANT'] });
  await userSvc.createUser({ fullName: 'Nguyễn Văn Trùng', username: 'nvtrung02', password: UPW, roleCodes: ['ACCOUNTANT'] });
  await userSvc.createUser({ fullName: 'Nguyễn Cô Đơn', username: 'nvcodon01', password: UPW, roleCodes: ['ACCOUNTANT'] });
  await userSvc.createUser({ fullName: 'KT Kỹ Thuật', username: 'ktvien001', password: UPW, roleCodes: ['TECHNICIAN'] });
  // WAREHOUSE: CÓ CONFIG_TID_MANAGE nhưng KHÔNG có CASHENTRY_CREATE → test cách ly chéo quyền (FIX 4).
  await userSvc.createUser({ fullName: 'QL Kho', username: 'whmanager', password: UPW, roleCodes: ['WAREHOUSE'] });

  // ═══════════ importTemplateColumns ═══════════
  ok('template tid có ≥6 cột', importTemplateColumns('tid').data!.length >= 6);
  ok('template cashChi có cột "Người chi" bắt buộc', importTemplateColumns('cashChi').data!.some((c) => c.header === 'Người chi' && c.required));
  ok('template entity sai → error BAD_ENTITY', importTemplateColumns('khong_co').error === 'BAD_ENTITY');
  ok('runImport rows rỗng → EMPTY', (await runImport('customer', [])).error === 'EMPTY');
  ok('runImport entity sai → BAD_ENTITY', (await runImport('khong_co', [{}])).error === 'BAD_ENTITY');

  // ═══════════ (1) KHÁCH HÀNG (không FK) ═══════════
  let r = await runImport('customer', [
    { 'Biệt danh': 'Anh A', 'Tên thật': 'Nguyễn Văn A', 'Số điện thoại': '0900000001', 'Địa chỉ': 'Hà Nội' },
    { 'Biệt danh': 'Anh B', 'Tên thật': 'Nguyễn Văn B' },
    { 'Biệt danh': 'Anh C', 'Tên thật': 'Nguyễn Văn C' }
  ]);
  ok('customer (a) 3 hợp lệ → created=3', r.summary?.created === 3 && r.summary?.skipped === 0, r.summary);
  r = await runImport('customer', [{ 'Biệt danh': 'Thiếu tên' }]);
  ok('customer (b) thiếu Tên thật → skipped+lý do', r.summary?.skipped === 1 && /Thiếu Tên thật/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('customer', [
    { 'Biệt danh': 'P1', 'Tên thật': 'KH P1' },
    { 'Biệt danh': '', 'Tên thật': 'KH P2' },
    { 'Biệt danh': 'P3', 'Tên thật': 'KH P3' }
  ]);
  ok('customer (e) partial 2 ok + 1 lỗi', r.summary?.created === 2 && r.summary?.skipped === 1, r.summary);

  // ═══════════ (2) TID ═══════════
  r = await runImport('tid', [
    { 'Chuỗi TID': 'TIDA01', 'Tên HKD': 'HKD 1', 'Đối tác': 'DTX', 'Ngân hàng': 'VCB', 'Ngành nghề': 'Ăn uống' },
    { 'Chuỗi TID': 'TIDA02', 'Tên HKD': 'HKD 2', 'Đối tác': 'Đối Tác X', 'Ngân hàng': 'VCB', 'Ngành nghề': 'Ăn uống' },
    { 'Chuỗi TID': 'TIDA03', 'Tên HKD': 'HKD 3', 'Đối tác': 'DTX', 'Ngân hàng': 'VCB', 'Ngành nghề': 'Ăn uống' }
  ]);
  ok('tid (a) 3 hợp lệ → created=3', r.summary?.created === 3 && r.summary?.skipped === 0, r.summary);
  r = await runImport('tid', [{ 'Tên HKD': 'X', 'Đối tác': 'DTX', 'Ngân hàng': 'VCB', 'Ngành nghề': 'Ăn uống' }]);
  ok('tid (b) thiếu Chuỗi TID → skipped', r.summary?.skipped === 1 && /Thiếu Chuỗi TID/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('tid', [{ 'Chuỗi TID': 'TIDB01', 'Tên HKD': 'X', 'Đối tác': 'DTX', 'Ngân hàng': 'Không Tồn Tại', 'Ngành nghề': 'Ăn uống' }]);
  ok('tid (c) FK ngân hàng không tồn tại → skipped', r.summary?.skipped === 1 && /Không tìm thấy ngân hàng/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('tid', [{ 'Chuỗi TID': 'TIDB02', 'Tên HKD': 'X', 'Đối tác': 'DTX', 'Ngân hàng': 'Ngân Hàng Chung', 'Ngành nghề': 'Ăn uống' }]);
  ok('tid (d) FK ngân hàng mơ hồ → skipped', r.summary?.skipped === 1 && /trùng ≥2/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('tid', [
    { 'Chuỗi TID': 'TIDC01', 'Tên HKD': 'X', 'Đối tác': 'DTX', 'Ngân hàng': 'VCB', 'Ngành nghề': 'Ăn uống' },
    { 'Chuỗi TID': 'TIDC02', 'Tên HKD': 'X', 'Đối tác': 'DTX', 'Ngân hàng': 'VCB', 'Ngành nghề': 'Ngành Lạ' },
    { 'Chuỗi TID': 'TIDC03', 'Tên HKD': 'X', 'Đối tác': 'DTX', 'Ngân hàng': 'VCB', 'Ngành nghề': 'Ăn uống' }
  ]);
  ok('tid (e) partial 2 ok + 1 lỗi ngành', r.summary?.created === 2 && r.summary?.skipped === 1, r.summary);

  // ═══════════ (3) POS NHẬP KHO ═══════════
  r = await runImport('posIntake', [
    { 'Số seri': 'SER001', 'Chủng loại': 'Model A', 'Nhà cung cấp': 'NCC Zét', 'Trạng thái nhập': 'Máy mới', 'Giá nhập': '5.000.000', 'Ngày nhập': '2026-01-15' },
    { 'Số seri': 'SER002', 'Chủng loại': 'MDA', 'Nhà cung cấp': 'NCZ', 'Trạng thái nhập': 'Máy mới', 'Giá nhập': '4000000', 'Ngày nhập': '15/01/2026' },
    { 'Số seri': 'SER003', 'Chủng loại': 'Model A', 'Nhà cung cấp': 'NCC Zét', 'Trạng thái nhập': 'Máy mới', 'Giá nhập': '6.000.000', 'Ngày nhập': '2026-01-16' }
  ]);
  ok('posIntake (a) 3 hợp lệ (mã+tên+ngày dd/mm) → created=3', r.summary?.created === 3 && r.summary?.skipped === 0, r.summary);
  r = await runImport('posIntake', [{ 'Chủng loại': 'Model A', 'Nhà cung cấp': 'NCC Zét', 'Trạng thái nhập': 'Máy mới', 'Giá nhập': '1000', 'Ngày nhập': '2026-01-15' }]);
  ok('posIntake (b) thiếu Số seri → skipped', r.summary?.skipped === 1 && /Thiếu Số seri/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('posIntake', [{ 'Số seri': 'SERX', 'Chủng loại': 'Model A', 'Nhà cung cấp': 'Không Có', 'Trạng thái nhập': 'Máy mới', 'Giá nhập': '1000', 'Ngày nhập': '2026-01-15' }]);
  ok('posIntake (c) NCC không tồn tại → skipped', r.summary?.skipped === 1 && /Không tìm thấy nhà cung cấp/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('posIntake', [{ 'Số seri': 'SERY', 'Chủng loại': 'Model A', 'Nhà cung cấp': 'NCC Chung', 'Trạng thái nhập': 'Máy mới', 'Giá nhập': '1000', 'Ngày nhập': '2026-01-15' }]);
  ok('posIntake (d) NCC mơ hồ → skipped', r.summary?.skipped === 1 && /trùng ≥2/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('posIntake', [
    { 'Số seri': 'SERP1', 'Chủng loại': 'Model A', 'Nhà cung cấp': 'NCC Zét', 'Trạng thái nhập': 'Máy mới', 'Giá nhập': '1000', 'Ngày nhập': '2026-01-15' },
    { 'Số seri': 'SERP2', 'Chủng loại': 'Model A', 'Nhà cung cấp': 'NCC Zét', 'Trạng thái nhập': 'Máy mới', 'Giá nhập': '1000', 'Ngày nhập': '31/02/2026' },
    { 'Số seri': 'SERP3', 'Chủng loại': 'Model A', 'Nhà cung cấp': 'NCC Zét', 'Trạng thái nhập': 'Máy mới', 'Giá nhập': '1000', 'Ngày nhập': '2026-01-17' }
  ]);
  ok('posIntake (e) partial 2 ok + 1 ngày sai', r.summary?.created === 2 && r.summary?.skipped === 1, r.summary);

  // (g) Cài APP (ngân hàng) — Mr.Long 13/7: khớp MÃ / TÊN NGẮN (bỏ tiền tố) / "Máy trắng" / trống; NH lạ → skip.
  const db31 = getDb();
  r = await runImport('posIntake', [
    { 'Số seri': 'SAPP1', 'Chủng loại': 'Model A', 'Cài APP (ngân hàng)': 'VCB', 'Nhà cung cấp': 'NCC Zét', 'Trạng thái nhập': 'Máy mới', 'Giá nhập': '1000', 'Ngày nhập': '2026-01-15' },
    { 'Số seri': 'SAPP2', 'Chủng loại': 'Model A', 'Cài APP (ngân hàng)': 'Á Châu', 'Nhà cung cấp': 'NCC Zét', 'Trạng thái nhập': 'Máy mới', 'Giá nhập': '1000', 'Ngày nhập': '2026-01-15' },
    { 'Số seri': 'SAPP3', 'Chủng loại': 'Model A', 'Cài APP (ngân hàng)': 'Máy trắng', 'Nhà cung cấp': 'NCC Zét', 'Trạng thái nhập': 'Máy mới', 'Giá nhập': '1000', 'Ngày nhập': '2026-01-15' },
    { 'Số seri': 'SAPP4', 'Chủng loại': 'Model A', 'Cài APP (ngân hàng)': '', 'Nhà cung cấp': 'NCC Zét', 'Trạng thái nhập': 'Máy mới', 'Giá nhập': '1000', 'Ngày nhập': '2026-01-15' }
  ]);
  ok('posIntake Cài APP: 4 dòng created', r.summary?.created === 4, r.summary);
  const vcbId = (await db31.bank.findFirst({ where: { code: 'VCB' } }))?.id;
  const acbId = (await db31.bank.findFirst({ where: { code: 'ACB' } }))?.id;
  const dA1 = await db31.posDevice.findUnique({ where: { serial: 'SAPP1' } });
  const dA2 = await db31.posDevice.findUnique({ where: { serial: 'SAPP2' } });
  const dA3 = await db31.posDevice.findUnique({ where: { serial: 'SAPP3' } });
  const dA4 = await db31.posDevice.findUnique({ where: { serial: 'SAPP4' } });
  ok('Cài APP mã "VCB" → bankId đúng', dA1?.bankId === vcbId, { got: dA1?.bankId, want: vcbId });
  ok('Cài APP tên ngắn "Á Châu" (bỏ tiền tố) → bankId ACB', dA2?.bankId === acbId, { got: dA2?.bankId, want: acbId });
  ok('Cài APP "Máy trắng" → bankId null', dA3?.bankId === null, { got: dA3?.bankId });
  ok('Cài APP trống → bankId null', dA4?.bankId === null, { got: dA4?.bankId });
  r = await runImport('posIntake', [{ 'Số seri': 'SAPP9', 'Chủng loại': 'Model A', 'Cài APP (ngân hàng)': 'NH Không Tồn Tại', 'Nhà cung cấp': 'NCC Zét', 'Trạng thái nhập': 'Máy mới', 'Giá nhập': '1000', 'Ngày nhập': '2026-01-15' }]);
  ok('Cài APP NH không tồn tại → skipped', r.summary?.skipped === 1 && /Không tìm thấy ngân hàng/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);

  // ═══════════ (4) HỘ KINH DOANH ═══════════
  r = await runImport('dossier', [
    { 'Nguồn': 'NG01', 'Tên HKD': 'Hộ 1', 'Chủ hộ': 'Chủ 1' },
    { 'Nguồn': 'NG01', 'Tên HKD': 'Hộ 2', 'Chủ hộ': 'Chủ 2', 'Trạng thái MST': 'Đóng' },
    { 'Nguồn': 'NG01', 'Tên HKD': 'Hộ 3', 'Chủ hộ': 'Chủ 3', 'MST': '0101234567', 'CCCD': '001099', 'Địa chỉ HKD': 'Hà Nội' }
  ]);
  ok('dossier (a) 3 hợp lệ → created=3', r.summary?.created === 3 && r.summary?.skipped === 0, r.summary);
  ok('dossier (a+) "Đóng" → mstStatus CLOSED', (await dossierSvc.listDossiers({ search: 'Hộ 2' })).data?.[0]?.mstStatus === 'CLOSED');
  r = await runImport('dossier', [{ 'Nguồn': 'NG01', 'Chủ hộ': 'X' }]);
  ok('dossier (b) thiếu Tên HKD → skipped', r.summary?.skipped === 1 && /Thiếu Tên HKD/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('dossier', [{ 'Nguồn': 'NGXX', 'Tên HKD': 'X', 'Chủ hộ': 'Y' }]);
  ok('dossier (c) Nguồn không tồn tại → skipped', r.summary?.skipped === 1 && /Không tìm thấy nguồn hồ sơ/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('dossier', [
    { 'Nguồn': 'NG01', 'Tên HKD': 'Hộ P1', 'Chủ hộ': 'Chủ P1' },
    { 'Nguồn': 'NG01', 'Tên HKD': 'Hộ P2' },
    { 'Nguồn': 'NG01', 'Tên HKD': 'Hộ P3', 'Chủ hộ': 'Chủ P3' }
  ]);
  ok('dossier (e) partial 2 ok + 1 thiếu chủ hộ', r.summary?.created === 2 && r.summary?.skipped === 1, r.summary);

  // ═══════════ (5) THU ═══════════
  r = await runImport('cashThu', [
    { 'Danh mục': 'Bán máy', 'Quỹ': 'Quỹ tiền mặt', 'Số tiền': '1.000.000', 'Hình thức': 'Tiền mặt', 'Ngày': '2026-01-10' },
    { 'Danh mục': 'Bán máy', 'Quỹ': 'QU01', 'Số tiền': '2000000', 'Hình thức': 'CK', 'Ngày': '10/01/2026', 'Người nhận': 'Nguyễn Cô Đơn' },
    { 'Danh mục': 'Bán máy', 'Quỹ': 'Quỹ tiền mặt', 'Số tiền': '500000', 'Hình thức': 'Chuyển khoản', 'Ngày': '2026-01-11' }
  ]);
  ok('cashThu (a) 3 hợp lệ → created=3', r.summary?.created === 3 && r.summary?.skipped === 0, r.summary);
  r = await runImport('cashThu', [{ 'Danh mục': 'Bán máy', 'Quỹ': 'Quỹ tiền mặt', 'Hình thức': 'Tiền mặt', 'Ngày': '2026-01-10' }]);
  ok('cashThu (b) thiếu Số tiền → skipped', r.summary?.skipped === 1 && /Thiếu Số tiền/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('cashThu', [{ 'Danh mục': 'Bán máy', 'Quỹ': 'Quỹ Ma', 'Số tiền': '1000', 'Hình thức': 'Tiền mặt', 'Ngày': '2026-01-10' }]);
  ok('cashThu (c) Quỹ không tồn tại → skipped', r.summary?.skipped === 1 && /Không tìm thấy quỹ/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('cashThu', [{ 'Danh mục': 'Bán máy', 'Quỹ': 'Quỹ tiền mặt', 'Số tiền': '1000', 'Hình thức': 'Tiền mặt', 'Ngày': '2026-01-10', 'Người nhận': 'Nguyễn Văn Trùng' }]);
  ok('cashThu (d) Người nhận mơ hồ → skipped', r.summary?.skipped === 1 && /trùng ≥2/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('cashThu', [
    { 'Danh mục': 'Bán máy', 'Quỹ': 'Quỹ tiền mặt', 'Số tiền': '1000', 'Hình thức': 'Tiền mặt', 'Ngày': '2026-01-10' },
    { 'Danh mục': 'Bán máy', 'Quỹ': 'Quỹ tiền mặt', 'Số tiền': '1000', 'Hình thức': 'Thẻ tín dụng', 'Ngày': '2026-01-10' },
    { 'Danh mục': 'Bán máy', 'Quỹ': 'Quỹ tiền mặt', 'Số tiền': '1000', 'Hình thức': 'CK', 'Ngày': '2026-01-10' }
  ]);
  ok('cashThu (e) partial 2 ok + 1 hình thức lạ', r.summary?.created === 2 && r.summary?.skipped === 1, r.summary);

  // ═══════════ (6) CHI ═══════════
  r = await runImport('cashChi', [
    { 'Danh mục': 'Chi phí vận hành', 'Quỹ': 'Quỹ tiền mặt', 'Số tiền': '300000', 'Hình thức': 'Tiền mặt', 'Ngày': '2026-01-12', 'Người chi': 'Nguyễn Cô Đơn' },
    { 'Danh mục': 'Chi phí vận hành', 'Quỹ': 'QU01', 'Số tiền': '400000', 'Hình thức': 'CK', 'Ngày': '12/01/2026', 'Người chi': 'nvcodon01' },
    { 'Danh mục': 'Chi phí vận hành', 'Quỹ': 'Quỹ tiền mặt', 'Số tiền': '150000', 'Hình thức': 'Tiền mặt', 'Ngày': '2026-01-13', 'Người chi': 'Nguyễn Cô Đơn' }
  ]);
  ok('cashChi (a) 3 hợp lệ → created=3', r.summary?.created === 3 && r.summary?.skipped === 0, r.summary);
  r = await runImport('cashChi', [{ 'Danh mục': 'Chi phí vận hành', 'Quỹ': 'Quỹ tiền mặt', 'Số tiền': '1000', 'Hình thức': 'Tiền mặt', 'Ngày': '2026-01-12' }]);
  ok('cashChi (b) thiếu Người chi → skipped', r.summary?.skipped === 1 && /Thiếu Người chi/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('cashChi', [{ 'Danh mục': 'Không có', 'Quỹ': 'Quỹ tiền mặt', 'Số tiền': '1000', 'Hình thức': 'Tiền mặt', 'Ngày': '2026-01-12', 'Người chi': 'Nguyễn Cô Đơn' }]);
  ok('cashChi (c) Danh mục không tồn tại → skipped', r.summary?.skipped === 1 && /Không tìm thấy danh mục chi/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('cashChi', [{ 'Danh mục': 'Chi phí vận hành', 'Quỹ': 'Quỹ tiền mặt', 'Số tiền': '1000', 'Hình thức': 'Tiền mặt', 'Ngày': '2026-01-12', 'Người chi': 'Nguyễn Văn Trùng' }]);
  ok('cashChi (d) Người chi mơ hồ → skipped', r.summary?.skipped === 1 && /trùng ≥2/.test(r.results?.[0]?.message ?? ''), r.results?.[0]);
  r = await runImport('cashChi', [
    { 'Danh mục': 'Chi phí vận hành', 'Quỹ': 'Quỹ tiền mặt', 'Số tiền': '1000', 'Hình thức': 'Tiền mặt', 'Ngày': '2026-01-12', 'Người chi': 'nvcodon01' },
    { 'Danh mục': 'Chi phí vận hành', 'Quỹ': 'Quỹ Ma', 'Số tiền': '1000', 'Hình thức': 'Tiền mặt', 'Ngày': '2026-01-12', 'Người chi': 'nvcodon01' },
    { 'Danh mục': 'Chi phí vận hành', 'Quỹ': 'Quỹ tiền mặt', 'Số tiền': '1000', 'Hình thức': 'Tiền mặt', 'Ngày': '2026-01-12', 'Người chi': 'nvcodon01' }
  ]);
  ok('cashChi (e) partial 2 ok + 1 quỹ sai', r.summary?.created === 2 && r.summary?.skipped === 1, r.summary);

  // ═══════════ DRY-RUN KHÔNG TẠO + validCount/invalidCount (FIX 1/4) ═══════════
  const custBefore = await getDb().customer.count();
  const dry = await dryRunImport('customer', [
    { 'Biệt danh': 'D1', 'Tên thật': 'Dry 1' },
    { 'Biệt danh': 'D2', 'Tên thật': 'Dry 2' },
    { 'Biệt danh': '', 'Tên thật': 'Dry 3' } // lỗi: thiếu biệt danh
  ]);
  const custAfter = await getDb().customer.count();
  ok('dryRun trả validCount=2 / invalidCount=1', dry.summary?.validCount === 2 && dry.summary?.invalidCount === 1, dry.summary);
  ok('dryRun KHÔNG tạo bản ghi (count trước === sau)', custBefore === custAfter, { custBefore, custAfter });

  // ═══════════ ROW CAP (FIX 3): vượt trần → TOO_MANY_ROWS TRƯỚC khi resolve/create ═══════════
  const big = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_v, i) => ({ 'Biệt danh': 'B' + i, 'Tên thật': 'Big ' + i }));
  const cBefore = await getDb().customer.count();
  ok('run vượt trần → TOO_MANY_ROWS', (await runImport('customer', big)).error === 'TOO_MANY_ROWS');
  ok('dryRun vượt trần → TOO_MANY_ROWS', (await dryRunImport('customer', big)).error === 'TOO_MANY_ROWS');
  ok('row-cap KHÔNG tạo bản ghi nào', (await getDb().customer.count()) === cBefore, { cBefore });

  // ═══════════ (f) SAI VAI → FORBIDDEN (mọi entity) ═══════════
  await logout();
  await login('ktvien001', UPW); // TECHNICIAN: thiếu mọi quyền import
  for (const key of ['tid', 'posIntake', 'customer', 'dossier', 'cashThu', 'cashChi']) {
    const rf = await runImport(key, [{}]);
    ok(`${key} (f) sai vai → FORBIDDEN`, rf.error === 'FORBIDDEN', { error: rf.error });
  }
  await logout();

  // ═══════════ CÁCH LY CHÉO QUYỀN (FIX 4): WAREHOUSE CÓ tid nhưng KHÔNG có Thu ═══════════
  await login('whmanager', UPW);
  const wtid = await runImport('tid', [{ 'Chuỗi TID': 'TIDW01', 'Tên HKD': 'HKD W', 'Đối tác': 'DTX', 'Ngân hàng': 'VCB', 'Ngành nghề': 'Ăn uống' }]);
  ok('WAREHOUSE CÓ quyền tid → created=1', wtid.summary?.created === 1, wtid.summary);
  ok('WAREHOUSE KHÔNG quyền cashThu (run) → FORBIDDEN', (await runImport('cashThu', [{ 'Danh mục': 'Bán máy', 'Quỹ': 'Quỹ tiền mặt', 'Số tiền': '1000', 'Hình thức': 'Tiền mặt', 'Ngày': '2026-01-10' }])).error === 'FORBIDDEN');
  ok('WAREHOUSE KHÔNG quyền cashThu (dryRun) → FORBIDDEN', (await dryRunImport('cashThu', [{}])).error === 'FORBIDDEN');
  await logout();

  // eslint-disable-next-line no-console
  console.log(`IMPORT31 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
