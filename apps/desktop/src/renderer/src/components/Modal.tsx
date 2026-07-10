import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Centered modal with backdrop. Esc + backdrop click close (via onClose).
 * onSubmit (tùy chọn, FIX 5): nếu truyền, nhấn Enter trong modal sẽ gọi onSubmit —
 * BỎ QUA khi focus đang ở <textarea> hoặc <select> (đang chọn dropdown) hoặc ô contentEditable.
 */
export function Modal({
  title,
  onClose,
  children,
  width = 'max-w-lg',
  onSubmit
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  onSubmit?: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${width} rounded-xl border border-line bg-white shadow-2xl`}
        onKeyDown={
          onSubmit
            ? (e) => {
                if (e.key !== 'Enter' || e.shiftKey) return;
                const t = e.target as HTMLElement;
                if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
                e.preventDefault();
                onSubmit();
              }
            : undefined
        }
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-appbg hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}
