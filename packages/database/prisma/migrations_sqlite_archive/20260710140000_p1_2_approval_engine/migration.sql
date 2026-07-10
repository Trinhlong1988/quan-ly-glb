-- P1.2 APPROVAL ENGINE + BILL BẤT BIẾN. Additive. Timestamp 20260710140000 > mọi migration (sau
-- p1_1_fee_effective_from 20260710120000) → fresh deploy áp đúng thứ tự (B07).

-- 1) transactions: thêm status (default POSTED cho bill cũ) + trường hủy.
ALTER TABLE "transactions" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'POSTED';
ALTER TABLE "transactions" ADD COLUMN "cancel_reason" TEXT;
ALTER TABLE "transactions" ADD COLUMN "cancelled_at" DATETIME;
ALTER TABLE "transactions" ADD COLUMN "cancel_request_id" INTEGER;
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- 2) approval_requests (generic).
CREATE TABLE "approval_requests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_by" INTEGER NOT NULL,
    "requested_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" INTEGER,
    "decided_at" DATETIME,
    "decision_note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
CREATE INDEX "approval_requests_entity_type_entity_id_idx" ON "approval_requests"("entity_type", "entity_id");
CREATE INDEX "approval_requests_status_idx" ON "approval_requests"("status");
