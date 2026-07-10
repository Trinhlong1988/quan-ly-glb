import type { ButtonHTMLAttributes, ReactNode } from 'react';

// Quy ước màu button theo ngữ nghĩa (R_BUTTON_SEMANTICS, LEAD lock 9/7):
//   confirm = xanh (thực hiện / xác nhận / lưu / thêm mới / xuất Excel)
//   edit    = vàng (sửa / chỉnh sửa)
//   danger  = đỏ (xóa)
//   soft    = xanh nhạt (làm mới / tải lại nhẹ — không viền, phân biệt với neutral)
//   neutral = xám viền (hủy / xóa lọc / phụ)
export type ButtonVariant = 'confirm' | 'edit' | 'danger' | 'soft' | 'neutral';

// R_UI_HOVER (Mr.Long chốt 10/7): hover nút = "sáng nhẹ" (brightness) đồng nhất mọi variant, GIỮ
// NGUYÊN màu nền — hiệu ứng sáng nhẹ nằm ở base className (enabled:hover:brightness-110) nên đây chỉ
// khai báo nền/chữ/viền theo ngữ nghĩa, KHÔNG đặt hover riêng (tránh lệch chuẩn / đá nhau).
const VARIANT: Record<ButtonVariant, string> = {
  confirm: 'bg-brand text-white shadow-sm',
  edit: 'bg-warning text-white shadow-sm',
  danger: 'bg-danger text-white shadow-sm',
  soft: 'bg-brand/10 text-brand',
  neutral: 'border border-line bg-white text-slate-600'
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
  children: ReactNode;
}

export function Button({ variant = 'confirm', icon, children, className = '', disabled, ...rest }: Props): JSX.Element {
  return (
    <button
      {...rest}
      disabled={disabled}
      className={
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ' +
        'enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ' +
        VARIANT[variant] +
        (className ? ' ' + className : '')
      }
    >
      {icon}
      {children}
    </button>
  );
}
