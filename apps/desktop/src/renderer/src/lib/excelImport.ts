// PHASE IMPORT (#9) — FE helper Excel (renderer). Dùng SheetJS (xlsx) để (a) sinh MẪU rỗng .xlsx
// (1 dòng header, cột giãn rộng, cố gắng freeze dòng 1) + (b) đọc file người dùng điền → mảng object
// theo header. Parse PHÒNG THỦ: file lỗi / sheet rỗng / thiếu header → trả lỗi rõ, KHÔNG ném.
// Lưu ý: SheetJS community KHÔNG ghi style ô (in đậm) — header đậm là best-effort; freeze qua '!freeze'
// (writer bỏ qua nếu không hỗ trợ, không gây lỗi).
import * as XLSX from 'xlsx';
import type { ImportTemplateColumn } from '../../../preload/index.d';

// Trần số dòng/mẻ (khớp backend MAX_IMPORT_ROWS) — chặn sớm ở renderer trước khi gửi IPC (FIX 3).
export const MAX_IMPORT_ROWS = 2000;

// LƯU Ý ĐỊNH DẠNG NGÀY (FIX 4): người dùng nên gõ ngày dạng CHỮ 'dd/mm/yyyy' trong Excel. Nếu ô là kiểu
// Date thực của Excel, cách hiển thị phụ thuộc locale (US m/d/y vs VN d/m/y) → dễ lệch. parseWorkbook đọc
// raw:false (Excel tự format chuỗi theo ô); backend parse yyyy-mm-dd / ISO / dd/mm/yyyy. Gõ chữ = chắc ăn.
export interface ParseResult {
  ok: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
}

/** Tải file .xlsx MẪU rỗng: 1 dòng header đúng nhãn cột. `filename` không cần đuôi. */
export function downloadTemplate(columns: ImportTemplateColumn[], filename: string): void {
  const headers = columns.map((c) => c.header);
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  // Giãn rộng cột cho dễ nhập (đủ chứa header + gợi ý).
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(14, c.header.length + 4) }));
  // Freeze dòng tiêu đề (best-effort — writer bỏ qua nếu không hỗ trợ).
  (ws as unknown as Record<string, unknown>)['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mẫu nhập');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = /\.xlsx$/i.test(filename) ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Đọc file Excel người dùng chọn → mảng object theo header (sheet ĐẦU). Phòng thủ mọi lỗi. */
export async function parseWorkbook(file: File): Promise<ParseResult> {
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { ok: false, error: 'File không có trang tính (sheet) nào.' };
    const ws = wb.Sheets[sheetName];
    if (!ws) return { ok: false, error: 'Không đọc được trang tính đầu tiên.' };
    // defval='' để cột trống vẫn có khóa; raw=false để ngày/số format thành chuỗi (backend tự parse).
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: 'File không có dòng dữ liệu nào (chỉ có tiêu đề?).' };
    if (rows.length > MAX_IMPORT_ROWS) return { ok: false, error: `Vượt giới hạn ${MAX_IMPORT_ROWS} dòng/mẻ — chia nhỏ file.` };
    // Chuẩn hóa key: trim khoảng trắng ở tên cột (Excel hay thêm space) để khớp header mẫu.
    const cleaned = rows.map((r) => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) o[String(k).trim()] = v;
      return o;
    });
    return { ok: true, rows: cleaned };
  } catch (e) {
    return { ok: false, error: 'Không đọc được file Excel (định dạng lạ hoặc file hỏng): ' + (e instanceof Error ? e.message : String(e)) };
  }
}
