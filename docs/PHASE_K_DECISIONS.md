# PHASE K — QUYẾT ĐỊNH CHỐT (build-spec addendum)

> Mr.Long chốt **B** (11/7): "Cứ chạy PHASE_K theo mặc định của em" → LEAD khóa 13 câu hỏi §7 spec thành quyết định dưới đây. Build agent BÁM ĐÚNG, KHÔNG tự đoán khác. Điểm nào lệch spec §7 thì bản này THẮNG.
> Nguồn: `PHASE_K_MERGE_TID_POS_SPEC.md`. Repo canonical DUY NHẤT: `D:\TT HKD AI\tools\quan-ly-glb` (CẤM đụng clone `C:\Users\Administrator\quan-ly-glb`).
> Workflow R_SUPREME: **K1 build → unit test → regression → AUDIT → commit → tag → RỒI MỚI K2.** KHÔNG build K1+K2 song song (K2 phụ thuộc PosDevice-source-of-truth của K1).

## Quyết định POS (K1)
- **Q-P1 = GIỮ `PosIntake` làm bảng LỊCH SỬ NHẬP.** `PosDevice` = nguồn sự thật DUY NHẤT của 1 máy. `createPosIntake` **upsert `PosDevice` IN_STOCK trong cùng `$transaction`** + ghi `AssetEvent(STOCK_IN)`. KHÔNG bỏ bảng phiếu nhập (giữ giá nhập có cấu trúc theo lô). KHÔNG đổi schema `PosIntake` ngoài việc cần thiết.
- **Q-P2 = KHÔNG.** Thu hồi TID chỉ `clear currentTid` trên máy; máy GIỮ nguyên `DEPLOYED` (ở khách, chờ TID mới). Thu hồi TID ≠ thu hồi máy (2 thao tác riêng — nhất quán triết lý 2 chiều độc lập).
- **Q-P3 = 1 máy 1 dòng nhập (giữ `serial @unique` trên `pos_intakes`).** Nhập lại (sau thu hồi/đổi NCC) = **cập nhật dòng `PosIntake` hiện có** (posModelId/supplierId/importPrice/importedAt mới) + ghi `AssetEvent(STOCK_IN)` mới (lịch sử nằm ở AssetEvent, không nhân đôi phiếu). KHÔNG đổi ràng buộc unique ở pha K.
- **Q-P4 = CÓ chuyển sang FK.** Thêm `posModelId`/`bankId` (nullable) vào `PosDevice`; backfill khi map được tên/mã master; không map → null + báo cáo "cần gán tay". **GIỮ cột `model`/`bank` text (KHÔNG xóa ở pha K)** để không mất dữ liệu cũ.
- **Q-P5 = KHÔNG có `RECALLED` riêng cho máy.** Thu hồi máy về thẳng `IN_STOCK`. Phân biệt "vừa thu hồi" qua `AssetEvent(RECALL)` gần nhất (timeline), không thêm enum.
- **Q-P6 = Thu hồi máy: GỠ gán TID. Hỏng/Bảo hành: GIỮ gán TID. Thanh lý: BẮT BUỘC gỡ TID + đóng/thu hồi TID.** Mọi transition đụng cả 2 phía trong CÙNG `$transaction` (chống mồ côi). `recallPos`/`retirePos` hiện KHÔNG đụng `currentTid` → K1 BỔ SUNG.

## Quyết định TID (K2)
- **Q-T1 = ĐỒNG Ý 2 chiều độc lập, DERIVE (không thêm cột bool).** Chiều "Gán máy POS" = derive `posSerial != null`; chiều "Giao cho khách" = derive `customerDeliveredAt (deliveredAt) != null`. KHÔNG thêm cột `deviceAssigned` (tránh 2 nguồn sự thật/drift — R6). `status` chỉ còn giữ **vòng đời sống/chết** (ACTIVE/DEAD/CLOSED/RECALLED); UNASSIGNED coi như ACTIVE-chưa-gán (giữ tương thích state machine cũ).
- **Q-T2 = 2 bộ lọc độc lập + 2 nhóm StatBar** (Gán máy POS: Đã/Chưa · Giao cho khách: Đã/Chưa). KHÔNG làm ma trận 2×2 ở pha K (để sau nếu cần).
- **Q-T3 = Chuỗi bắt đầu từ HKD (Mr.Long KHÓA).** Form Thêm TID: **HKD (chọn từ danh sách `Dossier`) → Đối tác → Ngân hàng → Chuỗi TID → Chuỗi MID** → (tùy chọn) TK nhận/nguồn hồ sơ/trạng thái cấu hình/ngày cấp → chế độ gán máy (a/b/c). **Đổi `hkdName` text → chọn từ danh sách HKD** (link `dossierId`, giữ `hkdName` text để backfill/hiển thị). Quy tắc ưu tiên (Mr.Long KHÓA): đối tác/bank/ngành nếu chỉ **1 liên kết → tự chọn mặc định**; **≥2 → dropdown**.
- **Q-T4 = GIỮ CẢ 2 bộ quyền** `TID_*` (vận hành) + `CONFIG_TID_*` (cấu hình) trên 1 trang, ẩn/hiện theo tab/hành động. KHÔNG ép gộp 1 bộ (tránh phá quyền role cũ — bài học seed 9/7). Kiểm thử theo vai.
- **Q-T5 = BỎ đường tạo tối giản `createTid`.** Dùng DUY NHẤT form đầy đủ (cho phép chưa gán máy). **Grep mọi nơi gọi `createTid` trước khi bỏ** (selftest/ipc/preload/UI) → chuyển sang hàm mới; nếu còn caller ngoài dự kiến → BÁO LEAD, không xóa mù.
- **Q-T6 = Máy của khách: đánh dấu "máy khách" + lưu khách/đại lý; KHÔNG tạo `PosDevice`.** Thêm 1 cột text nullable `customerDeviceSerial` trên `tids` để tra cứu serial máy khách (tùy chọn nhập). Tổ hợp "Chưa gán máy + Đã giao" hợp lệ.

## Quyết định Timeline
- **Q-TL1 = Đại lý dùng `Agent` FK (`agentId`), TÙY CHỌN.** Giao cho khách BẮT BUỘC: khách (`customerId`) + ngày giao (`deliveredAt`); đại lý optional (giao trực tiếp không qua đại lý được). Sự kiện `TID_DELIVERED` BỔ SUNG `toAgentId` (hiện thiếu).
- **Q-TL2 = KHÔNG thêm `tidId` FK vào `AssetEvent`.** Giữ join bằng chuỗi `tid` (đã có index, giống `deviceSerial`). Tránh migration AssetEvent lớn.

## Ràng buộc thực thi (mọi build agent)
1. Repo: CHỈ `D:\TT HKD AI\tools\quan-ly-glb`. `cd` vào đó ĐẦU TIÊN. CẤM đọc/sửa `C:\Users\Administrator\quan-ly-glb`.
2. CMD_BUILD **CẤM commit/tag/push**. Chỉ LEAD commit sau AUDIT rerun sạch.
3. File bảo vệ (`preload/index.d.ts` ≥1000 dòng + 5 anchor): **Edit** thêm, KHÔNG Write đè. CẤM `tsc -p` trần (emit-trap) — chỉ `npm run typecheck` (--noEmit).
4. Mọi migration: **backup pg_dump trước** + script backfill **idempotent** + **đối soát đếm trước/sau** (R9). Chạy trên DB throwaway migrate deploy để test, KHÔNG đụng `glb`.
5. Mọi transition đụng POS↔TID: cùng `$transaction`, ghi `AssetEvent` + audit, có **SELECT ... FOR UPDATE** khóa hàng khi tính toán tương tranh (bài học TOCTOU H2-debt/H2b).
6. Sau mỗi bug phát sinh khi build → thêm regression test (test-process-failure principle).
