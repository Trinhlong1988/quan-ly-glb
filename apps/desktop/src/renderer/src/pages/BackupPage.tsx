import { useEffect, useState } from 'react';
import { DatabaseBackup, Loader2, RotateCcw, HardDriveDownload, RefreshCw, Copy, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDateTime } from '@glb/shared';
import type { BackupDto, BackupMirrorConfig } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { StatBar } from '../components/StatBar.js';
import { Field, inputCls } from '../components/Field.js';

/** Dung lượng gọn: <1MB → KB, còn lại → MB (số thập phân dùng dấu phẩy — chuẩn VN). */
function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (Math.round((bytes / 1024 / 1024) * 10) / 10).toString().replace('.', ',') + ' MB';
  return (Math.round((bytes / 1024) * 10) / 10).toString().replace('.', ',') + ' KB';
}

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
          <button onClick={reload} title="Tải lại dữ liệu mới nhất" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-brand/10 text-brand hover:bg-brand/20">
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

      {/* Bộ đếm — đếm CLIENT từ backupList (trả full, không phân trang). */}
      <StatBar
        items={[
          { label: 'Tổng bản sao lưu', value: rows.length, tone: 'bg-brand-tint text-brand' },
          { label: 'Còn file', value: rows.filter((b) => b.exists).length, tone: 'bg-success/10 text-success' },
          { label: 'Mất file', value: rows.filter((b) => !b.exists).length, tone: 'bg-danger/10 text-danger' },
          { label: 'Tổng dung lượng', value: fmtSize(rows.reduce((s, b) => s + (b.fileSize ?? 0), 0)) }
        ]}
      />

      <MirrorPanel canEdit={canRestore} />

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

/** R48 Pha 5 — Sao lưu TẦNG 2: nhân bản mỗi bản sao lưu ra thư mục khác (ổ ngoài/NAS) + giữ N bản. */
function MirrorPanel({ canEdit }: { canEdit: boolean }): JSX.Element {
  const toast = useToast();
  const [cfg, setCfg] = useState<BackupMirrorConfig | null>(null);
  const [editing, setEditing] = useState(false);
  const [dir, setDir] = useState('');
  const [keep, setKeep] = useState('30');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    const res = await window.api.backupMirrorConfigGet();
    if (res.ok && res.data) {
      setCfg(res.data);
      setDir(res.data.mirrorDir ?? '');
      setKeep(String(res.data.keep));
    }
  }
  useEffect(() => { void load(); }, []);

  async function save(): Promise<void> {
    if (!password) return toast.alert('Nhập mật khẩu để xác nhận đổi cấu hình sao lưu.', 'Cần mật khẩu');
    setBusy(true);
    const res = await window.api.backupMirrorConfigSet({ mirrorDir: dir.trim() || null, keep: Number(keep) || 30 }, password);
    setBusy(false);
    if (res.ok) { toast.success(dir.trim() ? 'Đã bật/cập nhật sao lưu tầng 2' : 'Đã tắt sao lưu tầng 2'); setEditing(false); setPassword(''); await load(); }
    else toast.alert(res.message ?? 'Lưu cấu hình thất bại', 'Không lưu được');
  }

  const on = !!cfg?.mirrorDir;
  return (
    <div className="mb-4 rounded-xl border border-line bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Copy className="h-4 w-4 text-brand" />
          <div>
            <div className="text-sm font-semibold text-slate-700">Sao lưu tầng 2 (nhân bản ra nơi khác)</div>
            <div className="text-xs text-slate-500">Mỗi bản sao lưu tự copy sang ổ/thư mục khác để hỏng ổ không mất cả gốc lẫn backup.</div>
          </div>
        </div>
        {canEdit && !editing && (
          <button onClick={() => setEditing(true)} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-appbg">
            {on ? 'Đổi cấu hình' : 'Bật ngay'}
          </button>
        )}
      </div>

      {!editing && (
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          {on ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Đang bật</span>
              <span className="text-slate-600">Thư mục: <span className="font-mono text-xs">{cfg!.mirrorDir}</span></span>
              <span className="text-slate-500">Giữ {cfg!.keep} bản</span>
              {cfg!.lastMirrorAt && (
                <span className={cfg!.lastMirrorOk === false ? 'text-danger' : 'text-slate-500'}>
                  Nhân bản gần nhất: {fmtDateTime(cfg!.lastMirrorAt)} {cfg!.lastMirrorOk === false ? '· THẤT BẠI' : '· OK'}
                </span>
              )}
              {cfg!.lastMirrorOk === false && cfg!.lastMirrorError && (
                <span className="inline-flex items-center gap-1 text-danger"><AlertTriangle className="h-4 w-4" /> {cfg!.lastMirrorError}</span>
              )}
            </>
          ) : (
            <span className="text-slate-400">Chưa bật — bản sao lưu chỉ nằm trên máy này.</span>
          )}
        </div>
      )}

      {editing && (
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Thư mục nhân bản" hint="Đường dẫn ổ ngoài / NAS, ví dụ E:\\glb-backup hoặc \\\\NAS\\backup. Bỏ trống = tắt.">
              <input className={inputCls + ' font-mono text-xs'} value={dir} onChange={(e) => setDir(e.target.value)} placeholder="E:\\glb-backup" autoFocus />
            </Field>
          </div>
          <Field label="Giữ số bản mới nhất" hint="1–999; vượt sẽ tự xóa bản cũ">
            <input className={inputCls + ' text-right tabular-nums'} inputMode="numeric" value={keep} onChange={(e) => setKeep(e.target.value.replace(/[^\d]/g, ''))} />
          </Field>
          <Field label="Mật khẩu xác nhận" required>
            <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="col-span-2 flex justify-end gap-2">
            <button onClick={() => { setEditing(false); setPassword(''); setDir(cfg?.mirrorDir ?? ''); setKeep(String(cfg?.keep ?? 30)); }} className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-600 hover:bg-appbg">Hủy</button>
            <button onClick={save} disabled={busy} className="flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Lưu cấu hình
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
