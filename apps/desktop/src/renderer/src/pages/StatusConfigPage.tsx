// Cấu hình trạng thái tùy biến dùng chung (R14). Chọn thực thể → xem/thêm/sửa/xóa trạng thái.
// Builtin (mặc định): khóa xóa/đổi mã, chỉ đổi nhãn·màu·thứ tự·ẩn-hiện. Thực thể state-machine (allowAdd=false)
// KHÔNG hiện nút Thêm. Mọi thay đổi làm mới cache badge dùng chung (loadStatusOptions force).
import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, Tag, Lock } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission } from '@glb/shared';
import type { StatusOptionDto, StatusEntityDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { isStaleWrite, STALE_TITLE } from '../lib/optlock.js';
import { Modal } from '../components/Modal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Field, inputCls } from '../components/Field.js';
import { Button } from '../components/Button.js';
import { STATUS_TONE_CLS, toneCls, loadStatusOptions } from '../components/StatusBadge.js';

const TONE_KEYS = Object.keys(STATUS_TONE_CLS);

export function StatusConfigPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const canManage = hasPermission(user, 'SYSTEM_SETTING_UPDATE');
  const [entities, setEntities] = useState<StatusEntityDto[]>([]);
  const [entity, setEntity] = useState('');
  const [rows, setRows] = useState<StatusOptionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: StatusOptionDto } | null>(null);
  const [del, setDel] = useState<StatusOptionDto | null>(null);

  const cur = entities.find((e) => e.entity === entity);

  useEffect(() => {
    window.api.statusOptionEntities().then((r) => {
      if (r.ok && r.data) {
        setEntities(r.data);
        if (r.data.length) setEntity((prev) => prev || r.data![0].entity);
      }
    });
  }, []);

  async function reload(): Promise<void> {
    if (!entity) return;
    setLoading(true);
    const res = await window.api.statusOptionList(entity, true);
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    await loadStatusOptions(entity, true); // đồng bộ cache badge dùng chung
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  async function doDelete(o: StatusOptionDto): Promise<void> {
    const res = await window.api.statusOptionDelete(o.id);
    if (res.ok) toast.success(`Đã xóa trạng thái "${o.label}"`);
    else toast.alert(res.message ?? 'Xóa trạng thái thất bại', 'Không xóa được');
    setDel(null);
    await reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500">
            Danh mục trạng thái theo thực thể. Trạng thái <b>mặc định</b> khóa xóa (chỉ đổi nhãn·màu·thứ tự·ẩn-hiện).
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select className={inputCls + ' w-auto'} value={entity} onChange={(e) => setEntity(e.target.value)}>
            {entities.map((e) => (
              <option key={e.entity} value={e.entity}>
                {e.label}
              </option>
            ))}
          </select>
          {canManage && cur?.allowAdd && (
            <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>
              Thêm trạng thái
            </Button>
          )}
        </div>
      </div>

      {canManage && cur && !cur.allowAdd && (
        <p className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500">
          Nhóm trạng thái này <b>cố định</b> (state-machine) — không thêm được trạng thái mới; chỉ đổi nhãn·màu·thứ tự.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm list-scroll">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Thứ tự</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Loại</th>
              <th className="px-4 py-3">Hiển thị</th>
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="px-4 py-10 text-center text-slate-400">
                  <Tag className="mx-auto mb-2 h-6 w-6" /> Chưa có trạng thái.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((o) => (
                <tr key={o.id} className="hover:bg-appbg/60">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{o.sortOrder}</td>
                  <td className="px-4 py-3">
                    <span className={'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' + toneCls(o.tone)}>{o.label}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-slate-500">{o.code}</td>
                  <td className="px-4 py-3">
                    {o.isBuiltin ? (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <Lock className="h-3 w-3" /> Mặc định
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Tùy chỉnh</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{o.active ? <span className="text-emerald-600">Hiện</span> : <span className="text-slate-400">Ẩn</span>}</td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: o })}>
                          <Pencil className="h-4 w-4" />
                        </IconBtn>
                        {!o.isBuiltin && (
                          <IconBtn title="Xóa" variant="danger" onClick={() => setDel(o)}>
                            <Trash2 className="h-4 w-4" />
                          </IconBtn>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {form && (
        <StatusForm
          mode={form.mode}
          entity={entity}
          row={form.row}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            void reload();
          }}
        />
      )}
      {del && (
        <ConfirmDialog
          title="Xóa trạng thái"
          message={`Trạng thái "${del.label}" sẽ bị xóa. Nếu đang được bản ghi nào dùng, hệ thống sẽ chặn (chỉ có thể ẩn).`}
          confirmLabel="Xóa"
          danger
          onCancel={() => setDel(null)}
          onConfirm={() => doDelete(del)}
        />
      )}
    </div>
  );
}

function IconBtn({ children, title, variant, onClick }: { children: JSX.Element; title: string; variant?: 'edit' | 'danger'; onClick: () => void }): JSX.Element {
  const tone = variant === 'danger' ? 'text-danger hover:bg-danger/10' : variant === 'edit' ? 'text-warning hover:bg-warning/10' : 'text-slate-400 hover:bg-brand-tint hover:text-brand';
  return (
    <button title={title} onClick={onClick} className={'rounded-md p-1.5 transition ' + tone}>
      {children}
    </button>
  );
}

function StatusForm({ mode, entity, row, onClose, onSaved }: { mode: 'create' | 'edit'; entity: string; row?: StatusOptionDto; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [label, setLabel] = useState(row?.label ?? '');
  const [tone, setTone] = useState(row?.tone ?? 'slate');
  const [sortOrder, setSortOrder] = useState(row?.sortOrder ?? 0);
  const [active, setActive] = useState(row?.active ?? true);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (!label.trim()) return toast.alert('Tên trạng thái bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const res =
      mode === 'edit' && row
        ? await window.api.statusOptionUpdate(row.id, { label: label.trim(), tone, sortOrder, active, expectedUpdatedAt: row.updatedAt })
        : await window.api.statusOptionCreate({ entity, label: label.trim(), tone });
    setBusy(false);
    if (res.ok) {
      toast.success(mode === 'edit' ? 'Đã cập nhật trạng thái' : `Đã thêm trạng thái "${label.trim()}"`);
      onSaved();
    } else if (isStaleWrite(res)) {
      toast.alert(res.message ?? 'Bản ghi đã được người khác cập nhật, vui lòng mở lại.', STALE_TITLE);
      onSaved();
    } else toast.alert(res.message ?? 'Lưu trạng thái thất bại', 'Không lưu được');
  }

  return (
    <Modal title={mode === 'edit' ? `Sửa trạng thái` : 'Thêm trạng thái mới'} onClose={onClose} width="max-w-md" onSubmit={() => void save()}>
      <div className="grid gap-4">
        <Field label="Tên trạng thái" required hint='Ví dụ: "Tạm ngưng hợp tác"'>
          <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </Field>
        <Field label="Màu hiển thị">
          <div className="flex items-center gap-3">
            <select className={inputCls + ' w-auto'} value={tone} onChange={(e) => setTone(e.target.value)}>
              {TONE_KEYS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className={'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' + toneCls(tone)}>{label.trim() || 'Xem trước'}</span>
          </div>
        </Field>
        {mode === 'edit' && (
          <>
            <Field label="Thứ tự sắp xếp" hint="Số nhỏ hiện trước">
              <input type="number" className={inputCls} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
            </Field>
            <Field label="Hiển thị trong danh sách chọn">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-brand" />
                {active ? 'Hiện' : 'Ẩn (không cho chọn mới, badge cũ vẫn hiển thị)'}
              </label>
            </Field>
          </>
        )}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>
          Hủy
        </Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>
          {mode === 'edit' ? 'Lưu thay đổi' : 'Thêm trạng thái'}
        </Button>
      </div>
    </Modal>
  );
}
