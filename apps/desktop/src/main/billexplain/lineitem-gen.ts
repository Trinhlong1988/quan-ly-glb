// Thuật toán sinh dòng sản phẩm khớp tổng tiền (port từ globeway-renbill/lib/lineitem-gen.js — giữ NGUYÊN
// thuật toán đã được Mr.Long duyệt ở renbill). Từ 1 "số tiền cần giải trình" (target) sinh 2..5 dòng SP
// sao cho Σ(đơn giá × số lượng) khớp CHÍNH XÁC target (hoặc subtotal khi có chiết khấu 1..10%).
export interface ProductLite {
  name: string;
  unit: string;
  price: number;
  priority?: number; // cao = SP hữu dụng, ưu tiên chọn khi sinh dòng (mặc định 0 = trung tính → xếp theo giá)
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

// ── Số lượng CÂN ĐỐI theo GIÁ TRỊ (Mr.Long 16/7): mỗi hóa đơn tới ~299tr, KHÔNG tách; số lượng chia ĐỀU các
// dòng để KHÔNG 1 dòng ôm hết (đây mới là gốc lỗi "40 nồi cơm" — 1 dòng chiếm toàn bộ tiền, không cân đối).
// Mỗi dòng nhắm ~ target/M tiền; trần mỗi dòng = SHARE_FACTOR × phần-chia-đều (theo GIÁ TRỊ) → giá cao số
// lượng ít, giá thấp số lượng nhiều NHƯNG không dòng nào vượt 3× phần công bằng. Backstop HARD_UNIT_CAP.
const HARD_UNIT_CAP = 200; // backstop tuyệt đối số lượng 1 dòng (đủ cho HĐ 299tr; chặn phi lý 400–900 đơn vị)
const SHARE_FACTOR = 3; // 1 dòng ≤ 3× phần chia đều theo giá trị → cân đối
const MAX_NICE_QTY = 80; // số lượng "đẹp" tối đa mong muốn 1 dòng → chọn SP đủ đắt để qty ≤ ngưỡng này khi có thể
// NGÂN SÁCH THỜI GIAN mỗi generateLineItems (agent-1 HIGH 16/7): target lẻ dưới cap có thể quay HẾT retry ~30–50
// GIÂY treo main process. Deadline cứng → quá hạn thì bỏ (throw → errors[]) như target bất khả thi, KHÔNG treo.
const GEN_DEADLINE_MS = 300;

/** Trần số lượng 1 dòng theo PHẦN GIÁ TRỊ được chia (valueShare tiền) → giữ cân đối; backstop HARD_UNIT_CAP. */
export function lineQtyCap(price: number, valueShare: number): number {
  const byShare = Math.max(1, Math.floor((valueShare * SHARE_FACTOR) / Math.max(1, price)));
  return Math.min(HARD_UNIT_CAP, byShare);
}

/** Số lượng dòng dẫn: nhắm ~valueShare tiền (dao động ±20%), hợp lệ theo ĐVT (đồ cân bước 0.1), trong [min, cap]. */
function balancedQty(unit: string, price: number, valueShare: number, cap: number): number {
  const ideal = (valueShare / Math.max(1, price)) * (0.8 + Math.random() * 0.4);
  const minQ = isDecimalUnit(unit) ? 0.1 : 1;
  let q = isDecimalUnit(unit) ? Math.round(ideal * 10) / 10 : Math.round(ideal);
  q = Math.max(minQ, Math.min(q, cap));
  return q;
}

// Tìm qty hợp lệ cho line cuối: price × qty = remain (qty hợp lệ theo unit, ≤ cap).
function findValidLastQty(remain: number, price: number, unit: string, cap: number): number | null {
  if (price <= 0 || remain <= 0) return null;
  if (isDecimalUnit(unit)) {
    if ((remain * 10) % price !== 0) return null;
    const q = Math.round((remain / price) * 10) / 10;
    if (q < 0.1 || q > cap) return null;
    return q;
  }
  if (remain % price !== 0) return null;
  const q = remain / price;
  if (q < 1 || q > cap) return null;
  return q;
}

interface Pools { top30: ProductLite[]; mid40: ProductLite[]; sorted: ProductLite[] }
// Dựng pool + SORT MỘT LẦN (hoist khỏi vòng retry — agent-1 perf: trước đây sort mỗi attempt = O(retries·n·logn)).
// `minPrice` = giá tối thiểu để qty ≤ MAX_NICE_QTY cho phần chia này → LỌC bỏ SP quá rẻ (tránh 434 gói mì); nếu
// không đủ M SP đắt thì thoái về toàn bộ (HĐ lớn buộc dùng SP rẻ hơn — không tránh được với thư viện giá thấp).
function buildPools(products: ProductLite[], M: number, minPrice: number, maxPrice: number): Pools {
  // minPrice: đủ đắt để qty ≤ MAX_NICE_QTY. maxPrice: KHÔNG đắt tới mức 1 đơn vị đã > 3× phần chia (phá cân đối,
  // vd Tivi 8tr trong HĐ 11tr). Ưu tiên giữ maxPrice (cân đối) hơn minPrice (số lượng) khi phải nới.
  const eligible = products.filter((p) => p.price >= minPrice && p.price <= maxPrice);
  // Ưu tiên maxPrice (cân đối) TUYỆT ĐỐI cho pool dòng dẫn: KHÔNG BAO GIỜ thoái về SP > maxPrice — thoái về sẽ
  // cho SP đắt (Tivi 9tr) làm dòng dẫn qty=1 = 9tr > 3× phần chia → phá cân đối (bug 3.604 qua nhánh fallback,
  // agent review 16/7). Chỉ nới minPrice (chấp số lượng cao hơn). Nếu byMax vẫn < M → pool nhỏ → picked < M →
  // tryFindLinesWithM trả null → thoái M nhỏ hơn (share lớn → maxPrice lớn) / chiết khấu. Dòng CUỐI vẫn dùng
  // TOÀN BỘ products (không qua pool, đã bị guard remain ≤ 3×share chặn) nên khả năng ghép không mất.
  const pool0 = eligible.length >= M ? eligible : products.filter((p) => p.price <= maxPrice);
  const sorted = [...pool0].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || b.price - a.price);
  const top30 = sorted.slice(0, Math.max(15, Math.ceil(sorted.length * 0.3)));
  const mid40 = sorted.slice(top30.length, top30.length + Math.max(15, Math.ceil(sorted.length * 0.4)));
  return { top30, mid40, sorted };
}

// Chọn M SP KHÁC TÊN, có TRỌNG SỐ theo (1 + priority): SP hữu dụng ưu tiên mạnh, SP thường (priority 0) vẫn có
// cơ hội. Khi cả ngành priority=0 → mọi trọng số =1 → random ĐỀU (không đổi hành vi). Không sort (dùng pool sẵn).
function pickMProducts(pools: Pools, M: number): ProductLite[] {
  const picks: ProductLite[] = [];
  const usedIds = new Set<string>();
  const pickFrom = (pool: ProductLite[]): ProductLite | null => {
    const cands = pool.filter((p) => !usedIds.has(p.name)); // dedup theo TÊN → mỗi HĐ nhiều loại SP khác nhau
    if (!cands.length) return null;
    const weights = cands.map((p) => 1 + Math.max(0, p.priority ?? 0));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let idx = 0;
    for (; idx < cands.length - 1; idx++) { r -= weights[idx]; if (r <= 0) break; }
    const c = cands[idx];
    usedIds.add(c.name);
    return c;
  };
  const fromTop = M > 1 ? M - 1 : M;
  for (let i = 0; i < fromTop; i++) {
    const p = pickFrom(pools.top30) || pickFrom(pools.mid40) || pickFrom(pools.sorted);
    if (p) picks.push(p);
  }
  if (M > 1) {
    const p = pickFrom(pools.mid40) || pickFrom(pools.top30) || pickFrom(pools.sorted);
    if (p) picks.push(p);
  }
  return picks;
}

function tryFindLinesWithM(target: number, products: ProductLite[], M: number, retries: number, deadline: number): BillLine[] | null {
  // Giá tối thiểu để qty của MỖI dòng ≤ MAX_NICE_QTY (số lượng đẹp) — ưu tiên SP đủ đắt, tránh số lượng phi lý.
  const minPrice = Math.max(1, Math.floor(target / M / MAX_NICE_QTY));

  if (M === 1) {
    // 1 dòng = toàn bộ target → qty = target/price. Ưu tiên SP đắt (qty nhỏ nhất). Chỉ dùng cho target nhỏ.
    const cands: BillLine[] = [];
    for (const p of products) {
      const q = findValidLastQty(target, p.price, p.unit, HARD_UNIT_CAP);
      if (q !== null) cands.push({ ...p, qty: q });
    }
    if (!cands.length) return null;
    return [pickLowQty(cands)];
  }

  const globalShare = target / M; // phần chia đều TOÀN CỤC → trần cân đối chung cho MỌI dòng (kể cả dòng cuối)
  // maxPrice = 3× phần chia: SP mà 1 ĐƠN VỊ đã > 3× phần chia (vd Tivi 8tr trong HĐ 11tr, share 2.2tr) thì DÙ
  // qty=1 vẫn phá cân đối (ratio 3.6 > 3.5) → loại khỏi pool dòng dẫn ngay từ đầu (bug ratio 3.604 16/7).
  const maxPrice = SHARE_FACTOR * globalShare;
  const pools = buildPools(products, M, minPrice, maxPrice); // SORT 1 LẦN, ngoài vòng retry (agent-1 perf)
  for (let attempt = 0; attempt < retries; attempt++) {
    if ((attempt & 127) === 0 && Date.now() > deadline) return null; // ngân sách thời gian → chống treo (agent-1 HIGH)
    const picked = pickMProducts(pools, M);
    if (picked.length < M) return null;

    const lines: BillLine[] = [];
    let partial = 0; // GIÁ TRỊ tích lũy dạng SỐ NGUYÊN (Math.round mỗi dòng) → tổng khớp CHÍNH XÁC, không trôi float
    let ok = true;

    for (let i = 0; i < M - 1; i++) {
      const p = picked[i];
      // CHỐT cân đối lớp 2 (kể cả khi pool lọt SP đắt): SP mà 1 ĐƠN VỊ đã > 3× phần chia thì cấm làm dòng dẫn —
      // 1 đơn vị của nó đã phá tỉ lệ, không số lượng nào cứu được. Bỏ attempt này (pickMProducts thử tổ hợp khác).
      if (p.price > maxPrice) { ok = false; break; }
      const remainAfter = target - partial;
      const linesLeft = M - i; // dòng này + các dòng sau (gồm dòng cuối)
      const valueShare = remainAfter / linesLeft; // NHẮM: chia đều phần còn lại cho các dòng còn lại
      const slotsLeft = M - 1 - i;
      const safetyMax = Math.floor((remainAfter - slotsLeft) / p.price); // chừa ≥1 đơn-vị-giá cho dòng sau
      // TRẦN cân đối theo globalShare (target/M) → KHÔNG dòng nào ôm > 3× phần chia đều dù dòng trước hụt.
      const cap = Math.min(lineQtyCap(p.price, globalShare), safetyMax);
      const minQ = isDecimalUnit(p.unit) ? 0.1 : 1;
      if (cap < minQ) { ok = false; break; }
      const qty = balancedQty(p.unit, p.price, valueShare, cap);
      lines.push({ ...p, qty });
      partial += Math.round(p.price * qty); // đơn giá bội 10 → giá trị dòng NGUYÊN; Math.round khử sai số float
    }
    if (!ok) continue;

    const remain = target - partial;
    if (remain <= 0) continue;
    // CÂN ĐỐI dòng cuối: nếu các dòng dẫn hụt quá → dòng cuối ôm phần dư lớn → mất cân đối. Chặn dòng cuối
    // > SHARE_FACTOR × phần chia đều → thử lại (hoặc thoái về M ít hơn, tự cân đối). Giữ "không 1 dòng ôm hết".
    if (remain > SHARE_FACTOR * globalShare) continue;

    // Dòng cuối khớp CHÍNH XÁC phần còn lại. Ưu tiên SP cho qty THẤP nhất (SP đắt) để không phồng số lượng.
    const usedNames = new Set(lines.map((l) => l.name));
    const cands: BillLine[] = [];
    for (const p of products) {
      if (usedNames.has(p.name)) continue;
      const q = findValidLastQty(remain, p.price, p.unit, HARD_UNIT_CAP);
      if (q !== null) cands.push({ ...p, qty: q });
    }
    if (!cands.length) continue;

    lines.push(pickLowQty(cands));
    return lines;
  }
  return null;
}

// Chọn 1 dòng có số lượng THẤP (ưu tiên qty nhỏ = SP đắt hơn) nhưng vẫn ngẫu nhiên trong nhóm "đẹp" (qty ≤
// MAX_NICE_QTY) cho đa dạng; nếu không có nhóm đẹp thì lấy qty nhỏ nhất.
function pickLowQty(cands: BillLine[]): BillLine {
  const nice = cands.filter((c) => c.qty <= MAX_NICE_QTY);
  if (nice.length) return nice[randInt(0, nice.length - 1)];
  let best = cands[0];
  for (const c of cands) if (c.qty < best.qty) best = c;
  return best;
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

// Trần tuyệt đối 1 hóa đơn = tổng 5 dòng có GIÁ TRỊ lớn nhất (đơn giá × HARD_UNIT_CAP). Target vượt trần này
// KHÔNG THỂ ghép bằng ≤5 dòng → chặn NGAY (khỏi spin hết retry treo UI). Trần "thực tế 299tr" do SERVICE
// enforce ở tầng nghiệp vụ; đây là backstop kỹ thuật (thường rất cao) chỉ để chống treo với input phi lý.
export function maxComposable(products: ProductLite[]): number {
  const lineMax = products.map((p) => p.price * HARD_UNIT_CAP).sort((a, b) => b - a);
  return lineMax.slice(0, 5).reduce((s, v) => s + v, 0);
}

function tryFindLines(target: number, products: ProductLite[], deadline: number): BillLine[] | null {
  if (target <= 0 || !products.length) return null;
  if (target > maxComposable(products)) return null; // guard nhanh: vượt trần kỹ thuật → bỏ (chống treo)

  const preferred = mCandidatesFor(target);
  const fallback = [5, 4, 3, 2, 1].filter((m) => !preferred.includes(m));

  // Số dòng theo giá trị HĐ (target lớn → 5 dòng để chia đều), rồi các M khác. Mỗi dòng CÂN ĐỐI theo giá trị.
  for (const M of shuffle(preferred)) {
    if (M > products.length) continue;
    if (Date.now() > deadline) return null;
    const lines = tryFindLinesWithM(target, products, M, 2500, deadline);
    if (lines) return lines;
  }
  for (const M of fallback) {
    if (M > products.length) continue;
    if (Date.now() > deadline) return null;
    const lines = tryFindLinesWithM(target, products, M, 1500, deadline);
    if (lines) return lines;
  }
  return null;
}

// Sinh line items cho 1 target. Ưu tiên P=0, fallback chiết khấu P=min..max (rồi bước nửa %). Toàn bộ bị chặn
// bởi 1 NGÂN SÁCH THỜI GIAN (deadline) → target lẻ khó ghép sẽ throw sớm (→ errors[]) thay vì treo main process.
export function generateLineItems(target: number, products: ProductLite[], minPct = 1, maxPct = 10): GenResult {
  const deadline = Date.now() + GEN_DEADLINE_MS;
  const lines0 = tryFindLines(target, products, deadline);
  if (lines0) return { lines: lines0, discount_pct: 0, subtotal: target, discount_amount: 0 };

  for (let P = minPct; P <= maxPct; P++) {
    if (Date.now() > deadline) break;
    const subtotal = Math.round(target / (1 - P / 100));
    const lines = tryFindLines(subtotal, products, deadline);
    if (lines) return { lines, discount_pct: P, subtotal, discount_amount: subtotal - target };
  }
  // bước nửa % — KHÔNG vượt maxPct (agent-1 LOW: trước đây tới 10.5% > trần 10%).
  for (let P10 = minPct * 10 + 5; P10 <= maxPct * 10; P10 += 5) {
    if (Date.now() > deadline) break;
    const P = P10 / 10;
    const subtotal = Math.round(target / (1 - P / 100));
    const lines = tryFindLines(subtotal, products, deadline);
    if (lines) return { lines, discount_pct: P, subtotal, discount_amount: subtotal - target };
  }
  throw new Error(`Không tìm được tổ hợp sản phẩm cho số tiền ${target.toLocaleString('vi-VN')} với ${products.length} SP (P=${minPct}..${maxPct}%). Thư viện SP cần đa dạng đơn giá hơn.`);
}
