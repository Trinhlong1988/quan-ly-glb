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

/** Số cột khối audit trail (dùng cho colSpan hàng loading/empty). */
export const AUDIT_TRAIL_COLS = 6;

/** 6 ô <th> tiêu đề (đặt trong <tr> của <thead>). */
export function AuditTrailHeadCells(): JSX.Element {
  return (
    <>
      <th className="px-4 py-3">Người tạo</th>
      <th className="px-4 py-3">Ngày tạo</th>
      <th className="px-4 py-3">Giờ tạo</th>
      <th className="px-4 py-3">Người sửa</th>
      <th className="px-4 py-3">Ngày sửa</th>
      <th className="px-4 py-3">Giờ sửa</th>
    </>
  );
}

/** 6 ô <td> dữ liệu tương ứng (đặt trong <tr> của <tbody>). */
export function AuditTrailCells({ row }: { row: AuditTrailRow }): JSX.Element {
  return (
    <>
      <td className="px-4 py-3 text-slate-600">{row.createdByName ?? '—'}</td>
      <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(row.createdAt)}</td>
      <td className="px-4 py-3 text-xs text-slate-500">{fmtTime(row.createdAt)}</td>
      <td className="px-4 py-3 text-slate-600">{row.updatedByName ?? '—'}</td>
      <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(row.updatedAt)}</td>
      <td className="px-4 py-3 text-xs text-slate-500">{fmtTime(row.updatedAt)}</td>
    </>
  );
}
