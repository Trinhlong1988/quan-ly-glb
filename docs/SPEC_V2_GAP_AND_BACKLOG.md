# SPEC v2.0 — Phân tích ĐÚNG/SAI + Backlog (Mr.Long review 9/7)

> Nguồn: `docs/SPEC_V2_REVIEW_MrLong_9_7.md` (bản phản biện Mr.Long 9/7) + các yêu cầu bắn nhanh trong phiên 9/7.
> CMD_AUDIT đối chiếu **code thật** (không suy luận). Trạng thái: ✅ đã có · 🔶 có phần · ❌ chưa có · ⚠️ cân nhắc (có thể over-engineer giai đoạn này).

## A. 10 "điểm còn yếu" — đánh giá đúng/sai

| # | Mr.Long nêu | Thực tế trong code | Đánh giá của CMD_AUDIT |
|---|---|---|---|
| 1 | Business Architecture (Sales/Inventory/Cashflow/CRM/HR/System) | Services đang tách theo entity (user/role/customer/pos/tid/bank-config), chưa gom domain | **ĐÚNG** — nên gom nhóm theo domain + đặt tên module rõ. Chi phí thấp, làm được ngay. ✅ |
| 2 | Approval Engine (Manager tạo → Admin duyệt → kích hoạt) | User có status PENDING nhưng CHƯA có luồng duyệt | **ĐÚNG cho chứng từ sau này** (phiếu thu/chi, nhập/xuất kho). Thiết kế nền chung giờ, enforce khi có chứng từ. 🔶 |
| 3 | Workflow Engine (Draft→Pending→Approved→Completed→Locked→Cancelled) | Đã có state-machine POS/TID (§A3) | **ĐÚNG** — chuẩn hóa 1 workflow chung cho chứng từ, tái dùng pattern state-machine đã có. 🔶 |
| 4 | Event Bus (UserCreated→Audit→Notification→Backup→Sync) | Services gọi trực tiếp `writeAudit` | **ĐÚNG hướng** nhưng ⚠️ Event Bus đầy đủ dễ over-engineer với app Electron 1 process. **Khuyên bản nhẹ**: 1 emitter nội bộ (domainEvent) cho audit + notification hook — 90% lợi ích, không nặng. |
| 5 | Plugin Architecture (core không biết POS/Kho/CRM) | Chưa có | ⚠️ **Mức enterprise — premature giai đoạn này.** Khuyên **module hóa feature-folder** rõ ràng thay vì plugin-runtime thực thụ. Khi lên đa sản phẩm mới cần. |
| 6 | Notification Center | `notification-service.ts` (mầm, undelivered TID) | **ĐÚNG, hữu ích** (user khóa, backup lỗi, kho sắp hết, công nợ đến hạn). ✅ xây trung tâm thông báo + chuông + badge. |
| 7 | Multi Branch (Công ty→Chi nhánh→Kho→Phòng ban) | Chưa có | **ĐÚNG & QUAN TRỌNG.** Thêm `companyId`/`branchId` (nullable) vào schema **NGAY**, enforce sau. Để sau mới thêm = tái cấu trúc lớn. ✅ nền giờ. |
| 8 | Data Dictionary | Chưa có tài liệu | **ĐÚNG** — chốt định nghĩa Customer/Invoice/Warehouse/Payment/Employee + field chuẩn. ✅ viết doc. |
| 9 | API Contract (POST/GET/PUT/DELETE) | App Electron dùng **IPC typed** (`preload/index.d.ts`) — đã là 1 dạng contract | **ĐÚNG một phần.** REST/OpenAPI chỉ cần khi lên VPS. Giờ: formal hóa IPC channel contract thành doc. 🔶 |
| 10 | UI Design System (màu/font/button/popup/table/form/icon) | Đã có ~80% (palette KiotViet, Be Vietnam Pro, component Modal/Field/FilterBar/StatusPill/toast) | **ĐÚNG, gần xong** — chốt thành `docs/UI_DESIGN_SYSTEM.md` + bổ sung quy ước màu button (xem F). ✅ |

## B. 5 mảng lớn trước khi code doanh thu/kho/thu chi

| # | Mảng | Thực tế | Đánh giá |
|---|---|---|---|
| 1 | Khóa dữ liệu gốc (Công ty/Chi nhánh/Kho/Phòng ban/Nhân sự/Khách/NCC/Sản phẩm/ĐVT/Nhóm hàng) | Có: Nhân sự(User), Khách(Customer), NCC≈Đối tác(Partner), Ngân hàng. Thiếu: Công ty/Chi nhánh/Kho/Phòng ban/Sản phẩm/ĐVT/Nhóm hàng | ✅ **CẦN** — khóa master data trước, tránh loạn dữ liệu module kho/doanh số. |
| 2 | Mã chứng từ 6 số (NV000001/KH/SP/HD/PT/PC/NK/XK) + chống trùng | `code_counter` atomic đã có (NV/KH **2 số**) | 🔶 **Mở rộng**: đổi padding **6 số** + thêm prefix SP/HD/PT/PC/NK/XK. Cơ chế atomic đã sẵn. |
| 3 | Khóa sổ (period lock — tháng đã khóa không sửa được, chỉ Admin/KTT mở) | Chưa có | ✅ **CẦN** khi có thu chi/hóa đơn. Thiết kế bảng `period_lock` nền giờ. |
| 4 | Import/Export Excel (import nhân sự/sản phẩm/khách; export báo cáo/danh sách) | Có Xuất (CSV rải rác). Chưa có Import. | ✅ **CẦN** — chuẩn hóa util Import + Export chung. |
| 5 | Phân quyền theo DỮ LIỆU (row-level: CN A chỉ xem A, Kho A chỉ xem A…) | Chỉ có phân quyền theo CHỨC NĂNG (permission code) | ✅ **CẦN** — thêm scope theo branch/assignment. Thiết kế nền cùng Multi-Branch (#7). |

## C. Nhỏ nhưng nên có

| Hạng mục | Trạng thái |
|---|---|
| Lịch sử đăng nhập | ✅ backend có (`LoginSession`) — 🔶 thiếu TRANG hiển thị |
| Quên / reset mật khẩu | ❌ chưa (cần nút Admin reset mật khẩu user) |
| Đổi mật khẩu lần đầu | ✅ ĐÃ CÓ |
| Mã PIN thao tác nhạy cảm | ❌ chưa (hiện nhập lại mật khẩu Admin thay thế) |
| Log lỗi hệ thống | ❌ chưa (cần bảng `error_log` + ghi try/catch) |
| Tự động backup theo ngày | ❌ chưa (có backup thủ công) |
| Restore xác nhận mật khẩu | ✅ ĐÃ CÓ |
| **Thùng rác + phục hồi** | 🔶 soft-delete backend CÓ (10 bảng) — ❌ thiếu UI thùng rác + nút phục hồi |
| Cảnh báo trùng | ✅ CÓ (R_UX_WARN) |
| **Định dạng ngày dd/mm/yyyy, tách 2 cột ngày/giờ** | ❌ **SAI** hiện tại (dùng `toLocaleString`) → SỬA NGAY |

## D. Yêu cầu MỚI phiên 9/7 (Mr.Long bắn nhanh — đã ghi nhận đủ)

1. **Ngôn ngữ 100% tiếng Việt chuẩn**, không tiếng Anh (giữ thuật ngữ ngành: POS, TID, HKD, Excel, STK). → ✅ ĐÃ Việt hóa đợt 1 (StatusPill/Audit/Staff/Backup/Pos/Tid).
2. **Xóa user KHÔNG ảnh hưởng dữ liệu user đã tạo.** → ✅ **ĐÃ ĐÚNG THIẾT KẾ**: dùng scalar `createdBy` + KHÔNG hard-FK cascade + soft-delete → xóa user không đụng customer/POS/TID họ tạo. CMD_AUDIT xác nhận.
3. **Xóa entity CÓ LIÊN KẾT (POS/…) → cảnh báo RÕ RÀNG + note trạng thái "đã xóa" + vào THÙNG RÁC + Admin phục hồi.** → 🔶 CẦN XÂY: link-check trước xóa + trang Thùng rác + phục hồi.
4. **Quy ước màu button (design system):** Sửa = **vàng**, Thực hiện/Xác nhận = **xanh**, Xóa = **đỏ**. Dialog báo thao tác sai phải **TO, RÕ RÀNG**. → 🔶 áp toàn UI.
5. **Ngày định dạng dd/mm/yyyy** (dd/mm đủ 2 chữ số 01,02…), **tách cột Ngày và Giờ**. → 🔶 SỬA NGAY.

## E. Thứ tự thực thi đề xuất (chờ Mr.Long chốt)

**Nhóm 1 — LÀM NGAY (low-regret, rõ ràng, đang có app chạy):**
- (E1) Việt hóa 100% — hoàn tất phần còn lại.
- (E2) Design system: quy ước màu button + dialog lỗi to rõ + `docs/UI_DESIGN_SYSTEM.md`.
- (E3) Định dạng ngày dd/mm/yyyy + tách cột ngày/giờ (util chung `fmtDate/fmtTime`).
- (E4) **Thùng rác + phục hồi + cảnh báo xóa có liên kết** (yêu cầu D2/D3).

**Nhóm 2 — NỀN MÓNG SPEC v2.0 (cần Mr.Long duyệt scope):**
- Multi-Branch + row-level permission (thêm cột companyId/branchId nền).
- Mã chứng từ 6 số + prefix mở rộng.
- Master data còn thiếu (Sản phẩm/ĐVT/Nhóm hàng/Kho/Phòng ban).
- Approval + Workflow engine chung (nền).
- Notification Center. Khóa sổ. Import Excel. Login-history UI. Reset password. Error log. Auto-backup.

**Nhóm 3 — CÂN NHẮC (khuyên hoãn/bản nhẹ):**
- Event Bus → bản nhẹ (emitter nội bộ).
- Plugin Architecture → module-hóa feature-folder, chưa cần plugin-runtime.

## F. Kết luận CMD_AUDIT
Phản biện của Mr.Long **phần lớn ĐÚNG** cho mục tiêu ERP mở rộng. 2 điểm khuyên bản-nhẹ để tránh over-engineer: **Event Bus** và **Plugin Architecture**. Các mục nền (Multi-Branch, row-level permission, mã chứng từ 6 số) nên **thêm cột/bảng nền NGAY** để không phải tái cấu trúc lớn. Nhóm 1 làm được ngay không cần tái kiến trúc.
