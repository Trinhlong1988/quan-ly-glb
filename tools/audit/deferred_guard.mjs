#!/usr/bin/env node
// deferred_guard — chống "duyệt gộp chôn việc lớn" (PF-01).
// LUẬT: mọi dòng trong docs/*_SPEC.md có token hoãn (HOÃN/HOAN/TODO/"tạm hoãn"/"sau này build")
// PHẢI gắn 1 mã Dxx tham chiếu docs/DEFERRED_REGISTRY.md, và mã đó phải tồn tại trong sổ.
// Thiếu → exit 1 (buộc khai báo, không cho hoãn ngầm).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const docsDir = join(root, 'docs');
const registryPath = join(docsDir, 'DEFERRED_REGISTRY.md');

// Token báo hoãn (regex, không phân biệt hoa thường trừ HOÃN có dấu). Loại trừ chính sổ + guard này.
const DEFER = /\bHO[ÃA]N\b|\bTODO\b|tạm hoãn|hoãn ngầm|sau này build|để sau build/i;
const IDREF = /\bD\d{2}\b/;

function fail(msg) { console.error(`DEFERRED_GUARD FAIL | ${msg}`); process.exit(1); }

if (!existsSync(registryPath)) fail('thiếu docs/DEFERRED_REGISTRY.md');
const registry = readFileSync(registryPath, 'utf8');
const knownIds = new Set([...registry.matchAll(/^\|\s*(D\d{2})\s*\|/gm)].map((m) => m[1]));
if (knownIds.size === 0) fail('DEFERRED_REGISTRY.md không có dòng bảng Dxx nào');

const specFiles = readdirSync(docsDir).filter((f) => /_SPEC\.md$/.test(f));
const violations = [];
for (const f of specFiles) {
  const lines = readFileSync(join(docsDir, f), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!DEFER.test(line)) return;
    const ids = [...line.matchAll(/\bD\d{2}\b/g)].map((m) => m[0]);
    if (ids.length === 0) {
      violations.push(`${f}:${i + 1} — dòng HOÃN/TODO chưa gắn mã Dxx: "${line.trim().slice(0, 90)}"`);
    } else {
      for (const id of ids) if (!knownIds.has(id)) violations.push(`${f}:${i + 1} — mã ${id} không có trong DEFERRED_REGISTRY.md`);
    }
  });
}

if (violations.length) {
  console.error('DEFERRED_GUARD FAIL | hoãn ngầm chưa khai báo:');
  for (const v of violations) console.error('  - ' + v);
  console.error('→ Khai báo hạng mục vào docs/DEFERRED_REGISTRY.md và gắn mã Dxx vào dòng spec.');
  process.exit(1);
}
console.log(`DEFERRED_GUARD OK | ${specFiles.length} spec quét, ${knownIds.size} mã hoãn khai báo, 0 hoãn ngầm`);
