import { useEffect, useMemo, useRef, useState } from 'react';
import { inputCls } from './Field.js';

export interface SearchSelectOption {
  value: string;
  label: string;
}

/**
 * Ô CHỌN CÓ TÌM KIẾM (combobox thuần React, không thư viện ngoài).
 * - Gõ 1–2–3 ký tự → lọc gợi ý theo `label.includes(query)`, ưu tiên `startsWith` lên đầu.
 * - Chọn 1 dòng → set value + hiện label đã chọn; nút ✕ để xóa lựa chọn.
 * - Style đồng bộ `inputCls` (Catppuccin/hiện có). Dùng cho Ngân hàng / HKD / TID.
 */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  disabled?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  const selectedLabel = useMemo(() => options.find((o) => o.value === value)?.label ?? '', [options, value]);

  // Đóng dropdown khi bấm ra ngoài.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent): void {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter((o) => o.label.toLowerCase().includes(q))
      .sort((a, b) => {
        const as = a.label.toLowerCase().startsWith(q) ? 0 : 1;
        const bs = b.label.toLowerCase().startsWith(q) ? 0 : 1;
        return as - bs; // ưu tiên khớp đầu chuỗi; giữ thứ tự gốc trong cùng nhóm
      });
  }, [options, query]);

  function pick(v: string): void {
    onChange(v);
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        {/* Kính lúp bên trái → nhìn là biết Ô TÌM KIẾM (Mr.Long "phải có box tìm kiếm chứ"). */}
        <svg viewBox="0 0 20 20" className={'pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 ' + (disabled ? 'text-slate-300' : 'text-slate-400')} fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="9" cy="9" r="6" /><path d="M14 14l3.5 3.5" strokeLinecap="round" />
        </svg>
        <input
          className={inputCls + ' w-full pl-9 pr-8' + (disabled ? ' cursor-not-allowed bg-slate-50 text-slate-400' : '')}
          value={open ? query : selectedLabel}
          placeholder={disabled ? placeholder : (placeholder ? placeholder + ' — gõ để tìm' : 'Gõ để tìm…')}
          disabled={disabled}
          onFocus={() => { if (!disabled) { setOpen(true); setQuery(''); } }}
          onClick={() => { if (!disabled && !open) { setOpen(true); setQuery(''); } }}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
        />
        {value && !disabled ? (
          <button
            type="button"
            title="Xóa lựa chọn"
            tabIndex={-1}
            onMouseDown={(e) => { e.preventDefault(); pick(''); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" /></svg>
          </button>
        ) : (
          !disabled && <svg viewBox="0 0 20 20" className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        )}
      </div>
      {open && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-line bg-white py-1 shadow-lg">
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">Không có kết quả phù hợp.</li>}
          {filtered.map((o) => (
            <li
              key={o.value}
              onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
              className={'cursor-pointer px-3 py-2 text-sm transition hover:bg-brand-tint hover:text-brand ' + (o.value === value ? 'bg-brand-tint/50 font-medium text-brand' : 'text-slate-700')}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
