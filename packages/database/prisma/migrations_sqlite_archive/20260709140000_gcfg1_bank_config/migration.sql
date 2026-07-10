-- G-CFG.1 — Cấu hình ngân hàng (§C1–C4): Ngân hàng · Loại thẻ POS · Đối tác · liên kết Đối tác↔Ngân hàng.
-- Additive only: chỉ CREATE TABLE mới, KHÔNG drop/alter bảng G1/G-POS hiện có.

-- CreateTable
CREATE TABLE "banks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "card_types" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bank_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "partners" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "contact_person" TEXT,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "partner_banks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partner_id" INTEGER NOT NULL,
    "bank_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "banks_code_key" ON "banks"("code");

-- CreateIndex
CREATE INDEX "card_types_bank_id_idx" ON "card_types"("bank_id");

-- CreateIndex
CREATE UNIQUE INDEX "partners_code_key" ON "partners"("code");

-- CreateIndex
CREATE INDEX "partner_banks_partner_id_idx" ON "partner_banks"("partner_id");

-- CreateIndex
CREATE INDEX "partner_banks_bank_id_idx" ON "partner_banks"("bank_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_banks_partner_id_bank_id_key" ON "partner_banks"("partner_id", "bank_id");
