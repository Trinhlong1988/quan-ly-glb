// R48 Pha 3 #2 — Optimistic lock (chống 2 người sửa đè).
// Bối cảnh: 2 người cùng mở 1 bản ghi; người lưu SAU sẽ ghi đè mất thay đổi của người lưu TRƯỚC mà không ai biết.
// Cơ chế: client tải bản ghi kèm `updatedAt`; khi Lưu gửi lại `expectedUpdatedAt` = mốc lúc tải. Backend so với
// `updatedAt` HIỆN TẠI của DB — lệch nghĩa là đã có người sửa xen giữa → TỪ CHỐI (STALE_WRITE), buộc tải lại.
//
// TƯƠNG THÍCH NGƯỢC (quan trọng): nếu client KHÔNG gửi expectedUpdatedAt (call cũ / thao tác nội bộ) → KHÔNG kiểm →
// không đổi hành vi cũ, không phá selftest. Guard là "opt-in" theo từng lời gọi.
//
// Ngưỡng an toàn: chỉnh sửa qua form của con người diễn ra theo giây–phút; so `updatedAt` (Prisma tự cập nhật mỗi lần
// update) bắt trọn tình huống thật. Các luồng TIỀN vốn đã được khóa hàng Postgres (FOR UPDATE / advisory-lock) serialize.

export interface StaleWrite {
  ok: false;
  error: 'STALE_WRITE';
  message: string;
}

const STALE_MESSAGE =
  'Bản ghi đã được người khác cập nhật trong lúc bạn đang sửa. Dữ liệu mới nhất sẽ được tải lại — vui lòng kiểm tra và nhập lại thay đổi của bạn.';

/**
 * Trả về đối tượng STALE_WRITE nếu bản ghi đã bị đổi kể từ lúc client tải; null nếu hợp lệ (hoặc client không yêu cầu kiểm).
 * @param current  giá trị `updatedAt` HIỆN TẠI đọc từ DB (Date).
 * @param expected mốc `updatedAt` client giữ lúc mở form (ISO string). Bỏ trống/null/không hợp lệ → bỏ qua kiểm.
 */
export function staleGuard(current: Date | null | undefined, expected?: string | null): StaleWrite | null {
  if (expected == null || expected === '') return null;
  const exp = new Date(expected).getTime();
  if (Number.isNaN(exp)) return null; // mốc rác → coi như không kiểm (tránh chặn nhầm do lỗi format)
  if (current == null) return null; // không có mốc để so → không kiểm
  // So theo mili-giây: DTO gửi toISOString() (mili-giây), Postgres micro-giây → getTime() cắt về mili-giây cả hai phía.
  if (current.getTime() !== exp) {
    return { ok: false, error: 'STALE_WRITE', message: STALE_MESSAGE };
  }
  return null;
}
