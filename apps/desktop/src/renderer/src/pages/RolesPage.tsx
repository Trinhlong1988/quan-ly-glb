import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Lock, Unlock, Trash2, ShieldCheck, Loader2 } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission } from '@glb/shared';
import type { RoleDto, PermissionDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { Button } from '../components/Button.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { StatusPill } from '../components/StatusPill.js';
import { Field, inputCls } from '../components/Field.js';

export function RolesPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [perms, setPerms] = useState<PermissionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RoleDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'lock' | 'unlock' | 'delete'; role: RoleDto } | null>(null);

  const canCreate = hasPermission(user, 'ROLE_CREATE');
  const canUpdate = hasPermission(user, 'ROLE_UPDATE');
  const canLock = hasPermission(user, 'ROLE_LOCK');
  const canUnlock = hasPermission(user, 'ROLE_UNLOCK');
  const canDelete = hasPermission(user, 'ROLE_DELETE');

  async function reload(): Promise<void> {
    setLoading(true);
    const [r, p] = await Promise.all([window.api.roleList(), window.api.rolePermissions()]);
    if (r.ok && r.data) setRoles(r.data);
    else if (r.message) toast.alert(r.message);
    if (p.ok && p.data) setPerms(p.data);
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doLock(role: RoleDto, lock: boolean): Promise<void> {
    const res = lock ? await window.api.roleLock(role.id) : await window.api.roleUnlock(role.id);
    if (res.ok) toast.success(lock ? `Đã khóa vai trò ${role.name}` : `Đã mở khóa vai trò ${role.name}`);
    else toast.alert(res.message ?? 'Thao tác thất bại');
    setConfirm(null);
    await reload();
  }
  async function doDelete(role: RoleDto, password?: string): Promise<void> {
    const res = await window.api.roleDelete(role.id, password ?? '');
    if (res.ok) toast.success(`Đã xóa vai trò ${role.name}`);
    else toast.alert(res.message ?? 'Không thể xóa vai trò');
    setConfirm(null);
    await reload();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Quản lý vai trò</h2>
          <p className="text-sm text-slate-500">Tạo, phân quyền, khóa/mở khóa và xóa vai trò hệ thống.</p>
        </div>
        {canCreate && (
          <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Thêm vai trò
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Vai trò</th>
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Quyền</th>
              <th className="px-4 py-3">Nhân sự</th>
              <th className="px-4 py-3">Trạng thái</th>
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
            {!loading &&
              roles.map((r) => (
                <tr key={r.id} className="hover:bg-appbg/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium text-slate-800">
                      <ShieldCheck className="h-4 w-4 text-brand" />
                      {r.name}
                      {r.isSystem && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                          hệ thống
                        </span>
                      )}
                    </div>
                    {r.description && <div className="text-xs text-slate-400">{r.description}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.code}</td>
                  <td className="px-4 py-3 text-slate-600">{r.permissions.length} quyền</td>
                  <td className="px-4 py-3 text-slate-600">{r.userCount}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {canUpdate && (
                        <IconBtn title="Sửa" variant="edit" onClick={() => setEditing(r)}>
                          <Pencil className="h-4 w-4" />
                        </IconBtn>
                      )}
                      {r.status === 'ACTIVE' && canLock && (
                        <IconBtn title="Khóa" onClick={() => setConfirm({ kind: 'lock', role: r })}>
                          <Lock className="h-4 w-4" />
                        </IconBtn>
                      )}
                      {r.status === 'LOCKED' && canUnlock && (
                        <IconBtn title="Mở khóa" onClick={() => setConfirm({ kind: 'unlock', role: r })}>
                          <Unlock className="h-4 w-4" />
                        </IconBtn>
                      )}
                      {canDelete && (
                        <IconBtn title="Xóa" variant="danger" onClick={() => setConfirm({ kind: 'delete', role: r })}>
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
        <RoleForm
          role={editing}
          allPerms={perms}
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
          title="Khóa vai trò"
          message={`Bạn có chắc muốn khóa vai trò "${confirm.role.name}"? Người dùng thuộc vai trò này sẽ mất quyền tương ứng.`}
          confirmLabel="Khóa"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => doLock(confirm.role, true)}
        />
      )}
      {confirm?.kind === 'unlock' && (
        <ConfirmDialog
          title="Mở khóa vai trò"
          message={`Mở khóa vai trò "${confirm.role.name}"?`}
          confirmLabel="Mở khóa"
          onCancel={() => setConfirm(null)}
          onConfirm={() => doLock(confirm.role, false)}
        />
      )}
      {confirm?.kind === 'delete' && (
        <ConfirmDialog
          title="Xóa vai trò"
          message={`Bạn đang xóa vai trò "${confirm.role.name}". Không thể xóa nếu vai trò đang có nhân sự sử dụng. Vui lòng nhập lại mật khẩu.`}
          confirmLabel="Xóa"
          danger
          requirePassword
          onCancel={() => setConfirm(null)}
          onConfirm={(pwd) => doDelete(confirm.role, pwd)}
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

function RoleForm({
  role,
  allPerms,
  onClose,
  onSaved
}: {
  role: RoleDto | null;
  allPerms: PermissionDto[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const toast = useToast();
  const editing = !!role;
  const [name, setName] = useState(role?.name ?? '');
  const [code, setCode] = useState(role?.code ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [status, setStatus] = useState(role?.status ?? 'ACTIVE');
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [busy, setBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);

  const groups = useMemo(() => {
    const g: Record<string, PermissionDto[]> = {};
    for (const p of allPerms) {
      const key = p.group ?? 'KHÁC';
      (g[key] ??= []).push(p);
    }
    return g;
  }, [allPerms]);

  function toggle(codeStr: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(codeStr)) next.delete(codeStr);
      else next.add(codeStr);
      return next;
    });
  }

  async function save(): Promise<void> {
    if (!name.trim()) {
      toast.alert('Tên vai trò bắt buộc.');
      return;
    }
    setBusy(true);
    const input = {
      name: name.trim(),
      code: code.trim(),
      description: description.trim(),
      status,
      permissionCodes: [...selected]
    };
    const res = editing ? await window.api.roleUpdate(role!.id, input) : await window.api.roleCreate(input);
    setBusy(false);
    setPendingConfirm(false);
    if (res.ok) {
      toast.success(editing ? `Đã cập nhật vai trò ${name}` : `Đã tạo vai trò ${name}`);
      onSaved();
    } else {
      toast.alert(res.message ?? 'Lưu vai trò thất bại');
    }
  }

  return (
    <>
      <Modal title={editing ? 'Sửa vai trò' : 'Thêm vai trò mới'} onClose={onClose} width="max-w-2xl">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tên vai trò" required>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketing" />
          </Field>
          <Field label="Mã vai trò" required hint="CHỮ HOA, số, gạch dưới — không dấu">
            <input
              className={inputCls + (editing ? ' bg-appbg text-slate-400' : '')}
              value={code}
              disabled={editing}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="MARKETING"
            />
          </Field>
          <Field label="Mô tả">
            <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Trạng thái" required>
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ACTIVE">Hoạt động</option>
              <option value="LOCKED">Khóa</option>
            </select>
          </Field>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-sm font-medium text-slate-700">Phân quyền</div>
          <div className="space-y-3">
            {Object.entries(groups).map(([group, list]) => (
              <div key={group} className="rounded-lg border border-line p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</div>
                <div className="grid grid-cols-2 gap-2">
                  {list.map((p) => (
                    <label key={p.code} className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={selected.has(p.code)}
                        onChange={() => toggle(p.code)}
                        className="h-4 w-4 accent-[#1657d0]"
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              </div>
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
            className="flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? 'Lưu thay đổi' : 'Tạo vai trò'}
          </button>
        </div>
      </Modal>

      {/* R_ROLE_010: sửa vai trò → popup xác nhận Có/Hủy */}
      {pendingConfirm && (
        <ConfirmDialog
          title="Xác nhận thay đổi"
          message="Bạn có chắc muốn lưu thay đổi cho vai trò này?"
          confirmLabel="Đồng ý"
          onCancel={() => setPendingConfirm(false)}
          onConfirm={save}
        />
      )}
    </>
  );
}
