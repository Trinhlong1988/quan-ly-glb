-- Mr.Long 14/7 — thêm hình thức thanh toán (CASH | CK) cho phiếu Yêu cầu xuất kho. Additive, cột NOT NULL
-- default 'CASH' → phiếu cũ (nếu có) tự nhận CASH, không phá dữ liệu.
ALTER TABLE "export_requests" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'CASH';
