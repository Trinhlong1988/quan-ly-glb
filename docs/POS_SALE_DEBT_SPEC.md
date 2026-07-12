# SPEC — Bán máy / Bán TID + Công nợ mua thiết bị + Hủy khách (Mr.Long 12/7)

> Trạng thái: **ĐÃ DUYỆT hướng** (Mr.Long chốt: bán kèm TID · 2 nút bán riêng · doanh thu ghi nhận đủ ngay ⓵A ·
> có bán chịu ⓶B · hủy khách giữ lịch sử · gộp trọn). Đây là spec khóa mô hình kế toán trước khi build (R7).

## 1. Nguyên tắc kế toán (khóa — chống lệch sổ)
Tận dụng ĐÚNG cơ chế doanh thu/công nợ sẵn có (không đẻ cách tính mới):
- **Doanh thu (lợi nhuận accrual)** = Σ margin GD quẹt thẻ + **Σ CashEntry THU affectsPnl=true** − Σ CHI affectsPnl=true.
- `SALE_POS` / `SALE_TID` = danh mục THU **affectsPnl=true** (doanh thu). `DEBT_CUSTOMER` = THU **affectsPnl=false** (thu nợ, chỉ tiền vào quỹ).
- Tiền lệ `fundId=null` = bút toán ghi nhận **không tiền mặt** (như "Chi phí nợ xấu" BAD_DEBT) → ghi nhận doanh thu mà chưa có tiền vào quỹ.

### Mô hình 1 lần bán (đồng nhất mọi trường hợp)
Bán giá `P`, thu ngay `p` (0 ≤ p ≤ P):
1. **Chứng từ bán** `DeviceSale` (bất biến): kind POS|TID, máy/tid, khách mua, giá `P`, kho, ngày, người bán.
2. **Ghi nhận doanh thu ĐỦ NGAY (⓵A):** 1 `CashEntry` THU category `SALE_POS`/`SALE_TID`, amount = `P`, **fundId=null**
   (doanh thu +P ngay, chưa đụng quỹ), sourceType `SALE_POS`/`SALE_TID`, sourceId = DeviceSale.id, customerId = khách.
3. **Tiền thu ngay `p` (nếu > 0):** 1 `CashEntry` THU category `DEBT_CUSTOMER` (**affectsPnl=false** → KHÔNG cộng
   doanh thu lần 2), amount = `p`, fundId = quỹ chọn, method CK|CASH + `DeviceSaleSettlement(deviceSaleId, cashEntryId, amount=p)`.
4. **Công nợ mua thiết bị của khách** = Σ `DeviceSale.salePrice` − Σ `DeviceSaleSettlement.amount` (khách đó).

Hệ quả kiểm chứng (selftest assert số chính xác):
- Bán P=2tr thu p=0: doanh thu **+2tr**, quỹ **+0**, công nợ khách **+2tr**.
- Thu tiếp 500k: doanh thu **+0** (DEBT_CUSTOMER affectsPnl=false), quỹ **+500k**, công nợ còn **1,5tr**.
- Bán P=2tr thu đủ p=2tr: doanh thu +2tr, quỹ +2tr, công nợ +0.

## 2. Trạng thái vòng đời (asset.rules)
- **PosStatus + SOLD** (đã bán — terminal, rời tồn kho; nhãn riêng, khác RETIRED thanh lý).
- **TidStatus + SOLD** (đã bán cho khách — rời danh sách quản lý, KHÔNG hiện "chưa giao").
- **PosEvent `sell`**: from `IN_STOCK | DEPLOYED` → `SOLD`. Máy có `currentTid` → **TID cũng SOLD** (đi theo khách mua),
  đóng binding (`unboundAt`, reason `SOLD`), clear `currentTid`. Ghi AssetEvent `SELL` (kèm khách/giá/kho).
- **TidEvent `sell`** (bán TID riêng): from `UNASSIGNED | ACTIVE` **với `posSerial=null`** (không trên máy) → `SOLD`.
- **PosEvent `cancelCustomer`** (hủy khách giữ máy — KHÁC changeCustomer):
  - Máy **GIỮ trạng thái DEPLOYED** (chưa về kho), **GIỮ `currentCustomerId`** (để biết máy đang ở chỗ ai mà đi thu),
    đánh dấu **chờ thu hồi** (cột/nhãn "khách đã hủy — chờ thu về"). TID giữ nguyên trên máy.
  - Ghi AssetEvent `CANCEL_CUSTOMER` (lý do). Máy hiện trong danh sách **"Cần thu hồi"**.
  - Thu máy về = nút **"Thu hồi"** (recall) như cũ.
  - *Cờ:* thêm `PosDevice.recallPending Boolean @default(false)` → true khi hủy khách; false lại khi recall/redeploy.

## 3. Bảng mới
- **DeviceSale** (chứng từ bán, bất biến): id · code (`BS#####`) · saleKind POS|TID · deviceSerial? · tid? · customerId ·
  salePrice BigInt · warehouseId? · soldByUserId · occurredAt · note · status POSTED (CANCELLED = pha sau) · audit + soft-delete.
- **DeviceSaleSettlement**: id · deviceSaleId · cashEntryId · amount BigInt · createdAt. (mirror `CashDebtSettlement`.)

## 4. Service (device-sale-service.ts) — mọi thao tác trong 1 `$transaction`
- `sellPos(serial, {customerId, salePrice, paidNow, fundId, method, warehouseId, occurredAt, note}, password)`:
  guard POS_MANAGE + verifyActorPassword (có tiền, không hoàn tác). Transition máy `sell` (khóa tids→pos_devices như
  applyTransition), TID (nếu có) → SOLD + unbind. Tạo DeviceSale + 2 CashEntry (revenue fundId=null + paid) + settlement + audit.
- `sellTid(tid, {…}, password)`: guard TID_MANAGE. TID chưa-trên-máy → SOLD. DeviceSale kind TID + bút toán như trên.
- `collectDeviceSaleDebt(deviceSaleId | customerId, {amount, fundId, method, entryDate}, )`: guard CASHENTRY_CREATE.
  Tạo CashEntry DEBT_CUSTOMER vào quỹ + settlement, KHÔNG vượt công nợ còn lại.
- `listDeviceSales(filter)` · `customerDeviceReceivables()` (Σ theo khách) — cho màn Công nợ.

## 5. Quyền — "làm đúng vai trò" (Mr.Long 12/7)
Bán máy/TID + thu nợ thiết bị = **hành động tiền** (tạo doanh thu + công nợ), KHÔNG mượn quyền kỹ thuật POS
(POS_MANAGE chỉ để triển khai/thu hồi/sửa). Thêm **quyền riêng đúng vai**:
- `DEVICE_SALE_VIEW` — xem danh sách bán + công nợ mua thiết bị.
- `DEVICE_SALE_MANAGE` — **bán máy/TID + thu nợ thiết bị** (thao tác tiền).
- **Gán mặc định:** ADMIN (auto) · **MANAGER** (view+manage) · **ACCOUNTANT** (view+manage — vai tiền chính) ·
  **D_MANAGER/WAREHOUSE** (view). DB-evolution grant cho role cũ (khuôn `grantWarehousePermsToExistingRoles`).
- Vẫn `verifyActorPassword` khi bán (không hoàn tác + có tiền). Thu nợ = `DEVICE_SALE_MANAGE`.
- *Lý do đúng vai:* người BÁN (kế toán/quản lý) ≠ người thao tác kỹ thuật kho (WAREHOUSE chỉ xem, không tự bán).

## 6. UI — ĐÃ LÀM (exe 0.2.14, 12/7)
- ✅ **Bán máy**: nút "Bán máy" trong Quản Lý Máy POS (máy IN_STOCK/DEPLOYED) → `SellDeviceModal` (khách mua · giá · đã thu · quỹ · CK/CASH · kho · ngày · ghi chú · mật khẩu).
- ✅ **Bán TID**: nút "Bán TID" trong Quản Lý TID (TID chưa gắn máy + chưa giao) → `SellTidModal` (không trường kho).
- ✅ **Hủy khách**: menu "Hủy khách giữ máy" trên máy DEPLOYED (giữ khách + `recallPending`). Lọc/badge **"Cần thu hồi"** trong danh sách máy.
- ✅ **Công nợ**: tab **"Công nợ mua thiết bị"** trong Quản Lý Doanh Thu & Công Nợ (nhóm theo khách → xổ chi tiết đơn) + nút **Thu tiền** (`CollectModal`, chặn thu vượt nợ).
- Trạng thái **ĐÃ BÁN** = state SOLD (asset.rules); badge StatusOption bổ sung sau nếu Mr.Long cần.

## 7. Kiểm thử (selftest #41 — assert SỐ chính xác, money class)
Doanh thu/quỹ/công nợ đúng từng ca §1; SOLD states; TID theo máy khi bán; bán TID riêng; hủy khách giữ khách + recallPending;
thu nợ không vượt; quyền; full suite regression.
