// XUẤT EXCEL CHUẨN NHÀ GLOBEWAY (R38/R39 Mr.Long 11/7) — .xlsx THẬT bằng exceljs (KHÔNG còn .xls-HTML giả
// gây cảnh báo Yes/No khi mở). Tông màu khớp renmap/quản-lý-tài-khoản: tiêu đề xanh #2E75B6 chữ trắng, hàng
// tổng hợp vàng kem, tên cột IN HOA nền xanh nhạt + LỌC (autofilter) + đóng băng, kẻ ô mảnh, dòng lẻ xám nhạt,
// Times New Roman 11pt. Trang A4 DỌC, fit-to-width 1 trang. Dùng cho cả bảng dữ liệu lẫn MẪU nhập (headers-only).
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

type Align = 'left' | 'center' | 'right';
// Chuỗi trông như TIỀN: TOÀN BỘ là số + phân tách + (tùy chọn) ký hiệu tiền ở cuối, VÀ có phân tách nghìn
// hoặc ký hiệu tiền. CẨN THẬN: "đ" là CHỮ CÁI tiếng Việt phổ biến ("Đang hoạt động", "đối tác") → KHÔNG
// được coi mọi chuỗi chứa "đ" là tiền; phải neo ký hiệu tiền ở CUỐI sau chuỗi số. Cũng loại SĐT/mã số thuần.
function isMoneyString(v: Cell): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!/\d/.test(s)) return false;
  if (!/^[\d.,\s]+(\s?(₫|đ|VND))?$/i.test(s)) return false; // toàn số/phân tách, tiền chỉ ở cuối
  return /\d[.,]\d{3}(\D|$)/.test(s) || /(₫|đ|VND)\s*$/i.test(s); // có phân tách nghìn hoặc ký hiệu tiền
}
// Căn cột THEO KIỂU dữ liệu (R44 + "số tiền căn phải", Mr.Long):
//   • TIỀN/số lớn (number ≥1000, số lẻ, hoặc chuỗi tiền có phân tách) → PHẢI;
//   • STT/đếm nhỏ (số nguyên <1000) → GIỮA;
//   • mã/SĐT/trạng thái/ngày (chuỗi ngắn ≤16) → GIỮA;  • tên/địa chỉ (dài >16) → TRÁI.
function colAligns(rows: Cell[][], N: number): Align[] {
  const aligns: Align[] = [];
  for (let ci = 0; ci < N; ci++) {
    let has = false, maxLen = 0, allRightable = true, allSmallInt = true;
    for (const r of rows) {
      const v = r[ci];
      if (v == null || v === '') continue;
      has = true;
      maxLen = Math.max(maxLen, String(v).length);
      const isNum = typeof v === 'number';
      const money = isMoneyString(v);
      if (!isNum && !money) allRightable = false;
      if (money) allSmallInt = false;
      else if (isNum) { if (!Number.isInteger(v) || Math.abs(v) >= 1000) allSmallInt = false; }
      else allSmallInt = false;
    }
    if (!has) aligns.push('center');
    else if (allRightable && !allSmallInt) aligns.push('right'); // TIỀN / số lớn
    else if (allRightable && allSmallInt) aligns.push('center'); // STT / đếm nhỏ
    else if (maxLen > 16) aligns.push('left'); // tên/địa chỉ dài
    else aligns.push('center'); // mã/SĐT/trạng thái/ngày
  }
  return aligns;
}

// R43: chặn "chấm vàng/tam giác — Number stored as text" khi ô là chuỗi số (SĐT/mã/MST giữ nguyên text).
// exceljs không expose ignoredErrors → chèn thẳng vào sheet XML (đúng vị trí schema: trước </worksheet>).
async function suppressNumberAsTextWarning(buf: Buffer, sqref: string): Promise<Buffer> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const path = 'xl/worksheets/sheet1.xml';
    const file = zip.file(path);
    if (!file) return buf;
    let xml = await file.async('string');
    if (!xml.includes('<ignoredErrors>')) {
      const tag = `<ignoredErrors><ignoredError sqref="${sqref}" numberStoredAsText="1"/></ignoredErrors>`;
      xml = xml.replace('</worksheet>', tag + '</worksheet>');
      zip.file(path, xml);
    }
    return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
  } catch {
    return buf; // an toàn: lỗi hậu xử lý không làm hỏng file
  }
}

const FONT = 'Times New Roman';
const C_TITLE = 'FF2E75B6';
const C_SUMMARY = 'FFFFF2CC';
const C_HEADER = 'FFBDD7EE';
const C_ZEBRA = 'FFDEEBF7'; // Mr.Long 13/7 "mỗi hàng 1 màu xanh và trắng" — xanh nhạt rõ (trước là xám gần trắng)
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
// Số dòng 1 ô văn bản CHIẾM khi wrap ở độ rộng cột `width` (ước theo ký tự — đủ để KHÔNG che chữ).
function wrapLines(text: string, width: number): number {
  const w = Math.max(4, Math.floor(width) - 1);
  let lines = 0;
  for (const seg of String(text).split('\n')) lines += Math.max(1, Math.ceil(seg.length / w));
  return lines;
}
// Chiều cao hàng đủ chứa ô wrap NHIỀU DÒNG NHẤT (11pt ≈ 15pt/dòng). base = tối thiểu.
function rowHeightFor(values: (Cell | string)[], widths: number[], base: number): number {
  let maxLines = 1;
  values.forEach((v, i) => {
    if (v == null || v === '') return;
    const lines = wrapLines(String(v), widths[i] ?? 12);
    if (lines > maxLines) maxLines = lines;
  });
  return Math.max(base, maxLines * 18 + 6); // 13pt ≈ 18pt/dòng
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
  s.font = { name: FONT, size: 13, bold: true, color: { argb: 'FF7F6000' } };
  s.alignment = { vertical: 'middle', horizontal: 'center' };
  s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_SUMMARY } };
  ws.getRow(2).height = 24;

  // Hàng 3 — TÊN CỘT (IN HOA)
  const hr = ws.getRow(3);
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { name: FONT, size: 13, bold: true };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_HEADER } };
    c.border = BORDER;
  });
  hr.height = rowHeightFor(headers, widths, 26); // đủ cao nếu tên cột wrap 2 dòng

  // Dữ liệu (dòng lẻ nền xám nhạt) — căn theo cột (R44), CHIỀU CAO TỰ TÍNH theo cột wrap (trái) → KHÔNG che chữ.
  const aligns = colAligns(input.rows, N);
  input.rows.forEach((r, ri) => {
    const row = ws.getRow(4 + ri);
    // Chỉ cột căn trái (tên/địa chỉ dài) mới wrap → tính chiều cao theo các cột đó.
    const wrapVals: (Cell)[] = [];
    for (let ci = 0; ci < N; ci++) {
      const c = row.getCell(ci + 1);
      const v = r[ci] ?? '';
      const wrap = aligns[ci] === 'left';
      c.value = v;
      c.font = { name: FONT, size: 13 };
      c.alignment = { vertical: 'middle', horizontal: aligns[ci], wrapText: wrap };
      c.border = BORDER;
      if (ri % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_ZEBRA } };
      wrapVals.push(wrap ? v : '');
    }
    row.height = rowHeightFor(wrapVals, widths, 20);
  });

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + input.rows.length, column: N } };
  const buf = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  // R43: bỏ cảnh báo "số lưu dạng text" cho toàn vùng dữ liệu (SĐT/mã/MST là text có chủ đích).
  return input.rows.length > 0 ? suppressNumberAsTextWarning(buf, `A4:${lastCol}${3 + input.rows.length}`) : buf;
}

/** Dựng MẪU nhập → Buffer .xlsx. Sheet 1 "Mẫu nhập" CHỈ có 1 dòng header (row 1) để parse round-trip;
 *  sheet 2 "Hướng dẫn" liệt kê cột + bắt buộc + gợi ý. */
export async function buildTemplateWorkbook(input: TemplateInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Mẫu nhập', { views: [{ state: 'frozen', ySplit: 1 }], pageSetup: pageSetup() });
  const twidths = input.headers.map((h) => Math.min(40, Math.max(14, h.length + 4)));
  ws.columns = twidths.map((w) => ({ width: w }));
  const hr = ws.getRow(1);
  input.headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h; // GIỮ NGUYÊN nhãn (không IN HOA) để khớp header khi nhập lại
    c.font = { name: FONT, size: 13, bold: true };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_HEADER } };
    c.border = BORDER;
  });
  hr.height = rowHeightFor(input.headers, twidths, 26);

  if (input.hints && input.hints.length) {
    const gd = wb.addWorksheet('Hướng dẫn');
    gd.columns = [{ width: 28 }, { width: 12 }, { width: 60 }];
    const h0 = gd.getRow(1);
    ['CỘT', 'BẮT BUỘC', 'GỢI Ý'].forEach((h, i) => {
      const c = h0.getCell(i + 1);
      c.value = h;
      c.font = { name: FONT, size: 13, bold: true };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_HEADER } };
      c.border = BORDER;
    });
    input.hints.forEach((hint, ri) => {
      const row = gd.getRow(2 + ri);
      [hint.header, hint.required ? 'Có' : '', hint.hint ?? ''].forEach((v, ci) => {
        const c = row.getCell(ci + 1);
        c.value = v;
        c.font = { name: FONT, size: 13 };
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
