import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, UserRound } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission } from '@glb/shared';
import type { CustomerDto, AgentDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';

/** Khách hàng (§D): hiển thị `KH## · biệt danh (tên thật)` + SĐT. Mã tự sinh, nickname bắt buộc. */
export function CustomersPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<CustomerDto[]>([]);
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [agentId, setAgentId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CustomerDto | null>(null);
  const [confirmDel, setConfirmDel] = useState<CustomerDto | null>(null);

  const canCreate = hasPermission(user, 'CUSTOMER_CREATE');
  const canUpdate = hasPermission(user, 'CUSTOMER_UPDATE');
  const canDelete = hasPermission(user, 'CUSTOMER_DELETE');

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.customerList({
      search: search || undefined,
      agentId: agentId ? Number(agentId) : undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined
    });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.error(res.message);
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    window.api.agentList().then((r) => r.ok && r.data && setAgents(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetFilters(): void {
    setSearch('');
    setAgentId('');
    setFromDate('');
    setToDate('');
    setTimeout(reload, 0);
  }

  async function doDelete(c: CustomerDto, password?: string): Promise<void> {
    const res = await window.api.customerDelete(c.id, password ?? '');
    if (res.ok) toast.success(`Đã xóa khách hàng ${c.display}`);
    else toast.error(res.message ?? 'Không thể xóa khách hàng');
    setConfirmDel(null);
    await reload();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Khách hàng</h2>
          <p className="text-sm text-slate-500">Mã KH tự sinh · biệt danh dễ gọi · tên thật · SĐT.</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            <Plus className="h-4 w-4" /> Thêm khách hàng
          </button>
        )}
      </div>

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Tìm mã KH, biệt danh, tên thật, SĐT…"
        fromDate={fromDate}
        toDate={toDate}
        onFromDate={setFromDate}
        onToDate={setToDate}
        selects={[
          {
            key: 'agent',
            placeholder: 'Tất cả đại lý',
            value: agentId,
            options: agents.map((a) => ({ value: String(a.id), label: a.name })),
            onChange: setAgentId
          }
        ]}
        onApply={reload}
        onReset={resetFilters}
      />

      <div className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Mã KH</th>
              <th className="px-4 py-3">Khách hàng</th>
              <th className="px-4 py-3">SĐT</th>
              <th className="px-4 py-3">Địa chỉ</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  <UserRound className="mx-auto mb-2 h-6 w-6" />
                  Chưa có khách hàng.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((c) => (
                <tr key={c.id} className="hover:bg-appbg/60">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-brand">{c.code}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{c.nickname}</div>
                    <div className="text-xs text-slate-400">{c.fullName}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{c.address ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {canUpdate && (
                        <IconBtn title="Sửa" onClick={() => setEditing(c)}>
                          <Pencil className="h-4 w-4" />
                        </IconBtn>
                      )}
                      {canDelete && (
                        <IconBtn title="Xóa" danger onClick={() => setConfirmDel(c)}>
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

      {confirmDel && (
        <ConfirmDialog
          title="Xóa khách hàng"
          message={`Xóa mềm khách hàng "${confirmDel.display}". Nhập lại mật khẩu để xác nhận.`}
          confirmLabel="Xóa"
          danger
          requirePassword
          onCancel={() => setConfirmDel(null)}
          onConfirm={(pwd) => doDelete(confirmDel, pwd)}
        />
      )}
    </div>
  );
}

function IconBtn({ children, title, danger, onClick }: { children: JSX.Element; title: string; danger?: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      className={'rounded-md p-1.5 transition ' + (danger ? 'text-slate-400 hover:bg-danger/10 hover:text-danger' : 'text-slate-400 hover:bg-brand-tint hover:text-brand')}
    >
      {children}
    </button>
  );
}

function CustomerForm({ target, onClose, onSaved }: { target: CustomerDto | null; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const editing = !!target;
  const [fullName, setFullName] = useState(target?.fullName ?? '');
  const [nickname, setNickname] = useState(target?.nickname ?? '');
  const [phone, setPhone] = useState(target?.phone ?? '');
  const [email, setEmail] = useState(target?.email ?? '');
  const [address, setAddress] = useState(target?.address ?? '');
  const [note, setNote] = useState(target?.note ?? '');
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (!fullName.trim()) return toast.error('Tên thật khách hàng bắt buộc.');
    if (!nickname.trim()) return toast.error('Biệt danh (tên dễ gọi) là bắt buộc.');
    setBusy(true);
    const payload = {
      fullName: fullName.trim(),
      nickname: nickname.trim(),
      phone: phone || null,
      email: email || null,
      address: address || null,
      note: note || null
    };
    const res = editing ? await window.api.customerUpdate(target!.id, payload) : await window.api.customerCreate(payload);
    setBusy(false);
    if (res.ok) {
      toast.success(editing ? `Đã cập nhật ${nickname}` : `Đã tạo khách hàng ${nickname}`);
      onSaved();
    } else {
      toast.error(res.message ?? 'Lưu khách hàng thất bại');
    }
  }

  return (
    <Modal title={editing ? `Sửa khách hàng ${target!.code}` : 'Thêm khách hàng mới'} onClose={onClose} width="max-w-xl">
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
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-600 hover:bg-appbg">
          Hủy
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {editing ? 'Lưu thay đổi' : 'Tạo khách hàng'}
        </button>
      </div>
    </Modal>
  );
}
