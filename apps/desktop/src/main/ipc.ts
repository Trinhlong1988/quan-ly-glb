// IPC registration (main). Renderer never touches the DB — all DB work lives behind these handlers.
import { ipcMain } from 'electron';
import { validatePassword } from '@glb/shared';
import * as auth from './auth-service.js';
import { getRemembered, saveRemembered, clearRemembered } from './remember.js';

export function registerIpc(): void {
  ipcMain.handle('auth:login', async (_e, args: { username: string; password: string; remember?: boolean }) => {
    const { username, password, remember } = args ?? ({} as never);
    const result = await auth.login(username, password);
    if (result.ok) {
      if (remember) saveRemembered(username, password);
      else clearRemembered();
    }
    return result;
  });

  ipcMain.handle('auth:me', async () => auth.me());

  ipcMain.handle('auth:logout', async () => {
    await auth.logout();
    return { ok: true };
  });

  ipcMain.handle(
    'auth:changePassword',
    async (_e, args: { currentPassword: string; newPassword: string }) => {
      const { currentPassword, newPassword } = args ?? ({} as never);
      return auth.changePassword(currentPassword, newPassword);
    }
  );

  // Client-side pre-check mirror (renderer also validates for instant feedback).
  ipcMain.handle('auth:validatePassword', async (_e, pwd: string) => validatePassword(pwd));

  ipcMain.handle('auth:getRemembered', async () => getRemembered());
  ipcMain.handle('auth:saveRemembered', async (_e, args: { username: string; password: string }) => {
    saveRemembered(args.username, args.password);
    return { ok: true };
  });
  ipcMain.handle('auth:clearRemembered', async () => {
    clearRemembered();
    return { ok: true };
  });
}
