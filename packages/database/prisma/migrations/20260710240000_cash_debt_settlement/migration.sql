-- PHASE H2-debt — Thu công nợ nối Transaction (net-of-settlement §2.4, chống đếm trùng H4).
-- 1 dòng = số tiền áp vào 1 side (PARTNER|SELL) của 1 Transaction bởi 1 phiếu thu công nợ (CashEntry).
-- Công nợ còn lại = revenue(side) − Σ amount(side). settled chỉ là hệ quả khi cả 2 side net=0.

-- CreateTable
CREATE TABLE "cash_debt_settlements" (
    "id" SERIAL NOT NULL,
    "cash_entry_id" INTEGER NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_debt_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_debt_settlements_cash_entry_id_idx" ON "cash_debt_settlements"("cash_entry_id");

-- CreateIndex
CREATE INDEX "cash_debt_settlements_transaction_id_idx" ON "cash_debt_settlements"("transaction_id");
