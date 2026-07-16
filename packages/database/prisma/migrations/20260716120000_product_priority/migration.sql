-- Bill giải trình (Mr.Long 16/7): cột ưu tiên SP khi sinh dòng bill (cao = SP hữu dụng, ưu tiên chọn).
-- 0 = trung tính → engine thoái về xếp theo giá y như trước (không đổi hành vi cũ).
-- AlterTable
ALTER TABLE "products" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
