import { Search, FilterX } from 'lucide-react';
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
  onReset
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
}): JSX.Element {
  const showDates = !!onFromDate && !!onToDate;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onApply()}
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
        className="flex items-center gap-1 rounded-md border border-line px-3 py-2 text-sm text-slate-600 hover:bg-appbg"
      >
        <FilterX className="h-4 w-4" /> Xóa lọc
      </button>
    </div>
  );
}
