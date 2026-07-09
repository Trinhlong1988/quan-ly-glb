import { useEffect, useState } from 'react';
import { Loader2, Trash2, RotateCcw } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTime } from '@glb/shared';
import type { TrashRow } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Button } from '../components/Button.js';

// E4 Thùng rác (R_TRASH_RESTORE): liệt kê dữ liệu đã xóa mềm, Admin phục hồi.
export function TrashPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<TrashRow | null>(null);
  const canRestore = hasPermission(user, 'TRASH_RESTORE');

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.trashList();
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message, 'Không xem được thùng rác');
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doRestore(r: TrashRow): Promise<void> {
    const res = await window.api.trashRestore(r.entityType, r.id);
    if (res.ok) toast.success(`Đã phục hồi ${r.entityLabel.toLowerCase()} "${r.label}"`);
    else toast.alert(res.message ?? 'Phục hồi thất bại', 'Phục hồi thất bại');
    setConfirm(null);
    await reload();
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Thùng rác</h2>
        <p className="text-sm text-slate-500">
          Dữ liệu đã xóa mềm — chưa mất hẳn. Chỉ quản trị viên được phục hồi. Xóa một mục KHÔNG làm mất dữ liệu liên kết.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Loại</th>
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Tên</th>
              <th className="px-4 py-3">Ngày xóa</th>
              <th className="px-4 py-3">Giờ</th>
              <th className="px-4 py-3 text-right">Phục hồi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  <Trash2 className="mx-auto mb-2 h-6 w-6" /> Thùng rác trống.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={`${r.entityType}-${r.id}`} className="hover:bg-appbg/60">
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">{r.entityLabel}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-brand">{r.code ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{r.label}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(r.deletedAt)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtTime(r.deletedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      {canRestore && (
                        <Button variant="confirm" icon={<RotateCcw className="h-4 w-4" />} className="px-3 py-1.5" onClick={() => setConfirm(r)}>
                          Phục hồi
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {confirm && (
        <ConfirmDialog
          title="Phục hồi dữ liệu"
          message={`Phục hồi ${confirm.entityLabel.toLowerCase()} "${confirm.label}" về trạng thái đang dùng?`}
          confirmLabel="Phục hồi"
          onCancel={() => setConfirm(null)}
          onConfirm={() => doRestore(confirm)}
        />
      )}
    </div>
  );
}
