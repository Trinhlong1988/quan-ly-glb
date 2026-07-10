import { useEffect, useState } from 'react';
import { Plus, Pencil, Lock, Unlock, Trash2, Search, Loader2, Users, KeyRound } from 'lucide-react';
import { AdminResetPasswordModal } from '../components/AdminResetPasswordModal.js';
import type { AuthUser } from '@glb/shared';
import { hasPermission, roleLabel, ROLES } from '@glb/shared';
import type { UserDto, RoleDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { StatusPill, statusLabel } from '../components/StatusPill.js';
import { Field, inputCls } from '../components/Field.js';
import { Button } from '../components/Button.js';
import { useRowSelection, SelectionBar, SelectAllCell, SelectCell } from '../components/Selection.js';

const STATUSES = ['ACTIVE', 'PENDING', 'LOCKED', 'DISABLED', 'DELETED'];

export function StaffPage({ user, initialRole }: { user: AuthUser; initialRole?: string }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<UserDto[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState(initialRole ?? '');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'lock' | 'unlock' | 'delete'; u: UserDto } | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserDto | null>(null);
  const sel = useRowSelection();

  const canCreate = hasPermission(user, 'USER_CREATE') || hasPermission(user, 'USER_CREATE_LIMITED');
  const canUpdate = hasPermission(user, 'USER_UPDATE');
  const canLock = hasPermission(user, 'USER_LOCK');
  const canUnlock = hasPermission(user, 'USER_UNLOCK');
  const canDelete = hasPermission(user, 'USER_DELETE');
  const canReset = hasPermission(user, 'USER_RESET_PASSWORD');

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.userList({ roleCode: roleFilter || undefined, status: statusFilter || undefined, search: search || undefined });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleFilter, statusFilter]);
  useEffect(() => {
    window.api.roleList().then((r) => {
      if (r.ok && r.data) setRoles(r.data);
    });
  }, []);

  async function doLock(u: UserDto, lock: boolean): Promise<void> {
    const res = lock ? await window.api.userLock(u.id) : await window.api.userUnlock(u.id);
    if (res.ok) toast.success(lock ? `Đã khóa tài khoản ${u.username}` : `Đã mở khóa ${u.username}`);
    else toast.alert(res.message ?? 'Thao tác thất bại', 'Thao tác thất bại');
    setConfirm(null);
    await reload();
  }
  async function doDelete(u: UserDto, password?: string): Promise<void> {
    const res = await window.api.userDelete(u.id, password ?? '');
    if (res.ok) toast.success(`Đã xóa nhân sự ${u.fullName}`);
    else toast.alert(res.message ?? 'Không thể xóa nhân sự', 'Xóa thất bại');
    setConfirm(null);
    await reload();
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.userDeleteMany([...sel.selected], password ?? '');
    if (!res.ok) {
      toast.alert(res.message ?? 'Không thể xóa nhân sự', 'Xóa thất bại');
    } else if (res.skipped && res.skipped.length > 0) {
      const detail = res.skipped.map((s) => `#${s.id}: ${s.message ?? s.reason}`).join('\n');
      toast.alert(`Đã xóa ${res.deleted ?? 0} nhân sự. Bỏ qua ${res.skipped.length}:\n${detail}`, 'Kết quả xóa hàng loạt');
    } else {
      toast.success(`Đã xóa ${res.deleted ?? 0} nhân sự`);
    }
    setBulkDel(false);
    await reload();
  }

  const roleOptions = mergeRoles(roles);
  // ID được phép chọn để xóa: chưa bị xóa (self / Admin-cuối sẽ bị backend bỏ qua kèm lý do).
  const selectableIds = rows.filter((u) => u.status !== 'DELETED').map((u) => u.id);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Quản lý danh sách nhân sự</h2>
          <p className="text-sm text-slate-500">Sổ nhân sự theo từng vai trò, trạng thái — có tìm kiếm & lọc.</p>
        </div>
        {canCreate && (
          <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Thêm nhân sự
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && reload()}
            placeholder="Tìm tên, tên đăng nhập, email, Số điện thoại…"
            className={inputCls + ' w-72 pl-8'}
          />
        </div>
        <select className={inputCls} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">Tất cả vai trò</option>
          {roleOptions.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
        <select className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Tất cả trạng thái</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <button onClick={reload} className="rounded-md border border-line px-3 py-2 text-sm text-slate-600 hover:bg-appbg">
          Lọc
        </button>
      </div>

      {canDelete && <SelectionBar count={sel.count} entityLabel="nhân sự" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {canDelete && <SelectAllCell ids={selectableIds} sel={sel} />}
              <th className="px-4 py-3">Mã NV</th>
              <th className="px-4 py-3">Nhân sự</th>
              <th className="px-4 py-3">Tên đăng nhập</th>
              <th className="px-4 py-3">Liên hệ</th>
              <th className="px-4 py-3">Vai trò</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={canDelete ? 8 : 7} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={canDelete ? 8 : 7} className="px-4 py-10 text-center text-slate-400">
                  <Users className="mx-auto mb-2 h-6 w-6" />
                  Không có nhân sự phù hợp bộ lọc.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((u) => (
                <tr key={u.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(u.id) ? 'bg-brand-tint/40' : '')}>
                  {canDelete && (u.status !== 'DELETED' ? <SelectCell id={u.id} sel={sel} /> : <td className="px-4 py-3" />)}
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-brand">{u.employeeCode ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-tint text-xs font-semibold text-brand">
                        {u.fullName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-slate-800">{u.fullName}</div>
                        {u.email && <div className="text-xs text-slate-400">{u.email}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{u.username}</td>
                  <td className="px-4 py-3 text-slate-600">{u.phone ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((c) => (
                        <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                          {roleLabel(c)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={u.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {canUpdate && u.status !== 'DELETED' && (
                        <IconBtn title="Sửa" variant="edit" onClick={() => setEditing(u)}>
                          <Pencil className="h-4 w-4" />
                        </IconBtn>
                      )}
                      {u.status === 'ACTIVE' && canLock && (
                        <IconBtn title="Khóa" onClick={() => setConfirm({ kind: 'lock', u })}>
                          <Lock className="h-4 w-4" />
                        </IconBtn>
                      )}
                      {u.status === 'LOCKED' && canUnlock && (
                        <IconBtn title="Mở khóa" onClick={() => setConfirm({ kind: 'unlock', u })}>
                          <Unlock className="h-4 w-4" />
                        </IconBtn>
                      )}
                      {canReset && u.status !== 'DELETED' && (
                        <IconBtn title="Đặt lại mật khẩu" variant="edit" onClick={() => setResetTarget(u)}>
                          <KeyRound className="h-4 w-4" />
                        </IconBtn>
                      )}
                      {canDelete && u.status !== 'DELETED' && (
                        <IconBtn title="Xóa" variant="danger" onClick={() => setConfirm({ kind: 'delete', u })}>
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
        <StaffForm
          actor={user}
          target={editing}
          roleOptions={roleOptions}
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

      {confirm?.kind === 'lock' && (
        <ConfirmDialog
          title="Khóa tài khoản"
          message={`Bạn có chắc muốn khóa tài khoản "${confirm.u.username}"?`}
          confirmLabel="Khóa"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => doLock(confirm.u, true)}
        />
      )}
      {confirm?.kind === 'unlock' && (
        <ConfirmDialog
          title="Mở khóa tài khoản"
          message={`Mở khóa tài khoản "${confirm.u.username}"?`}
          confirmLabel="Mở khóa"
          onCancel={() => setConfirm(null)}
          onConfirm={() => doLock(confirm.u, false)}
        />
      )}
      {confirm?.kind === 'delete' && (
        <ConfirmDialog
          title="Xóa nhân sự"
          message={`Hành động này sẽ xóa mềm tài khoản "${confirm.u.username}". Vui lòng nhập lại mật khẩu để xác nhận.`}
          confirmLabel="Xóa"
          danger
          requirePassword
          onCancel={() => setConfirm(null)}
          onConfirm={(pwd) => doDelete(confirm.u, pwd)}
        />
      )}
      {bulkDel && (
        <ConfirmDialog
          title="Xóa nhiều nhân sự"
          message={`${sel.count} nhân sự đã chọn sẽ bị xóa mềm. Không thể tự xóa chính mình hoặc Admin cuối cùng — các trường hợp này sẽ được bỏ qua kèm lý do. Nhập lại mật khẩu để xác nhận.`}
          confirmLabel={`Xóa ${sel.count} nhân sự`}
          danger
          requirePassword
          onCancel={() => setBulkDel(false)}
          onConfirm={(pwd) => doBulkDelete(pwd)}
        />
      )}
      {resetTarget && (
        <AdminResetPasswordModal
          target={{ id: resetTarget.id, fullName: resetTarget.fullName, username: resetTarget.username }}
          onClose={() => setResetTarget(null)}
          onDone={reload}
        />
      )}
    </div>
  );
}

// Nút icon theo quy ước màu (R_BUTTON_SEMANTICS): sửa=vàng, xóa=đỏ.
function IconBtn({
  children,
  title,
  variant,
  onClick
}: {
  children: JSX.Element;
  title: string;
  variant?: 'edit' | 'danger';
  onClick: () => void;
}): JSX.Element {
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

/** Merge static system roles with fetched custom roles (dedupe by code). */
function mergeRoles(fetched: RoleDto[]): { code: string; name: string }[] {
  const map = new Map<string, { code: string; name: string }>();
  for (const r of ROLES) map.set(r.code, { code: r.code, name: r.name });
  for (const r of fetched) map.set(r.code, { code: r.code, name: r.name });
  return [...map.values()];
}

function StaffForm({
  actor,
  target,
  roleOptions,
  onClose,
  onSaved
}: {
  actor: AuthUser;
  target: UserDto | null;
  roleOptions: { code: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const toast = useToast();
  const editing = !!target;
  const [fullName, setFullName] = useState(target?.fullName ?? '');
  const [birthDate, setBirthDate] = useState(target?.birthDate ? target.birthDate.slice(0, 10) : '');
  const [gender, setGender] = useState(target?.gender ?? '');
  const [phone, setPhone] = useState(target?.phone ?? '');
  const [email, setEmail] = useState(target?.email ?? '');
  const [address, setAddress] = useState(target?.address ?? '');
  const [joinDate, setJoinDate] = useState(target?.joinedAt ? target.joinedAt.slice(0, 10) : '');
  const [username, setUsername] = useState(target?.username ?? '');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState(target?.status ?? 'ACTIVE');
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set(target?.roles ?? []));
  const [busy, setBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);

  // Manager cannot assign ADMIN/MANAGER (R_MANAGER_002/003) — hide those options for non-admin.
  const isAdmin = actor.roles.includes('ADMIN');
  const assignable = roleOptions.filter((r) => isAdmin || (r.code !== 'ADMIN' && r.code !== 'MANAGER'));

  function toggleRole(code: string): void {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function save(): Promise<void> {
    if (!fullName.trim()) return toast.alert('Họ và tên bắt buộc.');
    if (selectedRoles.size === 0) return toast.alert('Phải chọn ít nhất 1 vai trò.');
    setBusy(true);
    let res;
    if (editing) {
      res = await window.api.userUpdate(target!.id, {
        fullName: fullName.trim(),
        birthDate: birthDate || null,
        gender: gender || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        joinDate: joinDate || null,
        status,
        roleCodes: [...selectedRoles]
      });
    } else {
      res = await window.api.userCreate({
        fullName: fullName.trim(),
        birthDate: birthDate || null,
        gender: gender || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        joinDate: joinDate || null,
        username: username.trim(),
        password,
        status,
        roleCodes: [...selectedRoles]
      });
    }
    setBusy(false);
    setPendingConfirm(false);
    if (res.ok) {
      toast.success(editing ? `Đã cập nhật ${fullName}` : `Đã tạo nhân sự ${fullName}`);
      onSaved();
    } else {
      toast.alert(res.message ?? 'Lưu nhân sự thất bại');
    }
  }

  return (
    <>
      <Modal title={editing ? 'Sửa thông tin nhân sự' : 'Thêm nhân sự mới'} onClose={onClose} width="max-w-2xl">
        {editing ? (
          <div className="mb-3 rounded-md bg-brand-tint px-3 py-2 text-sm text-brand">
            Mã nhân viên: <span className="font-mono font-semibold">{target!.employeeCode ?? '—'}</span> (tự sinh, không đổi)
          </div>
        ) : (
          <div className="mb-3 rounded-md bg-appbg px-3 py-2 text-sm text-slate-500">Mã nhân viên (NV##) sẽ được tự sinh khi tạo.</div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Họ và tên" required>
            <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Ngày sinh">
            <input type="date" className={inputCls} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </Field>
          <Field label="Giới tính">
            <select className={inputCls} value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">—</option>
              <option value="Nam">Nam</option>
              <option value="Nữ">Nữ</option>
              <option value="Khác">Khác</option>
            </select>
          </Field>
          <Field label="Số điện thoại" required>
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email" required hint="Không được trùng">
            <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Địa chỉ">
            <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="Tên đăng nhập" required hint="≥8 ký tự, chỉ A-Z a-z 0-9">
            <input
              className={inputCls + (editing ? ' bg-appbg text-slate-400' : '')}
              value={username}
              disabled={editing}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          {!editing && (
            <Field label="Mật khẩu" required hint="≥8 ký tự, gồm chữ và số">
              <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          <Field label="Ngày vào làm">
            <input type="date" className={inputCls} value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />
          </Field>
          <Field label="Trạng thái" required>
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ACTIVE">Hoạt động</option>
              <option value="PENDING">Chờ kích hoạt</option>
              {editing && <option value="DISABLED">Ngưng dùng</option>}
            </select>
          </Field>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-sm font-medium text-slate-700">
            Vai trò <span className="text-danger">*</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {assignable.map((r) => (
              <label key={r.code} className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-slate-600 hover:bg-appbg">
                <input
                  type="checkbox"
                  checked={selectedRoles.has(r.code)}
                  onChange={() => toggleRole(r.code)}
                  className="h-4 w-4 accent-[#1657d0]"
                />
                {r.name}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-600 hover:bg-appbg">
            Hủy
          </button>
          <button
            onClick={() => (editing ? setPendingConfirm(true) : save())}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? 'Lưu thay đổi' : 'Tạo nhân sự'}
          </button>
        </div>
      </Modal>

      {pendingConfirm && (
        <ConfirmDialog
          title="Xác nhận thay đổi"
          message="Bạn có chắc muốn lưu thay đổi cho nhân sự này?"
          confirmLabel="Đồng ý"
          onCancel={() => setPendingConfirm(false)}
          onConfirm={save}
        />
      )}
    </>
  );
}
