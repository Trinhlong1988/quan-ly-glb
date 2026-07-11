-- LANE A (#11) — Ngành nghề cho TID. Thêm 1 cột nullable vào tids:
--   • industry_id: FK-mềm tới industries.id (KHÔNG ràng buộc FK cứng — nhất quán bank_id/partner_id
--     hiện cũng Int? không FK; validate tồn tại + active ở tầng service createTidUnified).
-- Nullable ở DB (TID cũ = null); "bắt buộc chọn ngành nghề" enforce ở tầng tạo, KHÔNG phá dữ liệu cũ.

-- AlterTable — tids: ngành nghề (#11), nullable.
ALTER TABLE "tids" ADD COLUMN "industry_id" INTEGER;

-- CreateIndex — lọc TID theo ngành nghề (Quản Lý TID).
CREATE INDEX "tids_industry_id_idx" ON "tids"("industry_id");
