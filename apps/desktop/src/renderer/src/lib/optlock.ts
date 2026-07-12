// R48 Pha 3 #2 — Optimistic lock, phía client (chống 2 người sửa đè).
// Mỗi form Sửa: khi Lưu gửi kèm `expectedUpdatedAt` = mốc updatedAt của bản ghi lúc mở form. Nếu backend trả
// STALE_WRITE nghĩa là đã có người sửa xen giữa → hiển thị cảnh báo + tải lại danh sách để lấy bản mới nhất.

/** Kết quả trả về từ IPC mutation (mirror MutationOutcome). */
export interface MutationLike {
  ok: boolean;
  error?: string;
  message?: string;
}

/** true nếu backend từ chối vì bản ghi đã bị người khác cập nhật (client cần tải lại). */
export function isStaleWrite(res: MutationLike): boolean {
  return res.error === 'STALE_WRITE';
}

/** Tiêu đề dialog dùng chung khi gặp xung đột sửa đè. */
export const STALE_TITLE = 'Dữ liệu đã thay đổi';
