-- Bill giải trình (Mr.Long 16/7): cột ưu tiên SP khi sinh dòng bill (cao = SP hữu dụng, ưu tiên chọn).
-- 0 = trung tính → engine thoái về xếp theo giá y như trước (không đổi hành vi cũ).
-- AlterTable — IF NOT EXISTS: self-heal (ensureCriticalSchema) có thể đã thêm cột này khi client boot
-- TRƯỚC khi admin chạy `migrate deploy` → tránh deploy gãy "column already exists".
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0;
