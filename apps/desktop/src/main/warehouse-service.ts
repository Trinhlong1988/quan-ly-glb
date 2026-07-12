// R27 (Mr.Long 12/7) — Danh mục Kho service (main). Master-data chuẩn khuôn Bank/Partner:
// permission-guarded (CONFIG_WAREHOUSE_VIEW/MANAGE), audited (before/after), soft-delete, R_UX_WARN
// (message tiếng Việt cụ thể), optimistic-lock (R48 #2). Kho có địa chỉ → giao máy "chọn kho → hiện địa chỉ".
import { auditSnapshot } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { dateRange } from './customer-service.js';
import { staleGuard } from './optimistic-lock.js';

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

/** Bắt P2002 (unique) → DUPLICATE (mã bị bản đã-xóa-mềm giữ, pre-check lọc deletedAt không thấy). */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

export interface AuditTrail {
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedBy: number | null;
  updatedByName: string | null;
  updatedAt: string;
}

async function resolveUserNames(db: Db, ids: (number | null | undefined)[]): Promise<Map<number, string>> {
  const uniq = [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
  const map = new Map<number, string>();
  if (uniq.length === 0) return map;
  const users = await db.user.findMany({ where: { id: { in: uniq } }, select: { id: true, fullName: true, username: true } });
  for (const u of users) map.set(u.id, u.fullName || u.username);
  return map;
}

function trail(row: { createdBy: number | null; createdAt: Date; updatedBy: number | null; updatedAt: Date }, names: Map<number, string>): AuditTrail {
  return {
    createdBy: row.createdBy,
    createdByName: row.createdBy != null ? names.get(row.createdBy) ?? null : null,
    createdAt: row.createdAt.toISOString(),
    updatedBy: row.updatedBy,
    updatedByName: row.updatedBy != null ? names.get(row.updatedBy) ?? null : null,
    updatedAt: row.updatedAt.toISOString()
  };
}

export interface WarehouseDto extends AuditTrail {
  id: number;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  note: string | null;
  status: string; // ACTIVE | INACTIVE
}
export interface WarehouseFilter {
  search?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
}
export interface CreateWarehouseInput {
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  note?: string | null;
  status?: string;
}
export interface UpdateWarehouseInput {
  code?: string;
  name?: string;
  address?: string | null;
  phone?: string | null;
  note?: string | null;
  status?: string;
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock — mốc updatedAt client giữ lúc mở form
}

export async function listWarehouses(filter: WarehouseFilter = {}): Promise<{ ok: boolean; data?: WarehouseDto[]; error?: string; message?: string }> {
  const g = await requirePermission('CONFIG_WAREHOUSE_VIEW', { action: 'CONFIG_WAREHOUSE_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.warehouse.findMany({
    where: {
      deletedAt: null,
      status: filter.status || undefined,
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search
        ? [
            { code: { contains: filter.search, mode: 'insensitive' } },
            { name: { contains: filter.search, mode: 'insensitive' } },
            { address: { contains: filter.search, mode: 'insensitive' } }
          ]
        : undefined
    },
    orderBy: { code: 'asc' }
  });
  const names = await resolveUserNames(g.db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  return {
    ok: true,
    data: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, address: r.address, phone: r.phone, note: r.note, status: r.status, ...trail(r, names) }))
  };
}

export async function createWarehouse(input: CreateWarehouseInput): Promise<MutationResult> {
  const g = await requirePermission('CONFIG_WAREHOUSE_MANAGE', { action: 'WAREHOUSE_CREATED', targetType: 'Warehouse' });
  if (!g.ok) return g;
  const { db, user } = g;

  const code = input.code?.trim().toUpperCase();
  const name = input.name?.trim();
  const status = input.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã kho bắt buộc.' };
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên kho bắt buộc.' };

  const dup = await db.warehouse.findFirst({ where: { code } });
  if (dup) {
    return dup.deletedAt
      ? { ok: false, error: 'DUPLICATE_TRASH', message: `Mã kho "${code}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn mã khác.` }
      : { ok: false, error: 'DUPLICATE', message: `Mã kho "${code}" đã tồn tại.` };
  }

  let created;
  try {
    created = await db.warehouse.create({
      data: { code, name, address: input.address?.trim() || null, phone: input.phone?.trim() || null, note: input.note?.trim() || null, status, createdBy: user.id }
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Mã kho "${code}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'WAREHOUSE_CREATED',
    targetType: 'Warehouse',
    targetId: String(created.id),
    after: auditSnapshot({ code: created.code, name: created.name, address: created.address })
  });
  return { ok: true, id: created.id };
}

export async function updateWarehouse(id: number, input: UpdateWarehouseInput): Promise<MutationResult> {
  const g = await requirePermission('CONFIG_WAREHOUSE_MANAGE', { action: 'WAREHOUSE_UPDATED', targetType: 'Warehouse', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.warehouse.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Kho không tồn tại.' };
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;

  const code = input.code !== undefined ? input.code.trim().toUpperCase() : row.code;
  const name = input.name !== undefined ? input.name.trim() : row.name;
  const status = input.status !== undefined ? (input.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') : row.status;
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã kho không được để trống.' };
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên kho không được để trống.' };
  if (code !== row.code) {
    const dup = await db.warehouse.findFirst({ where: { code, NOT: { id } } });
    if (dup) {
      return dup.deletedAt
        ? { ok: false, error: 'DUPLICATE_TRASH', message: `Mã kho "${code}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn mã khác.` }
        : { ok: false, error: 'DUPLICATE', message: `Mã kho "${code}" đã tồn tại.` };
    }
  }

  const before = auditSnapshot({ code: row.code, name: row.name, address: row.address, phone: row.phone, status: row.status });
  let updated;
  try {
    updated = await db.warehouse.update({
      where: { id },
      data: {
        code,
        name,
        address: input.address !== undefined ? input.address?.trim() || null : row.address,
        phone: input.phone !== undefined ? input.phone?.trim() || null : row.phone,
        note: input.note !== undefined ? input.note?.trim() || null : row.note,
        status,
        updatedBy: user.id
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Mã kho "${code}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'WAREHOUSE_UPDATED',
    targetType: 'Warehouse',
    targetId: String(id),
    before,
    after: auditSnapshot({ code: updated.code, name: updated.name, address: updated.address, phone: updated.phone, status: updated.status })
  });
  return { ok: true, id };
}

/** Xóa mềm 1 hoặc nhiều kho (bulk). Nhập lại mật khẩu (§14). */
export async function deleteWarehouses(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission('CONFIG_WAREHOUSE_MANAGE', { action: 'WAREHOUSE_DELETED', targetType: 'Warehouse' });
  if (!g.ok) return g;
  const { db, user } = g;

  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn kho để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'WAREHOUSE_DELETED', targetType: 'Warehouse', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }

  let deleted = 0;
  for (const id of ids) {
    const row = await db.warehouse.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.warehouse.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'WAREHOUSE_DELETED',
      targetType: 'Warehouse',
      targetId: String(id),
      before: auditSnapshot({ code: row.code, name: row.name })
    });
    deleted++;
  }
  return { ok: true, deleted };
}

/** Danh sách kho gọn (id/code/name/address) cho dropdown "Từ kho" khi giao máy — chỉ kho ACTIVE. */
export async function listWarehousesLite(): Promise<{ ok: boolean; data?: { id: number; code: string; name: string; address: string | null }[]; error?: string; message?: string }> {
  const g = await requirePermission('CONFIG_WAREHOUSE_VIEW', { action: 'CONFIG_WAREHOUSE_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.warehouse.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, address: true } });
  return { ok: true, data: rows };
}
