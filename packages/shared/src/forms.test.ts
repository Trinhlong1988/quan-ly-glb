import { describe, it, expect } from 'vitest';
import {
  onlyDigits,
  groupDigits,
  parseVndInput,
  parsePartialDate,
  splitIsoDate,
  missingPrereqs,
  prereqMessage,
  type PrereqDef
} from './forms.js';

describe('groupDigits / parseVndInput (tiền VND)', () => {
  it('nhóm 3 chữ số kiểu VN', () => {
    expect(groupDigits('5000000')).toBe('5.000.000');
    expect(groupDigits('1000')).toBe('1.000');
    expect(groupDigits('999')).toBe('999');
    expect(groupDigits('1234567890')).toBe('1.234.567.890');
  });
  it('rỗng là hợp lệ → chuỗi rỗng', () => {
    expect(groupDigits('')).toBe('');
    expect(parseVndInput('')).toBeNull();
  });
  it('loại ký tự lạ trước khi nhóm/parse', () => {
    expect(groupDigits('5.000.000')).toBe('5.000.000');
    expect(groupDigits('abc12ab345')).toBe('12.345');
    expect(groupDigits('5 000 000đ')).toBe('5.000.000');
    expect(parseVndInput('5.000.000 ₫')).toBe(5000000);
    expect(parseVndInput('abc')).toBeNull();
  });
  it('bỏ số 0 dẫn đầu nhưng giữ 0 đơn lẻ', () => {
    expect(groupDigits('007')).toBe('7');
    expect(groupDigits('0')).toBe('0');
    expect(parseVndInput('007')).toBe(7);
  });
  it('onlyDigits chỉ giữ chữ số', () => {
    expect(onlyDigits('a1b2c3')).toBe('123');
    expect(onlyDigits('')).toBe('');
  });
});

describe('parsePartialDate (ngày tách phần dd/mm/yyyy)', () => {
  it('gõ mỗi ngày "15" — KHÔNG mất, KHÔNG báo lỗi (đang gõ dở)', () => {
    const r = parsePartialDate('15', '', '');
    expect(r.value).toBeNull();
    expect(r.error).toBeNull();
  });
  it('trống hoàn toàn → chưa nhập, không lỗi', () => {
    expect(parsePartialDate('', '', '')).toEqual({ value: null, error: null });
  });
  it('năm chưa đủ 4 chữ số → đang gõ dở, không lỗi', () => {
    expect(parsePartialDate('15', '3', '202')).toEqual({ value: null, error: null });
  });
  it('đủ 3 phần hợp lệ → yyyy-mm-dd (pad 0)', () => {
    expect(parsePartialDate('5', '1', '2026').value).toBe('2026-01-05');
    expect(parsePartialDate('15', '03', '2026').value).toBe('2026-03-15');
    expect(parsePartialDate('31', '12', '2026').value).toBe('2026-12-31');
  });
  it('tháng không hợp lệ báo lỗi', () => {
    const r = parsePartialDate('10', '13', '2026');
    expect(r.value).toBeNull();
    expect(r.error).toMatch(/Tháng/);
  });
  it('ngày vượt số ngày của tháng báo lỗi', () => {
    const r = parsePartialDate('30', '2', '2026'); // 2026 không nhuận
    expect(r.value).toBeNull();
    expect(r.error).toMatch(/ngày/);
  });
  it('ngày 29/2 năm nhuận hợp lệ', () => {
    expect(parsePartialDate('29', '2', '2024').value).toBe('2024-02-29');
  });
  it('loại ký tự lạ khỏi từng phần', () => {
    expect(parsePartialDate('1a5', '0b3', '2026').value).toBe('2026-03-15');
  });
});

describe('splitIsoDate', () => {
  it('tách yyyy-mm-dd, bỏ 0 dẫn đầu ngày/tháng', () => {
    expect(splitIsoDate('2026-03-05')).toEqual({ d: '5', m: '3', y: '2026' });
  });
  it('rỗng/null → 3 phần rỗng', () => {
    expect(splitIsoDate('')).toEqual({ d: '', m: '', y: '' });
    expect(splitIsoDate(null)).toEqual({ d: '', m: '', y: '' });
  });
  it('nhận cả ISO datetime (cắt 10 ký tự đầu)', () => {
    expect(splitIsoDate('2026-12-31T00:00:00.000Z')).toEqual({ d: '31', m: '12', y: '2026' });
  });
});

describe('missingPrereqs / prereqMessage (gate dữ liệu nền động)', () => {
  const defs = (models: number, suppliers: number, statuses: number): PrereqDef[] => [
    { count: models, label: 'Chủng loại máy', where: "tab 'Chủng loại POS'" },
    { count: suppliers, label: 'Nhà cung cấp', where: "tab 'Nhà cung cấp'" },
    { count: statuses, label: 'Trạng thái nhập máy', where: "tab 'Trạng thái nhập'" }
  ];
  it('đủ tiền đề → không thiếu, message null', () => {
    expect(missingPrereqs(defs(1, 1, 1))).toHaveLength(0);
    expect(prereqMessage(defs(2, 3, 4))).toBeNull();
  });
  it('chỉ thiếu 1 loại → nêu đúng loại đó + nơi tạo', () => {
    const miss = missingPrereqs(defs(2, 3, 0));
    expect(miss).toHaveLength(1);
    expect(miss[0].label).toBe('Trạng thái nhập máy');
    const msg = prereqMessage(defs(2, 3, 0))!;
    expect(msg).toContain('Trạng thái nhập máy');
    expect(msg).toContain("tab 'Trạng thái nhập'");
    expect(msg).not.toContain('Nhà cung cấp');
    expect(msg).not.toContain('Chủng loại máy');
  });
  it('thiếu nhiều loại → liệt kê đúng những loại thiếu', () => {
    const msg = prereqMessage(defs(0, 0, 1))!;
    expect(msg).toContain('Chủng loại máy');
    expect(msg).toContain('Nhà cung cấp');
    expect(msg).not.toContain('Trạng thái nhập máy');
  });
  it('count = 0 hoặc âm đều tính là thiếu', () => {
    expect(missingPrereqs(defs(-1, 5, 5))).toHaveLength(1);
  });
});
