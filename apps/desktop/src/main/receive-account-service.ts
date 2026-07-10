// Tài khoản nhận tiền – ủy quyền (main). IMS_SPEC §8. Permission CONFIG_RCV_ACCT_VIEW/MANAGE,
// audit, soft-delete. Nguồn TK (§8a) + TK (§8b, đính kèm ảnh CCCD 2 mặt — mặt sau không bắt buộc).
import { auditSnapshot } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { dateRange } from './customer-service.js';
import { storeAttachment, trashAttachment, type AttachSide } from './file-store.js';

const VIEW = 'CONFIG_RCV_ACCT_VIEW';
const MANAGE = 'CONFIG_RCV_ACCT_MANAGE';

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
  return isNaN(d.getTime()) ? undefined : d; // undefined = giữ nguyên (bỏ qua giá trị sai)
}

// ═════════════════════════════════════════════════════════════════════════════
// §8a — NGUỒN TÀI KHOẢN ỦY QUYỀN
// ═════════════════════════════════════════════════════════════════════════════
export interface RcvSourceDto extends AuditTrail {
  id: number;
  name: string;
}
export interface CreateRcvSourceInput {
  name: string;
}
export interface UpdateRcvSourceInput {
  name?: string;
}

export async function listSources(): Promise<{ ok: boolean; data?: RcvSourceDto[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const rows = await g.db.receiveAccountSource.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' } });
  const names = await resolveUserNames(g.db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  return { ok: true, data: rows.map((r) => ({ id: r.id, name: r.name, ...trail(r, names) })) };
}

export async function createSource(input: CreateRcvSourceInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'RCV_ACCT_SOURCE_CREATED', targetType: 'ReceiveAccountSource' });
  if (!g.ok) return g;
  const { db, user } = g;
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên nguồn tài khoản bắt buộc.' };
  const dup = await db.receiveAccountSource.findFirst({ where: { name } });
  if (dup) {
    return dup.deletedAt
      ? { ok: false, error: 'DUPLICATE_TRASH', message: `Nguồn "${name}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn tên khác.` }
      : { ok: false, error: 'DUPLICATE', message: `Nguồn "${name}" đã tồn tại.` };
  }
  let created;
  try {
    created = await db.receiveAccountSource.create({ data: { name, createdBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Nguồn "${name}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'RCV_ACCT_SOURCE_CREATED', targetType: 'ReceiveAccountSource', targetId: String(created.id), after: auditSnapshot({ name }) });
  return { ok: true, id: created.id };
}

export async function updateSource(id: number, input: UpdateRcvSourceInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'RCV_ACCT_SOURCE_UPDATED', targetType: 'ReceiveAccountSource', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.receiveAccountSource.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Nguồn tài khoản không tồn tại.' };
  const name = input.name !== undefined ? input.name.trim() : row.name;
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên nguồn không được để trống.' };
  if (name !== row.name) {
    const dup = await db.receiveAccountSource.findFirst({ where: { name, NOT: { id } } });
    if (dup) {
      return dup.deletedAt
        ? { ok: false, error: 'DUPLICATE_TRASH', message: `Nguồn "${name}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn tên khác.` }
        : { ok: false, error: 'DUPLICATE', message: `Nguồn "${name}" đã tồn tại.` };
    }
  }
  const before = auditSnapshot({ name: row.name });
  let updated;
  try {
    updated = await db.receiveAccountSource.update({ where: { id }, data: { name, updatedBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Nguồn "${name}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'RCV_ACCT_SOURCE_UPDATED', targetType: 'ReceiveAccountSource', targetId: String(id), before, after: auditSnapshot({ name: updated.name }) });
  return { ok: true, id };
}

export async function deleteSources(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission(MANAGE, { action: 'RCV_ACCT_SOURCE_DELETED', targetType: 'ReceiveAccountSource' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn nguồn để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'RCV_ACCT_SOURCE_DELETED', targetType: 'ReceiveAccountSource', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.receiveAccountSource.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.receiveAccountSource.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'RCV_ACCT_SOURCE_DELETED', targetType: 'ReceiveAccountSource', targetId: String(id), before: auditSnapshot({ name: row.name }) });
    deleted++;
  }
  return { ok: true, deleted };
}

// ═════════════════════════════════════════════════════════════════════════════
// §8b — TÀI KHOẢN NHẬN TIỀN
// ═════════════════════════════════════════════════════════════════════════════
export interface RcvAccountDto extends AuditTrail {
  id: number;
  sourceId: number;
  sourceName: string | null;
  accountName: string;
  accountNumber: string;
  bankId: number;
  bankCode: string | null;
  bankName: string | null;
  branch: string | null;
  cccdNumber: string | null;
  cccdIssueDate: string | null;
  cccdIssuePlace: string | null;
  cccdExpiry: string | null;
  phone: string | null;
  email: string | null;
  customerId: number | null;
  customerName: string | null;
  cccdFrontPath: string | null;
  cccdFrontName: string | null;
  cccdBackPath: string | null;
  cccdBackName: string | null;
}
export interface RcvAccountFilter {
  search?: string;
  sourceId?: number;
  bankId?: number;
  customerId?: number;
  fromDate?: string;
  toDate?: string;
}
export interface RcvAccountInput {
  sourceId: number;
  accountName: string;
  accountNumber: string;
  bankId: number;
  branch?: string | null;
  cccdNumber?: string | null;
  cccdIssueDate?: string | null;
  cccdIssuePlace?: string | null;
  cccdExpiry?: string | null;
  phone?: string | null;
  email?: string | null;
  customerId?: number | null;
  note?: string | null;
  // Đính kèm: đường dẫn file nguồn (từ dialog) — undefined = không đổi, null = gỡ ảnh.
  cccdFrontSrc?: string | null;
  cccdBackSrc?: string | null;
}

export async function listAccounts(filter: RcvAccountFilter = {}): Promise<{ ok: boolean; data?: RcvAccountDto[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const db = g.db;
  const rows = await db.receiveAccount.findMany({
    where: {
      deletedAt: null,
      sourceId: filter.sourceId ?? undefined,
      bankId: filter.bankId ?? undefined,
      customerId: filter.customerId ?? undefined,
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search ? [{ accountName: { contains: filter.search, mode: 'insensitive' } }, { accountNumber: { contains: filter.search, mode: 'insensitive' } }, { cccdNumber: { contains: filter.search, mode: 'insensitive' } }, { phone: { contains: filter.search, mode: 'insensitive' } }] : undefined
    },
    orderBy: { id: 'asc' }
  });
  const names = await resolveUserNames(db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  const sources = new Map((await db.receiveAccountSource.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.sourceId))] } }, select: { id: true, name: true } })).map((s) => [s.id, s]));
  const banks = new Map((await db.bank.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.bankId))] } }, select: { id: true, code: true, name: true } })).map((b) => [b.id, b]));
  const custIds = rows.map((r) => r.customerId).filter((x): x is number => typeof x === 'number');
  const customers = new Map((await db.customer.findMany({ where: { id: { in: [...new Set(custIds)] } }, select: { id: true, nickname: true, fullName: true } })).map((c) => [c.id, c]));
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      sourceId: r.sourceId,
      sourceName: sources.get(r.sourceId)?.name ?? null,
      accountName: r.accountName,
      accountNumber: r.accountNumber,
      bankId: r.bankId,
      bankCode: banks.get(r.bankId)?.code ?? null,
      bankName: banks.get(r.bankId)?.name ?? null,
      branch: r.branch,
      cccdNumber: r.cccdNumber,
      cccdIssueDate: r.cccdIssueDate ? r.cccdIssueDate.toISOString() : null,
      cccdIssuePlace: r.cccdIssuePlace,
      cccdExpiry: r.cccdExpiry ? r.cccdExpiry.toISOString() : null,
      phone: r.phone,
      email: r.email,
      customerId: r.customerId,
      customerName: r.customerId != null ? customers.get(r.customerId)?.nickname ?? customers.get(r.customerId)?.fullName ?? null : null,
      cccdFrontPath: r.cccdFrontPath,
      cccdFrontName: r.cccdFrontName,
      cccdBackPath: r.cccdBackPath,
      cccdBackName: r.cccdBackName,
      ...trail(r, names)
    }))
  };
}

/** Kiểm tra khóa tham chiếu (nguồn/ngân hàng/khách) tồn tại & còn sống. */
async function validateRefs(db: Db, sourceId: number, bankId: number, customerId: number | null | undefined): Promise<MutationResult | null> {
  const src = await db.receiveAccountSource.findUnique({ where: { id: sourceId } });
  if (!src || src.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Nguồn tài khoản đã chọn không tồn tại.' };
  const bank = await db.bank.findUnique({ where: { id: bankId } });
  if (!bank || bank.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Ngân hàng đã chọn không tồn tại.' };
  if (customerId != null) {
    const c = await db.customer.findUnique({ where: { id: customerId } });
    if (!c || c.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Khách hàng đã chọn không tồn tại.' };
  }
  return null;
}

export async function createAccount(input: RcvAccountInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'RCV_ACCT_CREATED', targetType: 'ReceiveAccount' });
  if (!g.ok) return g;
  const { db, user } = g;
  const accountName = input.accountName?.trim();
  const accountNumber = input.accountNumber?.trim();
  if (!input.sourceId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn nguồn tài khoản.' };
  if (!accountName) return { ok: false, error: 'VALIDATION', message: 'Tên tài khoản bắt buộc.' };
  if (!accountNumber) return { ok: false, error: 'VALIDATION', message: 'Số tài khoản bắt buộc.' };
  if (!input.bankId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn ngân hàng.' };
  const refErr = await validateRefs(db, input.sourceId, input.bankId, input.customerId ?? null);
  if (refErr) return refErr;

  const created = await db.receiveAccount.create({
    data: {
      sourceId: input.sourceId,
      accountName,
      accountNumber,
      bankId: input.bankId,
      branch: input.branch?.trim() || null,
      cccdNumber: input.cccdNumber?.trim() || null,
      cccdIssueDate: parseDate(input.cccdIssueDate) ?? null,
      cccdIssuePlace: input.cccdIssuePlace?.trim() || null,
      cccdExpiry: parseDate(input.cccdExpiry) ?? null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      customerId: input.customerId ?? null,
      note: input.note?.trim() || null,
      createdBy: user.id
    }
  });
  await applyAttachments(db, created.id, accountName, input);
  await writeAudit(db, { actorUserId: user.id, action: 'RCV_ACCT_CREATED', targetType: 'ReceiveAccount', targetId: String(created.id), after: auditSnapshot({ accountName, accountNumber, bankId: input.bankId }) });
  return { ok: true, id: created.id };
}

export async function updateAccount(id: number, input: RcvAccountInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'RCV_ACCT_UPDATED', targetType: 'ReceiveAccount', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.receiveAccount.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Tài khoản không tồn tại.' };
  const accountName = input.accountName !== undefined ? input.accountName.trim() : row.accountName;
  const accountNumber = input.accountNumber !== undefined ? input.accountNumber.trim() : row.accountNumber;
  const sourceId = input.sourceId ?? row.sourceId;
  const bankId = input.bankId ?? row.bankId;
  if (!accountName) return { ok: false, error: 'VALIDATION', message: 'Tên tài khoản không được để trống.' };
  if (!accountNumber) return { ok: false, error: 'VALIDATION', message: 'Số tài khoản không được để trống.' };
  const refErr = await validateRefs(db, sourceId, bankId, input.customerId === undefined ? row.customerId : input.customerId);
  if (refErr) return refErr;

  const before = auditSnapshot({ accountName: row.accountName, accountNumber: row.accountNumber, bankId: row.bankId });
  await db.receiveAccount.update({
    where: { id },
    data: {
      sourceId,
      accountName,
      accountNumber,
      bankId,
      branch: input.branch !== undefined ? input.branch?.trim() || null : row.branch,
      cccdNumber: input.cccdNumber !== undefined ? input.cccdNumber?.trim() || null : row.cccdNumber,
      cccdIssueDate: input.cccdIssueDate !== undefined ? parseDate(input.cccdIssueDate) ?? null : row.cccdIssueDate,
      cccdIssuePlace: input.cccdIssuePlace !== undefined ? input.cccdIssuePlace?.trim() || null : row.cccdIssuePlace,
      cccdExpiry: input.cccdExpiry !== undefined ? parseDate(input.cccdExpiry) ?? null : row.cccdExpiry,
      phone: input.phone !== undefined ? input.phone?.trim() || null : row.phone,
      email: input.email !== undefined ? input.email?.trim() || null : row.email,
      customerId: input.customerId !== undefined ? input.customerId : row.customerId,
      note: input.note !== undefined ? input.note?.trim() || null : row.note,
      updatedBy: user.id
    }
  });
  await applyAttachments(db, id, accountName, input, { front: row.cccdFrontPath, back: row.cccdBackPath });
  await writeAudit(db, { actorUserId: user.id, action: 'RCV_ACCT_UPDATED', targetType: 'ReceiveAccount', targetId: String(id), before, after: auditSnapshot({ accountName, accountNumber, bankId }) });
  return { ok: true, id };
}

/** Xử lý đính kèm CCCD: src mới → lưu; null → gỡ; undefined → giữ nguyên. */
async function applyAttachments(db: Db, id: number, ownerName: string, input: RcvAccountInput, prev?: { front: string | null; back: string | null }): Promise<void> {
  const sides: { key: 'cccdFrontSrc' | 'cccdBackSrc'; side: AttachSide; pathCol: 'cccdFrontPath' | 'cccdBackPath'; nameCol: 'cccdFrontName' | 'cccdBackName'; prevPath: string | null | undefined }[] = [
    { key: 'cccdFrontSrc', side: 'cccdFront', pathCol: 'cccdFrontPath', nameCol: 'cccdFrontName', prevPath: prev?.front },
    { key: 'cccdBackSrc', side: 'cccdBack', pathCol: 'cccdBackPath', nameCol: 'cccdBackName', prevPath: prev?.back }
  ];
  for (const s of sides) {
    const val = input[s.key];
    if (val === undefined) continue; // giữ nguyên
    if (val === null) {
      if (s.prevPath) trashAttachment(s.prevPath);
      await db.receiveAccount.update({ where: { id }, data: { [s.pathCol]: null, [s.nameCol]: null } });
      continue;
    }
    const res = storeAttachment('receiveAccount', id, s.side, ownerName, val);
    if (res.ok && res.file) {
      await db.receiveAccount.update({ where: { id }, data: { [s.pathCol]: res.file.relPath, [s.nameCol]: res.file.fileName } });
    }
  }
}

export async function deleteAccounts(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission(MANAGE, { action: 'RCV_ACCT_DELETED', targetType: 'ReceiveAccount' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn tài khoản để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'RCV_ACCT_DELETED', targetType: 'ReceiveAccount', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.receiveAccount.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.receiveAccount.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'RCV_ACCT_DELETED', targetType: 'ReceiveAccount', targetId: String(id), before: auditSnapshot({ accountName: row.accountName, accountNumber: row.accountNumber }) });
    deleted++;
  }
  return { ok: true, deleted };
}
