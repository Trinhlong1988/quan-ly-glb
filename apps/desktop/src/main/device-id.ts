// R48 Pha 2 — GUID nhận diện thiết bị, BỀN theo 1 CÀI ĐẶT (lưu userData). Sinh trong MAIN (renderer KHÔNG
// điều khiển được) → dùng làm KHÓA same-device cho single-session, chống giả mạo hostname (os.hostname đổi tùy ý).
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let cached: string | null = null;

export function deviceId(): string {
  if (cached) return cached;
  try {
    const p = join(app.getPath('userData'), 'device-id.txt');
    if (existsSync(p)) cached = (readFileSync(p, 'utf8').trim() || null);
    if (!cached) {
      cached = randomUUID();
      writeFileSync(p, cached, 'utf8');
    }
  } catch {
    cached = cached ?? randomUUID(); // không ghi được đĩa → GUID tạm trong bộ nhớ (vẫn ổn định trong phiên app)
  }
  return cached;
}
