import { useEffect, useState } from 'react';
import { DatabaseBackup, Loader2, RotateCcw, HardDriveDownload, RefreshCw } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDateTime } from '@glb/shared';
import type { BackupDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';

export function BackupPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<BackupDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupDto | null>(null);

  const canCreate = hasPermission(user, 'BACKUP_CREATE');
  const canRestore = hasPermission(user, 'BACKUP_RESTORE');

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.backupList();
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createBackup(): Promise<void> {
    setCreating(true);
    const res = await window.api.backupCreate('Manual backup');
    setCreating(false);
    if (res.ok) toast.success('Đã tạo backup thành công');
    else toast.alert(res.message ?? 'Tạo backup thất bại');
    await reload();
  }

  async function doRestore(b: BackupDto, password?: string): Promise<void> {
    const res = await window.api.backupRestore(b.filePath, password ?? '');
    if (res.ok) toast.success(res.message ?? 'Đã khôi phục');
    else toast.alert(res.message ?? 'Khôi phục thất bại');
    setRestoreTarget(null);
    await reload();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Sao lưu & Phục hồi</h2>
          <p className="text-sm text-slate-500">Sao lưu & phục hồi cơ sở dữ liệu tại máy. Phục hồi yêu cầu mật khẩu quản trị.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reload} title="Tải lại dữ liệu mới nhất" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200">
            <RefreshCw className="h-4 w-4" /> Làm mới
          </button>
          {canCreate && (
            <button
              onClick={createBackup}
              disabled={creating}
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />}
              Tạo bản sao lưu ngay
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Tên file</th>
              <th className="px-4 py-3">Thời gian</th>
              <th className="px-4 py-3">Kích thước</th>
              <th className="px-4 py-3">Checksum</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  <DatabaseBackup className="mx-auto mb-2 h-6 w-6" /> Chưa có bản sao lưu nào.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((b) => (
                <tr key={b.id} className="hover:bg-appbg/60">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {b.fileName}
                    {!b.exists && <span className="ml-2 text-danger">(mất file)</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(b.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-600">{b.fileSize ? `${(b.fileSize / 1024).toFixed(1)} KB` : '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{b.checksum?.slice(0, 16) ?? '—'}…</td>
                  <td className="px-4 py-3 text-right">
                    {canRestore && b.exists && (
                      <button
                        onClick={() => setRestoreTarget(b)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-appbg"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Khôi phục
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {restoreTarget && (
        <ConfirmDialog
          title="Khôi phục từ backup"
          message={`Khôi phục dữ liệu từ "${restoreTarget.fileName}". Hệ thống sẽ tự sao lưu hiện trạng trước khi khôi phục. Nhập lại mật khẩu Admin để xác nhận.`}
          confirmLabel="Khôi phục"
          danger
          requirePassword
          onCancel={() => setRestoreTarget(null)}
          onConfirm={(pwd) => doRestore(restoreTarget, pwd)}
        />
      )}
    </div>
  );
}
