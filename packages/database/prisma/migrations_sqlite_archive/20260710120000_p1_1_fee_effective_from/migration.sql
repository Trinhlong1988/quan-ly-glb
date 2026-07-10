-- P1.1 GIÁ THEO KỲ — thêm cột KỲ hiệu lực `effective_from` cho biểu phí (fee_rates).
-- Additive + backfill. Thứ tự folder timestamp 20260710120000 > mọi migration (sau maintenance_runs
-- 20260710010000) → fresh deploy áp đúng thứ tự (bài học B07). KHÔNG @@unique (bài học B05).

-- 1) Thêm cột nullable rồi backfill mốc sàn cho MỌI dòng cũ (mô hình 1-dòng/tổ hợp) → phủ mọi GD quá khứ.
ALTER TABLE "fee_rates" ADD COLUMN "effective_from" DATETIME;
UPDATE "fee_rates" SET "effective_from" = '1970-01-01 00:00:00.000' WHERE "effective_from" IS NULL;

-- 2) Dựng lại bảng để ép cột effective_from BẮT BUỘC (SQLite không ALTER COLUMN NOT NULL trực tiếp).
--    Giữ nguyên toàn bộ cột hiện hành (gồm deleted_by của migration 20260709200000).
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_fee_rates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partner_id" INTEGER NOT NULL,
    "card_type_id" INTEGER NOT NULL,
    "phi_mua" INTEGER NOT NULL,
    "phi_cai_may" INTEGER NOT NULL,
    "phi_ban" INTEGER NOT NULL,
    "effective_from" DATETIME NOT NULL,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "deleted_by" INTEGER
);

INSERT INTO "new_fee_rates" ("id", "partner_id", "card_type_id", "phi_mua", "phi_cai_may", "phi_ban", "effective_from", "created_by", "created_at", "updated_by", "updated_at", "deleted_at", "deleted_by")
SELECT "id", "partner_id", "card_type_id", "phi_mua", "phi_cai_may", "phi_ban", "effective_from", "created_by", "created_at", "updated_by", "updated_at", "deleted_at", "deleted_by"
FROM "fee_rates";

DROP TABLE "fee_rates";
ALTER TABLE "new_fee_rates" RENAME TO "fee_rates";

CREATE INDEX "fee_rates_partner_id_idx" ON "fee_rates"("partner_id");
CREATE INDEX "fee_rates_card_type_id_idx" ON "fee_rates"("card_type_id");

PRAGMA foreign_keys=ON;
