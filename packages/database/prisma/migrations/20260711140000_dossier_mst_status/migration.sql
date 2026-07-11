-- LANE C #12 — Trạng thái MST cho Hồ sơ HKD (§10c). ACTIVE=Hoạt động / CLOSED=Đóng.
-- Hồ sơ cũ mặc định ACTIVE (an toàn, không phá dữ liệu hiện có).
-- AlterTable
ALTER TABLE "dossiers" ADD COLUMN "mst_status" TEXT NOT NULL DEFAULT 'ACTIVE';
