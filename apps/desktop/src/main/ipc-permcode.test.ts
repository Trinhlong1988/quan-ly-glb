// GUARD lớp lỗi: mã quyền dùng để GẮN CỔNG (requirePermission) trong toàn bộ main/ phải TỒN TẠI trong
// PERMISSION_CODES. Vì sao có test này: ipc.ts từng gọi requirePermission('DOSSIER_VIEW')/('RCV_ACCT_VIEW')
// — 2 mã KHÔNG tồn tại (đúng là CONFIG_DOSSIER_VIEW/CONFIG_RCV_ACCT_VIEW) → cổng fail-CLOSED CHẶN cả ADMIN,
// tính năng chết ÂM THẦM. Selftest gọi thẳng service (không qua IPC) và không so mã với danh mục quyền nên
// không bắt được lớp này. Test quét TĨNH source (không import Electron/Prisma) → mọi mã gõ sai FAIL ở vitest.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PERMISSION_CODES } from '@glb/shared';

const mainDir = dirname(fileURLToPath(import.meta.url));

// Mọi source main/ TRỪ test + selftest (selftest cố tình test cả nhánh FORBIDDEN với mã hợp lệ).
const sources = readdirSync(mainDir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.startsWith('selftest-'))
  .map((f) => readFileSync(join(mainDir, f), 'utf8'));

/** Trích mã quyền gắn cổng: (a) đối số 1 của requirePermission('CODE',
 *  (b) hằng chuỗi UPPER_SNAKE gán cho biến `perm` (nhánh ternary chọn quyền, vd file:read). */
function gateCodes(src: string): string[] {
  const codes = new Set<string>();
  for (const m of src.matchAll(/requirePermission\(\s*'([A-Z0-9_]+)'/g)) codes.add(m[1]);
  for (const line of src.split('\n')) {
    if (!/\bperm\b\s*=/.test(line)) continue;
    for (const m of line.matchAll(/'([A-Z][A-Z0-9_]{2,})'/g)) codes.add(m[1]);
  }
  return [...codes];
}

describe('main/ permission-code integrity', () => {
  const valid = new Set<string>(PERMISSION_CODES);
  const used = [...new Set(sources.flatMap(gateCodes))];

  it('quét được số lượng mã quyền hợp lý (sanity — regex/glob không hỏng)', () => {
    expect(used.length).toBeGreaterThanOrEqual(20);
  });

  it('MỌI mã quyền gắn cổng đều tồn tại trong PERMISSION_CODES', () => {
    const unknown = used.filter((c) => !valid.has(c));
    expect(unknown, `Mã quyền không tồn tại (gõ sai → cổng fail-closed âm thầm): ${unknown.join(', ')}`).toEqual([]);
  });
});
