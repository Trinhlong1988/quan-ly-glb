import { useCallback, useState } from 'react';
import type { AuthUser } from '@glb/shared';
import { Login } from './pages/Login.js';
import { ForceChangePassword } from './pages/ForceChangePassword.js';
import { Dashboard } from './pages/Dashboard.js';

type Screen = 'login' | 'force-change' | 'dashboard';

export function App(): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [screen, setScreen] = useState<Screen>('login');

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

  if (screen === 'login' || !user) return <Login onLoggedIn={onLoggedIn} />;
  if (screen === 'force-change') return <ForceChangePassword user={user} onChanged={onChanged} onLogout={onLogout} />;
  return <Dashboard user={user} onLogout={onLogout} />;
}
