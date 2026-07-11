// PHASE H1 — Thu–Chi: Trang cấu hình danh mục thu/chi (§A/§B). Khuôn IndustryConfigPage
// (StatBar + FilterBar + Button variants confirm=xanh + ConfirmDialog requirePassword + exportCsv).
// affectsPnl = cột "tính lợi nhuận"; danh mục nguồn nội bộ (công nợ/cọc/tạm ứng/chuyển quỹ) bị KHÓA
// affectsPnl=false (server chặn — I#12). Danh mục hệ thống (isSystem) không xóa được.
import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, Wallet, Download, Lock } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTime } from '@glb/shared';
import type { CashCategoryDto, CreateCashCategoryInput, UpdateCashCategoryInput } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';
import { Button } from '../components/Button.js';
import { StatBar } from '../components/StatBar.js';
import { statusTone } from '../components/StatusPill.js';
import { useRowSelection, SelectionBar, SelectAllCell, SelectCell } from '../components/Selection.js';
import { AuditTrailHeadCells, AuditTrailCells, AUDIT_TRAIL_COLS } from '../components/AuditCells.js';
import { exportCsv } from '../lib/exportCsv.js';

// Nguồn danh mục (sourceKind) → nhãn tiếng Việt + có bị khóa affectsPnl không (§2.1 I#12).
const SOURCE_OPTIONS: { value: string; label: string; pnlForbidden: boolean }[] = [
  { value: 'MANUAL', label: 'Thủ công (nhập tay)', pnlForbidden: false },
  { value: 'SALE_POS', label: 'Bán máy POS', pnlForbidden: false },
  { value: 'SALE_TID', label: 'Bán TID', pnlForbidden: false },
  { value: 'SALARY', label: 'Chi lương', pnlForbidden: false },
  { value: 'DEBT_CUSTOMER', label: 'Công nợ khách hàng', pnlForbidden: true },
  { value: 'DEBT_PARTNER', label: 'Công nợ đối tác', pnlForbidden: true },
  { value: 'DEPOSIT', label: 'Thu cọc máy', pnlForbidden: true },
  { value: 'DEPOSIT_REFUND', label: 'Hoàn cọc máy', pnlForbidden: true },
  { value: 'ADVANCE', label: 'Tạm ứng / hoàn ứng', pnlForbidden: true },
  { value: 'DEVICE_DEPOSIT', label: 'Cọc thiết bị', pnlForbidden: true },
  { value: 'FUND_TRANSFER', label: 'Chuyển quỹ nội bộ', pnlForbidden: true }
];
function sourceLabel(v: string): string {
  return SOURCE_OPTIONS.find((s) => s.value === v)?.label ?? v;
}
function isPnlForbidden(v: string): boolean {
  return SOURCE_OPTIONS.find((s) => s.value === v)?.pnlForbidden ?? false;
}

function IconBtn({ children, title, variant, onClick, disabled }: { children: JSX.Element; title: string; variant?: 'edit' | 'danger'; onClick: () => void; disabled?: boolean }): JSX.Element {
  const tone = variant === 'danger' ? 'text-danger hover:bg-danger/10' : variant === 'edit' ? 'text-warning hover:bg-warning/10' : 'text-slate-400 hover:bg-brand-tint hover:text-brand';
  return <button title={title} disabled={disabled} onClick={onClick} className={'rounded-md p-1.5 transition disabled:opacity-30 disabled:cursor-not-allowed ' + tone}>{children}</button>;
}

function KindPill({ kind }: { kind: string }): JSX.Element {
  const tone = kind === 'THU' ? statusTone('ACTIVE') : 'bg-warning/10 text-warning';
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{kind === 'THU' ? 'Thu' : 'Chi'}</span>;
}
function ActivePill({ active }: { active: boolean }): JSX.Element {
  const tone = active ? statusTone('ACTIVE') : statusTone('DISABLED');
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{active ? 'Đang dùng' : 'Ngừng dùng'}</span>;
}

export function CashCategoryConfigPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const canCreate = hasPermission(user, 'CASHCAT_CREATE');
  const canUpdate = hasPermission(user, 'CASHCAT_UPDATE');
  const canDelete = hasPermission(user, 'CASHCAT_DELETE');
  const [rows, setRows] = useState<CashCategoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fKind, setFKind] = useState('');
  const [fActive, setFActive] = useState('');
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: CashCategoryDto } | null>(null);
  const [del, setDel] = useState<CashCategoryDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.cashCategoryList({
      search: search || undefined,
      kind: fKind || undefined,
      active: fActive === '' ? undefined : fActive === '1'
    });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [fKind, fActive]);

  async function doDelete(r: CashCategoryDto, password?: string): Promise<void> {
    const res = await window.api.cashCategoryDelete([r.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa danh mục ${r.name}`);
    else toast.alert(res.message ?? 'Xóa thất bại', 'Xóa thất bại');
    setDel(null); await reload();
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.cashCategoryDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} danh mục`);
    else toast.alert(res.message ?? 'Xóa thất bại', 'Xóa thất bại');
    setBulkDel(false); await reload();
  }

  const thuCount = rows.filter((r) => r.kind === 'THU').length;
  const chiCount = rows.filter((r) => r.kind === 'CHI').length;
  const activeCount = rows.filter((r) => r.active).length;
  // Chỉ chọn được danh mục KHÔNG hệ thống để xóa hàng loạt.
  const deletableIds = rows.filter((r) => !r.isSystem).map((r) => r.id);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Cấu hình danh mục thu – chi</h2>
        <p className="text-sm text-slate-500">Danh mục khoản THU và CHI (công nợ, doanh thu bán máy, chi lương, chi phí vận hành…). Cột “Tính lợi nhuận” quyết định danh mục có vào công thức lợi nhuận accrual hay không.</p>
      </div>

      <StatBar items={[
        { label: 'Tổng danh mục', value: rows.length },
        { label: 'Khoản THU', value: thuCount, tone: statusTone('ACTIVE') },
        { label: 'Khoản CHI', value: chiCount, tone: 'bg-warning/10 text-warning' },
        { label: 'Đang dùng', value: activeCount },
        { label: 'Ngừng dùng', value: rows.length - activeCount, tone: statusTone('DISABLED') }
      ]} />

      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} danh mục</div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('danh_muc_thu_chi', ['Loại', 'Tên danh mục', 'Đơn vị', 'Nguồn', 'Tính lợi nhuận', 'Hệ thống', 'Trạng thái', 'Người tạo', 'Ngày tạo', 'Giờ tạo', 'Người sửa', 'Ngày sửa', 'Giờ sửa'], rows.map((r) => [r.kind === 'THU' ? 'Thu' : 'Chi', r.name, r.unit ?? '', sourceLabel(r.sourceKind), r.affectsPnl ? 'Có' : 'Không', r.isSystem ? 'Có' : 'Không', r.active ? 'Đang dùng' : 'Ngừng dùng', r.createdByName ?? '', fmtDate(r.createdAt), fmtTime(r.createdAt), r.updatedByName ?? '', fmtDate(r.updatedAt), fmtTime(r.updatedAt)]))}>Xuất Excel</Button>
          {canCreate && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>Thêm danh mục</Button>}
        </div>
      </div>

      <FilterBar search={search} onSearch={setSearch} searchPlaceholder="Tìm theo tên danh mục…"
        selects={[
          { key: 'k', placeholder: 'Tất cả loại', value: fKind, options: [{ value: 'THU', label: 'Khoản thu' }, { value: 'CHI', label: 'Khoản chi' }], onChange: setFKind },
          { key: 'a', placeholder: 'Tất cả trạng thái', value: fActive, options: [{ value: '1', label: 'Đang dùng' }, { value: '0', label: 'Ngừng dùng' }], onChange: setFActive }
        ]}
        onApply={reload} onReset={() => { setSearch(''); setFKind(''); setFActive(''); setTimeout(reload, 0); }} />

      {canDelete && <SelectionBar count={sel.count} entityLabel="danh mục" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canDelete && <SelectAllCell ids={deletableIds} sel={sel} />}
              <th className="px-4 py-3">Loại</th>
              <th className="px-4 py-3">Tên danh mục</th>
              <th className="px-4 py-3">Đơn vị</th>
              <th className="px-4 py-3">Nguồn</th>
              <th className="px-4 py-3">Tính lợi nhuận</th>
              <th className="px-4 py-3">Trạng thái</th>
              <AuditTrailHeadCells />
              {(canUpdate || canDelete) && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={8 + AUDIT_TRAIL_COLS} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8 + AUDIT_TRAIL_COLS} className="px-4 py-10 text-center text-slate-400"><Wallet className="mx-auto mb-2 h-6 w-6" /> Chưa có danh mục thu – chi.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(r.id) ? 'bg-brand-tint/40' : '')}>
                {canDelete && (r.isSystem ? <td className="w-10 px-4 py-3" /> : <SelectCell id={r.id} sel={sel} />)}
                <td className="px-4 py-3"><KindPill kind={r.kind} /></td>
                <td className="px-4 py-3 font-medium text-slate-800">
                  <span className="inline-flex items-center gap-1.5">{r.name}{r.isSystem && <Lock className="h-3 w-3 text-slate-400" aria-label="Danh mục hệ thống" />}</span>
                </td>
                <td className="px-4 py-3 text-slate-600">{r.unit ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{sourceLabel(r.sourceKind)}</td>
                <td className="px-4 py-3">{r.affectsPnl ? <span className="text-brand">Có</span> : <span className="text-slate-400">Không</span>}</td>
                <td className="px-4 py-3"><ActivePill active={r.active} /></td>
                <AuditTrailCells row={r} />
                {(canUpdate || canDelete) && (
                  <td className="px-4 py-3"><div className="flex justify-end gap-1">
                    {canUpdate && <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: r })}><Pencil className="h-4 w-4" /></IconBtn>}
                    {canDelete && <IconBtn title={r.isSystem ? 'Danh mục hệ thống không thể xóa' : 'Xóa'} variant="danger" disabled={r.isSystem} onClick={() => setDel(r)}><Trash2 className="h-4 w-4" /></IconBtn>}
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && <CashCategoryForm mode={form.mode} row={form.row} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa danh mục thu – chi" message={`Danh mục "${del.name}" sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều danh mục" message={`${sel.count} danh mục đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function CashCategoryForm({ mode, row, onClose, onSaved }: { mode: 'create' | 'edit'; row?: CashCategoryDto; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [kind, setKind] = useState<'THU' | 'CHI'>((row?.kind as 'THU' | 'CHI') ?? 'THU');
  const [name, setName] = useState(row?.name ?? '');
  const [unit, setUnit] = useState(row?.unit ?? 'đồng');
  const [sourceKind, setSourceKind] = useState(row?.sourceKind ?? 'MANUAL');
  const [affectsPnl, setAffectsPnl] = useState(row?.affectsPnl ?? true);
  const [active, setActive] = useState(row?.active ?? true);
  const [busy, setBusy] = useState(false);
  const isSystem = row?.isSystem ?? false;
  const pnlLocked = isPnlForbidden(sourceKind); // nguồn nội bộ → affectsPnl buộc = false

  // Khi đổi nguồn sang loại nội bộ, tự tắt affectsPnl (khớp bất biến server I#12).
  function changeSource(v: string): void {
    setSourceKind(v);
    if (isPnlForbidden(v)) setAffectsPnl(false);
  }

  async function save(): Promise<void> {
    if (!name.trim()) return toast.alert('Tên danh mục bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const effectivePnl = pnlLocked ? false : affectsPnl;
    const res = mode === 'edit' && row
      ? await window.api.cashCategoryUpdate(row.id, { name: name.trim(), unit: unit.trim() || null, sourceKind, affectsPnl: effectivePnl, active } satisfies UpdateCashCategoryInput)
      : await window.api.cashCategoryCreate({ kind, name: name.trim(), unit: unit.trim() || null, sourceKind, affectsPnl: effectivePnl, active } satisfies CreateCashCategoryInput);
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật danh mục' : `Đã thêm danh mục ${name}`); onSaved(); }
    else toast.alert(res.message ?? 'Lưu thất bại', 'Không lưu được');
  }

  return (
    <Modal title={mode === 'edit' ? `Sửa danh mục ${row?.kind === 'THU' ? 'thu' : 'chi'}` : 'Thêm danh mục thu – chi'} onClose={onClose} width="max-w-md">
      <Field label="Loại danh mục" required>
        <select className={inputCls} value={kind} disabled={mode === 'edit'} onChange={(e) => setKind(e.target.value as 'THU' | 'CHI')}>
          <option value="THU">Khoản thu</option>
          <option value="CHI">Khoản chi</option>
        </select>
      </Field>
      <Field label="Tên danh mục" required hint="Ví dụ: Doanh thu bán máy POS, Chi phí vận hành…"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Đơn vị tính" hint="đồng, máy, tháng…"><input className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
      <Field label="Nguồn danh mục" hint={isSystem ? 'Danh mục hệ thống — không đổi được nguồn.' : undefined}>
        <select className={inputCls} value={sourceKind} disabled={isSystem} onChange={(e) => changeSource(e.target.value)}>
          {SOURCE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Field>
      <Field label="Tính vào lợi nhuận" hint={pnlLocked ? 'Nguồn nội bộ (công nợ/cọc/tạm ứng/chuyển quỹ) không được tính vào lợi nhuận.' : 'Danh mục doanh thu/chi phí thật → tính vào lợi nhuận accrual.'}>
        <select className={inputCls} value={pnlLocked ? '0' : affectsPnl ? '1' : '0'} disabled={pnlLocked} onChange={(e) => setAffectsPnl(e.target.value === '1')}>
          <option value="1">Có tính lợi nhuận</option>
          <option value="0">Không tính lợi nhuận</option>
        </select>
      </Field>
      <Field label="Trạng thái sử dụng">
        <select className={inputCls} value={active ? '1' : '0'} onChange={(e) => setActive(e.target.value === '1')}>
          <option value="1">Đang dùng</option>
          <option value="0">Ngừng dùng</option>
        </select>
      </Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm danh mục'}</Button>
      </div>
    </Modal>
  );
}
