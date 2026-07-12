// Giao dịch / Doanh thu (Nhóm B). Pure logic — không DB, không Electron.
// Phí lưu Int = phần trăm × 1000 (milli), khớp fee-config (SCALE=1000).
//
// LEAD 9/7 — Doanh thu BÓC 2 khoản chênh rồi CỘNG GỘP:
//   • CL_NCC (chênh đối tác) = phiMua − phiCaiMay  → khoản đối soát/thu từ đối tác
//   • CL_KH  (chênh bán)     = phiBan − phiCaiMay  → khoản thu từ khách
//   Doanh thu = số tiền × (CL_NCC% + CL_KH%). CẢ 2 khoản = công nợ thu về.

/**
 * Quy đổi 1 khoản chênh (milli %) trên số tiền → VND. Làm tròn về đồng.
 * marginMilli = phần trăm × 1000. amount × (marginMilli/1000)/100 = amount × marginMilli / 100000.
 */
export function marginToAmount(amount: number, marginMilli: number): number {
  if (!Number.isFinite(amount) || amount < 0) return 0;
  if (!Number.isFinite(marginMilli)) return 0;
  return Math.round((amount * marginMilli) / 100000);
}

/**
 * Bóc doanh thu 1 giao dịch thành 2 khoản chênh + tổng.
 *   partnerMarginMilli = CL_NCC = phiMua − phiCaiMay (×1000)
 *   sellMarginMilli    = CL_KH  = phiBan − phiCaiMay (×1000)
 * Trả về { revenuePartner, revenueSell, revenueAmount } (VND).
 * revenueAmount = revenuePartner + revenueSell (doanh thu tổng = tổng công nợ thu về).
 */
export function computeRevenue(
  amount: number,
  partnerMarginMilli: number,
  sellMarginMilli: number
): { revenuePartner: number; revenueSell: number; revenueAmount: number } {
  const revenuePartner = marginToAmount(amount, partnerMarginMilli || 0);
  const revenueSell = marginToAmount(amount, sellMarginMilli || 0);
  return { revenuePartner, revenueSell, revenueAmount: revenuePartner + revenueSell };
}

// ── P1.1 GIÁ THEO KỲ ─────────────────────────────────────────────────────────
/**
 * Chọn KỲ giá đang hiệu lực tại mốc `at` trong danh sách kỳ của CÙNG 1 tổ hợp
 * (đối tác × loại thẻ, đã lọc còn sống). Trả về kỳ có `effectiveFrom` ≤ `at` LỚN NHẤT,
 * hoặc `null` nếu không có kỳ nào bắt đầu ≤ `at` (KHÔNG lấy đại kỳ tương lai — I-P3).
 * Hàm THUẦN: không DB, không side-effect. `effectiveFrom` nhận Date hoặc ISO string.
 */
export function pickEffectiveRate<T extends { effectiveFrom: Date | string }>(rows: T[], at: Date): T | null {
  const atMs = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (Number.isNaN(atMs)) return null;
  let best: T | null = null;
  let bestMs = -Infinity;
  for (const r of rows) {
    const ef = r.effectiveFrom instanceof Date ? r.effectiveFrom : new Date(r.effectiveFrom);
    const efMs = ef.getTime();
    if (Number.isNaN(efMs)) continue;
    if (efMs <= atMs && efMs > bestMs) {
      best = r;
      bestMs = efMs;
    }
  }
  return best;
}
