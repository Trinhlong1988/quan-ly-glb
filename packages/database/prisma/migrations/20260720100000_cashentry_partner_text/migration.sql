-- Trường "của ai" nhập tay trên phiếu thu/chi (Mr.Long 20/7): đối tác lẻ NGOÀI danh sách đối tác.
-- Loại trừ với partner_id (chọn từ danh sách → partner_id; gõ tay → partner_text; cả hai NULL = none).
-- Additive, nullable → dữ liệu cũ giữ nguyên (phiếu cũ partner_text = NULL). IF NOT EXISTS: khớp self-heal
-- ensureCriticalSchema (client .exe không có migrate engine tự thêm cột trước khi admin migrate deploy).
ALTER TABLE "cash_entries" ADD COLUMN IF NOT EXISTS "partner_text" TEXT;
