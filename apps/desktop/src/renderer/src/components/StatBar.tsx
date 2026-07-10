// StatBar — thanh bộ đếm trực quan dùng CHUNG cho MỌI trang danh sách (F-STATBAR, Mr.Long 10/7).
// R_UI_STANDARD: 1 component duy nhất, không mỗi trang một kiểu. Nhãn/màu trạng thái LẤY TỪ
// StatusPill (statusLabel/statusTone) — không hardcode lại. Số nguyên nhóm 3 số bằng dấu chấm
// (chuẩn VN, KHÔNG toLocaleString — theo QA gate R_UI).

/** Nhóm 3 số bằng dấu chấm cho số nguyên; chuỗi (vd tiền đã định dạng "1.234đ") giữ nguyên. */
function fmt(v: string | number): string {
  return typeof v === 'number' ? String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : v;
}

export interface StatItem {
  /** Nhãn tiếng Việt của chỉ số (vd "Hoạt động"). */
  label: string;
  /** Giá trị: số → tự nhóm 3 số; chuỗi → hiển thị nguyên (vd tiền). */
  value: string | number;
  /** Class tint (nền + chữ), vd `statusTone('ACTIVE')`. Bỏ trống = xanh brand. */
  tone?: string;
  /** Icon tùy chọn (dùng cho các thẻ KPI tiền — Doanh thu/Công nợ). */
  icon?: JSX.Element;
  /** Dòng phụ nhỏ dưới nhãn (vd "12 giao dịch chưa đối soát"). */
  sub?: string;
}

/**
 * Hàng thẻ đếm gọn ở đầu trang. Responsive (flex-wrap), không phá layout: mỗi thẻ tối thiểu
 * 140px và co giãn đều. Thẻ không có icon → hiện chấm màu theo tone.
 */
export function StatBar({ items }: { items: StatItem[] }): JSX.Element {
  return (
    <div className="mb-4 flex flex-wrap gap-3">
      {items.map((it) => (
        <div key={it.label} className="flex min-w-[140px] flex-1 items-center gap-3 rounded-xl border border-line bg-white p-3 shadow-sm">
          <span className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ' + (it.tone ?? 'bg-brand-tint text-brand')}>
            {it.icon ?? <span className="h-2.5 w-2.5 rounded-full bg-current" />}
          </span>
          <div className="min-w-0">
            <div className="text-xl font-semibold tabular-nums text-slate-800">{fmt(it.value)}</div>
            <div className="truncate text-xs font-medium text-slate-500">{it.label}</div>
            {it.sub && <div className="truncate text-xs text-slate-400">{it.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
