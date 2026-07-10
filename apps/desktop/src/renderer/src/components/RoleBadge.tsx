// RoleBadge — badge nhỏ MÀU hiển thị vai trò VIẾT TẮT cạnh mã NV (Q-E option C, Mr.Long 10/7).
// Mã NV giữ nguyên (không ghép chữ vào mã). Dùng lại kiểu pill của StatusPill (text-xs font-medium,
// tint theo palette design system). Nhiều vai → hiện VAI CAO NHẤT + hậu tố "+n" gọn, tooltip liệt kê đủ.
import { roleLabel, ROLE_CODES } from '@glb/shared';

/** Viết tắt + tint màu (palette) cho các vai trò hệ thống. Vai tùy biến suy từ chữ cái đầu. */
const ROLE_META: Record<string, { abbr: string; tone: string }> = {
  ADMIN: { abbr: 'AD', tone: 'bg-danger/10 text-danger' },
  MANAGER: { abbr: 'QL', tone: 'bg-brand/10 text-brand' },
  D_MANAGER: { abbr: 'PQL', tone: 'bg-brand/10 text-brand' },
  ACCOUNTANT: { abbr: 'KT', tone: 'bg-success/10 text-success' },
  TECHNICIAN: { abbr: 'KTV', tone: 'bg-warning/10 text-warning' },
  SUPPORT: { abbr: 'HT', tone: 'bg-warning/10 text-warning' },
  WAREHOUSE: { abbr: 'KHO', tone: 'bg-slate-100 text-slate-600' },
  SALES: { abbr: 'KD', tone: 'bg-success/10 text-success' },
  CUSTOMER: { abbr: 'KH', tone: 'bg-slate-100 text-slate-600' }
};

const FALLBACK_TONE = 'bg-slate-100 text-slate-600';

/** Viết tắt của 1 mã vai trò: hệ thống → map; tùy biến → chữ cái đầu mỗi từ (≤3) hoặc 2 ký tự đầu. */
function abbrevFor(code: string): string {
  if (ROLE_META[code]) return ROLE_META[code].abbr;
  const name = roleLabel(code).trim();
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** Vai CAO NHẤT theo thứ tự ROLE_CODES (ADMIN đứng đầu = cao nhất); vai tùy biến xếp sau. */
function highestRole(roles: string[]): string | null {
  if (!roles || roles.length === 0) return null;
  const rank = (c: string): number => {
    const i = ROLE_CODES.indexOf(c);
    return i === -1 ? 999 : i;
  };
  return [...roles].sort((a, b) => rank(a) - rank(b))[0];
}

export function RoleBadge({ roles }: { roles: string[] }): JSX.Element | null {
  const top = highestRole(roles);
  if (!top) return null;
  const tone = ROLE_META[top]?.tone ?? FALLBACK_TONE;
  const extra = roles.length - 1;
  const title = roles.map(roleLabel).join(', ');
  return (
    <span title={title} className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium ${tone}`}>
      {abbrevFor(top)}
      {extra > 0 && <span className="opacity-60">+{extra}</span>}
    </span>
  );
}
