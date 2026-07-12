// Danh mục trạng thái tùy biến dùng chung (R14). Mỗi thực thể (entity) có bộ trạng thái riêng.
// - Builtin (seed): KHÔNG xóa, KHÔNG đổi code — chỉ đổi label/tone/sortOrder/active.
// - Master-data (ENTITY_ALLOW_ADD): cho thêm trạng thái mới. State-machine KHÔNG có ở đây (cố định).
// Cột `status` các bảng lưu `code` tra ở đây theo entity. READ chỉ cần đăng nhập; MANAGE cần SYSTEM_SETTING_UPDATE.
import { getDb } from './db.js';
import { me } from './auth-service.js';
import { requirePermission } from './guard.js';
import { writeAudit } from './audit.js';
import { staleGuard } from './optimistic-lock.js';

export interface MutationResult {
  ok: boolean;
  id?: number;
  error?: string;
  message?: string;
}

export interface StatusOptionDto {
  id: number;
  entity: string;
  code: string;
  label: string;
  tone: string;
  isBuiltin: boolean;
  sortOrder: number;
  active: boolean;
  updatedAt: string; // R48 #2 optimistic-lock — client echo lại khi Lưu để chống sửa đè
}

/** Thực thể master-data cho phép "Thêm trạng thái mới". Ngoài danh sách này = cố định (chỉ đổi nhãn/màu). */
export const STATUS_ENTITIES: { entity: string; label: string; allowAdd: boolean }[] = [
  { entity: 'BANK', label: 'Ngân hàng', allowAdd: true },
  { entity: 'CUSTOMER', label: 'Khách hàng', allowAdd: true },
  { entity: 'PARTNER', label: 'Đối tác', allowAdd: true },
  { entity: 'POS_DEVICE', label: 'Tình trạng máy POS', allowAdd: true },
  { entity: 'HKD_MST', label: 'Trạng thái MST hồ sơ HKD', allowAdd: true }
];
const ENTITY_ALLOW_ADD: Record<string, boolean> = Object.fromEntries(STATUS_ENTITIES.map((e) => [e.entity, e.allowAdd]));
const ENTITY_SET = new Set(STATUS_ENTITIES.map((e) => e.entity));

/** Bảng màu hợp lệ (khớp design system). Giá trị lạ → 'slate'. */
export const STATUS_TONES = ['emerald', 'amber', 'slate', 'rose', 'sky', 'indigo', 'violet', 'brand'];
function normTone(t: string | undefined | null): string {
  return t && STATUS_TONES.includes(t) ? t : 'slate';
}

function toDto(r: {
  id: number;
  entity: string;
  code: string;
  label: string;
  tone: string;
  isBuiltin: boolean;
  sortOrder: number;
  active: boolean;
  updatedAt: Date;
}): StatusOptionDto {
  return { id: r.id, entity: r.entity, code: r.code, label: r.label, tone: r.tone, isBuiltin: r.isBuiltin, sortOrder: r.sortOrder, active: r.active, updatedAt: r.updatedAt.toISOString() };
}

/** Đọc options 1 entity (badge/dropdown). includeInactive=true cho trang cấu hình. Chỉ cần đăng nhập. */
export async function listStatusOptions(
  entity: string,
  opts?: { includeInactive?: boolean }
): Promise<{ ok: boolean; data?: StatusOptionDto[]; error?: string; message?: string }> {
  const actor = me();
  if (!actor) return { ok: false, error: 'NOT_AUTHENTICATED', message: 'Bạn chưa đăng nhập.' };
  const db = getDb();
  const rows = await db.statusOption.findMany({
    where: { entity, deletedAt: null, ...(opts?.includeInactive ? {} : { active: true }) },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
  });
  return { ok: true, data: rows.map(toDto) };
}

/** Đọc options nhiều entity 1 lần (cache cho trang có nhiều loại status). Chỉ active. */
export async function listStatusOptionsMany(
  entities: string[]
): Promise<{ ok: boolean; data?: Record<string, StatusOptionDto[]>; error?: string; message?: string }> {
  const actor = me();
  if (!actor) return { ok: false, error: 'NOT_AUTHENTICATED', message: 'Bạn chưa đăng nhập.' };
  const db = getDb();
  const rows = await db.statusOption.findMany({
    where: { entity: { in: entities }, deletedAt: null, active: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
  });
  const map: Record<string, StatusOptionDto[]> = {};
  for (const e of entities) map[e] = [];
  for (const r of rows) (map[r.entity] ??= []).push(toDto(r));
  return { ok: true, data: map };
}

/** Danh sách thực thể có logic trạng thái (cho dropdown chọn ở trang cấu hình). */
export async function listStatusEntities(): Promise<{ ok: boolean; data?: typeof STATUS_ENTITIES; error?: string; message?: string }> {
  const actor = me();
  if (!actor) return { ok: false, error: 'NOT_AUTHENTICATED', message: 'Bạn chưa đăng nhập.' };
  return { ok: true, data: STATUS_ENTITIES };
}

/** Trạng thái `code` có hợp lệ cho `entity` không (đã tồn tại, chưa xóa). Dùng validate khi lưu bản ghi thực thể. */
export async function isValidStatus(entity: string, code: string): Promise<boolean> {
  const db = getDb();
  const row = await db.statusOption.findFirst({ where: { entity, code, deletedAt: null } });
  return !!row;
}

export interface CreateStatusOptionInput {
  entity: string;
  label: string;
  tone?: string;
}

export async function createStatusOption(input: CreateStatusOptionInput): Promise<MutationResult> {
  const g = await requirePermission('SYSTEM_SETTING_UPDATE', { action: 'STATUS_OPTION_CREATED', targetType: 'StatusOption' });
  if (!g.ok) return g;
  const { db, user } = g;

  const entity = input.entity?.trim();
  const label = input.label?.trim();
  if (!entity || !ENTITY_SET.has(entity)) return { ok: false, error: 'VALIDATION', message: 'Thực thể không hợp lệ.' };
  if (!ENTITY_ALLOW_ADD[entity]) return { ok: false, error: 'FORBIDDEN_ENTITY', message: 'Nhóm trạng thái này cố định — không thể thêm trạng thái mới.' };
  if (!label) return { ok: false, error: 'VALIDATION', message: 'Tên trạng thái bắt buộc.' };

  // Chống trùng nhãn trong cùng entity (chưa xóa).
  const dupLabel = await db.statusOption.findFirst({ where: { entity, label, deletedAt: null } });
  if (dupLabel) return { ok: false, error: 'DUPLICATE', message: `Trạng thái "${label}" đã tồn tại.` };

  // Sinh code CUSTOM_<n> duy nhất trong entity (tính cả bản đã xóa để không tái dùng code).
  const customs = await db.statusOption.findMany({ where: { entity, code: { startsWith: 'CUSTOM_' } }, select: { code: true } });
  let next = 1;
  for (const c of customs) {
    const n = Number(c.code.slice('CUSTOM_'.length));
    if (Number.isFinite(n) && n >= next) next = n + 1;
  }
  const code = `CUSTOM_${next}`;

  const agg = await db.statusOption.aggregate({ where: { entity, deletedAt: null }, _max: { sortOrder: true } });
  const sortOrder = (agg._max.sortOrder ?? -1) + 1;

  const created = await db.statusOption.create({
    data: { entity, code, label, tone: normTone(input.tone), isBuiltin: false, sortOrder, active: true, createdBy: user.id }
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'STATUS_OPTION_CREATED',
    targetType: 'StatusOption',
    targetId: String(created.id),
    after: { entity, code, label, tone: created.tone }
  });
  return { ok: true, id: created.id };
}

export interface UpdateStatusOptionInput {
  label?: string;
  tone?: string;
  sortOrder?: number;
  active?: boolean;
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock — mốc updatedAt client giữ lúc mở form
}

export async function updateStatusOption(id: number, input: UpdateStatusOptionInput): Promise<MutationResult> {
  const g = await requirePermission('SYSTEM_SETTING_UPDATE', { action: 'STATUS_OPTION_UPDATED', targetType: 'StatusOption', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.statusOption.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Trạng thái không tồn tại.' };
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;

  const label = input.label !== undefined ? input.label.trim() : row.label;
  if (!label) return { ok: false, error: 'VALIDATION', message: 'Tên trạng thái không được để trống.' };
  if (input.label !== undefined && label !== row.label) {
    const dupLabel = await db.statusOption.findFirst({ where: { entity: row.entity, label, deletedAt: null, NOT: { id } } });
    if (dupLabel) return { ok: false, error: 'DUPLICATE', message: `Trạng thái "${label}" đã tồn tại.` };
  }

  const before = { label: row.label, tone: row.tone, sortOrder: row.sortOrder, active: row.active };
  const updated = await db.statusOption.update({
    where: { id },
    data: {
      label,
      tone: input.tone !== undefined ? normTone(input.tone) : row.tone,
      sortOrder: input.sortOrder !== undefined ? input.sortOrder : row.sortOrder,
      active: input.active !== undefined ? input.active : row.active,
      updatedBy: user.id
    }
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'STATUS_OPTION_UPDATED',
    targetType: 'StatusOption',
    targetId: String(id),
    before,
    after: { label: updated.label, tone: updated.tone, sortOrder: updated.sortOrder, active: updated.active }
  });
  return { ok: true, id };
}

/** Đếm bản ghi thực thể đang dùng `code` (chặn xóa trạng thái đang dùng). Không biết entity → 0. */
async function countUsage(entity: string, code: string): Promise<number> {
  const db = getDb();
  switch (entity) {
    case 'BANK':
      return db.bank.count({ where: { status: code } });
    case 'CUSTOMER':
      return db.customer.count({ where: { status: code } });
    case 'PARTNER':
      return db.partner.count({ where: { status: code } });
    case 'POS_DEVICE':
      return db.posDevice.count({ where: { status: code } });
    case 'HKD_MST':
      return db.dossier.count({ where: { mstStatus: code } });
    default:
      return 0;
  }
}

export async function deleteStatusOption(id: number): Promise<MutationResult> {
  const g = await requirePermission('SYSTEM_SETTING_UPDATE', { action: 'STATUS_OPTION_DELETED', targetType: 'StatusOption', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.statusOption.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Trạng thái không tồn tại.' };
  if (row.isBuiltin) return { ok: false, error: 'BUILTIN_LOCKED', message: 'Trạng thái mặc định không thể xóa (chỉ có thể ẩn).' };

  const used = await countUsage(row.entity, row.code);
  if (used > 0) return { ok: false, error: 'IN_USE', message: `Trạng thái "${row.label}" đang được ${used} bản ghi sử dụng — chỉ có thể ẩn, không xóa.` };

  await db.statusOption.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.id } });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'STATUS_OPTION_DELETED',
    targetType: 'StatusOption',
    targetId: String(id),
    before: { entity: row.entity, code: row.code, label: row.label }
  });
  return { ok: true, id };
}
