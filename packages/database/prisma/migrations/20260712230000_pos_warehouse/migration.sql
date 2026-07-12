-- Model 1 (Mr.Long 12/7): kho vật lý đang chứa máy POS (lọc "máy ở kho nào").
-- Chỉ có giá trị khi IN_STOCK; máy cũ để trống (NULL) — Mr.Long chấp nhận "để trống".
ALTER TABLE "pos_devices" ADD COLUMN "warehouse_id" INTEGER;
CREATE INDEX "pos_devices_warehouse_id_idx" ON "pos_devices" ("warehouse_id");
