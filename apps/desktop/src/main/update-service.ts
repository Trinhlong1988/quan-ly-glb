// G11 — Cập nhật phần mềm tích hợp (electron-updater qua LAN).
// Luồng Mr.Long chốt: push "có bản mới" → user xác nhận → tải (thanh %) → app tự thoát →
// cài im lặng (perUser) → tự mở lại → báo kết quả (marker).
//
// Nguyên tắc phản biện đã vá:
// - [H1] quitAndInstall(true, true): isSilent=true (cài IM, /S) + forceRunAfter=true (tự mở lại).
//         (false,true) sẽ BUNG wizard NSIS — SAI.
// - [H2] Trạng thái BOOT (success/failed) KHÔNG push (renderer chưa mount → rơi). Renderer PULL qua
//         update:getBootResult lúc mount. Cửa sổ tham chiếu qua getWindow() (index.ts giữ ref mainWindow).
// - [H3] Tách pure-unit (isNewer / marker RW / evalMarker) + cho INJECT autoUpdater (mock) qua startUpdater
//         → selftest=23 test THẬT không cần packaged/mạng.
// - [H4] Xoá marker ở CẢ nhánh success VÀ failed (không xoá nhánh failed = báo lỗi đỏ vô hạn).
// - [M4] cờ isDownloading chống double-download. [M6] JSON hỏng → coi none, KHÔNG throw.
// - offline-safe: check/download ném lỗi → nuốt trong try/catch, app vẫn chạy bình thường.
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { app, ipcMain } from 'electron';

// ── Kiểu ────────────────────────────────────────────────────────────────────
export interface UpdateMarker {
  targetVersion: string;
  fromVersion: string;
  startedAt: string;
}
export type BootResult =
  | { kind: 'success'; version: string; at: string }
  | { kind: 'failed'; fromVersion: string; targetVersion: string }
  | { kind: 'none' };

/** Bề mặt tối thiểu của electron-updater mà service dùng — cho phép bơm mock (H3). */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

/** Cửa sổ tối thiểu để gửi sự kiện realtime tới renderer. */
export interface WindowLike {
  isDestroyed(): boolean;
  webContents: { send(channel: string, payload: unknown): void };
}

export interface StartDeps {
  updater: UpdaterLike;
  getWindow: () => WindowLike | null;
  isPackaged: boolean;
  /** Ghi marker trước quitAndInstall. Mặc định userData/update-result.json. Cho selftest bơm file tạm. */
  markerFile?: string;
  /** Phiên bản hiện tại (app.getVersion). Dùng cho marker.fromVersion. */
  currentVersion?: string;
  /** Chu kỳ kiểm tra (ms). Mặc định 60 phút. */
  intervalMs?: number;
}

/** Điều khiển do startUpdater trả — IPC gọi vào + selftest kiểm cờ. */
export interface UpdaterController {
  check(): Promise<void>;
  start(): Promise<void>;
  installNow(): void;
  isDownloading(): boolean;
  /** Dừng interval (dọn tài nguyên; selftest). */
  stop(): void;
}

// ── Pure-unit: so sánh semver (H3, ca b) ─────────────────────────────────────
function parseSemver(v: string): number[] {
  // Bỏ tiền tố 'v' + phần prerelease/build; lấy major.minor.patch dạng số.
  const core = String(v).trim().replace(/^v/i, '').split(/[-+]/)[0];
  return core.split('.').map((x) => {
    const n = parseInt(x, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** True nếu `next` MỚI HƠN `cur` theo semver (0.1.10 > 0.1.9 — KHÔNG so chuỗi). */
export function isNewer(cur: string, next: string): boolean {
  const a = parseSemver(cur);
  const b = parseSemver(next);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (y > x) return true;
    if (y < x) return false;
  }
  return false;
}

// ── Pure-unit: marker read/write/eval (H3/H4, ca e; M6) ──────────────────────
/** Đường dẫn marker mặc định (userData/update-result.json). */
export function markerPath(): string {
  return join(app.getPath('userData'), 'update-result.json');
}

export function writeMarker(m: UpdateMarker, file: string = markerPath()): void {
  writeFileSync(file, JSON.stringify(m), 'utf8');
}

/** Đọc marker; trả null nếu không có / rỗng / JSON hỏng (M6 — KHÔNG throw). */
export function readMarker(file: string = markerPath()): UpdateMarker | null {
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, 'utf8');
    const m = JSON.parse(raw) as Partial<UpdateMarker>;
    if (!m || typeof m.targetVersion !== 'string' || !m.targetVersion) return null;
    return { targetVersion: m.targetVersion, fromVersion: String(m.fromVersion ?? ''), startedAt: String(m.startedAt ?? '') };
  } catch {
    return null;
  }
}

export function clearMarker(file: string = markerPath()): void {
  try {
    if (existsSync(file)) rmSync(file, { force: true });
  } catch {
    /* nuốt — không để việc dọn marker làm sập khởi động */
  }
}

/**
 * Đánh giá marker lúc khởi động rồi XOÁ (H4 — cả success VÀ failed).
 * - Không có marker / JSON hỏng → none (M6, KHÔNG throw), dọn file hỏng nếu có.
 * - curVersion === targetVersion → success (bước 6).
 * - khác → failed (bước 7 + [Cập nhật lại]).
 */
export function evalMarker(curVersion: string, file: string = markerPath()): BootResult {
  if (!existsSync(file)) return { kind: 'none' };
  const m = readMarker(file);
  // marker hỏng/không hợp lệ → dọn + none.
  if (!m) {
    clearMarker(file);
    return { kind: 'none' };
  }
  clearMarker(file); // H4: xoá NGAY sau khi đọc, ở MỌI nhánh.
  if (curVersion === m.targetVersion) {
    return { kind: 'success', version: curVersion, at: new Date().toISOString() };
  }
  return { kind: 'failed', fromVersion: m.fromVersion || curVersion, targetVersion: m.targetVersion };
}

// ── Diễn giải lỗi người-đọc-được (offline-safe message) ──────────────────────
export function humanizeUpdateError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const raw = (e?.message ?? String(err)) || 'Lỗi không xác định';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) return 'Không tìm thấy máy chủ cập nhật (kiểm tra kết nối mạng LAN).';
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|net::|ENETUNREACH/i.test(raw)) return 'Không kết nối được máy chủ cập nhật (server tắt hoặc mất mạng).';
  if (/ENOSPC/i.test(raw)) return 'Ổ đĩa không đủ dung lượng để tải bản cập nhật.';
  if (/sha512|checksum|integrity/i.test(raw)) return 'File cập nhật tải về bị hỏng (sai mã kiểm tra). Vui lòng thử lại.';
  return 'Cập nhật lỗi: ' + raw;
}

// ── startUpdater: DI updater (H3) + dev-guard (ca a) ──────────────────────────
export function startUpdater(deps: StartDeps): UpdaterController {
  const noop: UpdaterController = {
    check: async () => {},
    start: async () => {},
    installNow: () => {},
    isDownloading: () => false,
    stop: () => {}
  };
  // [dev-guard] KHÔNG đóng gói → KHÔNG khởi động updater (tránh crash dev/selftest). (ca a)
  if (!deps.isPackaged) return noop;

  const { updater, getWindow } = deps;
  const marker = deps.markerFile ?? markerPath();
  const currentVersion = deps.currentVersion ?? '0.0.0';
  const intervalMs = deps.intervalMs ?? 60 * 60 * 1000;

  let downloading = false;
  let installing = false;
  let pendingVersion: string | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const send = (channel: string, payload: unknown): void => {
    const w = getWindow();
    if (w && !w.isDestroyed()) {
      try {
        w.webContents.send(channel, payload);
      } catch {
        /* cửa sổ có thể đã đóng — bỏ qua */
      }
    }
  };

  updater.autoDownload = false; // no-auto-without-consent — chỉ tải khi user bấm.
  updater.autoInstallOnAppQuit = true;

  updater.on('update-available', (info: unknown) => {
    const version = (info as { version?: string })?.version ?? '';
    send('update-available', { version });
  });
  updater.on('download-progress', (p: unknown) => {
    const percent = (p as { percent?: number })?.percent ?? 0;
    send('download-progress', { percent });
  });
  updater.on('update-downloaded', (info: unknown) => {
    pendingVersion = (info as { version?: string })?.version ?? pendingVersion;
    send('update-downloaded', { version: pendingVersion ?? '' });
  });
  updater.on('error', (err: unknown) => {
    downloading = false; // [M4/f] cho phép retry sau lỗi (không kẹt cờ).
    send('update-error', { message: humanizeUpdateError(err) });
  });

  const check = async (): Promise<void> => {
    // offline-safe: server không với tới → nuốt lỗi, KHÔNG throw, KHÔNG popup.
    try {
      await updater.checkForUpdates();
    } catch {
      /* im lặng — app vẫn chạy bình thường */
    }
  };

  const start = async (): Promise<void> => {
    if (downloading) return; // [M4] đang tải → bỏ qua, không gọi downloadUpdate 2 lần.
    downloading = true;
    try {
      await updater.downloadUpdate();
    } catch (err) {
      downloading = false; // cho phép [Cập nhật lại].
      send('update-error', { message: humanizeUpdateError(err) });
    }
  };

  const installNow = (): void => {
    if (installing) return; // gọi 1 lần (ca d).
    installing = true;
    try {
      writeMarker({ targetVersion: pendingVersion ?? '', fromVersion: currentVersion, startedAt: new Date().toISOString() }, marker);
    } catch {
      /* không ghi được marker vẫn tiếp tục cài — chỉ mất thông báo kết quả */
    }
    // [H1] isSilent=true (cài IM), forceRunAfter=true (tự mở lại).
    updater.quitAndInstall(true, true);
  };

  // Kiểm tra lúc "ready" + định kỳ mỗi 60' (bọc try/catch trong check()).
  void check();
  timer = setInterval(() => void check(), intervalMs);
  if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref: () => void }).unref();

  return {
    check,
    start,
    installNow,
    isDownloading: () => downloading,
    stop: () => {
      if (timer) clearInterval(timer);
    }
  };
}

// ── Wiring cho app path bình thường (index.ts gọi) ───────────────────────────
export interface RegisterDeps {
  getWindow: () => WindowLike | null;
  isPackaged: boolean;
  version: string;
}

let registered = false;

/**
 * Khởi tạo dịch vụ cập nhật cho app path bình thường:
 * - Đánh giá marker lúc boot → bootResult (in-memory) cho renderer PULL (H2).
 * - Đăng ký IPC: update:check/start/installNow/getBootResult + app:getVersion.
 * - Nếu đóng gói: nạp electron-updater (externalized, dynamic require — L1) + startUpdater.
 */
export async function registerUpdateService(deps: RegisterDeps): Promise<void> {
  if (registered) return;
  registered = true;

  const bootResult = evalMarker(deps.version); // đánh giá + xoá marker NGAY (H4).
  let bootConsumed = false;

  let controller: UpdaterController;
  if (deps.isPackaged) {
    let updater: UpdaterLike;
    try {
      const mod = (await import('electron-updater')) as unknown as { autoUpdater: UpdaterLike };
      updater = mod.autoUpdater;
    } catch (err) {
      // Không nạp được electron-updater → app vẫn chạy (offline-safe cực đoan).
      // eslint-disable-next-line no-console
      console.error('[update] không nạp được electron-updater:', err);
      controller = startUpdater({ updater: dummyUpdater(), getWindow: deps.getWindow, isPackaged: false });
      wireIpc();
      return;
    }
    controller = startUpdater({
      updater,
      getWindow: deps.getWindow,
      isPackaged: true,
      currentVersion: deps.version
    });
  } else {
    controller = startUpdater({ updater: dummyUpdater(), getWindow: deps.getWindow, isPackaged: false });
  }
  wireIpc();

  function wireIpc(): void {
    ipcMain.handle('update:check', async () => controller.check());
    ipcMain.handle('update:start', async () => controller.start());
    ipcMain.handle('update:installNow', async () => controller.installNow());
    ipcMain.handle('update:getBootResult', async () => {
      // Pull 1 lần (H2). Lấy xong đánh dấu đã-tiêu-thụ.
      if (bootConsumed) return null;
      bootConsumed = true;
      return bootResult.kind === 'none' ? null : bootResult;
    });
    ipcMain.handle('app:getVersion', async () => deps.version);
  }
}

/** Updater rỗng (dev / không nạp được electron-updater) — mọi thao tác no-op. */
function dummyUpdater(): UpdaterLike {
  return {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    on: () => undefined,
    checkForUpdates: async () => null,
    downloadUpdate: async () => null,
    quitAndInstall: () => {}
  };
}
