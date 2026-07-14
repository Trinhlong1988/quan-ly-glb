// R42 — sinh bộ nhận diện cho app + bộ cài: icon.ico (shield xanh #1657d0 giống app) + header/sidebar BMP.
import { createRequire } from 'module';
const require = createRequire('D:/TT HKD AI/tools/globeway-renmap/');
const sharp = require('sharp');
const fs = require('fs');

const OUT = 'D:/TT HKD AI/tools/quan-ly-glb/apps/desktop/build';
const BRAND = '#1657d0', BRAND2 = '#1247ae';

// Chữ "G" kiểu Google (Mr.Long 14/7): vòng cung dày MỞ bên phải + thanh ngang (crossbar) — 1 màu.
// Toạ độ chuẩn viewBox 24 (tâm 12,12, bán kính 7) để dùng chung transform như trước.
const shieldPaths = (stroke, sw) =>
  `<path d="M18.58 14.39 A7 7 0 1 1 18.58 9.61" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="butt"/>` +
  `<path d="M12 12 H18.7" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="butt"/>`;

// ---- ICON 256 (ô bo góc xanh + shield trắng) ----
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="52" fill="${BRAND}"/>
  <g transform="translate(52,50) scale(6.33)">${shieldPaths('#ffffff', 3.2)}</g>
</svg>`;

function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const entries = []; const blobs = [];
  let offset = 6 + count * 16;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 0);
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.png.length, 8); e.writeUInt32LE(offset, 12);
    offset += img.png.length; entries.push(e); blobs.push(img.png);
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}
function rgbaToBmp24(width, height, rgba, bg = [255, 255, 255]) {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pix = rowSize * height;
  const buf = Buffer.alloc(54 + pix);
  buf.write('BM', 0); buf.writeUInt32LE(54 + pix, 2); buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14); buf.writeInt32LE(width, 18); buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pix, 34); buf.writeInt32LE(2835, 38); buf.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y; let p = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (srcY * width + x) * 4; const a = rgba[i + 3] / 255;
      buf[p++] = Math.round(rgba[i + 2] * a + bg[2] * (1 - a));
      buf[p++] = Math.round(rgba[i + 1] * a + bg[1] * (1 - a));
      buf[p++] = Math.round(rgba[i] * a + bg[0] * (1 - a));
    }
  }
  return buf;
}
const svgToPng = (svg, w, h) => sharp(Buffer.from(svg)).resize(w, h).png().toBuffer();
const svgToRgba = (svg, w, h) => sharp(Buffer.from(svg)).resize(w, h).ensureAlpha().raw().toBuffer();

// ---- HEADER 150x57 (logo nhỏ + chữ) ----
const headerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="#ffffff"/>
  <rect x="10" y="12" width="33" height="33" rx="8" fill="${BRAND}"/>
  <g transform="translate(15.5,17.5) scale(1.0)">${shieldPaths('#ffffff', 1.9)}</g>
  <text x="52" y="27" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="700" fill="${BRAND}">Quản Lý GLB</text>
  <text x="52" y="42" font-family="Segoe UI, Arial, sans-serif" font-size="8.5" fill="#64748b">Quản lý nội bộ GLOBEWAY</text>
</svg>`;

// ---- SIDEBAR 164x314 (nền xanh gradient + shield + tên) ----
const sidebarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${BRAND}"/><stop offset="1" stop-color="${BRAND2}"/></linearGradient></defs>
  <rect width="164" height="314" fill="url(#g)"/>
  <g transform="translate(52,70) scale(2.5)">${shieldPaths('#ffffff', 1.7)}</g>
  <text x="82" y="215" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="19" font-weight="700" fill="#ffffff">Quản Lý GLB</text>
  <text x="82" y="238" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="#dbe6fb">Hệ thống quản lý</text>
  <text x="82" y="253" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="#dbe6fb">nội bộ GLOBEWAY</text>
</svg>`;

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(sizes.map(async (s) => ({ size: s, png: await svgToPng(iconSvg, s, s) })));
fs.writeFileSync(`${OUT}/icon.ico`, buildIco(pngs));
fs.writeFileSync(`${OUT}/installerHeaderIcon.ico`, buildIco(pngs.filter((p) => p.size <= 64)));

const hb = await svgToRgba(headerSvg, 150, 57);
fs.writeFileSync(`${OUT}/installerHeader.bmp`, rgbaToBmp24(150, 57, hb, [255, 255, 255]));
const sb = await svgToRgba(sidebarSvg, 164, 314);
fs.writeFileSync(`${OUT}/installerSidebar.bmp`, rgbaToBmp24(164, 314, sb, [22, 87, 208]));
// electron-updater/uninstall dùng cùng sidebar.
fs.copyFileSync(`${OUT}/installerSidebar.bmp`, `${OUT}/uninstallerSidebar.bmp`);

console.log('WROTE assets:', fs.readdirSync(OUT).join(', '));
