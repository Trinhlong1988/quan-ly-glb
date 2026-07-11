import { useEffect, useRef } from 'react';
import { Search, FilterX, RefreshCw } from 'lucide-react';
import { inputCls } from './Field.js';

/** A dropdown dimension (đại lý, ngân hàng, trạng thái, vai trò…). */
export interface FilterSelect {
  key: string;
  placeholder: string; // e.g. "Tất cả trạng thái"
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

/**
 * Reusable filter bar (R_UX_FILTER): text search + từ ngày → đến ngày + N dimension selects
 * + Lọc + Xóa lọc. All filtering is server-side — this only collects params.
 */
export function FilterBar({
  search,
  onSearch,
  searchPlaceholder = 'Tìm kiếm…',
  fromDate,
  toDate,
  onFromDate,
  onToDate,
  selects = [],
  onApply,
  onReset,
  onRefresh,
  debounceMs = 300
}: {
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  fromDate?: string;
  toDate?: string;
  onFromDate?: (v: string) => void;
  onToDate?: (v: string) => void;
  selects?: FilterSelect[];
  onApply: () => void;
  onReset: () => void;
  /** Tải lại dữ liệu mới nhất (giữ nguyên bộ lọc). Mặc định = onApply (re-query với filter hiện tại). */
  onRefresh?: () => void;
  /** Độ trễ (ms) lọc realtime khi gõ ô tìm kiếm. 0 = tắt debounce (chỉ lọc khi Enter/bấm Lọc). */
  debounceMs?: number;
}): JSX.Element {
  const showDates = !!onFromDate && !!onToDate;

  // Lọc realtime: gõ xong ~debounceMs mà không gõ tiếp → tự gọi onApply (không gọi mỗi ký tự).
  // Dùng ref để luôn gọi onApply mới nhất (đọc state hiện tại của trang) mà không cần thêm vào deps.
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleSearch = (v: string): void => {
    onSearch(v);
    if (debounceMs <= 0) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onApplyRef.current(), debounceMs);
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (timerRef.current) clearTimeout(timerRef.current);
              onApply();
            }
          }}
          placeholder={searchPlaceholder}
          className={inputCls + ' w-64 pl-8'}
        />
      </div>

      {showDates && (
        <div className="flex items-center gap-1 text-sm text-slate-500">
          <span className="text-xs">Từ</span>
          <input type="date" className={inputCls} value={fromDate ?? ''} onChange={(e) => onFromDate!(e.target.value)} />
          <span className="text-xs">đến</span>
          <input type="date" className={inputCls} value={toDate ?? ''} onChange={(e) => onToDate!(e.target.value)} />
        </div>
      )}

      {selects.map((s) => (
        <select key={s.key} className={inputCls} value={s.value} onChange={(e) => s.onChange(e.target.value)}>
          <option value="">{s.placeholder}</option>
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}

      <button onClick={onApply} className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-hover">
        Lọc
      </button>
      <button
        onClick={onReset}
        title="Xóa toàn bộ bộ lọc, đưa về mặc định"
        className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-brand/10 text-brand hover:bg-brand/20"
      >
        <FilterX className="h-4 w-4" /> Xóa lọc
      </button>
      <button
        onClick={onRefresh ?? onApply}
        title="Tải lại dữ liệu mới nhất (giữ nguyên bộ lọc)"
        className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
      >
        <RefreshCw className="h-4 w-4" /> Làm mới
      </button>
    </div>
  );
}
