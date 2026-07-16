// Engine sinh dòng bill — vitest THUẦN (không cần Postgres, chạy trong `npm run verify`).
// A3 (Mr.Long 16/7 "cấm nợ kỹ thuật"): lớp regression ngoài ST44 để bất biến money-exact + SỐ LƯỢNG hợp lý
// (chống 40 nồi cơm / 100kg hành) không thể lọt qua verify gate. B-realistic của ST44 cần DB; đây thì không.
import { describe, it, expect } from 'vitest';
import { generateLineItems, realisticMaxQty, isDecimalUnit, type ProductLite } from './lineitem-gen.js';

// Thư viện lẫn SP đắt (nồi cơm/tivi) + đồ cân (hành/gạo/dầu) + đồ rẻ — như 1 siêu thị thật.
const LIB: ProductLite[] = [
  { name: 'Nồi cơm điện', unit: 'cái', price: 1_500_000 },
  { name: 'Tivi 43 inch', unit: 'cái', price: 8_000_000 },
  { name: 'Hành tây', unit: 'kg', price: 30_000 },
  { name: 'Gạo ST25', unit: 'kg', price: 40_000 },
  { name: 'Nước mắm', unit: 'chai', price: 60_000 },
  { name: 'Bột giặt', unit: 'hộp', price: 120_000 },
  { name: 'Dầu ăn', unit: 'lít', price: 50_000 },
  { name: 'Bàn chải', unit: 'cái', price: 20_000 }
];

// 1 hóa đơn = tối đa 5 dòng (giới hạn template) + trần ~5tr/dòng → miền thực tế 1 bill ≤ ~20tr.
// Số tiền lớn hơn phải tách nhiều bill (service đẩy vào errors[]). Targets bội 10.000 để ghép khớp.
const TARGETS = [1_230_000, 3_450_000, 7_770_000, 11_100_000, 15_000_000];

describe('realisticMaxQty — trần số lượng theo ĐVT + giá', () => {
  it('SP đắt → trần thấp theo TIỀN (nồi cơm 1.5tr ≤ 3 cái ở relax=1)', () => {
    expect(realisticMaxQty('cái', 1_500_000, 1)).toBe(3); // floor(5tr/1.5tr)=3 < DISCRETE_CAP 12
    expect(realisticMaxQty('cái', 8_000_000, 1)).toBe(1); // tivi 8tr → 1
  });
  it('SP rẻ đồ đếm → chặn ở DISCRETE_CAP 12', () => {
    expect(realisticMaxQty('cái', 20_000, 1)).toBe(12);
  });
  it('đồ cân (kg/lít) → chặn ở WEIGHT_CAP 15', () => {
    expect(realisticMaxQty('kg', 30_000, 1)).toBe(15);
    expect(realisticMaxQty('lít', 50_000, 1)).toBe(15);
  });
  it('relax nới trần nhưng SPEND_CAP vẫn chặn SP đắt (nồi cơm relax=3 ≤ 9)', () => {
    expect(realisticMaxQty('cái', 1_500_000, 3)).toBe(9); // 3×3, KHÔNG thể ra 40
  });
  it('isDecimalUnit nhận diện kg/lít/mét, loại cái/chai/hộp', () => {
    expect(isDecimalUnit('kg')).toBe(true);
    expect(isDecimalUnit('Lít')).toBe(true);
    expect(isDecimalUnit('cái')).toBe(false);
    expect(isDecimalUnit('chai')).toBe(false);
  });
});

describe('generateLineItems — money EXACT + số lượng HỢP LÝ', () => {
  it('mọi target: Σ(giá×SL)=subtotal, subtotal−chiết khấu=target, 1..5 dòng', () => {
    for (const t of TARGETS) {
      for (let rep = 0; rep < 30; rep++) {
        const g = generateLineItems(t, LIB);
        const sum = g.lines.reduce((s, l) => s + l.price * l.qty, 0);
        expect(sum).toBe(g.subtotal);
        expect(g.subtotal - g.discount_amount).toBe(t);
        expect(g.lines.length).toBeGreaterThanOrEqual(1);
        expect(g.lines.length).toBeLessThanOrEqual(5);
      }
    }
  });

  it('KHÔNG dòng nào vượt trần thực tế (relax≤3) — chống 40 nồi cơm / 100kg hành', () => {
    let worstNoiCom = 0, worstHanh = 0;
    for (const t of TARGETS) {
      for (let rep = 0; rep < 30; rep++) {
        const g = generateLineItems(t, LIB);
        for (const l of g.lines) {
          expect(l.qty).toBeLessThanOrEqual(realisticMaxQty(l.unit, l.price, 3));
          expect(l.qty).toBeGreaterThan(0);
          if (l.name === 'Nồi cơm điện') worstNoiCom = Math.max(worstNoiCom, l.qty);
          if (l.name === 'Hành tây') worstHanh = Math.max(worstHanh, l.qty);
        }
      }
    }
    expect(worstNoiCom).toBeLessThanOrEqual(9); // KHÔNG bao giờ 40 nồi cơm
    expect(worstHanh).toBeLessThanOrEqual(45); // KHÔNG bao giờ 100kg hành
  });

  it('ưu tiên (priority) cao → SP được chọn NHIỀU hơn hẳn SP thường cùng vùng giá', () => {
    // Thư viện 6 SP cùng giá (để M<size, có chỗ phân biệt), 1 SP priority cao. So với 1 SP thường CỤ THỂ.
    const lib: ProductLite[] = [
      { name: 'SP-ưu-tiên', unit: 'cái', price: 100_000, priority: 500 },
      { name: 'SP-thường-1', unit: 'cái', price: 100_000, priority: 0 },
      { name: 'SP-thường-2', unit: 'cái', price: 100_000, priority: 0 },
      { name: 'SP-thường-3', unit: 'cái', price: 100_000, priority: 0 },
      { name: 'SP-thường-4', unit: 'cái', price: 100_000, priority: 0 },
      { name: 'SP-lẻ', unit: 'cái', price: 50_000, priority: 0 }
    ];
    let cntUuTien = 0, cntThuong1 = 0;
    for (let rep = 0; rep < 200; rep++) {
      const g = generateLineItems(2_000_000, lib);
      for (const l of g.lines) {
        if (l.name === 'SP-ưu-tiên') cntUuTien++;
        if (l.name === 'SP-thường-1') cntThuong1++;
      }
    }
    // priority 500 vs 0 → SP ưu tiên phải xuất hiện áp đảo so với 1 SP thường bất kỳ.
    expect(cntUuTien).toBeGreaterThan(cntThuong1 * 1.5);
  });

  it('priority mặc định 0 (không gán) → vẫn sinh bình thường, không đổi bất biến money', () => {
    const g = generateLineItems(2_500_000, LIB);
    const sum = g.lines.reduce((s, l) => s + l.price * l.qty, 0);
    expect(sum - g.discount_amount).toBe(2_500_000);
  });

  it('target bất khả thi (không ghép được) → THROW (để service đẩy vào errors[], không sinh sai)', () => {
    const tiny: ProductLite[] = [{ name: 'X', unit: 'cái', price: 1_000_000 }];
    expect(() => generateLineItems(1_234_567, tiny)).toThrow();
  });

  it('target QUÁ LỚN cho 1 hóa đơn (5 dòng, trần thực tế) → THROW (degrade: phải tách nhiều bill)', () => {
    // 500tr vượt xa khả năng 5 dòng × trần thực tế → engine từ chối, KHÔNG sinh số lượng phi lý để ép khớp.
    expect(() => generateLineItems(500_000_000, LIB)).toThrow();
  });
});
