import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
// R38/R39 — Xuất Excel .xlsx THẬT chuẩn nhà GLOBEWAY (thay .xls-HTML giả). Builder thuần ở main/export-service.
// Vitest chỉ quét packages/* nên test đặt ở đây, import chéo sang apps/desktop.
import { buildReportWorkbook, buildTemplateWorkbook } from '../../../apps/desktop/src/main/export-service.js';

async function load(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

describe('buildReportWorkbook — bảng dữ liệu chuẩn nhà', () => {
  const headers = ['Mã', 'Tên ngân hàng', 'Số tiền'];
  const rows: (string | number)[][] = [
    ['NH1', 'Ngân hàng Á Châu', 1000],
    ['NH2', 'Vietcombank', 250000]
  ];

  it('IN HOA tiêu đề + tên cột', async () => {
    const wb = await load(await buildReportWorkbook({ title: 'Danh sách ngân hàng', headers, rows }));
    const ws = wb.getWorksheet('Dữ liệu')!;
    expect(ws.getCell('A1').value).toBe('DANH SÁCH NGÂN HÀNG');
    expect(ws.getCell('A3').value).toBe('MÃ');
    expect(ws.getCell('B3').value).toBe('TÊN NGÂN HÀNG');
  });

  it('trang A4 DỌC + fit 1 trang ngang', async () => {
    const wb = await load(await buildReportWorkbook({ title: 'x', headers, rows }));
    const ws = wb.getWorksheet('Dữ liệu')!;
    expect(ws.pageSetup.orientation).toBe('portrait');
    expect(ws.pageSetup.fitToWidth).toBe(1);
    expect(ws.pageSetup.paperSize).toBe(9); // A4
  });

  it('có LỌC (autofilter) + đóng băng hàng tiêu đề', async () => {
    const wb = await load(await buildReportWorkbook({ title: 'x', headers, rows }));
    const ws = wb.getWorksheet('Dữ liệu')!;
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.views[0]?.state).toBe('frozen');
    expect((ws.views[0] as { ySplit?: number }).ySplit).toBe(3);
  });

  it('font chữ chuẩn 13 (tên cột + dữ liệu)', async () => {
    const wb = await load(await buildReportWorkbook({ title: 'x', headers, rows }));
    const ws = wb.getWorksheet('Dữ liệu')!;
    expect(ws.getCell('A3').font?.size).toBe(13); // tên cột
    expect(ws.getCell('A4').font?.size).toBe(13); // dữ liệu
  });

  it('cột số (number) căn phải', async () => {
    const wb = await load(await buildReportWorkbook({ title: 'x', headers, rows }));
    const ws = wb.getWorksheet('Dữ liệu')!;
    expect(ws.getCell('C4').alignment?.horizontal).toBe('right'); // 1000 (number) — chi tiết căn ở test R44
  });

  it('dòng tổng hợp tự sinh khi không truyền', async () => {
    const wb = await load(await buildReportWorkbook({ title: 'x', headers, rows }));
    const ws = wb.getWorksheet('Dữ liệu')!;
    expect(String(ws.getCell('A2').value)).toContain('Tổng: 2 dòng');
  });

  it('không dòng dữ liệu vẫn xuất được', async () => {
    const wb = await load(await buildReportWorkbook({ title: 'Rỗng', headers, rows: [] }));
    expect(wb.getWorksheet('Dữ liệu')).toBeTruthy();
  });

  it('căn cột theo kiểu: tiền phải · mã/SĐT ngắn giữa · tên dài trái (R44)', async () => {
    const wb = await load(await buildReportWorkbook({
      title: 'x',
      headers: ['Mã', 'Số điện thoại', 'Tên khách hàng', 'Số tiền'],
      rows: [['KH01', '0901234567', 'Nguyễn Văn A ở địa chỉ dài hơn mười sáu ký tự', 5000], ['KH02', '0912345678', 'B', 6000]]
    }));
    const ws = wb.getWorksheet('Dữ liệu')!;
    expect(ws.getCell('A4').alignment?.horizontal).toBe('center'); // mã ngắn
    expect(ws.getCell('B4').alignment?.horizontal).toBe('center'); // SĐT (chuỗi số ngắn)
    expect(ws.getCell('C4').alignment?.horizontal).toBe('left'); // tên dài
    expect(ws.getCell('D4').alignment?.horizontal).toBe('right'); // tiền (number)
  });

  it('tiền dạng CHUỖI có phân tách nghìn → PHẢI; STT nhỏ → GIỮA (R44 tiền)', async () => {
    const wb = await load(await buildReportWorkbook({ title: 'x', headers: ['STT', 'Số tiền'], rows: [[1, '1.000.000'], [2, '2.500.000']] }));
    const ws = wb.getWorksheet('Dữ liệu')!;
    expect(ws.getCell('A4').alignment?.horizontal).toBe('center'); // STT nguyên nhỏ
    expect(ws.getCell('B4').alignment?.horizontal).toBe('right'); // tiền dạng chuỗi
  });

  it('trạng thái chứa chữ "đ" ("Đang hoạt động") KHÔNG bị nhầm là tiền → GIỮA, không phải phải (B33)', async () => {
    const wb = await load(await buildReportWorkbook({ title: 'x', headers: ['Trạng thái', 'Ghi chú'], rows: [['Đang hoạt động', 'đối tác lâu năm'], ['Đã khóa', 'động lực']] }));
    const ws = wb.getWorksheet('Dữ liệu')!;
    expect(ws.getCell('A4').alignment?.horizontal).toBe('center'); // KHÔNG right
  });

  it('bỏ cảnh báo "số lưu dạng text" (chấm vàng) trên vùng dữ liệu (R43)', async () => {
    const buf = await buildReportWorkbook({ title: 'x', headers: ['SĐT'], rows: [['0901234567'], ['0912345678']] });
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain('numberStoredAsText="1"');
  });

  it('tên dài wrap 2 dòng → hàng CAO HƠN, không che chữ (B32)', async () => {
    const longName = 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam'; // 44 ký tự, cột "Tên ngân hàng" ~30
    const wb = await load(await buildReportWorkbook({ title: 'x', headers, rows: [['NH1', longName, 1000], ['NH2', 'ACB', 2000]] }));
    const ws = wb.getWorksheet('Dữ liệu')!;
    const tall = ws.getRow(4).height ?? 0; // dòng tên dài
    const shortRow = ws.getRow(5).height ?? 0; // dòng tên ngắn
    expect(tall).toBeGreaterThan(20); // KHÔNG còn kẹt 20 (che dòng 2)
    expect(tall).toBeGreaterThan(shortRow); // cao hơn dòng ngắn
  });
});

describe('buildTemplateWorkbook — mẫu nhập', () => {
  const headers = ['Mã', 'Tên', 'Ngân hàng'];
  const hints = [{ header: 'Mã', required: true, hint: 'Tối đa 20 ký tự' }];

  it('sheet Mẫu nhập GIỮ nhãn cột gốc ở dòng 1 (để nhập lại khớp)', async () => {
    const wb = await load(await buildTemplateWorkbook({ title: 'Mẫu nhập ngân hàng', headers, hints }));
    const ws = wb.getWorksheet('Mẫu nhập')!;
    expect(ws.getCell('A1').value).toBe('Mã'); // KHÔNG in hoa — khớp header khi import lại
    expect(ws.getCell('B1').value).toBe('Tên');
  });

  it('có sheet Hướng dẫn khi truyền hints', async () => {
    const wb = await load(await buildTemplateWorkbook({ title: 'x', headers, hints }));
    expect(wb.getWorksheet('Hướng dẫn')).toBeTruthy();
  });
});
