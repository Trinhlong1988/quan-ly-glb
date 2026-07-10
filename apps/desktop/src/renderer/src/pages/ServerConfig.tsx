import { useEffect, useState } from 'react';
import { Eye, EyeOff, Server, PlugZap, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Field, inputCls } from '../components/Field.js';
import { Button } from '../components/Button.js';
import { useToast } from '../lib/toast.js';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'fail'; message: string };

/**
 * Màn "Cấu hình máy chủ" (G10.3) — client nhập IP:port máy chủ PostgreSQL lần đầu.
 * Hiện khi client CHƯA cấu hình / cấu hình sai / kết nối fail (fail-safe: KHÔNG crash, KHÔNG vào thẳng login).
 */
export function ServerConfig({ onConfigured }: { onConfigured: () => void }): JSX.Element {
  const toast = useToast();
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5432');
  const [database, setDatabase] = useState('glb');
  const [user, setUser] = useState('postgres');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);

  // Đổ sẵn cấu hình hiện có (trường hợp sửa cấu hình sai) — mật khẩu cũng được gợi ý để chỉnh nhanh.
  useEffect(() => {
    let alive = true;
    window.api.serverConfigGet().then((st) => {
      if (!alive || !st?.config) return;
      const c = st.config;
      if (c.host) setHost(c.host);
      if (c.port) setPort(String(c.port));
      if (c.database) setDatabase(c.database);
      if (c.user) setUser(c.user);
      if (c.password) setPassword(c.password);
    });
    return () => {
      alive = false;
    };
  }, []);

  function currentInput(): { host: string; port: string; database: string; user: string; password: string } {
    return { host: host.trim(), port: port.trim(), database: database.trim(), user: user.trim(), password };
  }

  async function onTest(): Promise<void> {
    setTest({ kind: 'testing' });
    try {
      const res = await window.api.serverConfigTest(currentInput());
      if (res.ok) {
        setTest({ kind: 'ok' });
        toast.success('Kết nối tới máy chủ thành công.');
      } else {
        const msg = res.error ?? 'Không kết nối được tới máy chủ.';
        setTest({ kind: 'fail', message: msg });
        toast.alert(msg, 'Kết nối thất bại');
      }
    } catch {
      const msg = 'Lỗi hệ thống khi kiểm tra kết nối.';
      setTest({ kind: 'fail', message: msg });
      toast.alert(msg, 'Kết nối thất bại');
    }
  }

  async function onSave(): Promise<void> {
    setSaving(true);
    try {
      const res = await window.api.serverConfigSave(currentInput());
      if (res.ok) {
        toast.success('Đã lưu cấu hình máy chủ. Đang mở đăng nhập…');
        onConfigured();
      } else {
        toast.alert(res.error ?? 'Không lưu được cấu hình máy chủ.', 'Không thể lưu cấu hình');
      }
    } catch {
      toast.alert('Lỗi hệ thống khi lưu cấu hình.', 'Không thể lưu cấu hình');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-tint via-appbg to-[#dfe7f6] p-4">
      <div className="w-full max-w-[520px] rounded-2xl border border-line bg-white p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-md">
            <Server className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Cấu hình máy chủ</h1>
          <p className="mt-1 text-sm text-slate-500">
            Nhập địa chỉ máy chủ dữ liệu GLOBEWAY để kết nối lần đầu. Thông tin do quản trị viên cung cấp.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
            <Field label="Địa chỉ máy chủ (IP)" required>
              <input
                type="text"
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setTest({ kind: 'idle' });
                }}
                autoFocus
                className={inputCls}
                placeholder="192.168.1.6"
              />
            </Field>
            <Field label="Cổng" hint="Mặc định 5432">
              <input
                type="text"
                inputMode="numeric"
                value={port}
                onChange={(e) => {
                  setPort(e.target.value);
                  setTest({ kind: 'idle' });
                }}
                className={inputCls}
                placeholder="5432"
              />
            </Field>
          </div>

          <Field label="Tên CSDL" hint="Mặc định glb">
            <input
              type="text"
              value={database}
              onChange={(e) => {
                setDatabase(e.target.value);
                setTest({ kind: 'idle' });
              }}
              className={inputCls}
              placeholder="glb"
            />
          </Field>

          <Field label="Tài khoản" hint="Mặc định postgres">
            <input
              type="text"
              value={user}
              onChange={(e) => {
                setUser(e.target.value);
                setTest({ kind: 'idle' });
              }}
              className={inputCls}
              placeholder="postgres"
            />
          </Field>

          <Field label="Mật khẩu" required>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setTest({ kind: 'idle' });
                }}
                className={inputCls + ' w-full pr-10'}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                aria-label={showPwd ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-brand"
              >
                {showPwd ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </Field>

          {test.kind === 'ok' && (
            <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              Kết nối tới máy chủ thành công.
            </div>
          )}
          {test.kind === 'fail' && (
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <span className="leading-snug">{test.message}</span>
            </div>
          )}

          <div className="mt-1 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="neutral"
              onClick={() => void onTest()}
              disabled={test.kind === 'testing' || saving}
              icon={
                test.kind === 'testing' ? <Loader2 className="h-5 w-5 animate-spin" /> : <PlugZap className="h-5 w-5" />
              }
            >
              Kiểm tra kết nối
            </Button>
            <Button
              type="submit"
              variant="confirm"
              disabled={saving || test.kind === 'testing'}
              icon={saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Server className="h-5 w-5" />}
            >
              Lưu &amp; Tiếp tục
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
