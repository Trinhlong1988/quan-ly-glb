import { useEffect, useState } from 'react';
import { LogIn, ShieldCheck, Loader2 } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { PasswordInput } from '../components/PasswordInput.js';
import { useToast } from '../lib/toast.js';

export function Login({ onLoggedIn }: { onLoggedIn: (u: AuthUser, mustChange: boolean) => void }): JSX.Element {
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // P1-03: chỉ điền sẵn TÊN đăng nhập (mật khẩu KHÔNG rời main). Đăng nhập-đã-nhớ do main tự giải mã + login.
  useEffect(() => {
    let alive = true;
    window.api.getRemembered().then((creds) => {
      if (alive && creds) {
        setUsername(creds.username);
        setRemember(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Đăng nhập bằng bản đã nhớ (main giải mã mật khẩu) — có xử lý phiên-ở-thiết-bị-khác như đăng nhập thường.
  async function doLoginRemembered(force: boolean): Promise<void> {
    const res = await window.api.loginRemembered(force);
    if (res.ok && res.user) {
      toast.success(`Xin chào ${res.user.fullName}`);
      onLoggedIn(res.user, !!res.mustChangePassword);
      return;
    }
    if (res.error === 'SESSION_ACTIVE_ELSEWHERE') {
      const agree = await toast.confirm(
        `Tài khoản đang đăng nhập ở "${res.otherDevice ?? 'thiết bị khác'}".\n\nĐăng nhập tại đây sẽ ĐĂNG XUẤT thiết bị kia. Tiếp tục?`,
        { title: 'Đang đăng nhập ở thiết bị khác', okLabel: 'Đăng nhập tại đây', cancelLabel: 'Hủy' }
      );
      if (agree) await doLoginRemembered(true);
      return;
    }
    if (res.error === 'NO_REMEMBERED') return; // chưa lưu → nhập tay bình thường
    const msg = res.message ?? 'Đăng nhập không hợp lệ.';
    setError(msg);
    toast.alert(msg);
  }

  // R46: đăng nhập; nếu tài khoản đang đăng nhập ở thiết bị khác → hỏi xác nhận → đăng nhập lại với force=true
  // (đăng xuất thiết bị kia). Đệ quy 1 lần sau khi người dùng đồng ý.
  async function doLogin(force: boolean): Promise<void> {
    const res = await window.api.login(username.trim(), password, remember, force);
    if (res.ok && res.user) {
      toast.success(`Xin chào ${res.user.fullName}`);
      onLoggedIn(res.user, !!res.mustChangePassword);
      return;
    }
    if (res.error === 'SESSION_ACTIVE_ELSEWHERE') {
      const agree = await toast.confirm(
        `Tài khoản đang đăng nhập ở "${res.otherDevice ?? 'thiết bị khác'}".\n\nĐăng nhập tại đây sẽ ĐĂNG XUẤT thiết bị kia. Tiếp tục?`,
        { title: 'Đang đăng nhập ở thiết bị khác', okLabel: 'Đăng nhập tại đây', cancelLabel: 'Hủy' }
      );
      if (agree) await doLogin(true);
      return;
    }
    const msg = res.message ?? 'Đăng nhập không hợp lệ.';
    setError(msg);
    toast.alert(msg);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    // P1-03: đã nhớ đăng nhập + để trống ô mật khẩu → dùng bản nhớ (main tự giải mã), không cần gõ lại.
    if (remember && !password && username) {
      setBusy(true);
      try {
        await doLoginRemembered(false);
      } catch {
        setError('Lỗi hệ thống khi đăng nhập.');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!username || !password) {
      setError('Vui lòng nhập tên đăng nhập và mật khẩu.');
      return;
    }
    setBusy(true);
    try {
      await doLogin(false);
    } catch {
      const msg = 'Lỗi hệ thống khi đăng nhập.';
      setError(msg);
      toast.alert(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#eaf1fc] via-appbg to-[#dfe7f6] p-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-line bg-white p-8 shadow-xl">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-md">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Quản Lý GLB</h1>
          <p className="mt-1 text-sm text-slate-500">Hệ thống quản lý nội bộ GLOBEWAY</p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">Tên đăng nhập</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              className="rounded-md border border-line bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
              placeholder="adminroot"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">Mật khẩu</span>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>

          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 accent-[#1657d0]"
            />
            Ghi nhớ đăng nhập
          </label>

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
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
            Đăng nhập
          </button>
        </form>
      </div>
    </div>
  );
}
