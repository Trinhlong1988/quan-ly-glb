// G10 test-harness for PostgreSQL.
// For each selftest N: createdb throwaway → prisma migrate deploy → run electron (GLB_ROLE=server
// seeds inline) → capture exit → dropdb. Replaces the SQLite copy-file throwaway harness (HIGH-5).
//
// Usage:  node tools/selftest/run-selftest-pg.mjs 18 19 21
// Config via env (defaults = local PostgreSQL 16 install):
//   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=Glb@Pg2026
//   GLB_PG_BIN=D:/PostgreSQL16/pgsql/bin
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dbPkg = join(repoRoot, 'packages', 'database');

const HOST = process.env.PGHOST || 'localhost';
const PORT = process.env.PGPORT || '5432';
const USER = process.env.PGUSER || 'postgres';
const PASSWORD = process.env.PGPASSWORD || 'Glb@Pg2026';
const PGBIN = process.env.GLB_PG_BIN || 'D:/PostgreSQL16/pgsql/bin';
const exe = (t) => (process.platform === 'win32' ? `${t}.exe` : t);
const tool = (t) => join(PGBIN, exe(t));

function pgUrl(dbName) {
  const u = encodeURIComponent(USER);
  const p = encodeURIComponent(PASSWORD);
  return `postgresql://${u}:${p}@${HOST}:${PORT}/${dbName}`;
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
    env: { ...process.env, PGPASSWORD: PASSWORD, ...(opts.env || {}) }
  });
}

const nums = process.argv.slice(2);
if (nums.length === 0) {
  console.error('Usage: node tools/selftest/run-selftest-pg.mjs <N> [<N> ...]');
  process.exit(2);
}

const electronPath = require('electron'); // path to electron binary when required from Node
const results = [];

for (const n of nums) {
  const tmpdb = `glb_st${n}_${Date.now()}`;
  const url = pgUrl(tmpdb);
  console.log(`\n===== SELFTEST ${n} on ${tmpdb} =====`);

  const created = run(tool('createdb'), ['-h', HOST, '-p', PORT, '-U', USER, tmpdb]);
  if (created.status !== 0) {
    console.error(`createdb FAILED: ${created.stderr || created.stdout}`);
    results.push({ n, ok: false, stage: 'createdb' });
    continue;
  }
  try {
    const mig = run('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: dbPkg, shell: true, env: { DATABASE_URL: url }
    });
    process.stdout.write(mig.stdout || '');
    if (mig.status !== 0) {
      console.error(`migrate deploy FAILED: ${mig.stderr || ''}`);
      results.push({ n, ok: false, stage: 'migrate' });
      continue;
    }
    const st = run(electronPath, ['apps/desktop'], {
      cwd: repoRoot,
      env: { GLB_SELFTEST: String(n), GLB_ROLE: 'server', GLB_DB_URL: url }
    });
    process.stdout.write(st.stdout || '');
    if (st.stderr) process.stderr.write(st.stderr);
    console.log(`SELFTEST ${n} exit code: ${st.status}`);
    results.push({ n, ok: st.status === 0, exit: st.status });
  } finally {
    const dropped = run(tool('dropdb'), ['-h', HOST, '-p', PORT, '-U', USER, tmpdb]);
    if (dropped.status !== 0) console.error(`dropdb WARN (${tmpdb}): ${dropped.stderr || ''}`);
  }
}

console.log('\n===== SUMMARY =====');
for (const r of results) console.log(`selftest ${r.n}: ${r.ok ? 'PASS' : 'FAIL'}${r.exit !== undefined ? ` (exit ${r.exit})` : ` (${r.stage})`}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
