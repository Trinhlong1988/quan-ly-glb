/** Status pill (IMS_SPEC §19). Colour by user/role status. */
const MAP: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Hoạt động', cls: 'bg-success/10 text-success' },
  LOCKED: { label: 'Đã khóa', cls: 'bg-danger/10 text-danger' },
  PENDING: { label: 'Chờ kích hoạt', cls: 'bg-warning/10 text-warning' },
  DISABLED: { label: 'Ngưng dùng', cls: 'bg-slate-200 text-slate-500' },
  DELETED: { label: 'Đã xóa', cls: 'bg-slate-200 text-slate-500' },
  // POS device statuses (§A3)
  IN_STOCK: { label: 'Trong kho', cls: 'bg-slate-100 text-slate-600' },
  DEPLOYED: { label: 'Đã triển khai', cls: 'bg-success/10 text-success' },
  IN_REPAIR: { label: 'Đang sửa', cls: 'bg-warning/10 text-warning' },
  DAMAGED: { label: 'Hư hỏng', cls: 'bg-danger/10 text-danger' },
  RETIRED: { label: 'Đã thanh lý', cls: 'bg-slate-200 text-slate-500' },
  // TID statuses (§A3)
  UNASSIGNED: { label: 'Chưa gán', cls: 'bg-warning/10 text-warning' },
  DEAD: { label: 'TID chết', cls: 'bg-danger/10 text-danger' },
  CLOSED: { label: 'Đã đóng', cls: 'bg-slate-200 text-slate-500' },
  RECALLED: { label: 'Đã thu hồi', cls: 'bg-slate-200 text-slate-500' }
};

export function StatusPill({ status }: { status: string }): JSX.Element {
  const s = MAP[status] ?? { label: status, cls: 'bg-slate-100 text-slate-500' };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
  );
}

/** Nhãn tiếng Việt của một mã trạng thái (dùng cho dropdown lọc, tránh hiện enum trần). */
export function statusLabel(status: string): string {
  return MAP[status]?.label ?? status;
}

/**
 * Bộ class màu (tint nền + chữ) của một mã trạng thái — nguồn màu DUY NHẤT để StatBar/badge
 * tô màu bộ đếm trạng thái đồng bộ với StatusPill (R_UI_STANDARD: không hardcode lại màu).
 */
export function statusTone(status: string): string {
  return MAP[status]?.cls ?? 'bg-slate-100 text-slate-500';
}
