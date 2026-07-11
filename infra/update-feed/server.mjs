#!/usr/bin/env node
// GLB Update Feed — HTTP tĩnh phục vụ electron-updater (G11 §3, LEAD infra).
// Phục vụ D:\glb-updates\ tại URL http://192.168.1.6:8686/updates/  (khớp publish.url electron-builder.yml).
//   GET /updates/latest.yml            → D:\glb-updates\latest.yml
//   GET /updates/glb-<ver>-setup.exe   → D:\glb-updates\glb-<ver>-setup.exe   (+ .blockmap)
// Node thuần (KHÔNG thêm dependency). Hỗ trợ Range (206) — electron-updater tải blockmap/exe theo range
// cho differential download; server thiếu Range sẽ gãy cập nhật gia tăng.
//
// Chạy:   node infra/update-feed/server.mjs
// Env:    GLB_FEED_DIR (mặc định D:\glb-updates) · GLB_FEED_PORT (8686) · GLB_FEED_HOST (0.0.0.0)
// An ninh (M7 — rủi ro CHẤP NHẬN CÓ CHỦ ĐÍCH): feed nội bộ không auth + exe chưa ký. Giảm thiểu:
// chỉ LEAD ghi D:\glb-updates (ACL) + firewall chỉ LAN 192.168.1.0/24. Server này CHỈ đọc (GET/HEAD),
// từ chối mọi method khác + chống path traversal.

import http from 'node:http';
import { createReadStream, promises as fs, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FEED_DIR = path.resolve(process.env.GLB_FEED_DIR || 'D:\\glb-updates');
const PORT = Number(process.env.GLB_FEED_PORT || 8686);
const HOST = process.env.GLB_FEED_HOST || '0.0.0.0';
const URL_PREFIX = '/updates/';

const CONTENT_TYPES = {
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8'
};

function log(...a) {
  // eslint-disable-next-line no-console
  console.log(new Date().toISOString(), ...a);
}

/** Map URL an toàn → file trong FEED_DIR. Trả null nếu ngoài phạm vi (chống traversal). */
function resolveSafe(urlPath) {
  const rel = decodeURIComponent(urlPath.slice(URL_PREFIX.length));
  if (!rel || rel.endsWith('/')) return null;
  const full = path.resolve(FEED_DIR, rel);
  const base = FEED_DIR.endsWith(path.sep) ? FEED_DIR : FEED_DIR + path.sep;
  if (full !== FEED_DIR && !full.startsWith(base)) return null; // ngoài FEED_DIR
  return full;
}

async function listFeed() {
  try {
    const files = await fs.readdir(FEED_DIR);
    return files.filter((f) => !f.startsWith('.'));
  } catch {
    return [];
  }
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const url = (req.url || '/').split('?')[0];

  // Health / trang chủ — liệt kê nội dung feed (không phải file phục vụ).
  if (url === '/' || url === '/health') {
    const files = await listFeed();
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`GLB Update Feed OK\ndir: ${FEED_DIR}\nprefix: ${URL_PREFIX}\nfiles:\n` + (files.length ? files.map((f) => '  - ' + f).join('\n') : '  (trống — chưa phát hành bản nào)') + '\n');
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('405 Method Not Allowed');
    log(method, url, '→ 405');
    return;
  }

  if (!url.startsWith(URL_PREFIX)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found (feed phục vụ dưới ' + URL_PREFIX + ')');
    log(method, url, '→ 404 (sai prefix)');
    return;
  }

  const filePath = resolveSafe(url);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    log(method, url, '→ 403 (traversal/rỗng)');
    return;
  }

  let st;
  try {
    st = statSync(filePath);
    if (!st.isFile()) throw new Error('not a file');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    log(method, url, '→ 404 (không có file)');
    return;
  }

  const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const total = st.size;
  const range = req.headers.range;

  // Range request (206) — electron-updater dùng cho differential download.
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] === '' ? undefined : Number(m[1]);
      let end = m[2] === '' ? undefined : Number(m[2]);
      if (start === undefined && end !== undefined) {
        // suffix: last N bytes
        start = Math.max(0, total - end);
        end = total - 1;
      } else {
        if (start === undefined) start = 0;
        if (end === undefined || end >= total) end = total - 1;
      }
      if (start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        log(method, url, `→ 416 (range ${range})`);
        return;
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Cache-Control': 'no-cache'
      });
      if (method === 'HEAD') { res.end(); log('HEAD', url, `206 ${start}-${end}/${total}`); return; }
      createReadStream(filePath, { start, end }).pipe(res);
      log('GET', url, `→ 206 ${start}-${end}/${total}`);
      return;
    }
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': total,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache'
  });
  if (method === 'HEAD') { res.end(); log('HEAD', url, `200 ${total}b`); return; }
  createReadStream(filePath).pipe(res);
  log('GET', url, `→ 200 ${total}b`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log(`LỖI: cổng ${PORT} đang bận. Kiểm tra tiến trình khác hoặc đổi GLB_FEED_PORT.`);
  } else {
    log('LỖI server:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log(`GLB Update Feed nghe ${HOST}:${PORT} → ${FEED_DIR} (prefix ${URL_PREFIX})`);
  log(`Client feed URL: http://192.168.1.6:${PORT}${URL_PREFIX}latest.yml`);
});

// Giữ tham chiếu __filename cho rõ ràng (tránh cảnh báo lint unused import trong vài cấu hình).
void fileURLToPath(import.meta.url);
