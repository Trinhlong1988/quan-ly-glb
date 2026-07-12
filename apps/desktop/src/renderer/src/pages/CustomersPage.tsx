import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, UserRound, Download } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission } from '@glb/shared';
import type { CustomerDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { isStaleWrite, STALE_TITLE } from '../lib/optlock.js';
import { Modal } from '../components/Modal.js';
import { RequestCancelModal, type RequestCancelTarget } from '../components/RequestCancelModal.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';
import { StatBar } from '../components/StatBar.js';
import { Button } from '../components/Button.js';
import { StaleBanner } from '../lib/realtime.js';
import { ImportButton } from '../components/ImportModal.js';
import { StatusBadge, useStatusOptions, statusSelectOptions, toneCls } from '../components/StatusBadge.js';
import { exportCsv } from '../lib/exportCsv.js';

// Bộ đếm TOÀN CỤC (độc lập bộ lọc list) cho dash StatBar — khớp shape countCustomers ở main.
type CustomerCounts = { total: number; active: number; locked: number; cancelled: number };

/** Khách hàng (§D): hiển thị `KH## · biệt danh (tên thật)` + Số điện thoại. Mã tự sinh, nickname bắt buộc. */
export function CustomersPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const { options: statusOptions } = useStatusOptions('CUSTOMER');
  const [rows, setRows] = useState<CustomerDto[]>([]);
  const [counts, setCounts] = useState<CustomerCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CustomerDto | null>(null);
  const [cancelTarget, setCancelTarget] = useState<RequestCancelTarget | null>(null);

  const canCreate = hasPermission(user, 'CUSTOMER_CREATE');
  const canUpdate = hasPermission(user, 'CUSTOMER_UPDATE');
  const canCancelReq = hasPermission(user, 'CUSTOMER_CANCEL_REQUEST');

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.customerList({
      search: search || undefined,
      status: statusFilter || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined
    });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    // Bộ đếm TOÀN CỤC — nạp độc lập bộ lọc để "Đã khóa"/"Đã hủy"/đại lý luôn đúng số.
    const cres = await window.api.customerCounts();
    if (cres.ok && cres.data) setCounts(cres.data);
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    void window.api.customerCounts().then((r) => r.ok && r.data && setCounts(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetFilters(): void {
    setSearch('');
    setStatusFilter('');
    setFromDate('');
    setToDate('');
    setTimeout(reload, 0);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Quản Lý Khách Hàng</h2>
          <p className="text-sm text-slate-500">Mã khách hàng tự sinh · biệt danh dễ gọi · tên thật · Số điện thoại.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('khach_hang', ['Mã khách hàng', 'Biệt danh', 'Tên thật', 'Số điện thoại', 'Địa chỉ'], rows.map((c) => [c.code, c.nickname, c.fullName, c.phone ?? '', c.address ?? '']))}>
            Xuất Excel
          </Button>
          {canCreate && <ImportButton entityKey="customer" label="Khách hàng" onImported={reload} />}
          {canCreate && (
            <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Thêm khách hàng
            </Button>
          )}
        </div>
      </div>

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Tìm mã khách hàng, biệt danh, tên thật, Số điện thoại…"
        fromDate={fromDate}
        toDate={toDate}
        onFromDate={setFromDate}
        onToDate={setToDate}
        selects={[
          {
            key: 'status',
            placeholder: 'Tất cả trạng thái',
            value: statusFilter,
            options: statusOptions.filter((o) => o.active).map((o) => ({ value: o.code, label: o.label })),
            onChange: setStatusFilter
          }
        ]}
        onApply={reload}
        onReset={resetFilters}
      />

      {/* Dash bộ đếm TOÀN CỤC (countCustomers ở main, độc lập bộ lọc): tổng + trạng thái (hoạt động/khóa/hủy).
          "Đã khóa"/"Đã hủy" LUÔN hiện (kể cả =0) — Mr.Long yêu cầu không được ẩn. */}
      <StatBar
        items={[
          { label: 'Tổng khách', value: counts?.total ?? rows.length, tone: 'bg-brand-tint text-brand' },
          ...statusOptions
            .filter((o) => o.active)
            .map((o) => {
              // Đếm TOÀN CỤC cho 3 builtin từ counts; trạng thái tùy chỉnh mới → đếm client theo rows.
              const value =
                o.code === 'ACTIVE'
                  ? counts?.active ?? 0
                  : o.code === 'LOCKED'
                    ? counts?.locked ?? 0
                    : o.code === 'CANCELLED'
                      ? counts?.cancelled ?? 0
                      : rows.filter((c) => c.status === o.code).length;
              return { label: o.label, value, tone: toneCls(o.tone) };
            })
        ]}
      />

      <StaleBanner domain="Customer" onReload={reload} className="mb-2" />
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Mã khách hàng</th>
              <th className="px-4 py-3">Khách hàng</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Số điện thoại</th>
              <th className="px-4 py-3">Địa chỉ</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  <UserRound className="mx-auto mb-2 h-6 w-6" />
                  Chưa có khách hàng.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((c) => (
                <tr key={c.id} className="hover:bg-appbg/60">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-brand whitespace-nowrap">{c.code}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{c.nickname}</div>
                    <div className="text-xs text-slate-400">{c.fullName}</div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge entity="CUSTOMER" code={c.status} /></td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{c.address ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {canUpdate && (
                        <IconBtn title="Sửa" variant="edit" onClick={() => setEditing(c)}>
                          <Pencil className="h-4 w-4" />
                        </IconBtn>
                      )}
                      {canCancelReq && (
                        <IconBtn
                          title="Yêu cầu hủy"
                          variant="danger"
                          onClick={() =>
                            setCancelTarget({
                              entityType: 'Customer',
                              entityId: c.id,
                              entityLabel: `${c.code} · ${c.fullName}`,
                              typeLabel: 'khách hàng'
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconBtn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <CustomerForm
          target={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await reload();
          }}
        />
      )}

      {cancelTarget && (
        <RequestCancelModal
          target={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={() => {
            setCancelTarget(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

// Nút icon theo quy ước màu (R_BUTTON_SEMANTICS): sửa=vàng, xóa=đỏ.
function IconBtn({ children, title, variant, onClick }: { children: JSX.Element; title: string; variant?: 'edit' | 'danger'; onClick: () => void }): JSX.Element {
  const tone =
    variant === 'danger'
      ? 'text-danger hover:bg-danger/10'
      : variant === 'edit'
        ? 'text-warning hover:bg-warning/10'
        : 'text-slate-400 hover:bg-brand-tint hover:text-brand';
  return (
    <button title={title} onClick={onClick} className={'rounded-md p-1.5 transition ' + tone}>
      {children}
    </button>
  );
}

function CustomerForm({ target, onClose, onSaved }: { target: CustomerDto | null; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const { options: statusOptions } = useStatusOptions('CUSTOMER');
  const editing = !!target;
  const [fullName, setFullName] = useState(target?.fullName ?? '');
  const [nickname, setNickname] = useState(target?.nickname ?? '');
  const [phone, setPhone] = useState(target?.phone ?? '');
  const [email, setEmail] = useState(target?.email ?? '');
  const [address, setAddress] = useState(target?.address ?? '');
  const [note, setNote] = useState(target?.note ?? '');
  const [status, setStatus] = useState(target?.status ?? 'ACTIVE');
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (!fullName.trim()) return toast.alert('Tên thật khách hàng bắt buộc.', 'Thiếu thông tin');
    if (!nickname.trim()) return toast.alert('Biệt danh (tên dễ gọi) là bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const payload = {
      fullName: fullName.trim(),
      nickname: nickname.trim(),
      phone: phone || null,
      email: email || null,
      address: address || null,
      note: note || null,
      status,
      expectedUpdatedAt: target?.updatedAt // R48 #2 optimistic-lock: mốc lúc mở form (undefined khi Thêm mới → bỏ qua)
    };
    const res = editing ? await window.api.customerUpdate(target!.id, payload) : await window.api.customerCreate(payload);
    setBusy(false);
    if (res.ok) {
      toast.success(editing ? `Đã cập nhật ${nickname}` : `Đã tạo khách hàng ${nickname}`);
      onSaved();
    } else if (isStaleWrite(res)) {
      // R48 #2 — người khác vừa sửa bản ghi này → báo + đóng form, tải lại để lấy bản mới nhất.
      toast.alert(res.message ?? 'Bản ghi đã được người khác cập nhật, vui lòng mở lại.', STALE_TITLE);
      onSaved();
    } else {
      // Thao tác sai (trùng mã/Số điện thoại, dữ liệu đã tồn tại…) → dialog TO, RÕ.
      toast.alert(res.message ?? 'Lưu khách hàng thất bại', 'Không lưu được');
    }
  }

  return (
    <Modal title={editing ? `Sửa khách hàng ${target!.code}` : 'Thêm khách hàng mới'} onClose={onClose} width="max-w-xl" onSubmit={() => void save()}>
      {editing && (
        <div className="mb-3 rounded-md bg-brand-tint px-3 py-2 text-sm text-brand">
          Mã khách hàng: <span className="font-mono font-semibold">{target!.code}</span> (không đổi)
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Biệt danh (dễ gọi)" required hint='Ví dụ: "Anh Thanh Hải Phòng"'>
          <input className={inputCls} value={nickname} onChange={(e) => setNickname(e.target.value)} autoFocus />
        </Field>
        <Field label="Tên thật" required hint='Ví dụ: "Nguyễn Văn Thanh"'>
          <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Số điện thoại">
          <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Email">
          <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Địa chỉ">
          <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label="Ghi chú">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label="Trạng thái" hint="Đã khóa = chặn giao dịch mới · Đã hủy = ẩn khỏi danh sách">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {statusSelectOptions(statusOptions, target?.status).map((o) => (
              <option key={o.code} value={o.code}>{o.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button
          variant="confirm"
          onClick={save}
          disabled={busy}
          icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
        >
          {editing ? 'Lưu thay đổi' : 'Tạo khách hàng'}
        </Button>
      </div>
    </Modal>
  );
}
