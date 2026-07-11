// PHASE H2-core — Thu–Chi: Trang Quỹ (§J). Danh sách quỹ + người giữ + số dư running (I#1) +
// StatBar (tổng quỹ · tổng số dư · active/inactive) + form tạo/sửa. Khuôn IndustryConfigPage
// (StatBar + FilterBar + Button confirm=xanh + ConfirmDialog requirePassword + exportCsv).
import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, Wallet, Download, Landmark, Smartphone, Banknote } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate } from '@glb/shared';
import type { FundDto, CashflowUserLite, CreateFundInput, UpdateFundInput } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';
import { Button } from '../components/Button.js';
import { StatBar } from '../components/StatBar.js';
import { statusTone } from '../components/StatusPill.js';
import { useRowSelection, SelectionBar, SelectAllCell, SelectCell } from '../components/Selection.js';
import { exportCsv } from '../lib/exportCsv.js';

/** VND, nhóm 3 số bằng dấu chấm (KHÔNG toLocaleString — R_UI QA gate). Giữ dấu âm. */
function money(n: number): string {
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '−' : '') + s + 'đ';
}

const FUND_TYPES: { value: string; label: string; icon: JSX.Element }[] = [
  { value: 'CASH', label: 'Tiền mặt', icon: <Banknote className="h-4 w-4" /> },
  { value: 'BANK', label: 'Ngân hàng', icon: <Landmark className="h-4 w-4" /> },
  { value: 'EWALLET', label: 'Ví điện tử', icon: <Smartphone className="h-4 w-4" /> }
];
function typeLabel(v: string): string {
  return FUND_TYPES.find((t) => t.value === v)?.label ?? v;
}

function IconBtn({ children, title, variant, onClick }: { children: JSX.Element; title: string; variant?: 'edit' | 'danger'; onClick: () => void }): JSX.Element {
  const tone = variant === 'danger' ? 'text-danger hover:bg-danger/10' : variant === 'edit' ? 'text-warning hover:bg-warning/10' : 'text-slate-400 hover:bg-brand-tint hover:text-brand';
  return <button title={title} onClick={onClick} className={'rounded-md p-1.5 transition ' + tone}>{children}</button>;
}
function ActivePill({ active }: { active: boolean }): JSX.Element {
  const tone = active ? statusTone('ACTIVE') : statusTone('DISABLED');
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{active ? 'Đang dùng' : 'Ngừng dùng'}</span>;
}

export function FundPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const canCreate = hasPermission(user, 'FUND_CREATE');
  const canUpdate = hasPermission(user, 'FUND_UPDATE');
  const canDelete = hasPermission(user, 'FUND_DELETE');
  const [rows, setRows] = useState<FundDto[]>([]);
  const [users, setUsers] = useState<CashflowUserLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fType, setFType] = useState('');
  const [fActive, setFActive] = useState('');
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: FundDto } | null>(null);
  const [del, setDel] = useState<FundDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.fundList({ search: search || undefined, type: fType || undefined, active: fActive === '' ? undefined : fActive === '1' });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => {
    window.api.fundUserLite().then((r) => { if (r.ok && r.data) setUsers(r.data); });
  }, []);
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [fType, fActive]);

  async function doDelete(r: FundDto, password?: string): Promise<void> {
    const res = await window.api.fundDelete([r.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa quỹ ${r.name}`);
    else toast.alert(res.message ?? 'Xóa thất bại', 'Xóa thất bại');
    setDel(null); await reload();
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.fundDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} quỹ`);
    else toast.alert(res.message ?? 'Xóa thất bại', 'Xóa thất bại');
    setBulkDel(false); await reload();
  }

  const totalBalance = rows.reduce((s, r) => s + r.currentBalance, 0);
  const activeCount = rows.filter((r) => r.active).length;

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Quản Lý Quỹ</h2>
        <p className="text-sm text-slate-500">Quỹ tiền mặt / ngân hàng / ví điện tử. Số dư được tính realtime từ phiếu thu – chi đã ghi (không lưu số dư cứng).</p>
      </div>

      <StatBar items={[
        { label: 'Tổng số quỹ', value: rows.length, icon: <Wallet className="h-4 w-4" /> },
        { label: 'Tổng số dư', value: money(totalBalance), icon: <Banknote className="h-4 w-4" />, tone: statusTone('ACTIVE') },
        { label: 'Đang dùng', value: activeCount },
        { label: 'Ngừng dùng', value: rows.length - activeCount, tone: statusTone('DISABLED') }
      ]} />

      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} quỹ</div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('quy', ['Mã', 'Tên quỹ', 'Loại', 'Người giữ', 'Số dư đầu kỳ', 'Số dư hiện tại', 'Trạng thái', 'Ngày tạo'], rows.map((r) => [r.code, r.name, typeLabel(r.type), r.keeperUserName ?? '', String(r.openingBalance), String(r.currentBalance), r.active ? 'Đang dùng' : 'Ngừng dùng', fmtDate(r.createdAt)]))}>Xuất Excel</Button>
          {canCreate && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>Thêm quỹ</Button>}
        </div>
      </div>

      <FilterBar search={search} onSearch={setSearch} searchPlaceholder="Tìm theo mã / tên quỹ…"
        selects={[
          { key: 't', placeholder: 'Tất cả loại', value: fType, options: FUND_TYPES.map((t) => ({ value: t.value, label: t.label })), onChange: setFType },
          { key: 'a', placeholder: 'Tất cả trạng thái', value: fActive, options: [{ value: '1', label: 'Đang dùng' }, { value: '0', label: 'Ngừng dùng' }], onChange: setFActive }
        ]}
        onApply={reload} onReset={() => { setSearch(''); setFType(''); setFActive(''); setTimeout(reload, 0); }} />

      {canDelete && <SelectionBar count={sel.count} entityLabel="quỹ" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canDelete && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Tên quỹ</th>
              <th className="px-4 py-3">Loại</th>
              <th className="px-4 py-3">Người giữ</th>
              <th className="px-4 py-3 text-right">Số dư đầu kỳ</th>
              <th className="px-4 py-3 text-right">Số dư hiện tại</th>
              <th className="px-4 py-3">Trạng thái</th>
              {(canUpdate || canDelete) && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400"><Wallet className="mx-auto mb-2 h-6 w-6" /> Chưa có quỹ nào.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(r.id) ? 'bg-brand-tint/40' : '')}>
                {canDelete && <SelectCell id={r.id} sel={sel} />}
                <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{r.code}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                <td className="px-4 py-3 text-slate-600">{typeLabel(r.type)}</td>
                <td className="px-4 py-3 text-slate-600">{r.keeperUserName ?? '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-500 whitespace-nowrap">{money(r.openingBalance)}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800 whitespace-nowrap">{money(r.currentBalance)}</td>
                <td className="px-4 py-3"><ActivePill active={r.active} /></td>
                {(canUpdate || canDelete) && (
                  <td className="px-4 py-3"><div className="flex justify-end gap-1">
                    {canUpdate && <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: r })}><Pencil className="h-4 w-4" /></IconBtn>}
                    {canDelete && <IconBtn title="Xóa" variant="danger" onClick={() => setDel(r)}><Trash2 className="h-4 w-4" /></IconBtn>}
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && <FundForm mode={form.mode} row={form.row} users={users} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa quỹ" message={`Quỹ "${del.name}" sẽ vào Thùng rác. Quỹ đã có phiếu thu/chi sẽ không xóa được (chỉ ngừng dùng). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều quỹ" message={`${sel.count} quỹ đã chọn sẽ vào Thùng rác. Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} quỹ`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function FundForm({ mode, row, users, onClose, onSaved }: { mode: 'create' | 'edit'; row?: FundDto; users: CashflowUserLite[]; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [name, setName] = useState(row?.name ?? '');
  const [type, setType] = useState(row?.type ?? 'CASH');
  const [keeperUserId, setKeeperUserId] = useState<string>(row?.keeperUserId != null ? String(row.keeperUserId) : '');
  const [opening, setOpening] = useState<string>(row ? String(row.openingBalance) : '0');
  const [active, setActive] = useState(row?.active ?? true);
  const [note, setNote] = useState(row?.note ?? '');
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (!name.trim()) return toast.alert('Tên quỹ bắt buộc.', 'Thiếu thông tin');
    const openingNum = Number(opening);
    if (!Number.isInteger(openingNum) || openingNum < 0) return toast.alert('Số dư đầu kỳ phải là số nguyên ≥ 0 (VND).', 'Số dư không hợp lệ');
    setBusy(true);
    const base = { name: name.trim(), type, keeperUserId: keeperUserId ? Number(keeperUserId) : null, openingBalance: openingNum, active, note: note.trim() || null };
    const res = mode === 'edit' && row
      ? await window.api.fundUpdate(row.id, base satisfies UpdateFundInput)
      : await window.api.fundCreate(base satisfies CreateFundInput);
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật quỹ' : `Đã thêm quỹ ${name}`); onSaved(); }
    else toast.alert(res.message ?? 'Lưu thất bại', 'Không lưu được');
  }

  return (
    <Modal title={mode === 'edit' ? `Sửa quỹ ${row?.code ?? ''}` : 'Thêm quỹ'} onClose={onClose} width="max-w-md" onSubmit={() => void save()}>
      <Field label="Tên quỹ" required hint="Ví dụ: Quỹ tiền mặt VP, TK VCB 199…"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Loại quỹ" required>
        <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
          {FUND_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      <Field label="Người giữ quỹ" hint="Chọn từ danh sách nhân sự (tùy chọn).">
        <select className={inputCls} value={keeperUserId} onChange={(e) => setKeeperUserId(e.target.value)}>
          <option value="">— Không chỉ định —</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.code ? `${u.code} · ` : ''}{u.name}</option>)}
        </select>
      </Field>
      <Field label="Số dư đầu kỳ (VND)" hint="Số nguyên đồng, không nhân 1000."><input className={inputCls} type="number" min={0} step={1} value={opening} onChange={(e) => setOpening(e.target.value)} /></Field>
      <Field label="Ghi chú"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Field label="Trạng thái sử dụng">
        <select className={inputCls} value={active ? '1' : '0'} onChange={(e) => setActive(e.target.value === '1')}>
          <option value="1">Đang dùng</option>
          <option value="0">Ngừng dùng</option>
        </select>
      </Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm quỹ'}</Button>
      </div>
    </Modal>
  );
}
