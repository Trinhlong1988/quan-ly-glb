-- R48 — Cột tiền (VND) đổi Int(int4, trần ~2,15 tỷ) → BigInt(int8): GD KHÔNG giới hạn giá trị (Mr.Long).
-- Các cột phí ×1000 (partner/sell margin, phi*) GIỮ Int (≤100000). ALTER TYPE giữ nguyên dữ liệu.
ALTER TABLE "transactions" ALTER COLUMN "amount" TYPE BIGINT;
ALTER TABLE "transactions" ALTER COLUMN "revenue_partner" TYPE BIGINT;
ALTER TABLE "transactions" ALTER COLUMN "revenue_sell" TYPE BIGINT;
ALTER TABLE "transactions" ALTER COLUMN "revenue_amount" TYPE BIGINT;
ALTER TABLE "funds" ALTER COLUMN "opening_balance" TYPE BIGINT;
ALTER TABLE "cash_entries" ALTER COLUMN "amount" TYPE BIGINT;
ALTER TABLE "cash_debt_settlements" ALTER COLUMN "amount" TYPE BIGINT;
