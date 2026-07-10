# LOGIC CỐT LÕI — HKD × Ngành nghề × Giá × TID (Mr.Long lock 10/7)

> **BẮT BUỘC đọc trước khi thiết kế/đụng mô hình giá (FeeConfig/Transaction/TID/Customer).** Đây là chân lý nghiệp vụ Mr.Long mô tả 10/7. Chưa build — là input cho spec `task #11` (design→QA→build, KHÔNG rush money-model).

## 1. Tầng thực thể
- **HỘ KINH DOANH (HKD) = gốc.** 1 HKD có thể có:
  - **nhiều TID**
  - **nhiều ngân hàng** khác nhau
  - **nhiều đối tác** khác nhau
  - **nhiều ngành nghề** khác nhau — **theo đăng ký kinh doanh (ĐKKD)**.
- ⇒ **HKD ↔ Ngành nghề = nhiều-nhiều** (tập ngành HKD đã đăng ký).
- Mỗi **TID** thuộc 1 HKD và mang **1 tổ hợp**: (đối tác + ngân hàng + ngành nghề). Ngành nghề của TID phải nằm **trong tập ngành HKD đã đăng ký**.
- ✅ **HKD = "Hồ sơ HKD" (Dossier)** — Mr.Long chốt 10/7: HKD **phải được thêm từ "Quản Lý Hồ Sơ HKD"** (`DossierPage`). TID tham chiếu HKD từ danh sách Dossier, KHÔNG tạo HKD tại chỗ ở form TID. (Design verify `Dossier` schema + quan hệ TID hiện có.)

## 2. Ngành nghề là GỐC — cấu hình TRƯỚC
- Master data **Industry** (vận tải, tạp hóa, cà phê…) — có trang **Cấu hình ngành nghề RIÊNG**, đặt trong menu **ngay dưới "Cấu hình TID"** (thứ tự: `Cấu hình TID → Cấu hình ngành nghề → Quản Lý TID`).
- Phải tạo ngành nghề trước thì mới cấu hình giá & gán TID được.

## 3. Giá đặt theo NGÀNH NGHỀ (thêm 1 chiều vào mô hình giá hiện tại)
- Mỗi **loại thẻ** có **giá mua / giá cài máy / giá bán** riêng, đặt theo tổ hợp **(đối tác + ngân hàng + ngành nghề + loại thẻ)**.
- Giá mỗi ngành nghề **có thể giống hoặc khác nhau**.
- ⇒ `FeeRate` (biểu phí hiện tại) **THÊM chiều `industryId`**. Key mới ≈ **(partnerId + cardTypeId[+ngân hàng] + industryId + effectiveFrom-kỳ)**.
- ❓ *Design phải chốt với Mr.Long:* ngân hàng suy từ `cardType` (loại thẻ đã thuộc 1 bank) hay chọn riêng; đối tác có bắt buộc trong key giá không.

## 4. Chuỗi liên kết đồng bộ (auto — không nhập tay lại)
```
Cấu hình ngành nghề  ──►  Cấu hình giá theo (đối tác+bank+ngành+loại thẻ): mua/cài/bán
                                          │
Thêm TID mới:  chọn HKD (ô TÌM-GỢI-Ý từ Hồ sơ HKD) → đối tác → ngân hàng → ngành (lọc theo ngành HKD ĐKKD)
                                          │  ▼ AUTO-SHOW
                          Bảng giá các loại thẻ đã set cho đúng tổ hợp đó
                                          │
                    TID gắn tổ hợp (đối tác+bank+ngành)
                                          │  ▼
             Giao dịch của TID  ──►  TỰ tính doanh thu theo giá đã set (không nhập tay)
```
- **Chọn HKD ở form TID = COMBOBOX tìm-chọn** (searchable select), hành vi chuẩn:
  - Bấm **mũi tên xổ xuống** → **sổ ra full danh sách** HKD (từ Hồ sơ HKD) để chọn.
  - **Gõ 1-2-3 ký tự** trong tên HKD → **lọc hiện gợi ý** các HKD khớp → tích chọn.
  - KHÔNG cho điền tay tự do (giá trị phải là 1 HKD có thật). HKD chưa có → vào "Quản Lý Hồ Sơ HKD" thêm trước.
  - Component combobox này **dùng CHUNG**, tái dùng cho các dropdown danh sách lớn khác (đối tác / ngành nghề / loại thẻ…) cho đồng bộ.

## 5. Ràng buộc kỹ thuật khi build (giữ nguyên bài học cũ)
- **Snapshot doanh thu (B10):** phí/giá đóng băng vào từng GD lúc ghi; đổi biểu giá sau KHÔNG được đổi doanh thu đã ghi. `resolveFeeForTxn` chỉ tra lại khi đổi loại thẻ.
- **Ngày local (B16):** `effectiveFrom` chuẩn hóa nửa-đêm-LOCAL.
- **Migration Postgres + backfill:** TID/GD/FeeRate cũ chưa có ngành → gán ngành mặc định 'Khác' (nullable→bắt buộc), migrate deploy 0 lỗi.
- `pickEffectiveRate` phải lookup thêm theo `industryId` của TID — verify không phá kỳ hiệu lực + dedup 24h hiện có.

## 6. Trạng thái
DRAFT logic-lock. Bước kế: design agent VERIFY code giá thật → spec chi tiết + phương án keying + câu hỏi chốt → Mr.Long duyệt → QA phản biện → build theo pha. **CẤM build tới khi Mr.Long chốt mô hình giá.**
