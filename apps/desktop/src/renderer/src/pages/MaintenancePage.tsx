import { useEffect, useState } from 'react';
import { Loader2, HardDrive, Database, Trash2, ScrollText, ShieldCheck, RefreshCw, Save, Activity, ShieldAlert, CheckCircle2, Wrench, AlertTriangle, Info, Clock } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTime } from '@glb/shared';
import type { StorageStatus, ScanResult, HealthFinding, MaintenanceRunDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Field, inputCls } from '../components/Field.js';
import { Button } from '../components/Button.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';

function bytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (Math.round(v * 10) / 10).toString().replace('.', ',') + ' ' + u[i];
}
const grp = (n: number): string => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function MaintenancePage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const canClean = hasPermission(user, 'STORAGE_CLEANUP');
  const [st, setSt] = useState<StorageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmClean, setConfirmClean] = useState<{ clearHistory: boolean; purgeTrash: boolean } | null>(null);
  const [optHistory, setOptHistory] = useState(true);
  const [optTrash, setOptTrash] = useState(true);
  // Cấu hình
  const [threshold, setThreshold] = useState('80');
  const [auditDays, setAuditDays] = useState('180');
  const [trashDays, setTrashDays] = useState('90');
  const [intervalH, setIntervalH] = useState('24');
  // Lịch bảo trì định kỳ
  const [mtEnabled, setMtEnabled] = useState(true);
  const [mtDay, setMtDay] = useState('0');
  const [mtHour, setMtHour] = useState('2');
  const [mtAutoPurge, setMtAutoPurge] = useState(true);
  const [savingCfg, setSavingCfg] = useState(false);
  // Quét sức khỏe + lịch sử bảo trì
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [runs, setRuns] = useState<MaintenanceRunDto[]>([]);

  async function loadRuns(): Promise<void> {
    const r = await window.api.healthRuns(20);
    if (r.ok && r.data) setRuns(r.data);
  }
  async function doScan(autoFix: boolean): Promise<void> {
    setScanning(true);
    const r = await window.api.healthScan({ autoFix });
    setScanning(false);
    if (r.ok && r.data) {
      setScan(r.data);
      const msg = r.data.status === 'OK' ? 'Hệ thống ổn định — không phát hiện lỗi.' : `Phát hiện ${r.data.errorCount} lỗi · ${r.data.warnCount} cảnh báo` + (autoFix && r.data.autoFixed ? ` · đã tự sửa ${r.data.autoFixed}` : '');
      if (r.data.status === 'OK') toast.success(msg); else toast.alert(msg, 'Kết quả quét');
      void loadRuns(); void reload();
    } else toast.alert(r.message ?? 'Quét thất bại', 'Không quét được');
  }

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.storageStatus();
    if (res.ok && res.data) {
      setSt(res.data);
      setThreshold(String(res.data.thresholdPct));
      setAuditDays(String(res.data.cleanable.auditRetentionDays));
      setTrashDays(String(res.data.cleanable.trashRetentionDays));
      setIntervalH(String(res.data.backupIntervalHours));
      setMtEnabled(res.data.maintenanceEnabled);
      setMtDay(String(res.data.maintenanceDayOfWeek));
      setMtHour(String(res.data.maintenanceHour));
      setMtAutoPurge(res.data.autoPurgeWeekly);
    } else if (res.message) toast.alert(res.message);
    setLoading(false);
  }
  useEffect(() => { void reload(); void loadRuns(); /* eslint-disable-next-line */ }, []);

  async function saveCfg(): Promise<void> {
    setSavingCfg(true);
    const res = await window.api.storageUpdateConfig({
      thresholdPct: Number(threshold),
      auditRetentionDays: Number(auditDays),
      trashRetentionDays: Number(trashDays),
      backupIntervalHours: Number(intervalH),
      maintenanceDayOfWeek: Number(mtDay),
      maintenanceHour: Number(mtHour),
      maintenanceEnabled: mtEnabled,
      autoPurgeWeekly: mtAutoPurge
    });
    setSavingCfg(false);
    if (res.ok) { toast.success('Đã lưu cấu hình bảo trì'); void reload(); }
    else toast.alert(res.message ?? 'Lưu cấu hình thất bại', 'Không lưu được');
  }

  async function doClean(opts: { clearHistory: boolean; purgeTrash: boolean }, password?: string): Promise<void> {
    const res = await window.api.storageCleanup({ ...opts, password: password ?? '' });
    if (res.ok) toast.success(`Đã dọn ${grp(res.auditDeleted ?? 0)} dòng nhật ký + ${grp(res.trashDeleted ?? 0)} bản ghi thùng rác (đã backup an toàn trước khi xóa)`);
    else toast.alert(res.message ?? 'Dọn dẹp thất bại', 'Không dọn được');
    setConfirmClean(null);
    void reload();
  }

  if (loading) return <div className="py-16 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>;
  if (!st) return <div className="py-16 text-center text-slate-400">Không tải được tình trạng bộ nhớ.</div>;

  const pct = st.diskUsedPct;
  const barTone = pct == null ? 'bg-slate-300' : pct >= st.thresholdPct ? 'bg-danger' : pct >= st.thresholdPct * 0.85 ? 'bg-warning' : 'bg-emerald-500';

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Bảo Trì Hệ Thống</h2>
          <p className="text-sm text-slate-500">Chống tràn bộ nhớ khi lên server · backup định kỳ · dọn dẹp an toàn (luôn backup trước khi xóa).</p>
        </div>
        <Button variant="soft" icon={<RefreshCw className="h-4 w-4" />} onClick={reload}>Làm mới</Button>
      </div>

      {/* Cảnh báo vượt ngưỡng */}
      {st.over && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4">
          <HardDrive className="mt-0.5 h-5 w-5 text-danger" />
          <div className="text-sm text-slate-700">
            <b className="text-danger">Bộ nhớ đã vượt ngưỡng an toàn ({pct}% ≥ {st.thresholdPct}%).</b> Hãy dọn dẹp lịch sử và thùng rác cũ để đảm bảo dữ liệu luôn được lưu và cập nhật. Hệ thống sẽ tự backup trước khi xóa.
          </div>
        </div>
      )}

      {/* Ổ đĩa + DB */}
      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-line bg-white p-4 shadow-sm lg:col-span-2">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500"><HardDrive className="h-4 w-4" /> Dung lượng ổ đĩa</div>
          {pct == null ? (
            <div className="text-sm text-slate-400">Nền tảng không cung cấp thông tin ổ đĩa.</div>
          ) : (
            <>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div className={'h-full rounded-full transition-all ' + barTone} style={{ width: Math.min(100, pct) + '%' }} />
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-slate-600">Đã dùng <b className="tabular-nums">{pct}%</b> · còn trống {bytes(st.diskFreeBytes)}</span>
                <span className="text-slate-400 tabular-nums">Tổng {bytes(st.diskTotalBytes)} · ngưỡng {st.thresholdPct}%</span>
              </div>
            </>
          )}
        </div>
        <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500"><Database className="h-4 w-4" /> Cơ sở dữ liệu</div>
          <div className="text-right text-xl font-semibold tabular-nums text-slate-800">{bytes(st.dbBytes)}</div>
          <div className="mt-1 text-right text-xs text-slate-400">Backup gần nhất: {st.lastBackupAt ? `${fmtDate(st.lastBackupAt)} ${fmtTime(st.lastBackupAt)}` : 'chưa có'}</div>
        </div>
      </div>

      {/* Quét sức khỏe toàn hệ thống */}
      <div className="mb-4 rounded-xl border border-line bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Activity className="h-4 w-4 text-brand" /> Quét sức khỏe toàn hệ thống</div>
          <div className="flex gap-2">
            <Button variant="neutral" icon={scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />} disabled={scanning} onClick={() => doScan(false)}>Quét ngay</Button>
            {canClean && <Button variant="confirm" icon={<Wrench className="h-4 w-4" />} disabled={scanning} onClick={() => doScan(true)}>Quét & Tự sửa</Button>}
          </div>
        </div>
        {!scan && <p className="text-sm text-slate-400">Bấm "Quét ngay" để kiểm tra toàn vẹn dữ liệu (doanh thu, tham chiếu mồ côi, tài khoản khóa, backup…). Kết quả được lưu vào Lịch sử bảo trì.</p>}
        {scan && (
          <div>
            <div className={'mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ' + (scan.status === 'OK' ? 'bg-emerald-50 text-emerald-700' : scan.status === 'WARN' ? 'bg-amber-50 text-amber-700' : 'bg-danger/10 text-danger')}>
              {scan.status === 'OK' ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
              {scan.status === 'OK' ? 'Hệ thống ổn định — không phát hiện lỗi.' : `${scan.errorCount} lỗi · ${scan.warnCount} cảnh báo · ${grp(scan.issuesFound)} mục`}
              {scan.autoFixed > 0 && <span className="ml-1 rounded bg-white/60 px-1.5 py-0.5 text-xs">đã tự sửa {scan.autoFixed}</span>}
              <span className="ml-auto text-xs font-normal opacity-70">{scan.checksTotal} nhóm kiểm tra · {scan.durationMs}ms</span>
            </div>
            <div className="space-y-2">
              {scan.findings.map((f) => <FindingRow key={f.code} f={f} />)}
            </div>
          </div>
        )}
      </div>

      {/* Có thể dọn + nút dọn */}
      <div className="mb-4 rounded-xl border border-line bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-slate-700">Dọn dẹp an toàn</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={'flex items-center justify-between rounded-lg border p-3 ' + (optHistory ? 'border-brand bg-brand-tint/30' : 'border-line')}>
            <span className="flex items-center gap-2 text-sm text-slate-700"><ScrollText className="h-4 w-4 text-slate-500" /> Nhật ký cũ hơn {st.cleanable.auditRetentionDays} ngày</span>
            <span className="flex items-center gap-2"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{grp(st.cleanable.auditOld)} dòng</span><input type="checkbox" checked={optHistory} disabled={!canClean} onChange={(e) => setOptHistory(e.target.checked)} /></span>
          </label>
          <label className={'flex items-center justify-between rounded-lg border p-3 ' + (optTrash ? 'border-brand bg-brand-tint/30' : 'border-line')}>
            <span className="flex items-center gap-2 text-sm text-slate-700"><Trash2 className="h-4 w-4 text-slate-500" /> Thùng rác cũ hơn {st.cleanable.trashRetentionDays} ngày</span>
            <span className="flex items-center gap-2"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{grp(st.cleanable.trashOld)} bản ghi</span><input type="checkbox" checked={optTrash} disabled={!canClean} onChange={(e) => setOptTrash(e.target.checked)} /></span>
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Hệ thống LUÔN tạo bản sao lưu trước khi xóa — dữ liệu luôn khôi phục được.</span>
          {canClean && <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} disabled={!optHistory && !optTrash} onClick={() => setConfirmClean({ clearHistory: optHistory, purgeTrash: optTrash })}>Dọn dẹp ngay</Button>}
        </div>
      </div>

      {/* Cấu hình bảo trì */}
      {canClean && (
        <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-slate-700">Cấu hình bảo trì</div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Field label="Ngưỡng cảnh báo (%)" hint="Vượt mức này sẽ cảnh báo"><input className={inputCls + ' text-right tabular-nums'} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/[^\d]/g, ''))} /></Field>
            <Field label="Hạn lưu nhật ký (ngày)"><input className={inputCls + ' text-right tabular-nums'} inputMode="numeric" value={auditDays} onChange={(e) => setAuditDays(e.target.value.replace(/[^\d]/g, ''))} /></Field>
            <Field label="Hạn lưu thùng rác (ngày)"><input className={inputCls + ' text-right tabular-nums'} inputMode="numeric" value={trashDays} onChange={(e) => setTrashDays(e.target.value.replace(/[^\d]/g, ''))} /></Field>
            <Field label="Chu kỳ backup (giờ)" hint="Mặc định 24 = 1 lần/ngày"><input className={inputCls + ' text-right tabular-nums'} inputMode="numeric" value={intervalH} onChange={(e) => setIntervalH(e.target.value.replace(/[^\d]/g, ''))} /></Field>
          </div>

          {/* Lịch bảo trì định kỳ hàng tuần */}
          <div className="mt-4 rounded-lg border border-line bg-appbg/40 p-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Bảo trì định kỳ hàng tuần</span>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={mtEnabled} onChange={(e) => setMtEnabled(e.target.checked)} />
                {mtEnabled ? 'Tự động BẬT' : 'Tự động TẮT'}
              </label>
            </div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              <Field label="Chạy vào thứ">
                <select className={inputCls} value={mtDay} disabled={!mtEnabled} onChange={(e) => setMtDay(e.target.value)}>
                  {['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'].map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </Field>
              <Field label="Vào lúc (giờ)">
                <select className={inputCls} value={mtHour} disabled={!mtEnabled} onChange={(e) => setMtHour(e.target.value)}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
              </Field>
              <Field label="Tự dọn dữ liệu quá hạn" hint="Xóa audit/thùng rác cũ khi bảo trì">
                <label className="flex h-[38px] items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={mtAutoPurge} disabled={!mtEnabled} onChange={(e) => setMtAutoPurge(e.target.checked)} />
                  {mtAutoPurge ? 'Có' : 'Không'}
                </label>
              </Field>
            </div>
            <div className="mt-2 text-xs text-slate-400">Mỗi kỳ: tự backup → dọn dữ liệu quá hạn (nếu bật) → thu hồi chỗ trống (VACUUM). Bảo trì gần nhất: {st.lastMaintenanceAt ? `${fmtDate(st.lastMaintenanceAt)} ${fmtTime(st.lastMaintenanceAt)}` : 'chưa chạy'}.</div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button variant="confirm" icon={savingCfg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} disabled={savingCfg} onClick={saveCfg}>Lưu cấu hình</Button>
          </div>
        </div>
      )}

      {/* Lịch sử bảo trì */}
      <div className="mt-4 rounded-xl border border-line bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold text-slate-700"><Clock className="h-4 w-4 text-slate-500" /> Lịch sử bảo trì</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Thời gian</th>
                <th className="px-4 py-2.5">Loại</th>
                <th className="px-4 py-2.5">Kết quả</th>
                <th className="px-4 py-2.5 text-right">Lỗi</th>
                <th className="px-4 py-2.5 text-right">Cảnh báo</th>
                <th className="px-4 py-2.5 text-right">Tự sửa</th>
                <th className="px-4 py-2.5 text-right">Đã dọn</th>
                <th className="px-4 py-2.5">Người/Nguồn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Chưa có lần bảo trì nào.</td></tr>}
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-appbg/60">
                  <td className="px-4 py-2.5 text-xs text-slate-500">{fmtDate(r.startedAt)} {fmtTime(r.startedAt)}</td>
                  <td className="px-4 py-2.5"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{r.kind === 'SCHEDULED' ? 'Định kỳ' : 'Thủ công'}</span></td>
                  <td className="px-4 py-2.5">
                    <span className={'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ' + (r.status === 'OK' ? 'bg-emerald-50 text-emerald-600' : r.status === 'WARN' ? 'bg-amber-50 text-amber-600' : 'bg-danger/10 text-danger')}>
                      {r.status === 'OK' ? 'Ổn định' : r.status === 'WARN' ? 'Cảnh báo' : 'Có lỗi'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.errorCount}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.warnCount}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.autoFixed}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{r.auditDeleted + r.trashDeleted > 0 ? grp(r.auditDeleted + r.trashDeleted) : '—'}{r.vacuumed ? ' ⚙' : ''}</td>
                  <td className="px-4 py-2.5 text-slate-600">{r.triggeredByName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {confirmClean && (
        <ConfirmDialog
          title="Dọn dẹp bộ nhớ"
          message={`Sẽ XÓA VĨNH VIỄN dữ liệu cũ hơn hạn lưu${confirmClean.clearHistory ? ` · nhật ký (${grp(st.cleanable.auditOld)} dòng)` : ''}${confirmClean.purgeTrash ? ` · thùng rác (${grp(st.cleanable.trashOld)} bản ghi)` : ''}. Hệ thống tự backup an toàn trước khi xóa. Nhập lại mật khẩu để xác nhận.`}
          confirmLabel="Backup & Dọn dẹp"
          danger
          requirePassword
          onCancel={() => setConfirmClean(null)}
          onConfirm={(pwd) => doClean(confirmClean, pwd)}
        />
      )}
    </div>
  );
}

function FindingRow({ f }: { f: HealthFinding }): JSX.Element {
  const tone = f.severity === 'ERROR' ? { box: 'border-danger/30 bg-danger/5', icon: <ShieldAlert className="h-4 w-4 text-danger" />, badge: 'bg-danger/10 text-danger' }
    : f.severity === 'WARN' ? { box: 'border-amber-200 bg-amber-50/40', icon: <AlertTriangle className="h-4 w-4 text-amber-500" />, badge: 'bg-amber-100 text-amber-700' }
    : { box: 'border-line bg-appbg/40', icon: <Info className="h-4 w-4 text-slate-400" />, badge: 'bg-slate-100 text-slate-600' };
  return (
    <div className={'rounded-lg border p-3 ' + tone.box}>
      <div className="flex items-start gap-2">
        {tone.icon}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-800">{f.title}</span>
            <span className={'rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ' + tone.badge}>{grp(f.count)}</span>
            {f.autoFixable && <span className="rounded bg-brand-tint px-1.5 py-0.5 text-xs text-brand">tự sửa được</span>}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{f.detail}</p>
          <p className="mt-1 flex items-start gap-1 text-xs text-slate-600"><Wrench className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" /> <span><b>Đề xuất:</b> {f.suggestion}</span></p>
        </div>
      </div>
    </div>
  );
}
