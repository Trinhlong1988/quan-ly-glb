-- R48 Pha 2 — khóa nhận diện thiết bị bền (GUID/1-cài-đặt) thay hostname (chống giả mạo) để R46 chắc hơn.
ALTER TABLE "login_sessions" ADD COLUMN IF NOT EXISTS "device_id" TEXT;
