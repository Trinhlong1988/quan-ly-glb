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

/** Số cột khối audit trail (dùng cho colSpan hàng loading/empty). Đủ giờ = 6; chỉ ngày = 4. */
export const AUDIT_TRAIL_COLS = 6;
export const AUDIT_TRAIL_COLS_DATE_ONLY = 4;

/**
 * Ô <th> tiêu đề khối audit trail (đặt trong <tr> của <thead>).
 * dateOnly=true → chỉ Người tạo · Ngày tạo · Người sửa · Ngày sửa (bỏ Giờ) — dùng cho menu Cấu hình ngân hàng
 * (R18, Mr.Long 11/7: bảng chỉ cần Ngày; giờ chi tiết vẫn còn ở Nhật ký/lịch sử truy vết).
 */
export function AuditTrailHeadCells({ dateOnly }: { dateOnly?: boolean } = {}): JSX.Element {
  return (
    <>
      <th className="px-4 py-3">Người tạo</th>
      <th className="px-4 py-3">Ngày tạo</th>
      {!dateOnly && <th className="px-4 py-3">Giờ tạo</th>}
      <th className="px-4 py-3">Người sửa</th>
      <th className="px-4 py-3">Ngày sửa</th>
      {!dateOnly && <th className="px-4 py-3">Giờ sửa</th>}
    </>
  );
}

/** Ô <td> dữ liệu tương ứng (đặt trong <tr> của <tbody>). dateOnly=true → bỏ 2 ô Giờ. */
export function AuditTrailCells({ row, dateOnly }: { row: AuditTrailRow; dateOnly?: boolean }): JSX.Element {
  return (
    <>
      <td className="px-4 py-3 text-slate-600">{row.createdByName ?? '—'}</td>
      <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(row.createdAt)}</td>
      {!dateOnly && <td className="px-4 py-3 text-xs text-slate-500">{fmtTime(row.createdAt)}</td>}
      <td className="px-4 py-3 text-slate-600">{row.updatedByName ?? '—'}</td>
      <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(row.updatedAt)}</td>
      {!dateOnly && <td className="px-4 py-3 text-xs text-slate-500">{fmtTime(row.updatedAt)}</td>}
    </>
  );
}
