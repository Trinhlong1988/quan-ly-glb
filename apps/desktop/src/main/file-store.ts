// Lưu file đính kèm ngoài DB (docs/FILE_UPLOAD_CONVENTION.md). DB chỉ giữ path tương đối + tên gốc
// + checksum. Ảnh vào <userData>/uploads/<loại>/<id>/. Thay ảnh cũ → chuyển uploads/_trash (R_AUDIT_TRAIL).
import { app } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, copyFileSync, renameSync, readFileSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.pdf']);
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf' };

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
  copyFileSync(srcAbsPath, destAbs);

  const buf = readFileSync(destAbs);
  const checksum = createHash('sha256').update(buf).digest('hex');
  const relPath = join(kind, String(id), fileName).replace(/\\/g, '/');
  return { ok: true, file: { relPath, fileName: basename(srcAbsPath), checksum, size: buf.length } };
}

/** Đọc file đã lưu → data URL để hiển thị trong renderer (sandbox không đọc fs trực tiếp). */
export function readAttachmentDataUrl(relPath: string): { ok: boolean; dataUrl?: string; error?: string; message?: string } {
  if (!relPath) return { ok: false, error: 'NO_PATH', message: 'Thiếu đường dẫn.' };
  // Chặn path traversal.
  if (relPath.includes('..')) return { ok: false, error: 'BAD_PATH', message: 'Đường dẫn không hợp lệ.' };
  const abs = join(uploadsRoot(), relPath);
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
