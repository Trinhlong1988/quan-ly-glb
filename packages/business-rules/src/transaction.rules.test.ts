import { describe, it, expect } from 'vitest';
import { computeRevenue, marginToAmount } from './transaction.rules.js';

describe('marginToAmount (1 khoản chênh milli% → VND)', () => {
  it('1% (1000 milli) trên 10.000.000 = 100.000', () => {
    expect(marginToAmount(10_000_000, 1000)).toBe(100_000);
  });
  it('2.5% (2500) trên 4.000.000 = 100.000', () => {
    expect(marginToAmount(4_000_000, 2500)).toBe(100_000);
  });
  it('chênh 0 → 0', () => {
    expect(marginToAmount(5_000_000, 0)).toBe(0);
  });
  it('làm tròn về đồng', () => {
    expect(marginToAmount(1_000_001, 1000)).toBe(10_000); // 10000.01 → 10000
  });
  it('amount âm/không hợp lệ → 0', () => {
    expect(marginToAmount(-100, 3000)).toBe(0);
    expect(marginToAmount(NaN, 3000)).toBe(0);
  });
  it('chênh âm (lỗ) → khoản âm', () => {
    expect(marginToAmount(10_000_000, -2000)).toBe(-200_000);
  });
});

describe('computeRevenue (bóc 2 khoản: đối tác + bán, cộng gộp)', () => {
  it('CL_NCC 1% + CL_KH 1.5% trên 10.000.000 → 100.000 + 150.000 = 250.000', () => {
    expect(computeRevenue(10_000_000, 1000, 1500)).toEqual({
      revenuePartner: 100_000,
      revenueSell: 150_000,
      revenueAmount: 250_000,
    });
  });
  it('chỉ có chênh bán (đối tác 0) → chỉ khoản bán', () => {
    expect(computeRevenue(4_000_000, 0, 2500)).toEqual({
      revenuePartner: 0,
      revenueSell: 100_000,
      revenueAmount: 100_000,
    });
  });
  it('cả 2 khoản 0 → doanh thu 0', () => {
    expect(computeRevenue(5_000_000, 0, 0)).toEqual({
      revenuePartner: 0,
      revenueSell: 0,
      revenueAmount: 0,
    });
  });
  it('amount không hợp lệ → tất cả 0', () => {
    expect(computeRevenue(NaN, 3000, 2000)).toEqual({
      revenuePartner: 0,
      revenueSell: 0,
      revenueAmount: 0,
    });
  });
  it('một khoản âm (đối tác lỗ) vẫn cộng gộp đúng dấu', () => {
    expect(computeRevenue(10_000_000, -1000, 2000)).toEqual({
      revenuePartner: -100_000,
      revenueSell: 200_000,
      revenueAmount: 100_000,
    });
  });
});
