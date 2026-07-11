// PHASE IMPORT (#9) — FE helper Excel (renderer). Dùng SheetJS (xlsx) để (a) sinh MẪU rỗng .xlsx
// (1 dòng header, cột giãn rộng, cố gắng freeze dòng 1) + (b) đọc file người dùng điền → mảng object
// theo header. Parse PHÒNG THỦ: file lỗi / sheet rỗng / thiếu header → trả lỗi rõ, KHÔNG ném.
// Lưu ý: SheetJS community KHÔNG ghi style ô (in đậm) — header đậm là best-effort; freeze qua '!freeze'
// (writer bỏ qua nếu không hỗ trợ, không gây lỗi).
import * as XLSX from 'xlsx';
import type { ImportTemplateColumn } from '../../../preload/index.d';
import { getDialogBridge } from './dialogBridge.js';

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

/**
 * Tải file .xlsx MẪU nhập chuẩn nhà (R38): sheet "Mẫu nhập" chỉ 1 dòng header (để nhập lại khớp cột) +
 * sheet "Hướng dẫn" (cột/bắt buộc/gợi ý). Đi qua IPC → LƯU qua hộp thoại HĐH → hỏi "Mở / Không mở".
 * `fileBase` = tên tiếng Việt, ví dụ "Mẫu nhập khách hàng".
 */
export async function downloadTemplate(columns: ImportTemplateColumn[], fileBase: string): Promise<void> {
  const dlg = getDialogBridge();
  const headers = columns.map((c) => c.header);
  const hints = columns.map((c) => ({ header: c.header, required: c.required, hint: c.hint }));
  const d = new Date();
  const fileName = `${fileBase} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}.xlsx`;
  let res;
  try {
    res = await window.api.reportExport({ kind: 'template', fileBase, fileName, title: fileBase, headers, hints });
  } catch (e) {
    return dlg.alert('Không tạo được file mẫu: ' + (e instanceof Error ? e.message : String(e)), 'Lỗi tải mẫu');
  }
  if (!res.ok) return dlg.alert(res.message ?? 'Không tạo được file mẫu.', 'Lỗi tải mẫu');
  if (res.canceled || !res.path) return;
  const open = await dlg.confirm(`Đã lưu file mẫu tại:\n${res.path}\n\nMở để điền ngay?`, { title: 'Đã tải mẫu nhập', okLabel: 'Mở file', cancelLabel: 'Không mở' });
  if (open) {
    const o = await window.api.openFilePath(res.path);
    if (!o.ok) dlg.alert(o.message ?? 'Không mở được file.', 'Không mở được file');
  }
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
