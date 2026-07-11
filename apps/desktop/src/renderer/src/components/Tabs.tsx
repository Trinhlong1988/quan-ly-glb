// Dải tab dùng chung (R15/R16, Mr.Long 11/7): nền dải XANH BRAND đậm (bg-brand/20) — đậm hơn nút "Xóa lọc"
// (bg-brand/10) và "Làm mới", KHÔNG phải màu ghi. Tab active là "viên" trắng đổ bóng + chữ brand nổi rõ.
// Áp cho MỌI trang nhiều tab.
import type { ReactNode } from 'react';

/** Bọc nhóm tab: dải nền xanh brand đậm bo góc. */
export function TabBar({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mb-4 inline-flex flex-wrap gap-1 rounded-xl bg-brand/20 p-1">{children}</div>;
}

/** 1 nút tab dạng "viên". active = nền trắng + bóng + chữ brand; ngược lại chữ brand mờ, hover nền trắng mờ. */
export function TabButton({
  active,
  onClick,
  icon,
  children
}: {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={
        'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ' +
        (active ? 'bg-white text-brand shadow-sm' : 'text-brand/70 hover:bg-white/60 hover:text-brand')
      }
    >
      {icon}
      {children}
    </button>
  );
}
