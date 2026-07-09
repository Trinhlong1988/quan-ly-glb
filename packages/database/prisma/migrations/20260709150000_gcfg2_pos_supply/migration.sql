-- G-CFG.2 — Chuỗi cung ứng máy POS (§C6 NCC · §C7 Chủng loại · §C8 Nhập kho).
-- Additive only: chỉ CREATE TABLE mới, KHÔNG drop/alter bảng hiện có.

-- CreateTable
CREATE TABLE "suppliers" (
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
CREATE TABLE "pos_models" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "pos_intake_statuses" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "pos_intakes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pos_model_id" INTEGER NOT NULL,
    "serial" TEXT NOT NULL,
    "intake_status_id" INTEGER NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "import_price" INTEGER NOT NULL,
    "imported_at" DATETIME NOT NULL,
    "note" TEXT,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pos_models_code_key" ON "pos_models"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pos_intake_statuses_name_key" ON "pos_intake_statuses"("name");

-- CreateIndex
CREATE UNIQUE INDEX "pos_intakes_serial_key" ON "pos_intakes"("serial");

-- CreateIndex
CREATE INDEX "pos_intakes_pos_model_id_idx" ON "pos_intakes"("pos_model_id");

-- CreateIndex
CREATE INDEX "pos_intakes_supplier_id_idx" ON "pos_intakes"("supplier_id");

-- CreateIndex
CREATE INDEX "pos_intakes_intake_status_id_idx" ON "pos_intakes"("intake_status_id");
