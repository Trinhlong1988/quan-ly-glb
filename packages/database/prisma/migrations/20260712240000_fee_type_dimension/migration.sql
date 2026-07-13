-- FEE_MODEL (Mr.Long 12/7) — LOẠI PHÍ CHỈ đổi PHÍ BÁN. Phí MUA + phí CÀI MÁY = 1 giá CỐ ĐỊNH cho tổ hợp
-- (Đối tác × Loại thẻ), KHÔNG theo loại phí. Phí BÁN NIÊM YẾT tách theo TỪNG loại phí (Ủy quyền/Tiền chờ…).
--
-- Đổi mô hình so với bản nháp trước (biểu phí theo loại phí cho cả mua/cài/bán):
--   • fee_rates      : BỎ cột phi_ban (phí bán nay ở fee_sell_quotes). Giữ phi_mua/phi_cai_may + effective_from.
--                      Khóa kỳ hiệu lực = (partner_id, card_type_id) + effective_from.
--   • fee_sell_quotes: BẢNG MỚI — phí bán niêm yết theo (partner_id, card_type_id, fee_type_id) + effective_from.
--   • tid_sell_fees  : phí bán THỰC TẾ (override) nay theo (tid_id, card_type_id, fee_type_id).
--   • transactions   : loại phí đã chọn khi ghi GD (nullable — GD lịch sử; service ép bắt buộc khi tạo mới).
-- Bảng fee_rates + tid_sell_fees RỖNG (0 dòng) nên cột NOT NULL không cần default. transactions cho NULL.

-- ── fee_rates ── (bỏ phí bán — phí bán nay ở fee_sell_quotes theo loại phí)
ALTER TABLE "fee_rates" DROP COLUMN "phi_ban";

-- ── fee_sell_quotes ── (phí bán niêm yết theo loại phí)
CREATE TABLE "fee_sell_quotes" (
    "id" SERIAL NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "card_type_id" INTEGER NOT NULL,
    "fee_type_id" INTEGER NOT NULL,
    "phi_ban" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,
    CONSTRAINT "fee_sell_quotes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fee_sell_quotes_partner_id_idx" ON "fee_sell_quotes"("partner_id");
CREATE INDEX "fee_sell_quotes_card_type_id_idx" ON "fee_sell_quotes"("card_type_id");
CREATE INDEX "fee_sell_quotes_fee_type_id_idx" ON "fee_sell_quotes"("fee_type_id");

-- ── tid_sell_fees ── (phí bán thực tế nay theo loại phí)
ALTER TABLE "tid_sell_fees" ADD COLUMN "fee_type_id" INTEGER NOT NULL;
CREATE INDEX "tid_sell_fees_fee_type_id_idx" ON "tid_sell_fees"("fee_type_id");
-- Cập nhật partial-unique "1 phí bán CÒN SỐNG / (tid × thẻ)" → thêm chiều LOẠI PHÍ:
-- 1 phí bán còn sống / (tid × thẻ × loại phí). Bỏ index cũ (chỉ (tid,thẻ)) rồi tạo lại kèm fee_type_id.
DROP INDEX IF EXISTS "tid_sell_fees_active_uq";
CREATE UNIQUE INDEX "tid_sell_fees_active_uq"
  ON "tid_sell_fees" ("tid_id", "card_type_id", "fee_type_id") WHERE "deleted_at" IS NULL;

-- ── transactions ── (nullable — GD lịch sử không phá; service BẮT BUỘC khi tạo mới)
ALTER TABLE "transactions" ADD COLUMN "fee_type_id" INTEGER;
CREATE INDEX "transactions_fee_type_id_idx" ON "transactions"("fee_type_id");
