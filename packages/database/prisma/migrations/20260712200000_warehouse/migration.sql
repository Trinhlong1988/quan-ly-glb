-- R27 (Mr.Long 12/7): Danh mục Kho + trường giao đủ (kho xuất + địa chỉ giao) trên nhật ký vòng đời.
-- Additive thuần: tạo bảng warehouses + thêm 2 cột nullable vào asset_events. Zero rủi ro dữ liệu cũ.

CREATE TABLE "warehouses" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,
    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses" ("code");

ALTER TABLE "asset_events" ADD COLUMN "from_warehouse_id" INTEGER;
ALTER TABLE "asset_events" ADD COLUMN "delivery_address" TEXT;
