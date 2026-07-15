import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { Login } from './pages/Login.js';
import { ServerConfig } from './pages/ServerConfig.js';
import { ForceChangePassword } from './pages/ForceChangePassword.js';
import { Dashboard } from './pages/Dashboard.js';
import { RealtimeProvider } from './lib/realtime.js';
import { TitleBar } from './components/TitleBar.js';
import { useToast } from './lib/toast.js';

type Screen = 'loading' | 'server-config' | 'login' | 'force-change' | 'dashboard';

export function App(): JSX.Element {
  const toast = useToast();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [screen, setScreen] = useState<Screen>('loading');

  // R46 nhịp tim: đang đăng nhập → ~15s gọi 1 lần. Nếu phiên bị đá (đăng nhập ở thiết bị khác) → báo + về đăng nhập.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const r = await window.api.sessionHeartbeat();
        if (alive && r.kicked) {
          const where = r.byDevice ? ` ở thiết bị "${r.byDevice}"` : ' ở thiết bị khác';
          toast.alert(`Tài khoản của bạn vừa đăng nhập${where} nên phiên này đã kết thúc. Mọi thao tác chưa lưu sẽ không được giữ lại.`, 'Đã đăng xuất');
          setUser(null);
          setScreen('login');
        }
      } catch {
        /* mạng chập chờn — bỏ qua nhịp này, thử lại nhịp sau */
      }
    };
    const id = setInterval(tick, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [user, toast]);

  // G10.3 khởi động: client CHƯA cấu hình / kết nối fail → màn "Cấu hình máy chủ" (KHÔNG crash).
  // Máy chủ (serverRole) hoặc đã kết nối được → vào đăng nhập.
  const decideStart = useCallback(async () => {
    try {
      const st = await window.api.serverConfigGet();
      setScreen(st.needsConfig ? 'server-config' : 'login');
    } catch {
      // Không lấy được trạng thái → an toàn: vẫn cho vào đăng nhập (không kẹt màn trắng).
      setScreen('login');
    }
  }, []);

  useEffect(() => {
    void decideStart();
  }, [decideStart]);

  const onLoggedIn = useCallback((u: AuthUser, mustChange: boolean) => {
    setUser(u);
    setScreen(mustChange || u.forceChangePassword ? 'force-change' : 'dashboard');
  }, []);

  const onChanged = useCallback(() => {
    setUser((prev) => (prev ? { ...prev, forceChangePassword: false } : prev));
    setScreen('dashboard');
  }, []);

  const onLogout = useCallback(async () => {
    await window.api.logout();
    setUser(null);
    setScreen('login');
  }, []);

  let content: JSX.Element;
  if (screen === 'loading') {
    content = (
      <div className="flex h-full items-center justify-center bg-appbg text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  } else if (screen === 'server-config') {
    content = <ServerConfig onConfigured={() => setScreen('login')} />;
  } else if (screen === 'login' || !user) {
    content = <Login onLoggedIn={onLoggedIn} />;
  } else if (screen === 'force-change') {
    content = <ForceChangePassword user={user} onChanged={onChanged} onLogout={onLogout} />;
  } else {
    // R48 Pha 4 — provider realtime chỉ chạy khi đã đăng nhập (poll cần phiên hợp lệ); logout → Dashboard unmount → dừng poll.
    content = (
      <RealtimeProvider>
        <Dashboard user={user} onLogout={onLogout} />
      </RealtimeProvider>
    );
  }

  // Thanh tiêu đề Mac luôn hiện trên cùng; nội dung màn hình lấp phần còn lại của cửa sổ.
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TitleBar />
      <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
    </div>
  );
}
