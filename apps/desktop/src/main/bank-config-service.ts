// Cấu hình ngân hàng service (main). IMS_SPEC §C1–C4. Permission-guarded (CONFIG_BANK_VIEW/MANAGE),
// audited (before/after — R_AUDIT_TRAIL), soft-delete, R_UX_WARN (message tiếng Việt cụ thể).
// Gồm: Ngân hàng (C1/C2) · Loại thẻ POS (C3) · Đối tác (C4) · liên kết Đối tác↔Ngân hàng (C4c).
import { auditSnapshot } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { dateRange } from './customer-service.js';
import { isValidStatus } from './status-catalog-service.js';
import { staleGuard } from './optimistic-lock.js';

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

// BUG G-CFG-B01: mã ngân hàng/đối tác là @unique TOÀN CỤC (không lọc soft-delete). Nếu 1 bản ghi đã
// xóa mềm (nằm Thùng rác) đang giữ mã đó, pre-check lọc deletedAt:null sẽ KHÔNG thấy → create() ném
// P2002 (unhandled → treo IPC). Lưới an toàn: bắt P2002 map về DUPLICATE thay vì để văng.
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/** Yếu tố truy vết chung: ai tạo/sửa gần nhất + thời điểm (hiển thị trong danh sách). */
export interface AuditTrail {
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedBy: number | null;
  updatedByName: string | null;
  updatedAt: string;
}

/** Batch-resolve user id → tên hiển thị (fullName, fallback username) cho cột truy vết. */
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

// ─────────────────────────────────────────────────────────────────────────────
// C1/C2 — NGÂN HÀNG
// ─────────────────────────────────────────────────────────────────────────────
export interface BankDto extends AuditTrail {
  id: number;
  seq: number | null;
  seqCode: string | null; // NH01, NH02... (từ seq)
  name: string;
  code: string;
  status: string; // ACTIVE | INACTIVE
}
export interface BankFilter {
  search?: string;
  status?: string; // ACTIVE | INACTIVE
  fromDate?: string;
  toDate?: string;
}
export interface CreateBankInput {
  name: string;
  code: string;
  status?: string;
}
export interface UpdateBankInput {
  name?: string;
  code?: string;
  status?: string;
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock — mốc updatedAt client giữ lúc mở form
}

/** seq → mã hiển thị NH01, NH02... */
export function bankSeqCode(seq: number | null | undefined): string | null {
  return seq == null ? null : 'NH' + String(seq).padStart(2, '0');
}

export async function listBanks(filter: BankFilter = {}): Promise<{ ok: boolean; data?: BankDto[]; error?: string; message?: string }> {
  const g = await requirePermission('CONFIG_BANK_VIEW', { action: 'CONFIG_BANK_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.bank.findMany({
    where: {
      deletedAt: null,
      status: filter.status || undefined,
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search ? [{ code: { contains: filter.search, mode: 'insensitive' } }, { name: { contains: filter.search, mode: 'insensitive' } }] : undefined
    },
    orderBy: [{ name: 'asc' }, { code: 'asc' }] // Mr.Long 13/7 — sắp NGÂN HÀNG theo TÊN A→Z (không theo seq NH01/NH02 nữa)
  });
  const names = await resolveUserNames(g.db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  return { ok: true, data: rows.map((r) => ({ id: r.id, seq: r.seq, seqCode: bankSeqCode(r.seq), name: r.name, code: r.code, status: r.status, ...trail(r, names) })) };
}

export async function createBank(input: CreateBankInput): Promise<MutationResult> {
  const g = await requirePermission('CONFIG_BANK_MANAGE', { action: 'BANK_CREATED', targetType: 'Bank' });
  if (!g.ok) return g;
  const { db, user } = g;

  const name = input.name?.trim();
  const code = input.code?.trim().toUpperCase();
  // REL-13 (audit 15/7, Codex): validate status theo StatusOption thay vì coerce (input sai chính tả trước
  // đây âm thầm thành 'ACTIVE' → kích hoạt lại nhầm; và bỏ qua status tùy biến).
  const status = input.status ?? 'ACTIVE';
  if (!(await isValidStatus('BANK', status))) return { ok: false, error: 'VALIDATION', message: 'Trạng thái ngân hàng không hợp lệ.' };
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên ngân hàng bắt buộc.' };
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã ngân hàng bắt buộc.' };

  const dup = await db.bank.findFirst({ where: { code } });
  if (dup) {
    return dup.deletedAt
      ? { ok: false, error: 'DUPLICATE_TRASH', message: `Mã ngân hàng "${code}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn mã khác.` }
      : { ok: false, error: 'DUPLICATE', message: `Mã ngân hàng "${code}" đã tồn tại.` };
  }

  // seq tuần tự = max(seq)+1 trên TOÀN BẢNG (kể cả đã xóa) → số NH không tái dùng.
  const maxSeq = await db.bank.aggregate({ _max: { seq: true } });
  const nextSeq = (maxSeq._max.seq ?? 0) + 1;

  let created;
  try {
    created = await db.bank.create({ data: { name, code, status, seq: nextSeq, createdBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Mã ngân hàng "${code}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'BANK_CREATED',
    targetType: 'Bank',
    targetId: String(created.id),
    after: auditSnapshot({ name: created.name, code: created.code })
  });
  return { ok: true, id: created.id };
}

export async function updateBank(id: number, input: UpdateBankInput): Promise<MutationResult> {
  const g = await requirePermission('CONFIG_BANK_MANAGE', { action: 'BANK_UPDATED', targetType: 'Bank', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.bank.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Ngân hàng không tồn tại.' };
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;

  const name = input.name !== undefined ? input.name.trim() : row.name;
  const code = input.code !== undefined ? input.code.trim().toUpperCase() : row.code;
  // REL-13 (audit 15/7, Codex): validate status thay vì coerce (typo → không còn âm thầm về 'ACTIVE').
  if (input.status !== undefined && !(await isValidStatus('BANK', input.status))) return { ok: false, error: 'VALIDATION', message: 'Trạng thái ngân hàng không hợp lệ.' };
  const status = input.status !== undefined ? input.status : row.status;
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên ngân hàng không được để trống.' };
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã ngân hàng không được để trống.' };
  if (code !== row.code) {
    const dup = await db.bank.findFirst({ where: { code, NOT: { id } } });
    if (dup) {
      return dup.deletedAt
        ? { ok: false, error: 'DUPLICATE_TRASH', message: `Mã ngân hàng "${code}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn mã khác.` }
        : { ok: false, error: 'DUPLICATE', message: `Mã ngân hàng "${code}" đã tồn tại.` };
    }
  }

  const before = auditSnapshot({ name: row.name, code: row.code, status: row.status });
  let updated;
  try {
    updated = await db.bank.update({ where: { id }, data: { name, code, status, updatedBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Mã ngân hàng "${code}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'BANK_UPDATED',
    targetType: 'Bank',
    targetId: String(id),
    before,
    after: auditSnapshot({ name: updated.name, code: updated.code, status: updated.status })
  });
  return { ok: true, id };
}

/** Xóa mềm 1 hoặc nhiều ngân hàng (bulk). Nhập lại mật khẩu (§14). */
export async function deleteBanks(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission('CONFIG_BANK_MANAGE', { action: 'BANK_DELETED', targetType: 'Bank' });
  if (!g.ok) return g;
  const { db, user } = g;

  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn ngân hàng để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'BANK_DELETED',
      targetType: 'Bank',
      after: { denied: true, reason: 'WRONG_PASSWORD', ids }
    });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }

  let deleted = 0;
  for (const id of ids) {
    const row = await db.bank.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.bank.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'BANK_DELETED',
      targetType: 'Bank',
      targetId: String(id),
      before: auditSnapshot({ name: row.name, code: row.code })
    });
    deleted++;
  }
  return { ok: true, deleted };
}

// ─────────────────────────────────────────────────────────────────────────────
// C3 — LOẠI THẺ (dùng trên máy POS), thuộc 1 ngân hàng
// ─────────────────────────────────────────────────────────────────────────────
export interface CardTypeDto extends AuditTrail {
  id: number;
  bankId: number;
  bankName: string | null;
  bankCode: string | null;
  name: string;
  code: string;
}
export interface CardTypeFilter {
  search?: string;
  bankId?: number;
  fromDate?: string;
  toDate?: string;
}
export interface CreateCardTypeInput {
  bankId: number;
  name: string;
  code: string;
}
export interface UpdateCardTypeInput {
  bankId?: number;
  name?: string;
  code?: string;
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock — mốc updatedAt client giữ lúc mở form
}

export async function listCardTypes(filter: CardTypeFilter = {}): Promise<{ ok: boolean; data?: CardTypeDto[]; error?: string; message?: string }> {
  const g = await requirePermission('CONFIG_BANK_VIEW', { action: 'CONFIG_BANK_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.cardType.findMany({
    where: {
      deletedAt: null,
      bankId: filter.bankId ?? undefined,
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search ? [{ code: { contains: filter.search, mode: 'insensitive' } }, { name: { contains: filter.search, mode: 'insensitive' } }] : undefined
    },
    orderBy: [{ bankId: 'asc' }, { name: 'asc' }]
  });
  const names = await resolveUserNames(g.db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  const bankIds = [...new Set(rows.map((r) => r.bankId))];
  const banks = await g.db.bank.findMany({ where: { id: { in: bankIds } }, select: { id: true, name: true, code: true } });
  const bankMap = new Map(banks.map((b) => [b.id, b]));
  const data = rows.map((r) => ({
    id: r.id,
    bankId: r.bankId,
    bankName: bankMap.get(r.bankId)?.name ?? null,
    bankCode: bankMap.get(r.bankId)?.code ?? null,
    name: r.name,
    code: r.code,
    ...trail(r, names)
  }));
  // Mr.Long 13/7 — "ưu tiên cùng 1 ngân hàng rồi mới đến ngân hàng khác": nhóm theo TÊN NGÂN HÀNG A→Z, trong mỗi
  // ngân hàng sắp theo tên loại thẻ. (orderBy DB không sort được theo bankName vì là join → sort tại service.)
  data.sort((a, b) => (a.bankName ?? '').localeCompare(b.bankName ?? '', 'vi') || a.name.localeCompare(b.name, 'vi'));
  return { ok: true, data };
}

export async function createCardType(input: CreateCardTypeInput): Promise<MutationResult> {
  const g = await requirePermission('CONFIG_BANK_MANAGE', { action: 'CARD_TYPE_CREATED', targetType: 'CardType' });
  if (!g.ok) return g;
  const { db, user } = g;

  const name = input.name?.trim();
  const code = input.code?.trim();
  if (!input.bankId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn ngân hàng cho loại thẻ.' };
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên loại thẻ bắt buộc.' };
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã loại thẻ bắt buộc.' };

  const bank = await db.bank.findUnique({ where: { id: input.bankId } });
  if (!bank || bank.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Ngân hàng đã chọn không tồn tại.' };

  const dup = await db.cardType.findFirst({ where: { bankId: input.bankId, code, deletedAt: null } });
  if (dup) return { ok: false, error: 'DUPLICATE', message: `Mã loại thẻ "${code}" đã tồn tại trong ngân hàng ${bank.code}.` };

  const created = await db.cardType.create({ data: { bankId: input.bankId, name, code, createdBy: user.id } });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'CARD_TYPE_CREATED',
    targetType: 'CardType',
    targetId: String(created.id),
    after: auditSnapshot({ bankId: input.bankId, bankCode: bank.code, name, code })
  });
  return { ok: true, id: created.id };
}

export async function updateCardType(id: number, input: UpdateCardTypeInput): Promise<MutationResult> {
  const g = await requirePermission('CONFIG_BANK_MANAGE', { action: 'CARD_TYPE_UPDATED', targetType: 'CardType', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.cardType.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Loại thẻ không tồn tại.' };
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;

  const bankId = input.bankId ?? row.bankId;
  const name = input.name !== undefined ? input.name.trim() : row.name;
  const code = input.code !== undefined ? input.code.trim() : row.code;
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên loại thẻ không được để trống.' };
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã loại thẻ không được để trống.' };

  const bank = await db.bank.findUnique({ where: { id: bankId } });
  if (!bank || bank.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Ngân hàng đã chọn không tồn tại.' };

  if (bankId !== row.bankId || code !== row.code) {
    const dup = await db.cardType.findFirst({ where: { bankId, code, deletedAt: null, NOT: { id } } });
    if (dup) return { ok: false, error: 'DUPLICATE', message: `Mã loại thẻ "${code}" đã tồn tại trong ngân hàng ${bank.code}.` };
  }

  const before = auditSnapshot({ bankId: row.bankId, name: row.name, code: row.code });
  const updated = await db.cardType.update({ where: { id }, data: { bankId, name, code, updatedBy: user.id } });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'CARD_TYPE_UPDATED',
    targetType: 'CardType',
    targetId: String(id),
    before,
    after: auditSnapshot({ bankId: updated.bankId, name: updated.name, code: updated.code })
  });
  return { ok: true, id };
}

export async function deleteCardTypes(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission('CONFIG_BANK_MANAGE', { action: 'CARD_TYPE_DELETED', targetType: 'CardType' });
  if (!g.ok) return g;
  const { db, user } = g;

  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn loại thẻ để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'CARD_TYPE_DELETED', targetType: 'CardType', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }

  let deleted = 0;
  for (const id of ids) {
    const row = await db.cardType.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.cardType.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'CARD_TYPE_DELETED',
      targetType: 'CardType',
      targetId: String(id),
      before: auditSnapshot({ bankId: row.bankId, name: row.name, code: row.code })
    });
    deleted++;
  }
  return { ok: true, deleted };
}

// ─────────────────────────────────────────────────────────────────────────────
// C4 — ĐỐI TÁC
// ─────────────────────────────────────────────────────────────────────────────
export interface PartnerDto extends AuditTrail {
  id: number;
  name: string;
  code: string;
  status: string; // SIGNED | UNSIGNED | TERMINATED (mã tra StatusOption entity=PARTNER)
  address: string | null;
  phone: string | null;
  email: string | null;
  contactPerson: string | null;
  bankIds: number[];
}
export interface PartnerFilter {
  search?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
}
export interface CreatePartnerInput {
  name: string;
  code: string;
  status?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  contactPerson?: string | null;
}
export interface UpdatePartnerInput {
  name?: string;
  code?: string;
  status?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  contactPerson?: string | null;
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock — mốc updatedAt client giữ lúc mở form
}

export async function listPartners(filter: PartnerFilter = {}): Promise<{ ok: boolean; data?: PartnerDto[]; error?: string; message?: string }> {
  const g = await requirePermission('CONFIG_BANK_VIEW', { action: 'CONFIG_BANK_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.partner.findMany({
    where: {
      deletedAt: null,
      status: filter.status || undefined,
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search
        ? [
            { code: { contains: filter.search, mode: 'insensitive' } },
            { name: { contains: filter.search, mode: 'insensitive' } },
            { phone: { contains: filter.search, mode: 'insensitive' } },
            { contactPerson: { contains: filter.search, mode: 'insensitive' } }
          ]
        : undefined
    },
    orderBy: { createdAt: 'asc' }
  });
  const names = await resolveUserNames(g.db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  const links = await g.db.partnerBank.findMany({ where: { deletedAt: null, partnerId: { in: rows.map((r) => r.id) } }, select: { partnerId: true, bankId: true } });
  const linkMap = new Map<number, number[]>();
  for (const l of links) linkMap.set(l.partnerId, [...(linkMap.get(l.partnerId) ?? []), l.bankId]);
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      status: r.status,
      address: r.address,
      phone: r.phone,
      email: r.email,
      contactPerson: r.contactPerson,
      bankIds: linkMap.get(r.id) ?? [],
      ...trail(r, names)
    }))
  };
}

export async function createPartner(input: CreatePartnerInput): Promise<MutationResult> {
  const g = await requirePermission('CONFIG_BANK_MANAGE', { action: 'PARTNER_CREATED', targetType: 'Partner' });
  if (!g.ok) return g;
  const { db, user } = g;

  const name = input.name?.trim();
  const code = input.code?.trim().toUpperCase();
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên đối tác bắt buộc.' };
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã đối tác bắt buộc.' };
  const status = input.status?.trim() || 'UNSIGNED';
  if (!(await isValidStatus('PARTNER', status))) return { ok: false, error: 'VALIDATION', message: 'Trạng thái đối tác không hợp lệ.' };

  const dup = await db.partner.findFirst({ where: { code } });
  if (dup) {
    return dup.deletedAt
      ? { ok: false, error: 'DUPLICATE_TRASH', message: `Mã đối tác "${code}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn mã khác.` }
      : { ok: false, error: 'DUPLICATE', message: `Mã đối tác "${code}" đã tồn tại.` };
  }

  let created;
  try {
    created = await db.partner.create({
      data: {
        name,
        code,
        status,
        address: input.address?.trim() || null,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        contactPerson: input.contactPerson?.trim() || null,
        createdBy: user.id
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Mã đối tác "${code}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'PARTNER_CREATED',
    targetType: 'Partner',
    targetId: String(created.id),
    after: auditSnapshot({ name: created.name, code: created.code, phone: created.phone, contactPerson: created.contactPerson })
  });
  return { ok: true, id: created.id };
}

export async function updatePartner(id: number, input: UpdatePartnerInput): Promise<MutationResult> {
  const g = await requirePermission('CONFIG_BANK_MANAGE', { action: 'PARTNER_UPDATED', targetType: 'Partner', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.partner.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Đối tác không tồn tại.' };
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;

  const name = input.name !== undefined ? input.name.trim() : row.name;
  const code = input.code !== undefined ? input.code.trim().toUpperCase() : row.code;
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên đối tác không được để trống.' };
  if (!code) return { ok: false, error: 'VALIDATION', message: 'Mã đối tác không được để trống.' };
  const status = input.status !== undefined ? input.status.trim() || row.status : row.status;
  if (input.status !== undefined && !(await isValidStatus('PARTNER', status))) return { ok: false, error: 'VALIDATION', message: 'Trạng thái đối tác không hợp lệ.' };
  if (code !== row.code) {
    const dup = await db.partner.findFirst({ where: { code, NOT: { id } } });
    if (dup) {
      return dup.deletedAt
        ? { ok: false, error: 'DUPLICATE_TRASH', message: `Mã đối tác "${code}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn mã khác.` }
        : { ok: false, error: 'DUPLICATE', message: `Mã đối tác "${code}" đã tồn tại.` };
    }
  }

  const before = auditSnapshot({ name: row.name, code: row.code, status: row.status, address: row.address, phone: row.phone, contactPerson: row.contactPerson });
  let updated;
  try {
    updated = await db.partner.update({
      where: { id },
      data: {
        name,
        code,
        status,
        address: input.address !== undefined ? input.address?.trim() || null : row.address,
        phone: input.phone !== undefined ? input.phone?.trim() || null : row.phone,
        email: input.email !== undefined ? input.email?.trim() || null : row.email,
        contactPerson: input.contactPerson !== undefined ? input.contactPerson?.trim() || null : row.contactPerson,
        updatedBy: user.id
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Mã đối tác "${code}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'PARTNER_UPDATED',
    targetType: 'Partner',
    targetId: String(id),
    before,
    after: auditSnapshot({ name: updated.name, code: updated.code, status: updated.status, address: updated.address, phone: updated.phone, contactPerson: updated.contactPerson })
  });
  return { ok: true, id };
}

export async function deletePartners(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission('CONFIG_BANK_MANAGE', { action: 'PARTNER_DELETED', targetType: 'Partner' });
  if (!g.ok) return g;
  const { db, user } = g;

  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn đối tác để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'PARTNER_DELETED', targetType: 'Partner', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }

  let deleted = 0;
  for (const id of ids) {
    const row = await db.partner.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.partner.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    // Hủy các liên kết ngân hàng của đối tác (soft) — audit riêng.
    await db.partnerBank.updateMany({ where: { partnerId: id, deletedAt: null }, data: { deletedAt: new Date(), updatedBy: user.id } });
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'PARTNER_DELETED',
      targetType: 'Partner',
      targetId: String(id),
      before: auditSnapshot({ name: row.name, code: row.code })
    });
    deleted++;
  }
  return { ok: true, deleted };
}

// ─────────────────────────────────────────────────────────────────────────────
// C4c — LIÊN KẾT ĐỐI TÁC ↔ NGÂN HÀNG (many-to-many)
// ─────────────────────────────────────────────────────────────────────────────
export interface PartnerBankMatrixRow {
  partnerId: number;
  partnerCode: string;
  partnerName: string;
  bankIds: number[];
}
export interface PartnerBankMatrix {
  banks: { id: number; code: string; name: string }[];
  rows: PartnerBankMatrixRow[];
}

/** Bảng tích xanh: mỗi đối tác × mọi ngân hàng đang có, ô nào liên kết = tích. */
export async function getPartnerBankMatrix(): Promise<{ ok: boolean; data?: PartnerBankMatrix; error?: string; message?: string }> {
  const g = await requirePermission('CONFIG_BANK_VIEW', { action: 'CONFIG_BANK_VIEW' });
  if (!g.ok) return g;
  const banks = await g.db.bank.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' }, select: { id: true, code: true, name: true } });
  const partners = await g.db.partner.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' }, select: { id: true, code: true, name: true } });
  const links = await g.db.partnerBank.findMany({ where: { deletedAt: null }, select: { partnerId: true, bankId: true } });
  const linkMap = new Map<number, number[]>();
  for (const l of links) linkMap.set(l.partnerId, [...(linkMap.get(l.partnerId) ?? []), l.bankId]);
  return {
    ok: true,
    data: {
      banks,
      rows: partners.map((p) => ({ partnerId: p.id, partnerCode: p.code, partnerName: p.name, bankIds: linkMap.get(p.id) ?? [] }))
    }
  };
}

/** Đặt tập ngân hàng liên kết cho 1 đối tác (thêm mới + hủy — soft, có audit từng thao tác). */
export async function setPartnerBanks(partnerId: number, bankIds: number[]): Promise<MutationResult & { linked?: number; unlinked?: number }> {
  const g = await requirePermission('CONFIG_BANK_MANAGE', { action: 'PARTNER_BANK_LINKED', targetType: 'Partner', targetId: String(partnerId) });
  if (!g.ok) return g;
  const { db, user } = g;

  const partner = await db.partner.findUnique({ where: { id: partnerId } });
  if (!partner || partner.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Đối tác không tồn tại.' };

  const want = new Set<number>();
  for (const bId of bankIds ?? []) {
    const bank = await db.bank.findUnique({ where: { id: bId } });
    if (!bank || bank.deletedAt) return { ok: false, error: 'NOT_FOUND', message: `Ngân hàng (id ${bId}) không tồn tại.` };
    want.add(bId);
  }

  const existing = await db.partnerBank.findMany({ where: { partnerId } });
  const activeNow = new Set(existing.filter((e) => e.deletedAt === null).map((e) => e.bankId));

  let linked = 0;
  let unlinked = 0;
  const now = new Date();

  // Thêm liên kết: bật lại bản soft-deleted hoặc tạo mới.
  for (const bankId of want) {
    if (activeNow.has(bankId)) continue;
    const prior = existing.find((e) => e.bankId === bankId);
    if (prior) {
      await db.partnerBank.update({ where: { id: prior.id }, data: { deletedAt: null, updatedBy: user.id } });
    } else {
      await db.partnerBank.create({ data: { partnerId, bankId, createdBy: user.id } });
    }
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'PARTNER_BANK_LINKED',
      targetType: 'Partner',
      targetId: String(partnerId),
      after: auditSnapshot({ partnerCode: partner.code, bankId })
    });
    linked++;
  }
  // Hủy liên kết không còn trong tập chọn (soft).
  for (const bankId of activeNow) {
    if (want.has(bankId)) continue;
    const prior = existing.find((e) => e.bankId === bankId && e.deletedAt === null);
    if (!prior) continue;
    await db.partnerBank.update({ where: { id: prior.id }, data: { deletedAt: now, updatedBy: user.id } });
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'PARTNER_BANK_UNLINKED',
      targetType: 'Partner',
      targetId: String(partnerId),
      before: auditSnapshot({ partnerCode: partner.code, bankId })
    });
    unlinked++;
  }
  return { ok: true, linked, unlinked };
}

/** Danh sách ngân hàng gọn cho dropdown (chọn ngân hàng cho loại thẻ / liên kết đối tác). */
export async function listBanksLite(): Promise<{ ok: boolean; data?: { id: number; code: string; name: string }[]; error?: string; message?: string }> {
  const g = await requirePermission('CONFIG_BANK_VIEW', { action: 'CONFIG_BANK_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.bank.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' }, select: { id: true, code: true, name: true } });
  return { ok: true, data: rows };
}
