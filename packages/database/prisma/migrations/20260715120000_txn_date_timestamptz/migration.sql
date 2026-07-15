-- REL-12 (Codex 15/7): txn_date sang timestamptz(3) như mọi cột thời gian khác (chống lệch múi giờ).
-- GUARD: chỉ đổi khi còn 'timestamp without time zone' → idempotent, không double-convert.
-- Giá trị cũ lưu là UTC instant nên interpret AT TIME ZONE 'UTC' là đúng.
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name='transactions' AND column_name='txn_date') = 'timestamp without time zone' THEN
    ALTER TABLE "transactions" ALTER COLUMN "txn_date" TYPE timestamptz(3) USING "txn_date" AT TIME ZONE 'UTC';
  END IF;
END $$;
