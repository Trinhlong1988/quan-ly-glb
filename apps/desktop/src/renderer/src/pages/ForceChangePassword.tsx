import { useState } from 'react';
import { KeyRound, Loader2, LogOut } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { PasswordInput } from '../components/PasswordInput.js';
import { useToast } from '../lib/toast.js';

export function ForceChangePassword({
  user,
  onChanged,
  onLogout
}: {
  user: AuthUser;
  onChanged: () => void;
  onLogout: () => void;
}): JSX.Element {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }
    const check = await window.api.validatePassword(next);
    if (!check.valid) {
      setError(check.error ?? 'Mật khẩu không hợp lệ.');
      return;
    }
    setBusy(true);
    try {
      const res = await window.api.changePassword(current, next, confirm);
      if (res.ok) {
        toast.success('Đã đổi mật khẩu thành công');
        onChanged();
      } else {
        const msg = res.message ?? 'Đổi mật khẩu thất bại.';
        setError(msg);
        toast.alert(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#eaf1fc] via-appbg to-[#dfe7f6] p-4">
      <div className="w-full max-w-[440px] rounded-2xl border border-line bg-white p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-warning text-white shadow-md">
            <KeyRound className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Đổi mật khẩu lần đầu</h1>
          <p className="mt-1 text-sm text-slate-500">
            Tài khoản <span className="font-semibold">{user.username}</span> cần đặt mật khẩu mới
            trước khi tiếp tục.
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Mật khẩu hiện tại" value={current} onChange={setCurrent} />
          <Field label="Mật khẩu mới" value={next} onChange={setNext} />
          <Field label="Xác nhận mật khẩu mới" value={confirm} onChange={setConfirm} />

          {error && (
            <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
            Xác nhận đổi mật khẩu
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-danger"
          >
            <LogOut className="h-4 w-4" />
            Đăng xuất
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <PasswordInput value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
