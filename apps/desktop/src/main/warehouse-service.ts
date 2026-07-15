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
  // §4: địa chỉ + SĐT HIỆU LỰC — nếu có managerUserId thì lấy từ hồ sơ user quản lý (read-only), ngược
  // lại dùng cột address/phone của kho (dữ liệu kho cũ). UI hiển thị 2 trường này read-only.
  address: string | null;
  phone: string | null;
  managerUserId: number | null;
  managerUserName: string | null;
  note: string | null;
  status: string; // ACTIVE | INACTIVE
}
/** §4 — ứng viên User quản lý kho: chỉ user còn sống & ACTIVE, kèm địa chỉ + SĐT để form đổ read-only. */
export interface WarehouseManagerCandidate {
  id: number;
  fullName: string;
  username: string;
  phone: string | null;
  address: string | null;
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
  managerUserId?: number | null; // §4 — user quản lý (địa chỉ/SĐT đổ theo hồ sơ user)
  note?: string | null;
  status?: string;
}
export interface UpdateWarehouseInput {
  code?: string;
  name?: string;
  address?: string | null;
  phone?: string | null;
  managerUserId?: number | null; // §4
  note?: string | null;
  status?: string;
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock — mốc updatedAt client giữ lúc mở form
}

/** §4 — validate user quản lý kho tồn tại + còn sống + ACTIVE. null = bỏ gán (dùng address/phone kho). */
async function validateManager(db: Db, managerUserId: number | null | undefined): Promise<MutationResult | null> {
  if (managerUserId == null) return null;
  const u = await db.user.findUnique({ where: { id: managerUserId }, select: { id: true, deletedAt: true, status: true } });
  if (!u || u.deletedAt || u.status !== 'ACTIVE') return { ok: false, error: 'NOT_FOUND', message: 'User quản lý kho đã chọn không tồn tại hoặc không hoạt động.' };
  return null;
}

/** §4 — danh sách user đủ điều kiện làm quản lý kho (còn sống + ACTIVE). Gate CONFIG_WAREHOUSE_VIEW —
 *  đọc user trực tiếp (KHÔNG cần USER_READ) để vai kho vận vẫn chọn được, nhất quán cách tidRefs. */
export async function listWarehouseManagerCandidates(): Promise<{ ok: boolean; data?: WarehouseManagerCandidate[]; error?: string; message?: string }> {
  const g = await requirePermission('CONFIG_WAREHOUSE_VIEW', { action: 'CONFIG_WAREHOUSE_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.user.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true, username: true, phone: true, address: true } });
  return { ok: true, data: rows.map((u) => ({ id: u.id, fullName: u.fullName, username: u.username, phone: u.phone, address: u.address })) };
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
  // §4 — hồ sơ user quản lý (địa chỉ/SĐT/tên) để đổ read-only. Join tại service (batch, KHÔNG N+1).
  const mgrIds = [...new Set(rows.map((r) => r.managerUserId).filter((x): x is number => typeof x === 'number'))];
  const mgrs = new Map((await g.db.user.findMany({ where: { id: { in: mgrIds } }, select: { id: true, fullName: true, username: true, phone: true, address: true } })).map((u) => [u.id, u]));
  return {
    ok: true,
    data: rows.map((r) => {
      const m = r.managerUserId != null ? mgrs.get(r.managerUserId) : undefined;
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        address: m ? m.address : r.address,
        phone: m ? m.phone : r.phone,
        managerUserId: r.managerUserId,
        managerUserName: m ? m.fullName || m.username : null,
        note: r.note,
        status: r.status,
        ...trail(r, names)
      };
    })
  };
}

export async function createWarehouse(input: CreateWarehouseInput): Promise<MutationResult> {
  const g = await requirePermission('CONFIG_WAREHOUSE_MANAGE', { action: 'WAREHOUSE_CREATED', targetType: 'Warehouse' });
  if (!g.ok) return g;
  const { db, user } = g;

  const code = input.code?.trim().toUpperCase();
  const name = input.name?.trim();
  // REL-13 (audit 15/7, Codex): validate status thay vì coerce (typo trước đây âm thầm về 'ACTIVE').
  if (input.status !== undefined && input.status !== 'ACTIVE' && input.status !== 'INACTIVE') return { ok: false, error: 'VALIDATION', message: 'Trạng thái kho không hợp lệ.' };
  const status = input.status ?? 'ACTIVE';
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã kho bắt buộc.' };
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên kho bắt buộc.' };

  const mgrErr = await validateManager(db, input.managerUserId);
  if (mgrErr) return mgrErr;

  const dup = await db.warehouse.findFirst({ where: { code } });
  if (dup) {
    return dup.deletedAt
      ? { ok: false, error: 'DUPLICATE_TRASH', message: `Mã kho "${code}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn mã khác.` }
      : { ok: false, error: 'DUPLICATE', message: `Mã kho "${code}" đã tồn tại.` };
  }

  let created;
  try {
    created = await db.warehouse.create({
      data: { code, name, address: input.address?.trim() || null, phone: input.phone?.trim() || null, managerUserId: input.managerUserId ?? null, note: input.note?.trim() || null, status, createdBy: user.id }
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
  // REL-13 (audit 15/7, Codex): validate status thay vì coerce (typo → không còn âm thầm về 'ACTIVE').
  if (input.status !== undefined && input.status !== 'ACTIVE' && input.status !== 'INACTIVE') return { ok: false, error: 'VALIDATION', message: 'Trạng thái kho không hợp lệ.' };
  const status = input.status !== undefined ? input.status : row.status;
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã kho không được để trống.' };
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên kho không được để trống.' };
  if (input.managerUserId !== undefined) {
    const mgrErr = await validateManager(db, input.managerUserId);
    if (mgrErr) return mgrErr;
  }
  if (code !== row.code) {
    const dup = await db.warehouse.findFirst({ where: { code, NOT: { id } } });
    if (dup) {
      return dup.deletedAt
        ? { ok: false, error: 'DUPLICATE_TRASH', message: `Mã kho "${code}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn mã khác.` }
        : { ok: false, error: 'DUPLICATE', message: `Mã kho "${code}" đã tồn tại.` };
    }
  }

  const before = auditSnapshot({ code: row.code, name: row.name, address: row.address, phone: row.phone, managerUserId: row.managerUserId, status: row.status });
  let updated;
  try {
    updated = await db.warehouse.update({
      where: { id },
      data: {
        code,
        name,
        address: input.address !== undefined ? input.address?.trim() || null : row.address,
        phone: input.phone !== undefined ? input.phone?.trim() || null : row.phone,
        managerUserId: input.managerUserId !== undefined ? input.managerUserId : row.managerUserId,
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

  // R27b — CẤM xóa kho còn máy IN_STOCK (posDevice.warehouseId trỏ vào kho). Nếu xóa → máy "mắc kẹt":
  // giao máy báo kho NOT_FOUND, cột kho rỗng. Model-1: warehouseId≠null ⟺ IN_STOCK nên đếm posDevice là
  // đủ. All-or-nothing: chặn cả lô nếu bất kỳ kho nào còn máy (thông báo rõ kho + số máy).
  const blocked: string[] = [];
  for (const id of ids) {
    const row = await db.warehouse.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    const held = await db.posDevice.count({ where: { warehouseId: id, deletedAt: null } });
    if (held > 0) blocked.push(`${row.code} (${held} máy)`);
  }
  if (blocked.length > 0) {
    await writeAudit(db, { actorUserId: user.id, action: 'WAREHOUSE_DELETED', targetType: 'Warehouse', after: { denied: true, reason: 'IN_USE', blocked } });
    return { ok: false, error: 'IN_USE', message: `Không thể xóa kho còn máy tồn: ${blocked.join(', ')}. Hãy giao hoặc chuyển máy khỏi kho trước.` };
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

/** Danh sách kho gọn (id/code/name/address) cho dropdown "Từ kho" khi giao máy — chỉ kho ACTIVE.
 *  §4 — address HIỆU LỰC (từ hồ sơ user quản lý nếu có) để giao máy hiện đúng địa chỉ + gác #5. */
export async function listWarehousesLite(): Promise<{ ok: boolean; data?: { id: number; code: string; name: string; address: string | null }[]; error?: string; message?: string }> {
  const g = await requirePermission('CONFIG_WAREHOUSE_VIEW', { action: 'CONFIG_WAREHOUSE_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.warehouse.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, address: true, managerUserId: true } });
  const mgrIds = [...new Set(rows.map((r) => r.managerUserId).filter((x): x is number => typeof x === 'number'))];
  const mgrs = new Map((await g.db.user.findMany({ where: { id: { in: mgrIds } }, select: { id: true, address: true } })).map((u) => [u.id, u.address]));
  return { ok: true, data: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, address: r.managerUserId != null ? mgrs.get(r.managerUserId) ?? null : r.address })) };
}
