// CONTRACT GUARD P1-02 (PING): renderer KHÔNG BAO GIỜ nhận mật khẩu DB. Quét TĨNH:
// (a) db.ts getServerConfig() trả `password: ''` (che) và KHÔNG trả cfg.password ra ngoài;
// (b) preload contract (index.d.ts) ServerConfigDto.password kiểu chuỗi RỖNG `''` (không phải string tự do).
// Vì sao: getServerConfig() từng trả `config: currentServerConfig()` gồm password thật → lộ secret ra renderer.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const mainDir = dirname(fileURLToPath(import.meta.url));
const dbSrc = readFileSync(join(mainDir, 'db.ts'), 'utf8');
const dtsSrc = readFileSync(join(mainDir, '..', 'preload', 'index.d.ts'), 'utf8');

/** Cắt thân hàm getServerConfig (từ khai báo tới `^}` cột 0 kế tiếp). */
function getServerConfigBody(src: string): string {
  const start = src.indexOf('export async function getServerConfig');
  expect(start, 'không tìm thấy getServerConfig trong db.ts').toBeGreaterThan(-1);
  const rest = src.slice(start);
  const end = rest.search(/\n}\n/);
  return rest.slice(0, end === -1 ? rest.length : end);
}

/** Cắt thân hàm fillPasswordFromStored (guard AUTH-04). */
function fillPasswordBody(src: string): string {
  const start = src.indexOf('function fillPasswordFromStored');
  expect(start, 'không tìm thấy fillPasswordFromStored trong db.ts').toBeGreaterThan(-1);
  const rest = src.slice(start);
  const end = rest.search(/\n}\n/);
  return rest.slice(0, end === -1 ? rest.length : end);
}

describe('P1-02 contract — server config secret không rời main', () => {
  it('db.ts getServerConfig() che mật khẩu (password: "")', () => {
    const body = getServerConfigBody(dbSrc);
    expect(body).toMatch(/password:\s*''/); // trả chuỗi rỗng
    expect(body, 'getServerConfig KHÔNG được trả password thật (cfg.password)').not.toMatch(/password:\s*cfg\.password/);
    expect(body, 'phải báo passwordSet cho form biết đã-có-mật-khẩu').toMatch(/passwordSet/);
  });

  it('preload ServerConfigDto.password kiểu chuỗi RỖNG (contract renderer)', () => {
    const dto = dtsSrc.slice(dtsSrc.indexOf('interface ServerConfigDto'));
    const block = dto.slice(0, dto.indexOf('}'));
    expect(block).toMatch(/password:\s*''/); // không phải `password: string`
    expect(block).not.toMatch(/password:\s*string/);
  });

  it('preload ServerConfigStatus lộ passwordSet (cờ) thay cho giá trị secret', () => {
    const st = dtsSrc.slice(dtsSrc.indexOf('interface ServerConfigStatus'));
    const block = st.slice(0, st.indexOf('}'));
    expect(block).toMatch(/passwordSet:\s*boolean/);
  });

  // AUTH-04 (Codex 15/7): fillPasswordFromStored CHỈ bổ khuyết mật khẩu khi đích TRÙNG máy chủ đã lưu →
  // không rò credential DB ra host lạ qua serverConfig:test/save. Guard = so khớp host+user+database.
  it('AUTH-04: fillPasswordFromStored chỉ back-fill khi đích trùng máy chủ đã lưu', () => {
    const body = fillPasswordBody(dbSrc);
    expect(body, 'phải có guard đích-trùng trước khi bổ khuyết mật khẩu').toMatch(/sameTarget/);
    // các trường so khớp phải hiện diện
    expect(body).toMatch(/stored\.host/);
    expect(body).toMatch(/stored\.user/);
    expect(body).toMatch(/stored\.database/);
    // KHÔNG được trả thẳng mật khẩu đã lưu mà không qua kiểm tra sameTarget
    expect(body, 'không được back-fill vô điều kiện').toMatch(/if\s*\(!sameTarget\)\s*return input/);
  });
});
