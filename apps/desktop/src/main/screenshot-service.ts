// Chụp VÙNG màn hình như Zalo (Mr.Long 15/7): mở overlay chọn vùng → cắt ảnh màn hình → lưu PNG → mở thư mục.
// Overlay = BrowserWindow trong suốt fullscreen; user kéo chọn hình chữ nhật; main dùng desktopCapturer cắt vùng đó.
import { BrowserWindow, desktopCapturer, ipcMain, screen, shell, app } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CaptureResult {
  ok: boolean;
  path?: string;
  dir?: string;
  error?: string;
  message?: string;
}

/** HTML overlay chọn vùng: nền mờ tối, kéo chuột vẽ khung sáng, thả → gửi toạ độ; Esc/chuột phải → hủy. */
function overlayHtml(): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;overflow:hidden;cursor:crosshair;user-select:none}
    #dim{position:fixed;inset:0;background:rgba(15,23,42,.35)}
    #sel{position:fixed;border:2px solid #2a72ef;background:rgba(42,114,239,.12);display:none;box-shadow:0 0 0 9999px rgba(15,23,42,.35)}
    #hint{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#0a1830;color:#fff;padding:6px 14px;border-radius:8px;font:600 13px/1 Segoe UI,Arial;box-shadow:0 4px 14px rgba(0,0,0,.3)}
  </style></head><body>
    <div id="dim"></div><div id="sel"></div>
    <div id="hint">Kéo chuột để chọn vùng chụp — Esc để hủy</div>
    <script>
      const { ipcRenderer } = require('electron');
      const sel = document.getElementById('sel');
      let sx=0, sy=0, drawing=false;
      addEventListener('mousedown', e => { if(e.button!==0)return; drawing=true; sx=e.clientX; sy=e.clientY; sel.style.display='block'; document.getElementById('dim').style.display='none'; });
      addEventListener('mousemove', e => { if(!drawing)return; const x=Math.min(sx,e.clientX), y=Math.min(sy,e.clientY), w=Math.abs(e.clientX-sx), h=Math.abs(e.clientY-sy); sel.style.left=x+'px'; sel.style.top=y+'px'; sel.style.width=w+'px'; sel.style.height=h+'px'; });
      addEventListener('mouseup', e => { if(!drawing)return; drawing=false; const x=Math.min(sx,e.clientX), y=Math.min(sy,e.clientY), w=Math.abs(e.clientX-sx), h=Math.abs(e.clientY-sy); if(w<4||h<4){ipcRenderer.send('screenshot:cancel');return;} ipcRenderer.send('screenshot:region',{x,y,w,h}); });
      addEventListener('keydown', e => { if(e.key==='Escape') ipcRenderer.send('screenshot:cancel'); });
      addEventListener('contextmenu', e => { e.preventDefault(); ipcRenderer.send('screenshot:cancel'); });
    </script></body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

/** Thư mục lưu ảnh chụp (Pictures/GLB-Screenshots). Trả đường dẫn. */
export function screenshotDir(): string {
  const dir = join(app.getPath('pictures'), 'GLB-Screenshots');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function captureRegion(opts?: { hideApp?: boolean }): Promise<CaptureResult> {
  const hideApp = opts?.hideApp === true;
  // Chế độ "ẩn app": giấu mọi cửa sổ GLB đang hiện rồi đợi compositor vẽ lại → ảnh chỉ còn màn hình/ứng dụng
  // phía sau (giống Zalo "thu nhỏ rồi chụp"). Khôi phục lại sau khi chụp xong (mọi nhánh return).
  const hidden = hideApp ? BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized()) : [];
  const restoreApp = (): void => { for (const w of hidden) { if (!w.isDestroyed()) w.show(); } };
  if (hidden.length) {
    for (const w of hidden) w.hide();
    await new Promise((r) => setTimeout(r, 280)); // đợi màn hình vẽ lại (app đã ẩn) trước khi phủ overlay + chụp
  }

  const display = screen.getPrimaryDisplay();
  const { x: dx, y: dy, width, height } = display.bounds;
  const scale = display.scaleFactor || 1;

  const overlay = new BrowserWindow({
    x: dx, y: dy, width, height,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, minimizable: false, maximizable: false,
    hasShadow: false, fullscreenable: false, enableLargerThanScreen: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true);

  const region = await new Promise<{ x: number; y: number; w: number; h: number } | null>((resolve) => {
    const fromOverlay = (e: { sender?: unknown }): boolean => !overlay.isDestroyed() && e?.sender === overlay.webContents;
    const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const onRegion = (e: { sender?: unknown }, r: { x: number; y: number; w: number; h: number }): void => {
      // audit 15/7 — chỉ nhận sự kiện TỪ cửa sổ overlay này + toạ độ phải là số hữu hạn (chống crop NaN / cửa sổ khác giả mạo kênh)
      if (!fromOverlay(e)) return;
      cleanup();
      if (!r || !finite(r.x) || !finite(r.y) || !finite(r.w) || !finite(r.h) || r.w < 1 || r.h < 1) { resolve(null); return; }
      resolve({ x: r.x, y: r.y, w: r.w, h: r.h });
    };
    const onCancel = (e: { sender?: unknown }): void => { if (!fromOverlay(e)) return; cleanup(); resolve(null); };
    const cleanup = (): void => { ipcMain.removeListener('screenshot:region', onRegion); ipcMain.removeListener('screenshot:cancel', onCancel); };
    ipcMain.on('screenshot:region', onRegion);
    ipcMain.on('screenshot:cancel', onCancel);
    void overlay.loadURL(overlayHtml());
  });
  if (overlay && !overlay.isDestroyed()) overlay.close();
  if (!region) { restoreApp(); return { ok: false, error: 'CANCELLED', message: 'Đã hủy chụp màn hình.' }; }

  try {
    // Chụp TOÀN màn hình ở độ phân giải vật lý rồi cắt vùng đã chọn (nhân scaleFactor).
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) } });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!source) return { ok: false, error: 'NO_SOURCE', message: 'Không lấy được ảnh màn hình.' };
    // Clamp vùng cắt vào trong kích thước ảnh thật (chống crop vượt biên → lỗi/ảnh rỗng).
    const size = source.thumbnail.getSize();
    const cx = Math.min(Math.max(0, Math.round(region.x * scale)), Math.max(0, size.width - 1));
    const cy = Math.min(Math.max(0, Math.round(region.y * scale)), Math.max(0, size.height - 1));
    const cropped = source.thumbnail.crop({
      x: cx,
      y: cy,
      width: Math.max(1, Math.min(Math.round(region.w * scale), size.width - cx)),
      height: Math.max(1, Math.min(Math.round(region.h * scale), size.height - cy))
    });
    const dir = screenshotDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = join(dir, `GLB_${stamp}.png`);
    writeFileSync(file, cropped.toPNG());
    void shell.showItemInFolder(file); // mở thư mục + chọn file vừa lưu (như Zalo)
    return { ok: true, path: file, dir };
  } catch (err) {
    return { ok: false, error: 'CAPTURE_FAILED', message: err instanceof Error ? err.message : String(err) };
  } finally {
    restoreApp(); // hiện lại app sau khi đã chụp xong (chế độ ẩn app)
  }
}

/** Mở thư mục ảnh chụp (nút "mở file lưu"). */
export async function openScreenshotDir(): Promise<CaptureResult> {
  const dir = screenshotDir();
  void shell.openPath(dir);
  return { ok: true, dir };
}
