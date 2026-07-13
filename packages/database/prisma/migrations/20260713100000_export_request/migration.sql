-- YÊU CẦU XUẤT KHO (Mr.Long) — Phase 1 engine. Additive thuần: 2 bảng mới, không đụng bảng cũ.
-- ExportRequest = phiếu yêu cầu N đơn vị (chưa seri). ExportRequestLine = N dòng seri/TID người duyệt gán.

CREATE TABLE "export_requests" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "kind" TEXT NOT NULL,
    "handover_kind" TEXT NOT NULL,
    "with_tid" BOOLEAN NOT NULL DEFAULT false,
    "requester_user_id" INTEGER NOT NULL,
    "bank_id" INTEGER,
    "partner_id" INTEGER,
    "customer_id" INTEGER NOT NULL,
    "card_type_id" INTEGER,
    "fee_type_id" INTEGER,
    "price_mode" TEXT NOT NULL DEFAULT 'LISTED',
    "unit_price" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "deposit_amount" BIGINT NOT NULL DEFAULT 0,
    "paid_amount" BIGINT NOT NULL DEFAULT 0,
    "fund_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" INTEGER,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "export_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "export_requests_code_key" ON "export_requests"("code");
CREATE INDEX "export_requests_status_idx" ON "export_requests"("status");
CREATE INDEX "export_requests_kind_idx" ON "export_requests"("kind");

CREATE TABLE "export_request_lines" (
    "id" SERIAL NOT NULL,
    "export_request_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "pos_serial" TEXT,
    "tid" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "export_request_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "export_request_lines_export_request_id_idx" ON "export_request_lines"("export_request_id");
