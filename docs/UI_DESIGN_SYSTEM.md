# UI DESIGN SYSTEM — Quản Lý GLB (LEAD lock 9/7)

> Chuẩn thiết kế BẮT BUỘC. **Cấm tự ý làm lệch** font/cỡ chữ/màu/đậm/hoa. Mọi thành phần cùng vai trò phải giống hệt nhau ở MỌI trang. QA đối chiếu file này trước khi PASS UI (R_UI_DESKTOP_CONSISTENT).

## 1. Font
- **Chỉ 1 font**: `Be Vietnam Pro` (biến `--font-sans`, bundle offline). Mã/serial/số tài khoản: `font-mono`.
- Không dùng font khác. Không `text-[..px]` tùy tiện — chỉ dùng thang cỡ ở mục 2.

## 2. Thang cỡ chữ + đậm/hoa (theo VAI TRÒ, không theo cảm hứng)
| Vai trò | Class chuẩn | Đậm | Hoa |
|---|---|---|---|
| Tiêu đề app / lời chào / số KPI | `text-2xl font-bold` | bold | thường |
| **Tiêu đề mục (mỗi trang)** `<h2>` | `text-lg font-semibold text-slate-800` | semibold | thường |
| Phụ đề mô tả dưới tiêu đề `<p>` | `text-sm text-slate-500` | thường | thường |
| **Header bảng** `<th>` | `text-xs font-medium uppercase tracking-wide text-slate-500` | medium | **HOA** |
| Nhãn nhóm/section nhỏ | `text-xs font-semibold uppercase tracking-wide text-slate-500` | semibold | **HOA** |
| **Ô dữ liệu chính** (tên, giá trị) | `text-sm text-slate-700/800` | thường (tên riêng: `font-medium`) | thường |
| **Ô meta** (mã, username, TID, ngày, giờ, checksum) | `text-xs text-slate-500` | thường | thường |
| Mã định danh (KH/NV/serial/TID) | `font-mono text-xs font-semibold text-brand` | semibold | thường |
| Nút | `text-sm font-semibold` | semibold | thường |
| Badge/pill trạng thái | `text-xs font-medium` | medium | thường |

**Quy tắc logic đậm/hoa:** CHỈ header bảng + nhãn section viết HOA. Tên riêng/mã in đậm nhẹ (`font-medium`/`font-semibold`). Nội dung thường không đậm không hoa.

## 3. Màu (KiotViet palette — biến trong styles.css)
brand `#1657D0` · brand-hover `#1247AE` · sidebar `#10233F` · appbg `#F4F6FA` · line `#E5E9F0` · success `#16A34A` · danger `#DC2626` · warning `#F59E0B`. Chữ: chính `slate-800`, phụ `slate-500/600`, mờ `slate-400`. **Cấm hardcode hex ngoài palette.**

## 4. Nút (R_BUTTON_SEMANTICS)
| Loại | Component | Màu |
|---|---|---|
| Thực hiện / Xác nhận / Lưu / Thêm mới | `<Button variant="confirm">` | 🟢 xanh brand |
| Sửa | `<Button variant="edit">` hoặc IconBtn `variant="edit"` | 🟡 vàng warning |
| Xóa | `<Button variant="danger">` / IconBtn `variant="danger"` | 🔴 đỏ danger |
| Hủy / Làm mới / phụ | `<Button variant="neutral">` | ⚪ xám viền |

Nút bo góc `rounded-lg`. **Cấm** viết `<button>` thủ công cho 4 loại trên — phải dùng `Button`/`IconBtn` chung.

## 5. Thành phần dùng chung (cấm tự chế bản mới)
`Button` · `IconBtn(variant)` · `Modal` · `ConfirmDialog` (xóa/nguy hiểm, xuống dòng được) · `toast.alert` (**dialog lỗi TO-RÕ đồng bộ toàn app** — header đỏ + icon cảnh báo; mọi lỗi/thao tác sai dùng cái này, KHÔNG dùng toast nhỏ) · `toast.success/info` (thông báo nhẹ) · `StatusPill` + `statusLabel` · `FilterBar` · `Field` + `inputCls`.

## 6. Bảng
Mọi bảng: `text-sm` gốc · thead `bg-[#F8FAFC]` sticky · `<th>` theo mục 2 · cột thời gian **tách 2 cột Ngày | Giờ** (R_DATE_FORMAT, `fmtDate`/`fmtTime`) · hàng hover `hover:bg-appbg/60` · trạng thái rỗng có icon + câu tiếng Việt.

## 7. Ngôn ngữ
100% tiếng Việt chuẩn. Giữ thuật ngữ ngành: POS, TID, HKD, Excel, STK, MID. Enum hiển thị phải map tiếng Việt (không show ACTIVE/IN_STOCK trần).

## 8. QA gate UI (bắt buộc trước PASS)
1. Đối chiếu từng thành phần với mục 2–7 — sai 1 chỗ = FAIL.
2. `grep` không còn `text-error`/`toast.error(`/`text-[..px]`/hex lạ/`toLocaleString`.
3. Screenshot thật + click thử, 0 lỗi console.
