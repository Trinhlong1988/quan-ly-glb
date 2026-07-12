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
- [ ] Audit thiết kế hiện tại (states PosDevice + eventType AssetEvent + transitions + PosTidBinding + timestamps) — ĐANG CHẠY.
- [ ] Báo cáo COVERED/PARTIAL/MISSING từng mục §1–§4.
- [ ] Đề xuất thiết kế chặt (bổ sung state SỬA/BÁN, event đổi-khách, ràng buộc 1-TID/máy, trường giao đủ) — chờ Mr.Long duyệt.
