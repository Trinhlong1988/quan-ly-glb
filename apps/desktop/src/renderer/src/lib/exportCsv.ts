// Xuất Excel đẹp chuẩn GLOBEWAY — file .xls kiểu HTML-table (Excel mở được + có style,
// KHÔNG cần thư viện ngoài). Giữ NGUYÊN chữ ký exportCsv(filename, headers, rows) để mọi
// trang đang gọi không phải đổi; thêm tham số optional `title` ở cuối (default = filename đẹp).
type Cell = string | number | null | undefined;

// Escape an toàn cho HTML (chặn vỡ bảng + XSS khi mở trong Excel/trình duyệt).
function escapeHtml(v: Cell): string {
  const s = v === null || v === undefined ? '' : String(v);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Căn phải cho số (số thuần hoặc chuỗi chỉ gồm chữ số + . , khoảng trắng ( ) - +),
// căn trái cho text. Chuỗi phải chứa ít nhất 1 chữ số mới coi là số.
function isNumericCell(v: Cell): boolean {
  if (typeof v === 'number') return true;
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  return /^[()+\-\d.,\s]+$/.test(s) && /\d/.test(s);
}

// Biến filename kỹ thuật (vd "ngan_hang") thành tiêu đề đẹp ("Ngan hang").
function prettifyTitle(filename: string): string {
  const base = filename.replace(/\.(csv|xls|xlsx)$/i, '').replace(/[_-]+/g, ' ').trim();
  if (!base) return 'Bảng dữ liệu';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function fmtExportDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Dựng chuỗi HTML `<table>` đã style (hàm THUẦN — dễ unit-test):
 * - Font Times New Roman 13px toàn bảng, kẻ ô (border 1px solid).
 * - Hàng tiêu đề nền xanh đậm chữ trắng in đậm.
 * - Hàng dữ liệu xen kẽ xanh nhạt / trắng.
 * - Số căn phải, text căn trái.
 * - 1 dòng tiêu đề trên cùng + 1 dòng ngày xuất.
 */
export function buildExcelHtml(headers: string[], rows: Cell[][], title: string): string {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  const border = 'border:1px solid #9db4c0;';
  const baseFont = "font-family:'Times New Roman',serif;font-size:13px;";

  const headHtml = headers
    .map(
      (h) =>
        `<th style="${border}${baseFont}background:#1f4e79;color:#ffffff;font-weight:bold;text-align:center;padding:5px 8px;">${escapeHtml(h)}</th>`
    )
    .join('');

  const bodyHtml = rows
    .map((r, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#dce6f1';
      const cells = r
        .map((c) => {
          const align = isNumericCell(c) ? 'right' : 'left';
          return `<td style="${border}${baseFont}background:${bg};text-align:${align};padding:4px 8px;">${escapeHtml(c)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const titleRow = `<tr><td colspan="${colCount}" style="${baseFont}font-size:16px;font-weight:bold;color:#1f4e79;padding:8px 4px;text-align:left;">${escapeHtml(title)}</td></tr>`;
  const dateRow = `<tr><td colspan="${colCount}" style="${baseFont}color:#555555;padding:0 4px 8px;text-align:left;">Ngày xuất: ${escapeHtml(fmtExportDate(new Date()))}</td></tr>`;

  return (
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"/><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${escapeHtml(title)}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>` +
    `<body style="${baseFont}">` +
    `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;${baseFont}">` +
    titleRow +
    dateRow +
    `<thead><tr>${headHtml}</tr></thead>` +
    `<tbody>${bodyHtml}</tbody>` +
    `</table></body></html>`
  );
}

/**
 * Xuất bảng ra file Excel (.xls HTML-table đẹp). Giữ NGUYÊN chữ ký cũ; `title` optional.
 * Số tiền/giá trị giữ nguyên như truyền vào (KHÔNG tự format lại).
 */
export function exportCsv(filename: string, headers: string[], rows: Cell[][], title?: string): void {
  const heading = title ?? prettifyTitle(filename);
  const html = '﻿' + buildExcelHtml(headers, rows, heading);
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = /\.xls$/i.test(filename) ? filename : `${filename.replace(/\.(csv|xlsx)$/i, '')}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}
