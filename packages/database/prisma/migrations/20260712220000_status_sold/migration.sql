-- Nợ #3 (Mr.Long 12/7): badge trạng thái ĐÃ BÁN cho máy POS.
-- POS dùng danh mục StatusOption (R14) → thêm builtin 'SOLD' để badge hiện "Đã bán" (violet) thay vì mã trần.
-- (TID dùng StatusPill hardcode — đã thêm SOLD ở tầng UI, không cần seed.)
INSERT INTO "status_options" ("entity","code","label","tone","is_builtin","sort_order") VALUES
  ('POS_DEVICE','SOLD','Đã bán','violet',true,5)
ON CONFLICT ("entity","code") DO NOTHING;
