-- R30/R34 CONCURRENCY HARDENING (audit đợt 4 — 12/7). Backstop cấp DB cho 2 bất biến mà service tự giữ,
-- vì Postgres READ COMMITTED cho phép 2 luồng đọc trạng thái cũ rồi cùng ghi (TOCTOU).
--
-- (1) tid_sell_fees: "1 phí bán CÒN SỐNG / (tid × thẻ)". Không có ràng buộc này, 2 lệnh setTidSellFees song
--     song cùng (tid,thẻ) đều findFirst thấy trống → cùng create → 2 dòng active phí khác nhau → resolveFeeForTxn
--     findFirst chọn dòng nào không xác định → CL_KH (tiền) sai + bất định. Partial unique (WHERE deleted_at IS
--     NULL) TÔN TRỌNG soft-delete — bài học B05 (full @@unique phá soft-delete), partial chỉ ràng dòng còn sống.
--
-- (2) approval_requests: "1 yêu cầu HỦY đang chờ / (loại × id)". Chặn race tạo 2 yêu cầu hủy PENDING trùng
--     (cả entity-cancel lẫn bill-cancel đều action='CANCEL' → dùng chung ràng buộc này, đúng ý cả hai luồng).

-- Dedupe phòng vệ (nếu đã lỡ có dòng trùng do race trước khi có index) — GIỮ id lớn nhất (mới nhất).
UPDATE tid_sell_fees t SET deleted_at = now()
 WHERE deleted_at IS NULL AND EXISTS (
   SELECT 1 FROM tid_sell_fees t2
    WHERE t2.tid_id = t.tid_id AND t2.card_type_id = t.card_type_id
      AND t2.deleted_at IS NULL AND t2.id > t.id);

CREATE UNIQUE INDEX IF NOT EXISTS tid_sell_fees_active_uq
  ON tid_sell_fees (tid_id, card_type_id) WHERE deleted_at IS NULL;

UPDATE approval_requests a
   SET status = 'REJECTED',
       decision_note = COALESCE(a.decision_note, '') || ' [auto-dedupe trùng PENDING]'
 WHERE a.action = 'CANCEL' AND a.status = 'PENDING' AND EXISTS (
   SELECT 1 FROM approval_requests a2
    WHERE a2.entity_type = a.entity_type AND a2.entity_id = a.entity_id
      AND a2.action = 'CANCEL' AND a2.status = 'PENDING' AND a2.id > a.id);

CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_pending_cancel_uq
  ON approval_requests (entity_type, entity_id) WHERE action = 'CANCEL' AND status = 'PENDING';
