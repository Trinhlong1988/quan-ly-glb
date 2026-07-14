// Khối cột "audit trail" DÙNG CHUNG cho MỌI bảng dữ liệu (R5, Mr.Long 11/7): hiển thị đủ
// Người tạo · Ngày tạo · Giờ tạo · Người sửa · Ngày sửa · Giờ sửa. 1 component duy nhất →
// nhãn/format/thứ tự giống hệt mọi trang (R_UI_STANDARD). KHÔNG dùng cho:
//   - bảng NHẬP KHO POS (giữ "Ngày nhập/Giờ nhập" = importedAt, field nghiệp vụ)
//   - bảng NHẬT KÝ/LOG/sự kiện (giữ "Thời gian" = thời điểm sự kiện)
import { fmtDate, fmtTime } from '@glb/shared';

export interface AuditTrailRow {
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
}

/** Số cột khối audit trail (dùng cho colSpan hàng loading/empty). Mr.Long 13/7 BỎ khối "sửa" → chỉ THÔNG TIN TẠO:
 *  đủ giờ = 3 (Người tạo·Ngày tạo·Giờ tạo); chỉ ngày = 2 (Người tạo·Ngày tạo). Truy vết "sửa" còn ở Nhật ký. */
export const AUDIT_TRAIL_COLS = 3;
export const AUDIT_TRAIL_COLS_DATE_ONLY = 2;

/**
 * Ô <th> tiêu đề khối audit trail (đặt trong <tr> của <thead>). Mr.Long 13/7 "bỏ ngày sửa" → chỉ hiện Người tạo ·
 * Ngày tạo (· Giờ tạo nếu !dateOnly). BỎ Người sửa/Ngày sửa/Giờ sửa (lịch sử sửa xem ở Nhật ký hệ thống).
 */
export function AuditTrailHeadCells({ dateOnly }: { dateOnly?: boolean } = {}): JSX.Element {
  return (
    <>
      <th className="px-4 py-3">Người tạo</th>
      <th className="px-4 py-3">Ngày tạo</th>
      {!dateOnly && <th className="px-4 py-3">Giờ tạo</th>}
    </>
  );
}

/** Ô <td> dữ liệu tương ứng (đặt trong <tr> của <tbody>). dateOnly=true → bỏ ô Giờ tạo. */
export function AuditTrailCells({ row, dateOnly }: { row: AuditTrailRow; dateOnly?: boolean }): JSX.Element {
  return (
    <>
      <td className="px-4 py-3 text-slate-600">{row.createdByName ?? '—'}</td>
      <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(row.createdAt)}</td>
      {!dateOnly && <td className="px-4 py-3 text-xs text-slate-500">{fmtTime(row.createdAt)}</td>}
    </>
  );
}
