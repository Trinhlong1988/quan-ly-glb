// Quản lý Hồ sơ HKD (main). IMS_SPEC §10. Permission CONFIG_DOSSIER_VIEW/MANAGE, audit, soft-delete.
// Nguồn hồ sơ (§10a/b: mã + chính sách chiết khấu %) + Hồ sơ HKD (§10c/d: đủ trường + ảnh ĐKKD/CCCD 2 mặt).
// Ảnh lưu ngoài DB (file-store, kind='dossier'): ĐKKD đặt tên theo Tên HKD, CCCD theo Tên chủ hộ.
import { auditSnapshot } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { dateRange } from './customer-service.js';
import { storeAttachment, trashAttachment, type AttachSide } from './file-store.js';

const VIEW = 'CONFIG_DOSSIER_VIEW';
const MANAGE = 'CONFIG_DOSSIER_MANAGE';
const SCALE = 1000; // phần trăm × 1000 (≤3 thập phân, Int chính xác)

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
/** Phần trăm (số, ≤3 thập phân, ≥0) → Int ×1000. null nếu không hợp lệ. */
function pctToMilli(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  const milli = Math.round(n * SCALE);
  if (Math.abs(n * SCALE - milli) > 1e-6) return null; // quá 3 số thập phân
  return milli;
}
const milliToPct = (m: number): number => m / SCALE;

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

// Trạng thái MST hồ sơ HKD (§10c): 'ACTIVE'=Hoạt động / 'CLOSED'=Đóng.
const MST_STATUSES = ['ACTIVE', 'CLOSED'] as const;
function isMstStatus(v: unknown): v is (typeof MST_STATUSES)[number] {
  return typeof v === 'string' && (MST_STATUSES as readonly string[]).includes(v);
}

// ═════════════════════════════════════════════════════════════════════════════
// §10a/b — NGUỒN HỒ SƠ
// ═════════════════════════════════════════════════════════════════════════════
export interface DossierSourceDto extends AuditTrail {
  id: number;
  code: string;
  discountRate: number; // phần trăm (đã /1000)
}
export interface CreateDossierSourceInput {
  code: string;
  discountRate: number;
}
export interface UpdateDossierSourceInput {
  code?: string;
  discountRate?: number;
}

export async function listSources(): Promise<{ ok: boolean; data?: DossierSourceDto[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const rows = await g.db.dossierSource.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' } });
  const names = await resolveUserNames(g.db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  return { ok: true, data: rows.map((r) => ({ id: r.id, code: r.code, discountRate: milliToPct(r.discountRate), ...trail(r, names) })) };
}

export async function createSource(input: CreateDossierSourceInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'DOSSIER_SOURCE_CREATED', targetType: 'DossierSource' });
  if (!g.ok) return g;
  const { db, user } = g;
  const code = input.code?.trim();
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã nguồn hồ sơ bắt buộc.' };
  const milli = pctToMilli(input.discountRate);
  if (milli === null) return { ok: false, error: 'VALIDATION', message: 'Chính sách chiết khấu phải ≥ 0 và tối đa 3 số thập phân.' };
  const dup = await db.dossierSource.findFirst({ where: { code } });
  if (dup) {
    return dup.deletedAt
      ? { ok: false, error: 'DUPLICATE_TRASH', message: `Mã nguồn hồ sơ "${code}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn mã khác.` }
      : { ok: false, error: 'DUPLICATE', message: `Mã nguồn hồ sơ "${code}" đã tồn tại.` };
  }
  let created;
  try {
    created = await db.dossierSource.create({ data: { code, discountRate: milli, createdBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Mã nguồn hồ sơ "${code}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'DOSSIER_SOURCE_CREATED', targetType: 'DossierSource', targetId: String(created.id), after: auditSnapshot({ code, discountRate: milli }) });
  return { ok: true, id: created.id };
}

export async function updateSource(id: number, input: UpdateDossierSourceInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'DOSSIER_SOURCE_UPDATED', targetType: 'DossierSource', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.dossierSource.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Nguồn hồ sơ không tồn tại.' };
  const code = input.code !== undefined ? input.code.trim() : row.code;
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã nguồn hồ sơ không được để trống.' };
  let milli = row.discountRate;
  if (input.discountRate !== undefined) {
    const m = pctToMilli(input.discountRate);
    if (m === null) return { ok: false, error: 'VALIDATION', message: 'Chính sách chiết khấu phải ≥ 0 và tối đa 3 số thập phân.' };
    milli = m;
  }
  if (code !== row.code) {
    const dup = await db.dossierSource.findFirst({ where: { code, NOT: { id } } });
    if (dup) {
      return dup.deletedAt
        ? { ok: false, error: 'DUPLICATE_TRASH', message: `Mã nguồn hồ sơ "${code}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn mã khác.` }
        : { ok: false, error: 'DUPLICATE', message: `Mã nguồn hồ sơ "${code}" đã tồn tại.` };
    }
  }
  const before = auditSnapshot({ code: row.code, discountRate: row.discountRate });
  let updated;
  try {
    updated = await db.dossierSource.update({ where: { id }, data: { code, discountRate: milli, updatedBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Mã nguồn hồ sơ "${code}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'DOSSIER_SOURCE_UPDATED', targetType: 'DossierSource', targetId: String(id), before, after: auditSnapshot({ code: updated.code, discountRate: updated.discountRate }) });
  return { ok: true, id };
}

export async function deleteSources(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission(MANAGE, { action: 'DOSSIER_SOURCE_DELETED', targetType: 'DossierSource' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn nguồn hồ sơ để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'DOSSIER_SOURCE_DELETED', targetType: 'DossierSource', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.dossierSource.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.dossierSource.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'DOSSIER_SOURCE_DELETED', targetType: 'DossierSource', targetId: String(id), before: auditSnapshot({ code: row.code }) });
    deleted++;
  }
  return { ok: true, deleted };
}

// ═════════════════════════════════════════════════════════════════════════════
// §10c/d — HỒ SƠ HKD
// ═════════════════════════════════════════════════════════════════════════════
export interface DossierDto extends AuditTrail {
  id: number;
  sourceId: number;
  sourceCode: string | null;
  hkdName: string;
  hkdAddress: string | null;
  taxCode: string | null;
  mstStatus: string; // 'ACTIVE'=Hoạt động / 'CLOSED'=Đóng
  dkkdIssueDate: string | null;
  dkkdIssuePlace: string | null;
  ownerName: string;
  gender: string | null;
  ethnicity: string | null;
  cccdNumber: string | null;
  cccdIssueDate: string | null;
  cccdIssuePlace: string | null;
  cccdExpiry: string | null;
  permanentAddress: string | null;
  currentAddress: string | null;
  email: string | null;
  dkkdFrontPath: string | null;
  dkkdFrontName: string | null;
  dkkdBackPath: string | null;
  dkkdBackName: string | null;
  cccdFrontPath: string | null;
  cccdFrontName: string | null;
  cccdBackPath: string | null;
  cccdBackName: string | null;
  note: string | null;
}
export interface DossierFilter {
  search?: string;
  sourceId?: number;
  mstStatus?: string; // lọc theo trạng thái MST ('ACTIVE'/'CLOSED'); bỏ trống = tất cả
  fromDate?: string;
  toDate?: string;
}
export interface DossierInput {
  sourceId: number;
  hkdName: string;
  hkdAddress?: string | null;
  taxCode?: string | null;
  mstStatus?: string; // 'ACTIVE' (mặc định) / 'CLOSED'
  dkkdIssueDate?: string | null;
  dkkdIssuePlace?: string | null;
  ownerName: string;
  gender?: string | null;
  ethnicity?: string | null;
  cccdNumber?: string | null;
  cccdIssueDate?: string | null;
  cccdIssuePlace?: string | null;
  cccdExpiry?: string | null;
  permanentAddress?: string | null;
  currentAddress?: string | null;
  email?: string | null;
  note?: string | null;
  // Đính kèm: đường dẫn file nguồn (dialog) — undefined = giữ, null = gỡ.
  dkkdFrontSrc?: string | null;
  dkkdBackSrc?: string | null;
  cccdFrontSrc?: string | null;
  cccdBackSrc?: string | null;
}

export async function listDossiers(filter: DossierFilter = {}): Promise<{ ok: boolean; data?: DossierDto[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const db = g.db;
  const rows = await db.dossier.findMany({
    where: {
      deletedAt: null,
      sourceId: filter.sourceId ?? undefined,
      mstStatus: isMstStatus(filter.mstStatus) ? filter.mstStatus : undefined,
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search
        ? [{ hkdName: { contains: filter.search, mode: 'insensitive' } }, { ownerName: { contains: filter.search, mode: 'insensitive' } }, { taxCode: { contains: filter.search, mode: 'insensitive' } }, { cccdNumber: { contains: filter.search, mode: 'insensitive' } }]
        : undefined
    },
    orderBy: { id: 'asc' }
  });
  const names = await resolveUserNames(db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  const sources = new Map((await db.dossierSource.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.sourceId))] } }, select: { id: true, code: true } })).map((s) => [s.id, s]));
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      sourceId: r.sourceId,
      sourceCode: sources.get(r.sourceId)?.code ?? null,
      hkdName: r.hkdName,
      hkdAddress: r.hkdAddress,
      taxCode: r.taxCode,
      mstStatus: r.mstStatus,
      dkkdIssueDate: r.dkkdIssueDate ? r.dkkdIssueDate.toISOString() : null,
      dkkdIssuePlace: r.dkkdIssuePlace,
      ownerName: r.ownerName,
      gender: r.gender,
      ethnicity: r.ethnicity,
      cccdNumber: r.cccdNumber,
      cccdIssueDate: r.cccdIssueDate ? r.cccdIssueDate.toISOString() : null,
      cccdIssuePlace: r.cccdIssuePlace,
      cccdExpiry: r.cccdExpiry ? r.cccdExpiry.toISOString() : null,
      permanentAddress: r.permanentAddress,
      currentAddress: r.currentAddress,
      email: r.email,
      dkkdFrontPath: r.dkkdFrontPath,
      dkkdFrontName: r.dkkdFrontName,
      dkkdBackPath: r.dkkdBackPath,
      dkkdBackName: r.dkkdBackName,
      cccdFrontPath: r.cccdFrontPath,
      cccdFrontName: r.cccdFrontName,
      cccdBackPath: r.cccdBackPath,
      cccdBackName: r.cccdBackName,
      note: r.note,
      ...trail(r, names)
    }))
  };
}

/** Nguồn hồ sơ tồn tại & còn sống. */
async function validateRefs(db: Db, sourceId: number): Promise<MutationResult | null> {
  const src = await db.dossierSource.findUnique({ where: { id: sourceId } });
  if (!src || src.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Nguồn hồ sơ đã chọn không tồn tại.' };
  return null;
}

export async function createDossier(input: DossierInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'DOSSIER_CREATED', targetType: 'Dossier' });
  if (!g.ok) return g;
  const { db, user } = g;
  const hkdName = input.hkdName?.trim();
  const ownerName = input.ownerName?.trim();
  if (!input.sourceId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn nguồn hồ sơ.' };
  if (!hkdName) return { ok: false, error: 'VALIDATION', message: 'Tên Hộ Kinh Doanh bắt buộc.' };
  if (!ownerName) return { ok: false, error: 'VALIDATION', message: 'Tên chủ hộ kinh doanh bắt buộc.' };
  if (input.mstStatus !== undefined && !isMstStatus(input.mstStatus)) return { ok: false, error: 'VALIDATION', message: 'Trạng thái MST không hợp lệ (chỉ Hoạt động / Đóng).' };
  const refErr = await validateRefs(db, input.sourceId);
  if (refErr) return refErr;

  const created = await db.dossier.create({
    data: {
      sourceId: input.sourceId,
      hkdName,
      hkdAddress: input.hkdAddress?.trim() || null,
      taxCode: input.taxCode?.trim() || null,
      mstStatus: isMstStatus(input.mstStatus) ? input.mstStatus : 'ACTIVE',
      dkkdIssueDate: parseDate(input.dkkdIssueDate) ?? null,
      dkkdIssuePlace: input.dkkdIssuePlace?.trim() || null,
      ownerName,
      gender: input.gender?.trim() || null,
      ethnicity: input.ethnicity?.trim() || null,
      cccdNumber: input.cccdNumber?.trim() || null,
      cccdIssueDate: parseDate(input.cccdIssueDate) ?? null,
      cccdIssuePlace: input.cccdIssuePlace?.trim() || null,
      cccdExpiry: parseDate(input.cccdExpiry) ?? null,
      permanentAddress: input.permanentAddress?.trim() || null,
      currentAddress: input.currentAddress?.trim() || null,
      email: input.email?.trim() || null,
      note: input.note?.trim() || null,
      createdBy: user.id
    }
  });
  await applyAttachments(db, created.id, hkdName, ownerName, input);
  await writeAudit(db, { actorUserId: user.id, action: 'DOSSIER_CREATED', targetType: 'Dossier', targetId: String(created.id), after: auditSnapshot({ hkdName, ownerName, sourceId: input.sourceId }) });
  return { ok: true, id: created.id };
}

export async function updateDossier(id: number, input: DossierInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'DOSSIER_UPDATED', targetType: 'Dossier', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.dossier.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Hồ sơ không tồn tại.' };
  const hkdName = input.hkdName !== undefined ? input.hkdName.trim() : row.hkdName;
  const ownerName = input.ownerName !== undefined ? input.ownerName.trim() : row.ownerName;
  const sourceId = input.sourceId ?? row.sourceId;
  if (!hkdName) return { ok: false, error: 'VALIDATION', message: 'Tên Hộ Kinh Doanh không được để trống.' };
  if (!ownerName) return { ok: false, error: 'VALIDATION', message: 'Tên chủ hộ không được để trống.' };
  if (input.mstStatus !== undefined && !isMstStatus(input.mstStatus)) return { ok: false, error: 'VALIDATION', message: 'Trạng thái MST không hợp lệ (chỉ Hoạt động / Đóng).' };
  const refErr = await validateRefs(db, sourceId);
  if (refErr) return refErr;

  const before = auditSnapshot({ hkdName: row.hkdName, ownerName: row.ownerName, sourceId: row.sourceId });
  await db.dossier.update({
    where: { id },
    data: {
      sourceId,
      hkdName,
      hkdAddress: input.hkdAddress !== undefined ? input.hkdAddress?.trim() || null : row.hkdAddress,
      taxCode: input.taxCode !== undefined ? input.taxCode?.trim() || null : row.taxCode,
      mstStatus: isMstStatus(input.mstStatus) ? input.mstStatus : row.mstStatus,
      dkkdIssueDate: input.dkkdIssueDate !== undefined ? parseDate(input.dkkdIssueDate) ?? null : row.dkkdIssueDate,
      dkkdIssuePlace: input.dkkdIssuePlace !== undefined ? input.dkkdIssuePlace?.trim() || null : row.dkkdIssuePlace,
      ownerName,
      gender: input.gender !== undefined ? input.gender?.trim() || null : row.gender,
      ethnicity: input.ethnicity !== undefined ? input.ethnicity?.trim() || null : row.ethnicity,
      cccdNumber: input.cccdNumber !== undefined ? input.cccdNumber?.trim() || null : row.cccdNumber,
      cccdIssueDate: input.cccdIssueDate !== undefined ? parseDate(input.cccdIssueDate) ?? null : row.cccdIssueDate,
      cccdIssuePlace: input.cccdIssuePlace !== undefined ? input.cccdIssuePlace?.trim() || null : row.cccdIssuePlace,
      cccdExpiry: input.cccdExpiry !== undefined ? parseDate(input.cccdExpiry) ?? null : row.cccdExpiry,
      permanentAddress: input.permanentAddress !== undefined ? input.permanentAddress?.trim() || null : row.permanentAddress,
      currentAddress: input.currentAddress !== undefined ? input.currentAddress?.trim() || null : row.currentAddress,
      email: input.email !== undefined ? input.email?.trim() || null : row.email,
      note: input.note !== undefined ? input.note?.trim() || null : row.note,
      updatedBy: user.id
    }
  });
  await applyAttachments(db, id, hkdName, ownerName, input, { dkkdFront: row.dkkdFrontPath, dkkdBack: row.dkkdBackPath, cccdFront: row.cccdFrontPath, cccdBack: row.cccdBackPath });
  await writeAudit(db, { actorUserId: user.id, action: 'DOSSIER_UPDATED', targetType: 'Dossier', targetId: String(id), before, after: auditSnapshot({ hkdName, ownerName, sourceId }) });
  return { ok: true, id };
}

/** Đính kèm ĐKKD (tên theo Tên HKD) + CCCD (tên theo Tên chủ hộ). src mới → lưu; null → gỡ; undefined → giữ. */
async function applyAttachments(
  db: Db,
  id: number,
  hkdName: string,
  ownerName: string,
  input: DossierInput,
  prev?: { dkkdFront: string | null; dkkdBack: string | null; cccdFront: string | null; cccdBack: string | null }
): Promise<void> {
  const sides: {
    key: 'dkkdFrontSrc' | 'dkkdBackSrc' | 'cccdFrontSrc' | 'cccdBackSrc';
    side: AttachSide;
    owner: string;
    pathCol: 'dkkdFrontPath' | 'dkkdBackPath' | 'cccdFrontPath' | 'cccdBackPath';
    nameCol: 'dkkdFrontName' | 'dkkdBackName' | 'cccdFrontName' | 'cccdBackName';
    prevPath: string | null | undefined;
  }[] = [
    { key: 'dkkdFrontSrc', side: 'dkkdFront', owner: hkdName, pathCol: 'dkkdFrontPath', nameCol: 'dkkdFrontName', prevPath: prev?.dkkdFront },
    { key: 'dkkdBackSrc', side: 'dkkdBack', owner: hkdName, pathCol: 'dkkdBackPath', nameCol: 'dkkdBackName', prevPath: prev?.dkkdBack },
    { key: 'cccdFrontSrc', side: 'cccdFront', owner: ownerName, pathCol: 'cccdFrontPath', nameCol: 'cccdFrontName', prevPath: prev?.cccdFront },
    { key: 'cccdBackSrc', side: 'cccdBack', owner: ownerName, pathCol: 'cccdBackPath', nameCol: 'cccdBackName', prevPath: prev?.cccdBack }
  ];
  for (const s of sides) {
    const val = input[s.key];
    if (val === undefined) continue;
    if (val === null) {
      if (s.prevPath) trashAttachment(s.prevPath);
      await db.dossier.update({ where: { id }, data: { [s.pathCol]: null, [s.nameCol]: null } });
      continue;
    }
    const res = storeAttachment('dossier', id, s.side, s.owner, val);
    if (res.ok && res.file) {
      await db.dossier.update({ where: { id }, data: { [s.pathCol]: res.file.relPath, [s.nameCol]: res.file.fileName } });
    }
  }
}

export async function deleteDossiers(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission(MANAGE, { action: 'DOSSIER_DELETED', targetType: 'Dossier' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn hồ sơ để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'DOSSIER_DELETED', targetType: 'Dossier', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.dossier.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.dossier.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'DOSSIER_DELETED', targetType: 'Dossier', targetId: String(id), before: auditSnapshot({ hkdName: row.hkdName, ownerName: row.ownerName }) });
    deleted++;
  }
  return { ok: true, deleted };
}
