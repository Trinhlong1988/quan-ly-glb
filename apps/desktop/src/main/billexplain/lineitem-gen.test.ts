// Engine sinh dòng bill — vitest THUẦN (không cần Postgres, chạy trong `npm run verify`).
// Mr.Long 16/7: KHÔNG tách hóa đơn; 1 HĐ tới ~299tr; số lượng CÂN ĐỐI đều các dòng (mỗi dòng ~ target/M),
// KHÔNG 1 dòng ôm hết (gốc lỗi "40 nồi cơm"), số lượng KHÔNG phi lý (≤ HARD_UNIT_CAP), tiền khớp CHÍNH XÁC.
import { describe, it, expect } from 'vitest';
import { generateLineItems, maxComposable, lineQtyCap, isDecimalUnit, type ProductLite } from './lineitem-gen.js';

// Thư viện lẫn SP đắt (nồi cơm/tivi) + đồ cân (hành/gạo/dầu) + đồ rẻ — như 1 siêu thị thật.
const LIB: ProductLite[] = [
  { name: 'Nồi cơm điện', unit: 'cái', price: 1_500_000 },
  { name: 'Tivi 43 inch', unit: 'cái', price: 8_000_000 },
  { name: 'Hành tây', unit: 'kg', price: 30_000 },
  { name: 'Gạo ST25', unit: 'kg', price: 40_000 },
  { name: 'Nước mắm', unit: 'chai', price: 60_000 },
  { name: 'Bột giặt', unit: 'hộp', price: 120_000 },
  { name: 'Dầu ăn', unit: 'lít', price: 50_000 },
  { name: 'Bàn chải', unit: 'cái', price: 20_000 },
  { name: 'Cà phê bột', unit: 'gói', price: 90_000 },
  { name: 'Đường trắng', unit: 'kg', price: 25_000 }
];

// Miền target thực tế 1 hóa đơn: từ nhỏ tới trần 299tr (KHÔNG tách).
const TARGETS = [890_000, 3_450_000, 11_100_000, 30_000_000, 90_000_000, 199_000_000, 299_000_000];

describe('lineQtyCap — trần số lượng 1 dòng theo phần giá trị', () => {
  it('= min(200, floor(3 × phần giá trị / đơn giá)) — giá cao → trần thấp', () => {
    expect(lineQtyCap(1_000_000, 6_000_000)).toBe(18); // floor(18tr/1tr)=18 < 200
    expect(lineQtyCap(100_000, 6_000_000)).toBe(180); // floor(18tr/100k)=180 < 200
    expect(lineQtyCap(10_000, 6_000_000)).toBe(200); // floor(1800)=1800 → clamp 200 (backstop)
  });
});

describe('generateLineItems — money EXACT + CÂN ĐỐI + số lượng hợp lý', () => {
  it('mọi target (tới 299tr): Σ(giá×SL)=subtotal, subtotal−chiết khấu=target, 1..5 dòng', () => {
    for (const t of TARGETS) {
      for (let rep = 0; rep < 15; rep++) {
        const g = generateLineItems(t, LIB);
        const sum = g.lines.reduce((s, l) => s + Math.round(l.price * l.qty), 0);
        expect(sum).toBe(g.subtotal); // bất biến TẢI-TRỌNG: Σ dòng = subtotal (không phải tautology)
        // chiết khấu NHẤT QUÁN (không phải tautology subtotal−disc=target): subtotal × (1−P/100) ≈ target.
        if (g.discount_pct > 0) expect(Math.abs(Math.round(g.subtotal * (1 - g.discount_pct / 100)) - t)).toBeLessThanOrEqual(1);
        expect(g.subtotal - g.discount_amount).toBe(t); // quan hệ subtotal/discount/target khớp
        expect(g.lines.length).toBeGreaterThanOrEqual(1);
        expect(g.lines.length).toBeLessThanOrEqual(5);
      }
    }
  }, 20000);

  it('CÂN ĐỐI: KHÔNG dòng nào ôm quá 3.5× phần chia đều (chống "40 nồi cơm 1 dòng")', () => {
    let worst = 0;
    for (const t of TARGETS) {
      for (let rep = 0; rep < 15; rep++) {
        const g = generateLineItems(t, LIB);
        const share = g.subtotal / g.lines.length;
        for (const l of g.lines) worst = Math.max(worst, (l.price * l.qty) / share);
      }
    }
    expect(worst).toBeLessThanOrEqual(3.5); // nếu 1 dòng ôm hết → ratio ≈ số dòng (≥3) → đỏ
  }, 20000);

  it('CÂN ĐỐI thư viện lệch SP ĐẮT (điện máy): KHÔNG bao giờ sinh HĐ mất cân đối (throw thà hơn ratio>3.5)', () => {
    // Regression bug fallback (agent review 16/7): thư viện toàn SP đắt + vài SP rẻ → nhánh pool0=products cũ cho
    // SP đắt (Tivi 9tr) làm dòng dẫn qty=1 = 9tr > 3× phần chia → ratio 3.6. Fix: pool KHÔNG thoái về SP>maxPrice
    // + guard dòng dẫn. Bất biến MỚI: MỌI bill sinh ra PHẢI cân đối ≤3.5; nếu không ghép nổi thì THROW (→errors[]),
    // TUYỆT ĐỐI không đẻ bill lệch. (Thư viện này test cũ — chỉ 1 lib siêu thị cân bằng giá — mù hoàn toàn.)
    const dienMay: ProductLite[] = [
      { name: 'Tivi 55 inch', unit: 'cái', price: 9_000_000 },
      { name: 'Tủ lạnh', unit: 'cái', price: 12_000_000 },
      { name: 'Máy giặt', unit: 'cái', price: 8_000_000 },
      { name: 'Nồi chiên', unit: 'cái', price: 1_800_000 },
      { name: 'Bàn ủi', unit: 'cái', price: 500_000 },
      { name: 'Quạt máy', unit: 'cái', price: 700_000 },
      { name: 'Ổ cắm', unit: 'cái', price: 120_000 }
    ];
    let composed = 0, worst = 0;
    for (const t of [10_000_000, 30_000_000, 90_000_000, 199_000_000, 299_000_000]) {
      for (let rep = 0; rep < 15; rep++) {
        let g;
        try { g = generateLineItems(t, dienMay); } catch { continue; } // throw = chấp nhận (không ghép nổi cân đối)
        composed++;
        const share = g.subtotal / g.lines.length;
        for (const l of g.lines) worst = Math.max(worst, (l.price * l.qty) / share);
        expect(g.lines.reduce((s, l) => s + Math.round(l.price * l.qty), 0)).toBe(g.subtotal); // money-exact vẫn giữ
      }
    }
    expect(worst).toBeLessThanOrEqual(3.5); // KHÔNG bill nào lệch — kể cả nhánh fallback pool
    expect(composed).toBeGreaterThan(0); // engine KHÔNG chết cứng (target lớn vẫn ghép được cân đối)
  }, 20000);

  it('số lượng KHÔNG phi lý: mọi dòng ≤ HARD_UNIT_CAP (200), > 0', () => {
    for (const t of TARGETS) {
      for (let rep = 0; rep < 15; rep++) {
        const g = generateLineItems(t, LIB);
        for (const l of g.lines) {
          expect(l.qty).toBeGreaterThan(0);
          expect(l.qty).toBeLessThanOrEqual(200);
        }
      }
    }
  }, 20000);

  it('ĐA DẠNG: các dòng trong 1 HĐ là SP KHÁC TÊN nhau (không lặp 1 loại)', () => {
    for (const t of TARGETS) {
      for (let rep = 0; rep < 15; rep++) {
        const g = generateLineItems(t, LIB);
        const names = g.lines.map((l) => l.name);
        expect(new Set(names).size).toBe(names.length);
      }
    }
  }, 20000);

  it('HĐ 299tr (trần thực tế) VẪN sinh được, tiền khớp chính xác', () => {
    const g = generateLineItems(299_000_000, LIB);
    const sum = g.lines.reduce((s, l) => s + Math.round(l.price * l.qty), 0);
    expect(sum).toBe(g.subtotal);
    expect(g.subtotal - g.discount_amount).toBe(299_000_000);
  });

  it('ưu tiên (priority) cao → SP được chọn NHIỀU hơn hẳn SP thường cùng vùng giá', () => {
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
    expect(cntUuTien).toBeGreaterThan(cntThuong1 * 1.5);
  }, 20000);

  it('priority mặc định 0 (không gán) → vẫn sinh bình thường, money khớp', () => {
    const g = generateLineItems(2_500_000, LIB);
    const sum = g.lines.reduce((s, l) => s + Math.round(l.price * l.qty), 0);
    expect(sum - g.discount_amount).toBe(2_500_000);
  });

  it('target bất khả thi (thư viện 1 SP, không chia hết) → THROW (service đẩy vào errors[])', () => {
    const tiny: ProductLite[] = [{ name: 'X', unit: 'cái', price: 1_000_000 }];
    expect(() => generateLineItems(1_234_567, tiny)).toThrow();
  });
});

describe('maxComposable — backstop O(1) chống treo với input phi lý', () => {
  it('= tổng 5 dòng lớn nhất × HARD_UNIT_CAP (oracle độc lập, hằng số cứng)', () => {
    const lib: ProductLite[] = [
      { name: 'A', unit: 'cái', price: 1_000_000 },
      { name: 'B', unit: 'cái', price: 2_000_000 },
      { name: 'C', unit: 'kg', price: 100_000 }
    ];
    // top-5 (chỉ 3 SP) × 200 = (2tr+1tr+100k)×200 = 620.000.000
    expect(maxComposable(lib)).toBe(620_000_000);
  });

  it('target vượt maxComposable → THROW NHANH (<200ms, không spin hết retry)', () => {
    const cap = maxComposable(LIB);
    const start = performance.now();
    expect(() => generateLineItems(cap + 10_000, LIB)).toThrow();
    expect(performance.now() - start).toBeLessThan(200);
  });

  it('isDecimalUnit nhận diện kg/lít/mét, loại cái/chai/hộp', () => {
    expect(isDecimalUnit('kg')).toBe(true);
    expect(isDecimalUnit('Lít')).toBe(true);
    expect(isDecimalUnit('cái')).toBe(false);
    expect(isDecimalUnit('chai')).toBe(false);
  });
});
