// GUARD G2 (PING): tuyến ExportRequest phải giữ CHUẨN money-string ↔ bigint XUYÊN SUỐT
// (renderer → IPC contract → service). Cấm Number/parseInt/parseFloat trên trường tiền. Quét TĨNH source.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const mainDir = dirname(fileURLToPath(import.meta.url));
const svc = readFileSync(join(mainDir, 'export-request-service.ts'), 'utf8');
const dts = readFileSync(join(mainDir, '..', 'preload', 'index.d.ts'), 'utf8');
const panel = readFileSync(join(mainDir, '..', 'renderer', 'src', 'components', 'ExportRequestPanel.tsx'), 'utf8');

const MONEY = ['unitPrice', 'amount', 'depositAmount', 'paidAmount'];

describe('G2 money-string guard — SERVICE (export-request-service.ts)', () => {
  it('KHÔNG Number()/parseInt/parseFloat trên field tiền của bản ghi DB', () => {
    const bad: string[] = [];
    for (const f of MONEY) {
      if (new RegExp(`(Number|parseInt|parseFloat)\\(\\s*r\\.${f}\\b`).test(svc)) bad.push(`Number(r.${f})`);
    }
    expect(bad, bad.join(', ')).toEqual([]);
  });
  it('DTO serialize bằng serializeVnd + parse bằng parseVndStrict + chặn overflow MAX_VND', () => {
    for (const f of MONEY) expect(svc, `thiếu serializeVnd(r.${f})`).toMatch(new RegExp(`serializeVnd\\(r\\.${f}\\b`));
    expect(svc).toMatch(/parseVndStrict/);
    expect(svc, 'thiếu chặn overflow amount > MAX_VND').toMatch(/amount\s*>\s*MAX_VND/);
  });
});

describe('G2 money-string guard — IPC CONTRACT (preload/index.d.ts)', () => {
  it('CreateExportRequestInput money = string THUẦN (KHÔNG string|number)', () => {
    const blk = dts.slice(dts.indexOf('interface CreateExportRequestInput'));
    const body = blk.slice(0, blk.indexOf('}'));
    expect(body).toMatch(/unitPrice:\s*string;/);
    expect(body, 'contract IPC không được string|number cho tiền').not.toMatch(/unitPrice:\s*string\s*\|\s*number/);
    expect(body).toMatch(/depositAmount\?:\s*string\s*\|\s*null/);
    expect(body).toMatch(/paidAmount\?:\s*string\s*\|\s*null/);
  });
  it('ExportRequestDto money = string (đầu ra)', () => {
    const blk = dts.slice(dts.indexOf('interface ExportRequestDto'));
    const body = blk.slice(0, blk.indexOf('}'));
    for (const f of MONEY) expect(body).toMatch(new RegExp(`${f}:\\s*string`));
  });
});

describe('G2 money-string guard — RENDERER (ExportRequestPanel.tsx)', () => {
  it('KHÔNG Number(...) trên biến tiền (dùng bigint qua toBig)', () => {
    // Cấm mẫu Number(digitsOnly(<money-state>)) đã bị loại; so sánh tiền phải là bigint (paidB/amountB/priceB).
    for (const s of ['unitPrice', 'depositAmount', 'paidAmount']) {
      expect(panel, `Number(digitsOnly(${s})) bị cấm`).not.toMatch(new RegExp(`Number\\(\\s*digitsOnly\\(${s}\\)`));
    }
    expect(panel, 'so sánh tiền phải bằng bigint (paidB > amountB)').toMatch(/paidB\s*>\s*amountB/);
    expect(panel, 'needsFund phải so sánh bigint (paidB > 0n)').toMatch(/paidB\s*>\s*0n/);
    expect(panel, 'gửi IPC money là digit-string').toMatch(/unitPrice:\s*digitsOnly\(unitPrice\)/);
  });
});
