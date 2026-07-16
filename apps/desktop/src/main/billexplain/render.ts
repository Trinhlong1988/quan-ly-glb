// Orchestrator sinh hóa đơn giải trình (port từ globeway-renbill/lib/render-engine.js, bỏ SSE/parse-file —
// products lấy từ DB, HKD từ hồ sơ, targets là danh sách số tiền truyền vào). Ghép 2 hóa đơn/sheet, clone
// template giữ nguyên layout A4, "Bằng chữ" tiếng Việt. KHÔNG in TID/MST (chốt Mr.Long 16/7: TID chỉ theo dõi).
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { generateLineItems, type ProductLite } from './lineitem-gen.js';
import { TemplateZip, type Overrides } from './template-zip.js';
import { readVNCapitalized } from './vn-num.js';

const VN_FMT = new Intl.NumberFormat('vi-VN');
function pad(n: number, len: number): string { return String(n).padStart(len, '0'); }

interface BillCommon {
  hkd_name: string;
  hkd_address: string;
  seller: string;
  day: number;
  month: number;
  year: number;
}
interface BuiltBill extends BillCommon {
  target: number;
  bill_no: number;
  bill_year: number;
  lines: { name: string; unit: string; price: number; qty: number }[];
  subtotal: number;
  discount_pct: number;
  discount_amount: number;
}

export interface RenderBillsOptions {
  templatePath: string;
  outputDir: string;
  products: ProductLite[];
  targets: number[];
  common: BillCommon;
  billNoStart: number;
  billNoYear: number;
  discountMin?: number;
  discountMax?: number;
  fileBaseName?: string; // mặc định = hkd_name
}
export interface RenderBillsResult {
  file: string;
  totalBills: number;
  totalTargets: number;
  totalSheets: number;
  errors: { index: number; target: number; error: string }[];
}

function sanitizeSheetName(s: string): string {
  return String(s || '')
    .replace(/[\[\]:*?/\\]/g, '_')
    .replace(/^'+|'+$/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Sheet';
}
function uniqueSheetName(base: string, taken: Set<string>): string {
  const MAX = 31;
  const trimmed = sanitizeSheetName(base).slice(0, MAX);
  if (!taken.has(trimmed)) { taken.add(trimmed); return trimmed; }
  for (let i = 2; i < 1000; i++) {
    const suffix = ` #${i}`;
    const cand = trimmed.slice(0, MAX - suffix.length) + suffix;
    if (!taken.has(cand)) { taken.add(cand); return cand; }
  }
  const fb = trimmed.slice(0, MAX - 6) + '_' + String(taken.size);
  taken.add(fb); return fb;
}

// Map ô cho 1 hóa đơn (offset dòng: block1=0, block2=25). Khớp template MẪU HÓA ĐƠN CHUẨN.xlsx.
function buildOverridesForBill(bill: BuiltBill, off: number): Overrides {
  const ov: Overrides = {};
  ov[`A${2 + off}`] = { type: 'string', value: bill.hkd_name };
  ov[`A${3 + off}`] = { type: 'string', value: `Địa chỉ: ${bill.hkd_address}` };
  ov[`A${4 + off}`] = { type: 'string', value: `SỐ HĐ: ${pad(bill.bill_no, 6)}/${bill.bill_year}` };
  for (let i = 0; i < 5; i++) {
    const r = 7 + i + off;
    const line = bill.lines[i];
    ov[`A${r}`] = { type: 'number', value: i + 1 };
    if (line) {
      ov[`B${r}`] = { type: 'string', value: line.name };
      ov[`C${r}`] = { type: 'string', value: line.unit };
      ov[`D${r}`] = { type: 'number', value: line.price };
      ov[`E${r}`] = { type: 'number', value: line.qty };
      ov[`F${r}`] = { type: 'number', value: Math.round(line.price * line.qty) };
    } else {
      ov[`B${r}`] = { type: 'string', value: '' };
      ov[`C${r}`] = { type: 'string', value: '' };
      ov[`D${r}`] = { type: 'string', value: '' };
      ov[`E${r}`] = { type: 'string', value: '' };
      ov[`F${r}`] = { type: 'string', value: '' };
    }
  }
  ov[`F${12 + off}`] = { type: 'number', value: bill.subtotal };
  ov[`E${13 + off}`] = { type: 'number', value: bill.discount_pct / 100 };
  ov[`F${13 + off}`] = { type: 'number', value: bill.discount_amount };
  ov[`F${14 + off}`] = { type: 'number', value: bill.target };
  ov[`A${15 + off}`] = { type: 'string', value: `Bằng chữ: ${readVNCapitalized(bill.target)} đồng chẵn` };
  ov[`D${17 + off}`] = { type: 'string', value: `Ngày ${bill.day} tháng ${pad(bill.month, 2)} năm ${bill.year}` };
  ov[`D${23 + off}`] = { type: 'string', value: bill.seller };
  return ov;
}
function buildEmptyBlockOverrides(off: number): Overrides {
  const ov: Overrides = {};
  for (const cell of [`A${2 + off}`, `A${3 + off}`, `A${4 + off}`, `F${12 + off}`, `E${13 + off}`, `F${13 + off}`, `F${14 + off}`, `A${15 + off}`, `D${17 + off}`, `D${23 + off}`]) {
    ov[cell] = { type: 'string', value: '' };
  }
  for (let i = 0; i < 5; i++) {
    const r = 7 + i + off;
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F']) ov[`${col}${r}`] = { type: 'string', value: '' };
  }
  return ov;
}

export async function renderBills(opts: RenderBillsOptions): Promise<RenderBillsResult> {
  const { templatePath, outputDir, products, targets, common, billNoStart, billNoYear } = opts;
  const discountMin = opts.discountMin ?? 1;
  const discountMax = opts.discountMax ?? 10;
  if (!targets.length) throw new Error('Không có số tiền nào để sinh bill.');
  if (!products.length) throw new Error('Thư viện sản phẩm của ngành nghề này đang trống — thêm sản phẩm trước.');
  if (!existsSync(templatePath)) throw new Error('Không tìm thấy file mẫu hóa đơn — kiểm tra cấu hình template.');

  const tz = await TemplateZip.fromFile(templatePath);
  const errors: { index: number; target: number; error: string }[] = [];

  const pairs: number[][] = [];
  for (let i = 0; i < targets.length; i += 2) pairs.push(targets.slice(i, i + 2));

  const taken = new Set<string>();
  let totalBills = 0;

  for (let pIdx = 0; pIdx < pairs.length; pIdx++) {
    const pair = pairs[pIdx];
    const built: BuiltBill[] = [];
    for (let j = 0; j < pair.length; j++) {
      const t = pair[j];
      const gIdx = pIdx * 2 + j;
      try {
        const gen = generateLineItems(t, products, discountMin, discountMax);
        built.push({ ...common, target: t, bill_no: billNoStart + gIdx, bill_year: billNoYear, ...gen });
      } catch (e) {
        errors.push({ index: gIdx + 1, target: t, error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (!built.length) continue;
    totalBills += built.length;

    const baseName = built.map((b) => VN_FMT.format(b.target)).join('-');
    const sheetName = uniqueSheetName(baseName, taken);
    const overrides = { ...buildOverridesForBill(built[0], 0) };
    if (built[1]) Object.assign(overrides, buildOverridesForBill(built[1], 25));
    else Object.assign(overrides, buildEmptyBlockOverrides(25));
    tz.addSheet(sheetName, overrides);
  }

  if (totalBills === 0) {
    throw new Error(`Không sinh được bill nào — tất cả ${targets.length} số tiền đều không khớp được tổ hợp sản phẩm. Thư viện SP cần đa dạng đơn giá hơn.`);
  }

  let safeName = (opts.fileBaseName || common.hkd_name || 'HKD')
    .replace(/[\x00-\x1F\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  safeName = safeName.slice(0, 80).replace(/[.\s]+$/, '') || 'HKD';
  const datePart = `${pad(common.day || 0, 2)}-${pad(common.month || 0, 2)}-${common.year || ''}`;
  let outFile = path.join(outputDir, `${safeName} - ${datePart}.xlsx`);

  if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true });
  const buf = await tz.toBuffer();
  try {
    await writeFile(outFile, buf);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM') {
      const ts = String(Date.now());
      outFile = path.join(outputDir, `${safeName} - ${datePart} (${ts}).xlsx`);
      await writeFile(outFile, buf);
    } else {
      throw e;
    }
  }

  return { file: outFile, totalBills, totalTargets: targets.length, totalSheets: pairs.length, errors };
}
