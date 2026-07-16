// Lưu file đính kèm ngoài DB (docs/FILE_UPLOAD_CONVENTION.md). DB chỉ giữ path tương đối + tên gốc
// + checksum. Ảnh vào <userData>/uploads/<loại>/<id>/. Thay ảnh cũ → chuyển uploads/_trash (R_AUDIT_TRAIL).
import { app } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname, basename, resolve, sep } from 'node:path';

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.pdf']);
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf' };

// P2-02 (hardening 16/7): xác thực NỘI DUNG bằng magic-bytes, KHÔNG tin đuôi file — chống đổi tên .exe→.png rồi
// nhét vào kho ảnh. Trả họ định dạng thật ('png'|'jpg'|'pdf') hay null nếu không khớp chữ ký nào.
export function sniffFileType(buf: Buffer): 'png' | 'jpg' | 'pdf' | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d) return 'pdf'; // %PDF-
  return null;
}

/** Đuôi file thuộc họ định dạng nào (để so với magic-bytes). */
function extFamily(ext: string): 'png' | 'jpg' | 'pdf' | null {
  if (ext === '.png') return 'png';
  if (ext === '.jpg' || ext === '.jpeg') return 'jpg';
  if (ext === '.pdf') return 'pdf';
  return null;
}

export type AttachKind = 'receiveAccount' | 'dossier';
export type AttachSide = 'cccdFront' | 'cccdBack' | 'dkkdFront' | 'dkkdBack';

/** Nhãn tên file theo chuẩn (docs/FILE_UPLOAD_CONVENTION.md). */
const SIDE_PREFIX: Record<AttachSide, string> = {
  cccdFront: '1. CCCD MT',
  cccdBack: '2. CCCD MS',
  dkkdFront: '1. ĐKKD MT',
  dkkdBack: '2. ĐKKD MS'
};

/** Thư mục gốc uploads (GLB_UPLOADS_DIR override cho self-test; mặc định cạnh userData). */
export function uploadsRoot(): string {
  const override = process.env['GLB_UPLOADS_DIR'];
  const root = override ? override : join(app.getPath('userData'), 'uploads');
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

/** Bỏ ký tự không hợp lệ trên Windows khỏi tên (giữ dấu tiếng Việt). */
function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface StoredFile {
  relPath: string;
  fileName: string;
  checksum: string;
  size: number;
}

export interface AttachResult {
  ok: boolean;
  error?: string;
  message?: string;
  file?: StoredFile;
}

/**
 * Sao chép file nguồn vào kho, đặt tên theo chuẩn. Trả path tương đối để lưu DB.
 * `ownerName` = tên chủ hộ (CCCD) hoặc tên HKD (ĐKKD).
 */
export function storeAttachment(kind: AttachKind, id: number, side: AttachSide, ownerName: string, srcAbsPath: string): AttachResult {
  if (!srcAbsPath || !existsSync(srcAbsPath)) return { ok: false, error: 'NO_FILE', message: 'Không tìm thấy file nguồn.' };
  const ext = extname(srcAbsPath).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return { ok: false, error: 'BAD_EXT', message: 'Chỉ nhận ảnh PNG, JPG hoặc PDF.' };

  // P2-02: đọc buffer nguồn 1 lần → xác thực magic-bytes khớp đuôi TRƯỚC khi nhận (không tin đuôi file).
  const buf = readFileSync(srcAbsPath);
  const sniff = sniffFileType(buf);
  if (sniff === null || sniff !== extFamily(ext)) {
    return { ok: false, error: 'BAD_CONTENT', message: 'Nội dung file không đúng định dạng PNG/JPG/PDF (đuôi file không khớp nội dung).' };
  }

  const dir = join(uploadsRoot(), kind, String(id));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const fileName = `${SIDE_PREFIX[side]} - ${sanitize(ownerName)}${ext}`;
  const destAbs = join(dir, fileName);

  // Thay ảnh cũ cùng mặt (nếu có) → _trash trước khi ghi đè.
  if (existsSync(destAbs)) {
    const trash = join(uploadsRoot(), '_trash', kind, String(id));
    if (!existsSync(trash)) mkdirSync(trash, { recursive: true });
    renameSync(destAbs, join(trash, `${Date.now()}_${fileName}`));
  }
  writeFileSync(destAbs, buf); // ghi từ buffer đã xác thực (thay copyFileSync — tránh đọc đĩa 2 lần)

  const checksum = createHash('sha256').update(buf).digest('hex');
  const relPath = join(kind, String(id), fileName).replace(/\\/g, '/');
  return { ok: true, file: { relPath, fileName: basename(srcAbsPath), checksum, size: buf.length } };
}

/** Đọc file đã lưu → data URL để hiển thị trong renderer (sandbox không đọc fs trực tiếp). */
export function readAttachmentDataUrl(relPath: string): { ok: boolean; dataUrl?: string; error?: string; message?: string } {
  if (!relPath) return { ok: false, error: 'NO_PATH', message: 'Thiếu đường dẫn.' };
  // R48 — Chặn path traversal TRIỆT ĐỂ: giải đường dẫn tuyệt đối và bắt buộc nằm TRONG uploadsRoot
  // (không dựa vào kiểm chuỗi '..' — chống cả ký hiệu tuyệt đối / symlink-escape / mã hóa lạ).
  const root = uploadsRoot();
  const abs = resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + sep)) return { ok: false, error: 'BAD_PATH', message: 'Đường dẫn không hợp lệ.' };
  if (!existsSync(abs)) return { ok: false, error: 'NOT_FOUND', message: 'File không còn tồn tại.' };
  const ext = extname(abs).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';
  const b64 = readFileSync(abs).toString('base64');
  return { ok: true, dataUrl: `data:${mime};base64,${b64}` };
}

/** Chuyển 1 file đã lưu vào _trash (không xóa cứng). */
export function trashAttachment(relPath: string): void {
  if (!relPath || relPath.includes('..')) return;
  const abs = join(uploadsRoot(), relPath);
  if (!existsSync(abs)) return;
  const trashDir = join(uploadsRoot(), '_trash');
  if (!existsSync(trashDir)) mkdirSync(trashDir, { recursive: true });
  renameSync(abs, join(trashDir, `${Date.now()}_${basename(abs)}`));
}

/** Kích thước file (byte) — tiện cho kiểm thử. */
export function fileSize(relPath: string): number {
  const abs = join(uploadsRoot(), relPath);
  return existsSync(abs) ? statSync(abs).size : 0;
}
