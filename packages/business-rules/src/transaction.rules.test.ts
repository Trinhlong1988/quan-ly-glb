import { describe, it, expect } from 'vitest';
import { computeRevenue, marginToAmount, pickEffectiveRate } from './transaction.rules.js';

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

describe('pickEffectiveRate (P1.1 — chọn kỳ giá hiệu lực tại txnDate)', () => {
  const K1 = { id: 1, effectiveFrom: new Date('2026-01-01T00:00:00.000Z') };
  const K2 = { id: 2, effectiveFrom: new Date('2026-07-01T00:00:00.000Z') };

  it('nhiều kỳ → chọn kỳ MỚI NHẤT có effectiveFrom ≤ at', () => {
    // at sau K2 → K2
    expect(pickEffectiveRate([K1, K2], new Date('2026-07-10T00:00:00.000Z'))?.id).toBe(2);
    // at giữa K1 và K2 → K1
    expect(pickEffectiveRate([K1, K2], new Date('2026-06-15T00:00:00.000Z'))?.id).toBe(1);
  });

  it('biên: at = đúng effectiveFrom của kỳ → chính kỳ đó (≤, không loại)', () => {
    expect(pickEffectiveRate([K1, K2], new Date('2026-07-01T00:00:00.000Z'))?.id).toBe(2);
    expect(pickEffectiveRate([K1, K2], new Date('2026-01-01T00:00:00.000Z'))?.id).toBe(1);
  });

  it('at TRƯỚC mọi kỳ → null (không lấy đại kỳ tương lai — I-P3)', () => {
    expect(pickEffectiveRate([K1, K2], new Date('2025-12-31T23:59:59.000Z'))).toBeNull();
  });

  it('1 kỳ duy nhất (mốc sàn) phủ mọi ngày ≥ mốc', () => {
    const floor = [{ id: 9, effectiveFrom: new Date('1970-01-01T00:00:00.000Z') }];
    expect(pickEffectiveRate(floor, new Date('2026-03-01T00:00:00.000Z'))?.id).toBe(9);
    expect(pickEffectiveRate(floor, new Date('2020-05-05T00:00:00.000Z'))?.id).toBe(9);
  });

  it('danh sách rỗng → null; hỗ trợ effectiveFrom dạng ISO string', () => {
    expect(pickEffectiveRate([], new Date())).toBeNull();
    const str = [{ id: 3, effectiveFrom: '2026-01-01T00:00:00.000Z' }];
    expect(pickEffectiveRate(str, new Date('2026-06-15T00:00:00.000Z'))?.id).toBe(3);
  });
});
