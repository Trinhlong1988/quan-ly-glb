// Preload — the ONLY bridge between renderer and main. Exposes a typed `window.api`.
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Auth
  login: (username: string, password: string, remember: boolean) =>
    ipcRenderer.invoke('auth:login', { username, password, remember }),
  me: () => ipcRenderer.invoke('auth:me'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    ipcRenderer.invoke('auth:changePassword', { currentPassword, newPassword }),
  validatePassword: (pwd: string) => ipcRenderer.invoke('auth:validatePassword', pwd),
  getRemembered: () => ipcRenderer.invoke('auth:getRemembered'),
  saveRemembered: (username: string, password: string) =>
    ipcRenderer.invoke('auth:saveRemembered', { username, password }),
  clearRemembered: () => ipcRenderer.invoke('auth:clearRemembered'),

  // Roles
  roleList: () => ipcRenderer.invoke('role:list'),
  rolePermissions: () => ipcRenderer.invoke('role:permissions'),
  roleCreate: (input: unknown) => ipcRenderer.invoke('role:create', input),
  roleUpdate: (id: number, input: unknown) => ipcRenderer.invoke('role:update', { id, input }),
  roleLock: (id: number) => ipcRenderer.invoke('role:lock', id),
  roleUnlock: (id: number) => ipcRenderer.invoke('role:unlock', id),
  roleDelete: (id: number, password: string) => ipcRenderer.invoke('role:delete', { id, password }),

  // Users
  userList: (filter: unknown) => ipcRenderer.invoke('user:list', filter),
  userCreate: (input: unknown) => ipcRenderer.invoke('user:create', input),
  userUpdate: (id: number, input: unknown) => ipcRenderer.invoke('user:update', { id, input }),
  userLock: (id: number) => ipcRenderer.invoke('user:lock', id),
  userUnlock: (id: number) => ipcRenderer.invoke('user:unlock', id),
  userDelete: (id: number, password: string) => ipcRenderer.invoke('user:delete', { id, password }),

  // Audit
  auditList: (query: unknown) => ipcRenderer.invoke('audit:list', query),

  // Backup / Restore
  backupCreate: (note?: string) => ipcRenderer.invoke('backup:create', note),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupRestore: (filePath: string, password: string) =>
    ipcRenderer.invoke('backup:restore', { filePath, password }),

  // Settings
  settingList: () => ipcRenderer.invoke('setting:list'),
  settingUpdate: (key: string, value: string) => ipcRenderer.invoke('setting:update', { key, value })
};

export type GlbApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
