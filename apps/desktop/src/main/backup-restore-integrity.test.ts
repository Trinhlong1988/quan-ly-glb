// SEC-02 (Codex 15/7): restore PHẢI bắt buộc manifest + checksum. Trước đây `if (manEntry)` + `if (manifest.checksum
// && ...)` → thiếu manifest / thiếu checksum thì BỎ QUA kiểm tra toàn vẹn → archive bị thay ruột (đổi glb.dump)
// vẫn restore được. Test TĨNH: khẳng định restoreBackup từ chối cả 3 trường hợp (thiếu manifest / thiếu checksum /
// checksum sai) TRƯỚC khi chạy pg_restore. Sẽ FAIL nếu ai nới lỏng lại về nhánh optional.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'backup-service.ts'), 'utf8');

/** Thân hàm restoreBackup (tới `pg_restore` — vùng kiểm tra toàn vẹn nằm trước đó). */
function restoreHead(): string {
  const start = src.indexOf('export async function restoreBackup');
  expect(start, 'không tìm thấy restoreBackup').toBeGreaterThan(-1);
  const region = src.slice(start);
  const cut = region.indexOf('pgToolPath(\'pg_restore\')');
  return region.slice(0, cut === -1 ? region.length : cut);
}

describe('SEC-02 — restore bắt buộc manifest + checksum', () => {
  const head = restoreHead();

  it('từ chối khi THIẾU manifest (!manEntry)', () => {
    expect(head).toMatch(/if\s*\(!manEntry\)\s*return\s*\{[^}]*INVALID_ARCHIVE/s);
  });

  it('từ chối khi manifest THIẾU checksum (!manifest.checksum)', () => {
    expect(head).toMatch(/if\s*\(!manifest\.checksum\)\s*return/);
  });

  it('bắt buộc verifyChecksum (không còn nhánh optional `if (manifest.checksum &&`)', () => {
    expect(head).toMatch(/verifyChecksum\(dumpEntry\.data,\s*manifest\.checksum\)/);
    expect(head, 'không được để kiểm checksum là optional (manifest.checksum &&)').not.toMatch(/manifest\.checksum\s*&&\s*!verifyChecksum/);
  });
});
