-- REL-06 (Codex 15/7): partial-unique bản-ghi-SỐNG cho FeeRate/FeeSellQuote (chống 2 transaction song song
-- chèn trùng kỳ giá). Partial (WHERE deleted_at IS NULL) để không phá soft-delete (B05).
CREATE UNIQUE INDEX IF NOT EXISTS "fee_rates_active_uq" ON "fee_rates" ("partner_id", "card_type_id", "effective_from") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "fee_sell_quotes_active_uq" ON "fee_sell_quotes" ("partner_id", "card_type_id", "fee_type_id", "effective_from") WHERE "deleted_at" IS NULL;
