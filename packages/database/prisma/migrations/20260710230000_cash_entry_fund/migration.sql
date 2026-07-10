-- PHASE H2-core — Thu–Chi (Cashflow). Quỹ (funds §2.2/J) + Phiếu thu/chi (cash_entries §2.3/D+E).
-- Tiền = VND nguyên (KHÔNG ×1000). Số dư quỹ KHÔNG lưu cứng — tính running từ cash_entries POSTED (I#1).
-- Mọi cột thời gian TIMESTAMPTZ(3) (M6). Mã QU/PT/PC sinh atomic qua code_counters (§D/R7).

-- CreateTable
CREATE TABLE "funds" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "keeper_user_id" INTEGER,
    "opening_balance" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "funds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_entries" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "kind" TEXT NOT NULL,
    "category_id" INTEGER NOT NULL,
    "fund_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "entry_date" TIMESTAMPTZ(3) NOT NULL,
    "customer_id" INTEGER,
    "partner_id" INTEGER,
    "payer_user_id" INTEGER,
    "receiver_user_id" INTEGER,
    "doc_path" TEXT,
    "doc_name" TEXT,
    "source_type" TEXT,
    "source_id" INTEGER,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "funds_code_key" ON "funds"("code");

-- CreateIndex
CREATE UNIQUE INDEX "cash_entries_code_key" ON "cash_entries"("code");

-- CreateIndex
CREATE INDEX "cash_entries_fund_id_idx" ON "cash_entries"("fund_id");

-- CreateIndex
CREATE INDEX "cash_entries_category_id_idx" ON "cash_entries"("category_id");

-- CreateIndex
CREATE INDEX "cash_entries_entry_date_idx" ON "cash_entries"("entry_date");

-- CreateIndex
CREATE INDEX "cash_entries_status_idx" ON "cash_entries"("status");

-- CreateIndex
CREATE INDEX "cash_entries_customer_id_idx" ON "cash_entries"("customer_id");

-- CreateIndex
CREATE INDEX "cash_entries_partner_id_idx" ON "cash_entries"("partner_id");
