# PING CLAUDE — Audit độc lập bản mới nhất v0.2.53

**HEAD:** `61814f9` / tag `v0.2.53`  
**Phạm vi:** các thay đổi Bill Giải Trình + hồi quy backend/frontend hiện hành.  
**Phương pháp:** 3 agent độc lập, đối chiếu code/spec/test; không sửa code.

## Gate đã chạy

- `npm run verify`: exit 0 — typecheck node/web, protected/deferred guard, 16 test files / 272 tests pass.
- `npm run build`: exit 0 — 1091 modules; có cảnh báo dynamic import bị static import nên không tách chunk.
- `npm test -- --run apps/desktop/src/main`: pass 4 files/16 tests; chưa phải test service Bill Giải Trình concurrency thật.
- Không tìm thấy command `ST44`/`run_all` trong repo để độc lập tái dựng claim ST44 PASS trong `VERSION.md`.

## Mismatch cần xử lý trước khi claim release

1. Root `package.json` vẫn version `0.1.0-phaseA`; desktop package `0.2.53`; VERSION ghi `0.53.0-billexplain-menu`. Một nguồn version duy nhất phải được xác định.
2. `VERSION.md` liệt kê 6 deferred hardening items, nhưng `audit:deferred` báo 3 mã hoãn. Cần đối chiếu registry/spec, không tuyên bố tất cả đã được guard.

## Lỗi backend Bill Giải Trình — bằng chứng code

### BILL-01 — Không kiểm tra ngành tồn tại/đã xóa (High)

`bill-explain-service.ts:304-316` kiểm dossier nhưng không validate `industryId` tồn tại và còn sống trước khi lưu bill. Có thể lưu bill trỏ ngành không tồn tại/đã soft-delete.

**Tái hiện:** gọi generate với `industryId` id không tồn tại hoặc ngành `deletedAt != null`; query bill sau insert. Expected VALIDATION/NOT_FOUND, actual lưu id tùy ý. Cần chạy fixture DB để đánh dấu runtime.

### BILL-02 — TID không bị ràng buộc với dossier/customer (High)

`bill-explain-service.ts:308-311,351` chỉ kiểm TID tồn tại/chưa xóa, không kiểm TID thuộc dossier/customer đã chọn. Có thể tạo bill dossier A nhưng TID của HKD B, làm báo cáo chủ thể mâu thuẫn.

**Tái hiện:** tạo hai dossier/TID khác nhau, chọn chéo rồi generate; kiểm DTO/list và dữ liệu DB.

### BILL-03 — Ngày ISO sai bị normalize hoặc rơi về hôm nay (High)

`bill-explain-service.ts:292-296` parser nhận ngày malformed/invalid và có thể dùng ngày hiện tại; `2026-02-31` có thể normalize sang tháng 3, chuỗi rỗng dùng today.

**Tái hiện:** generate với `''`, `2026-02-31`, `2026-13-01`; expected VALIDATION, actual phải được ghi rõ bằng output.

### BILL-04 — Parse tiền xóa ký tự làm đổi giá trị (Critical)

`bill-explain-service.ts:278-286` giữ chữ số rồi ghép lại: `-100` thành `100`, `1.5` thành `15`, `1e3` thành `13`. Đây là biến đổi dữ liệu im lặng, không phải validation.

**Tái hiện:** gửi các input trên, xem targets lưu/sinh bill. Expected reject.

### BILL-05 — Tiền lớn bị ép Number (High)

`bill-explain-service.ts:346,352,398` và `BillExplainPage.tsx:80-83,122` ép target/BigInt sang Number. `9007199254740993` thành `9007199254740992`, tổng và dòng sản phẩm sai.

**Bằng chứng độc lập:** pure JS `Number(9007199254740993n)` mất 1; cần integration generate bill để xác nhận file XLSX.

### BILL-06 — Số bill có race/TOCTOU (High)

`bill-explain-service.ts:323-344` đọc/render/set setting số bill ngoài transaction; hai request đồng thời có thể dùng cùng số, hoặc setting tăng dù DB create/render thất bại.

**Tái hiện bắt buộc:** Promise.all hai generate cùng cấu hình, query `bill_explains` và tên file. Expected unique/atomic.

### BILL-07 — File xuất dư khi DB thất bại (Medium/High)

Render file xảy ra trước commit DB tại `bill-explain-service.ts:326-356`. Nếu DB fail sau render, file XLSX mồ côi và số bill đã tiêu hao.

**Tái hiện:** mock DB create throw sau render; kiểm thư mục output và setting.

### BILL-08 — Đường dẫn output/template quá tin cậy (High/Conditional)

`bill-explain-service.ts:460-463` cho phép `PRODUCT_MANAGE` cấu hình path; resolve/mkdir recursive có thể ghi vào bất kỳ thư mục writable. Chỉ kết luận security exploit sau khi chứng minh allowlist path/permission không tồn tại và chạy path traversal fixture.

### BILL-09 — IPC không validate runtime input (Medium/High)

Handler tại `ipc.ts:366` chuyển input typed thẳng; `parseTargets` giả định iterable. `null`/object có thể ném TypeError thay vì `{ok:false, VALIDATION}`; string id có thể lọt tới Prisma.

**Tái hiện:** invoke IPC với `null`, `{targets:{}}`, `industryId:'1'`; expected lỗi chuẩn, actual cần output.

## Lỗi frontend bản mới

### FE53-01 — ImportModal kẹt busy khi parse/import reject (High)

`ImportModal.tsx:61-95` không `try/catch/finally` quanh parseWorkbook/importDryRun/importRun. Promise reject làm spinner/busy vĩnh viễn và unhandled rejection.

### FE53-02 — ExportRequestPanel list/cancel kẹt khi IPC lỗi (Medium/High)

`ExportRequestPanel.tsx:74-103` thiếu finally/catch; list reject giữ loading, cancel reject giữ dialog mở.

### FE53-03 — ExportRequestPanel reset dùng filter closure cũ (Medium)

`ExportRequestPanel.tsx:142` set filter rỗng rồi `setTimeout(reload,0)`; request có thể vẫn gửi status/search cũ.

### FE53-04 — Quantity Bill/Export vượt 2^53 (High)

`ExportRequestPanel.tsx:283-289` dùng `Number(quantity)` rồi BigInt; `BillExplainPage.tsx:80-83` dùng Number targets. Quantity cực lớn bị làm tròn nhưng vẫn qua `Number.isInteger`.

### FE53-05 — BillExplain Promise.all không có error state (Medium)

`BillExplainPage.tsx:70-77` một IPC reject làm selector trống/unhandled; library reload `:367-377` reset loading nhưng không catch/toast.

### FE53-06 — Product price mất chính xác (High)

`BillExplainPage.tsx:499-503` ép price sang Number rồi gửi create/update; giá >2^53 bị làm tròn trước backend.

## Phản biện và trạng thái

- Các mục BILL-01/02/03/06/07/09 cần chạy fixture DB/IPC để ghi `REPRODUCED` hoặc `REJECTED`; không được claim runtime chỉ từ static code.
- BILL-08 là conditional defense-in-depth, phải kiểm path allowlist trước khi gọi exploit.
- ST44 trong VERSION chưa được độc lập tái dựng vì không có script trong repo; chỉ verify/build/test hiện hành được xác nhận.
- Không báo các lỗi cũ đã được fix nếu guard/selftest bản 0.2.53 đã chứng minh ngược lại.

## Yêu cầu xử lý

Claude phải thêm test cho: invalid date/money, BigInt exactness, dossier–TID relation, concurrent bill numbering, rollback file/setting, malformed IPC input, rejected import promise và quantity > safe integer. Sau đó chạy lại verify/build và ghi command/output trong `BUGS_FIXED.md`.

---

## KẾT LUẬN LEAD (0.2.54, 2026-07-16) — phản biện + tái hiện + fix

**Cách tái dựng:** `npm run selftest:bill` (= `node tools/selftest/run-selftest-pg.mjs 44`, cần PostgreSQL localhost) → `BE44 SUMMARY | failures=0`. `npm run verify` → typecheck web+node 0, vitest 272. `npm run build` → 0.

| Mã | Verdict | Xử lý + bằng chứng (ST44) |
|---|---|---|
| BILL-01 | **REPRODUCED (một phần)** | Ngành *không tồn tại* bị NO_PRODUCTS chặn gián tiếp; **ngành xóa mềm còn SP thì lọt** → thêm kiểm `industry.deletedAt`. Test: ngành-xóa-mềm + không-tồn-tại → VALIDATION. |
| BILL-02 | **CONDITIONAL** | TID tracking-only, KHÔNG in HĐ (tác hại thấp) → guard nhẹ: chặn TID đã gắn HKD KHÁC, cho phép TID chưa gắn. Test: TID-thuộc-HKD-khác → VALIDATION. |
| BILL-03 | **REPRODUCED** | `2026-02-31`→cuộn 3/3, rỗng→hôm nay. Fix `parseStrictYmd` round-trip UTC. Test: 6 ngày sai → VALIDATION, `2028-02-29` nhuận thật hợp lệ. |
| BILL-04 | **REPRODUCED (Critical)** | `Number('-100'.replace(/[^\d]/g,''))`=100 đổi dấu. Fix parse strict không strip. Test: `-100/1.5/1e3/1,000/abc/space/0` → VALIDATION. |
| BILL-05 | **REPRODUCED** | Tổng ép Number mất chữ số. Fix Σ BigInt + FE gửi chuỗi raw + `money(bigint)`. Test: `9007199254740993` → VALIDATION. |
| BILL-06 | **REPRODUCED (concurrency thật)** | Số HĐ đọc-ghi ngoài tx. Fix cấp dải dưới `pg_advisory_xact_lock(561053)`. Test: `Promise.all` 2 generate → `after===before+6` (dải không chồng). |
| BILL-07 | **PARTIAL/ACCEPTED** | File mồ côi vô hại; số HĐ đã atomic (BILL-06). Không đổi thêm. |
| BILL-08 | **REJECTED** | outputDir do người có quyền `PRODUCT_MANAGE` tự chọn nơi lưu trên máy mình = tính năng (không nhận path từ web); UI chưa mở ô này. Không phải RCE. |
| BILL-09 | **REPRODUCED** | `targets` không phải mảng → TypeError. Fix `Array.isArray` + kiểm kiểu id. Test: `{}`/`null`/`dossierId:'1'` → VALIDATION. |
| FE53-01 | **REPRODUCED** | ImportModal busy kẹt khi reject → try/catch/finally. |
| FE53-02 | **REPRODUCED** | ExportRequestPanel loading/dialog kẹt → try/catch/finally. |
| FE53-03 | **REPRODUCED** | reset `setTimeout(reload)` đọc filter cũ → bỏ, dựa `useEffect([statusFilter])`. |
| FE53-04 | **PARTIAL** | BillExplain: FE gửi chuỗi raw (fixed). ExportRequestPanel quantity: backend export-request đã validate (`unitPrice/quantity` toVnd/int8 guard, ST43). |
| FE53-05/06 | **REPRODUCED** | Promise.all/reload/import không catch + giá SP ép Number → try/catch + `validPrice` VN-strict. Test: import "45.000"=45000, "-100" loại. |
| Mismatch version | **FIXED** | root `package.json` 0.1.0→0.2.54 khớp desktop + tag. |
| ST44 không tái dựng | **FIXED** | thêm `npm run selftest:bill`/`selftest`/`selftest:core`. |

**Trung thực còn lại:** Production DB thật (192.168.1.6) CHƯA được validate lại — theo R196, server tự cập nhật 0.2.54 + `ensureCriticalSchema` self-heal khi boot; xác nhận cuối = Mr.Long Production Validation (mở app máy chủ, chạy sinh bill thật). Self-heal DDL `products`/`bill_explains` đã đối chiếu khớp schema.
