-- G-CFG.5 — Quản lý Hồ sơ HKD (§10): nguồn hồ sơ (10a/b) + hồ sơ HKD (10c/d). Additive only.

-- CreateTable
CREATE TABLE "dossier_sources" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "discount_rate" INTEGER NOT NULL DEFAULT 0,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "dossiers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source_id" INTEGER NOT NULL,
    "hkd_name" TEXT NOT NULL,
    "hkd_address" TEXT,
    "tax_code" TEXT,
    "dkkd_issue_date" DATETIME,
    "dkkd_issue_place" TEXT,
    "owner_name" TEXT NOT NULL,
    "gender" TEXT,
    "ethnicity" TEXT,
    "cccd_number" TEXT,
    "cccd_issue_date" DATETIME,
    "cccd_issue_place" TEXT,
    "cccd_expiry" DATETIME,
    "permanent_address" TEXT,
    "current_address" TEXT,
    "dkkd_front_path" TEXT,
    "dkkd_front_name" TEXT,
    "dkkd_back_path" TEXT,
    "dkkd_back_name" TEXT,
    "cccd_front_path" TEXT,
    "cccd_front_name" TEXT,
    "cccd_back_path" TEXT,
    "cccd_back_name" TEXT,
    "note" TEXT,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "dossier_sources_code_key" ON "dossier_sources"("code");

-- CreateIndex
CREATE INDEX "dossiers_source_id_idx" ON "dossiers"("source_id");
