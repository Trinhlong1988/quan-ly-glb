-- Khách hàng: thêm trạng thái vòng đời (ACTIVE đang hoạt động | LOCKED đã khóa | CANCELLED đã hủy).
ALTER TABLE "customers" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
