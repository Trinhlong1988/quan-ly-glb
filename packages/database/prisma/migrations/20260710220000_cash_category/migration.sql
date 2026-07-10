-- PHASE H1 — Thu–Chi (Cashflow). Bảng danh mục khoản THU/CHI (§A/§B spec H).
-- affectsPnl = cột chống double-count lợi nhuận accrual (§5). isSystem = danh mục hệ thống (seed).
-- CreateTable
CREATE TABLE "cash_categories" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "period_type" TEXT,
    "source_kind" TEXT NOT NULL DEFAULT 'MANUAL',
    "affects_pnl" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "cash_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_categories_kind_idx" ON "cash_categories"("kind");

-- CreateIndex
CREATE INDEX "cash_categories_source_kind_idx" ON "cash_categories"("source_kind");
