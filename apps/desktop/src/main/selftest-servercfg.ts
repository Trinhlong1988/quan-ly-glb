// G10.3 Cấu hình máy chủ — self-test (GLB_SELFTEST=22).
// Chạy trong harness chuẩn: GLB_DB_URL=postgresql://…<throwaway> + GLB_ROLE=server.
// Đo đường IPC THẬT của màn "Cấu hình máy chủ": testServerConfig (pg connect OK/lỗi phân loại),
// validateServerConfig gating, saveServerConfig (ghi file round-trip + reinit + probe), getServerConfig.
//
// GIỚI HẠN có chủ đích (ghi rõ để không hiểu nhầm): khi GLB_DB_URL được set, resolveDatabaseUrl ưu
// tiên nó → reinit dùng throwaway DB, KHÔNG dùng creds trong file. Việc "file creds lái kết nối" đã do
// resolveDatabaseUrl (đã có) + kiểm thủ công đảm nhiệm. Selftest này phủ: pg connect đúng/sai, validate,
// ghi/đọc file, phân loại trạng thái. File server-config THẬT được backup trước + khôi phục ở finally.
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { getServerConfig, testServerConfig, saveServerConfig, serverConfigPath } from './db.js';

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++;
  else fail++;
  // eslint-disable-next-line no-console
  console.log(`SVRCFG22 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

interface Creds {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

function credsFromUrl(u: string): Creds {
  const url = new URL(u);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: url.pathname.replace(/^\//, ''),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password)
  };
}

export async function runServerConfigSelfTest(): Promise<number> {
  const dbUrl = process.env['GLB_DB_URL'];
  if (!dbUrl) {
    // eslint-disable-next-line no-console
    console.log('SVRCFG22 FAIL | thiếu GLB_DB_URL (harness sai)');
    return 1;
  }
  const good = credsFromUrl(dbUrl);

  // Backup file server-config thật (nếu có) để khôi phục sau test.
  const cfgPath = serverConfigPath();
  const hadFile = existsSync(cfgPath);
  const backup = hadFile ? readFileSync(cfgPath, 'utf8') : null;

  try {
    // 1) Kết nối ĐÚNG creds → ok.
    const t1 = await testServerConfig(good);
    ok('testServerConfig(good) => ok', t1.ok === true, t1);

    // 2) Sai mật khẩu: phụ thuộc pg_hba.conf. Máy chủ dùng md5/scram → fail 28P01 (đã kiểm thủ công
    //    trên 192.168.1.6). Local dev thường 'trust' → connect được dù sai mật khẩu. Nên assert TOLERANT:
    //    hoặc connect (trust) hoặc fail-có-lỗi (không bao giờ ok=false mà thiếu thông điệp).
    const t2 = await testServerConfig({ ...good, password: good.password + '_SAI' });
    ok('testServerConfig(bad password) => connect(trust) hoặc fail-có-lỗi', t2.ok === true || (t2.ok === false && !!t2.error), {
      ok: t2.ok,
      error: t2.error
    });

    // 3) Host không tồn tại → fail (timeout/refused/notfound).
    const t3 = await testServerConfig({ ...good, host: '10.255.255.1' });
    ok('testServerConfig(bad host) => fail', t3.ok === false && !!t3.error, { ok: t3.ok });

    // 4) Validation gating: thiếu host → fail sớm (không cần chạm mạng).
    const t4 = await testServerConfig({ ...good, host: '' });
    ok('testServerConfig(no host) => validation fail', t4.ok === false && !!t4.error, t4);

    // 5) Validation gating: thiếu mật khẩu VÀ chưa có cấu hình lưu → fail sớm (xóa file để xác định).
    if (existsSync(cfgPath)) rmSync(cfgPath);
    const t5 = await testServerConfig({ ...good, password: '' });
    ok('testServerConfig(no password, chưa lưu) => validation fail', t5.ok === false && !!t5.error, t5);

    // 6) saveServerConfig(good) → ghi file + reinit + probe => ok.
    const s1 = await saveServerConfig(good);
    ok('saveServerConfig(good) => ok', s1.ok === true, s1);

    // 7) File đã được ghi + đọc lại đúng nội dung đã chuẩn hóa.
    const written = existsSync(cfgPath) ? (JSON.parse(readFileSync(cfgPath, 'utf8')) as Creds) : null;
    ok(
      'file server-config ghi đúng creds',
      !!written && written.host === good.host && written.port === good.port && written.database === good.database && written.user === good.user,
      written ? { host: written.host, port: written.port, database: written.database, user: written.user } : null
    );

    // 8) saveServerConfig(invalid) => fail, KHÔNG throw.
    const s2 = await saveServerConfig({ ...good, host: '' });
    ok('saveServerConfig(invalid) => fail', s2.ok === false && !!s2.error, s2);

    // 9) getServerConfig sau khi lưu: configured=true, ready=true, needsConfig=false (server role).
    const st = await getServerConfig();
    ok('getServerConfig => configured & ready', st.configured === true && st.ready === true && st.needsConfig === false, {
      configured: st.configured,
      ready: st.ready,
      needsConfig: st.needsConfig,
      serverRole: st.serverRole
    });

    // 10) getServerConfig trả config đổ form (không rỗng host sau khi lưu).
    ok('getServerConfig.config.host khớp', st.config.host === good.host, { host: st.config.host });

    // 11) P1-02 (invariant #6): getServerConfig KHÔNG lộ mật khẩu DB ra renderer; passwordSet=true báo đã có.
    ok('P1-02: getServerConfig KHÔNG trả mật khẩu (password="")', (st.config as { password?: string }).password === '' && (st as { passwordSet?: boolean }).passwordSet === true, { pw: (st.config as { password?: string }).password, set: (st as { passwordSet?: boolean }).passwordSet });
    // 12) P1-02: sau khi đã lưu, test/save với mật khẩu TRỐNG → dùng lại mật khẩu đã lưu (không phải gõ lại).
    const tBlank = await testServerConfig({ ...good, password: '' });
    ok('P1-02: mật khẩu trống sau khi đã lưu => dùng mật khẩu cũ (kết nối ok)', tBlank.ok === true, tBlank);
  } finally {
    // Khôi phục nguyên trạng file server-config trên máy build.
    if (backup !== null) writeFileSync(cfgPath, backup, 'utf8');
    else if (existsSync(cfgPath)) rmSync(cfgPath);
  }

  // eslint-disable-next-line no-console
  console.log(`SVRCFG22 DONE | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
