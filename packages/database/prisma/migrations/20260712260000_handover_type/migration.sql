-- LOẠI GIAO MÁY (Mr.Long) — Bán/Cho thuê/Mượn/Cọc: mô hình tiền theo hình thức giao.
-- Additive thuần: 3 bảng mới (handover_types + device_deposits + device_deposit_refunds) +
-- cột nullable trên asset_events (loại giao + số tiền lúc giao) + device_sales (loại giao). Zero rủi ro
-- dữ liệu cũ (mọi cột thêm đều nullable, không đổi cột/khóa hiện có).

-- ── Danh mục Loại giao máy (moneyKind quyết định mô hình tiền) ──
CREATE TABLE "handover_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "money_kind" TEXT NOT NULL,
    "is_builtin" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,
    CONSTRAINT "handover_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "handover_types_name_key" ON "handover_types" ("name");

-- ── Chứng từ cọc (nhân khuôn device_sales) ──
CREATE TABLE "device_deposits" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "customer_id" INTEGER NOT NULL,
    "device_serial" TEXT,
    "tid" TEXT,
    "handover_type_id" INTEGER,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_deposits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "device_deposits_code_key" ON "device_deposits" ("code");
CREATE INDEX "device_deposits_customer_id_idx" ON "device_deposits" ("customer_id");
CREATE INDEX "device_deposits_device_serial_idx" ON "device_deposits" ("device_serial");
CREATE INDEX "device_deposits_tid_idx" ON "device_deposits" ("tid");
CREATE INDEX "device_deposits_status_idx" ON "device_deposits" ("status");

-- ── Hoàn cọc (nhân khuôn device_sale_settlements) ──
CREATE TABLE "device_deposit_refunds" (
    "id" SERIAL NOT NULL,
    "device_deposit_id" INTEGER NOT NULL,
    "cash_entry_id" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_deposit_refunds_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "device_deposit_refunds_device_deposit_id_idx" ON "device_deposit_refunds" ("device_deposit_id");
CREATE INDEX "device_deposit_refunds_cash_entry_id_idx" ON "device_deposit_refunds" ("cash_entry_id");

-- ── Ghi loại giao + số tiền lúc DEPLOY/giao-TID vào nhật ký bất biến (hiển thị vòng đời) ──
ALTER TABLE "asset_events" ADD COLUMN "handover_type_id" INTEGER;
ALTER TABLE "asset_events" ADD COLUMN "handover_amount" BIGINT;
CREATE INDEX "asset_events_handover_type_id_idx" ON "asset_events" ("handover_type_id");

-- ── Báo cáo doanh thu bán theo loại giao (Bán luôn moneyKind=SALE) ──
ALTER TABLE "device_sales" ADD COLUMN "handover_type_id" INTEGER;
