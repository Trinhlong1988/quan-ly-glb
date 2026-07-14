// Helper thuần cho form nhập liệu renderer (tiền VND, ngày tách phần dd/mm/yyyy,
// gate "thiếu dữ liệu nền"). Pure, không phụ thuộc React/Electron — unit-test bằng vitest.
// Tách khỏi renderer để bù lỗ hổng "test không chạm UI" (FIX lô UI 10/7).

/** Chỉ giữ chữ số (loại mọi ký tự khác, kể cả dấu chấm/phẩy/space). '' nếu rỗng. */
export function onlyDigits(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

/**
 * Nhóm 3 chữ số kiểu Việt Nam bằng dấu chấm để hiển thị NGAY trong ô khi gõ.
 * "5000000" → "5.000.000"; "" → ""; "abc12ab345" → "12.345"; "007" → "7".
 * KHÔNG kèm ký hiệu ₫ (đó là việc của nơi hiển thị bảng).
 */
export function groupDigits(raw: string): string {
  const s = onlyDigits(raw).replace(/^0+(?=\d)/, ''); // bỏ 0 dẫn đầu, giữ '0' đơn lẻ
  if (s === '') return '';
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Parse ô tiền người dùng gõ → số nguyên đồng. Rỗng → null (hợp lệ, chưa nhập).
 * Ký tự lạ bị loại trước khi parse. Không bao giờ trả NaN.
 */
export function parseVndInput(raw: string): number | null {
  const s = onlyDigits(raw);
  if (s === '') return null;
  return Number(s);
}

/** G2 (PING) — CHUẨN money-string ↔ bigint. int8 (BIGINT) tối đa = 9_223_372_036_854_775_807. */
export const MAX_VND = 9223372036854775807n;

/**
 * Parse CHUỖI tiền (IPC input) → bigint đồng, hoặc null nếu KHÔNG hợp lệ.
 * CHẶN: format sai / thập phân / âm / khoảng trắng giữa / scientific notation (1e5) / vượt int8 / overflow.
 * KHÔNG dùng Number trung gian → không mất chữ số. Chuỗi rỗng → null (chưa nhập).
 */
export function parseVndStrict(raw: unknown): bigint | null {
  if (typeof raw === 'bigint') return raw >= 0n && raw <= MAX_VND ? raw : null;
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  if (!/^\d+$/.test(s)) return null; // chỉ chữ số thuần: loại 'e'/'.'/'-'/dấu phân tách
  const v = BigInt(s);
  return v <= MAX_VND ? v : null;
}

/** Serialize bigint tiền → chuỗi thập phân cho IPC output/DTO (không scientific, không mất chữ số). */
export function serializeVnd(v: bigint): string {
  return v.toString();
}

export interface PartialDateResult {
  /** yyyy-mm-dd khi đủ 3 phần hợp lệ; null khi đang gõ dở HOẶC sai. */
  value: string | null;
  /** Thông báo lỗi khi 3 phần đã đủ nhưng KHÔNG hợp lệ; null khi hợp lệ hoặc còn gõ dở. */
  error: string | null;
}

/**
 * Ghép 3 phần ngày/tháng/năm (chuỗi người dùng gõ) thành yyyy-mm-dd (ngày local, B16).
 * - Trống hoàn toàn → { value: null, error: null } (chưa nhập, KHÔNG báo lỗi).
 * - Đang gõ dở (thiếu phần nào, hoặc năm < 4 chữ số) → { value: null, error: null } — KHÔNG wipe, KHÔNG báo lỗi.
 * - Đủ 3 phần nhưng sai (tháng > 12, ngày > số ngày của tháng…) → { value: null, error: '…' }.
 * - Đủ và hợp lệ → { value: 'yyyy-mm-dd', error: null }.
 */
export function parsePartialDate(dRaw: string, mRaw: string, yRaw: string): PartialDateResult {
  const d = onlyDigits(dRaw);
  const m = onlyDigits(mRaw);
  const y = onlyDigits(yRaw);
  if (!d && !m && !y) return { value: null, error: null };
  if (!d || !m || !y || y.length < 4) return { value: null, error: null };
  const nd = Number(d);
  const nm = Number(m);
  const ny = Number(y);
  if (nm < 1 || nm > 12) return { value: null, error: 'Tháng phải từ 1 đến 12.' };
  if (nd < 1 || nd > 31) return { value: null, error: 'Ngày phải từ 1 đến 31.' };
  if (ny < 1900 || ny > 2200) return { value: null, error: 'Năm không hợp lệ (1900–2200).' };
  const daysInMonth = new Date(ny, nm, 0).getDate(); // ngày 0 của tháng kế = ngày cuối tháng này
  if (nd > daysInMonth) return { value: null, error: `Tháng ${nm}/${ny} chỉ có ${daysInMonth} ngày.` };
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return { value: `${String(ny).padStart(4, '0')}-${p2(nm)}-${p2(nd)}`, error: null };
}

/** Tách yyyy-mm-dd thành 3 phần { d, m, y } để khởi tạo DateInput ở chế độ sửa. */
export function splitIsoDate(value: string | null | undefined): { d: string; m: string; y: string } {
  if (!value) return { d: '', m: '', y: '' };
  const [y = '', m = '', d = ''] = value.slice(0, 10).split('-');
  return { d: d.replace(/^0+(?=\d)/, ''), m: m.replace(/^0+(?=\d)/, ''), y };
}

/** Một tiền đề dữ liệu nền: đã có bao nhiêu bản ghi, nhãn, và nơi tạo. */
export interface PrereqDef {
  count: number;
  label: string;
  where: string; // ví dụ: tab 'Trạng thái nhập'
}

/** Danh sách tiền đề đang thiếu (count ≤ 0). */
export function missingPrereqs(defs: PrereqDef[]): PrereqDef[] {
  return defs.filter((x) => x.count <= 0);
}

/**
 * Thông báo gate ĐỘNG: chỉ nêu loại đang thiếu + nơi tạo. null nếu đủ tiền đề.
 * 1 loại → câu gọn, hướng dẫn tab cụ thể. Nhiều loại → liệt kê đúng những loại thiếu.
 */
export function prereqMessage(defs: PrereqDef[]): string | null {
  const miss = missingPrereqs(defs);
  if (miss.length === 0) return null;
  if (miss.length === 1) return `Chưa có ${miss[0].label} — thêm ở ${miss[0].where} trước khi tiếp tục.`;
  return 'Còn thiếu: ' + miss.map((m) => `${m.label} (thêm ở ${m.where})`).join('; ') + '.';
}
