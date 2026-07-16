// Thuật toán sinh dòng sản phẩm khớp tổng tiền (port từ globeway-renbill/lib/lineitem-gen.js — giữ NGUYÊN
// thuật toán đã được Mr.Long duyệt ở renbill). Từ 1 "số tiền cần giải trình" (target) sinh 2..5 dòng SP
// sao cho Σ(đơn giá × số lượng) khớp CHÍNH XÁC target (hoặc subtotal khi có chiết khấu 1..10%).
export interface ProductLite {
  name: string;
  unit: string;
  price: number;
}
export interface BillLine extends ProductLite {
  qty: number;
}
export interface GenResult {
  lines: BillLine[];
  discount_pct: number;
  subtotal: number;
  discount_amount: number;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const DECIMAL_UNITS = new Set(['kg', 'lít', 'lit', 'l', 'lit.', 'lít.', 'mét', 'met', 'm', 'm2', 'm²', 'm3', 'm³', 'ml', 'g']);

export function isDecimalUnit(unit: string): boolean {
  return DECIMAL_UNITS.has(String(unit || '').toLowerCase().normalize('NFC').trim());
}

function pickQtyForUnit(unit: string, cap: number): number {
  const max = Math.max(1, Math.floor(cap));
  if (isDecimalUnit(unit)) {
    const r = randInt(1, max * 10);
    return r / 10;
  }
  return randInt(1, max);
}

// Tìm qty hợp lệ cho line cuối: price × qty = remain (qty hợp lệ theo unit + cap).
function findValidLastQty(remain: number, price: number, unit: string, cap: number): number | null {
  if (price <= 0 || remain <= 0) return null;
  const maxAllowed = cap !== undefined ? cap : 99;
  if (isDecimalUnit(unit)) {
    if ((remain * 10) % price !== 0) return null;
    const q = remain / price;
    const qRounded = Math.round(q * 10) / 10;
    if (qRounded < 0.1 || qRounded > maxAllowed) return null;
    return qRounded;
  }
  if (remain % price !== 0) return null;
  const q = remain / price;
  if (q < 1 || q > maxAllowed) return null;
  return q;
}

// Ưu tiên SP giá cao (top 30%) để số lượng không phồng, mix 1 SP middle 40% cho đa dạng.
function pickProductsBalanced(products: ProductLite[], M: number): ProductLite[] {
  const sorted = [...products].sort((a, b) => b.price - a.price);
  const top30 = sorted.slice(0, Math.max(15, Math.ceil(sorted.length * 0.3)));
  const mid40 = sorted.slice(top30.length, top30.length + Math.max(15, Math.ceil(sorted.length * 0.4)));

  const picks: ProductLite[] = [];
  const usedIds = new Set<string>();
  const pickFrom = (pool: ProductLite[]): ProductLite | null => {
    const cands = pool.filter((p) => !usedIds.has(p.name + '#' + p.price));
    if (!cands.length) return null;
    const c = cands[Math.floor(Math.random() * cands.length)];
    usedIds.add(c.name + '#' + c.price);
    return c;
  };
  const fromTop = M > 1 ? M - 1 : M;
  for (let i = 0; i < fromTop; i++) {
    const p = pickFrom(top30) || pickFrom(mid40) || pickFrom(sorted);
    if (p) picks.push(p);
  }
  if (M > 1) {
    const p = pickFrom(mid40) || pickFrom(top30) || pickFrom(sorted);
    if (p) picks.push(p);
  }
  return picks;
}

function tryFindLinesWithM(target: number, products: ProductLite[], M: number, qtyCap: number, retries: number): BillLine[] | null {
  if (M === 1) {
    const cands: BillLine[] = [];
    for (const p of products) {
      const q = findValidLastQty(target, p.price, p.unit, qtyCap);
      if (q !== null) cands.push({ ...p, qty: q });
    }
    if (!cands.length) return null;
    return [cands[randInt(0, cands.length - 1)]];
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    const picked = pickProductsBalanced(products, M);
    if (picked.length < M) return null;

    const lines: BillLine[] = [];
    let partial = 0;
    let ok = true;

    for (let i = 0; i < M - 1; i++) {
      const p = picked[i];
      const remainAfter = target - partial;
      const slotsLeft = M - 1 - i;
      const safetyMax = Math.floor((remainAfter - slotsLeft) / p.price);
      const max = Math.min(qtyCap, safetyMax);
      if (max < 1) { ok = false; break; }
      const qty = pickQtyForUnit(p.unit, max);
      lines.push({ ...p, qty });
      partial += p.price * qty;
    }
    if (!ok) continue;

    const remain = target - partial;
    if (remain <= 0) continue;

    const usedNames = new Set(lines.map((l) => l.name));
    const cands: BillLine[] = [];
    for (const p of products) {
      if (usedNames.has(p.name)) continue;
      const q = findValidLastQty(remain, p.price, p.unit, qtyCap);
      if (q !== null) cands.push({ ...p, qty: q });
    }
    if (!cands.length) continue;

    lines.push(cands[randInt(0, cands.length - 1)]);
    return lines;
  }
  return null;
}

// Số dòng M theo giá trị HĐ: ≥20tr→5; 10-20tr→{4,5}; 5-10tr→{3,4,5}; <5tr→{2,3,4,5}.
function mCandidatesFor(target: number): number[] {
  if (target >= 20_000_000) return [5];
  if (target >= 10_000_000) return [5, 4];
  if (target >= 5_000_000) return [5, 4, 3];
  return [5, 4, 3, 2];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function tryFindLines(target: number, products: ProductLite[]): BillLine[] | null {
  if (target <= 0 || !products.length) return null;

  const preferred = mCandidatesFor(target);
  const fallback = [5, 4, 3, 2, 1].filter((m) => !preferred.includes(m));

  for (const cap of [25, 50, 99]) {
    for (const M of shuffle(preferred)) {
      if (M > products.length) continue;
      const lines = tryFindLinesWithM(target, products, M, cap, 1500);
      if (lines) return lines;
    }
  }
  for (const cap of [50, 99]) {
    for (const M of fallback) {
      if (M > products.length) continue;
      const lines = tryFindLinesWithM(target, products, M, cap, 800);
      if (lines) return lines;
    }
  }
  return null;
}

// Sinh line items cho 1 target. Ưu tiên P=0, fallback chiết khấu P=min..max (rồi bước nửa %).
export function generateLineItems(target: number, products: ProductLite[], minPct = 1, maxPct = 10): GenResult {
  const lines0 = tryFindLines(target, products);
  if (lines0) return { lines: lines0, discount_pct: 0, subtotal: target, discount_amount: 0 };

  for (let P = minPct; P <= maxPct; P++) {
    const subtotal = Math.round(target / (1 - P / 100));
    const lines = tryFindLines(subtotal, products);
    if (lines) return { lines, discount_pct: P, subtotal, discount_amount: subtotal - target };
  }
  for (let P10 = minPct * 10 + 5; P10 <= maxPct * 10 + 5; P10 += 5) {
    const P = P10 / 10;
    const subtotal = Math.round(target / (1 - P / 100));
    const lines = tryFindLines(subtotal, products);
    if (lines) return { lines, discount_pct: P, subtotal, discount_amount: subtotal - target };
  }
  throw new Error(`Không tìm được tổ hợp sản phẩm cho số tiền ${target.toLocaleString('vi-VN')} với ${products.length} SP (P=${minPct}..${maxPct}%). Thư viện SP cần đa dạng đơn giá hơn.`);
}
