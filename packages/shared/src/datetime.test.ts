import { describe, it, expect } from 'vitest';
import { fmtDate, fmtTime, fmtTimeSec, fmtDateTime, splitDateTime } from './datetime.js';

// R_LINK_VERIFY / R_DATE_FORMAT: đúng 50 case ĐÚNG + 50 case SAI, có bằng chứng số liệu.

const p2 = (n: number): string => String(n).padStart(2, '0');

describe('datetime — 50 case ĐÚNG (hợp lệ → dd/mm/yyyy + HH:mm:ss chuẩn)', () => {
  for (let i = 0; i < 50; i++) {
    const day = (i % 28) + 1;
    const month = i % 12; // 0..11
    const year = 2000 + i;
    const hh = i % 24, mi = (i * 13) % 60, ss = (i * 7) % 60;
    const d = new Date(year, month, day, hh, mi, ss);
    it(`ĐÚNG#${i + 1} (${day}/${month + 1}/${year} ${hh}:${mi}:${ss})`, () => {
      expect(fmtDate(d)).toBe(`${p2(day)}/${p2(month + 1)}/${year}`);
      expect(fmtTime(d)).toBe(`${p2(hh)}:${p2(mi)}`); // HH:mm (15:02), không giây
      expect(fmtTimeSec(d)).toBe(`${p2(hh)}:${p2(mi)}:${p2(ss)}`);
      expect(splitDateTime(d)).toEqual({ date: fmtDate(d), time: fmtTime(d) });
      expect(fmtDateTime(d)).toBe(`${fmtDate(d)} ${fmtTime(d)}`);
    });
  }
});

describe('datetime — padding + ISO/epoch (khẳng định yêu cầu dd,mm đủ 2 chữ số)', () => {
  it('ngày 3 → 03, tháng 1 → 01', () => expect(fmtDate(new Date(2026, 0, 3))).toBe('03/01/2026'));
  it('epoch ms hợp lệ', () => expect(fmtDate(new Date(2026, 5, 9).getTime())).toBe('09/06/2026'));
  it('ISO string hợp lệ', () => expect(fmtDate('2026-07-09T08:05:01')).toBe('09/07/2026'));
});

describe('datetime — 50 case SAI (input rác → chuỗi rỗng, KHÔNG crash)', () => {
  const junk: unknown[] = [
    null, undefined, '', '   ', '\n\t', true, false, Symbol('x'), () => 1,
    {}, [], [1, 2, 3], NaN, Infinity, -Infinity
  ];
  // đủ 50: thêm 35 chuỗi rác chắc chắn không parse được
  for (let i = 0; i < 35; i++) junk.push(`rac-khong-hop-le-${i}/??:zz`);

  junk.forEach((v, idx) => {
    it(`SAI#${idx + 1} (${typeof v}) → '' và không throw`, () => {
      let out = 'THREW';
      expect(() => { out = fmtDate(v as never); }).not.toThrow();
      expect(out).toBe('');
      expect(fmtTime(v as never)).toBe('');
      expect(fmtTimeSec(v as never)).toBe('');
      expect(fmtDateTime(v as never)).toBe('');
      expect(splitDateTime(v as never)).toEqual({ date: '', time: '' });
    });
  });

  it('tổng số case SAI đúng bằng 50', () => expect(junk.length).toBe(50));
});
