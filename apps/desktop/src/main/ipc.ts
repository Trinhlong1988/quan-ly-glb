// IPC registration (main). Renderer never touches the DB — all DB work lives behind these handlers.
import { ipcMain } from 'electron';
import { validatePassword } from '@glb/shared';
import * as auth from './auth-service.js';
import * as roleSvc from './role-service.js';
import * as userSvc from './user-service.js';
import * as auditSvc from './audit-service.js';
import * as backupSvc from './backup-service.js';
import * as settingSvc from './settings-service.js';
import { getRemembered, saveRemembered, clearRemembered } from './remember.js';

export function registerIpc(): void {
  // ---- Auth (Phase A) ----------------------------------------------------
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
  ipcMain.handle('auth:changePassword', async (_e, args: { currentPassword: string; newPassword: string }) => {
    const { currentPassword, newPassword } = args ?? ({} as never);
    return auth.changePassword(currentPassword, newPassword);
  });
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

  // ---- Roles (Phase B, §8) ----------------------------------------------
  ipcMain.handle('role:list', async () => roleSvc.listRoles());
  ipcMain.handle('role:permissions', async () => roleSvc.listPermissions());
  ipcMain.handle('role:create', async (_e, input: roleSvc.RoleInput) => roleSvc.createRole(input));
  ipcMain.handle('role:update', async (_e, args: { id: number; input: roleSvc.RoleInput }) =>
    roleSvc.updateRole(args.id, args.input)
  );
  ipcMain.handle('role:lock', async (_e, id: number) => roleSvc.lockRole(id));
  ipcMain.handle('role:unlock', async (_e, id: number) => roleSvc.unlockRole(id));
  ipcMain.handle('role:delete', async (_e, args: { id: number; password: string }) =>
    roleSvc.deleteRole(args.id, args.password)
  );

  // ---- Users (Phase B, §9/§11/§12) --------------------------------------
  ipcMain.handle('user:list', async (_e, filter: userSvc.UserFilter) => userSvc.listUsers(filter));
  ipcMain.handle('user:create', async (_e, input: userSvc.CreateUserInput) => userSvc.createUser(input));
  ipcMain.handle('user:update', async (_e, args: { id: number; input: userSvc.UpdateUserInput }) =>
    userSvc.updateUser(args.id, args.input)
  );
  ipcMain.handle('user:lock', async (_e, id: number) => userSvc.lockUser(id));
  ipcMain.handle('user:unlock', async (_e, id: number) => userSvc.unlockUser(id));
  ipcMain.handle('user:delete', async (_e, args: { id: number; password: string }) =>
    userSvc.deleteUser(args.id, args.password)
  );

  // ---- Audit (Phase B, §16) ---------------------------------------------
  ipcMain.handle('audit:list', async (_e, query: auditSvc.AuditQuery) => auditSvc.listAudit(query));

  // ---- Backup / Restore (Phase B, §17) ----------------------------------
  ipcMain.handle('backup:create', async (_e, note?: string) => backupSvc.createBackup(note));
  ipcMain.handle('backup:list', async () => backupSvc.listBackups());
  ipcMain.handle('backup:restore', async (_e, args: { filePath: string; password: string }) =>
    backupSvc.restoreBackup(args.filePath, args.password)
  );

  // ---- Settings (Phase B) ------------------------------------------------
  ipcMain.handle('setting:list', async () => settingSvc.listSettings());
  ipcMain.handle('setting:update', async (_e, args: { key: string; value: string }) =>
    settingSvc.updateSetting(args.key, args.value)
  );
}
