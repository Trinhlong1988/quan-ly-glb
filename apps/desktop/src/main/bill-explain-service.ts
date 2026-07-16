// Bill giải trình service (main) — Mr.Long 16/7.
// (A) Thư viện sản phẩm (Product) theo ngành nghề: CRUD + import + soft-delete, quyền PRODUCT_MANAGE / BILLEXPLAIN_VIEW.
// (B) Sinh bill giải trình: chọn HKD (hồ sơ) + TID (chỉ theo dõi) + ngành → nhập/nạp danh sách SỐ TIỀN → engine
//     sinh dòng SP khớp tổng → clone template → xuất .xlsx → lưu BillExplain (tab theo dõi). Quyền BILLEXPLAIN_CREATE.
// (C) Template hóa đơn: mặc định đóng gói (extraResources) / import mẫu riêng / xuất mẫu. Cấu hình lưu AppSetting.
// KHÔNG in TID/MST lên hóa đơn (chốt Mr.Long 16/7). Người bán = chủ hộ HKD. Audit đầy đủ (R_AUDIT_TRAIL).
import { app, dialog, BrowserWindow } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { auditSnapshot } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
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
  status?: string;
}
export interface UpdateProductInput {
  industryId?: number;
  name?: string;
  unit?: string;
  price?: number;
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
/** Đơn giá hợp lệ: số nguyên dương (đồng VND). */
function validPrice(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d]/g, ''));
  if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) return null;
  return n;
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
      name: r.name, unit: r.unit, price: r.price, status: r.status,
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

  const created = await db.product.create({
    data: { industryId: input.industryId, name, unit, price, status: input.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE', createdBy: user.id }
  });
  await writeAudit(db, {
    actorUserId: user.id, action: 'PRODUCT_CREATED', targetType: 'Product', targetId: String(created.id),
    after: auditSnapshot({ industryId: created.industryId, name: created.name, unit: created.unit, price: created.price, status: created.status })
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

  const before = auditSnapshot({ industryId: row.industryId, name: row.name, unit: row.unit, price: row.price, status: row.status });
  const updated = await db.product.update({
    where: { id },
    data: {
      industryId: input.industryId ?? row.industryId,
      name, unit, price,
      status: input.status !== undefined ? (input.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') : row.status,
      updatedBy: user.id
    }
  });
  await writeAudit(db, {
    actorUserId: user.id, action: 'PRODUCT_UPDATED', targetType: 'Product', targetId: String(id), before,
    after: auditSnapshot({ industryId: updated.industryId, name: updated.name, unit: updated.unit, price: updated.price, status: updated.status })
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
export async function importProducts(industryId: number, rows: { name?: string; unit?: string; price?: unknown }[]): Promise<MutationResult & { imported?: number; skipped?: number }> {
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
    await db.product.create({ data: { industryId, name, unit, price, status: 'ACTIVE', createdBy: user.id } });
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

function parseTargets(list: (number | string)[]): number[] {
  const out: number[] = [];
  for (const raw of list) {
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d]/g, ''));
    if (Number.isFinite(n) && n > 0 && Math.floor(n) === n) out.push(n);
  }
  return out;
}
function parseISODate(s: string): { year: number; month: number; day: number } {
  const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { year: +m[1], month: +m[2], day: +m[3] };
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

export async function generateBills(input: GenerateBillsInput): Promise<GenerateBillsResult> {
  const g = await requirePermission('BILLEXPLAIN_CREATE', { action: 'BILLEXPLAIN_CREATED', targetType: 'BillExplain' });
  if (!g.ok) return g;
  const { db, user } = g;

  const dossier = await db.dossier.findUnique({ where: { id: input.dossierId } });
  if (!dossier || dossier.deletedAt) return { ok: false, error: 'VALIDATION', message: 'Hồ sơ HKD không tồn tại.' };
  if (!input.industryId) return { ok: false, error: 'VALIDATION', message: 'Chọn nhóm ngành nghề.' };
  let tidCode: string | null = null;
  if (input.tidId != null) {
    const tid = await db.tid.findUnique({ where: { id: input.tidId }, select: { id: true, tid: true, deletedAt: true } });
    if (!tid || tid.deletedAt) return { ok: false, error: 'VALIDATION', message: 'TID không tồn tại.' };
    tidCode = tid.tid;
  }
  const targets = parseTargets(input.targets);
  if (!targets.length) return { ok: false, error: 'VALIDATION', message: 'Chưa có số tiền hợp lệ nào để sinh bill.' };

  const products = await db.product.findMany({ where: { industryId: input.industryId, status: 'ACTIVE', deletedAt: null }, select: { name: true, unit: true, price: true } });
  const productLites: ProductLite[] = products.map((p) => ({ name: p.name, unit: p.unit, price: p.price }));
  if (!productLites.length) return { ok: false, error: 'NO_PRODUCTS', message: 'Thư viện sản phẩm của ngành nghề này đang trống — thêm sản phẩm trước khi sinh bill.' };

  const templatePath = await resolveTemplatePath(db);
  const outputDir = await resolveOutputDir(db);
  const d = parseISODate(input.billDate);
  const billNoStart = Number(await getSetting(db, K_BILL_NO)) || 1;
  const billNoYear = Number(await getSetting(db, K_BILL_YEAR)) || d.year;

  let result;
  try {
    result = await renderBills({
      templatePath, outputDir, products: productLites, targets,
      common: {
        hkd_name: dossier.hkdName || '',
        hkd_address: dossier.hkdAddress || '',
        seller: dossier.ownerName || '', // người bán = chủ hộ (chốt Mr.Long 16/7)
        day: d.day, month: d.month, year: d.year
      },
      billNoStart, billNoYear
    });
  } catch (e) {
    return { ok: false, error: 'RENDER_FAILED', message: e instanceof Error ? e.message : 'Sinh bill thất bại.' };
  }

  // Tăng số HĐ kế tiếp (theo số bill thực sinh) để lần sau không trùng số.
  await setSetting(db, K_BILL_NO, String(billNoStart + result.totalBills));
  await setSetting(db, K_BILL_YEAR, String(billNoYear));

  const totalAmount = targets.reduce((s, t) => s + t, 0);
  const rec = await db.$transaction(async (tx) => {
    const code = await nextCode(BILL_CODE_PREFIX, tx);
    return tx.billExplain.create({
      data: {
        code, dossierId: input.dossierId, tidId: input.tidId ?? null, industryId: input.industryId,
        billDate: new Date(input.billDate + 'T00:00:00'), totalAmount: BigInt(totalAmount),
        billCount: result.totalBills, filePath: result.file, createdBy: user.id
      }
    });
  });
  await writeAudit(db, {
    actorUserId: user.id, action: 'BILLEXPLAIN_CREATED', targetType: 'BillExplain', targetId: String(rec.id),
    after: auditSnapshot({ code: rec.code, dossierId: input.dossierId, tidCode, industryId: input.industryId, billCount: result.totalBills, totalAmount, file: result.file })
  });
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
  if (input.outputDir !== undefined) await setSetting(db, K_OUTPUT_DIR, input.outputDir.trim());
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
