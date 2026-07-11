import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, Building2, Cpu, PackagePlus, Tag, Download } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTime, groupDigits, parseVndInput, prereqMessage } from '@glb/shared';
import type { PrereqDef } from '@glb/shared';
import type { SupplierDto, PosModelDto, IntakeStatusDto, PosIntakeDto, LiteRef } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { DateInput } from '../components/DateInput.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';
import { Button } from '../components/Button.js';
import { ImportButton } from '../components/ImportModal.js';
import { useRowSelection, SelectionBar, SelectAllCell, SelectCell } from '../components/Selection.js';
import { exportCsv } from '../lib/exportCsv.js';

type Tab = 'supplier' | 'model' | 'intake' | 'status';

/** Định dạng tiền VND (nhóm 3 chữ số bằng dấu chấm, kiểu Việt Nam) — không dùng toLocaleString. */
function fmtVnd(n: number): string {
  const s = Math.round(n).toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ₫';
}

function IconBtn({ children, title, variant, onClick }: { children: JSX.Element; title: string; variant?: 'edit' | 'danger'; onClick: () => void }): JSX.Element {
  const tone = variant === 'danger' ? 'text-danger hover:bg-danger/10' : variant === 'edit' ? 'text-warning hover:bg-warning/10' : 'text-slate-400 hover:bg-brand-tint hover:text-brand';
  return (
    <button title={title} onClick={onClick} className={'rounded-md p-1.5 transition ' + tone}>
      {children}
    </button>
  );
}

function trailCells(row: { updatedByName: string | null; createdByName: string | null; updatedAt: string }): JSX.Element {
  return (
    <>
      <td className="px-4 py-3 text-slate-600">{row.updatedByName ?? row.createdByName ?? '—'}</td>
      <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(row.updatedAt)}</td>
      <td className="px-4 py-3 text-xs text-slate-500">{fmtTime(row.updatedAt)}</td>
    </>
  );
}

export function PosSupplyPage({ user }: { user: AuthUser }): JSX.Element {
  const [tab, setTab] = useState<Tab>('supplier');
  const canManage = hasPermission(user, 'CONFIG_POS_SUPPLY_MANAGE');
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Cấu hình máy POS</h2>
        <p className="text-sm text-slate-500">Nhà cung cấp · Chủng loại máy · Nhập kho máy POS · Trạng thái nhập.</p>
      </div>
      <div className="mb-3 flex items-center gap-1 border-b border-line">
        <TabBtn active={tab === 'supplier'} onClick={() => setTab('supplier')} icon={<Building2 className="h-4 w-4" />}>Nhà cung cấp</TabBtn>
        <TabBtn active={tab === 'model'} onClick={() => setTab('model')} icon={<Cpu className="h-4 w-4" />}>Chủng loại POS</TabBtn>
        <TabBtn active={tab === 'status'} onClick={() => setTab('status')} icon={<Tag className="h-4 w-4" />}>Trạng thái nhập</TabBtn>
        <TabBtn active={tab === 'intake'} onClick={() => setTab('intake')} icon={<PackagePlus className="h-4 w-4" />}>Nhập kho POS</TabBtn>
      </div>
      {tab === 'supplier' && <SupplierTab canManage={canManage} />}
      {tab === 'model' && <ModelTab canManage={canManage} />}
      {tab === 'intake' && <IntakeTab canManage={canManage} />}
      {tab === 'status' && <StatusTab canManage={canManage} />}
    </div>
  );
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: JSX.Element; children: string }): JSX.Element {
  return (
    <button onClick={onClick} className={'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition ' + (active ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700')}>
      {icon} {children}
    </button>
  );
}

// ── §C6 NHÀ CUNG CẤP ─────────────────────────────────────────────────────────
export function SupplierTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<SupplierDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: SupplierDto } | null>(null);
  const [del, setDel] = useState<SupplierDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.supplierList({ search: search || undefined });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  async function doDelete(s: SupplierDto, password?: string): Promise<void> {
    const res = await window.api.supplierDelete([s.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa nhà cung cấp ${s.code}`);
    else toast.alert(res.message ?? 'Xóa nhà cung cấp thất bại', 'Xóa thất bại');
    setDel(null);
    await reload();
  }

  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.supplierDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} nhà cung cấp`);
    else toast.alert(res.message ?? 'Xóa nhà cung cấp thất bại', 'Xóa thất bại');
    setBulkDel(false);
    await reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} nhà cung cấp</div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('nha_cung_cap', ['Mã', 'Tên nhà cung cấp', 'Người liên hệ', 'Số điện thoại', 'Địa chỉ', 'Cập nhật'], rows.map((r) => [r.code, r.name, r.contactPerson, r.phone, r.address, `${fmtDate(r.updatedAt)} ${fmtTime(r.updatedAt)}`]))}>Xuất Excel</Button>
          {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>Thêm nhà cung cấp</Button>}
        </div>
      </div>
      <FilterBar search={search} onSearch={setSearch} searchPlaceholder="Tìm mã / tên / số điện thoại nhà cung cấp…" onApply={reload} onReset={() => { setSearch(''); setTimeout(reload, 0); }} />
      {canManage && <SelectionBar count={sel.count} entityLabel="nhà cung cấp" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Tên nhà cung cấp</th>
              <th className="px-4 py-3">Người liên hệ</th>
              <th className="px-4 py-3">Số điện thoại</th>
              <th className="px-4 py-3">Người sửa gần nhất</th>
              <th className="px-4 py-3">Ngày</th>
              <th className="px-4 py-3">Giờ</th>
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canManage ? 9 : 7} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canManage ? 9 : 7} className="px-4 py-10 text-center text-slate-400"><Building2 className="mx-auto mb-2 h-6 w-6" /> Chưa có nhà cung cấp.</td></tr>}
            {!loading && rows.map((s) => (
              <tr key={s.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(s.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={s.id} sel={sel} />}
                <td className="px-4 py-3 font-mono text-xs font-semibold text-brand">{s.code}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                <td className="px-4 py-3 text-slate-600">{s.contactPerson ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{s.phone ?? '—'}</td>
                {trailCells(s)}
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: s })}><Pencil className="h-4 w-4" /></IconBtn>
                      <IconBtn title="Xóa" variant="danger" onClick={() => setDel(s)}><Trash2 className="h-4 w-4" /></IconBtn>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <SupplierForm mode={form.mode} row={form.row} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa nhà cung cấp" message={`Nhà cung cấp "${del.name}" (${del.code}) sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều nhà cung cấp" message={`${sel.count} nhà cung cấp đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function SupplierForm({ mode, row, onClose, onSaved }: { mode: 'create' | 'edit'; row?: SupplierDto; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [name, setName] = useState(row?.name ?? '');
  const [code, setCode] = useState(row?.code ?? '');
  const [address, setAddress] = useState(row?.address ?? '');
  const [phone, setPhone] = useState(row?.phone ?? '');
  const [contactPerson, setContactPerson] = useState(row?.contactPerson ?? '');
  const [busy, setBusy] = useState(false);
  async function save(): Promise<void> {
    if (!name.trim()) return toast.alert('Tên nhà cung cấp bắt buộc.', 'Thiếu thông tin');
    if (!code.trim()) return toast.alert('Mã nhà cung cấp bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const payload = { name: name.trim(), code: code.trim(), address: address || null, phone: phone || null, contactPerson: contactPerson || null };
    const res = mode === 'edit' && row ? await window.api.supplierUpdate(row.id, payload) : await window.api.supplierCreate(payload);
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật nhà cung cấp' : `Đã thêm nhà cung cấp ${code}`); onSaved(); }
    else toast.alert(res.message ?? 'Lưu nhà cung cấp thất bại', 'Không lưu được');
  }
  return (
    <Modal title={mode === 'edit' ? `Sửa nhà cung cấp ${row?.code}` : 'Thêm nhà cung cấp mới'} onClose={onClose} width="max-w-xl" onSubmit={() => void save()}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tên nhà cung cấp" required><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Mã nhà cung cấp" required hint="Không trùng"><input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Field label="Người liên hệ"><input className={inputCls} value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} /></Field>
        <Field label="Số điện thoại"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Địa chỉ"><input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm nhà cung cấp'}</Button>
      </div>
    </Modal>
  );
}

// ── §C7 CHỦNG LOẠI POS ───────────────────────────────────────────────────────
export function ModelTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<PosModelDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: PosModelDto } | null>(null);
  const [del, setDel] = useState<PosModelDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.posModelList({ search: search || undefined });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  async function doDelete(m: PosModelDto, password?: string): Promise<void> {
    const res = await window.api.posModelDelete([m.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa chủng loại ${m.code}`);
    else toast.alert(res.message ?? 'Xóa chủng loại thất bại', 'Xóa thất bại');
    setDel(null);
    await reload();
  }

  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.posModelDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} chủng loại`);
    else toast.alert(res.message ?? 'Xóa chủng loại thất bại', 'Xóa thất bại');
    setBulkDel(false);
    await reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} chủng loại máy</div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('chung_loai_pos', ['Mã máy', 'Tên máy', 'Cập nhật'], rows.map((r) => [r.code, r.name, `${fmtDate(r.updatedAt)} ${fmtTime(r.updatedAt)}`]))}>Xuất Excel</Button>
          {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>Thêm chủng loại</Button>}
        </div>
      </div>
      <FilterBar search={search} onSearch={setSearch} searchPlaceholder="Tìm mã / tên máy…" onApply={reload} onReset={() => { setSearch(''); setTimeout(reload, 0); }} />
      {canManage && <SelectionBar count={sel.count} entityLabel="chủng loại" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Mã máy POS</th>
              <th className="px-4 py-3">Tên máy POS</th>
              <th className="px-4 py-3">Người sửa gần nhất</th>
              <th className="px-4 py-3">Ngày</th>
              <th className="px-4 py-3">Giờ</th>
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canManage ? 7 : 5} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canManage ? 7 : 5} className="px-4 py-10 text-center text-slate-400"><Cpu className="mx-auto mb-2 h-6 w-6" /> Chưa có chủng loại máy.</td></tr>}
            {!loading && rows.map((m) => (
              <tr key={m.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(m.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={m.id} sel={sel} />}
                <td className="px-4 py-3 font-mono text-xs font-semibold text-brand">{m.code}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{m.name}</td>
                {trailCells(m)}
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: m })}><Pencil className="h-4 w-4" /></IconBtn>
                      <IconBtn title="Xóa" variant="danger" onClick={() => setDel(m)}><Trash2 className="h-4 w-4" /></IconBtn>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <ModelForm mode={form.mode} row={form.row} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa chủng loại máy POS" message={`Chủng loại "${del.name}" (${del.code}) sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều chủng loại" message={`${sel.count} chủng loại đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function ModelForm({ mode, row, onClose, onSaved }: { mode: 'create' | 'edit'; row?: PosModelDto; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [code, setCode] = useState(row?.code ?? '');
  const [name, setName] = useState(row?.name ?? '');
  const [busy, setBusy] = useState(false);
  async function save(): Promise<void> {
    if (!code.trim()) return toast.alert('Mã máy POS bắt buộc.', 'Thiếu thông tin');
    if (!name.trim()) return toast.alert('Tên máy POS bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const res = mode === 'edit' && row ? await window.api.posModelUpdate(row.id, { code: code.trim(), name: name.trim() }) : await window.api.posModelCreate({ code: code.trim(), name: name.trim() });
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật chủng loại' : `Đã thêm chủng loại ${code}`); onSaved(); }
    else toast.alert(res.message ?? 'Lưu chủng loại thất bại', 'Không lưu được');
  }
  return (
    <Modal title={mode === 'edit' ? `Sửa chủng loại ${row?.code}` : 'Thêm chủng loại máy POS'} onClose={onClose} width="max-w-md" onSubmit={() => void save()}>
      <div className="grid gap-4">
        <Field label="Mã máy POS" required hint="Ví dụ: PAX-A920, VX520"><input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></Field>
        <Field label="Tên máy POS" required><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm chủng loại'}</Button>
      </div>
    </Modal>
  );
}

// ── §C8a TRẠNG THÁI NHẬP MÁY ─────────────────────────────────────────────────
export function StatusTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<IntakeStatusDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: IntakeStatusDto } | null>(null);
  const [del, setDel] = useState<IntakeStatusDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.intakeStatusList();
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  async function doDelete(s: IntakeStatusDto, password?: string): Promise<void> {
    const res = await window.api.intakeStatusDelete([s.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa trạng thái ${s.name}`);
    else toast.alert(res.message ?? 'Xóa trạng thái thất bại', 'Xóa thất bại');
    setDel(null);
    await reload();
  }

  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.intakeStatusDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} trạng thái`);
    else toast.alert(res.message ?? 'Xóa trạng thái thất bại', 'Xóa thất bại');
    setBulkDel(false);
    await reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} trạng thái nhập máy · <span className="text-slate-400">ví dụ: Máy mới, Máy cũ, Máy đổi, Máy thuê</span></div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('trang_thai_nhap', ['Tên trạng thái', 'Người sửa gần nhất', 'Ngày', 'Giờ'], rows.map((s) => [s.name, s.updatedByName ?? s.createdByName ?? '', fmtDate(s.updatedAt), fmtTime(s.updatedAt)]))}>Xuất Excel</Button>
          {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>Thêm trạng thái</Button>}
        </div>
      </div>
      {canManage && <SelectionBar count={sel.count} entityLabel="trạng thái" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Tên trạng thái</th>
              <th className="px-4 py-3">Người sửa gần nhất</th>
              <th className="px-4 py-3">Ngày</th>
              <th className="px-4 py-3">Giờ</th>
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canManage ? 6 : 4} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canManage ? 6 : 4} className="px-4 py-10 text-center text-slate-400"><Tag className="mx-auto mb-2 h-6 w-6" /> Chưa có trạng thái nhập máy.</td></tr>}
            {!loading && rows.map((s) => (
              <tr key={s.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(s.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={s.id} sel={sel} />}
                <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                {trailCells(s)}
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: s })}><Pencil className="h-4 w-4" /></IconBtn>
                      <IconBtn title="Xóa" variant="danger" onClick={() => setDel(s)}><Trash2 className="h-4 w-4" /></IconBtn>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <StatusForm mode={form.mode} row={form.row} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa trạng thái nhập máy" message={`Trạng thái "${del.name}" sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều trạng thái" message={`${sel.count} trạng thái đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function StatusForm({ mode, row, onClose, onSaved }: { mode: 'create' | 'edit'; row?: IntakeStatusDto; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [name, setName] = useState(row?.name ?? '');
  const [busy, setBusy] = useState(false);
  async function save(): Promise<void> {
    if (!name.trim()) return toast.alert('Tên trạng thái bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const res = mode === 'edit' && row ? await window.api.intakeStatusUpdate(row.id, { name: name.trim() }) : await window.api.intakeStatusCreate({ name: name.trim() });
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật trạng thái' : `Đã thêm trạng thái ${name}`); onSaved(); }
    else toast.alert(res.message ?? 'Lưu trạng thái thất bại', 'Không lưu được');
  }
  return (
    <Modal title={mode === 'edit' ? 'Sửa trạng thái nhập máy' : 'Thêm trạng thái nhập máy'} onClose={onClose} width="max-w-md" onSubmit={() => void save()}>
      <Field label="Tên trạng thái" required hint="Ví dụ: Máy mới, Máy cũ, Máy đổi, Máy thuê"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm trạng thái'}</Button>
      </div>
    </Modal>
  );
}

// ── §C8b NHẬP KHO MÁY POS ────────────────────────────────────────────────────
export function IntakeTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<PosIntakeDto[]>([]);
  const [models, setModels] = useState<LiteRef[]>([]);
  const [suppliers, setSuppliers] = useState<LiteRef[]>([]);
  const [statuses, setStatuses] = useState<IntakeStatusDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [modelId, setModelId] = useState('');
  const [statusId, setStatusId] = useState(''); // FIX 1d — lọc trạng thái máy CLIENT-SIDE
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: PosIntakeDto } | null>(null);
  const [del, setDel] = useState<PosIntakeDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function loadRefs(): Promise<void> {
    const [m, s, st] = await Promise.all([window.api.posModelLite(), window.api.supplierLite(), window.api.intakeStatusList()]);
    if (m.ok && m.data) setModels(m.data);
    if (s.ok && s.data) setSuppliers(s.data);
    if (st.ok && st.data) setStatuses(st.data);
  }
  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.posIntakeList({ search: search || undefined, supplierId: supplierId ? Number(supplierId) : undefined, posModelId: modelId ? Number(modelId) : undefined });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void loadRefs(); }, []);
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [supplierId, modelId]);

  async function doDelete(pi: PosIntakeDto, password?: string): Promise<void> {
    const res = await window.api.posIntakeDelete([pi.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa máy POS ${pi.serial}`);
    else toast.alert(res.message ?? 'Xóa máy POS thất bại', 'Xóa thất bại');
    setDel(null);
    await reload();
  }

  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.posIntakeDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} máy POS`);
    else toast.alert(res.message ?? 'Xóa máy POS thất bại', 'Xóa thất bại');
    setBulkDel(false);
    await reload();
  }

  const prereqDefs: PrereqDef[] = [
    { count: models.length, label: 'Chủng loại máy', where: "tab 'Chủng loại POS'" },
    { count: suppliers.length, label: 'Nhà cung cấp', where: "tab 'Nhà cung cấp'" },
    { count: statuses.length, label: 'Trạng thái nhập máy', where: "tab 'Trạng thái nhập'" }
  ];
  const canAdd = canManage && prereqMessage(prereqDefs) === null;
  // FIX 1d — lọc trạng thái máy client-side (không đổi API posIntakeList).
  const visibleRows = statusId ? rows.filter((r) => String(r.intakeStatusId) === statusId) : rows;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{visibleRows.length} máy POS trong kho</div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('nhap_kho_pos', ['Số thứ tự', 'Chủng loại', 'Số seri', 'Nhà cung cấp', 'Giá nhập', 'Ngày nhập', 'Trạng thái'], visibleRows.map((r, i) => [i + 1, `${r.posModelCode} · ${r.posModelName}`, r.serial, r.supplierName, r.importPrice, fmtDate(r.importedAt), r.intakeStatusName]))}>Xuất Excel</Button>
          {canManage && <ImportButton entityKey="posIntake" label="POS nhập kho" onImported={reload} />}
          {canManage && <Button variant="confirm" icon={<PackagePlus className="h-4 w-4" />} onClick={() => canAdd ? setForm({ mode: 'create' }) : toast.alert(prereqMessage(prereqDefs) ?? 'Thiếu dữ liệu nền để nhập kho.', 'Thiếu dữ liệu nền')}>Nhập kho máy POS</Button>}
        </div>
      </div>
      <FilterBar
        search={search} onSearch={setSearch} searchPlaceholder="Tìm seri / ghi chú…"
        selects={[
          { key: 'model', placeholder: 'Tất cả chủng loại', value: modelId, options: models.map((m) => ({ value: String(m.id), label: `${m.code} · ${m.name}` })), onChange: setModelId },
          { key: 'sup', placeholder: 'Tất cả nhà cung cấp', value: supplierId, options: suppliers.map((s) => ({ value: String(s.id), label: `${s.code} · ${s.name}` })), onChange: setSupplierId },
          { key: 'status', placeholder: 'Tất cả trạng thái', value: statusId, options: statuses.map((s) => ({ value: String(s.id), label: s.name })), onChange: setStatusId }
        ]}
        onApply={reload} onReset={() => { setSearch(''); setSupplierId(''); setModelId(''); setStatusId(''); setTimeout(reload, 0); }}
      />
      {canManage && <SelectionBar count={sel.count} entityLabel="máy POS" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={visibleRows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Số thứ tự</th>
              <th className="px-4 py-3">Chủng loại</th>
              <th className="px-4 py-3">Seri number</th>
              <th className="px-4 py-3">Nhà cung cấp</th>
              <th className="px-4 py-3 text-right">Giá nhập</th>
              <th className="px-4 py-3">Ngày nhập</th>
              <th className="px-4 py-3">Trạng thái</th>
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canManage ? 9 : 7} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && visibleRows.length === 0 && <tr><td colSpan={canManage ? 9 : 7} className="px-4 py-10 text-center text-slate-400"><PackagePlus className="mx-auto mb-2 h-6 w-6" /> {statusId ? 'Không có máy POS khớp trạng thái đã lọc.' : 'Chưa có máy POS nào nhập kho.'}</td></tr>}
            {!loading && visibleRows.map((pi, i) => (
              <tr key={pi.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(pi.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={pi.id} sel={sel} />}
                <td className="px-4 py-3 text-slate-500">{i + 1}</td>
                <td className="px-4 py-3"><span className="font-mono text-xs font-semibold text-brand">{pi.posModelCode}</span> <span className="text-slate-700">{pi.posModelName}</span></td>
                <td className="px-4 py-3 font-mono text-xs font-medium text-slate-800">{pi.serial}</td>
                <td className="px-4 py-3 text-slate-600">{pi.supplierCode ? `${pi.supplierCode} · ${pi.supplierName}` : (pi.supplierName ?? '—')}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">{fmtVnd(pi.importPrice)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(pi.importedAt)}</td>
                <td className="px-4 py-3"><span className="rounded bg-brand-tint px-1.5 py-0.5 text-xs font-medium text-brand">{pi.intakeStatusName ?? '—'}</span></td>
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: pi })}><Pencil className="h-4 w-4" /></IconBtn>
                      <IconBtn title="Xóa" variant="danger" onClick={() => setDel(pi)}><Trash2 className="h-4 w-4" /></IconBtn>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <IntakeForm mode={form.mode} row={form.row} models={models} suppliers={suppliers} statuses={statuses} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa máy POS nhập kho" message={`Máy POS seri "${del.serial}" sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều máy POS" message={`${sel.count} máy POS đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function IntakeForm({ mode, row, models, suppliers, statuses, onClose, onSaved }: { mode: 'create' | 'edit'; row?: PosIntakeDto; models: LiteRef[]; suppliers: LiteRef[]; statuses: IntakeStatusDto[]; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [posModelId, setPosModelId] = useState(row?.posModelId ? String(row.posModelId) : '');
  const [serial, setSerial] = useState(row?.serial ?? '');
  const [intakeStatusId, setIntakeStatusId] = useState(row?.intakeStatusId ? String(row.intakeStatusId) : '');
  const [supplierId, setSupplierId] = useState(row?.supplierId ? String(row.supplierId) : '');
  const [price, setPrice] = useState(row ? String(row.importPrice) : '');
  const [importedAt, setImportedAt] = useState(row ? row.importedAt.slice(0, 10) : '');
  const [note, setNote] = useState(row?.note ?? '');
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (!posModelId) return toast.alert('Vui lòng chọn chủng loại máy.', 'Thiếu thông tin');
    if (!serial.trim()) return toast.alert('Seri number bắt buộc.', 'Thiếu thông tin');
    if (!intakeStatusId) return toast.alert('Vui lòng chọn trạng thái nhập máy.', 'Thiếu thông tin');
    if (!supplierId) return toast.alert('Vui lòng chọn nhà cung cấp.', 'Thiếu thông tin');
    const priceNum = Number(price.replace(/\D/g, ''));
    if (!price || !Number.isInteger(priceNum) || priceNum < 0) return toast.alert('Giá nhập phải là số nguyên ≥ 0.', 'Giá không hợp lệ');
    if (!importedAt) return toast.alert('Vui lòng nhập đủ ngày/tháng/năm nhập.', 'Thiếu ngày nhập');
    setBusy(true);
    const payload = { posModelId: Number(posModelId), serial: serial.trim(), intakeStatusId: Number(intakeStatusId), supplierId: Number(supplierId), importPrice: priceNum, importedAt, note: note || null };
    const res = mode === 'edit' && row ? await window.api.posIntakeUpdate(row.id, payload) : await window.api.posIntakeCreate(payload);
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật máy POS' : `Đã nhập kho máy ${serial}`); onSaved(); }
    else toast.alert(res.message ?? 'Lưu máy POS thất bại', 'Không lưu được');
  }

  const priceNum = parseVndInput(price) ?? 0;
  return (
    <Modal title={mode === 'edit' ? `Sửa máy POS ${row?.serial}` : 'Nhập kho máy POS mới'} onClose={onClose} width="max-w-xl" onSubmit={() => void save()}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Chủng loại máy" required><select className={inputCls} value={posModelId} onChange={(e) => setPosModelId(e.target.value)} autoFocus><option value="">— Chọn chủng loại —</option>{models.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select></Field>
        <Field label="Seri number" required hint="Chữ + số, không giới hạn"><input className={inputCls} value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
        <Field label="Nhà cung cấp" required><select className={inputCls} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">— Chọn nhà cung cấp —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
        <Field label="Trạng thái nhập" required><select className={inputCls} value={intakeStatusId} onChange={(e) => setIntakeStatusId(e.target.value)}><option value="">— Chọn trạng thái —</option>{statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Giá nhập (VND)" required hint={price ? fmtVnd(priceNum) : 'Số nguyên đồng'}><input className={inputCls} inputMode="numeric" value={groupDigits(price)} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} placeholder="5.000.000" /></Field>
        <Field label="Ngày nhập" required><DateInput value={importedAt} onChange={setImportedAt} /></Field>
        <div className="col-span-2"><Field label="Ghi chú"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Nhập kho'}</Button>
      </div>
    </Modal>
  );
}
