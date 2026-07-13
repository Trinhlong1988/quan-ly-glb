import { useMemo, useState } from 'react';
import { Button } from './Button.js';

/** Hook tích chọn nhiều dòng (§C2 "tích chọn 1 hoặc nhiều"). Dùng chung mọi bảng master. */
export function useRowSelection(): {
  selected: Set<number>;
  isSelected: (id: number) => boolean;
  toggle: (id: number) => void;
  setAll: (ids: number[], on: boolean) => void;
  clear: () => void;
  count: number;
} {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  return useMemo(
    () => ({
      selected,
      isSelected: (id: number) => selected.has(id),
      toggle: (id: number) =>
        setSelected((prev) => {
          const s = new Set(prev);
          if (s.has(id)) s.delete(id);
          else s.add(id);
          return s;
        }),
      setAll: (ids: number[], on: boolean) =>
        setSelected((prev) => {
          const s = new Set(prev);
          for (const id of ids) {
            if (on) s.add(id);
            else s.delete(id);
          }
          return s;
        }),
      clear: () => setSelected(new Set()),
      count: selected.size
    }),
    [selected]
  );
}

/** Ô checkbox header (chọn/bỏ tất cả trang hiện tại). */
export function SelectAllCell({ ids, sel }: { ids: number[]; sel: ReturnType<typeof useRowSelection> }): JSX.Element {
  const allOn = ids.length > 0 && ids.every((id) => sel.isSelected(id));
  return (
    <th className="w-10 px-4 py-3">
      <input
        type="checkbox"
        className="accent-brand"
        checked={allOn}
        aria-label="Chọn tất cả"
        onChange={(e) => sel.setAll(ids, e.target.checked)}
      />
    </th>
  );
}

/** Ô checkbox 1 dòng. */
export function SelectCell({ id, sel }: { id: number; sel: ReturnType<typeof useRowSelection> }): JSX.Element {
  return (
    <td className="px-4 py-3">
      <input type="checkbox" className="accent-brand" checked={sel.isSelected(id)} aria-label={`Chọn dòng ${id}`} onChange={() => sel.toggle(id)} />
    </td>
  );
}

/**
 * Thanh thao tác hàng loạt — hiện khi đã tích ≥1 dòng: "Đã chọn N · Bỏ tích · Xóa đã chọn".
 * Nút Xóa mở ConfirmDialog nhập lại mật khẩu ở component cha (qua onDelete).
 */
export function SelectionBar({ count, entityLabel, onClear, onDelete, actionLabel = 'Xóa đã chọn' }: { count: number; entityLabel: string; onClear: () => void; onDelete: () => void; actionLabel?: string }): JSX.Element | null {
  if (count === 0) return null;
  return (
    <div className="mb-3 flex items-center gap-3 rounded-lg border border-brand/30 bg-brand-tint px-4 py-2.5">
      <span className="text-sm font-medium text-brand">Đã chọn {count} {entityLabel}</span>
      <div className="flex-1" />
      <Button variant="neutral" onClick={onClear}>Bỏ chọn</Button>
      <Button variant="danger" onClick={onDelete}>{actionLabel}</Button>
    </div>
  );
}
