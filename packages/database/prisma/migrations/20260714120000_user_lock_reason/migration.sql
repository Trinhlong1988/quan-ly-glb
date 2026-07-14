-- P0-01 (PING audit) — thêm LÝ DO khóa tài khoản để phân biệt khóa-tạm (tự mở) vs khóa-tay (không tự mở).
-- Additive, nullable. Dữ liệu cũ: tài khoản đang LOCKED có lockedAt != null coi như AUTH_FAILURE (tự khóa cũ);
-- LOCKED mà lockedAt null coi như ADMIN_LOCK (khóa tay cũ) → backfill an toàn không đổi hành vi hiện có.
ALTER TABLE "users" ADD COLUMN "lock_reason" TEXT;

UPDATE "users" SET "lock_reason" = 'AUTH_FAILURE' WHERE "status" = 'LOCKED' AND "locked_at" IS NOT NULL AND "lock_reason" IS NULL;
UPDATE "users" SET "lock_reason" = 'ADMIN_LOCK'   WHERE "status" = 'LOCKED' AND "locked_at" IS NULL     AND "lock_reason" IS NULL;
