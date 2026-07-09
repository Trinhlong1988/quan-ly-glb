/** Status pill (IMS_SPEC §19). Colour by user/role status. */
const MAP: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Hoạt động', cls: 'bg-success/10 text-success' },
  LOCKED: { label: 'Đã khóa', cls: 'bg-danger/10 text-danger' },
  PENDING: { label: 'Chờ kích hoạt', cls: 'bg-warning/10 text-warning' },
  DISABLED: { label: 'Ngưng dùng', cls: 'bg-slate-200 text-slate-500' },
  DELETED: { label: 'Đã xóa', cls: 'bg-slate-200 text-slate-500' }
};

export function StatusPill({ status }: { status: string }): JSX.Element {
  const s = MAP[status] ?? { label: status, cls: 'bg-slate-100 text-slate-500' };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
  );
}
