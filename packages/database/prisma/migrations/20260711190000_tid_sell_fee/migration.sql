-- R30 (Mr.Long 11/7): Phí BÁN THỰC TẾ theo từng TID × Loại thẻ (tùy biến theo khách khi GIAO máy).
-- Biểu phí ở fee_rates (Đối tác × Loại thẻ) chỉ là phí NIÊM YẾT chung; phí bán thật thỏa thuận riêng
-- mỗi TID/khách/thẻ, nhập lúc giao. phi_ban Int = %×1000 (như fee_rates). resolveFeeForTxn ưu tiên
-- override này thay cho fee_rates.phi_ban khi tính CL_KH. KHÔNG UNIQUE DB (có deleted_at — bài học B05);
-- "1 phí / 1 (tid, thẻ) còn sống" enforce ở service bằng upsert.
CREATE TABLE "tid_sell_fees" (
    "id" SERIAL NOT NULL,
    "tid_id" INTEGER NOT NULL,
    "card_type_id" INTEGER NOT NULL,
    "phi_ban" INTEGER NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,
    CONSTRAINT "tid_sell_fees_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tid_sell_fees_tid_id_idx" ON "tid_sell_fees"("tid_id");
CREATE INDEX "tid_sell_fees_card_type_id_idx" ON "tid_sell_fees"("card_type_id");
