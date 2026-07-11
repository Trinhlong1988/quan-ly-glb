-- PHASE K2 — Hợp nhất TID: 1 module TID duy nhất (§5/§8). Thêm 2 cột nullable vào tids:
--   • customer_device_serial (Q-T6): serial máy CỦA KHÁCH — tra cứu, KHÔNG tạo PosDevice của ta.
--   • dossier_id (Q-T3): link Hồ sơ HKD (Dossier). GIỮ cột hkd_name text để hiển thị + backfill.
-- KHÔNG cột AssetEvent (Q-TL2 — join bằng chuỗi tid), KHÔNG cột bool (Q-T1 — 2 chiều DERIVE),
-- KHÔNG xóa bank/hkd_name text. Backfill dossier_id chạy ở seedIfEmpty (idempotent, guard cờ AppSetting).

-- AlterTable — tids: máy của khách (Q-T6) + link HKD (Q-T3), cả hai nullable.
ALTER TABLE "tids" ADD COLUMN "customer_device_serial" TEXT;
ALTER TABLE "tids" ADD COLUMN "dossier_id" INTEGER;

-- CreateIndex — tra TID theo HKD.
CREATE INDEX "tids_dossier_id_idx" ON "tids"("dossier_id");
