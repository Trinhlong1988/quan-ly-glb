-- G-CFG.3 — Cấu hình phí (§C5): Loại phí (C5a) + Biểu phí % theo Đối tác × Loại thẻ (C5b).
-- Additive only.

-- CreateTable
CREATE TABLE "fee_types" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "fee_rates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partner_id" INTEGER NOT NULL,
    "card_type_id" INTEGER NOT NULL,
    "phi_mua" INTEGER NOT NULL,
    "phi_cai_may" INTEGER NOT NULL,
    "phi_ban" INTEGER NOT NULL,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "fee_types_name_key" ON "fee_types"("name");

-- CreateIndex
CREATE INDEX "fee_rates_partner_id_idx" ON "fee_rates"("partner_id");

-- CreateIndex
CREATE INDEX "fee_rates_card_type_id_idx" ON "fee_rates"("card_type_id");
