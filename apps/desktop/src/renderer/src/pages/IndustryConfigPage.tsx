import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, Tags, Download } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTime } from '@glb/shared';
import type { IndustryDto, CreateIndustryInput, UpdateIndustryInput } from '../../../preload/index.d';
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

function IconBtn({ children, title, variant, onClick }: { children: JSX.Element; title: string; variant?: 'edit' | 'danger'; onClick: () => void }): JSX.Element {
  const tone = variant === 'danger' ? 'text-danger hover:bg-danger/10' : variant === 'edit' ? 'text-warning hover:bg-warning/10' : 'text-slate-400 hover:bg-brand-tint hover:text-brand';
  return <button title={title} onClick={onClick} className={'rounded-md p-1.5 transition ' + tone}>{children}</button>;
}

/** Nhãn trạng thái sử dụng ngành nghề — dùng chung màu StatusPill (R_UI_STANDARD). */
function ActivePill({ active }: { active: boolean }): JSX.Element {
  const tone = active ? statusTone('ACTIVE') : statusTone('DISABLED');
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{active ? 'Đang dùng' : 'Ngừng dùng'}</span>;
}

export function IndustryConfigPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const canCreate = hasPermission(user, 'CONFIG_INDUSTRY_CREATE');
  const canUpdate = hasPermission(user, 'CONFIG_INDUSTRY_UPDATE');
  const canDelete = hasPermission(user, 'CONFIG_INDUSTRY_DELETE');
  const [rows, setRows] = useState<IndustryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fActive, setFActive] = useState('');
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: IndustryDto } | null>(null);
  const [del, setDel] = useState<IndustryDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.industryList({
      search: search || undefined,
      active: fActive === '' ? undefined : fActive === '1'
    });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [fActive]);

  async function doDelete(r: IndustryDto, password?: string): Promise<void> {
    const res = await window.api.industryDelete([r.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa ngành ${r.name}`);
    else toast.alert(res.message ?? 'Xóa thất bại', 'Xóa thất bại');
    setDel(null); await reload();
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.industryDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} ngành`);
    else toast.alert(res.message ?? 'Xóa thất bại', 'Xóa thất bại');
    setBulkDel(false); await reload();
  }

  const activeCount = rows.filter((r) => r.active).length;

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Cấu hình ngành nghề</h2>
        <p className="text-sm text-slate-500">Danh mục ngành nghề của HKD (vận tải, tạp hóa, cà phê, ăn uống…). Master data dùng cho cấu hình giá theo ngành (pha sau).</p>
      </div>

      <StatBar items={[
        { label: 'Tổng ngành', value: rows.length },
        { label: 'Đang dùng', value: activeCount, tone: statusTone('ACTIVE') },
        { label: 'Ngừng dùng', value: rows.length - activeCount, tone: statusTone('DISABLED') }
      ]} />

      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} ngành nghề</div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('nganh_nghe', ['Mã', 'Tên ngành', 'Trạng thái', 'Ghi chú', 'Người tạo', 'Ngày tạo', 'Giờ tạo', 'Người sửa', 'Ngày sửa', 'Giờ sửa'], rows.map((r) => [r.code, r.name, r.active ? 'Đang dùng' : 'Ngừng dùng', r.note ?? '', r.createdByName ?? '', fmtDate(r.createdAt), fmtTime(r.createdAt), r.updatedByName ?? '', fmtDate(r.updatedAt), fmtTime(r.updatedAt)]))}>Xuất Excel</Button>
          {canCreate && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>Thêm ngành nghề</Button>}
        </div>
      </div>

      <FilterBar search={search} onSearch={setSearch} searchPlaceholder="Tìm theo mã / tên ngành…"
        selects={[{ key: 'a', placeholder: 'Tất cả trạng thái', value: fActive, options: [{ value: '1', label: 'Đang dùng' }, { value: '0', label: 'Ngừng dùng' }], onChange: setFActive }]}
        onApply={reload} onReset={() => { setSearch(''); setFActive(''); setTimeout(reload, 0); }} />

      {canDelete && <SelectionBar count={sel.count} entityLabel="ngành nghề" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canDelete && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Tên ngành</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Ghi chú</th>
              <AuditTrailHeadCells />
              {(canUpdate || canDelete) && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={6 + AUDIT_TRAIL_COLS} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6 + AUDIT_TRAIL_COLS} className="px-4 py-10 text-center text-slate-400"><Tags className="mx-auto mb-2 h-6 w-6" /> Chưa có ngành nghề.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(r.id) ? 'bg-brand-tint/40' : '')}>
                {canDelete && <SelectCell id={r.id} sel={sel} />}
                <td className="px-4 py-3 font-mono text-xs font-medium text-slate-800">{r.code}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                <td className="px-4 py-3"><ActivePill active={r.active} /></td>
                <td className="px-4 py-3 text-slate-600">{r.note ?? '—'}</td>
                <AuditTrailCells row={r} />
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

      {form && <IndustryForm mode={form.mode} row={form.row} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa ngành nghề" message={`Ngành "${del.name}" sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều ngành nghề" message={`${sel.count} ngành đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function IndustryForm({ mode, row, onClose, onSaved }: { mode: 'create' | 'edit'; row?: IndustryDto; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [name, setName] = useState(row?.name ?? '');
  const [active, setActive] = useState(row?.active ?? true);
  const [note, setNote] = useState(row?.note ?? '');
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (!name.trim()) return toast.alert('Tên ngành nghề bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const res = mode === 'edit' && row
      ? await window.api.industryUpdate(row.id, { name: name.trim(), active, note: note.trim() || null } satisfies UpdateIndustryInput)
      : await window.api.industryCreate({ name: name.trim(), active, note: note.trim() || null } satisfies CreateIndustryInput);
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật ngành nghề' : `Đã thêm ngành ${name}`); onSaved(); }
    else toast.alert(res.message ?? 'Lưu thất bại', 'Không lưu được');
  }

  return (
    <Modal title={mode === 'edit' ? `Sửa ngành nghề ${row?.code}` : 'Thêm ngành nghề'} onClose={onClose} width="max-w-md">
      <Field label="Tên ngành nghề" required hint="Ví dụ: vận tải, tạp hóa, cà phê, ăn uống"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Trạng thái sử dụng">
        <select className={inputCls} value={active ? '1' : '0'} onChange={(e) => setActive(e.target.value === '1')}>
          <option value="1">Đang dùng</option>
          <option value="0">Ngừng dùng</option>
        </select>
      </Field>
      <Field label="Ghi chú"><textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm ngành nghề'}</Button>
      </div>
    </Modal>
  );
}
