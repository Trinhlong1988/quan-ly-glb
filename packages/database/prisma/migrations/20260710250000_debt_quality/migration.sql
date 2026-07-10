-- PHASE H2b — Phân loại chất lượng công nợ (§2.8/§5b) + Ghi giảm nợ xấu (Q-F).
-- Transaction: debt_quality (GOOD|HARD|BAD|null) + đánh dấu ghi giảm (written_off_at/by).
-- CashEntry.fund_id NULLABLE: bút toán "Chi phí nợ xấu" (write-off) KHÔNG-tiền-mặt → fund_id=null
--   (không trừ số dư quỹ nào), nhưng vẫn vào chi phí lợi nhuận theo category (affects_pnl=true).
-- DebtQualityLog: lịch sử đổi phân loại (from→to + lý do + actor).

-- AlterTable — Transaction: cột phân loại + ghi giảm nợ xấu.
ALTER TABLE "transactions" ADD COLUMN "debt_quality" TEXT;
ALTER TABLE "transactions" ADD COLUMN "written_off_at" TIMESTAMPTZ(3);
ALTER TABLE "transactions" ADD COLUMN "written_off_by" INTEGER;

-- CreateIndex
CREATE INDEX "transactions_debt_quality_idx" ON "transactions"("debt_quality");

-- AlterTable — CashEntry.fund_id nullable (bút toán phi tiền mặt: write-off nợ xấu).
ALTER TABLE "cash_entries" ALTER COLUMN "fund_id" DROP NOT NULL;

-- CreateTable — DebtQualityLog.
CREATE TABLE "debt_quality_logs" (
    "id" SERIAL NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "from_quality" TEXT,
    "to_quality" TEXT NOT NULL,
    "reason" TEXT,
    "actor_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_quality_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "debt_quality_logs_transaction_id_idx" ON "debt_quality_logs"("transaction_id");
