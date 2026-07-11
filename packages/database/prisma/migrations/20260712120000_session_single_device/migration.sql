-- R46 — 1 tài khoản chỉ đăng nhập 1 thiết bị cùng lúc. Thêm nhịp tim (last_seen_at) + tên thiết bị.
ALTER TABLE "login_sessions" ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now();
ALTER TABLE "login_sessions" ADD COLUMN IF NOT EXISTS "device_info" TEXT;
CREATE INDEX IF NOT EXISTS "login_sessions_user_id_idx" ON "login_sessions" ("user_id");
