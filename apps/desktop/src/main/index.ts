// Electron main entry (Quản Lý GLB). Security: contextIsolation on, nodeIntegration off, sandbox off
// (sandbox must be off so the preload can use ipcRenderer via require in electron-vite CJS preload).
import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { initDb } from './db.js';
import { registerIpc } from './ipc.js';
import * as auth from './auth-service.js';

const isDev = !app.isPackaged;

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#F4F6FA',
    title: 'Quản Lý GLB',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devUrl) {
    await win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  try {
    await initDb();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[main] DB init failed:', err);
  }
  registerIpc();

  // Headless smoke test (CI / audit): GLB_SELFTEST=1 exercises the real login path then exits.
  if (process.env['GLB_SELFTEST'] === '1') {
    await runSelfTest();
    app.exit(0);
    return;
  }
  // Phase B integration self-test: drives role/user/audit/backup services through the real DB.
  if (process.env['GLB_SELFTEST'] === '2') {
    const { runServiceSelfTest } = await import('./selftest-phaseb.js');
    const code = await runServiceSelfTest();
    app.exit(code);
    return;
  }

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function runSelfTest(): Promise<void> {
  const log = (o: unknown): void => console.log('SELFTEST ' + JSON.stringify(o));
  // 1) wrong password → deny, must not leak status
  const bad = await auth.login('adminroot', 'wrongpassword');
  log({ step: 'wrong_password', ok: bad.ok, error: bad.error });
  // 2) correct default admin → allow + mustChangePassword
  const good = await auth.login('adminroot', 'Admin@123456');
  log({
    step: 'admin_login',
    ok: good.ok,
    mustChange: good.mustChangePassword,
    roles: good.user?.roles,
    perms: good.user?.permissions.length
  });
  // 3) change password (then restore so the test is repeatable)
  const NEW = 'Glb@2026new';
  const chg = await auth.login && (await auth.changePassword('Admin@123456', NEW));
  log({ step: 'change_password', ok: chg?.ok, error: chg?.error });
  if (chg?.ok) {
    const restore = await auth.changePassword(NEW, 'Admin@123456');
    log({ step: 'restore_password', ok: restore.ok });
  }
  // 4) me() reflects logged-in user
  log({ step: 'me', user: auth.me()?.username ?? null });
}
