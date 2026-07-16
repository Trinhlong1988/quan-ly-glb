// Bill giải trình service (main) — Mr.Long 16/7.
// (A) Thư viện sản phẩm (Product) theo ngành nghề: CRUD + import + soft-delete, quyền PRODUCT_MANAGE / BILLEXPLAIN_VIEW.
// (B) Sinh bill giải trình: chọn HKD (hồ sơ) + TID (chỉ theo dõi) + ngành → nhập/nạp danh sách SỐ TIỀN → engine
//     sinh dòng SP khớp tổng → clone template → xuất .xlsx → lưu BillExplain (tab theo dõi). Quyền BILLEXPLAIN_CREATE.
// (C) Template hóa đơn: mặc định đóng gói (extraResources) / import mẫu riêng / xuất mẫu. Cấu hình lưu AppSetting.
// KHÔNG in TID/MST lên hóa đơn (chốt Mr.Long 16/7). Người bán = chủ hộ HKD. Audit đầy đủ (R_AUDIT_TRAIL).
import { app, dialog, BrowserWindow } from 'electron';
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { copyFile, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { auditSnapshot } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit, writeAuditStrict } from './audit.js';
import { nextCode } from './code-service.js';
import { dateRange } from './customer-service.js';
import { staleGuard } from './optimistic-lock.js';
import { renderBills } from './billexplain/render.js';
import type { ProductLite } from './billexplain/lineitem-gen.js';

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

// ── Cấu hình (AppSetting key-value) ─────────────────────────────────────────────
const K_OUTPUT_DIR = 'billexplain.outputDir';
const K_BILL_NO = 'billexplain.billNoStart';
const K_BILL_YEAR = 'billexplain.billNoYear';
const K_TEMPLATE_PATH = 'billexplain.templatePath'; // đường dẫn mẫu riêng (nếu user import). Rỗng = dùng mặc định.
const CUSTOM_TEMPLATE_FILE = 'billexplain-custom-template.xlsx'; // lưu trong userData

/** Đường dẫn template MẶC ĐỊNH đóng gói kèm app (extraResources). Dev đọc từ build/. */
function defaultTemplatePath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'billexplain-template.xlsx')
    : path.join(app.getAppPath(), 'build', 'billexplain-template.xlsx');
}
async function getSetting(db: Db, key: string): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}
async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
/** Template đang dùng: mẫu riêng (nếu có + tồn tại) → nếu không có → mặc định đóng gói. */
async function resolveTemplatePath(db: Db): Promise<string> {
  const custom = await getSetting(db, K_TEMPLATE_PATH);
  if (custom && existsSync(custom)) return custom;
  return defaultTemplatePath();
}
async function resolveOutputDir(db: Db): Promise<string> {
  const cfg = await getSetting(db, K_OUTPUT_DIR);
  return cfg && cfg.trim() ? cfg : path.join(app.getPath('documents'), 'GLB-BillGiaiTrinh');
}

// ═══════════════════════════════════════════════════════════════════════════════
// (A) THƯ VIỆN SẢN PHẨM
// ═══════════════════════════════════════════════════════════════════════════════
export interface ProductDto {
  id: number;
  industryId: number;
  industryName: string | null;
  name: string;
  unit: string;
  price: number;
  priority: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}
export interface ProductFilter {
  industryId?: number;
  search?: string;
  status?: string; // ACTIVE | INACTIVE
  fromDate?: string;
  toDate?: string;
}
export interface CreateProductInput {
  industryId: number;
  name: string;
  unit: string;
  price: number;
  priority?: number;
  status?: string;
}
export interface UpdateProductInput {
  industryId?: number;
  name?: string;
  unit?: string;
  price?: number;
  priority?: number;
  status?: string;
  expectedUpdatedAt?: string | null;
}

async function industryNameMap(db: Db, ids: number[]): Promise<Map<number, string>> {
  const uniq = [...new Set(ids)];
  const map = new Map<number, string>();
  if (!uniq.length) return map;
  const rows = await db.industry.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
  for (const r of rows) map.set(r.id, r.name);
  return map;
}
function normName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}
/** Đơn giá SP hợp lệ (VND, số nguyên dương ≤ MAX_SAFE). VN-format cho phép dấu nhóm nghìn `. , ` khoảng
 *  trắng (import "45.000"→45000) NHƯNG chặn dấu âm/mũ/chữ (`-100`/`1e3`/`abc`→null) — không đổi giá trị ngầm
 *  (FE53-06 / lớp B62). Số truyền vào phải nguyên dương. */
function validPrice(v: unknown): number | null {
  if (typeof v === 'number') {
    return Number.isInteger(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER ? v : null;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || !/^[\d.,\s]+$/.test(s)) return null; // chỉ chữ số + dấu nhóm; loại '-'/'e'/chữ
  const digits = s.replace(/[.,\s]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const b = BigInt(digits);
  if (b <= 0n || b > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(b);
}
/** Ưu tiên SP: số nguyên 0..1000 (cao = hữu dụng hơn). Không hợp lệ/thiếu → 0 (trung tính, không đổi hành vi cũ). */
function validPriority(v: unknown): number {
  let n: number | null = null;
  if (typeof v === 'number' && Number.isInteger(v)) n = v;
  else if (typeof v === 'string' && /^\d+$/.test(v.trim())) n = Number(v.trim());
  if (n === null || n < 0) return 0;
  return Math.min(n, 1000);
}

export async function listProducts(filter: ProductFilter = {}): Promise<{ ok: boolean; data?: ProductDto[]; error?: string; message?: string }> {
  const g = await requirePermission('BILLEXPLAIN_VIEW', { action: 'BILLEXPLAIN_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.product.findMany({
    where: {
      deletedAt: null,
      industryId: filter.industryId ?? undefined,
      status: filter.status || undefined,
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search ? [{ name: { contains: filter.search, mode: 'insensitive' } }, { unit: { contains: filter.search, mode: 'insensitive' } }] : undefined
    },
    orderBy: { id: 'asc' }
  });
  const names = await industryNameMap(g.db, rows.map((r) => r.industryId));
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id, industryId: r.industryId, industryName: names.get(r.industryId) ?? null,
      name: r.name, unit: r.unit, price: r.price, priority: r.priority, status: r.status,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString()
    }))
  };
}

export async function createProduct(input: CreateProductInput): Promise<MutationResult> {
  const g = await requirePermission('PRODUCT_MANAGE', { action: 'PRODUCT_CREATED', targetType: 'Product' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!input.industryId) return { ok: false, error: 'VALIDATION', message: 'Chọn nhóm ngành nghề.' };
  const industry = await db.industry.findUnique({ where: { id: input.industryId }, select: { id: true, deletedAt: true } });
  if (!industry || industry.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Ngành nghề không tồn tại.' };
  const name = input.name?.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên sản phẩm bắt buộc.' };
  const unit = input.unit?.trim();
  if (!unit) return { ok: false, error: 'VALIDATION', message: 'Đơn vị tính bắt buộc.' };
  const price = validPrice(input.price);
  if (price === null) return { ok: false, error: 'VALIDATION', message: 'Đơn giá phải là số nguyên dương (VND).' };

  const priority = validPriority(input.priority);
  const created = await db.product.create({
    data: { industryId: input.industryId, name, unit, price, priority, status: input.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE', createdBy: user.id }
  });
  await writeAudit(db, {
    actorUserId: user.id, action: 'PRODUCT_CREATED', targetType: 'Product', targetId: String(created.id),
    after: auditSnapshot({ industryId: created.industryId, name: created.name, unit: created.unit, price: created.price, priority: created.priority, status: created.status })
  });
  return { ok: true, id: created.id };
}

export async function updateProduct(id: number, input: UpdateProductInput): Promise<MutationResult> {
  const g = await requirePermission('PRODUCT_MANAGE', { action: 'PRODUCT_UPDATED', targetType: 'Product', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.product.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Sản phẩm không tồn tại.' };
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;

  const name = input.name !== undefined ? input.name.trim().replace(/\s+/g, ' ') : row.name;
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên sản phẩm không được để trống.' };
  const unit = input.unit !== undefined ? input.unit.trim() : row.unit;
  if (!unit) return { ok: false, error: 'VALIDATION', message: 'Đơn vị tính không được để trống.' };
  let price = row.price;
  if (input.price !== undefined) {
    const p = validPrice(input.price);
    if (p === null) return { ok: false, error: 'VALIDATION', message: 'Đơn giá phải là số nguyên dương (VND).' };
    price = p;
  }
  if (input.industryId !== undefined && input.industryId !== row.industryId) {
    const ind = await db.industry.findUnique({ where: { id: input.industryId }, select: { id: true, deletedAt: true } });
    if (!ind || ind.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Ngành nghề không tồn tại.' };
  }

  const priority = input.priority !== undefined ? validPriority(input.priority) : row.priority;
  const before = auditSnapshot({ industryId: row.industryId, name: row.name, unit: row.unit, price: row.price, priority: row.priority, status: row.status });
  const updated = await db.product.update({
    where: { id },
    data: {
      industryId: input.industryId ?? row.industryId,
      name, unit, price, priority,
      status: input.status !== undefined ? (input.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') : row.status,
      updatedBy: user.id
    }
  });
  await writeAudit(db, {
    actorUserId: user.id, action: 'PRODUCT_UPDATED', targetType: 'Product', targetId: String(id), before,
    after: auditSnapshot({ industryId: updated.industryId, name: updated.name, unit: updated.unit, price: updated.price, priority: updated.priority, status: updated.status })
  });
  return { ok: true, id };
}

export async function deleteProducts(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission('PRODUCT_MANAGE', { action: 'PRODUCT_DELETED', targetType: 'Product' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn sản phẩm để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'PRODUCT_DELETED', targetType: 'Product', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.product.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.product.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'PRODUCT_DELETED', targetType: 'Product', targetId: String(id), before: auditSnapshot({ name: row.name, unit: row.unit, price: row.price }) });
    deleted++;
  }
  return { ok: true, deleted };
}

/** Import danh sách SP cho 1 ngành (rows đã parse ở renderer: {name,unit,price}). Bỏ dòng thiếu/không hợp lệ. */
export async function importProducts(industryId: number, rows: { name?: string; unit?: string; price?: unknown; priority?: unknown }[]): Promise<MutationResult & { imported?: number; skipped?: number }> {
  const g = await requirePermission('PRODUCT_MANAGE', { action: 'PRODUCT_IMPORTED', targetType: 'Product' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!industryId) return { ok: false, error: 'VALIDATION', message: 'Chọn nhóm ngành nghề trước khi import.' };
  const industry = await db.industry.findUnique({ where: { id: industryId }, select: { id: true, deletedAt: true } });
  if (!industry || industry.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Ngành nghề không tồn tại.' };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: 'VALIDATION', message: 'File không có dòng sản phẩm hợp lệ.' };

  let imported = 0, skipped = 0;
  for (const r of rows) {
    const name = String(r.name ?? '').trim().replace(/\s+/g, ' ');
    const unit = String(r.unit ?? '').trim();
    const price = validPrice(r.price);
    if (!name || !unit || price === null) { skipped++; continue; }
    await db.product.create({ data: { industryId, name, unit, price, priority: validPriority(r.priority), status: 'ACTIVE', createdBy: user.id } });
    imported++;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'PRODUCT_IMPORTED', targetType: 'Product', after: { industryId, imported, skipped } });
  return { ok: true, imported, skipped };
}

// ═══════════════════════════════════════════════════════════════════════════════
// (B) SINH BILL GIẢI TRÌNH + THEO DÕI
// ═══════════════════════════════════════════════════════════════════════════════
const BILL_CODE_PREFIX = 'BE';

export interface BillExplainDto {
  id: number;
  code: string | null;
  dossierId: number;
  dossierName: string | null;
  tidId: number | null;
  tidCode: string | null;
  industryId: number;
  industryName: string | null;
  billDate: string;
  totalAmount: number;
  billCount: number;
  filePath: string;
  createdByName: string | null;
  createdAt: string;
}
export interface GenerateBillsInput {
  dossierId: number;
  tidId?: number | null;
  industryId: number;
  billDate: string; // yyyy-mm-dd
  targets: (number | string)[]; // danh sách số tiền cần giải trình
}
export interface GenerateBillsResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
  file?: string;
  totalBills?: number;
  errors?: { index: number; target: number; error: string }[];
}

const MAX_TARGET = Number.MAX_SAFE_INTEGER; // engine sinh dòng dùng Number → chặn tại MAX_SAFE để KHÔNG mất chữ số
const BILLNO_LOCK = 561053; // pg advisory lock cấp DẢI số hóa đơn Bill giải trình (BILL-06 chống race/TOCTOU)
// Trần THỰC TẾ 1 hóa đơn (Mr.Long 16/7): hóa đơn bán lẻ thật KHÔNG quá ~299tr. KHÔNG tách hóa đơn — số nào
// vượt trần thì báo lỗi rõ để người dùng nhập số nhỏ hơn (giữ số lượng dòng cân đối, không phi lý).
const REAL_CEILING = 299_000_000;

/** Parse danh sách số tiền STRICT — KHÔNG strip/mutate (BILL-04/05/09):
 *  - number: nguyên, >0, ≤ MAX_SAFE. - string: `^\d+$` (chỉ chữ số, không dấu/mũ/chữ), >0, ≤ MAX_SAFE.
 *  Trả `{targets, invalid}`. `invalid < 0` = input KHÔNG phải mảng (IPC dị dạng). `invalid > 0` = số phần tử sai. */
function parseTargets(list: unknown): { targets: number[]; invalid: number } {
  if (!Array.isArray(list)) return { targets: [], invalid: -1 };
  const out: number[] = [];
  let invalid = 0;
  const MAX = BigInt(MAX_TARGET);
  for (const raw of list) {
    let b: bigint | null = null;
    if (typeof raw === 'number') {
      if (Number.isInteger(raw) && raw > 0 && raw <= MAX_TARGET) b = BigInt(raw);
    } else if (typeof raw === 'string') {
      const s = raw.trim();
      if (/^\d+$/.test(s)) { const v = BigInt(s); if (v > 0n && v <= MAX) b = v; }
    }
    if (b === null) { invalid++; continue; }
    out.push(Number(b));
  }
  return { targets: out, invalid };
}
/** Ngày STRICT `yyyy-mm-dd` CÓ THẬT (round-trip UTC) — `2026-02-31`/`2026-13-01`/rỗng/dị dạng → null (lớp B65,
 *  chống cuộn ngầm sang tháng khác / rơi về hôm nay). KHÔNG bao giờ trả ngày mặc định. */
function parseStrictYmd(s: unknown): { y: number; m: number; d: number } | null {
  if (typeof s !== 'string') return null;
  const mm = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!mm) return null;
  const y = +mm[1], m = +mm[2], d = +mm[3];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

export async function generateBills(input: GenerateBillsInput): Promise<GenerateBillsResult> {
  const g = await requirePermission('BILLEXPLAIN_CREATE', { action: 'BILLEXPLAIN_CREATED', targetType: 'BillExplain' });
  if (!g.ok) return g;
  const { db, user } = g;

  // BILL-09: guard runtime input (IPC dị dạng → VALIDATION, KHÔNG TypeError).
  if (!input || typeof input !== 'object') return { ok: false, error: 'VALIDATION', message: 'Dữ liệu không hợp lệ.' };
  if (typeof input.dossierId !== 'number' || !Number.isInteger(input.dossierId)) return { ok: false, error: 'VALIDATION', message: 'Chọn Hộ Kinh Doanh.' };
  if (typeof input.industryId !== 'number' || !Number.isInteger(input.industryId)) return { ok: false, error: 'VALIDATION', message: 'Chọn nhóm ngành nghề.' };

  const dossier = await db.dossier.findUnique({ where: { id: input.dossierId } });
  if (!dossier || dossier.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Hồ sơ HKD không tồn tại.' };

  // BILL-01: ngành PHẢI tồn tại + còn sống (trước đây chỉ dựa NO_PRODUCTS → ngành xóa mềm còn SP vẫn lọt).
  const industry = await db.industry.findUnique({ where: { id: input.industryId }, select: { id: true, deletedAt: true } });
  if (!industry || industry.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Nhóm ngành nghề không tồn tại.' };

  // BILL-02: TID (nếu chọn) tồn tại + KHÔNG thuộc HKD khác (tracking nhất quán; cho phép TID chưa gắn HKD).
  let tidCode: string | null = null;
  if (input.tidId != null) {
    if (typeof input.tidId !== 'number' || !Number.isInteger(input.tidId)) return { ok: false, error: 'VALIDATION', message: 'TID không hợp lệ.' };
    const tid = await db.tid.findUnique({ where: { id: input.tidId }, select: { id: true, tid: true, deletedAt: true, dossierId: true } });
    if (!tid || tid.deletedAt) return { ok: false, error: 'VALIDATION', message: 'TID không tồn tại.' };
    if (tid.dossierId != null && tid.dossierId !== input.dossierId) return { ok: false, error: 'VALIDATION', message: 'TID không thuộc Hộ Kinh Doanh đã chọn.' };
    tidCode = tid.tid;
  }

  // BILL-03: ngày STRICT (không cuộn ngầm / không rơi về hôm nay).
  const dd = parseStrictYmd(input.billDate);
  if (!dd) return { ok: false, error: 'VALIDATION', message: 'Ngày hóa đơn không hợp lệ (yyyy-mm-dd, ngày có thật).' };

  // BILL-04/05/09: số tiền STRICT — không strip/mutate, không mảng → VALIDATION.
  const { targets, invalid } = parseTargets(input.targets);
  if (invalid !== 0) {
    return { ok: false, error: 'VALIDATION', message: invalid < 0 ? 'Danh sách số tiền không hợp lệ.' : `${invalid} số tiền không hợp lệ (số nguyên dương ≤ ${MAX_TARGET}, không âm/thập phân/chữ).` };
  }
  if (!targets.length) return { ok: false, error: 'VALIDATION', message: 'Chưa có số tiền hợp lệ nào để sinh bill.' };
  // Trần thực tế 1 hóa đơn (KHÔNG tách): số nào > 299tr → báo rõ, không sinh (giữ số lượng dòng cân đối).
  const overCeil = targets.filter((t) => t > REAL_CEILING);
  if (overCeil.length) {
    return { ok: false, error: 'VALIDATION', message: `Mỗi hóa đơn tối đa ${REAL_CEILING.toLocaleString('vi-VN')}đ (số tiền thực tế 1 hóa đơn). Có ${overCeil.length} số vượt trần — hãy nhập số nhỏ hơn (vd chia thành nhiều hóa đơn).` };
  }

  const products = await db.product.findMany({ where: { industryId: input.industryId, status: 'ACTIVE', deletedAt: null }, select: { name: true, unit: true, price: true, priority: true } });
  const productLites: ProductLite[] = products.map((p) => ({ name: p.name, unit: p.unit, price: p.price, priority: p.priority }));
  if (!productLites.length) return { ok: false, error: 'NO_PRODUCTS', message: 'Thư viện sản phẩm của ngành nghề này đang trống — thêm sản phẩm trước khi sinh bill.' };

  const templatePath = await resolveTemplatePath(db);
  const outputDir = await resolveOutputDir(db);
  const billNoYear = Number(await getSetting(db, K_BILL_YEAR)) || dd.y;

  // BILL-06 (race/TOCTOU): cấp DẢI số hóa đơn ATOMIC dưới advisory lock trong 1 transaction — 2 request đồng
  // thời nhận dải KHÔNG chồng nhau (đọc-tăng-ghi không tách rời). Dùng tx.appSetting trực tiếp (không qua helper
  // để khớp kiểu client-trong-tx). Reserve targets.length số (dôi vài số nếu vài target không khớp = vô hại).
  const billNoStart = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${BILLNO_LOCK})`);
    const row = await tx.appSetting.findUnique({ where: { key: K_BILL_NO } });
    const cur = Number(row?.value) || 1;
    const next = String(cur + targets.length);
    await tx.appSetting.upsert({ where: { key: K_BILL_NO }, update: { value: next }, create: { key: K_BILL_NO, value: next } });
    await tx.appSetting.upsert({ where: { key: K_BILL_YEAR }, update: { value: String(billNoYear) }, create: { key: K_BILL_YEAR, value: String(billNoYear) } });
    return cur;
  });

  let result;
  try {
    result = await renderBills({
      templatePath, outputDir, products: productLites, targets,
      common: {
        hkd_name: dossier.hkdName || '',
        hkd_address: dossier.hkdAddress || '',
        seller: dossier.ownerName || '', // người bán = chủ hộ (chốt Mr.Long 16/7)
        day: dd.d, month: dd.m, year: dd.y
      },
      billNoStart, billNoYear
    });
  } catch (e) {
    return { ok: false, error: 'RENDER_FAILED', message: e instanceof Error ? e.message : 'Sinh bill thất bại.' };
  }

  // BILL-05: tổng = Σ BigInt (KHÔNG qua Number → không mất chữ số dù nhiều số lớn).
  const totalAmount = targets.reduce((s, t) => s + BigInt(t), 0n);
  let rec;
  try {
    // LOW-A (audit đa-agent 16/7): gộp create bill + writeAudit vào CÙNG transaction (mẫu B44) → bill và
    // vết audit ATOMIC. Trước đây audit nằm SAU commit + không try/catch → nếu audit ném thì bill có thật
    // nhưng THIẾU vết + hàm reject (không mở được file). Nay: audit fail → rollback cả bill → dọn file.
    rec = await db.$transaction(async (tx) => {
      const code = await nextCode(BILL_CODE_PREFIX, tx);
      const created = await tx.billExplain.create({
        data: {
          code, dossierId: input.dossierId, tidId: input.tidId ?? null, industryId: input.industryId,
          billDate: new Date(Date.UTC(dd.y, dd.m - 1, dd.d)), totalAmount,
          billCount: result.totalBills, filePath: result.file, createdBy: user.id
        }
      });
      await writeAuditStrict(tx, {
        actorUserId: user.id, action: 'BILLEXPLAIN_CREATED', targetType: 'BillExplain', targetId: String(created.id),
        after: auditSnapshot({ code: created.code, dossierId: input.dossierId, tidCode, industryId: input.industryId, billCount: result.totalBills, totalAmount: totalAmount.toString(), file: result.file })
      });
      return created;
    });
  } catch (e) {
    // BILL-07 (B1, Mr.Long 16/7 "cấm nợ kỹ thuật"): render tạo file TRƯỚC khi lưu DB. Nếu lưu DB/audit thất bại →
    // DỌN file mồ côi (không để rác + không claim đã lưu). Số HĐ đã cấp atomic (BILL-06) — dôi số vô hại.
    // LOW-B: log khi cleanup thất bại (đừng nuốt lặng → còn manh mối nếu file bị khóa còn sót).
    await unlink(result.file).catch((ue) => { console.warn('[billExplain] dọn file mồ côi thất bại:', result.file, ue instanceof Error ? ue.message : ue); });
    return { ok: false, error: 'DB_FAILED', message: e instanceof Error ? e.message : 'Lưu bill vào cơ sở dữ liệu thất bại.' };
  }
  return { ok: true, id: rec.id, file: result.file, totalBills: result.totalBills, errors: result.errors };
}

export interface BillExplainFilter {
  dossierId?: number;
  industryId?: number;
  fromDate?: string;
  toDate?: string;
}
export async function listBillExplains(filter: BillExplainFilter = {}): Promise<{ ok: boolean; data?: BillExplainDto[]; error?: string; message?: string }> {
  const g = await requirePermission('BILLEXPLAIN_VIEW', { action: 'BILLEXPLAIN_VIEW' });
  if (!g.ok) return g;
  const { db } = g;
  const rows = await db.billExplain.findMany({
    where: { deletedAt: null, dossierId: filter.dossierId ?? undefined, industryId: filter.industryId ?? undefined, createdAt: dateRange(filter.fromDate, filter.toDate) },
    orderBy: { id: 'desc' }
  });
  const dossierIds = [...new Set(rows.map((r) => r.dossierId))];
  const tidIds = [...new Set(rows.map((r) => r.tidId).filter((x): x is number => x != null))];
  const industryIds = [...new Set(rows.map((r) => r.industryId))];
  const userIds = [...new Set(rows.map((r) => r.createdBy).filter((x): x is number => x != null))];
  const [dossiers, tids, industries, users] = await Promise.all([
    dossierIds.length ? db.dossier.findMany({ where: { id: { in: dossierIds } }, select: { id: true, hkdName: true } }) : Promise.resolve([]),
    tidIds.length ? db.tid.findMany({ where: { id: { in: tidIds } }, select: { id: true, tid: true } }) : Promise.resolve([]),
    industryIds.length ? db.industry.findMany({ where: { id: { in: industryIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, username: true } }) : Promise.resolve([])
  ]);
  const dMap = new Map(dossiers.map((x) => [x.id, x.hkdName]));
  const tMap = new Map(tids.map((x) => [x.id, x.tid]));
  const iMap = new Map(industries.map((x) => [x.id, x.name]));
  const uMap = new Map(users.map((x) => [x.id, x.fullName || x.username]));
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id, code: r.code, dossierId: r.dossierId, dossierName: dMap.get(r.dossierId) ?? null,
      tidId: r.tidId, tidCode: r.tidId != null ? tMap.get(r.tidId) ?? null : null,
      industryId: r.industryId, industryName: iMap.get(r.industryId) ?? null,
      billDate: r.billDate.toISOString(), totalAmount: Number(r.totalAmount), billCount: r.billCount,
      filePath: r.filePath, createdByName: r.createdBy != null ? uMap.get(r.createdBy) ?? null : null, createdAt: r.createdAt.toISOString()
    }))
  };
}

export async function deleteBillExplains(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission('BILLEXPLAIN_DELETE', { action: 'BILLEXPLAIN_DELETED', targetType: 'BillExplain' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn bill để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'BILLEXPLAIN_DELETED', targetType: 'BillExplain', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.billExplain.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.billExplain.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'BILLEXPLAIN_DELETED', targetType: 'BillExplain', targetId: String(id), before: auditSnapshot({ code: row.code, billCount: row.billCount }) });
    deleted++;
  }
  return { ok: true, deleted };
}

// ═══════════════════════════════════════════════════════════════════════════════
// (C) CẤU HÌNH + TEMPLATE
// ═══════════════════════════════════════════════════════════════════════════════
export interface BillExplainConfigDto {
  outputDir: string;
  billNoStart: number;
  billNoYear: number;
  templatePath: string; // mẫu đang dùng (đường dẫn thực)
  templateIsCustom: boolean;
}
export async function getBillExplainConfig(): Promise<{ ok: boolean; data?: BillExplainConfigDto; error?: string; message?: string }> {
  const g = await requirePermission('BILLEXPLAIN_VIEW', { action: 'BILLEXPLAIN_VIEW' });
  if (!g.ok) return g;
  const { db } = g;
  const custom = await getSetting(db, K_TEMPLATE_PATH);
  const templateIsCustom = !!(custom && existsSync(custom));
  return {
    ok: true,
    data: {
      outputDir: await resolveOutputDir(db),
      billNoStart: Number(await getSetting(db, K_BILL_NO)) || 1,
      billNoYear: Number(await getSetting(db, K_BILL_YEAR)) || new Date().getFullYear(),
      templatePath: templateIsCustom ? custom! : defaultTemplatePath(),
      templateIsCustom
    }
  };
}
export interface SetBillExplainConfigInput {
  outputDir?: string;
  billNoStart?: number;
  billNoYear?: number;
}
export async function setBillExplainConfig(input: SetBillExplainConfigInput): Promise<MutationResult> {
  const g = await requirePermission('BILLEXPLAIN_CREATE', { action: 'BILLEXPLAIN_CREATED', targetType: 'BillExplain' });
  if (!g.ok) return g;
  const { db } = g;
  if (input.outputDir !== undefined) {
    const d = input.outputDir.trim();
    // LOW-C: nếu path đã tồn tại thì PHẢI là thư mục (chống lưu cấu hình trỏ vào file thực thi → openFolder RCE).
    if (d && existsSync(d)) {
      try { if (!statSync(d).isDirectory()) return { ok: false, error: 'VALIDATION', message: 'Đường dẫn lưu bill phải là thư mục.' }; } catch { /* không stat được → để resolveOutputDir/mkdir xử lý sau */ }
    }
    await setSetting(db, K_OUTPUT_DIR, d);
  }
  if (input.billNoStart !== undefined && Number.isFinite(input.billNoStart) && input.billNoStart >= 1) await setSetting(db, K_BILL_NO, String(Math.floor(input.billNoStart)));
  if (input.billNoYear !== undefined && Number.isFinite(input.billNoYear)) await setSetting(db, K_BILL_YEAR, String(Math.floor(input.billNoYear)));
  return { ok: true };
}

/** Import mẫu hóa đơn RIÊNG: dialog chọn .xlsx → copy vào userData → lưu đường dẫn AppSetting. */
export async function importInvoiceTemplate(): Promise<{ ok: boolean; error?: string; message?: string; templatePath?: string }> {
  const g = await requirePermission('PRODUCT_MANAGE', { action: 'BILLEXPLAIN_CREATED', targetType: 'BillExplain' });
  if (!g.ok) return g;
  const { db } = g;
  const win = BrowserWindow.getFocusedWindow();
  const opts: Electron.OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'Excel', extensions: ['xlsx'] }], title: 'Chọn mẫu hóa đơn (.xlsx)' };
  const pick = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (pick.canceled || !pick.filePaths[0]) return { ok: false, error: 'CANCELLED' };
  const src = pick.filePaths[0];
  // Kiểm nhanh: đúng file .xlsx (zip có sheet1) — thử load bằng engine để chặn file hỏng.
  try {
    const { TemplateZip } = await import('./billexplain/template-zip.js');
    await TemplateZip.fromFile(src);
  } catch (e) {
    return { ok: false, error: 'INVALID_TEMPLATE', message: 'File không phải mẫu Excel hợp lệ: ' + (e instanceof Error ? e.message : '') };
  }
  const dst = path.join(app.getPath('userData'), CUSTOM_TEMPLATE_FILE);
  await copyFile(src, dst);
  await setSetting(db, K_TEMPLATE_PATH, dst);
  await writeAudit(db, { actorUserId: g.user.id, action: 'BILLEXPLAIN_CREATED', targetType: 'BillExplain', after: { templateImported: dst } });
  return { ok: true, templatePath: dst };
}

/** Dùng lại mẫu MẶC ĐỊNH (xóa mẫu riêng). */
export async function resetInvoiceTemplate(): Promise<MutationResult> {
  const g = await requirePermission('PRODUCT_MANAGE', { action: 'BILLEXPLAIN_CREATED', targetType: 'BillExplain' });
  if (!g.ok) return g;
  await setSetting(g.db, K_TEMPLATE_PATH, '');
  return { ok: true };
}

/** Lấy đường dẫn file bill đã sinh (tab Theo dõi) — path từ DB (không nhận input renderer) + kiểm quyền =
 *  an toàn RCE. Handler mở bằng shell.openPath. */
export async function getBillFilePath(id: number): Promise<{ ok: boolean; error?: string; message?: string; path?: string }> {
  const g = await requirePermission('BILLEXPLAIN_VIEW', { action: 'BILLEXPLAIN_VIEW' });
  if (!g.ok) return g;
  const row = await g.db.billExplain.findUnique({ where: { id }, select: { filePath: true, deletedAt: true } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Bill không tồn tại.' };
  if (!existsSync(row.filePath)) return { ok: false, error: 'FILE_MISSING', message: 'File đã bị di chuyển hoặc xóa khỏi ổ đĩa.' };
  return { ok: true, path: row.filePath };
}

/** Đường dẫn THƯ MỤC chứa bill đã sinh (path từ cấu hình DB — an toàn RCE). Tạo nếu chưa có để "mở
 *  thư mục" luôn dùng được. Handler mở bằng shell.openPath. (Mr.Long 16/7: "nút mở folder chứa bill".) */
export async function getBillOutputDir(): Promise<{ ok: boolean; error?: string; message?: string; path?: string }> {
  const g = await requirePermission('BILLEXPLAIN_VIEW', { action: 'BILLEXPLAIN_VIEW' });
  if (!g.ok) return g;
  const dir = await resolveOutputDir(g.db);
  try {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  } catch (e) {
    return { ok: false, error: 'MKDIR_FAILED', message: e instanceof Error ? e.message : 'Không tạo được thư mục.' };
  }
  // LOW-C (audit đa-agent 16/7): outputDir do người dùng cấu hình → PHẢI là THƯ MỤC thật trước khi shell.openPath
  // (nếu trỏ nhầm/cố ý vào .exe/.bat/.lnk thì openPath sẽ THỰC THI). Defense-in-depth (nối B51 file:open RCE).
  try {
    if (!statSync(dir).isDirectory()) return { ok: false, error: 'NOT_A_DIR', message: 'Đường dẫn lưu bill không phải thư mục — kiểm tra lại cấu hình.' };
  } catch {
    return { ok: false, error: 'NOT_A_DIR', message: 'Không truy cập được thư mục lưu bill.' };
  }
  return { ok: true, path: dir };
}

/** Xuất mẫu hóa đơn ĐANG DÙNG ra file người dùng chọn (để xem/sửa). */
export async function exportInvoiceTemplate(): Promise<{ ok: boolean; error?: string; message?: string; file?: string }> {
  const g = await requirePermission('BILLEXPLAIN_VIEW', { action: 'BILLEXPLAIN_VIEW' });
  if (!g.ok) return g;
  const src = await resolveTemplatePath(g.db);
  if (!existsSync(src)) return { ok: false, error: 'NOT_FOUND', message: 'Không tìm thấy mẫu hóa đơn hiện tại.' };
  const win = BrowserWindow.getFocusedWindow();
  const opts: Electron.SaveDialogOptions = { defaultPath: 'MAU_HOA_DON.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }], title: 'Xuất mẫu hóa đơn' };
  const pick = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (pick.canceled || !pick.filePath) return { ok: false, error: 'CANCELLED' };
  const buf = await readFile(src);
  await writeFile(pick.filePath, buf);
  return { ok: true, file: pick.filePath };
}
