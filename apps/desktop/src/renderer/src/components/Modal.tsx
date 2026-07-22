import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Centered modal with backdrop. Esc + backdrop click close (via onClose).
 * onSubmit (tùy chọn, FIX 5): nếu truyền, nhấn Enter trong modal sẽ gọi onSubmit —
 * BỎ QUA khi focus đang ở <textarea> hoặc <select> (đang chọn dropdown) hoặc ô contentEditable.
 *
 * B84 (Mr.Long báo 22/7, ảnh modal "Thêm đối tác" bị che cả đầu lẫn cuối): `.page-enter` (hiệu ứng
 * 3D chuyển trang, styles.css) khai `will-change: transform` — theo spec CSS, will-change:transform
 * trên 1 phần tử biến nó thành CONTAINING BLOCK cho MỌI hậu duệ `position:fixed`. Modal này vốn định
 * `fixed inset-0` để phủ TOÀN cửa sổ, nhưng vì luôn được mở từ bên trong 1 trang bọc `.page-enter`,
 * nó bị "nhốt" khung tọa độ vào bên trong khối `.page-enter` (nhỏ hơn viewport, nằm dưới TitleBar +
 * topbar) rồi bị `overflow-hidden` của tổ tiên cắt cụt — modal cao hơn khung đó thì cả đầu (tiêu đề +
 * nút đóng) lẫn cuối (nút Lưu/Hủy) đều mất, y hệt ảnh chụp. Fix: `createPortal` ra thẳng
 * `document.body` — thoát khỏi MỌI containing-block của cây trang, modal luôn phủ đúng viewport thật
 * dù trang cha có hiệu ứng transform/will-change gì đi nữa (miễn nhiễm vĩnh viễn, không chỉ vá `.page-enter`).
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

  // FE-07 (Codex 15/7): chốt chống Enter kép — 2 lần Enter nhanh trước khi nút disabled re-render sẽ gọi
  // onSubmit 2 lần (double-submit destructive). Ref latch chặn lần thứ 2 trong 600ms.
  const submitLock = useRef(false);
  const guardedSubmit = (): void => {
    if (submitLock.current) return;
    submitLock.current = true;
    onSubmit?.();
    setTimeout(() => { submitLock.current = false; }, 600);
  };

  return createPortal(
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
                guardedSubmit();
              }
            : undefined
        }
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-appbg hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-auto p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
