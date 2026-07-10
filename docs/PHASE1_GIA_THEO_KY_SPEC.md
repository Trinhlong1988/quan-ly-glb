# Phase 1 — GIÁ THEO KỲ · SPEC + AUDIT GATE

> Nguồn thẩm quyền: LEAD (Mr.Long) chốt 2026-07-10 — **①A** (timeline hiệu lực) + **②B** (Approval Engine đầy đủ).
> Chia 2 tier tuần tự (WORKFLOW TỐI THƯỢNG — cấm Build→Build→Build): **P1.1 giá theo kỳ** → freeze/tag → **P1.2 Approval Engine + bill bất biến**.
> Tài liệu này KHÓA phạm vi + tiêu chí nghiệm thu **P1.1**. Tác giả: CMD_AUDIT. Người thực thi: CMD_BUILD. Người ký PASS: LEAD.

---

## 0. Vấn đề P1.1 đóng (REV-B01, phần giá)
Hiện `createTransaction` tra biểu phí **hôm tạo** rồi snapshot vào bill. GD có `txnDate` trong quá khứ (backdate/backfill) vẫn ăn **giá hôm nay** → SAI. `FeeRate` chỉ giữ **1 dòng/(đối tác×loại thẻ)**, `setFeeRate` **ghi đè** → mất lịch sử giá.

**P1.1:** biểu phí có **kỳ hiệu lực**; phí của 1 GD = kỳ giá **đang hiệu lực tại `txnDate`**. Bill đã tạo **giữ nguyên snapshot** (bất biến — không tính lại).

## 1. Thay đổi dữ liệu (additive)
### 1.1 Schema `FeeRate`
- Thêm cột **`effectiveFrom DateTime @map("effective_from")`** — ngày bắt đầu hiệu lực của kỳ giá.
- Mô hình đổi từ "1 dòng/(đối tác×loại thẻ)" → **nhiều dòng, mỗi dòng = 1 kỳ**, phân biệt bởi `effectiveFrom`. Dòng cũ giữ nguyên làm lịch sử (KHÔNG ghi đè).
- **KHÔNG thêm `@@unique` DB** trên bảng có `deletedAt` (tránh bug-class B05). Ràng buộc "1 kỳ/1 mốc effectiveFrom" enforce ở service.
- Giữ nguyên soft-delete, các cột phí (×1000), audit trail.

### 1.2 Migration
- Tên folder timestamp **> `20260710010000`** (sau mọi migration — bài học B07). Đề xuất: `20260710120000_p1_1_fee_effective_from`.
- `ALTER TABLE fee_rates ADD COLUMN effective_from DATETIME`.
- **Backfill:** mọi dòng `FeeRate` hiện có (mô hình cũ = 1 dòng/tổ hợp) gán `effective_from = '1970-01-01 00:00:00.000'` (mốc sàn) → phủ **mọi GD quá khứ**. Sau backfill, cột là **bắt buộc** (Prisma `DateTime`, không optional).
- KHÔNG đụng bảng `transactions` (bill đã snapshot — bất biến).

## 2. Logic
### 2.1 Hàm thuần (business-rules) — unit test được
Thêm `pickEffectiveRate(rows, at)` vào `packages/business-rules`:
- Vào: danh sách kỳ giá `{effectiveFrom, ...}` của cùng 1 tổ hợp (đã lọc còn sống), 1 mốc `at: Date`.
- Ra: kỳ có `effectiveFrom ≤ at` **lớn nhất**; không có → `null`.
- Kèm ≥4 unit test vitest: đúng biên (`at` = đúng `effectiveFrom`), chọn kỳ mới nhất trong nhiều kỳ, `at` trước mọi kỳ → null, 1 kỳ duy nhất phủ mọi ngày.

### 2.2 `resolveFeeForTxn` (transaction-service)
- Thêm tham số **`at: Date`** (= `txnDate` của GD). Tra `feeRate` theo `(partnerId, cardTypeId, deletedAt:null)`, chọn kỳ bằng `pickEffectiveRate(rows, at)`.
- Không có kỳ hiệu lực tại `at` → `NO_FEE_RATE`, message: *"Chưa có biểu phí hiệu lực tại ngày giao dịch. Hãy cấu hình biểu phí có ngày hiệu lực ≤ ngày GD."*
- `createTransaction`: gọi `resolveFeeForTxn(db, tid, cardTypeId, txnDate)` → snapshot margin kỳ đúng.
- `updateTransaction` (P1.1 CHƯA bỏ sửa — đó là P1.2): khi **đổi loại thẻ** thì tra lại phí theo **`txnDate` của chính GD** (giữ đúng kỳ, không ăn giá hôm nay). Các trường khác vẫn giữ snapshot (B10).

### 2.3 `setFeeRate` (fee-config-service)
- Nhận thêm `effectiveFrom` (ISO). Không truyền → mặc định `now`.
- **Upsert theo `(partnerId, cardTypeId, effectiveFrom-ngày)`**: đã có kỳ cùng mốc (kể cả xóa mềm→bật lại) → cập nhật; khác mốc → **tạo kỳ mới**. Hai kỳ khác `effectiveFrom` **cùng tồn tại**.
- Giữ validate: đối tác/loại thẻ còn sống + ngân hàng-của-thẻ liên kết đối tác (NOT_LINKED) + phí ≤3 thập phân.

### 2.4 UI `FeeConfigPage` (CMD_BUILD)
- Form set phí thêm ô **"Ngày hiệu lực từ"** (dd/mm/yyyy — R_UI ngày; mặc định hôm nay).
- Bảng biểu phí hiển thị **lịch sử kỳ** theo tổ hợp (đối tác×loại thẻ), sắp theo `effectiveFrom` giảm dần, đánh dấu kỳ đang hiệu lực hôm nay.
- Nơi cấu hình TID "hiện biểu phí realtime" (§9) phải hiển thị **kỳ hiện hành**; không vỡ.

## 3. Bất biến (KHÓA — audit sẽ kiểm)
- **I-P1:** đổi giá 1 kỳ KHÔNG đổi số của bill đã tạo (snapshot đóng băng lúc create).
- **I-P2:** GD `txnDate` ∈ kỳ K → dùng đúng giá kỳ K, bất kể hôm nay đang là kỳ nào (kể cả backdate sau khi đã lập kỳ mới).
- **I-P3:** không có kỳ nào `effectiveFrom ≤ txnDate` → từ chối `NO_FEE_RATE` (không im lặng lấy đại kỳ tương lai).
- **I-P4:** dữ liệu cũ (dòng phí trước P1.1) phủ mọi GD quá khứ (nhờ backfill mốc sàn) — REV15 cũ không được vỡ.

## 4. AUDIT GATE P1.1 (điều kiện PASS — evidence = exit code)
CMD_AUDIT chỉ ký PASS khi CÓ ĐỦ bằng chứng chạy thật:

| # | Hạng mục | Chuẩn PASS |
|---|---|---|
| G1 | typecheck main+web | 0 lỗi |
| G2 | build `@glb/desktop` | exit 0 |
| G3 | vitest (gồm unit `pickEffectiveRate`) | 193+N/0, KHÔNG giảm |
| G4 | **REV15 mở rộng** (selftest doanh thu) | tất cả PASS, gồm khối MỚI "GIÁ THEO KỲ" bên dưới |
| G5 | **fresh-deploy** (migrate deploy DB throwaway trống) | 0 fail (migration mới thứ tự đúng — B07) |
| G6 | regression cũ (STG16/HSC17/TRASH6/NHOMA12) | không vỡ |

### 4.1 Khối test MỚI bắt buộc trong REV15 — "GIÁ THEO KỲ" (phá điểm mù cũ)
> Điểm mù cũ: selftest đổi phí rồi **khôi phục về chuẩn TRƯỚC** khi tạo GD → không kỳ nào lệch. Khối mới KHÔNG được khôi phục — phải để 2 kỳ giá khác nhau cùng tồn tại rồi tạo GD ở từng kỳ.

Kịch bản (tổ hợp đối tác×loại thẻ riêng để độc lập các assert đếm cũ):
1. Lập **kỳ K1** `effectiveFrom = 2026-01-01`, giá A (vd phiMua 3% / phiCaiMay 1% / phiBan 2.5% → margin 2% & 1.5%).
2. Lập **kỳ K2** `effectiveFrom = 2026-07-01`, giá B khác hẳn (vd phiMua 5% / phiCaiMay 1% / phiBan 4% → margin 4% & 3%). **KHÔNG xóa/khôi phục K1.**
3. Tạo GD `txnDate = 2026-06-15` → **phải ăn giá K1** (margin 2% & 1.5%), KHÔNG phải K2.
4. Tạo GD `txnDate = 2026-07-10` → **phải ăn giá K2** (margin 4% & 3%).
5. Tạo GD **backdate** `txnDate = 2026-03-01` (lập SAU khi K2 đã tồn tại) → vẫn **ăn K1** (I-P2).
6. Tạo GD `txnDate = 2025-12-31` (trước mọi kỳ) → **`NO_FEE_RATE`** (I-P3).
7. Sau khi tạo xong, **đổi giá K1** (update kỳ K1) → 3 bill ở bước 3/5 **giữ nguyên** doanh thu đã ghi (I-P1).
8. `pickEffectiveRate` unit (business-rules): 4 ca như §2.1.

## 5. Ngoài phạm vi P1.1 (để P1.2)
- Bỏ sửa trường tài chính của bill / hủy-có-lý-do / Approval Engine (Draft→…→Cancelled) — **P1.2**.
- REV-B02 (lọc theo tidId bất kể xóa mềm) & REV-B03 (phân trang công nợ) đã xong ở B11/B15 — không làm lại.

## 6. Quy trình chốt (R7)
Read→Diff→Proposal→**Approval (xong)**→Backup (checkpoint `clean-checkpoint-nhomBE` đã có)→**Patch (CMD_BUILD)**→**Regression (CMD_AUDIT soi độc lập)**→LEAD nghiệm thu Production. Mọi bug phát sinh → BUGS_FIXED.md + regression trước khi đóng.
