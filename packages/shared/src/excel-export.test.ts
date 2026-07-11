import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
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

  it('số căn phải, chữ căn trái', async () => {
    const wb = await load(await buildReportWorkbook({ title: 'x', headers, rows }));
    const ws = wb.getWorksheet('Dữ liệu')!;
    expect(ws.getCell('C4').alignment?.horizontal).toBe('right'); // 1000
    expect(ws.getCell('B4').alignment?.horizontal).toBe('left'); // tên
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
