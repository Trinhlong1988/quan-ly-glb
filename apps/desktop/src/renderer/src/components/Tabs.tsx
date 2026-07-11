// Dải tab dùng chung (R15, Mr.Long 11/7): nền dải ĐẬM (slate-200) nổi rõ, tab active là "viên" trắng
// đổ bóng + chữ brand — phân biệt rõ với nút "Làm mới" (slate-100) và mọi nút khác. Áp cho MỌI trang nhiều tab.
import type { ReactNode } from 'react';

/** Bọc nhóm tab: dải nền đậm bo góc. */
export function TabBar({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mb-4 inline-flex flex-wrap gap-1 rounded-xl bg-slate-200/80 p-1">{children}</div>;
}

/** 1 nút tab dạng "viên". active = nền trắng + bóng + chữ brand; ngược lại chữ xám, hover nền mờ. */
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
        (active ? 'bg-white text-brand shadow-sm' : 'text-slate-600 hover:bg-white/60 hover:text-slate-800')
      }
    >
      {icon}
      {children}
    </button>
  );
}
