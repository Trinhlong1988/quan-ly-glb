// LOẠI GIAO MÁY (Mr.Long) — danh mục hình thức giao máy (Bán / Cho thuê / Cọc / Mượn) dùng chung
// cho luồng Giao khách (POS) và Gán TID kèm máy. Model sát FeeConfigPage's TypeTab (CRUD + xóa mật khẩu).
import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, HandCoins } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTime } from '@glb/shared';
import type { HandoverTypeDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { isStaleWrite, STALE_TITLE } from '../lib/optlock.js';
import { Modal } from '../components/Modal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Field, inputCls } from '../components/Field.js';
import { Button } from '../components/Button.js';
import { useRowSelection, SelectionBar, SelectAllCell, SelectCell } from '../components/Selection.js';
import { AuditTrailHeadCells, AuditTrailCells } from '../components/AuditCells.js';
import { toneCls } from '../components/StatusBadge.js';

// Hình thức tiền theo loại giao — nhãn + màu badge tiếng Việt (khớp R_UI màu sắc dùng chung).
export const MONEY_KIND_LABEL: Record<string, string> = { SALE: 'Bán', RENT: 'Cho thuê', DEPOSIT: 'Cọc', NONE: 'Mượn' };
const MONEY_KIND_TONE: Record<string, string> = { SALE: 'emerald', RENT: 'sky', DEPOSIT: 'amber', NONE: 'slate' };
const MONEY_KIND_OPTIONS = ['SALE', 'RENT', 'DEPOSIT', 'NONE'];

export function MoneyKindBadge({ code }: { code: string }): JSX.Element {
  return <span className={'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' + toneCls(MONEY_KIND_TONE[code])}>{MONEY_KIND_LABEL[code] ?? code}</span>;
}

function IconBtn({ children, title, variant, onClick }: { children: JSX.Element; title: string; variant?: 'edit' | 'danger'; onClick: () => void }): JSX.Element {
  const tone = variant === 'danger' ? 'text-danger hover:bg-danger/10' : variant === 'edit' ? 'text-warning hover:bg-warning/10' : 'text-slate-400 hover:bg-brand-tint hover:text-brand';
  return <button title={title} onClick={onClick} className={'rounded-md p-1.5 transition ' + tone}>{children}</button>;
}

export function HandoverConfigPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const canManage = hasPermission(user, 'CONFIG_HANDOVER_MANAGE');
  const [rows, setRows] = useState<HandoverTypeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: HandoverTypeDto } | null>(null);
  const [del, setDel] = useState<HandoverTypeDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.handoverTypeList();
    if (res.ok && res.data) setRows([...res.data].sort((a, b) => a.sortOrder - b.sortOrder));
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  async function doDelete(t: HandoverTypeDto, password?: string): Promise<void> {
    const res = await window.api.handoverTypeDelete([t.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa loại giao ${t.name}`);
    else toast.alert(res.message ?? 'Xóa loại giao thất bại', 'Xóa thất bại');
    setDel(null);
    await reload();
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.handoverTypeDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} loại giao`);
    else toast.alert(res.message ?? 'Xóa loại giao thất bại', 'Xóa thất bại');
    setBulkDel(false);
    await reload();
  }

  const selectableIds = rows.filter((r) => !r.isBuiltin).map((r) => r.id);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Loại giao</h2>
        <p className="text-sm text-slate-500">Hình thức giao máy khi triển khai POS / gán TID kèm máy: Bán · Cho thuê · Cọc · Mượn. Loại dựng sẵn khóa hình thức tiền, không xóa được.</p>
      </div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} loại giao</div>
        {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>Thêm loại giao</Button>}
      </div>
      {canManage && <SelectionBar count={sel.count} entityLabel="loại giao" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm list-scroll">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-20 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={selectableIds} sel={sel} />}
              <th className="px-4 py-3">Tên loại giao</th>
              <th className="px-4 py-3">Hình thức tiền</th>
              <th className="px-4 py-3 text-right">Thứ tự</th>
              <th className="px-4 py-3">Dựng sẵn</th>
              <AuditTrailHeadCells />
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canManage ? 12 : 10} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canManage ? 12 : 10} className="px-4 py-10 text-center text-slate-400"><HandCoins className="mx-auto mb-2 h-6 w-6" /> Chưa có loại giao.</td></tr>}
            {!loading && rows.map((t) => (
              <tr key={t.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(t.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && (t.isBuiltin ? <td className="px-4 py-3" /> : <SelectCell id={t.id} sel={sel} />)}
                <td className="px-4 py-3 font-medium text-slate-800">{t.name}</td>
                <td className="px-4 py-3"><MoneyKindBadge code={t.moneyKind} /></td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">{t.sortOrder}</td>
                <td className="px-4 py-3">{t.isBuiltin ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">Dựng sẵn</span> : <span className="text-slate-300">—</span>}</td>
                <AuditTrailCells row={t} />
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: t })}><Pencil className="h-4 w-4" /></IconBtn>
                      {!t.isBuiltin && <IconBtn title="Xóa" variant="danger" onClick={() => setDel(t)}><Trash2 className="h-4 w-4" /></IconBtn>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <HandoverTypeForm mode={form.mode} row={form.row} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa loại giao" message={`Loại giao "${del.name}" sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều loại giao" message={`${sel.count} loại giao đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function HandoverTypeForm({ mode, row, onClose, onSaved }: { mode: 'create' | 'edit'; row?: HandoverTypeDto; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [name, setName] = useState(row?.name ?? '');
  const [moneyKind, setMoneyKind] = useState(row?.moneyKind ?? 'NONE');
  const [sortOrder, setSortOrder] = useState(row?.sortOrder != null ? String(row.sortOrder) : '');
  const [busy, setBusy] = useState(false);
  const lockMoneyKind = mode === 'edit' && !!row?.isBuiltin;

  async function save(): Promise<void> {
    if (!name.trim()) return toast.alert('Tên loại giao bắt buộc.', 'Thiếu thông tin');
    if (!MONEY_KIND_OPTIONS.includes(moneyKind)) return toast.alert('Hình thức tiền không hợp lệ.', 'Thiếu thông tin');
    setBusy(true);
    const payload = { name: name.trim(), moneyKind, sortOrder: sortOrder.trim() === '' ? undefined : Number(sortOrder) };
    const res = mode === 'edit' && row
      ? await window.api.handoverTypeUpdate(row.id, { ...payload, expectedUpdatedAt: row.updatedAt })
      : await window.api.handoverTypeCreate(payload);
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật loại giao' : `Đã thêm loại giao ${name}`); onSaved(); }
    else if (isStaleWrite(res)) { toast.alert(res.message ?? 'Bản ghi đã được người khác cập nhật, vui lòng mở lại.', STALE_TITLE); onSaved(); }
    else toast.alert(res.message ?? 'Lưu loại giao thất bại', 'Không lưu được');
  }

  return (
    <Modal title={mode === 'edit' ? `Sửa loại giao ${row?.name}` : 'Thêm loại giao mới'} onClose={onClose} width="max-w-md" onSubmit={() => void save()}>
      <div className="grid gap-4">
        <Field label="Tên loại giao" required hint="Ví dụ: Bán, Cho thuê, Cọc, Mượn"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Hình thức tiền" required hint={lockMoneyKind ? 'Loại dựng sẵn — khóa hình thức tiền' : undefined}>
          <select className={inputCls} value={moneyKind} disabled={lockMoneyKind} onChange={(e) => setMoneyKind(e.target.value)}>
            {MONEY_KIND_OPTIONS.map((k) => <option key={k} value={k}>{MONEY_KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Thứ tự" hint="Số nhỏ hiện trước — mặc định = thứ tự chọn khi giao máy"><input className={inputCls} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" /></Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm loại giao'}</Button>
      </div>
    </Modal>
  );
}
