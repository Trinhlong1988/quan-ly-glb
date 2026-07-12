-- POS #1 (Mr.Long 12/7): khóa CỨNG bất biến "1 máy 1 TID SỐNG" ở tầng DB (backstop tầng service).
-- Trước đây bất biến chỉ được enforce bằng guard + FOR UPDATE trong assignTid/createTidUnified.
-- Thêm 2 partial-unique để DB TỰ CHẶN dù có đường ghi nào lọt qua guard:
--   1) mỗi máy (pos_serial) chỉ có TỐI ĐA 1 binding còn mở (unbound_at IS NULL);
--   2) mỗi TID chỉ có TỐI ĐA 1 binding còn mở → 1 TID không thể sống trên 2 máy cùng lúc.
-- Binding đã đóng (unbound_at NOT NULL) không bị ràng buộc → giữ nguyên lịch sử bind/unbind.
-- Data glb hiện 0 binding → tạo an toàn (đã kiểm dup rỗng + backup pre-migration).
CREATE UNIQUE INDEX IF NOT EXISTS "pos_tid_bindings_pos_serial_open_uk"
  ON "pos_tid_bindings" ("pos_serial") WHERE "unbound_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "pos_tid_bindings_tid_open_uk"
  ON "pos_tid_bindings" ("tid") WHERE "unbound_at" IS NULL;
