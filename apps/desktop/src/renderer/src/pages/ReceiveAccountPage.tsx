import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, Wallet, Tag, Download, RefreshCw } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTime, prereqMessage } from '@glb/shared';
import type { RcvSourceDto, RcvAccountDto, LiteRef, CustomerDto, RcvAccountInput } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';
import { Button } from '../components/Button.js';
import { useRowSelection, SelectionBar, SelectAllCell, SelectCell } from '../components/Selection.js';
import { Thumb, AttachField } from '../components/Attach.js';
import { exportCsv } from '../lib/exportCsv.js';

type Tab = 'account' | 'source';

function IconBtn({ children, title, variant, onClick }: { children: JSX.Element; title: string; variant?: 'edit' | 'danger'; onClick: () => void }): JSX.Element {
  const tone = variant === 'danger' ? 'text-danger hover:bg-danger/10' : variant === 'edit' ? 'text-warning hover:bg-warning/10' : 'text-slate-400 hover:bg-brand-tint hover:text-brand';
  return <button title={title} onClick={onClick} className={'rounded-md p-1.5 transition ' + tone}>{children}</button>;
}

export function ReceiveAccountPage({ user }: { user: AuthUser }): JSX.Element {
  const [tab, setTab] = useState<Tab>('account');
  const canManage = hasPermission(user, 'CONFIG_RCV_ACCT_MANAGE');
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Quản Lý Tài Khoản Nhận Tiền</h2>
        <p className="text-sm text-slate-500">Tài khoản nhận tiền (kèm CCCD ủy quyền) · Nguồn tài khoản.</p>
      </div>
      <div className="mb-3 flex items-center gap-1 border-b border-line">
        <button onClick={() => setTab('account')} className={'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition ' + (tab === 'account' ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700')}><Wallet className="h-4 w-4" /> Tài khoản nhận tiền</button>
        <button onClick={() => setTab('source')} className={'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition ' + (tab === 'source' ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700')}><Tag className="h-4 w-4" /> Nguồn tài khoản</button>
      </div>
      {tab === 'account' && <AccountTab canManage={canManage} />}
      {tab === 'source' && <SourceTab canManage={canManage} />}
    </div>
  );
}

// ── §8a NGUỒN TÀI KHOẢN ──────────────────────────────────────────────────────
function SourceTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<RcvSourceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: RcvSourceDto } | null>(null);
  const [del, setDel] = useState<RcvSourceDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.rcvSourceList();
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  async function doDelete(s: RcvSourceDto, password?: string): Promise<void> {
    const res = await window.api.rcvSourceDelete([s.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa nguồn ${s.name}`);
    else toast.alert(res.message ?? 'Xóa nguồn thất bại', 'Xóa thất bại');
    setDel(null); await reload();
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.rcvSourceDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} nguồn`);
    else toast.alert(res.message ?? 'Xóa nguồn thất bại', 'Xóa thất bại');
    setBulkDel(false); await reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} nguồn · <span className="text-slate-400">ví dụ: Khách hàng, Nội bộ</span></div>
        <div className="flex gap-2">
          <button onClick={() => void reload()} title="Tải lại dữ liệu mới nhất (giữ nguyên bộ lọc)" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"><RefreshCw className="h-4 w-4" /> Làm mới</button>
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('nguon_tk', ['Tên nguồn', 'Người sửa gần nhất', 'Ngày', 'Giờ'], rows.map((s) => [s.name, s.updatedByName ?? s.createdByName ?? '', fmtDate(s.updatedAt), fmtTime(s.updatedAt)]))}>Xuất Excel</Button>
          {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>Thêm nguồn</Button>}
        </div>
      </div>
      {canManage && <SelectionBar count={sel.count} entityLabel="nguồn" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Tên nguồn</th>
              <th className="px-4 py-3">Người sửa gần nhất</th>
              <th className="px-4 py-3">Ngày</th>
              <th className="px-4 py-3">Giờ</th>
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canManage ? 6 : 4} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canManage ? 6 : 4} className="px-4 py-10 text-center text-slate-400"><Tag className="mx-auto mb-2 h-6 w-6" /> Chưa có nguồn tài khoản.</td></tr>}
            {!loading && rows.map((s) => (
              <tr key={s.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(s.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={s.id} sel={sel} />}
                <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                <td className="px-4 py-3 text-slate-600">{s.updatedByName ?? s.createdByName ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(s.updatedAt)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmtTime(s.updatedAt)}</td>
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
      {del && <ConfirmDialog title="Xóa nguồn tài khoản" message={`Nguồn "${del.name}" sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều nguồn" message={`${sel.count} nguồn đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function SourceForm({ mode, row, onClose, onSaved }: { mode: 'create' | 'edit'; row?: RcvSourceDto; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [name, setName] = useState(row?.name ?? '');
  const [busy, setBusy] = useState(false);
  async function save(): Promise<void> {
    if (!name.trim()) return toast.alert('Tên nguồn bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const res = mode === 'edit' && row ? await window.api.rcvSourceUpdate(row.id, { name: name.trim() }) : await window.api.rcvSourceCreate({ name: name.trim() });
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật nguồn' : `Đã thêm nguồn ${name}`); onSaved(); }
    else toast.alert(res.message ?? 'Lưu nguồn thất bại', 'Không lưu được');
  }
  return (
    <Modal title={mode === 'edit' ? 'Sửa nguồn tài khoản' : 'Thêm nguồn tài khoản'} onClose={onClose} width="max-w-md">
      <Field label="Tên nguồn" required hint="Ví dụ: Khách hàng, Nội bộ"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm nguồn'}</Button>
      </div>
    </Modal>
  );
}

// ── §8b TÀI KHOẢN NHẬN TIỀN ──────────────────────────────────────────────────
function AccountTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<RcvAccountDto[]>([]);
  const [sources, setSources] = useState<RcvSourceDto[]>([]);
  const [banks, setBanks] = useState<LiteRef[]>([]);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fSource, setFSource] = useState('');
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: RcvAccountDto } | null>(null);
  const [del, setDel] = useState<RcvAccountDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function loadRefs(): Promise<void> {
    const [s, b, c] = await Promise.all([window.api.rcvSourceList(), window.api.bankLite(), window.api.customerList({})]);
    if (s.ok && s.data) setSources(s.data);
    if (b.ok && b.data) setBanks(b.data);
    if (c.ok && c.data) setCustomers(c.data);
  }
  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.rcvAccountList({ search: search || undefined, sourceId: fSource ? Number(fSource) : undefined });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void loadRefs(); }, []);
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [fSource]);

  async function doDelete(a: RcvAccountDto, password?: string): Promise<void> {
    const res = await window.api.rcvAccountDelete([a.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa tài khoản ${a.accountNumber}`);
    else toast.alert(res.message ?? 'Xóa tài khoản thất bại', 'Xóa thất bại');
    setDel(null); await reload();
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.rcvAccountDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} tài khoản`);
    else toast.alert(res.message ?? 'Xóa tài khoản thất bại', 'Xóa thất bại');
    setBulkDel(false); await reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} tài khoản</div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('tk_nhan_tien', ['Nguồn', 'Tên TK', 'STK', 'Ngân hàng', 'Chi nhánh', 'CCCD', 'Khách hàng', 'Số điện thoại'], rows.map((r) => [r.sourceName, r.accountName, r.accountNumber, r.bankCode, r.branch, r.cccdNumber, r.customerName ?? 'Nội bộ', r.phone]))}>Xuất Excel</Button>
          {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => { const msg = prereqMessage([{ count: sources.length, label: 'Nguồn tài khoản', where: "tab 'Nguồn tài khoản'" }, { count: banks.length, label: 'Ngân hàng', where: "tab 'Ngân hàng'" }]); return msg ? toast.alert(msg, 'Thiếu dữ liệu nền') : setForm({ mode: 'create' }); }}>Thêm tài khoản</Button>}
        </div>
      </div>
      <FilterBar search={search} onSearch={setSearch} searchPlaceholder="Tìm tên TK / STK / CCCD / Số điện thoại…"
        selects={[{ key: 's', placeholder: 'Tất cả nguồn', value: fSource, options: sources.map((s) => ({ value: String(s.id), label: s.name })), onChange: setFSource }]}
        onApply={reload} onReset={() => { setSearch(''); setFSource(''); setTimeout(reload, 0); }} />
      {canManage && <SelectionBar count={sel.count} entityLabel="tài khoản" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Nguồn</th>
              <th className="px-4 py-3">Tên tài khoản</th>
              <th className="px-4 py-3">Số tài khoản</th>
              <th className="px-4 py-3">Ngân hàng</th>
              <th className="px-4 py-3">Khách hàng</th>
              <th className="px-4 py-3">CCCD</th>
              <th className="px-4 py-3">Ảnh</th>
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canManage ? 9 : 7} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canManage ? 9 : 7} className="px-4 py-10 text-center text-slate-400"><Wallet className="mx-auto mb-2 h-6 w-6" /> Chưa có tài khoản nhận tiền.</td></tr>}
            {!loading && rows.map((a) => (
              <tr key={a.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(a.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={a.id} sel={sel} />}
                <td className="px-4 py-3"><span className="rounded bg-brand-tint px-1.5 py-0.5 text-xs font-medium text-brand">{a.sourceName ?? '—'}</span></td>
                <td className="px-4 py-3 font-medium text-slate-800">{a.accountName}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{a.accountNumber}</td>
                <td className="px-4 py-3 text-slate-600">{a.bankCode ?? '—'}{a.branch ? ` · ${a.branch}` : ''}</td>
                <td className="px-4 py-3 text-slate-600">{a.customerName ?? <span className="text-slate-400">Nội bộ</span>}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{a.cccdNumber ?? '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {a.cccdFrontPath ? <Thumb relPath={a.cccdFrontPath} label="CCCD mặt trước" /> : <span className="text-xs text-slate-400">—</span>}
                    {a.cccdBackPath && <Thumb relPath={a.cccdBackPath} label="CCCD mặt sau" />}
                  </div>
                </td>
                {canManage && (
                  <td className="px-4 py-3"><div className="flex justify-end gap-1">
                    <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: a })}><Pencil className="h-4 w-4" /></IconBtn>
                    <IconBtn title="Xóa" variant="danger" onClick={() => setDel(a)}><Trash2 className="h-4 w-4" /></IconBtn>
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <AccountForm mode={form.mode} row={form.row} sources={sources} banks={banks} customers={customers} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa tài khoản nhận tiền" message={`Tài khoản "${del.accountName}" (${del.accountNumber}) sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều tài khoản" message={`${sel.count} tài khoản đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function AccountForm({ mode, row, sources, banks, customers, onClose, onSaved }: { mode: 'create' | 'edit'; row?: RcvAccountDto; sources: RcvSourceDto[]; banks: LiteRef[]; customers: CustomerDto[]; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [f, setF] = useState({
    sourceId: row?.sourceId ? String(row.sourceId) : '',
    accountName: row?.accountName ?? '',
    accountNumber: row?.accountNumber ?? '',
    bankId: row?.bankId ? String(row.bankId) : '',
    branch: row?.branch ?? '',
    cccdNumber: row?.cccdNumber ?? '',
    cccdIssueDate: row?.cccdIssueDate ? row.cccdIssueDate.slice(0, 10) : '',
    cccdIssuePlace: row?.cccdIssuePlace ?? '',
    cccdExpiry: row?.cccdExpiry ? row.cccdExpiry.slice(0, 10) : '',
    phone: row?.phone ?? '',
    email: row?.email ?? '',
    customerId: row?.customerId ? String(row.customerId) : ''
  });
  // Đính kèm: undefined = giữ, null = gỡ, string = ảnh mới (path nguồn).
  const [frontSrc, setFrontSrc] = useState<string | null | undefined>(undefined);
  const [backSrc, setBackSrc] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => setF({ ...f, [k]: e.target.value });

  async function save(): Promise<void> {
    if (!f.sourceId) return toast.alert('Vui lòng chọn nguồn tài khoản.', 'Thiếu thông tin');
    if (!f.accountName.trim()) return toast.alert('Tên tài khoản bắt buộc.', 'Thiếu thông tin');
    if (!f.accountNumber.trim()) return toast.alert('Số tài khoản bắt buộc.', 'Thiếu thông tin');
    if (!f.bankId) return toast.alert('Vui lòng chọn ngân hàng.', 'Thiếu thông tin');
    setBusy(true);
    const input: RcvAccountInput = {
      sourceId: Number(f.sourceId),
      accountName: f.accountName.trim(),
      accountNumber: f.accountNumber.trim(),
      bankId: Number(f.bankId),
      branch: f.branch || null,
      cccdNumber: f.cccdNumber || null,
      cccdIssueDate: f.cccdIssueDate || null,
      cccdIssuePlace: f.cccdIssuePlace || null,
      cccdExpiry: f.cccdExpiry || null,
      phone: f.phone || null,
      email: f.email || null,
      customerId: f.customerId ? Number(f.customerId) : null
    };
    if (frontSrc !== undefined) input.cccdFrontSrc = frontSrc;
    if (backSrc !== undefined) input.cccdBackSrc = backSrc;
    const res = mode === 'edit' && row ? await window.api.rcvAccountUpdate(row.id, input) : await window.api.rcvAccountCreate(input);
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật tài khoản' : `Đã thêm tài khoản ${f.accountNumber}`); onSaved(); }
    else toast.alert(res.message ?? 'Lưu tài khoản thất bại', 'Không lưu được');
  }

  return (
    <Modal title={mode === 'edit' ? `Sửa tài khoản ${row?.accountNumber}` : 'Thêm tài khoản nhận tiền'} onClose={onClose} width="max-w-2xl">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nguồn tài khoản" required><select className={inputCls} value={f.sourceId} onChange={set('sourceId')} autoFocus><option value="">— Chọn nguồn —</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Gắn khách hàng" hint="Bỏ trống = Nội bộ"><select className={inputCls} value={f.customerId} onChange={set('customerId')}><option value="">— Nội bộ —</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.nickname} ({c.fullName})</option>)}</select></Field>
        <Field label="Tên tài khoản" required><input className={inputCls} value={f.accountName} onChange={set('accountName')} /></Field>
        <Field label="Số tài khoản" required><input className={inputCls} value={f.accountNumber} onChange={set('accountNumber')} /></Field>
        <Field label="Ngân hàng" required><select className={inputCls} value={f.bankId} onChange={set('bankId')}><option value="">— Chọn ngân hàng —</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></Field>
        <Field label="Chi nhánh"><input className={inputCls} value={f.branch} onChange={set('branch')} /></Field>
        <Field label="Số CCCD"><input className={inputCls} value={f.cccdNumber} onChange={set('cccdNumber')} /></Field>
        <Field label="Nơi cấp CCCD"><input className={inputCls} value={f.cccdIssuePlace} onChange={set('cccdIssuePlace')} /></Field>
        <Field label="Ngày cấp CCCD"><input type="date" className={inputCls} value={f.cccdIssueDate} onChange={set('cccdIssueDate')} /></Field>
        <Field label="Ngày hết hạn CCCD"><input type="date" className={inputCls} value={f.cccdExpiry} onChange={set('cccdExpiry')} /></Field>
        <Field label="Số điện thoại"><input className={inputCls} value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email đối soát"><input className={inputCls} value={f.email} onChange={set('email')} /></Field>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 rounded-lg border border-line bg-appbg/50 p-3">
        <AttachField label="Ảnh CCCD mặt trước" current={frontSrc === null ? null : row?.cccdFrontPath ?? null} srcPath={typeof frontSrc === 'string' ? frontSrc : null} onPick={(p) => setFrontSrc(p)} onClear={() => setFrontSrc(null)} />
        <AttachField label="Ảnh CCCD mặt sau (không bắt buộc)" current={backSrc === null ? null : row?.cccdBackPath ?? null} srcPath={typeof backSrc === 'string' ? backSrc : null} onPick={(p) => setBackSrc(p)} onClear={() => setBackSrc(null)} />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm tài khoản'}</Button>
      </div>
    </Modal>
  );
}
