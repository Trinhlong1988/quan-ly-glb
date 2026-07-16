// Đọc số tiền VND thành chữ tiếng Việt (port từ globeway-renbill/lib/vn-num.js, giữ nguyên thuật toán).
const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function read3(n: number, isHigh: boolean): string {
  const tr = Math.floor(n / 100);
  const ch = Math.floor((n % 100) / 10);
  const dv = n % 10;
  const parts: string[] = [];
  if (tr > 0) parts.push(DIGITS[tr] + ' trăm');
  else if (isHigh && (ch > 0 || dv > 0)) parts.push('không trăm');

  if (ch > 1) {
    parts.push(DIGITS[ch] + ' mươi');
    if (dv === 1) parts.push('mốt');
    else if (dv === 5) parts.push('lăm');
    else if (dv > 0) parts.push(DIGITS[dv]);
  } else if (ch === 1) {
    parts.push('mười');
    if (dv === 5) parts.push('lăm');
    else if (dv > 0) parts.push(DIGITS[dv]);
  } else if (ch === 0 && dv > 0) {
    if (tr > 0 || isHigh) parts.push('lẻ');
    parts.push(DIGITS[dv]);
  }
  return parts.join(' ').trim();
}

export function readVN(input: number): string {
  const num = Math.round(Number(input));
  if (!Number.isFinite(num) || num < 0) return '';
  if (num === 0) return 'không';

  const ty = Math.floor(num / 1_000_000_000);
  const tr = Math.floor((num % 1_000_000_000) / 1_000_000);
  const ng = Math.floor((num % 1_000_000) / 1_000);
  const dv = num % 1_000;

  const parts: string[] = [];
  if (ty > 0) parts.push(read3(ty, false) + ' tỷ');
  if (tr > 0) parts.push(read3(tr, ty > 0) + ' triệu');
  if (ng > 0) parts.push(read3(ng, ty > 0 || tr > 0) + ' nghìn');
  if (dv > 0) parts.push(read3(dv, ty > 0 || tr > 0 || ng > 0));

  return parts.join(' ').trim();
}

export function readVNCapitalized(num: number): string {
  const s = readVN(num);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
