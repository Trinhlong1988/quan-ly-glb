// G11 — Cập nhật tích hợp — self-test (GLB_SELFTEST=23).
// Test THẬT bằng pure-unit + autoUpdater MOCK bơm vào (H3) — KHÔNG cần app đóng gói/mạng/DB (M3).
// 6 ca a–f theo spec §5.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdtempSync } from 'node:fs';
import {
  isNewer,
  evalMarker,
  writeMarker,
  readMarker,
  startUpdater,
  type UpdaterLike,
  type WindowLike
} from './update-service.js';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++;
  else fail++;
  // eslint-disable-next-line no-console
  console.log(`UPDATE23 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

/** Updater giả: ghi lại lời gọi + giữ handler để bắn sự kiện thủ công. */
function makeMockUpdater(opts: { checkThrows?: boolean } = {}): UpdaterLike & {
  handlers: Record<string, (...a: unknown[]) => void>;
  calls: { check: number; download: number; quit: Array<[unknown, unknown]> };
  emit: (event: string, payload?: unknown) => void;
} {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const calls = { check: 0, download: 0, quit: [] as Array<[unknown, unknown]> };
  return {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    handlers,
    calls,
    on(event: string, listener: (...a: unknown[]) => void) {
      handlers[event] = listener;
      return this;
    },
    async checkForUpdates() {
      calls.check++;
      if (opts.checkThrows) throw new Error('net::ERR_CONNECTION_REFUSED');
      return null;
    },
    async downloadUpdate() {
      calls.download++;
      return null;
    },
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) {
      calls.quit.push([isSilent, isForceRunAfter]);
    },
    emit(event: string, payload?: unknown) {
      handlers[event]?.(payload);
    }
  };
}

const nullWindow = (): WindowLike | null => null;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runUpdateSelfTest(): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'glb-upd-'));
  const markerFile = join(dir, 'update-result.json');

  // ═══ (a) dev-guard: isPackaged=false → updater KHÔNG khởi động ═══
  {
    const m = makeMockUpdater();
    const ctrl = startUpdater({ updater: m, getWindow: nullWindow, isPackaged: false });
    await ctrl.check();
    await ctrl.start();
    ok('(a) dev-guard: checkForUpdates KHÔNG được gọi', m.calls.check === 0, m.calls);
    ok('(a) dev-guard: downloadUpdate KHÔNG được gọi', m.calls.download === 0);
    ok('(a) dev-guard: KHÔNG đăng ký event nào', Object.keys(m.handlers).length === 0);
    ok('(a) dev-guard: autoDownload KHÔNG bị đụng (updater không cấu hình)', m.autoDownload === true);
    ok('(a) dev-guard: isDownloading=false', ctrl.isDownloading() === false);
  }

  // ═══ (b) isNewer semver (KHÔNG so chuỗi) ═══
  ok("(b) isNewer('0.1.9','0.1.10')=true (semver)", isNewer('0.1.9', '0.1.10') === true);
  ok("(b) isNewer('0.1.0','0.1.0')=false", isNewer('0.1.0', '0.1.0') === false);
  ok("(b) isNewer('0.2.0','0.1.10')=false (không hạ cấp)", isNewer('0.2.0', '0.1.10') === false);
  ok("(b) isNewer('0.1.9','0.2.0')=true", isNewer('0.1.9', '0.2.0') === true);
  ok("(b) so chuỗi thô SẼ sai: '0.1.10' < '0.1.9' theo chuỗi nhưng isNewer=true", '0.1.10' < '0.1.9' && isNewer('0.1.9', '0.1.10'));

  // ═══ (c) offline-safe: checkForUpdates ném lỗi → startUpdater/check KHÔNG throw ═══
  {
    const m = makeMockUpdater({ checkThrows: true });
    let threw = false;
    let ctrl;
    try {
      ctrl = startUpdater({ updater: m, getWindow: nullWindow, isPackaged: true, markerFile, intervalMs: 3_600_000 });
      await ctrl.check(); // gọi tường minh nhánh lỗi
    } catch {
      threw = true;
    }
    await sleep(0); // để void check() lúc init chạy xong
    ok('(c) offline-safe: startUpdater+check KHÔNG throw dù checkForUpdates lỗi', threw === false);
    ok('(c) offline-safe: checkForUpdates CÓ được gọi (và bị nuốt)', m.calls.check >= 1, m.calls);
    ok('(c) offline-safe: isDownloading vẫn false', ctrl?.isDownloading() === false);
    ctrl?.stop();
  }

  // ═══ (d) update-downloaded → installNow ghi marker + quitAndInstall(true,true) đúng 1 lần ═══
  {
    const m = makeMockUpdater();
    const ctrl = startUpdater({
      updater: m,
      getWindow: nullWindow,
      isPackaged: true,
      markerFile,
      currentVersion: '0.1.0',
      intervalMs: 3_600_000
    });
    ok('(d) wiring: autoDownload=false sau start', m.autoDownload === false);
    ok('(d) wiring: autoInstallOnAppQuit=true', m.autoInstallOnAppQuit === true);
    m.emit('update-downloaded', { version: '0.1.10' });
    ctrl.installNow();
    ctrl.installNow(); // gọi lần 2 → phải bị chặn (đúng 1 lần).
    ok('(d) quitAndInstall gọi ĐÚNG 1 lần', m.calls.quit.length === 1, m.calls.quit);
    ok('(d) quitAndInstall(true,true) — H1 isSilent+forceRunAfter', m.calls.quit[0]?.[0] === true && m.calls.quit[0]?.[1] === true);
    const mk = readMarker(markerFile);
    ok('(d) marker ghi targetVersion đúng', mk?.targetVersion === '0.1.10', mk);
    ok('(d) marker ghi fromVersion đúng', mk?.fromVersion === '0.1.0', mk);
    ctrl.stop();
  }

  // ═══ (e) evalMarker: khớp→success+xoá; lệch→failed+xoá (H4); JSON hỏng→none (M6) ═══
  {
    writeMarker({ targetVersion: '0.1.10', fromVersion: '0.1.9', startedAt: 'x' }, markerFile);
    const r1 = evalMarker('0.1.10', markerFile);
    ok('(e) khớp target → success', r1.kind === 'success' && r1.version === '0.1.10', r1);
    ok('(e) success → XOÁ marker (H4)', existsSync(markerFile) === false);

    writeMarker({ targetVersion: '0.1.10', fromVersion: '0.1.9', startedAt: 'x' }, markerFile);
    const r2 = evalMarker('0.1.9', markerFile);
    ok('(e) lệch target (cài hỏng) → failed', r2.kind === 'failed' && r2.kind === 'failed' && r2.targetVersion === '0.1.10', r2);
    ok('(e) failed → XOÁ marker (H4 — không báo đỏ vô hạn)', existsSync(markerFile) === false);

    // JSON hỏng → none, KHÔNG throw (M6).
    const { writeFileSync } = await import('node:fs');
    writeFileSync(markerFile, '{ this is not json', 'utf8');
    let threw = false;
    let r3;
    try {
      r3 = evalMarker('0.1.10', markerFile);
    } catch {
      threw = true;
    }
    ok('(e) JSON hỏng → KHÔNG throw', threw === false);
    ok('(e) JSON hỏng → none', r3?.kind === 'none', r3);
    ok('(e) JSON hỏng → dọn file hỏng', existsSync(markerFile) === false);

    // Không có marker → none.
    ok('(e) không marker → none', evalMarker('0.1.10', markerFile).kind === 'none');
  }

  // ═══ (f) stuck-state: sau update-error isDownloading=false → start lại được; đang tải → bỏ qua (M4) ═══
  {
    const m = makeMockUpdater();
    const ctrl = startUpdater({ updater: m, getWindow: nullWindow, isPackaged: true, markerFile, intervalMs: 3_600_000 });
    await ctrl.start();
    ok('(f) start lần 1 → downloadUpdate gọi (count=1)', m.calls.download === 1, m.calls);
    ok('(f) đang tải → isDownloading=true', ctrl.isDownloading() === true);
    await ctrl.start(); // đang tải → bỏ qua [M4]
    ok('(f) start lần 2 khi đang tải → BỎ QUA (vẫn count=1)', m.calls.download === 1, m.calls);
    m.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED')); // lỗi → cờ nhả
    ok('(f) sau lỗi → isDownloading=false', ctrl.isDownloading() === false);
    await ctrl.start(); // retry được [Cập nhật lại]
    ok('(f) retry sau lỗi → downloadUpdate gọi lại (count=2)', m.calls.download === 2, m.calls);
    ctrl.stop();
  }

  // ═══ (g) [H2b] getLastAvailable PULL — 'update-available' KHÔNG rơi dù renderer/window chưa sẵn sàng ═══
  // Tái hiện đúng race Mr.Long báo (20/7): check() chạy xong TRƯỚC khi renderer mount → push
  // 'update-available' bắn vào getWindow()=null (renderer chưa có) → send() no-op im lặng. Trước fix,
  // banner mất VĨNH VIỄN tới lần check kế (60'). Sau fix: main giữ lastAvailable, renderer PULL lúc mount.
  {
    const m = makeMockUpdater();
    const ctrl = startUpdater({ updater: m, getWindow: nullWindow, isPackaged: true, markerFile, intervalMs: 3_600_000 });
    ok('(g) chưa có bản mới → getLastAvailable=null', ctrl.getLastAvailable() === null);
    m.emit('update-available', { version: '0.2.59' }); // window=null → send() rơi, giống renderer chưa mount
    ok(
      '(g) push rơi (window null) nhưng PULL vẫn thấy bản mới — chống race H2b',
      ctrl.getLastAvailable()?.version === '0.2.59',
      ctrl.getLastAvailable()
    );
    // "Mount" muộn (renderer mở app sau khi check() đã xong) — PULL vẫn trả đúng, không one-shot-tiêu-thụ.
    ok('(g) PULL lại lần 2 vẫn còn (không bị xoá sau đọc — khác boot marker)', ctrl.getLastAvailable()?.version === '0.2.59');
    ctrl.stop();
  }

  // eslint-disable-next-line no-console
  console.log(`UPDATE23 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
