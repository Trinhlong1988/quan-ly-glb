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
  // Harness guard (B04, G10): self-test 2+ mutate the DB. Trên PostgreSQL mỗi selftest phải chạy trên
  // 1 DB throwaway RIÊNG (createdb → migrate deploy → drop) để không nhiễm DB dev/prod dùng chung.
  // Bắt buộc: GLB_DB_URL=postgresql://…<tmpdb> + GLB_ROLE=server (để initDb seed admin/permissions).
  const st = process.env['GLB_SELFTEST'];
  if (st && st !== '1' && !process.env['GLB_DB_URL']) {
    // eslint-disable-next-line no-console
    console.error(
      `SELFTEST${st} ABORT | phải set GLB_DB_URL trỏ tới DB PostgreSQL throwaway đã migrate ` +
        `+ GLB_ROLE=server. Ví dụ: createdb tmp; DATABASE_URL=postgresql://…/tmp prisma migrate deploy; ` +
        `GLB_SELFTEST=${st} GLB_ROLE=server GLB_DB_URL=postgresql://…/tmp electron apps/desktop; dropdb tmp.`
    );
    app.exit(2);
    return;
  }
  if (st && st !== '1' && process.env['GLB_ROLE'] !== 'server') {
    // eslint-disable-next-line no-console
    console.error(
      `SELFTEST${st} ABORT | thiếu GLB_ROLE=server → initDb sẽ KHÔNG seed (admin/permissions rỗng) ` +
        `và selftest fail ở bước đăng nhập. Đặt GLB_ROLE=server khi chạy selftest.`
    );
    app.exit(2);
    return;
  }
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
  // G-POS.1 integration self-test: customer/POS/TID/code services + event log.
  if (process.env['GLB_SELFTEST'] === '3') {
    const { runGposSelfTest } = await import('./selftest-gpos.js');
    const code = await runGposSelfTest();
    app.exit(code);
    return;
  }
  // G-CFG.1 Cấu hình ngân hàng self-test: 50 đúng + 50 sai (Ngân hàng/Loại thẻ/Đối tác + liên kết).
  if (process.env['GLB_SELFTEST'] === '4') {
    const { runBankConfigSelfTest } = await import('./selftest-gcfg.js');
    const code = await runBankConfigSelfTest();
    app.exit(code);
    return;
  }
  // G-CFG.2 Cấu hình cung ứng POS self-test: 50 đúng + 50 sai (NCC/chủng loại/nhập kho).
  if (process.env['GLB_SELFTEST'] === '5') {
    const { runPosSupplySelfTest } = await import('./selftest-gcfg2.js');
    const code = await runPosSupplySelfTest();
    app.exit(code);
    return;
  }
  // G-CFG.3 Cấu hình phí self-test: 50 đúng + 50 sai (loại phí + biểu phí % + chênh lệch).
  if (process.env['GLB_SELFTEST'] === '7') {
    const { runFeeConfigSelfTest } = await import('./selftest-gcfg3.js');
    const code = await runFeeConfigSelfTest();
    app.exit(code);
    return;
  }
  if (process.env['GLB_SELFTEST'] === '8') {
    const { runReceiveAccountSelfTest } = await import('./selftest-gcfg4.js');
    const code = await runReceiveAccountSelfTest();
    app.exit(code);
    return;
  }
  if (process.env['GLB_SELFTEST'] === '9') {
    const { runDossierSelfTest } = await import('./selftest-gcfg5.js');
    const code = await runDossierSelfTest();
    app.exit(code);
    return;
  }
  if (process.env['GLB_SELFTEST'] === '10') {
    const { runTidConfigSelfTest } = await import('./selftest-gcfg6.js');
    const code = await runTidConfigSelfTest();
    app.exit(code);
    return;
  }
  // E4 Thùng rác self-test: 50 đúng + 50 sai (soft-delete → trash → restore + link warning).
  if (process.env['GLB_SELFTEST'] === '6') {
    const { runTrashSelfTest } = await import('./selftest-trash.js');
    const code = await runTrashSelfTest();
    app.exit(code);
    return;
  }
  // Nhóm A Bảo mật & tài khoản self-test: khóa 5 lần + reset đếm + đổi/đặt lại mật khẩu + hòm thư.
  if (process.env['GLB_SELFTEST'] === '11') {
    const { runNhomASelfTest } = await import('./selftest-nhoma.js');
    const code = await runNhomASelfTest();
    app.exit(code);
    return;
  }
  // Nhóm A #3 self-test: pass cấp 2 (đặt/đổi/khóa) + xóa vĩnh viễn + dọn sạch thùng rác.
  if (process.env['GLB_SELFTEST'] === '12') {
    const { runNhomA2SelfTest } = await import('./selftest-nhoma2.js');
    const code = await runNhomA2SelfTest();
    app.exit(code);
    return;
  }
  // Nhóm A #4 self-test: thùng rác per-user (deletedBy scope) + tên người xóa.
  if (process.env['GLB_SELFTEST'] === '13') {
    const { runNhomA3SelfTest } = await import('./selftest-nhoma3.js');
    const code = await runNhomA3SelfTest();
    app.exit(code);
    return;
  }
  // Nhóm B self-test: dashboard stats (KPI + tăng trưởng + bộ đếm theo chiều).
  if (process.env['GLB_SELFTEST'] === '14') {
    const { runDashboardSelfTest } = await import('./selftest-dashboard.js');
    const code = await runDashboardSelfTest();
    app.exit(code);
    return;
  }
  if (process.env['GLB_SELFTEST'] === '15') {
    const { runRevenueSelfTest } = await import('./selftest-revenue.js');
    const code = await runRevenueSelfTest();
    app.exit(code);
    return;
  }
  if (process.env['GLB_SELFTEST'] === '16') {
    const { runStorageSelfTest } = await import('./selftest-storage.js');
    const code = await runStorageSelfTest();
    app.exit(code);
    return;
  }
  if (process.env['GLB_SELFTEST'] === '17') {
    const { runHealthScanSelfTest } = await import('./selftest-healthscan.js');
    const code = await runHealthScanSelfTest();
    app.exit(code);
    return;
  }
  if (process.env['GLB_SELFTEST'] === '18') {
    const { runApprovalSelfTest } = await import('./selftest-approval.js');
    const code = await runApprovalSelfTest();
    app.exit(code);
    return;
  }
  // F-NOTIF self-test: đẩy thông báo sự kiện hủy bill vào hòm thư (đúng người nhận + idempotent).
  if (process.env['GLB_SELFTEST'] === '19') {
    const { runNotifySelfTest } = await import('./selftest-notify.js');
    const code = await runNotifySelfTest();
    app.exit(code);
    return;
  }
  // G10.5 stress-race tương tranh THẬT trên Postgres (=20): N client GHI ĐỒNG THỜI (Promise.all)
  // → guard G10.C phải giữ 1-winner; mã KH/NV không trùng. Đo bằng SELECT count/distinct DB thật.
  if (process.env['GLB_SELFTEST'] === '20') {
    const { runConcurrencySelfTest } = await import('./selftest-concurrency.js');
    const code = await runConcurrencySelfTest();
    app.exit(code);
    return;
  }
  // G10.C concurrency-correctness self-test (guard-logic tất định): conditional transition +
  // $transaction cho request/approve/reject (=21, race THẬT ở =20).
  if (process.env['GLB_SELFTEST'] === '21') {
    const { runGuardSelfTest } = await import('./selftest-guard.js');
    const code = await runGuardSelfTest();
    app.exit(code);
    return;
  }
  // G10.3 Cấu hình máy chủ self-test: testServerConfig (pg OK/lỗi) + validate gating +
  // saveServerConfig (ghi file round-trip + reinit) + getServerConfig phân loại trạng thái.
  if (process.env['GLB_SELFTEST'] === '22') {
    const { runServerConfigSelfTest } = await import('./selftest-servercfg.js');
    const code = await runServerConfigSelfTest();
    app.exit(code);
    return;
  }

  await createWindow();
  startHousekeeping();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Storage-Guard (Nhóm E): backup định kỳ 1 lần/ngày + kiểm tra ngưỡng bộ nhớ mỗi giờ.
// Chạy 1 lần khi khởi động, sau đó lặp mỗi giờ. Lỗi được nuốt để không làm sập app.
let housekeepingTimer: ReturnType<typeof setInterval> | undefined;
function startHousekeeping(): void {
  const tick = async (): Promise<void> => {
    try {
      const { getDb } = await import('./db.js');
      const { systemBackupIfDue, systemStorageCheck, systemWeeklyMaintenanceIfDue } = await import('./storage-service.js');
      const db = getDb();
      await systemBackupIfDue(db);
      await systemWeeklyMaintenanceIfDue(db);
      await systemStorageCheck(db);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[housekeeping] tick failed', err);
    }
  };
  void tick();
  if (housekeepingTimer) clearInterval(housekeepingTimer);
  housekeepingTimer = setInterval(() => void tick(), 60 * 60 * 1000);
}

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
