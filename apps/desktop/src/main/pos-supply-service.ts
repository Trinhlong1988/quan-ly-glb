// Cấu hình chuỗi cung ứng máy POS (main). IMS_SPEC §C6–C8. Permission-guarded
// (CONFIG_POS_SUPPLY_VIEW/MANAGE), audited before/after (R_AUDIT_TRAIL), soft-delete,
// message tiếng Việt cụ thể (R_UX_WARN). Gồm: NCC (§C6) · Chủng loại POS (§C7) ·
// Trạng thái nhập (§C8a) · Nhập kho POS (§C8b).
// Mọi cột @unique trên bảng có deletedAt đều xử lý va chạm bản đã xóa mềm + lưới P2002 (bài học B05).
import { auditSnapshot } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { dateRange } from './customer-service.js';
import { staleGuard } from './optimistic-lock.js';

const VIEW = 'CONFIG_POS_SUPPLY_VIEW';
const MANAGE = 'CONFIG_POS_SUPPLY_MANAGE';

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}
export interface AuditTrail {
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedBy: number | null;
  updatedByName: string | null;
  updatedAt: string;
}

// ── helpers dùng chung ──
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}
/** Kết quả lỗi trùng: phân biệt bản đang sống (DUPLICATE) vs bản trong Thùng rác (DUPLICATE_TRASH). */
function dupResult(dup: { deletedAt: Date | null } | null, label: string, value: string): MutationResult | null {
  if (!dup) return null;
  return dup.deletedAt
    ? { ok: false, error: 'DUPLICATE_TRASH', message: `${label} "${value}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn giá trị khác.` }
    : { ok: false, error: 'DUPLICATE', message: `${label} "${value}" đã tồn tại.` };
}

async function resolveUserNames(db: Db, ids: (number | null | undefined)[]): Promise<Map<number, string>> {
  const uniq = [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
  const map = new Map<number, string>();
  if (uniq.length === 0) return map;
  const users = await db.user.findMany({ where: { id: { in: uniq } }, select: { id: true, fullName: true, username: true } });
  for (const u of users) map.set(u.id, u.fullName || u.username);
  return map;
}
function trail(
  row: { createdBy: number | null; createdAt: Date; updatedBy: number | null; updatedAt: Date },
  names: Map<number, string>
): AuditTrail {
  return {
    createdBy: row.createdBy,
    createdByName: row.createdBy != null ? names.get(row.createdBy) ?? null : null,
    createdAt: row.createdAt.toISOString(),
    updatedBy: row.updatedBy,
    updatedByName: row.updatedBy != null ? names.get(row.updatedBy) ?? null : null,
    updatedAt: row.updatedAt.toISOString()
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// §C6 — NHÀ CUNG CẤP (NCC)
// ═════════════════════════════════════════════════════════════════════════════
export interface SupplierDto extends AuditTrail {
  id: number;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  contactPerson: string | null;
}
export interface SupplierFilter {
  search?: string;
  fromDate?: string;
  toDate?: string;
}
export interface CreateSupplierInput {
  name: string;
  code: string;
  address?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
}
export interface UpdateSupplierInput {
  name?: string;
  code?: string;
  address?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock — mốc updatedAt client giữ lúc mở form
}

export async function listSuppliers(filter: SupplierFilter = {}): Promise<{ ok: boolean; data?: SupplierDto[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const rows = await g.db.supplier.findMany({
    where: {
      deletedAt: null,
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search
        ? [{ code: { contains: filter.search, mode: 'insensitive' } }, { name: { contains: filter.search, mode: 'insensitive' } }, { phone: { contains: filter.search, mode: 'insensitive' } }, { contactPerson: { contains: filter.search, mode: 'insensitive' } }]
        : undefined
    },
    orderBy: { id: 'asc' }
  });
  const names = await resolveUserNames(g.db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  return {
    ok: true,
    data: rows.map((r) => ({ id: r.id, name: r.name, code: r.code, address: r.address, phone: r.phone, contactPerson: r.contactPerson, ...trail(r, names) }))
  };
}

export async function listSuppliersLite(): Promise<{ ok: boolean; data?: { id: number; code: string; name: string }[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const rows = await g.db.supplier.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' }, select: { id: true, code: true, name: true } });
  return { ok: true, data: rows };
}

export async function createSupplier(input: CreateSupplierInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'SUPPLIER_CREATED', targetType: 'Supplier' });
  if (!g.ok) return g;
  const { db, user } = g;
  const name = input.name?.trim();
  const code = input.code?.trim().toUpperCase();
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên nhà cung cấp bắt buộc.' };
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã nhà cung cấp bắt buộc.' };
  const dup = dupResult(await db.supplier.findFirst({ where: { code } }), 'Mã nhà cung cấp', code);
  if (dup) return dup;
  let created;
  try {
    created = await db.supplier.create({
      data: { name, code, address: input.address?.trim() || null, phone: input.phone?.trim() || null, contactPerson: input.contactPerson?.trim() || null, createdBy: user.id }
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Mã nhà cung cấp "${code}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'SUPPLIER_CREATED', targetType: 'Supplier', targetId: String(created.id), after: auditSnapshot({ name, code, phone: created.phone }) });
  return { ok: true, id: created.id };
}

export async function updateSupplier(id: number, input: UpdateSupplierInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'SUPPLIER_UPDATED', targetType: 'Supplier', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.supplier.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Nhà cung cấp không tồn tại.' };
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;
  const name = input.name !== undefined ? input.name.trim() : row.name;
  const code = input.code !== undefined ? input.code.trim().toUpperCase() : row.code;
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên nhà cung cấp không được để trống.' };
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã nhà cung cấp không được để trống.' };
  if (code !== row.code) {
    const dup = dupResult(await db.supplier.findFirst({ where: { code, NOT: { id } } }), 'Mã nhà cung cấp', code);
    if (dup) return dup;
  }
  const before = auditSnapshot({ name: row.name, code: row.code, address: row.address, phone: row.phone, contactPerson: row.contactPerson });
  let updated;
  try {
    updated = await db.supplier.update({
      where: { id },
      data: {
        name,
        code,
        address: input.address !== undefined ? input.address?.trim() || null : row.address,
        phone: input.phone !== undefined ? input.phone?.trim() || null : row.phone,
        contactPerson: input.contactPerson !== undefined ? input.contactPerson?.trim() || null : row.contactPerson,
        updatedBy: user.id
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Mã nhà cung cấp "${code}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'SUPPLIER_UPDATED', targetType: 'Supplier', targetId: String(id), before, after: auditSnapshot({ name: updated.name, code: updated.code, phone: updated.phone }) });
  return { ok: true, id };
}

export async function deleteSuppliers(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission(MANAGE, { action: 'SUPPLIER_DELETED', targetType: 'Supplier' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn nhà cung cấp để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'SUPPLIER_DELETED', targetType: 'Supplier', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.supplier.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.supplier.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'SUPPLIER_DELETED', targetType: 'Supplier', targetId: String(id), before: auditSnapshot({ name: row.name, code: row.code }) });
    deleted++;
  }
  return { ok: true, deleted };
}

// ═════════════════════════════════════════════════════════════════════════════
// §C7 — CHỦNG LOẠI MÁY POS
// ═════════════════════════════════════════════════════════════════════════════
export interface PosModelDto extends AuditTrail {
  id: number;
  code: string;
  name: string;
}
export interface PosModelFilter {
  search?: string;
  fromDate?: string;
  toDate?: string;
}
export interface CreatePosModelInput {
  code: string;
  name: string;
}
export interface UpdatePosModelInput {
  code?: string;
  name?: string;
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock — mốc updatedAt client giữ lúc mở form
}

export async function listPosModels(filter: PosModelFilter = {}): Promise<{ ok: boolean; data?: PosModelDto[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const rows = await g.db.posModel.findMany({
    where: {
      deletedAt: null,
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search ? [{ code: { contains: filter.search, mode: 'insensitive' } }, { name: { contains: filter.search, mode: 'insensitive' } }] : undefined
    },
    orderBy: { id: 'asc' }
  });
  const names = await resolveUserNames(g.db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  return { ok: true, data: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, ...trail(r, names) })) };
}

export async function listPosModelsLite(): Promise<{ ok: boolean; data?: { id: number; code: string; name: string }[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const rows = await g.db.posModel.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' }, select: { id: true, code: true, name: true } });
  return { ok: true, data: rows };
}

export async function createPosModel(input: CreatePosModelInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'POS_MODEL_CREATED', targetType: 'PosModel' });
  if (!g.ok) return g;
  const { db, user } = g;
  const code = input.code?.trim().toUpperCase();
  const name = input.name?.trim();
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã máy POS bắt buộc.' };
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên máy POS bắt buộc.' };
  const dup = dupResult(await db.posModel.findFirst({ where: { code } }), 'Mã máy POS', code);
  if (dup) return dup;
  let created;
  try {
    created = await db.posModel.create({ data: { code, name, createdBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Mã máy POS "${code}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'POS_MODEL_CREATED', targetType: 'PosModel', targetId: String(created.id), after: auditSnapshot({ code, name }) });
  return { ok: true, id: created.id };
}

export async function updatePosModel(id: number, input: UpdatePosModelInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'POS_MODEL_UPDATED', targetType: 'PosModel', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.posModel.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Chủng loại máy POS không tồn tại.' };
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;
  const code = input.code !== undefined ? input.code.trim().toUpperCase() : row.code;
  const name = input.name !== undefined ? input.name.trim() : row.name;
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã máy POS không được để trống.' };
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên máy POS không được để trống.' };
  if (code !== row.code) {
    const dup = dupResult(await db.posModel.findFirst({ where: { code, NOT: { id } } }), 'Mã máy POS', code);
    if (dup) return dup;
  }
  const before = auditSnapshot({ code: row.code, name: row.name });
  let updated;
  try {
    updated = await db.posModel.update({ where: { id }, data: { code, name, updatedBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Mã máy POS "${code}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'POS_MODEL_UPDATED', targetType: 'PosModel', targetId: String(id), before, after: auditSnapshot({ code: updated.code, name: updated.name }) });
  return { ok: true, id };
}

export async function deletePosModels(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission(MANAGE, { action: 'POS_MODEL_DELETED', targetType: 'PosModel' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn chủng loại để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'POS_MODEL_DELETED', targetType: 'PosModel', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.posModel.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.posModel.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'POS_MODEL_DELETED', targetType: 'PosModel', targetId: String(id), before: auditSnapshot({ code: row.code, name: row.name }) });
    deleted++;
  }
  return { ok: true, deleted };
}

// ═════════════════════════════════════════════════════════════════════════════
// §C8a — TRẠNG THÁI NHẬP MÁY
// ═════════════════════════════════════════════════════════════════════════════
export interface IntakeStatusDto extends AuditTrail {
  id: number;
  name: string;
}
export interface CreateIntakeStatusInput {
  name: string;
}
export interface UpdateIntakeStatusInput {
  name?: string;
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock — mốc updatedAt client giữ lúc mở form
}

export async function listIntakeStatuses(): Promise<{ ok: boolean; data?: IntakeStatusDto[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const rows = await g.db.posIntakeStatus.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' } });
  const names = await resolveUserNames(g.db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  return { ok: true, data: rows.map((r) => ({ id: r.id, name: r.name, ...trail(r, names) })) };
}

export async function createIntakeStatus(input: CreateIntakeStatusInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'INTAKE_STATUS_CREATED', targetType: 'PosIntakeStatus' });
  if (!g.ok) return g;
  const { db, user } = g;
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên trạng thái nhập máy bắt buộc.' };
  const dup = dupResult(await db.posIntakeStatus.findFirst({ where: { name } }), 'Trạng thái nhập máy', name);
  if (dup) return dup;
  let created;
  try {
    created = await db.posIntakeStatus.create({ data: { name, createdBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Trạng thái nhập máy "${name}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'INTAKE_STATUS_CREATED', targetType: 'PosIntakeStatus', targetId: String(created.id), after: auditSnapshot({ name }) });
  return { ok: true, id: created.id };
}

export async function updateIntakeStatus(id: number, input: UpdateIntakeStatusInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'INTAKE_STATUS_UPDATED', targetType: 'PosIntakeStatus', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.posIntakeStatus.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Trạng thái nhập máy không tồn tại.' };
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;
  const name = input.name !== undefined ? input.name.trim() : row.name;
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên trạng thái không được để trống.' };
  if (name !== row.name) {
    const dup = dupResult(await db.posIntakeStatus.findFirst({ where: { name, NOT: { id } } }), 'Trạng thái nhập máy', name);
    if (dup) return dup;
  }
  const before = auditSnapshot({ name: row.name });
  let updated;
  try {
    updated = await db.posIntakeStatus.update({ where: { id }, data: { name, updatedBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Trạng thái nhập máy "${name}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'INTAKE_STATUS_UPDATED', targetType: 'PosIntakeStatus', targetId: String(id), before, after: auditSnapshot({ name: updated.name }) });
  return { ok: true, id };
}

export async function deleteIntakeStatuses(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission(MANAGE, { action: 'INTAKE_STATUS_DELETED', targetType: 'PosIntakeStatus' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn trạng thái để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'INTAKE_STATUS_DELETED', targetType: 'PosIntakeStatus', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.posIntakeStatus.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.posIntakeStatus.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'INTAKE_STATUS_DELETED', targetType: 'PosIntakeStatus', targetId: String(id), before: auditSnapshot({ name: row.name }) });
    deleted++;
  }
  return { ok: true, deleted };
}

// ═════════════════════════════════════════════════════════════════════════════
// §C8b — NHẬP KHO MÁY POS
// ═════════════════════════════════════════════════════════════════════════════
export interface PosIntakeDto extends AuditTrail {
  id: number;
  posModelId: number;
  posModelCode: string | null;
  posModelName: string | null;
  serial: string;
  bankId: number | null; // Cài APP — id app ngân hàng của máy (để prefill form Sửa). null = máy trắng.
  bankCode: string | null; // Cài APP — mã app ngân hàng của máy (resolve từ PosDevice theo serial). null = máy trắng.
  intakeStatusId: number;
  intakeStatusName: string | null;
  supplierId: number;
  supplierCode: string | null;
  supplierName: string | null;
  importPrice: number;
  importedAt: string;
  note: string | null;
}
export interface PosIntakeFilter {
  search?: string;
  posModelId?: number;
  supplierId?: number;
  intakeStatusId?: number;
  fromDate?: string;
  toDate?: string;
}
export interface CreatePosIntakeInput {
  posModelId: number;
  serial: string;
  intakeStatusId: number;
  supplierId: number;
  importPrice: number;
  importedAt: string; // yyyy-mm-dd hoặc ISO
  note?: string | null;
  warehouseId?: number | null; // Model 1 — nhập vào KHO nào (set PosDevice.warehouseId khi máy IN_STOCK)
  bankId?: number | null; // Cài APP (Mr.Long 13/7) — app ngân hàng cài sẵn (null/0 = MÁY TRẮNG, mặc định). Chỉ set khi tạo máy MỚI.
}
export interface UpdatePosIntakeInput {
  posModelId?: number;
  serial?: string;
  intakeStatusId?: number;
  supplierId?: number;
  importPrice?: number;
  importedAt?: string;
  note?: string | null;
  bankId?: number | null; // Cài APP — sửa app ngân hàng của MÁY (sync sang PosDevice theo serial). null/0 = máy trắng.
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock — mốc updatedAt client giữ lúc mở form
}

/** Kiểm tra giá nhập: số nguyên ≥ 0 (VND đồng). */
function normalizePrice(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}
/** Parse ngày nhập → Date (chấp nhận yyyy-mm-dd / ISO). Trả null nếu không hợp lệ. */
function parseImportedAt(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export async function listPosIntakes(filter: PosIntakeFilter = {}): Promise<{ ok: boolean; data?: PosIntakeDto[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const rows = await g.db.posIntake.findMany({
    where: {
      deletedAt: null,
      posModelId: filter.posModelId ?? undefined,
      supplierId: filter.supplierId ?? undefined,
      intakeStatusId: filter.intakeStatusId ?? undefined,
      importedAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search ? [{ serial: { contains: filter.search, mode: 'insensitive' } }, { note: { contains: filter.search, mode: 'insensitive' } }] : undefined
    },
    orderBy: { id: 'asc' }
  });
  const names = await resolveUserNames(g.db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  const modelMap = new Map((await g.db.posModel.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.posModelId))] } }, select: { id: true, code: true, name: true } })).map((m) => [m.id, m]));
  const supMap = new Map((await g.db.supplier.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.supplierId))] } }, select: { id: true, code: true, name: true } })).map((s) => [s.id, s]));
  const stMap = new Map((await g.db.posIntakeStatus.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.intakeStatusId))] } }, select: { id: true, name: true } })).map((s) => [s.id, s]));
  // Cài APP — resolve app ngân hàng của máy theo serial (bankId sống trên PosDevice, không trên PosIntake).
  const devs = await g.db.posDevice.findMany({ where: { serial: { in: [...new Set(rows.map((r) => r.serial))] } }, select: { serial: true, bankId: true } });
  const bankIds = [...new Set(devs.map((d) => d.bankId).filter((x): x is number => x != null))];
  const bankCodeMap = new Map((await g.db.bank.findMany({ where: { id: { in: bankIds } }, select: { id: true, code: true } })).map((b) => [b.id, b.code]));
  const serialBankIdMap = new Map(devs.map((d) => [d.serial, d.bankId]));
  const serialBankMap = new Map(devs.map((d) => [d.serial, d.bankId != null ? bankCodeMap.get(d.bankId) ?? null : null]));
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      posModelId: r.posModelId,
      posModelCode: modelMap.get(r.posModelId)?.code ?? null,
      posModelName: modelMap.get(r.posModelId)?.name ?? null,
      serial: r.serial,
      bankId: serialBankIdMap.get(r.serial) ?? null,
      bankCode: serialBankMap.get(r.serial) ?? null,
      intakeStatusId: r.intakeStatusId,
      intakeStatusName: stMap.get(r.intakeStatusId)?.name ?? null,
      supplierId: r.supplierId,
      supplierCode: supMap.get(r.supplierId)?.code ?? null,
      supplierName: supMap.get(r.supplierId)?.name ?? null,
      importPrice: r.importPrice,
      importedAt: r.importedAt.toISOString(),
      note: r.note,
      ...trail(r, names)
    }))
  };
}

/** Xác thực các khóa tham chiếu (chủng loại / trạng thái / NCC) tồn tại & còn sống. */
async function validateRefs(db: Db, modelId: number, statusId: number, supplierId: number): Promise<MutationResult | null> {
  const model = await db.posModel.findUnique({ where: { id: modelId } });
  if (!model || model.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Chủng loại máy POS đã chọn không tồn tại.' };
  const status = await db.posIntakeStatus.findUnique({ where: { id: statusId } });
  if (!status || status.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Trạng thái nhập máy đã chọn không tồn tại.' };
  const sup = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!sup || sup.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Nhà cung cấp đã chọn không tồn tại.' };
  return null;
}

export async function createPosIntake(input: CreatePosIntakeInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'POS_INTAKE_CREATED', targetType: 'PosIntake' });
  if (!g.ok) return g;
  const { db, user } = g;
  const serial = input.serial?.trim();
  if (!input.posModelId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn chủng loại máy POS.' };
  if (!serial) return { ok: false, error: 'VALIDATION', message: 'Seri number bắt buộc.' };
  if (!input.intakeStatusId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn trạng thái nhập máy.' };
  if (!input.supplierId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn nhà cung cấp.' };
  const price = normalizePrice(input.importPrice);
  if (price === null) return { ok: false, error: 'VALIDATION', message: 'Giá nhập phải là số nguyên ≥ 0 (VND).' };
  const importedAt = parseImportedAt(input.importedAt);
  if (!importedAt) return { ok: false, error: 'VALIDATION', message: 'Ngày nhập không hợp lệ.' };
  const refErr = await validateRefs(db, input.posModelId, input.intakeStatusId, input.supplierId);
  if (refErr) return refErr;
  // Model 1 — kho nhập (nếu chọn) phải tồn tại (chống FK treo).
  if (input.warehouseId != null) {
    const wh = await db.warehouse.findFirst({ where: { id: input.warehouseId, deletedAt: null }, select: { id: true } });
    if (!wh) return { ok: false, error: 'NOT_FOUND', message: 'Kho nhập đã chọn không tồn tại (hoặc đã bị xóa).' };
  }
  // Cài APP — nếu chọn app ngân hàng (bankId>0) phải tồn tại + còn dùng (ACTIVE). null/0 = máy trắng.
  if (input.bankId != null && input.bankId > 0) {
    const bk = await db.bank.findFirst({ where: { id: input.bankId, deletedAt: null }, select: { id: true, status: true } });
    if (!bk) return { ok: false, error: 'NOT_FOUND', message: 'Ngân hàng (app) đã chọn không tồn tại.' };
    if (bk.status !== 'ACTIVE') return { ok: false, error: 'VALIDATION', message: 'Ngân hàng (app) đã ngừng sử dụng — không thể cài lên máy.' };
  }
  // HỒI SINH (Mr.Long "xóa hàng loạt rồi import lại không hiện ở danh sách"): nếu MÁY (PosDevice) của serial này
  // đã XÓA MỀM → nhập/import lại chính serial đó = hồi sinh máy → BỎ QUA chặn trùng (không phải trùng thật, là khôi phục).
  const existingDev = await db.posDevice.findUnique({ where: { serial } });
  const isResurrect = existingDev != null && existingDev.deletedAt != null;
  if (!isResurrect) {
    const dup = dupResult(await db.posIntake.findFirst({ where: { serial } }), 'Seri number', serial);
    if (dup) return dup;
  }
  // PHASE K1 (Q-P1, desync #22): tạo phiếu nhập + UPSERT PosDevice IN_STOCK + ghi AssetEvent(STOCK_IN)
  // trong CÙNG $transaction. PosDevice = nguồn sự thật DUY NHẤT → máy vừa nhập kho hiện ngay ở
  // "Danh sách máy" + gán TID được. Nếu serial đã là PosDevice đang chạy (DEPLOYED/…): chỉ cập nhật
  // cột nhập gần nhất, KHÔNG hạ status về IN_STOCK.
  let created;
  try {
    created = await db.$transaction(async (tx) => {
      // HỒI SINH → cập nhật PHIẾU NHẬP cũ (un-delete nếu có) thay vì tạo phiếu trùng serial; ngược lại tạo mới.
      const priorIntake = isResurrect ? await tx.posIntake.findFirst({ where: { serial } }) : null;
      const intake = priorIntake
        ? await tx.posIntake.update({ where: { id: priorIntake.id }, data: { posModelId: input.posModelId, intakeStatusId: input.intakeStatusId, supplierId: input.supplierId, importPrice: price, importedAt, note: input.note?.trim() || null, deletedAt: null, deletedBy: null, updatedBy: user.id } })
        : await tx.posIntake.create({ data: { posModelId: input.posModelId, serial, intakeStatusId: input.intakeStatusId, supplierId: input.supplierId, importPrice: price, importedAt, note: input.note?.trim() || null, createdBy: user.id } });
      // Khóa hàng máy (nếu có) FOR UPDATE trước khi đọc/cập nhật (chống tương tranh với transition).
      await tx.$queryRaw`SELECT id FROM pos_devices WHERE serial = ${serial} FOR UPDATE`;
      const existing = await tx.posDevice.findUnique({ where: { serial } });
      const intakeCols = { posModelId: input.posModelId, supplierId: input.supplierId, intakeStatusId: input.intakeStatusId, importPrice: price, importedAt };
      // FIX 3 (K1): chỉ ghi STOCK_IN khi máy MỚI tạo HOẶC đang IN_STOCK (đúng ngữ nghĩa "nhập kho").
      // Máy đã tồn tại ở trạng thái sống khác (DEPLOYED/DAMAGED/IN_REPAIR/RETIRED) → chỉ cập nhật cột
      // nhập (NCC/giá) → ghi event 'INTAKE_UPDATE', KHÔNG hạ status, KHÔNG nhiễu timeline bằng STOCK_IN giả.
      let fromState: string | null;
      let eventType: string;
      if (!existing) {
        // Máy mới nhập kho → IN_STOCK + gán KHO (Model 1: warehouseId≠null ⟺ IN_STOCK).
        // Cài APP: set bankId khi tạo MÁY MỚI (null/0 = máy trắng). Re-intake máy cũ KHÔNG đổi app (đổi qua Sửa máy).
        await tx.posDevice.create({ data: { serial, status: 'IN_STOCK', ...intakeCols, warehouseId: input.warehouseId ?? null, bankId: input.bankId && input.bankId > 0 ? input.bankId : null, createdBy: user.id } });
        fromState = null;
        eventType = 'STOCK_IN';
      } else if (existing.deletedAt != null) {
        // HỒI SINH (Mr.Long "xóa hàng loạt rồi import lại không hiện ở danh sách, cài app vẫn máy trắng"):
        // máy ĐÃ XÓA MỀM mà nhập/import lại serial đó → coi như NHẬP MỚI: bỏ deletedAt, về IN_STOCK, gán KHO +
        // Cài APP theo lần nhập này, XÓA gán cũ (TID/khách/đại lý) để không kéo trạng thái mồ côi từ trước khi xóa.
        await tx.posDevice.update({
          where: { id: existing.id },
          data: {
            ...intakeCols, deletedAt: null, deletedBy: null, status: 'IN_STOCK',
            warehouseId: input.warehouseId ?? null, bankId: input.bankId && input.bankId > 0 ? input.bankId : null,
            currentTid: null, currentCustomerId: null, currentAgentId: null, recallPending: false, updatedBy: user.id
          }
        });
        fromState = existing.status;
        eventType = 'STOCK_IN';
      } else {
        // GIỮ status/currentTid/currentCustomerId/currentAgentId — chỉ cập nhật cột nhập gần nhất.
        // Kho: CHỈ đổi khi máy đang IN_STOCK (đang ở kho); máy đang DEPLOYED/… thì KHÔNG gán kho (giữ đồng bộ bất biến).
        const whPatch = existing.status === 'IN_STOCK' ? { warehouseId: input.warehouseId ?? null } : {};
        await tx.posDevice.update({ where: { id: existing.id }, data: { ...intakeCols, ...whPatch, updatedBy: user.id } });
        fromState = existing.status;
        eventType = existing.status === 'IN_STOCK' ? 'STOCK_IN' : 'INTAKE_UPDATE';
      }
      const toState = existing ? (existing.deletedAt != null ? 'IN_STOCK' : existing.status) : 'IN_STOCK';
      await tx.assetEvent.create({
        data: {
          deviceSerial: serial,
          eventType,
          fromState,
          toState,
          actorUserId: user.id,
          occurredAt: importedAt,
          note: input.note?.trim() || null,
          afterJson: JSON.stringify(auditSnapshot({ serial, posModelId: input.posModelId, supplierId: input.supplierId, importPrice: price, status: toState }))
        }
      });
      return intake;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Seri number "${serial}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'POS_INTAKE_CREATED', targetType: 'PosIntake', targetId: String(created.id), after: auditSnapshot({ serial, posModelId: input.posModelId, supplierId: input.supplierId, importPrice: price }) });
  return { ok: true, id: created.id };
}

export async function updatePosIntake(id: number, input: UpdatePosIntakeInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'POS_INTAKE_UPDATED', targetType: 'PosIntake', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.posIntake.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Máy POS nhập kho không tồn tại.' };
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;
  const posModelId = input.posModelId ?? row.posModelId;
  const intakeStatusId = input.intakeStatusId ?? row.intakeStatusId;
  const supplierId = input.supplierId ?? row.supplierId; // cho phép chuyển NCC (§C8 b2)
  const serial = input.serial !== undefined ? input.serial.trim() : row.serial;
  if (!serial) return { ok: false, error: 'VALIDATION', message: 'Seri number không được để trống.' };
  const price = input.importPrice !== undefined ? normalizePrice(input.importPrice) : row.importPrice;
  if (price === null) return { ok: false, error: 'VALIDATION', message: 'Giá nhập phải là số nguyên ≥ 0 (VND).' };
  const importedAt = input.importedAt !== undefined ? parseImportedAt(input.importedAt) : row.importedAt;
  if (!importedAt) return { ok: false, error: 'VALIDATION', message: 'Ngày nhập không hợp lệ.' };
  const refErr = await validateRefs(db, posModelId, intakeStatusId, supplierId);
  if (refErr) return refErr;
  if (serial !== row.serial) {
    const dup = dupResult(await db.posIntake.findFirst({ where: { serial, NOT: { id } } }), 'Seri number', serial);
    if (dup) return dup;
  }
  // Cài APP — nếu sửa app ngân hàng (bankId>0) phải tồn tại + còn dùng (ACTIVE). null/0 = máy trắng.
  if (input.bankId != null && input.bankId > 0) {
    const bk = await db.bank.findFirst({ where: { id: input.bankId, deletedAt: null }, select: { id: true, status: true } });
    if (!bk) return { ok: false, error: 'NOT_FOUND', message: 'Ngân hàng (app) đã chọn không tồn tại.' };
    if (bk.status !== 'ACTIVE') return { ok: false, error: 'VALIDATION', message: 'Ngân hàng (app) đã ngừng sử dụng — không thể cài lên máy.' };
  }
  const before = auditSnapshot({ serial: row.serial, posModelId: row.posModelId, supplierId: row.supplierId, intakeStatusId: row.intakeStatusId, importPrice: row.importPrice });
  let updated;
  try {
    updated = await db.$transaction(async (tx) => {
      const up = await tx.posIntake.update({
        where: { id },
        data: { posModelId, serial, intakeStatusId, supplierId, importPrice: price, importedAt, note: input.note !== undefined ? input.note?.trim() || null : row.note, updatedBy: user.id }
      });
      // ĐỒNG BỘ Cài APP sang MÁY (bankId sống trên PosDevice, không trên PosIntake) — chỉ khi form gửi bankId.
      if (input.bankId !== undefined) {
        await tx.posDevice.updateMany({ where: { serial }, data: { bankId: input.bankId && input.bankId > 0 ? input.bankId : null, updatedBy: user.id } });
      }
      return up;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Seri number "${serial}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'POS_INTAKE_UPDATED', targetType: 'PosIntake', targetId: String(id), before, after: auditSnapshot({ serial: updated.serial, posModelId: updated.posModelId, supplierId: updated.supplierId, intakeStatusId: updated.intakeStatusId, importPrice: updated.importPrice }) });
  return { ok: true, id };
}

export async function deletePosIntakes(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission(MANAGE, { action: 'POS_INTAKE_DELETED', targetType: 'PosIntake' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn máy POS để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'POS_INTAKE_DELETED', targetType: 'PosIntake', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.posIntake.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.posIntake.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'POS_INTAKE_DELETED', targetType: 'PosIntake', targetId: String(id), before: auditSnapshot({ serial: row.serial }) });
    deleted++;
  }
  return { ok: true, deleted };
}
