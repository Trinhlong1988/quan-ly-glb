import { describe, it, expect } from 'vitest';
// Hàm THUẦN dựng HTML export sống trong renderer lib (không phụ thuộc DOM khi chỉ dựng chuỗi).
// Vitest chỉ quét packages/shared + packages/business-rules nên test đặt ở đây, import chéo.
import { buildExcelHtml } from '../../../apps/desktop/src/renderer/src/lib/exportCsv.js';

describe('buildExcelHtml — Excel xuất đẹp (.xls HTML-table)', () => {
  const headers = ['Mã', 'Tên ngân hàng', 'Số tiền'];
  const rows: (string | number)[][] = [
    ['NH1', 'Ngân hàng Á Châu', 1000],
    ['NH2', 'Vietcombank', 250000]
  ];

  it('sinh ra <table> có <thead>/<tbody>', () => {
    const html = buildExcelHtml(headers, rows, 'Ngân hàng');
    expect(html).toContain('<table');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
  });

  it('dùng font Times New Roman', () => {
    const html = buildExcelHtml(headers, rows, 'Ngân hàng');
    expect(html).toContain("font-family:'Times New Roman'");
  });

  it('kẻ ô bằng border 1px solid', () => {
    const html = buildExcelHtml(headers, rows, 'Ngân hàng');
    expect(html).toContain('border:1px solid');
  });

  it('hàng tiêu đề in đậm (font-weight:bold trong <th>)', () => {
    const html = buildExcelHtml(headers, rows, 'Ngân hàng');
    const th = html.slice(html.indexOf('<th'), html.indexOf('</th>'));
    expect(th).toContain('font-weight:bold');
  });

  it('đúng số hàng dữ liệu (mỗi row = 1 <tr> trong tbody)', () => {
    const html = buildExcelHtml(headers, rows, 'Ngân hàng');
    const tbody = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
    const trCount = (tbody.match(/<tr>/g) ?? []).length;
    expect(trCount).toBe(rows.length);
  });

  it('có đủ ô header (mỗi cột = 1 <th>)', () => {
    const html = buildExcelHtml(headers, rows, 'Ngân hàng');
    const thCount = (html.match(/<th /g) ?? []).length;
    expect(thCount).toBe(headers.length);
  });

  it('hàng xen kẽ (2 màu nền khác nhau cho các dòng liền kề)', () => {
    const html = buildExcelHtml(headers, [['a'], ['b'], ['c']], 'x');
    expect(html).toContain('background:#ffffff');
    expect(html).toContain('background:#dce6f1');
  });

  it('số căn phải, text căn trái', () => {
    const html = buildExcelHtml(['n'], [[123]], 'x');
    expect(html).toContain('text-align:right');
    const html2 = buildExcelHtml(['t'], [['abc']], 'x');
    expect(html2).toContain('text-align:left');
  });

  it('escape ký tự < > & " (chống vỡ bảng / injection)', () => {
    const html = buildExcelHtml(['H'], [['<b>x</b> & "q"']], 'T');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;q&quot;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('giữ tiếng Việt có dấu (UTF-8) trong nội dung', () => {
    const html = buildExcelHtml(['Tên'], [['Nguyễn Văn Đức — Hồ sơ HKD']], 'Hồ sơ');
    expect(html).toContain('Nguyễn Văn Đức — Hồ sơ HKD');
    expect(html).toContain('<meta charset="utf-8"');
  });

  it('có dòng tiêu đề trên cùng + dòng ngày xuất', () => {
    const html = buildExcelHtml(headers, rows, 'Tiêu Đề Đẹp');
    expect(html).toContain('Tiêu Đề Đẹp');
    expect(html).toContain('Ngày xuất:');
  });

  it('KHÔNG tự format lại số (giữ nguyên giá trị truyền vào)', () => {
    const html = buildExcelHtml(['Số tiền'], [[250000]], 'x');
    expect(html).toContain('>250000<');
    expect(html).not.toContain('250,000');
  });
});
