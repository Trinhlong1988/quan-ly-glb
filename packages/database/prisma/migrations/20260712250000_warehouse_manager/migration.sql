-- §4 (Mr.Long 12/7) — Kho gán USER QUẢN LÝ: chọn 1 user → địa chỉ + SĐT lấy từ hồ sơ user (READ-ONLY).
-- Cột scalar (join tại service, nhất quán event-log). Nullable → kho cũ (managerUserId NULL) vẫn dùng
-- address/phone cột kho đang có (tương thích ngược, không phá dữ liệu kho cũ).
ALTER TABLE "warehouses" ADD COLUMN "manager_user_id" INTEGER;
CREATE INDEX "warehouses_manager_user_id_idx" ON "warehouses"("manager_user_id");
