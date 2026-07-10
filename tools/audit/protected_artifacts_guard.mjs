#!/usr/bin/env node
// GUARD hardlock chống clobber file hand-maintained (sự cố 10/7: preload/index.d.ts 1115→174 dòng).
// Kiểm 3 lớp: (1) sàn số dòng tuyệt đối, (2) % thu nhỏ so với git HEAD, (3) chuỗi anchor bắt buộc còn nguyên.
// Exit 1 nếu BẤT KỲ artifact vi phạm → dùng làm gate pre-freeze + pre-commit. KHÔNG cần mạng, chạy trên Windows.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const reg = JSON.parse(readFileSync(join(here, 'protected_artifacts.json'), 'utf8'));

let failed = 0;
const fail = (p, msg) => { failed++; console.error(`GUARD FAIL | ${p} | ${msg}`); };

for (const a of reg.artifacts) {
  const abs = join(repoRoot, a.path);
  let cur;
  try { cur = readFileSync(abs, 'utf8'); }
  catch { fail(a.path, 'KHÔNG đọc được file (bị xóa?)'); continue; }
  const curLines = cur.split(/\r?\n/).length;

  // (1) sàn tuyệt đối
  if (a.minLines && curLines < a.minLines)
    fail(a.path, `số dòng ${curLines} < sàn ${a.minLines} → nghi bị clobber`);

  // (2) thu nhỏ so với HEAD
  if (a.shrinkPctMax != null) {
    try {
      const head = execSync(`git show HEAD:"${a.path}"`, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const headLines = head.split(/\r?\n/).length;
      const shrink = ((headLines - curLines) / headLines) * 100;
      if (shrink > a.shrinkPctMax)
        fail(a.path, `giảm ${shrink.toFixed(1)}% dòng so HEAD (${headLines}→${curLines}) > ngưỡng ${a.shrinkPctMax}%`);
    } catch { /* file mới chưa có trong HEAD → bỏ qua lớp (2) */ }
  }

  // (3) anchor bắt buộc
  for (const s of (a.mustContain || []))
    if (!cur.includes(s)) fail(a.path, `MẤT anchor bắt buộc: "${s}"`);

  if (!failed) console.log(`GUARD OK | ${a.path} | ${curLines} dòng, đủ ${(a.mustContain || []).length} anchor`);
}

console.log(`PROTECTED_ARTIFACTS ${failed === 0 ? 'PASS' : 'FAIL'} | vi phạm=${failed}`);
process.exit(failed === 0 ? 0 : 1);
