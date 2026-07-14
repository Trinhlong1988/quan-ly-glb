import { useState, useMemo, useEffect } from 'react';

/**
 * Phân trang CLIENT-SIDE dùng chung (Mr.Long 14/7 "chỉ để nền 50 trong 1 trang, trên 50 sang trang 2").
 * - Hook `usePagination(rows, pageSize=50)` → { pageRows, bar } : cắt rows theo trang + thanh điều hướng.
 * - Reset về trang 1 khi TỔNG số dòng đổi (đổi bộ lọc/tìm kiếm → danh sách đổi → về trang 1).
 * - Thanh hiện "Hiển thị a–b / tổng N" + Trước/Sau + "Trang X/Y".
 */
export function usePagination<T>(rows: T[], pageSize = 50): { pageRows: T[]; bar: JSX.Element | null } {
  const [page, setPage] = useState(1);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Đổi tổng số dòng (lọc/tìm) → về trang 1. Kẹp page trong [1, pageCount].
  useEffect(() => { setPage(1); }, [total]);
  const cur = Math.min(page, pageCount);
  const pageRows = useMemo(() => rows.slice((cur - 1) * pageSize, cur * pageSize), [rows, cur, pageSize]);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(cur * pageSize, total);

  const bar =
    total <= pageSize ? null : (
      <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
        <span>Hiển thị <b className="text-slate-700">{from}–{to}</b> / tổng <b className="text-slate-700">{total}</b></span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={cur <= 1}
            className="rounded-md border border-line px-3 py-1 text-slate-600 enabled:hover:bg-appbg disabled:opacity-40"
          >
            ← Trước
          </button>
          <span className="px-2">Trang <b className="text-slate-700">{cur}</b>/{pageCount}</span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={cur >= pageCount}
            className="rounded-md border border-line px-3 py-1 text-slate-600 enabled:hover:bg-appbg disabled:opacity-40"
          >
            Sau →
          </button>
        </div>
      </div>
    );
  return { pageRows, bar };
}
