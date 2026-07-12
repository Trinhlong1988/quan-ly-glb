# Yêu cầu Vòng đời Máy POS — Mr.Long 12/7 (spec cho rà soát thiết kế)

> Trạng thái: **CHỜ AUDIT + ĐỀ XUẤT** (chưa build). Đây là spec gom từ các yêu cầu Mr.Long 12/7 để đối chiếu
> thiết kế hiện tại → báo cáo THIẾU/ĐỦ → đề xuất thiết kế chặt → Mr.Long duyệt → mới làm (R_SUPREME R7).

## 1. Các giai đoạn vòng đời PHẢI quản lý (theo dòng đời thực)
1. **Mua / nhập kho** (stock-in) — máy vào kho.
2. **Bán** (bán đứt máy?) — cần trạng thái/sự kiện riêng.
3. **Gán TID** (bind TID vào máy).
4. **Giao khách** (deliver) — giao máy cho khách.
5. **Thu hồi** (recall) — thu máy về từ khách.
6. **Hủy khách** — gỡ gán khách.
7. **Đổi khách (kèm TID)** — chuyển máy (và TID đang gắn) sang khách khác — cần là **1 bước riêng** (không chỉ recall+deliver rời).
8. **Thu về sửa máy** (return for repair) — máy vào trạng thái SỬA.
9. **Nhận sửa xong** (repair done).
10. Sau sửa: **giao lại khách** HOẶC **nhập về kho**.

## 2. Ràng buộc chặt (invariants)
- **1 máy chỉ 1 TID SỐNG**: muốn gắn TID mới phải **tháo TID cũ trước** — trạng thái máy KHÔNG được còn tồn tại TID cũ khi gắn mới.
- **Giao máy-có-TID = giao CẢ máy + TID** (đi kèm, atomic — không tách rời khi giao).

## 3. Mốc thời gian PHẢI ghi
- Gắn TID mới: **thời điểm nào**.
- Tháo / hủy TID: **thời điểm nào**.
- (Mỗi sự kiện đều có ngày + giờ.)

## 4. Giao khách PHẢI ghi đủ trường
- **Giao cho ai** (khách hàng nào).
- **Ai giao** (user thực hiện).
- **Từ kho nào** (kho nguồn).
- **Ngày** giao.
- **Giờ** giao.
- **Địa chỉ user được giao** (địa chỉ giao của khách).

## 5. Thao tác vận hành
- Mỗi giai đoạn vòng đời phải có **thao tác điều chỉnh** tương ứng trên UI (nút chuyển trạng thái đúng luồng).
- **Vòng đời POS** xem được từ: trang Quản Lý Máy POS **và** từ ngữ cảnh TID (máy đang gắn TID).

## 6. Việc cần làm
- [x] Audit thiết kế hiện tại (states PosDevice + eventType AssetEvent + transitions + PosTidBinding + timestamps).
- [x] Báo cáo COVERED/PARTIAL/MISSING từng mục §1–§4 (đã trình Mr.Long → duyệt ưu tiên #1 + #2).
- [ ] Đề xuất thiết kế chặt (bổ sung state SỬA/BÁN, event đổi-khách, ràng buộc 1-TID/máy, trường giao đủ) — chờ Mr.Long duyệt.

## 7. ĐÃ LÀM (Mr.Long duyệt "oik" 12/7)
- [x] **#1 — Khóa CỨNG 1 máy 1 TID SỐNG (§2 invariant):** migration `20260712190000_pos_binding_unique` thêm 2
  partial-unique trên `pos_tid_bindings`: `UNIQUE(pos_serial) WHERE unbound_at IS NULL` +
  `UNIQUE(tid) WHERE unbound_at IS NULL`. DB tự chặn dù đường ghi nào lọt guard. Tầng service đã enforce sẵn
  (assignTid: TID_ON_DEVICE + DEVICE_HAS_TID với FOR UPDATE) — nay có backstop DB. Selftest #39 chứng minh cả
  guard service LẪN partial-unique (chèn raw binding thứ 2 → 23505).
- [x] **#2 — Sự kiện ĐỔI KHÁCH atomic (§1.7):** `changeCustomer` (DEPLOYED→DEPLOYED, giữ TID). 1 bước:
  đổi `currentCustomerId` máy + `tid.customerId` (TID đi theo khách mới) + AssetEvent `CHANGE_CUSTOMER`
  (ghi kèm TID) + audit — tất cả trong 1 transaction, khóa tids→pos_devices. UI: menu "Đổi khách giữ máy"
  ở máy DEPLOYED + banner ngữ cảnh (khách đang giữ / TID theo khách). Chặn: đổi trùng khách / thiếu khách /
  khách không tồn tại / máy không DEPLOYED. Selftest #39.
- [x] **#5 — Trường giao đủ (§4) qua Danh mục Kho (R27):** dựng entity `Warehouse` (mã/tên/địa chỉ/trạng thái,
  CRUD + optlock + soft-delete + phân quyền `CONFIG_WAREHOUSE_*` + DB-evolution grant cho role cũ). Giao máy
  (deploy) + đổi khách (changeCustomer) có dropdown **"Từ kho"** → chọn kho → **hiện địa chỉ**; AssetEvent ghi
  `fromWarehouseId` + **SNAPSHOT** `deliveryAddress` (lịch sử không đổi khi kho sửa địa chỉ). Timeline hiện kho +
  địa chỉ. Selftest #40 (CRUD/optlock/DB-evolution/wire giao máy/snapshot). *"Ai giao"* = actorUserId, *"ngày/giờ"*
  = occurredAt (đã có sẵn). Menu "Danh mục kho" mới.

## 8. CÒN LẠI (chưa duyệt build — chờ Mr.Long chốt A/B)
- #3 **BÁN máy** (Mr.Long xác nhận "có bán"): chờ chốt **BÁN-TID** (gỡ TID trước / kèm TID) + **BÁN-GIÁ**
  (chỉ lưu nhật ký / vào doanh thu) — đã hỏi, chờ trả lời.
- #4 **Thu-về-sửa:** Mr.Long chốt **giữ nguyên tên khách** (không treo) = đúng hành vi hiện tại → KHÔNG đổi gì.
- #6 **Hủy khách giữ máy** (§1.6): Mr.Long xác nhận "có tình huống này" — chờ chốt định nghĩa (đề xuất: gỡ khách,
  máy vẫn DEPLOYED chưa về kho, TID giữ nguyên, ghi `CANCEL_CUSTOMER`).
