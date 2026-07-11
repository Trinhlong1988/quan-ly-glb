// Badge + danh mục trạng thái tùy biến dùng chung (R14). Đọc options theo entity từ StatusOption,
// cache module-level (1 lần/entity), tự cập nhật khi có trang gọi reload. Dùng cho MỌI cột/ô/bộ đếm trạng thái.
import { useEffect, useState } from 'react';
import type { StatusOptionDto } from '../../../preload/index.d';

// Ánh xạ tone (danh mục) → lớp màu badge (khớp design system). Literal đầy đủ để Tailwind quét được.
export const STATUS_TONE_CLS: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  slate: 'bg-slate-100 text-slate-500',
  rose: 'bg-rose-50 text-rose-600',
  sky: 'bg-sky-50 text-sky-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  violet: 'bg-violet-50 text-violet-600',
  brand: 'bg-brand-tint text-brand'
};
export function toneCls(tone: string | undefined): string {
  return STATUS_TONE_CLS[tone ?? 'slate'] ?? STATUS_TONE_CLS.slate;
}

const cache = new Map<string, StatusOptionDto[]>();
const listeners = new Map<string, Set<() => void>>();

/** Nạp options 1 entity (gồm cả inactive để badge trạng thái đã ẩn vẫn hiện đúng nhãn). */
export async function loadStatusOptions(entity: string, force = false): Promise<StatusOptionDto[]> {
  if (!force && cache.has(entity)) return cache.get(entity) as StatusOptionDto[];
  const r = await window.api.statusOptionList(entity, true);
  const data = r.ok && r.data ? r.data : [];
  cache.set(entity, data);
  listeners.get(entity)?.forEach((fn) => fn());
  return data;
}

/** Hook: options theo entity (auto-nạp + tự cập nhật khi reload). `byCode` để tra nhanh code→option. */
export function useStatusOptions(entity: string): {
  options: StatusOptionDto[];
  byCode: Map<string, StatusOptionDto>;
  reload: () => void;
} {
  const [options, setOptions] = useState<StatusOptionDto[]>(cache.get(entity) ?? []);
  useEffect(() => {
    let alive = true;
    const fn = (): void => {
      if (alive) setOptions([...(cache.get(entity) ?? [])]);
    };
    let set = listeners.get(entity);
    if (!set) {
      set = new Set();
      listeners.set(entity, set);
    }
    set.add(fn);
    void loadStatusOptions(entity).then(fn);
    return () => {
      alive = false;
      set?.delete(fn);
    };
  }, [entity]);
  const byCode = new Map(options.map((o) => [o.code, o]));
  return { options, byCode, reload: () => void loadStatusOptions(entity, true) };
}

/** Badge trạng thái: tra nhãn + màu từ danh mục theo (entity, code). Không tìm thấy → hiện code, màu slate. */
export function StatusBadge({ entity, code }: { entity: string; code: string | null | undefined }): JSX.Element {
  const { byCode } = useStatusOptions(entity);
  const o = code ? byCode.get(code) : undefined;
  return <span className={'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' + toneCls(o?.tone)}>{o?.label ?? code ?? '—'}</span>;
}

/** `<option>` cho select trạng thái (chỉ active + luôn gồm giá trị hiện tại nếu đã ẩn). */
export function statusSelectOptions(options: StatusOptionDto[], current?: string | null): StatusOptionDto[] {
  const out = options.filter((o) => o.active || o.code === current);
  return out;
}
