# NGHIÊN CỨU THỊ TRƯỜNG + ĐỀ XUẤT MODULE THU CHI (item 12)

> Nguồn: deep-research 9/7, 25 claim verify từ tài liệu **chính thức** KiotViet / MISA AMIS+SME / Sapo (đa số vote 3-0). Trạng thái: **DRAFT — chờ Mr.Long duyệt data model trước khi build** (R7). Chỉ giữ thông tin đã kiểm chứng; phần POS/TID là khoảng trống tự thiết kế (không app nào có sẵn).

## A. Khuôn mẫu chung của thị trường (đã verify)
| # | Phát hiện | Nguồn |
|---|-----------|-------|
| 1 | **2 chứng từ nguyên thủy: Phiếu thu / Phiếu chi** = đơn vị ghi mọi dòng tiền (mã, thời gian, loại, đối tượng, số tiền; lọc theo mã/chi nhánh/loại/thời gian) | KiotViet, MISA, Sapo |
| 2 | **Tách quỹ tiền mặt (TK111) vs ngân hàng (TK112, nhiều tài khoản)**; KiotViet thêm **ví điện tử**. Mỗi quỹ: tồn đầu / tổng thu / tổng chi / tồn cuối + tab Tổng quỹ | MISA, KiotViet |
| 3 | **Danh mục "Đối tượng"** hợp nhất **Khách hàng / NCC / Nhân viên** gắn vào từng phiếu → nền công nợ; 1 record có thể vừa KH vừa NCC | MISA AMIS, KiotViet |
| 4 | **Danh mục phân loại** (Loại chứng từ + Khoản mục chi phí / Tên định khoản) → map cặp **TK Nợ/Có** để hạch toán tự động | MISA AMIS |
| 5 | **Sổ quỹ:** `Tồn cuối = Tồn đầu + Tổng thu − Tổng chi`, dây chuyền qua kỳ; tổng thu/chi sinh tự động từ phiếu | Sapo |
| 6 | **Đối soát ngân hàng:** import Excel sao kê → chứng từ trạng thái **"chưa ghi sổ"** → ghi sổ thủ công mới lên sổ | MISA AMIS |
| 7 | **Chuyển quỹ** tiền mặt↔ngân hàng = cặp phiếu chi/thu (Nợ 112/Có 111), KHÔNG tính trùng vào tổng dòng tiền | MISA AMIS |
| 8 | **State machine ghi sổ:** Chưa ghi sổ → Ghi sổ (post), có phân vai duyệt | MISA |

## B. Đề xuất DATA MODEL cho GLB (chọn lọc + thêm đặc thù POS/TID)
```
cash_account   : id, name, type(CASH|BANK|EWALLET), bankName?, accNo?, openingBalance, currentBalance, active
voucher        : id, code(PT##/PC##), type(RECEIPT|PAYMENT), voucherDate, categoryId,
                 partyId?, accountId, amount, note,
                 status(DRAFT|POSTED|VOID),            ← state machine ghi sổ (#8)
                 -- CHIỀU PHÂN TÍCH ĐẶC THÙ POS/TID (khoảng trống thị trường):
                 posSerial?, tid?, agentId?, customerId?,
                 sourceRef?(bill/saoke id → tích hợp tool đối soát sẵn có),
                 createdBy, postedBy?, postedAt?, createdAt, deletedAt
transaction_category : id, code, name, direction(INCOME|EXPENSE), debitAcc?, creditAcc?, isSystem
   → seed đặc thù: "Doanh thu POS", "Phí bảo trì", "Thu hồi thiết bị", "Chi sửa chữa POS"...
party          : id, code, type(CUSTOMER|SUPPLIER|EMPLOYEE), name, ... ← hợp nhất công nợ (#3);
                 CUSTOMER map sang bảng customer(KH##) đã có, EMPLOYEE map user(NV##)
fund_transfer  : id, fromAccountId, toAccountId, amount, date, note → sinh cặp voucher (#7)
```
- **Sổ quỹ / dòng tiền:** tính **running balance** dồn từ voucher POSTED theo account+kỳ (KHÔNG lưu số dư cứng) — theo Sapo (#5).
- **Đối soát:** import sao kê → voucher `DRAFT` → người dùng match với bill/sao kê **đã có ở globeway-quanlytaikhoan** → `POST`. Đây là điểm tích hợp vàng (#6).
- **Đặc thù GLOBEWAY (thị trường KHÔNG có):** báo cáo thu chi **theo máy POS / theo đại lý / theo khách** nhờ chiều phân tích trên voucher; phí bảo trì & thu hồi gắn `asset_event` (liên thông G-POS).

## C. Tính năng đề xuất (G4)
Phiếu thu/chi (mã tự sinh PT##/PC##) · quản lý quỹ đa tài khoản · danh mục thu/chi map TK · công nợ theo party · chuyển quỹ · sổ quỹ running-balance · báo cáo dòng tiền lọc theo máy/đại lý/khách · đối soát import sao kê (draft→post) · state machine ghi sổ + phân quyền CASHFLOW_VIEW/CREATE/POST. Áp **R_UX_WARN** (cảnh báo trùng/sai/nguy hiểm).

## D. CẦN Mr.Long QUYẾT
1. Duyệt data model B? (đặc biệt: có cần đầy đủ hạch toán TK Nợ/Có kiểu kế toán, hay gọn "thu/chi + phân loại" đủ dùng nội bộ?)
2. Mức đối soát: tích hợp thẳng dữ liệu `globeway-quanlytaikhoan` (bill/sao kê) hay chỉ import Excel?
3. Thứ tự build: sau G-POS.1. (Chưa build thu chi tới khi Mr.Long duyệt.)
