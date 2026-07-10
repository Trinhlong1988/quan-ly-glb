// Cấu hình TID (main). IMS_SPEC §9. Cách 1 (Mr.Long chốt 9/7): gộp thông tin thương mại vào bảng
// `tids` đang có (không tạo bảng riêng) — 1 TID duy nhất: cấu hình §9 → gắn POS §11 → vận hành.
// §9a trạng thái TID cấu hình (bảng riêng, khác status vận hành). Biểu phí = DẪN XUẤT từ đối tác.
// Permission CONFIG_TID_VIEW/MANAGE, audit, soft-delete (deletedAt trên tids).
import { auditSnapshot } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { dateRange } from './customer-service.js';

const VIEW = 'CONFIG_TID_VIEW';
const MANAGE = 'CONFIG_TID_MANAGE';

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

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
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
function parseDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

// ═════════════════════════════════════════════════════════════════════════════
// §9a — TRẠNG THÁI TID CẤU HÌNH
// ═════════════════════════════════════════════════════════════════════════════
export interface TidConfigStatusDto extends AuditTrail {
  id: number;
  name: string;
}
export interface CreateTidConfigStatusInput {
  name: string;
}
export interface UpdateTidConfigStatusInput {
  name?: string;
}

export async function listStatuses(): Promise<{ ok: boolean; data?: TidConfigStatusDto[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const rows = await g.db.tidConfigStatus.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' } });
  const names = await resolveUserNames(g.db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  return { ok: true, data: rows.map((r) => ({ id: r.id, name: r.name, ...trail(r, names) })) };
}

export async function createStatus(input: CreateTidConfigStatusInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'TID_CONFIG_STATUS_CREATED', targetType: 'TidConfigStatus' });
  if (!g.ok) return g;
  const { db, user } = g;
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên trạng thái TID bắt buộc.' };
  const dup = await db.tidConfigStatus.findFirst({ where: { name } });
  if (dup) {
    return dup.deletedAt
      ? { ok: false, error: 'DUPLICATE_TRASH', message: `Trạng thái "${name}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn tên khác.` }
      : { ok: false, error: 'DUPLICATE', message: `Trạng thái "${name}" đã tồn tại.` };
  }
  let created;
  try {
    created = await db.tidConfigStatus.create({ data: { name, createdBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Trạng thái "${name}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'TID_CONFIG_STATUS_CREATED', targetType: 'TidConfigStatus', targetId: String(created.id), after: auditSnapshot({ name }) });
  return { ok: true, id: created.id };
}

export async function updateStatus(id: number, input: UpdateTidConfigStatusInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'TID_CONFIG_STATUS_UPDATED', targetType: 'TidConfigStatus', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.tidConfigStatus.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Trạng thái không tồn tại.' };
  const name = input.name !== undefined ? input.name.trim() : row.name;
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên trạng thái không được để trống.' };
  if (name !== row.name) {
    const dup = await db.tidConfigStatus.findFirst({ where: { name, NOT: { id } } });
    if (dup) {
      return dup.deletedAt
        ? { ok: false, error: 'DUPLICATE_TRASH', message: `Trạng thái "${name}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn tên khác.` }
        : { ok: false, error: 'DUPLICATE', message: `Trạng thái "${name}" đã tồn tại.` };
    }
  }
  const before = auditSnapshot({ name: row.name });
  let updated;
  try {
    updated = await db.tidConfigStatus.update({ where: { id }, data: { name, updatedBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Trạng thái "${name}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'TID_CONFIG_STATUS_UPDATED', targetType: 'TidConfigStatus', targetId: String(id), before, after: auditSnapshot({ name: updated.name }) });
  return { ok: true, id };
}

export async function deleteStatuses(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission(MANAGE, { action: 'TID_CONFIG_STATUS_DELETED', targetType: 'TidConfigStatus' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn trạng thái để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'TID_CONFIG_STATUS_DELETED', targetType: 'TidConfigStatus', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.tidConfigStatus.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.tidConfigStatus.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'TID_CONFIG_STATUS_DELETED', targetType: 'TidConfigStatus', targetId: String(id), before: auditSnapshot({ name: row.name }) });
    deleted++;
  }
  return { ok: true, deleted };
}

// ═════════════════════════════════════════════════════════════════════════════
// §9 — CẤU HÌNH TID (thao tác trên bảng tids)
// ═════════════════════════════════════════════════════════════════════════════
export interface ConfigTidDto extends AuditTrail {
  id: number;
  tid: string;
  status: string; // vòng đời vận hành (UNASSIGNED|ACTIVE|…)
  posSerial: string | null;
  bankId: number | null;
  bankCode: string | null;
  bankName: string | null;
  partnerId: number | null;
  partnerCode: string | null;
  partnerName: string | null;
  hkdName: string | null;
  receiveAccountId: number | null;
  receiveAccountLabel: string | null;
  issuedAt: string | null;
  configStatusId: number | null;
  configStatusName: string | null;
  dossierSourceId: number | null;
  dossierSourceCode: string | null;
  note: string | null;
}
export interface ConfigTidFilter {
  search?: string;
  bankId?: number;
  partnerId?: number;
  configStatusId?: number;
  fromDate?: string;
  toDate?: string;
}
export interface ConfigTidInput {
  tid: string;
  bankId: number;
  partnerId: number;
  hkdName: string;
  receiveAccountId?: number | null;
  issuedAt?: string | null;
  configStatusId?: number | null;
  dossierSourceId?: number | null;
  note?: string | null;
}

export async function listConfigTids(filter: ConfigTidFilter = {}): Promise<{ ok: boolean; data?: ConfigTidDto[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const db = g.db;
  const rows = await db.tid.findMany({
    where: {
      deletedAt: null,
      bankId: filter.bankId ?? undefined,
      partnerId: filter.partnerId ?? undefined,
      configStatusId: filter.configStatusId ?? undefined,
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search ? [{ tid: { contains: filter.search } }, { hkdName: { contains: filter.search } }] : undefined
    },
    orderBy: { id: 'asc' }
  });
  const names = await resolveUserNames(db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  const banks = new Map((await db.bank.findMany({ where: { id: { in: ids(rows.map((r) => r.bankId)) } }, select: { id: true, code: true, name: true } })).map((b) => [b.id, b]));
  const partners = new Map((await db.partner.findMany({ where: { id: { in: ids(rows.map((r) => r.partnerId)) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
  const accounts = new Map((await db.receiveAccount.findMany({ where: { id: { in: ids(rows.map((r) => r.receiveAccountId)) } }, select: { id: true, accountName: true, accountNumber: true } })).map((a) => [a.id, a]));
  const statuses = new Map((await db.tidConfigStatus.findMany({ where: { id: { in: ids(rows.map((r) => r.configStatusId)) } }, select: { id: true, name: true } })).map((s) => [s.id, s]));
  const dsources = new Map((await db.dossierSource.findMany({ where: { id: { in: ids(rows.map((r) => r.dossierSourceId)) } }, select: { id: true, code: true } })).map((s) => [s.id, s]));
  return {
    ok: true,
    data: rows.map((r) => {
      const acc = r.receiveAccountId != null ? accounts.get(r.receiveAccountId) : undefined;
      return {
        id: r.id,
        tid: r.tid,
        status: r.status,
        posSerial: r.posSerial,
        bankId: r.bankId,
        bankCode: r.bankId != null ? banks.get(r.bankId)?.code ?? null : null,
        bankName: r.bankId != null ? banks.get(r.bankId)?.name ?? null : null,
        partnerId: r.partnerId,
        partnerCode: r.partnerId != null ? partners.get(r.partnerId)?.code ?? null : null,
        partnerName: r.partnerId != null ? partners.get(r.partnerId)?.name ?? null : null,
        hkdName: r.hkdName,
        receiveAccountId: r.receiveAccountId,
        receiveAccountLabel: acc ? `${acc.accountName} · ${acc.accountNumber}` : null,
        issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
        configStatusId: r.configStatusId,
        configStatusName: r.configStatusId != null ? statuses.get(r.configStatusId)?.name ?? null : null,
        dossierSourceId: r.dossierSourceId,
        dossierSourceCode: r.dossierSourceId != null ? dsources.get(r.dossierSourceId)?.code ?? null : null,
        note: r.note,
        ...trail(r, names)
      };
    })
  };
}

function ids(arr: (number | null)[]): number[] {
  return [...new Set(arr.filter((x): x is number => typeof x === 'number'))];
}

/** Kiểm tra khóa tham chiếu (ngân hàng/đối tác bắt buộc; TK nhận/trạng thái/nguồn hồ sơ nếu có). */
async function validateRefs(db: Db, input: { bankId: number; partnerId: number; receiveAccountId?: number | null; configStatusId?: number | null; dossierSourceId?: number | null }): Promise<MutationResult | null> {
  const bank = await db.bank.findUnique({ where: { id: input.bankId } });
  if (!bank || bank.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Ngân hàng đã chọn không tồn tại.' };
  const partner = await db.partner.findUnique({ where: { id: input.partnerId } });
  if (!partner || partner.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Đối tác đã chọn không tồn tại.' };
  if (input.receiveAccountId != null) {
    const a = await db.receiveAccount.findUnique({ where: { id: input.receiveAccountId } });
    if (!a || a.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Tài khoản nhận tiền đã chọn không tồn tại.' };
  }
  if (input.configStatusId != null) {
    const s = await db.tidConfigStatus.findUnique({ where: { id: input.configStatusId } });
    if (!s || s.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Trạng thái TID đã chọn không tồn tại.' };
  }
  if (input.dossierSourceId != null) {
    const d = await db.dossierSource.findUnique({ where: { id: input.dossierSourceId } });
    if (!d || d.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Nguồn hồ sơ đã chọn không tồn tại.' };
  }
  return null;
}

export async function createConfigTid(input: ConfigTidInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'TID_CONFIG_CREATED', targetType: 'Tid' });
  if (!g.ok) return g;
  const { db, user } = g;
  const tid = input.tid?.trim();
  const hkdName = input.hkdName?.trim();
  if (!tid) return { ok: false, error: 'VALIDATION', message: 'Chuỗi TID bắt buộc.' };
  if (!input.bankId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn ngân hàng.' };
  if (!input.partnerId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn đối tác.' };
  if (!hkdName) return { ok: false, error: 'VALIDATION', message: 'Tên Hộ Kinh Doanh bắt buộc.' };
  const refErr = await validateRefs(db, input);
  if (refErr) return refErr;
  // B05: tid @unique + có deletedAt → phân biệt trùng đang dùng vs trùng trong thùng rác.
  const dup = await db.tid.findFirst({ where: { tid } });
  if (dup) {
    return dup.deletedAt
      ? { ok: false, error: 'DUPLICATE_TRASH', message: `TID "${tid}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn TID khác.` }
      : { ok: false, error: 'DUPLICATE', message: `TID "${tid}" đã tồn tại.` };
  }
  let created;
  try {
    created = await db.tid.create({
      data: {
        tid,
        status: 'UNASSIGNED',
        bankId: input.bankId,
        partnerId: input.partnerId,
        hkdName,
        receiveAccountId: input.receiveAccountId ?? null,
        issuedAt: parseDate(input.issuedAt) ?? null,
        configStatusId: input.configStatusId ?? null,
        dossierSourceId: input.dossierSourceId ?? null,
        note: input.note?.trim() || null,
        createdBy: user.id
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `TID "${tid}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'TID_CONFIG_CREATED', targetType: 'Tid', targetId: String(created.id), after: auditSnapshot({ tid, bankId: input.bankId, partnerId: input.partnerId, hkdName }) });
  return { ok: true, id: created.id };
}

export async function updateConfigTid(id: number, input: ConfigTidInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'TID_CONFIG_UPDATED', targetType: 'Tid', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.tid.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'TID không tồn tại.' };
  const tid = input.tid !== undefined ? input.tid.trim() : row.tid;
  const hkdName = input.hkdName !== undefined ? input.hkdName.trim() : row.hkdName ?? '';
  const bankId = input.bankId ?? row.bankId ?? 0;
  const partnerId = input.partnerId ?? row.partnerId ?? 0;
  if (!tid) return { ok: false, error: 'VALIDATION', message: 'Chuỗi TID không được để trống.' };
  if (!bankId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn ngân hàng.' };
  if (!partnerId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn đối tác.' };
  if (!hkdName) return { ok: false, error: 'VALIDATION', message: 'Tên Hộ Kinh Doanh không được để trống.' };
  const refErr = await validateRefs(db, { bankId, partnerId, receiveAccountId: input.receiveAccountId, configStatusId: input.configStatusId, dossierSourceId: input.dossierSourceId });
  if (refErr) return refErr;
  if (tid !== row.tid) {
    const dup = await db.tid.findFirst({ where: { tid, NOT: { id } } });
    if (dup) {
      return dup.deletedAt
        ? { ok: false, error: 'DUPLICATE_TRASH', message: `TID "${tid}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn TID khác.` }
        : { ok: false, error: 'DUPLICATE', message: `TID "${tid}" đã tồn tại.` };
    }
  }
  const before = auditSnapshot({ tid: row.tid, bankId: row.bankId, partnerId: row.partnerId, hkdName: row.hkdName });
  try {
    await db.tid.update({
      where: { id },
      data: {
        tid,
        bankId,
        partnerId,
        hkdName,
        receiveAccountId: input.receiveAccountId !== undefined ? input.receiveAccountId : row.receiveAccountId,
        issuedAt: input.issuedAt !== undefined ? parseDate(input.issuedAt) ?? null : row.issuedAt,
        configStatusId: input.configStatusId !== undefined ? input.configStatusId : row.configStatusId,
        dossierSourceId: input.dossierSourceId !== undefined ? input.dossierSourceId : row.dossierSourceId,
        note: input.note !== undefined ? input.note?.trim() || null : row.note,
        updatedBy: user.id
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `TID "${tid}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'TID_CONFIG_UPDATED', targetType: 'Tid', targetId: String(id), before, after: auditSnapshot({ tid, bankId, partnerId, hkdName }) });
  return { ok: true, id };
}

export async function deleteConfigTids(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission(MANAGE, { action: 'TID_CONFIG_DELETED', targetType: 'Tid' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn TID để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'TID_CONFIG_DELETED', targetType: 'Tid', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.tid.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.tid.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'TID_CONFIG_DELETED', targetType: 'Tid', targetId: String(id), before: auditSnapshot({ tid: row.tid }) });
    deleted++;
  }
  return { ok: true, deleted };
}
