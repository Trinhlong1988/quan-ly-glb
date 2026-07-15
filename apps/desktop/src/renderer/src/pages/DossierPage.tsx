import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, FolderKanban, Tag, Download, RefreshCw, IdCard } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTime } from '@glb/shared';
import type { DossierSourceDto, DossierDto, DossierInput } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { isStaleWrite, STALE_TITLE } from '../lib/optlock.js';
import { Modal } from '../components/Modal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';
import { StatBar } from '../components/StatBar.js';
import { StaleBanner } from '../lib/realtime.js';
import { StatusBadge, useStatusOptions, statusSelectOptions, toneCls } from '../components/StatusBadge.js';
import { TabBar, TabButton } from '../components/Tabs.js';
import { Button } from '../components/Button.js';
import { ImportButton } from '../components/ImportModal.js';
import { useRowSelection, SelectionBar, SelectAllCell, SelectCell } from '../components/Selection.js';
import { Thumb, AttachField } from '../components/Attach.js';
import { AuditTrailHeadCells, AuditTrailCells } from '../components/AuditCells.js';
import { exportCsv } from '../lib/exportCsv.js';

type Tab = 'dossier' | 'cccd' | 'source';

function IconBtn({ children, title, variant, onClick }: { children: JSX.Element; title: string; variant?: 'edit' | 'danger'; onClick: () => void }): JSX.Element {
  const tone = variant === 'danger' ? 'text-danger hover:bg-danger/10' : variant === 'edit' ? 'text-warning hover:bg-warning/10' : 'text-slate-400 hover:bg-brand-tint hover:text-brand';
  return <button title={title} onClick={onClick} className={'rounded-md p-1.5 transition ' + tone}>{children}</button>;
}

/** % hiển thị: bỏ số 0 thừa (0.5 / 0.05 / 0.003). */
function fmtPct(v: number): string {
  return `${Number(v.toFixed(3))}%`;
}

export function DossierPage({ user }: { user: AuthUser }): JSX.Element {
  const [tab, setTab] = useState<Tab>('dossier');
  const canManage = hasPermission(user, 'CONFIG_DOSSIER_MANAGE');
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Quản Lý Hồ Sơ HKD</h2>
        <p className="text-sm text-slate-500">Hồ sơ Hộ Kinh Doanh (kèm ảnh ĐKKD + CCCD) · Nguồn hồ sơ (chính sách chiết khấu).</p>
      </div>
      <TabBar>
        <TabButton active={tab === 'dossier'} onClick={() => setTab('dossier')} icon={<FolderKanban className="h-4 w-4" />}>Hồ sơ HKD</TabButton>
        <TabButton active={tab === 'cccd'} onClick={() => setTab('cccd')} icon={<IdCard className="h-4 w-4" />}>Danh sách CCCD</TabButton>
        <TabButton active={tab === 'source'} onClick={() => setTab('source')} icon={<Tag className="h-4 w-4" />}>Nguồn hồ sơ</TabButton>
      </TabBar>
      {tab === 'dossier' && <DossierTab canManage={canManage} view="hkd" />}
      {tab === 'cccd' && <DossierTab canManage={canManage} view="cccd" />}
      {tab === 'source' && <SourceTab canManage={canManage} />}
    </div>
  );
}

// ── §10a/b NGUỒN HỒ SƠ ───────────────────────────────────────────────────────
function SourceTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<DossierSourceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: DossierSourceDto } | null>(null);
  const [del, setDel] = useState<DossierSourceDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.dossierSourceList();
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  async function doDelete(s: DossierSourceDto, password?: string): Promise<void> {
    const res = await window.api.dossierSourceDelete([s.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa nguồn hồ sơ ${s.code}`);
    else toast.alert(res.message ?? 'Xóa nguồn thất bại', 'Xóa thất bại');
    setDel(null); await reload();
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.dossierSourceDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} nguồn hồ sơ`);
    else toast.alert(res.message ?? 'Xóa nguồn thất bại', 'Xóa thất bại');
    setBulkDel(false); await reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} nguồn hồ sơ</div>
        <div className="flex gap-2">
          <button onClick={() => void reload()} title="Tải lại dữ liệu mới nhất (giữ nguyên bộ lọc)" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-brand/10 text-brand hover:bg-brand/20"><RefreshCw className="h-4 w-4" /> Làm mới</button>
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('nguon_ho_so', ['Mã nguồn hồ sơ', 'Chiết khấu', 'Người tạo', 'Ngày tạo', 'Giờ tạo', 'Người sửa', 'Ngày sửa', 'Giờ sửa'], rows.map((s) => [s.code, fmtPct(s.discountRate), s.createdByName ?? '', fmtDate(s.createdAt), fmtTime(s.createdAt), s.updatedByName ?? '', fmtDate(s.updatedAt), fmtTime(s.updatedAt)]))}>Xuất Excel</Button>
          {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>Thêm nguồn hồ sơ</Button>}
        </div>
      </div>
      <StatBar items={[{ label: 'Tổng nguồn hồ sơ', value: rows.length, tone: 'bg-brand-tint text-brand' }]} />
      {canManage && <SelectionBar count={sel.count} entityLabel="nguồn" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm list-scroll">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Mã nguồn hồ sơ</th>
              <th className="px-4 py-3 text-right">Chiết khấu</th>
              <AuditTrailHeadCells />
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canManage ? 7 : 5} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canManage ? 7 : 5} className="px-4 py-10 text-center text-slate-400"><Tag className="mx-auto mb-2 h-6 w-6" /> Chưa có nguồn hồ sơ.</td></tr>}
            {!loading && rows.map((s) => (
              <tr key={s.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(s.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={s.id} sel={sel} />}
                <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{s.code}</td>
                <td className="px-4 py-3 text-right font-mono text-brand">{fmtPct(s.discountRate)}</td>
                <AuditTrailCells row={s} />
                {canManage && (
                  <td className="px-4 py-3"><div className="flex justify-end gap-1">
                    <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: s })}><Pencil className="h-4 w-4" /></IconBtn>
                    <IconBtn title="Xóa" variant="danger" onClick={() => setDel(s)}><Trash2 className="h-4 w-4" /></IconBtn>
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <SourceForm mode={form.mode} row={form.row} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa nguồn hồ sơ" message={`Nguồn "${del.code}" sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều nguồn hồ sơ" message={`${sel.count} nguồn đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function SourceForm({ mode, row, onClose, onSaved }: { mode: 'create' | 'edit'; row?: DossierSourceDto; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [code, setCode] = useState(row?.code ?? '');
  const [discount, setDiscount] = useState(row ? String(row.discountRate) : '');
  const [busy, setBusy] = useState(false);
  async function save(): Promise<void> {
    if (!code.trim()) return toast.alert('Mã nguồn hồ sơ bắt buộc.', 'Thiếu thông tin');
    const d = Number(discount);
    if (!Number.isFinite(d) || d < 0) return toast.alert('Chính sách chiết khấu phải là số ≥ 0.', 'Sai định dạng');
    setBusy(true);
    const res = mode === 'edit' && row
      ? await window.api.dossierSourceUpdate(row.id, { code: code.trim(), discountRate: d, expectedUpdatedAt: row.updatedAt })
      : await window.api.dossierSourceCreate({ code: code.trim(), discountRate: d });
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật nguồn hồ sơ' : `Đã thêm nguồn hồ sơ ${code}`); onSaved(); }
    else if (isStaleWrite(res)) { toast.alert(res.message ?? 'Bản ghi đã được người khác cập nhật, vui lòng mở lại.', STALE_TITLE); onSaved(); }
    else toast.alert(res.message ?? 'Lưu nguồn thất bại', 'Không lưu được');
  }
  return (
    <Modal title={mode === 'edit' ? 'Sửa nguồn hồ sơ' : 'Thêm nguồn hồ sơ'} onClose={onClose} width="max-w-md">
      <Field label="Mã nguồn hồ sơ" required><input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></Field>
      <Field label="Chính sách chiết khấu (%)" required hint="Nhập dạng %: 0.5 · 0.05 · 0.003 (tối đa 3 số thập phân)">
        <input className={inputCls} value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" placeholder="0.05" />
      </Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm nguồn'}</Button>
      </div>
    </Modal>
  );
}

// ── §10c/d HỒ SƠ HKD ─────────────────────────────────────────────────────────
function DossierTab({ canManage, view = 'hkd' }: { canManage: boolean; view?: 'hkd' | 'cccd' }): JSX.Element {
  const isCccd = view === 'cccd';
  const toast = useToast();
  const [rows, setRows] = useState<DossierDto[]>([]);
  const [sources, setSources] = useState<DossierSourceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fSource, setFSource] = useState('');
  const [fMstStatus, setFMstStatus] = useState('');
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: DossierDto } | null>(null);
  const [del, setDel] = useState<DossierDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();
  // R14 — danh mục trạng thái MST (entity HKD_MST) từ catalog tùy biến.
  const { options: mstOptions, byCode: mstByCode } = useStatusOptions('HKD_MST');
  const mstStatusLabel = (code: string): string => mstByCode.get(code)?.label ?? code;

  async function loadRefs(): Promise<void> {
    const s = await window.api.dossierSourceList();
    if (s.ok && s.data) setSources(s.data);
  }
  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.dossierList({ search: search || undefined, sourceId: fSource ? Number(fSource) : undefined, mstStatus: fMstStatus || undefined });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void loadRefs(); }, []);
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [fSource, fMstStatus]);

  async function doDelete(d: DossierDto, password?: string): Promise<void> {
    const res = await window.api.dossierDelete([d.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa hồ sơ ${d.hkdName}`);
    else toast.alert(res.message ?? 'Xóa hồ sơ thất bại', 'Xóa thất bại');
    setDel(null); await reload();
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.dossierDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} hồ sơ`);
    else toast.alert(res.message ?? 'Xóa hồ sơ thất bại', 'Xóa thất bại');
    setBulkDel(false); await reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} hồ sơ</div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('ho_so_hkd', ['Nguồn', 'Tên HKD', 'MST/ĐKKD', 'Trạng thái MST', 'Chủ hộ', 'CCCD', 'Địa chỉ HKD'], rows.map((r) => [r.sourceCode, r.hkdName, r.taxCode, mstStatusLabel(r.mstStatus), r.ownerName, r.cccdNumber, r.hkdAddress]))}>Xuất Excel</Button>
          {canManage && <ImportButton entityKey="dossier" label="Hộ kinh doanh" onImported={reload} />}
          {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => sources.length ? setForm({ mode: 'create' }) : toast.alert('Cần có ít nhất 1 nguồn hồ sơ trước.', 'Thiếu dữ liệu nền')}>Thêm hồ sơ</Button>}
        </div>
      </div>
      <FilterBar search={search} onSearch={setSearch} searchPlaceholder="Tìm tên HKD / chủ hộ / MST / CCCD…"
        selects={[
          { key: 's', placeholder: 'Tất cả nguồn hồ sơ', value: fSource, options: sources.map((s) => ({ value: String(s.id), label: s.code })), onChange: setFSource },
          { key: 'mst', placeholder: 'Tất cả trạng thái MST', value: fMstStatus, options: mstOptions.filter((o) => o.active).map((o) => ({ value: o.code, label: o.label })), onChange: setFMstStatus }
        ]}
        onApply={reload} onReset={() => { setSearch(''); setFSource(''); setFMstStatus(''); setTimeout(reload, 0); }} />
      {/* StatBar Hồ sơ HKD — tổng + đếm theo trạng thái MST (danh mục HKD_MST tùy biến). */}
      <StatBar
        items={[
          { label: 'Tổng hồ sơ', value: rows.length, tone: 'bg-brand-tint text-brand' },
          ...mstOptions.filter((o) => o.active).map((o) => ({
            label: o.label,
            value: rows.filter((r) => r.mstStatus === o.code).length,
            tone: toneCls(o.tone)
          }))
        ]}
      />
      {canManage && <SelectionBar count={sel.count} entityLabel="hồ sơ" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <StaleBanner domain="Dossier" onReload={reload} className="mb-2" />
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm list-scroll">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Tên HKD</th>
              <th className="px-4 py-3">Chủ hộ</th>
              <th className="px-4 py-3">CCCD</th>
              {isCccd ? (
                <>
                  <th className="px-4 py-3">Giới tính</th>
                  <th className="px-4 py-3">Dân tộc</th>
                  <th className="px-4 py-3">Ngày cấp</th>
                  <th className="px-4 py-3">Nơi cấp</th>
                  <th className="px-4 py-3">Hết hạn</th>
                  <th className="px-4 py-3">ĐC thường trú</th>
                  <th className="px-4 py-3">Ảnh CCCD</th>
                </>
              ) : (
                <>
                  <th className="px-4 py-3">Nguồn</th>
                  <th className="px-4 py-3">MST / ĐKKD</th>
                  <th className="px-4 py-3">Trạng thái MST</th>
                  <th className="px-4 py-3">Ảnh ĐKKD</th>
                  <th className="px-4 py-3">Ảnh CCCD</th>
                </>
              )}
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={isCccd ? (canManage ? 12 : 10) : (canManage ? 10 : 8)} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={isCccd ? (canManage ? 12 : 10) : (canManage ? 10 : 8)} className="px-4 py-10 text-center text-slate-400"><FolderKanban className="mx-auto mb-2 h-6 w-6" /> Chưa có hồ sơ HKD.</td></tr>}
            {!loading && rows.map((d) => (
              <tr key={d.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(d.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={d.id} sel={sel} />}
                <td className="px-4 py-3 font-medium text-slate-800">{d.hkdName}</td>
                <td className="px-4 py-3 text-slate-600">{d.ownerName}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{d.cccdNumber ?? '—'}</td>
                {isCccd ? (
                  <>
                    <td className="px-4 py-3 text-slate-600">{d.gender ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{d.ethnicity ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{d.cccdIssueDate ? fmtDate(d.cccdIssueDate) : '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{d.cccdIssuePlace ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{d.cccdExpiry ? fmtDate(d.cccdExpiry) : '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{d.permanentAddress ?? '—'}</td>
                    <td className="px-4 py-3"><div className="flex gap-1">
                      {d.cccdFrontPath ? <Thumb relPath={d.cccdFrontPath} label="CCCD mặt trước" /> : <span className="text-xs text-slate-400">—</span>}
                      {d.cccdBackPath && <Thumb relPath={d.cccdBackPath} label="CCCD mặt sau" />}
                    </div></td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-3"><span className="rounded bg-brand-tint px-1.5 py-0.5 text-xs font-medium text-brand whitespace-nowrap">{d.sourceCode ?? '—'}</span></td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">{d.taxCode ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge entity="HKD_MST" code={d.mstStatus} /></td>
                    <td className="px-4 py-3"><div className="flex gap-1">
                      {d.dkkdFrontPath ? <Thumb relPath={d.dkkdFrontPath} label="ĐKKD mặt trước" /> : <span className="text-xs text-slate-400">—</span>}
                      {d.dkkdBackPath && <Thumb relPath={d.dkkdBackPath} label="ĐKKD mặt sau" />}
                    </div></td>
                    <td className="px-4 py-3"><div className="flex gap-1">
                      {d.cccdFrontPath ? <Thumb relPath={d.cccdFrontPath} label="CCCD mặt trước" /> : <span className="text-xs text-slate-400">—</span>}
                      {d.cccdBackPath && <Thumb relPath={d.cccdBackPath} label="CCCD mặt sau" />}
                    </div></td>
                  </>
                )}
                {canManage && (
                  <td className="px-4 py-3"><div className="flex justify-end gap-1">
                    <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: d })}><Pencil className="h-4 w-4" /></IconBtn>
                    <IconBtn title="Xóa" variant="danger" onClick={() => setDel(d)}><Trash2 className="h-4 w-4" /></IconBtn>
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <DossierForm mode={form.mode} row={form.row} sources={sources} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa hồ sơ HKD" message={`Hồ sơ "${del.hkdName}" (chủ hộ ${del.ownerName}) sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều hồ sơ" message={`${sel.count} hồ sơ đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function DossierForm({ mode, row, sources, onClose, onSaved }: { mode: 'create' | 'edit'; row?: DossierDto; sources: DossierSourceDto[]; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  // R14 — trạng thái MST từ danh mục tùy biến (giữ giá trị hiện tại kể cả khi đã ẩn).
  const { options: mstOptions } = useStatusOptions('HKD_MST');
  const [f, setF] = useState({
    sourceId: row?.sourceId ? String(row.sourceId) : '',
    hkdName: row?.hkdName ?? '',
    hkdAddress: row?.hkdAddress ?? '',
    taxCode: row?.taxCode ?? '',
    mstStatus: row?.mstStatus ?? 'ACTIVE',
    dkkdIssueDate: row?.dkkdIssueDate ? row.dkkdIssueDate.slice(0, 10) : '',
    dkkdIssuePlace: row?.dkkdIssuePlace ?? '',
    ownerName: row?.ownerName ?? '',
    gender: row?.gender ?? '',
    ethnicity: row?.ethnicity ?? '',
    cccdNumber: row?.cccdNumber ?? '',
    cccdIssueDate: row?.cccdIssueDate ? row.cccdIssueDate.slice(0, 10) : '',
    cccdIssuePlace: row?.cccdIssuePlace ?? '',
    cccdExpiry: row?.cccdExpiry ? row.cccdExpiry.slice(0, 10) : '',
    permanentAddress: row?.permanentAddress ?? '',
    currentAddress: row?.currentAddress ?? '',
    email: row?.email ?? ''
  });
  const [dkkdFront, setDkkdFront] = useState<string | null | undefined>(undefined);
  const [dkkdBack, setDkkdBack] = useState<string | null | undefined>(undefined);
  const [cccdFront, setCccdFront] = useState<string | null | undefined>(undefined);
  const [cccdBack, setCccdBack] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => setF({ ...f, [k]: e.target.value });

  async function save(): Promise<void> {
    if (!f.sourceId) return toast.alert('Vui lòng chọn nguồn hồ sơ.', 'Thiếu thông tin');
    if (!f.hkdName.trim()) return toast.alert('Tên Hộ Kinh Doanh bắt buộc.', 'Thiếu thông tin');
    if (!f.ownerName.trim()) return toast.alert('Tên chủ hộ kinh doanh bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const input: DossierInput = {
      sourceId: Number(f.sourceId),
      hkdName: f.hkdName.trim(),
      hkdAddress: f.hkdAddress || null,
      taxCode: f.taxCode || null,
      mstStatus: f.mstStatus,
      dkkdIssueDate: f.dkkdIssueDate || null,
      dkkdIssuePlace: f.dkkdIssuePlace || null,
      ownerName: f.ownerName.trim(),
      gender: f.gender || null,
      ethnicity: f.ethnicity || null,
      cccdNumber: f.cccdNumber || null,
      cccdIssueDate: f.cccdIssueDate || null,
      cccdIssuePlace: f.cccdIssuePlace || null,
      cccdExpiry: f.cccdExpiry || null,
      permanentAddress: f.permanentAddress || null,
      currentAddress: f.currentAddress || null,
      email: f.email || null
    };
    if (dkkdFront !== undefined) input.dkkdFrontSrc = dkkdFront;
    if (dkkdBack !== undefined) input.dkkdBackSrc = dkkdBack;
    if (cccdFront !== undefined) input.cccdFrontSrc = cccdFront;
    if (cccdBack !== undefined) input.cccdBackSrc = cccdBack;
    const res = mode === 'edit' && row ? await window.api.dossierUpdate(row.id, { ...input, expectedUpdatedAt: row.updatedAt }) : await window.api.dossierCreate(input);
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật hồ sơ' : `Đã thêm hồ sơ ${f.hkdName}`); onSaved(); }
    else if (isStaleWrite(res)) { toast.alert(res.message ?? 'Bản ghi đã được người khác cập nhật, vui lòng mở lại.', STALE_TITLE); onSaved(); }
    else toast.alert(res.message ?? 'Lưu hồ sơ thất bại', 'Không lưu được');
  }

  return (
    <Modal title={mode === 'edit' ? `Sửa hồ sơ ${row?.hkdName}` : 'Thêm hồ sơ HKD'} onClose={onClose} width="max-w-3xl" onSubmit={() => void save()}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Thông tin Hộ Kinh Doanh</div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nguồn hồ sơ" required><select className={inputCls} value={f.sourceId} onChange={set('sourceId')} autoFocus><option value="">— Chọn nguồn —</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></Field>
        <Field label="Mã số Thuế / Mã số ĐK HKD"><input className={inputCls} value={f.taxCode} onChange={set('taxCode')} /></Field>
        <Field label="Trạng thái MST"><select className={inputCls} value={f.mstStatus} onChange={set('mstStatus')}>{statusSelectOptions(mstOptions, f.mstStatus).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</select></Field>
        <Field label="Tên Hộ Kinh Doanh" required><input className={inputCls} value={f.hkdName} onChange={set('hkdName')} /></Field>
        <Field label="Địa chỉ đăng ký HKD"><input className={inputCls} value={f.hkdAddress} onChange={set('hkdAddress')} /></Field>
        <Field label="Ngày cấp ĐKKD"><input type="date" className={inputCls} value={f.dkkdIssueDate} onChange={set('dkkdIssueDate')} /></Field>
        <Field label="Nơi cấp ĐKKD"><input className={inputCls} value={f.dkkdIssuePlace} onChange={set('dkkdIssuePlace')} /></Field>
      </div>
      <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Thông tin chủ hộ</div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tên chủ hộ kinh doanh" required><input className={inputCls} value={f.ownerName} onChange={set('ownerName')} /></Field>
        <Field label="Giới tính"><select className={inputCls} value={f.gender} onChange={set('gender')}><option value="">—</option><option value="Nam">Nam</option><option value="Nữ">Nữ</option><option value="Khác">Khác</option></select></Field>
        <Field label="Dân tộc"><input className={inputCls} value={f.ethnicity} onChange={set('ethnicity')} /></Field>
        <Field label="Số CCCD"><input className={inputCls} value={f.cccdNumber} onChange={set('cccdNumber')} /></Field>
        <Field label="Ngày cấp CCCD"><input type="date" className={inputCls} value={f.cccdIssueDate} onChange={set('cccdIssueDate')} /></Field>
        <Field label="Nơi cấp CCCD"><input className={inputCls} value={f.cccdIssuePlace} onChange={set('cccdIssuePlace')} /></Field>
        <Field label="Ngày hết hạn CCCD"><input type="date" className={inputCls} value={f.cccdExpiry} onChange={set('cccdExpiry')} /></Field>
        <Field label="Địa chỉ thường trú"><input className={inputCls} value={f.permanentAddress} onChange={set('permanentAddress')} /></Field>
        <Field label="Nơi ở hiện tại"><input className={inputCls} value={f.currentAddress} onChange={set('currentAddress')} /></Field>
        <Field label="Email"><input className={inputCls} value={f.email} onChange={set('email')} /></Field>
      </div>
      <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Ảnh đính kèm (PNG/JPG/PDF — mặt sau không bắt buộc)</div>
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-line bg-appbg/50 p-3">
        <AttachField label="Ảnh ĐKKD mặt trước" current={dkkdFront === null ? null : row?.dkkdFrontPath ?? null} srcPath={typeof dkkdFront === 'string' ? dkkdFront : null} onPick={(p) => setDkkdFront(p)} onClear={() => setDkkdFront(null)} />
        <AttachField label="Ảnh ĐKKD mặt sau" current={dkkdBack === null ? null : row?.dkkdBackPath ?? null} srcPath={typeof dkkdBack === 'string' ? dkkdBack : null} onPick={(p) => setDkkdBack(p)} onClear={() => setDkkdBack(null)} />
        <AttachField label="Ảnh CCCD mặt trước" current={cccdFront === null ? null : row?.cccdFrontPath ?? null} srcPath={typeof cccdFront === 'string' ? cccdFront : null} onPick={(p) => setCccdFront(p)} onClear={() => setCccdFront(null)} />
        <AttachField label="Ảnh CCCD mặt sau" current={cccdBack === null ? null : row?.cccdBackPath ?? null} srcPath={typeof cccdBack === 'string' ? cccdBack : null} onPick={(p) => setCccdBack(p)} onClear={() => setCccdBack(null)} />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm hồ sơ'}</Button>
      </div>
    </Modal>
  );
}
