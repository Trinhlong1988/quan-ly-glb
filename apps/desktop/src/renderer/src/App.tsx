import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { Login } from './pages/Login.js';
import { ServerConfig } from './pages/ServerConfig.js';
import { ForceChangePassword } from './pages/ForceChangePassword.js';
import { Dashboard } from './pages/Dashboard.js';

type Screen = 'loading' | 'server-config' | 'login' | 'force-change' | 'dashboard';

export function App(): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [screen, setScreen] = useState<Screen>('loading');

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

  if (screen === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-appbg text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }
  if (screen === 'server-config') return <ServerConfig onConfigured={() => setScreen('login')} />;
  if (screen === 'login' || !user) return <Login onLoggedIn={onLoggedIn} />;
  if (screen === 'force-change') return <ForceChangePassword user={user} onChanged={onChanged} onLogout={onLogout} />;
  return <Dashboard user={user} onLogout={onLogout} />;
}
