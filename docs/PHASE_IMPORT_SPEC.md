# PHASE IMPORT — Nhập liệu hàng loạt từ Excel (#9)

> Mr.Long chốt 11/7: entity = **TID · POS (nhập kho) · Khách hàng · Hộ kinh doanh · Thu · Chi**. Template = **bản RỖNG RUỘT của biểu mẫu XUẤT** (đồng nhất cột với form xuất). Thư viện `xlsx` (SheetJS) OK.
> Repo canonical DUY NHẤT `D:\TT HKD AI\tools\quan-ly-glb`. Build agent KHÔNG commit (chỉ LEAD sau AUDIT).

## 0. Quyết định LEAD chốt
- **D-IMP1 Entity (6):** TID (`createTidUnified`), POS nhập kho (`createPosIntake`), Khách hàng (`createCustomer`), Hộ kinh doanh (`createDossier`), Thu (`createCashEntry` kind THU/PT), Chi (`createCashEntry` kind CHI/PC). Thu+Chi có thể chung 1 template (cột "Loại"=Thu/Chi) hoặc 2 template riêng — build agent chọn cách rõ ràng hơn, ghi rõ.
- **D-IMP2 Thư viện:** thêm `xlsx` (SheetJS) vào `apps/desktop` deps. Dùng để (a) sinh mẫu .xlsx đẹp (header đậm, freeze dòng 1), (b) đọc file người dùng điền. Export .xls cũ GIỮ NGUYÊN (không đụng exportCsv.ts).
- **D-IMP3 Template = cột form xuất:** cột mẫu = **tập cột NGƯỜI DÙNG ĐIỀN ĐƯỢC** trong export của trang đó (bỏ cột hệ thống/dẫn xuất: id, ngày tạo, người tạo, badge tính toán). Cột khóa ngoại (ngân hàng/đối tác/HKD/ngành/quỹ/danh mục...) điền bằng **TÊN hoặc MÃ**, import tự tra ra id (không khớp/mơ hồ → lỗi dòng). Header mẫu = đúng nhãn cột export.
- **D-IMP4 Luồng import:** chọn file → parse → **validate TỪNG DÒNG** (bắt buộc/định dạng/tra FK theo tên) → hiện **bảng xem trước** (mỗi dòng: OK/lỗi + lý do) → người dùng bấm "Nhập N dòng hợp lệ" → tạo hàng loạt (mỗi dòng qua service create THẬT để tái dùng mọi validate/nghiệp vụ; dòng lỗi BỎ QUA + gộp báo cáo). **Partial import** (tạo dòng hợp lệ, báo rõ dòng bỏ). KHÔNG all-or-nothing (bulk-entry thực tế).
- **D-IMP5 Quyền:** mỗi import gác đúng quyền CREATE/MANAGE của entity (TID_MANAGE/CONFIG_TID_MANAGE, CONFIG_POS_SUPPLY_MANAGE, CUSTOMER_MANAGE, CONFIG_DOSSIER_MANAGE, CASHENTRY_CREATE...). KHÔNG nới quyền.

## 1. Kiến trúc (generic, ít chokepoint)
- **Backend `apps/desktop/src/main/import-service.ts` (MỚI):**
  - `IMPORT_REGISTRY: Record<entityKey, { label, permission, templateColumns: {header, field, required, kind: 'text'|'int'|'money'|'date'|'ref', ref?: {resolver} }[], toCreateInput(rowObj, resolvers)→input|error, create(input)→result }>`.
  - `importTemplateColumns(entityKey)` → trả cột mẫu (cho FE sinh file rỗng).
  - `runImport(entityKey, rows: Record<string,string|number>[])` → với mỗi dòng: map header→field, tra FK theo tên/mã (dùng list master hiện có), validate, gọi `create` THẬT; gom `{rowIndex, ok, id?, error?, message?}[]` + summary `{created, skipped}`. Gác quyền entity. Mỗi dòng độc lập (lỗi 1 dòng không hỏng dòng khác).
  - Tra FK: nạp map tên→id 1 lần/entity (bank/partner/dossier/industry/customer/agent/posModel/supplier/fund/cashCategory theo nhu cầu), khớp KHÔNG phân biệt hoa/thường; mơ hồ (≥2) → lỗi dòng.
- **IPC:** `import:template` (entityKey → columns) + `import:run` (entityKey, rows → results). preload `importTemplate`/`importRun`. d.ts **Edit** thêm (giữ ≥1000 dòng + 5 anchor).
- **FE lib `apps/desktop/src/renderer/src/lib/excelImport.ts` (MỚI):** dùng `xlsx` — `downloadTemplate(entityKey, columns, filename)` (sinh .xlsx rỗng: 1 dòng header đậm, freeze) + `parseWorkbook(file)→rows` (đọc sheet đầu → mảng object theo header).
- **FE component `ImportModal.tsx` (MỚI):** nút "Tải mẫu nhập" (gọi downloadTemplate) + "Nhập từ Excel" (file picker → parseWorkbook → import:run → bảng preview kết quả từng dòng OK/lỗi + summary + nút tải "báo cáo dòng lỗi"). Tái dùng cho cả 6 entity (truyền entityKey + nhãn).
- **Wire 6 trang** (thêm 2 nút cạnh nút Xuất Excel, disjoint renderer): TidPage, PosSupplyPage (tab Nhập kho) hoặc PosPage tab Nhập kho, CustomersPage, DossierPage, CashEntryPage (THU và CHI).

## 2. Cột mẫu từng entity (build agent chốt bằng cách đọc export + create-input)
Đọc export headers hiện có của mỗi trang (`grep exportCsv` trong trang) + type create-input tương ứng để lập templateColumns. Nguyên tắc: chỉ cột điền được; FK theo tên/mã.
- **TID:** Chuỗi TID*, Chuỗi MID, HKD (tên/chọn), Đối tác (tên/mã), Ngân hàng (tên/mã), Ngành nghề (tên/mã)*, (tùy) ngày cấp... (assign/deliver để trống — tạo TID chưa gán).
- **POS nhập kho:** Serial*, Chủng loại (tên/mã)*, Nhà cung cấp (tên/mã), Trạng thái nhập (tên), Giá nhập, Ngày nhập.
- **Khách hàng:** đọc CustomersPage export + createCustomer input.
- **HKD:** Nguồn hồ sơ (mã)*, Tên HKD*, Chủ hộ*, MST, Địa chỉ..., Trạng thái MST (Hoạt động/Đóng, default Hoạt động).
- **Thu/Chi:** Loại (Thu/Chi), Danh mục (tên, đúng kind)*, Quỹ (tên)*, Số tiền*, Phương thức, Ngày, Ghi chú.
(* = bắt buộc; agent xác minh lại theo service.)

## 3. Selftest (MỚI, `GLB_SELFTEST=<số trống, vd 31>`)
Trên DB throwaway: mỗi entity — (a) import 3 dòng hợp lệ → created=3, tra được; (b) dòng thiếu bắt buộc → skipped + lý do; (c) FK tên không tồn tại → skipped + lý do; (d) FK tên mơ hồ (2 bản trùng tên) → skipped; (e) partial: 2 hợp lệ + 1 lỗi → created=2 skipped=1; (f) quyền sai vai → FORBIDDEN. Tái dùng create THẬT nên mọi nghiệp vụ (vd TID ngành bắt buộc, POS upsert PosDevice, CashEntry cùng kind) vẫn enforce.

## 4. Rủi ro
- File độc/định dạng lạ → parse phòng thủ (sheet rỗng/thiếu header → lỗi rõ, không crash). 
- Tra FK theo tên mơ hồ → BẮT BUỘC báo lỗi dòng, KHÔNG đoán.
- Số tiền/ngày định dạng VN → parse qua helper hiện có (forms.ts groupDigits/parseVndInput/parsePartialDate) nếu phù hợp.
- Mirror-drift d.ts: chỉ Edit. `xlsx` là dep mới → `npm install` trong apps/desktop; LEAD verify build + không phá CSP (Electron main/renderer, không phải artifact sandbox).
- Import CHẠY create THẬT trong vòng lặp — mỗi dòng 1 giao dịch; KHÔNG để 1 dòng lỗi rollback cả mẻ.
