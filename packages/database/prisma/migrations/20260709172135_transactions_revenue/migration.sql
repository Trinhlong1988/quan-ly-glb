-- CreateTable
CREATE TABLE "transactions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT,
    "tid_id" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "card_type_id" INTEGER,
    "amount" INTEGER NOT NULL,
    "partner_margin_milli" INTEGER NOT NULL DEFAULT 0,
    "sell_margin_milli" INTEGER NOT NULL DEFAULT 0,
    "revenue_partner" INTEGER NOT NULL DEFAULT 0,
    "revenue_sell" INTEGER NOT NULL DEFAULT 0,
    "revenue_amount" INTEGER NOT NULL DEFAULT 0,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "settled_at" DATETIME,
    "txn_date" DATETIME NOT NULL,
    "note" TEXT,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "deleted_by" INTEGER
);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_code_key" ON "transactions"("code");

-- CreateIndex
CREATE INDEX "transactions_tid_id_idx" ON "transactions"("tid_id");

-- CreateIndex
CREATE INDEX "transactions_customer_id_idx" ON "transactions"("customer_id");

-- CreateIndex
CREATE INDEX "transactions_txn_date_idx" ON "transactions"("txn_date");
