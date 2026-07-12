-- #3/#6 (Mr.Long 12/7): bán máy/TID + công nợ mua thiết bị + hủy khách giữ máy.
-- Additive thuần: cột recall_pending + 2 bảng bán/thu-nợ. Zero rủi ro dữ liệu cũ.

ALTER TABLE "pos_devices" ADD COLUMN "recall_pending" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "device_sales" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "sale_kind" TEXT NOT NULL,
    "device_serial" TEXT,
    "tid" TEXT,
    "customer_id" INTEGER NOT NULL,
    "sale_price" BIGINT NOT NULL,
    "warehouse_id" INTEGER,
    "sold_by_user_id" INTEGER,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,
    CONSTRAINT "device_sales_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "device_sales_code_key" ON "device_sales" ("code");
CREATE INDEX "device_sales_customer_id_idx" ON "device_sales" ("customer_id");
CREATE INDEX "device_sales_sale_kind_idx" ON "device_sales" ("sale_kind");
CREATE INDEX "device_sales_device_serial_idx" ON "device_sales" ("device_serial");
CREATE INDEX "device_sales_tid_idx" ON "device_sales" ("tid");
CREATE INDEX "device_sales_status_idx" ON "device_sales" ("status");

CREATE TABLE "device_sale_settlements" (
    "id" SERIAL NOT NULL,
    "device_sale_id" INTEGER NOT NULL,
    "cash_entry_id" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_sale_settlements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "device_sale_settlements_device_sale_id_idx" ON "device_sale_settlements" ("device_sale_id");
CREATE INDEX "device_sale_settlements_cash_entry_id_idx" ON "device_sale_settlements" ("cash_entry_id");
