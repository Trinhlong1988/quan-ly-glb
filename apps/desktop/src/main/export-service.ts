// XUẤT EXCEL CHUẨN NHÀ GLOBEWAY (R38/R39 Mr.Long 11/7) — .xlsx THẬT bằng exceljs (KHÔNG còn .xls-HTML giả
// gây cảnh báo Yes/No khi mở). Tông màu khớp renmap/quản-lý-tài-khoản: tiêu đề xanh #2E75B6 chữ trắng, hàng
// tổng hợp vàng kem, tên cột IN HOA nền xanh nhạt + LỌC (autofilter) + đóng băng, kẻ ô mảnh, dòng lẻ xám nhạt,
// Times New Roman 11pt. Trang A4 DỌC, fit-to-width 1 trang. Dùng cho cả bảng dữ liệu lẫn MẪU nhập (headers-only).
import ExcelJS from 'exceljs';

const FONT = 'Times New Roman';
const C_TITLE = 'FF2E75B6';
const C_SUMMARY = 'FFFFF2CC';
const C_HEADER = 'FFBDD7EE';
const C_ZEBRA = 'FFF5F7FA';
const THIN = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

export type Cell = string | number | null | undefined;
export interface ReportInput {
  title: string; // tiêu đề (sẽ IN HOA)
  headers: string[]; // nhãn cột (sẽ IN HOA)
  rows: Cell[][];
  summary?: string; // dòng tổng hợp; nếu bỏ trống tự sinh "Tổng: N dòng • Ngày xuất: dd/mm/yyyy"
}
export interface TemplateInput {
  title: string;
  headers: string[];
  hints?: { header: string; required?: boolean; hint?: string }[]; // để dựng sheet "Hướng dẫn"
}

function fmtVNDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
// Số thuần / chuỗi chỉ gồm số + phân cách → căn phải; còn lại căn trái.
function isNumericCell(v: Cell): boolean {
  if (typeof v === 'number') return true;
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return !!s && /^[()+\-\d.,\s]+$/.test(s) && /\d/.test(s);
}
function pageSetup(): ExcelJS.Worksheet['pageSetup'] {
  return { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
}
function colWidths(headers: string[], rows: Cell[][]): number[] {
  return headers.map((h, i) => {
    let max = h.length;
    for (const r of rows) {
      const v = r[i];
      const len = v == null ? 0 : String(v).length;
      if (len > max) max = len;
    }
    return Math.min(42, Math.max(6, max + 2));
  });
}

/** Dựng bảng dữ liệu chuẩn nhà → Buffer .xlsx. */
export async function buildReportWorkbook(input: ReportInput): Promise<Buffer> {
  const headers = input.headers.map((h) => h.toUpperCase());
  const N = Math.max(1, headers.length);
  const lastCol = numToCol(N);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dữ liệu', { views: [{ state: 'frozen', ySplit: 3 }], pageSetup: pageSetup() });
  const widths = colWidths(input.headers, input.rows);
  ws.columns = widths.map((w) => ({ width: w }));

  // Hàng 1 — TIÊU ĐỀ
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell('A1');
  t.value = input.title.toUpperCase();
  t.font = { name: FONT, size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  t.alignment = { vertical: 'middle', horizontal: 'center' };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_TITLE } };
  ws.getRow(1).height = 30;

  // Hàng 2 — TỔNG HỢP
  ws.mergeCells(`A2:${lastCol}2`);
  const s = ws.getCell('A2');
  s.value = input.summary ?? `Tổng: ${input.rows.length} dòng   •   Ngày xuất: ${fmtVNDate(new Date())}`;
  s.font = { name: FONT, size: 11.5, bold: true, color: { argb: 'FF7F6000' } };
  s.alignment = { vertical: 'middle', horizontal: 'center' };
  s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_SUMMARY } };
  ws.getRow(2).height = 22;

  // Hàng 3 — TÊN CỘT (IN HOA)
  const hr = ws.getRow(3);
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { name: FONT, size: 11, bold: true };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_HEADER } };
    c.border = BORDER;
  });
  hr.height = 26;

  // Dữ liệu (dòng lẻ nền xám nhạt)
  input.rows.forEach((r, ri) => {
    const row = ws.getRow(4 + ri);
    for (let ci = 0; ci < N; ci++) {
      const c = row.getCell(ci + 1);
      const v = r[ci] ?? '';
      c.value = v;
      c.font = { name: FONT, size: 11 };
      c.alignment = { vertical: 'middle', horizontal: isNumericCell(v) ? 'right' : 'left', wrapText: !isNumericCell(v) };
      c.border = BORDER;
      if (ri % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_ZEBRA } };
    }
    row.height = 20;
  });

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + input.rows.length, column: N } };
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

/** Dựng MẪU nhập → Buffer .xlsx. Sheet 1 "Mẫu nhập" CHỈ có 1 dòng header (row 1) để parse round-trip;
 *  sheet 2 "Hướng dẫn" liệt kê cột + bắt buộc + gợi ý. */
export async function buildTemplateWorkbook(input: TemplateInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Mẫu nhập', { views: [{ state: 'frozen', ySplit: 1 }], pageSetup: pageSetup() });
  ws.columns = input.headers.map((h) => ({ width: Math.min(40, Math.max(14, h.length + 4)) }));
  const hr = ws.getRow(1);
  input.headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h; // GIỮ NGUYÊN nhãn (không IN HOA) để khớp header khi nhập lại
    c.font = { name: FONT, size: 11, bold: true };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_HEADER } };
    c.border = BORDER;
  });
  hr.height = 26;

  if (input.hints && input.hints.length) {
    const gd = wb.addWorksheet('Hướng dẫn');
    gd.columns = [{ width: 28 }, { width: 12 }, { width: 60 }];
    const h0 = gd.getRow(1);
    ['CỘT', 'BẮT BUỘC', 'GỢI Ý'].forEach((h, i) => {
      const c = h0.getCell(i + 1);
      c.value = h;
      c.font = { name: FONT, size: 11, bold: true };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_HEADER } };
      c.border = BORDER;
    });
    input.hints.forEach((hint, ri) => {
      const row = gd.getRow(2 + ri);
      [hint.header, hint.required ? 'Có' : '', hint.hint ?? ''].forEach((v, ci) => {
        const c = row.getCell(ci + 1);
        c.value = v;
        c.font = { name: FONT, size: 11 };
        c.alignment = { vertical: 'middle', horizontal: ci === 1 ? 'center' : 'left', wrapText: true };
        c.border = BORDER;
      });
    });
  }
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

function numToCol(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
