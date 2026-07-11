import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, Landmark, CreditCard, Building2, Download, Link2, Percent, Tags, CircleDot } from 'lucide-react';
import { FeeConfigPage } from './FeeConfigPage.js';
import { IndustryConfigPage } from './IndustryConfigPage.js';
import { StatusConfigPage } from './StatusConfigPage.js';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTime } from '@glb/shared';
import type { BankDto, CardTypeDto, PartnerDto, PartnerBankMatrix } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';
import { Button } from '../components/Button.js';
import { useRowSelection, SelectionBar, SelectAllCell, SelectCell } from '../components/Selection.js';
import { StatBar } from '../components/StatBar.js';
import { AuditTrailHeadCells, AuditTrailCells, AUDIT_TRAIL_COLS } from '../components/AuditCells.js';
import { StatusBadge, useStatusOptions, statusSelectOptions, toneCls } from '../components/StatusBadge.js';
import { TabBar, TabButton } from '../components/Tabs.js';
import { exportCsv } from '../lib/exportCsv.js';

type Tab = 'bank' | 'cardtype' | 'partner' | 'industry' | 'status' | 'fee';

// Nút icon theo quy ước màu (R_BUTTON_SEMANTICS): sửa=vàng, xóa=đỏ.
function IconBtn({ children, title, variant, onClick }: { children: JSX.Element; title: string; variant?: 'edit' | 'danger'; onClick: () => void }): JSX.Element {
  const tone = variant === 'danger' ? 'text-danger hover:bg-danger/10' : variant === 'edit' ? 'text-warning hover:bg-warning/10' : 'text-slate-400 hover:bg-brand-tint hover:text-brand';
  return (
    <button title={title} onClick={onClick} className={'rounded-md p-1.5 transition ' + tone}>
      {children}
    </button>
  );
}

export function BankConfigPage({ user }: { user: AuthUser }): JSX.Element {
  const canBank = hasPermission(user, 'CONFIG_BANK_VIEW');
  const canFee = hasPermission(user, 'CONFIG_FEE_VIEW');
  const canIndustry = hasPermission(user, 'CONFIG_INDUSTRY_VIEW');
  const canStatus = hasPermission(user, 'SYSTEM_SETTING_VIEW');
  const [tab, setTab] = useState<Tab>(canBank ? 'bank' : canFee ? 'fee' : canIndustry ? 'industry' : canStatus ? 'status' : 'bank');
  const canManage = hasPermission(user, 'CONFIG_BANK_MANAGE');
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Cấu hình ngân hàng</h2>
        <p className="text-sm text-slate-500">Ngân hàng · Loại thẻ dùng trên máy POS · Đối tác và liên kết ngân hàng · Ngành nghề · Phí mua-cài máy-bán · Trạng thái.</p>
      </div>
      <TabBar>
        {canBank && <TabButton active={tab === 'bank'} onClick={() => setTab('bank')} icon={<Landmark className="h-4 w-4" />}>Ngân hàng</TabButton>}
        {canBank && <TabButton active={tab === 'cardtype'} onClick={() => setTab('cardtype')} icon={<CreditCard className="h-4 w-4" />}>Loại thẻ</TabButton>}
        {canBank && <TabButton active={tab === 'partner'} onClick={() => setTab('partner')} icon={<Building2 className="h-4 w-4" />}>Đối tác</TabButton>}
        {canIndustry && <TabButton active={tab === 'industry'} onClick={() => setTab('industry')} icon={<Tags className="h-4 w-4" />}>Ngành nghề</TabButton>}
        {canFee && <TabButton active={tab === 'fee'} onClick={() => setTab('fee')} icon={<Percent className="h-4 w-4" />}>Phí mua-cài máy-bán</TabButton>}
        {canStatus && <TabButton active={tab === 'status'} onClick={() => setTab('status')} icon={<CircleDot className="h-4 w-4" />}>Trạng thái</TabButton>}
      </TabBar>
      {tab === 'bank' && canBank && <BankTab canManage={canManage} />}
      {tab === 'cardtype' && canBank && <CardTypeTab canManage={canManage} />}
      {tab === 'partner' && canBank && <PartnerTab canManage={canManage} />}
      {tab === 'industry' && canIndustry && <IndustryConfigPage user={user} />}
      {tab === 'fee' && canFee && <FeeConfigPage user={user} />}
      {tab === 'status' && canStatus && <StatusConfigPage user={user} />}
    </div>
  );
}

// ── C1/C2 NGÂN HÀNG ─────────────────────────────────────────────────────────
function BankTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const { options: bankStatusOptions } = useStatusOptions('BANK');
  const [rows, setRows] = useState<BankDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: BankDto } | null>(null);
  const [del, setDel] = useState<BankDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.bankList({ search: search || undefined, status: statusFilter || undefined, fromDate: fromDate || undefined, toDate: toDate || undefined });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  async function doDelete(b: BankDto, password?: string): Promise<void> {
    const res = await window.api.bankDelete([b.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa ngân hàng ${b.code}`);
    else toast.alert(res.message ?? 'Xóa ngân hàng thất bại', 'Xóa thất bại');
    setDel(null);
    await reload();
  }

  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.bankDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} ngân hàng`);
    else toast.alert(res.message ?? 'Xóa ngân hàng thất bại', 'Xóa thất bại');
    setBulkDel(false);
    await reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} ngân hàng</div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('ngan_hang', ['STT', 'Mã', 'Tên ngân hàng', 'Trạng thái', 'Người tạo', 'Ngày tạo', 'Giờ tạo', 'Người sửa', 'Ngày sửa', 'Giờ sửa'], rows.map((r) => [r.seqCode ?? '', r.code, r.name, r.status === 'ACTIVE' ? 'Đang hoạt động' : 'Không hoạt động', r.createdByName ?? '', fmtDate(r.createdAt), fmtTime(r.createdAt), r.updatedByName ?? '', fmtDate(r.updatedAt), fmtTime(r.updatedAt)]))}>Xuất Excel</Button>
          {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>Thêm ngân hàng</Button>}
        </div>
      </div>
      <StatBar
        items={[
          { label: 'Tổng ngân hàng', value: rows.length, tone: 'bg-brand-tint text-brand' },
          ...bankStatusOptions.filter((o) => o.active).map((o) => ({ label: o.label, value: rows.filter((b) => b.status === o.code).length, tone: toneCls(o.tone) }))
        ]}
      />
      <FilterBar search={search} onSearch={setSearch} searchPlaceholder="Tìm mã / tên ngân hàng…" fromDate={fromDate} toDate={toDate} onFromDate={setFromDate} onToDate={setToDate} selects={[{ key: 'status', placeholder: 'Tất cả trạng thái', value: statusFilter, options: bankStatusOptions.filter((o) => o.active).map((o) => ({ value: o.code, label: o.label })), onChange: setStatusFilter }]} onApply={reload} onReset={() => { setSearch(''); setStatusFilter(''); setFromDate(''); setToDate(''); setTimeout(reload, 0); }} />
      {canManage && <SelectionBar count={sel.count} entityLabel="ngân hàng" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">STT</th>
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Tên ngân hàng</th>
              <th className="px-4 py-3">Trạng thái</th>
              <AuditTrailHeadCells />
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={(canManage ? 6 : 4) + AUDIT_TRAIL_COLS} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={(canManage ? 6 : 4) + AUDIT_TRAIL_COLS} className="px-4 py-10 text-center text-slate-400"><Landmark className="mx-auto mb-2 h-6 w-6" /> Chưa có ngân hàng.</td></tr>}
            {!loading && rows.map((b) => (
              <tr key={b.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(b.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={b.id} sel={sel} />}
                <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-500">{b.seqCode ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-xs font-semibold text-brand">{b.code}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{b.name}</td>
                <td className="px-4 py-3"><StatusBadge entity="BANK" code={b.status} /></td>
                <AuditTrailCells row={b} />
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: b })}><Pencil className="h-4 w-4" /></IconBtn>
                      <IconBtn title="Xóa" variant="danger" onClick={() => setDel(b)}><Trash2 className="h-4 w-4" /></IconBtn>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <BankForm mode={form.mode} row={form.row} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa ngân hàng" message={`Ngân hàng "${del.name}" (${del.code}) sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều ngân hàng" message={`${sel.count} ngân hàng đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function BankForm({ mode, row, onClose, onSaved }: { mode: 'create' | 'edit'; row?: BankDto; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const { options: bankStatusOptions } = useStatusOptions('BANK');
  const [name, setName] = useState(row?.name ?? '');
  const [code, setCode] = useState(row?.code ?? '');
  const [status, setStatus] = useState(row?.status ?? 'ACTIVE');
  const [busy, setBusy] = useState(false);
  async function save(): Promise<void> {
    if (!name.trim()) return toast.alert('Tên ngân hàng bắt buộc.', 'Thiếu thông tin');
    if (!code.trim()) return toast.alert('Mã ngân hàng bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const res = mode === 'edit' && row ? await window.api.bankUpdate(row.id, { name: name.trim(), code: code.trim(), status }) : await window.api.bankCreate({ name: name.trim(), code: code.trim(), status });
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật ngân hàng' : `Đã thêm ngân hàng ${code}`); onSaved(); }
    else toast.alert(res.message ?? 'Lưu ngân hàng thất bại', 'Không lưu được');
  }
  return (
    <Modal title={mode === 'edit' ? `Sửa ngân hàng ${row?.code}` : 'Thêm ngân hàng mới'} onClose={onClose} width="max-w-md" onSubmit={() => void save()}>
      <div className="grid gap-4">
        <Field label="Tên ngân hàng" required><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Ngân hàng TMCP Ngoại thương" /></Field>
        <Field label="Mã ngân hàng" required hint="Ví dụ: VCB, TCB (không trùng)"><input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="VCB" /></Field>
        <Field label="Trạng thái"><select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>{statusSelectOptions(bankStatusOptions, row?.status).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</select></Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm ngân hàng'}</Button>
      </div>
    </Modal>
  );
}

// ── C3 LOẠI THẺ ─────────────────────────────────────────────────────────────
function CardTypeTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<CardTypeDto[]>([]);
  const [banks, setBanks] = useState<{ id: number; code: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [bankId, setBankId] = useState('');
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: CardTypeDto } | null>(null);
  const [del, setDel] = useState<CardTypeDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.cardTypeList({ search: search || undefined, bankId: bankId ? Number(bankId) : undefined });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { window.api.bankLite().then((r) => r.ok && r.data && setBanks(r.data)); }, []);
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [bankId]);

  async function doDelete(c: CardTypeDto, password?: string): Promise<void> {
    const res = await window.api.cardTypeDelete([c.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa loại thẻ ${c.name}`);
    else toast.alert(res.message ?? 'Xóa loại thẻ thất bại', 'Xóa thất bại');
    setDel(null);
    await reload();
  }

  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.cardTypeDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} loại thẻ`);
    else toast.alert(res.message ?? 'Xóa loại thẻ thất bại', 'Xóa thất bại');
    setBulkDel(false);
    await reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} loại thẻ</div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('loai_the', ['Mã', 'Tên loại thẻ', 'Ngân hàng', 'Người tạo', 'Ngày tạo', 'Giờ tạo', 'Người sửa', 'Ngày sửa', 'Giờ sửa'], rows.map((r) => [r.code, r.name, r.bankName, r.createdByName ?? '', fmtDate(r.createdAt), fmtTime(r.createdAt), r.updatedByName ?? '', fmtDate(r.updatedAt), fmtTime(r.updatedAt)]))}>Xuất Excel</Button>
          {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>Thêm loại thẻ</Button>}
        </div>
      </div>
      <FilterBar search={search} onSearch={setSearch} searchPlaceholder="Tìm mã / tên loại thẻ…" selects={[{ key: 'bank', placeholder: 'Tất cả ngân hàng', value: bankId, options: banks.map((b) => ({ value: String(b.id), label: `${b.code} · ${b.name}` })), onChange: setBankId }]} onApply={reload} onReset={() => { setSearch(''); setBankId(''); setTimeout(reload, 0); }} />
      {canManage && <SelectionBar count={sel.count} entityLabel="loại thẻ" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Tên loại thẻ</th>
              <th className="px-4 py-3">Ngân hàng</th>
              <AuditTrailHeadCells />
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={(canManage ? 5 : 3) + AUDIT_TRAIL_COLS} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={(canManage ? 5 : 3) + AUDIT_TRAIL_COLS} className="px-4 py-10 text-center text-slate-400"><CreditCard className="mx-auto mb-2 h-6 w-6" /> Chưa có loại thẻ.</td></tr>}
            {!loading && rows.map((c) => (
              <tr key={c.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(c.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={c.id} sel={sel} />}
                <td className="px-4 py-3 font-mono text-xs font-semibold text-brand">{c.code}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                <td className="px-4 py-3 text-slate-600">{c.bankCode ? `${c.bankCode} · ${c.bankName}` : (c.bankName ?? '—')}</td>
                <AuditTrailCells row={c} />
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: c })}><Pencil className="h-4 w-4" /></IconBtn>
                      <IconBtn title="Xóa" variant="danger" onClick={() => setDel(c)}><Trash2 className="h-4 w-4" /></IconBtn>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <CardTypeForm mode={form.mode} row={form.row} banks={banks} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa loại thẻ" message={`Loại thẻ "${del.name}" sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều loại thẻ" message={`${sel.count} loại thẻ đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function CardTypeForm({ mode, row, banks, onClose, onSaved }: { mode: 'create' | 'edit'; row?: CardTypeDto; banks: { id: number; code: string; name: string }[]; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [bankId, setBankId] = useState(row?.bankId ? String(row.bankId) : '');
  const [name, setName] = useState(row?.name ?? '');
  const [code, setCode] = useState(row?.code ?? '');
  const [busy, setBusy] = useState(false);
  const noBank = banks.length === 0; // FIX 3 — chống dead-end khi chưa có ngân hàng
  async function save(): Promise<void> {
    if (noBank) return toast.alert('Chưa có ngân hàng — thêm ở tab \'Ngân hàng\' trước khi tạo loại thẻ.', 'Thiếu dữ liệu nền');
    if (!bankId) return toast.alert('Phải chọn ngân hàng.', 'Thiếu thông tin');
    if (!name.trim()) return toast.alert('Tên loại thẻ bắt buộc.', 'Thiếu thông tin');
    if (!code.trim()) return toast.alert('Mã loại thẻ bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const payload = { bankId: Number(bankId), name: name.trim(), code: code.trim() };
    const res = mode === 'edit' && row ? await window.api.cardTypeUpdate(row.id, payload) : await window.api.cardTypeCreate(payload);
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật loại thẻ' : `Đã thêm loại thẻ ${code}`); onSaved(); }
    else toast.alert(res.message ?? 'Lưu loại thẻ thất bại', 'Không lưu được');
  }
  return (
    <Modal title={mode === 'edit' ? `Sửa loại thẻ ${row?.code}` : 'Thêm loại thẻ mới'} onClose={onClose} width="max-w-md" onSubmit={() => void save()}>
      <div className="grid gap-4">
        <Field label="Ngân hàng" required><select className={inputCls} value={bankId} onChange={(e) => setBankId(e.target.value)} autoFocus disabled={noBank}><option value="">{noBank ? '— Chưa có ngân hàng: thêm ở tab Ngân hàng —' : '— Chọn ngân hàng —'}</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></Field>
        <Field label="Tên loại thẻ" required hint="Ví dụ: Visa nội địa, Napas"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Mã loại thẻ" required><input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="VISA" /></Field>
      </div>
      {noBank && <p className="mt-2 text-xs font-medium text-warning">Chưa có ngân hàng nào — vào tab <b>Ngân hàng</b> thêm ít nhất 1 ngân hàng trước khi tạo loại thẻ.</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy || noBank} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm loại thẻ'}</Button>
      </div>
    </Modal>
  );
}

// ── C4 ĐỐI TÁC + ma trận liên kết ngân hàng ─────────────────────────────────
function PartnerTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const { options: partnerStatusOptions } = useStatusOptions('PARTNER');
  const [rows, setRows] = useState<PartnerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: PartnerDto } | null>(null);
  const [del, setDel] = useState<PartnerDto | null>(null);
  const [matrix, setMatrix] = useState<PartnerBankMatrix | null>(null);
  const [linkOf, setLinkOf] = useState<PartnerDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.partnerList({ search: search || undefined, status: statusFilter || undefined });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    const m = await window.api.partnerBankMatrix();
    if (m.ok && m.data) setMatrix(m.data);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  async function doDelete(p: PartnerDto, password?: string): Promise<void> {
    const res = await window.api.partnerDelete([p.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa đối tác ${p.code}`);
    else toast.alert(res.message ?? 'Xóa đối tác thất bại', 'Xóa thất bại');
    setDel(null);
    await reload();
  }

  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.partnerDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} đối tác`);
    else toast.alert(res.message ?? 'Xóa đối tác thất bại', 'Xóa thất bại');
    setBulkDel(false);
    await reload();
  }

  const bankName = (id: number): string => matrix?.banks.find((b) => b.id === id)?.code ?? String(id);
  const partnerStatusLabel = (code: string): string => partnerStatusOptions.find((o) => o.code === code)?.label ?? code;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} đối tác</div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('doi_tac', ['Mã', 'Tên đối tác', 'Trạng thái', 'Người liên hệ', 'Số điện thoại', 'Địa chỉ', 'Ngân hàng liên kết', 'Người tạo', 'Ngày tạo', 'Giờ tạo', 'Người sửa', 'Ngày sửa', 'Giờ sửa'], rows.map((r) => [r.code, r.name, partnerStatusLabel(r.status), r.contactPerson, r.phone, r.address ?? '', r.bankIds.map(bankName).join(' | '), r.createdByName ?? '', fmtDate(r.createdAt), fmtTime(r.createdAt), r.updatedByName ?? '', fmtDate(r.updatedAt), fmtTime(r.updatedAt)]))}>Xuất Excel</Button>
          {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>Thêm đối tác</Button>}
        </div>
      </div>
      <StatBar
        items={[
          { label: 'Tổng đối tác', value: rows.length, tone: 'bg-brand-tint text-brand' },
          ...partnerStatusOptions.filter((o) => o.active).map((o) => ({ label: o.label, value: rows.filter((p) => p.status === o.code).length, tone: toneCls(o.tone) }))
        ]}
      />
      <FilterBar search={search} onSearch={setSearch} searchPlaceholder="Tìm mã / tên / Số điện thoại đối tác…" selects={[{ key: 'status', placeholder: 'Tất cả trạng thái', value: statusFilter, options: partnerStatusOptions.filter((o) => o.active).map((o) => ({ value: o.code, label: o.label })), onChange: setStatusFilter }]} onApply={reload} onReset={() => { setSearch(''); setStatusFilter(''); setTimeout(reload, 0); }} />
      {canManage && <SelectionBar count={sel.count} entityLabel="đối tác" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Tên đối tác</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Người liên hệ</th>
              <th className="px-4 py-3">Số điện thoại</th>
              <th className="px-4 py-3">Địa chỉ</th>
              <th className="px-4 py-3">Ngân hàng liên kết</th>
              <AuditTrailHeadCells />
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={(canManage ? 9 : 7) + AUDIT_TRAIL_COLS} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={(canManage ? 9 : 7) + AUDIT_TRAIL_COLS} className="px-4 py-10 text-center text-slate-400"><Building2 className="mx-auto mb-2 h-6 w-6" /> Chưa có đối tác.</td></tr>}
            {!loading && rows.map((p) => (
              <tr key={p.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(p.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={p.id} sel={sel} />}
                <td className="px-4 py-3 font-mono text-xs font-semibold text-brand">{p.code}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                <td className="px-4 py-3"><StatusBadge entity="PARTNER" code={p.status} /></td>
                <td className="px-4 py-3 text-slate-600">{p.contactPerson ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{p.phone ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{p.address ?? '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {p.bankIds.length === 0 ? <span className="text-slate-400">—</span> : p.bankIds.map((id) => <span key={id} className="rounded bg-brand-tint px-1.5 py-0.5 text-xs font-medium text-brand">{bankName(id)}</span>)}
                  </div>
                </td>
                <AuditTrailCells row={p} />
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <IconBtn title="Liên kết ngân hàng" onClick={() => setLinkOf(p)}><Link2 className="h-4 w-4" /></IconBtn>
                      <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: p })}><Pencil className="h-4 w-4" /></IconBtn>
                      <IconBtn title="Xóa" variant="danger" onClick={() => setDel(p)}><Trash2 className="h-4 w-4" /></IconBtn>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <PartnerForm mode={form.mode} row={form.row} banks={matrix?.banks ?? []} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa đối tác" message={`Đối tác "${del.name}" (${del.code}) sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều đối tác" message={`${sel.count} đối tác đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
      {linkOf && matrix && <LinkBanksModal partner={linkOf} banks={matrix.banks} onClose={() => setLinkOf(null)} onSaved={() => { setLinkOf(null); void reload(); }} />}
    </div>
  );
}

function PartnerForm({ mode, row, banks, onClose, onSaved }: { mode: 'create' | 'edit'; row?: PartnerDto; banks: { id: number; code: string; name: string }[]; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const { options: partnerStatusOptions } = useStatusOptions('PARTNER');
  const [name, setName] = useState(row?.name ?? '');
  const [code, setCode] = useState(row?.code ?? '');
  const [status, setStatus] = useState(row?.status ?? 'UNSIGNED');
  const [address, setAddress] = useState(row?.address ?? '');
  const [phone, setPhone] = useState(row?.phone ?? '');
  const [contactPerson, setContactPerson] = useState(row?.contactPerson ?? '');
  const [selectedBanks, setSelectedBanks] = useState<Set<number>>(new Set(row?.bankIds ?? []));
  const [busy, setBusy] = useState(false);
  function toggleBank(id: number): void { const s = new Set(selectedBanks); s.has(id) ? s.delete(id) : s.add(id); setSelectedBanks(s); }
  async function save(): Promise<void> {
    if (!name.trim()) return toast.alert('Tên đối tác bắt buộc.', 'Thiếu thông tin');
    if (!code.trim()) return toast.alert('Mã đối tác bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const payload = { name: name.trim(), code: code.trim(), status, address: address || null, phone: phone || null, contactPerson: contactPerson || null };
    const res = mode === 'edit' && row ? await window.api.partnerUpdate(row.id, payload) : await window.api.partnerCreate(payload);
    if (!res.ok) { setBusy(false); return toast.alert(res.message ?? 'Lưu đối tác thất bại', 'Không lưu được'); }
    // Cập nhật liên kết ngân hàng ngay sau khi lưu đối tác (dùng id trả về khi tạo mới).
    const pid = mode === 'edit' && row ? row.id : res.id;
    if (pid) {
      const link = await window.api.partnerBankSet(pid, [...selectedBanks]);
      if (!link.ok) toast.alert('Đối tác đã lưu nhưng cập nhật liên kết ngân hàng thất bại: ' + (link.message ?? 'lỗi không rõ'), 'Liên kết chưa lưu');
    }
    setBusy(false);
    toast.success(mode === 'edit' ? 'Đã cập nhật đối tác' : `Đã thêm đối tác ${code}`);
    onSaved();
  }
  return (
    <Modal title={mode === 'edit' ? `Sửa đối tác ${row?.code}` : 'Thêm đối tác mới'} onClose={onClose} width="max-w-xl" onSubmit={() => void save()}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tên đối tác" required><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Mã đối tác" required hint="Không trùng"><input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Field label="Trạng thái hợp đồng"><select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>{statusSelectOptions(partnerStatusOptions, row?.status).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</select></Field>
        <Field label="Người liên hệ"><input className={inputCls} value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} /></Field>
        <Field label="Số điện thoại"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Địa chỉ"><input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        {/* Ngân hàng liên kết — tích chọn ngay khi thêm/sửa đối tác (đồng bộ style với LinkBanksModal). */}
        <div className="col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Ngân hàng liên kết</label>
          {banks.length === 0 ? (
            <div className="text-sm text-slate-400">Chưa có ngân hàng — thêm ở tab Ngân hàng trước.</div>
          ) : (
            <div className="grid max-h-48 grid-cols-2 gap-2 overflow-auto">
              {banks.map((b) => (
                <label key={b.id} className={'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ' + (selectedBanks.has(b.id) ? 'border-brand bg-brand-tint text-brand' : 'border-line hover:bg-appbg')}>
                  <input type="checkbox" checked={selectedBanks.has(b.id)} onChange={() => toggleBank(b.id)} className="accent-brand" />
                  <span className="font-mono text-xs font-semibold">{b.code}</span>
                  <span className="truncate text-slate-600">{b.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm đối tác'}</Button>
      </div>
    </Modal>
  );
}

function LinkBanksModal({ partner, banks, onClose, onSaved }: { partner: PartnerDto; banks: { id: number; code: string; name: string }[]; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set(partner.bankIds));
  const [busy, setBusy] = useState(false);
  function toggle(id: number): void { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s); }
  async function save(): Promise<void> {
    setBusy(true);
    const res = await window.api.partnerBankSet(partner.id, [...selected]);
    setBusy(false);
    if (res.ok) { toast.success(`Đã cập nhật liên kết ngân hàng cho ${partner.code}`); onSaved(); }
    else toast.alert(res.message ?? 'Lưu liên kết thất bại', 'Không lưu được');
  }
  return (
    <Modal title={`Liên kết ngân hàng — ${partner.name}`} onClose={onClose} width="max-w-lg" onSubmit={() => void save()}>
      <p className="mb-3 text-sm text-slate-500">Tích chọn các ngân hàng mà đối tác này liên kết.</p>
      <div className="grid max-h-72 grid-cols-2 gap-2 overflow-auto">
        {banks.length === 0 && <div className="col-span-2 text-sm text-slate-400">Chưa có ngân hàng nào — thêm ở tab Ngân hàng trước.</div>}
        {banks.map((b) => (
          <label key={b.id} className={'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ' + (selected.has(b.id) ? 'border-brand bg-brand-tint text-brand' : 'border-line hover:bg-appbg')}>
            <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} className="accent-brand" />
            <span className="font-mono text-xs font-semibold">{b.code}</span>
            <span className="truncate text-slate-600">{b.name}</span>
          </label>
        ))}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Lưu liên kết</Button>
      </div>
    </Modal>
  );
}
