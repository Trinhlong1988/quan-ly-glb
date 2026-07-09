import type { ButtonHTMLAttributes, ReactNode } from 'react';

// Quy ước màu button theo ngữ nghĩa (R_BUTTON_SEMANTICS, LEAD lock 9/7):
//   confirm = xanh (thực hiện / xác nhận / lưu / thêm mới)
//   edit    = vàng (sửa / chỉnh sửa)
//   danger  = đỏ (xóa)
//   neutral = xám viền (hủy / làm mới / phụ)
export type ButtonVariant = 'confirm' | 'edit' | 'danger' | 'neutral';

const VARIANT: Record<ButtonVariant, string> = {
  confirm: 'bg-brand text-white hover:bg-brand-hover shadow-sm',
  edit: 'bg-warning text-white hover:brightness-95 shadow-sm',
  danger: 'bg-danger text-white hover:brightness-95 shadow-sm',
  neutral: 'border border-line bg-white text-slate-600 hover:bg-appbg'
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
        'disabled:cursor-not-allowed disabled:opacity-60 ' +
        VARIANT[variant] +
        (className ? ' ' + className : '')
      }
    >
      {icon}
      {children}
    </button>
  );
}
