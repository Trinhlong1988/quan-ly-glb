-- G-CFG.4 — Tài khoản nhận tiền – ủy quyền (§8): nguồn TK (8a) + TK (8b). Additive only.

-- CreateTable
CREATE TABLE "receive_account_sources" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "receive_accounts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source_id" INTEGER NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "bank_id" INTEGER NOT NULL,
    "branch" TEXT,
    "cccd_number" TEXT,
    "cccd_issue_date" DATETIME,
    "cccd_issue_place" TEXT,
    "cccd_expiry" DATETIME,
    "phone" TEXT,
    "email" TEXT,
    "customer_id" INTEGER,
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
CREATE UNIQUE INDEX "receive_account_sources_name_key" ON "receive_account_sources"("name");

-- CreateIndex
CREATE INDEX "receive_accounts_source_id_idx" ON "receive_accounts"("source_id");

-- CreateIndex
CREATE INDEX "receive_accounts_bank_id_idx" ON "receive_accounts"("bank_id");

-- CreateIndex
CREATE INDEX "receive_accounts_customer_id_idx" ON "receive_accounts"("customer_id");
