-- Ngân hàng: thêm số thứ tự tuần tự (hiển thị NH01, NH02...) + trạng thái hoạt động/không.
ALTER TABLE "banks" ADD COLUMN "seq" INTEGER;
ALTER TABLE "banks" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- Backfill seq theo thứ tự tạo (created_at, id) cho ngân hàng hiện có — kể cả đã xóa mềm để số KHÔNG tái dùng.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn FROM "banks"
)
UPDATE "banks" b SET "seq" = o.rn FROM ordered o WHERE b.id = o.id;

-- Unique cho seq (khớp schema seq Int? @unique). NULL nhiều bản OK ở Postgres.
CREATE UNIQUE INDEX "banks_seq_key" ON "banks"("seq");
