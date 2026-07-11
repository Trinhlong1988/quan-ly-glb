import { useEffect, useState } from 'react';
import { Loader2, Trash2, RotateCcw, ShieldAlert, Loader, Download, RefreshCw } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTime } from '@glb/shared';
import type { TrashRow } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Button } from '../components/Button.js';
import { StatBar } from '../components/StatBar.js';
import { Modal } from '../components/Modal.js';
import { Field } from '../components/Field.js';
import { PasswordInput } from '../components/PasswordInput.js';
import { exportCsv } from '../lib/exportCsv.js';

// E4 Thùng rác (R_TRASH_RESTORE): liệt kê dữ liệu đã xóa mềm, Admin phục hồi.
export function TrashPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<TrashRow | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<TrashRow | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const canRestore = hasPermission(user, 'TRASH_RESTORE');
  const canPurge = hasPermission(user, 'TRASH_PURGE');
  const canViewAll = hasPermission(user, 'TRASH_VIEW_ALL');
  const cols = canViewAll ? 7 : 6;
  // Tông màu luân phiên (palette) cho bộ đếm theo LOẠI dữ liệu.
  const KIND_TONES = ['bg-indigo-50 text-indigo-600', 'bg-emerald-50 text-emerald-600', 'bg-amber-50 text-amber-600', 'bg-sky-50 text-sky-600', 'bg-violet-50 text-violet-600', 'bg-rose-50 text-rose-600'];
  // Gộp theo entityLabel (kind) — đếm CLIENT từ trashList (trả full, không phân trang).
  const byKind = Array.from(
    rows.reduce((m, r) => m.set(r.entityLabel, (m.get(r.entityLabel) ?? 0) + 1), new Map<string, number>())
  ).map(([label, value], i) => ({ label, value, tone: KIND_TONES[i % KIND_TONES.length] }));

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

  async function doPurge(r: TrashRow, password?: string): Promise<void> {
    const res = await window.api.trashPurge(r.entityType, r.id, password ?? '');
    if (res.ok) toast.success(`Đã xóa vĩnh viễn ${r.entityLabel.toLowerCase()} "${r.label}"`);
    else toast.alert(res.message ?? 'Xóa vĩnh viễn thất bại', 'Xóa vĩnh viễn thất bại');
    setPurgeTarget(null);
    await reload();
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Thùng rác</h2>
          <p className="text-sm text-slate-500">
            Dữ liệu đã xóa mềm — chưa mất hẳn. Phục hồi để dùng lại, hoặc <b>xóa vĩnh viễn</b> (không thể khôi phục).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reload} title="Tải lại dữ liệu mới nhất" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-brand/10 text-brand hover:bg-brand/20">
            <RefreshCw className="h-4 w-4" /> Làm mới
          </button>
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('thung_rac', ['Loại', 'Mã', 'Tên', 'Người xóa', 'Ngày xóa', 'Giờ'], rows.map((r) => [r.entityLabel, r.code ?? '', r.label, r.deletedByName ?? '', fmtDate(r.deletedAt), fmtTime(r.deletedAt)]))}>
            Xuất Excel
          </Button>
          {canPurge && rows.length > 0 && (
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setShowEmpty(true)}>
              Dọn sạch thùng rác
            </Button>
          )}
        </div>
      </div>

      <StatBar items={[{ label: 'Tổng mục', value: rows.length, tone: 'bg-brand-tint text-brand' }, ...byKind]} />

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Loại</th>
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Tên</th>
              {canViewAll && <th className="px-4 py-3">Người xóa</th>}
              <th className="px-4 py-3">Ngày xóa</th>
              <th className="px-4 py-3">Giờ</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={cols} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={cols} className="px-4 py-10 text-center text-slate-400">
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
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-brand whitespace-nowrap">{r.code ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{r.label}</td>
                  {canViewAll && <td className="px-4 py-3 text-slate-600">{r.deletedByName ?? '—'}</td>}
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(r.deletedAt)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtTime(r.deletedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canRestore && (
                        <Button variant="confirm" icon={<RotateCcw className="h-4 w-4" />} className="px-3 py-1.5" onClick={() => setConfirm(r)}>
                          Phục hồi
                        </Button>
                      )}
                      {canPurge && (
                        <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} className="px-3 py-1.5" onClick={() => setPurgeTarget(r)}>
                          Xóa vĩnh viễn
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
      {purgeTarget && (
        <ConfirmDialog
          title="Xóa vĩnh viễn"
          message={`Xóa VĨNH VIỄN ${purgeTarget.entityLabel.toLowerCase()} "${purgeTarget.label}"? Hành động này KHÔNG THỂ khôi phục. Nhập lại mật khẩu để xác nhận.`}
          confirmLabel="Xóa vĩnh viễn"
          danger
          requirePassword
          onCancel={() => setPurgeTarget(null)}
          onConfirm={(pwd) => doPurge(purgeTarget, pwd)}
        />
      )}
      {showEmpty && <EmptyTrashModal count={rows.length} onClose={() => setShowEmpty(false)} onDone={reload} />}
    </div>
  );
}

/** Dọn sạch TOÀN BỘ thùng rác — yêu cầu MẬT KHẨU CẤP 2 (chống phá hoại). */
function EmptyTrashModal({ count, onClose, onDone }: { count: number; onClose: () => void; onDone: () => void }): JSX.Element {
  const toast = useToast();
  const [level2, setLevel2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await window.api.trashEmptyAll(level2);
      if (res.ok) {
        toast.success(`Đã dọn sạch thùng rác — xóa vĩnh viễn ${res.purged ?? 0} bản ghi.`);
        onDone();
        onClose();
      } else {
        setError(res.message ?? 'Dọn sạch thất bại.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Dọn sạch thùng rác" onClose={onClose} width="max-w-md">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-slate-600">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span>
            Sẽ <b className="text-danger">xóa vĩnh viễn {count} bản ghi</b> đang trong thùng rác. Hành động KHÔNG THỂ khôi
            phục. Nhập <b>mật khẩu cấp 2</b> để xác nhận.
          </span>
        </div>
        <Field label="Mật khẩu cấp 2" required>
          <PasswordInput value={level2} onChange={(e) => setLevel2(e.target.value)} autoFocus />
        </Field>
        {error && <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>}
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="neutral" onClick={onClose}>Hủy</Button>
          <Button type="submit" variant="danger" disabled={busy} icon={busy ? <Loader className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}>
            Dọn sạch vĩnh viễn
          </Button>
        </div>
      </form>
    </Modal>
  );
}
