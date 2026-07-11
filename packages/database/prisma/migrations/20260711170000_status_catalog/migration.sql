-- Đối tác: thêm trạng thái hợp đồng hợp tác (SIGNED đã ký | UNSIGNED chưa ký | TERMINATED đã hủy).
ALTER TABLE "partners" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'UNSIGNED';

-- Danh mục trạng thái tùy biến dùng chung (R14). Mỗi entity có bộ trạng thái riêng; builtin khóa.
CREATE TABLE "status_options" (
    "id" SERIAL NOT NULL,
    "entity" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'slate',
    "is_builtin" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,
    CONSTRAINT "status_options_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "status_options_entity_code_key" ON "status_options"("entity", "code");
CREATE INDEX "status_options_entity_idx" ON "status_options"("entity");

-- Seed builtin (idempotent qua ON CONFLICT). Nhóm master-data cho phép thêm mới ở service.
INSERT INTO "status_options" ("entity","code","label","tone","is_builtin","sort_order") VALUES
  ('BANK','ACTIVE','Đang hoạt động','emerald',true,0),
  ('BANK','INACTIVE','Không hoạt động','slate',true,1),
  ('CUSTOMER','ACTIVE','Đang hoạt động','emerald',true,0),
  ('CUSTOMER','LOCKED','Đã khóa','amber',true,1),
  ('CUSTOMER','CANCELLED','Đã hủy','slate',true,2),
  ('PARTNER','SIGNED','Đã ký hợp đồng hợp tác','emerald',true,0),
  ('PARTNER','UNSIGNED','Chưa ký hợp đồng hợp tác','amber',true,1),
  ('PARTNER','TERMINATED','Đã hủy hợp đồng hợp tác','rose',true,2),
  ('POS_DEVICE','IN_STOCK','Trong kho','sky',true,0),
  ('POS_DEVICE','DEPLOYED','Đã triển khai','emerald',true,1),
  ('POS_DEVICE','IN_REPAIR','Đang sửa chữa','amber',true,2),
  ('POS_DEVICE','DAMAGED','Hỏng','rose',true,3),
  ('POS_DEVICE','RETIRED','Ngừng dùng','slate',true,4),
  ('HKD_MST','ACTIVE','Hoạt động','emerald',true,0),
  ('HKD_MST','CLOSED','Đóng','slate',true,1)
ON CONFLICT ("entity","code") DO NOTHING;
