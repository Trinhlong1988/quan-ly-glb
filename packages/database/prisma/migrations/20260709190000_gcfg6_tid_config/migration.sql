-- G-CFG.6 — Cấu hình TID (§9). Cách 1: gộp thông tin thương mại vào bảng tids (additive nullable)
-- + bảng trạng thái TID cấu hình (§9a). Additive only — không đụng dữ liệu/cột cũ.

-- AlterTable: thêm cột thương mại §9 vào tids (đều nullable → hàng cũ không ảnh hưởng)
ALTER TABLE "tids" ADD COLUMN "bank_id" INTEGER;
ALTER TABLE "tids" ADD COLUMN "partner_id" INTEGER;
ALTER TABLE "tids" ADD COLUMN "hkd_name" TEXT;
ALTER TABLE "tids" ADD COLUMN "receive_account_id" INTEGER;
ALTER TABLE "tids" ADD COLUMN "issued_at" DATETIME;
ALTER TABLE "tids" ADD COLUMN "config_status_id" INTEGER;
ALTER TABLE "tids" ADD COLUMN "dossier_source_id" INTEGER;
ALTER TABLE "tids" ADD COLUMN "note" TEXT;
ALTER TABLE "tids" ADD COLUMN "created_by" INTEGER;
ALTER TABLE "tids" ADD COLUMN "updated_by" INTEGER;
ALTER TABLE "tids" ADD COLUMN "deleted_at" DATETIME;

-- CreateIndex
CREATE INDEX "tids_partner_id_idx" ON "tids"("partner_id");

-- CreateIndex
CREATE INDEX "tids_bank_id_idx" ON "tids"("bank_id");

-- CreateTable
CREATE TABLE "tid_config_statuses" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "tid_config_statuses_name_key" ON "tid_config_statuses"("name");
