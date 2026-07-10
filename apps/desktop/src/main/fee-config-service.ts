// Cấu hình phí (main). IMS_SPEC §C5. Permission-guarded (CONFIG_FEE_VIEW/MANAGE), audited,
// soft-delete. Gồm: Loại phí (§C5a) · Biểu phí % theo Đối tác × Loại thẻ (§C5b).
// Phí lưu Int = phần trăm × 1000 (≤3 số thập phân, chính xác — KHÔNG float). Chênh lệch NCC/KH
// là cột TÍNH động: CL_NCC = phiMua−phiCaiMay, CL_KH = phiBan−phiCaiMay.
import { auditSnapshot, pickEffectiveRate } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';

const VIEW = 'CONFIG_FEE_VIEW';
const MANAGE = 'CONFIG_FEE_MANAGE';
const SCALE = 1000; // phần trăm × 1000

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

/** Phần trăm (số, ≤3 thập phân, ≥0) → Int ×1000. null nếu không hợp lệ. */
function pctToMilli(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  const milli = Math.round(n * SCALE);
  if (Math.abs(n * SCALE - milli) > 1e-6) return null; // quá 3 số thập phân
  return milli;
}
const milliToPct = (m: number): number => m / SCALE;

/** ISO string / Date → Date hợp lệ, hoặc null. */
function parseDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
/**
 * Chuẩn hóa về nửa đêm 00:00:00.000 LOCAL của NGÀY (P1.1: "1 kỳ / 1 mốc effectiveFrom-ngày").
 * B16/F1: PHẢI floor theo LOCAL-day — đối xứng với `fmtDate` (getter local) và `txnDate` (UI gửi
 * `new Date(d+'T00:00:00').toISOString()` = nửa đêm local). Floor theo UTC-day lệch +7h trên máy
 * UTC+7 (production) → user nhập 01/07 nhưng lưu/hiển thị 30/06. Không dùng UTC getters ở đây.
 */
function startOfDayLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// ═════════════════════════════════════════════════════════════════════════════
// §C5a — LOẠI PHÍ BÁN
// ═════════════════════════════════════════════════════════════════════════════
export interface FeeTypeDto extends AuditTrail {
  id: number;
  name: string;
}
export interface CreateFeeTypeInput {
  name: string;
}
export interface UpdateFeeTypeInput {
  name?: string;
}

export async function listFeeTypes(): Promise<{ ok: boolean; data?: FeeTypeDto[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const rows = await g.db.feeType.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' } });
  const names = await resolveUserNames(g.db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  return { ok: true, data: rows.map((r) => ({ id: r.id, name: r.name, ...trail(r, names) })) };
}

export async function createFeeType(input: CreateFeeTypeInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'FEE_TYPE_CREATED', targetType: 'FeeType' });
  if (!g.ok) return g;
  const { db, user } = g;
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên loại phí bắt buộc.' };
  const dup = await db.feeType.findFirst({ where: { name } });
  if (dup) {
    return dup.deletedAt
      ? { ok: false, error: 'DUPLICATE_TRASH', message: `Loại phí "${name}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn tên khác.` }
      : { ok: false, error: 'DUPLICATE', message: `Loại phí "${name}" đã tồn tại.` };
  }
  let created;
  try {
    created = await db.feeType.create({ data: { name, createdBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Loại phí "${name}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'FEE_TYPE_CREATED', targetType: 'FeeType', targetId: String(created.id), after: auditSnapshot({ name }) });
  return { ok: true, id: created.id };
}

export async function updateFeeType(id: number, input: UpdateFeeTypeInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'FEE_TYPE_UPDATED', targetType: 'FeeType', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;
  const row = await db.feeType.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Loại phí không tồn tại.' };
  const name = input.name !== undefined ? input.name.trim() : row.name;
  if (!name) return { ok: false, error: 'VALIDATION', message: 'Tên loại phí không được để trống.' };
  if (name !== row.name) {
    const dup = await db.feeType.findFirst({ where: { name, NOT: { id } } });
    if (dup) {
      return dup.deletedAt
        ? { ok: false, error: 'DUPLICATE_TRASH', message: `Loại phí "${name}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn tên khác.` }
        : { ok: false, error: 'DUPLICATE', message: `Loại phí "${name}" đã tồn tại.` };
    }
  }
  const before = auditSnapshot({ name: row.name });
  let updated;
  try {
    updated = await db.feeType.update({ where: { id }, data: { name, updatedBy: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `Loại phí "${name}" đã tồn tại.` };
    throw e;
  }
  await writeAudit(db, { actorUserId: user.id, action: 'FEE_TYPE_UPDATED', targetType: 'FeeType', targetId: String(id), before, after: auditSnapshot({ name: updated.name }) });
  return { ok: true, id };
}

export async function deleteFeeTypes(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission(MANAGE, { action: 'FEE_TYPE_DELETED', targetType: 'FeeType' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn loại phí để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'FEE_TYPE_DELETED', targetType: 'FeeType', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.feeType.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.feeType.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'FEE_TYPE_DELETED', targetType: 'FeeType', targetId: String(id), before: auditSnapshot({ name: row.name }) });
    deleted++;
  }
  return { ok: true, deleted };
}

// ═════════════════════════════════════════════════════════════════════════════
// §C5b — BIỂU PHÍ % theo Đối tác × Loại thẻ
// ═════════════════════════════════════════════════════════════════════════════
export interface FeeRateDto extends AuditTrail {
  id: number;
  partnerId: number;
  partnerCode: string | null;
  partnerName: string | null;
  cardTypeId: number;
  cardTypeCode: string | null;
  cardTypeName: string | null;
  bankId: number | null;
  bankCode: string | null;
  bankName: string | null;
  phiMua: number; // %
  phiCaiMay: number; // %
  phiBan: number; // %
  clNcc: number; // % = phiMua − phiCaiMay
  clKh: number; // % = phiBan − phiCaiMay
  effectiveFrom: string; // ISO — ngày bắt đầu hiệu lực của kỳ giá (P1.1)
  isCurrent: boolean; // kỳ đang hiệu lực HÔM NAY của tổ hợp (đối tác × loại thẻ)
}
export interface FeeRateFilter {
  partnerId?: number;
  bankId?: number;
  cardTypeId?: number;
}
export interface SetFeeRateInput {
  partnerId: number;
  cardTypeId: number;
  phiMua: number; // %
  phiCaiMay: number; // %
  phiBan: number; // %
  effectiveFrom?: string; // ISO — không truyền = mặc định HÔM NAY (P1.1)
}

export async function listFeeRates(filter: FeeRateFilter = {}): Promise<{ ok: boolean; data?: FeeRateDto[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const db = g.db;
  const rows = await db.feeRate.findMany({
    where: { deletedAt: null, partnerId: filter.partnerId ?? undefined, cardTypeId: filter.cardTypeId ?? undefined },
    orderBy: [{ partnerId: 'asc' }, { cardTypeId: 'asc' }, { effectiveFrom: 'desc' }]
  });
  // P1.1: kỳ ĐANG HIỆU LỰC hôm nay của MỖI tổ hợp (đối tác × loại thẻ) — pickEffectiveRate(now).
  const now = new Date();
  const currentIdByCombo = new Map<string, number>();
  {
    const byCombo = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = `${r.partnerId}:${r.cardTypeId}`;
      const arr = byCombo.get(key) ?? [];
      arr.push(r);
      byCombo.set(key, arr);
    }
    for (const [key, arr] of byCombo) {
      const cur = pickEffectiveRate(arr, now);
      if (cur) currentIdByCombo.set(key, cur.id);
    }
  }
  const names = await resolveUserNames(db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  const partners = new Map((await db.partner.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.partnerId))] } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
  const cards = new Map((await db.cardType.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.cardTypeId))] } }, select: { id: true, code: true, name: true, bankId: true } })).map((c) => [c.id, c]));
  const banks = new Map((await db.bank.findMany({ where: { id: { in: [...new Set([...cards.values()].map((c) => c.bankId))] } }, select: { id: true, code: true, name: true } })).map((b) => [b.id, b]));
  let data = rows.map((r) => {
    const card = cards.get(r.cardTypeId);
    const bank = card ? banks.get(card.bankId) : undefined;
    return {
      id: r.id,
      partnerId: r.partnerId,
      partnerCode: partners.get(r.partnerId)?.code ?? null,
      partnerName: partners.get(r.partnerId)?.name ?? null,
      cardTypeId: r.cardTypeId,
      cardTypeCode: card?.code ?? null,
      cardTypeName: card?.name ?? null,
      bankId: card?.bankId ?? null,
      bankCode: bank?.code ?? null,
      bankName: bank?.name ?? null,
      phiMua: milliToPct(r.phiMua),
      phiCaiMay: milliToPct(r.phiCaiMay),
      phiBan: milliToPct(r.phiBan),
      clNcc: milliToPct(r.phiMua - r.phiCaiMay),
      clKh: milliToPct(r.phiBan - r.phiCaiMay),
      effectiveFrom: r.effectiveFrom.toISOString(),
      isCurrent: currentIdByCombo.get(`${r.partnerId}:${r.cardTypeId}`) === r.id,
      ...trail(r, names)
    };
  });
  if (filter.bankId) data = data.filter((d) => d.bankId === filter.bankId);
  return { ok: true, data };
}

/**
 * Set biểu phí cho 1 KỲ của tổ hợp (Đối tác × Loại thẻ) tại mốc `effectiveFrom` (P1.1).
 * UPSERT theo (partnerId, cardTypeId, effectiveFrom-NGÀY): đã có kỳ CÙNG mốc (kể cả xóa mềm→bật lại)
 * → cập nhật; khác mốc → TẠO KỲ MỚI (hai kỳ khác effectiveFrom cùng tồn tại). Không báo lỗi "trùng".
 * Không truyền effectiveFrom → mặc định HÔM NAY.
 */
export async function setFeeRate(input: SetFeeRateInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'FEE_RATE_SET', targetType: 'FeeRate' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!input.partnerId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn đối tác.' };
  if (!input.cardTypeId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn loại thẻ.' };
  const phiMua = pctToMilli(input.phiMua);
  const phiCaiMay = pctToMilli(input.phiCaiMay);
  const phiBan = pctToMilli(input.phiBan);
  if (phiMua === null) return { ok: false, error: 'VALIDATION', message: 'Phí mua không hợp lệ (≥0, tối đa 3 số thập phân).' };
  if (phiCaiMay === null) return { ok: false, error: 'VALIDATION', message: 'Phí cài máy không hợp lệ (≥0, tối đa 3 số thập phân).' };
  if (phiBan === null) return { ok: false, error: 'VALIDATION', message: 'Phí bán không hợp lệ (≥0, tối đa 3 số thập phân).' };
  const effRaw = input.effectiveFrom !== undefined ? parseDate(input.effectiveFrom) : new Date();
  if (!effRaw) return { ok: false, error: 'VALIDATION', message: 'Ngày hiệu lực không hợp lệ.' };
  const effectiveFrom = startOfDayLocal(effRaw);

  const partner = await db.partner.findUnique({ where: { id: input.partnerId } });
  if (!partner || partner.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Đối tác không tồn tại.' };
  const card = await db.cardType.findUnique({ where: { id: input.cardTypeId } });
  if (!card || card.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Loại thẻ không tồn tại.' };
  // Loại thẻ thuộc ngân hàng — ngân hàng đó phải liên kết với đối tác (§C5b: chọn NH liên kết đối tác).
  const link = await db.partnerBank.findFirst({ where: { partnerId: input.partnerId, bankId: card.bankId, deletedAt: null } });
  if (!link) return { ok: false, error: 'NOT_LINKED', message: 'Ngân hàng của loại thẻ này chưa liên kết với đối tác. Hãy liên kết ở mục Đối tác trước.' };

  // Upsert theo KỲ: tìm kỳ cùng mốc (cùng NGÀY effectiveFrom, kể cả bản xóa mềm) → cập nhật; khác mốc → tạo kỳ mới.
  const dayEnd = new Date(effectiveFrom.getTime() + 86_400_000);
  const existing = await db.feeRate.findFirst({
    where: { partnerId: input.partnerId, cardTypeId: input.cardTypeId, effectiveFrom: { gte: effectiveFrom, lt: dayEnd } }
  });
  if (existing) {
    const before = auditSnapshot({ phiMua: existing.phiMua, phiCaiMay: existing.phiCaiMay, phiBan: existing.phiBan, effectiveFrom: existing.effectiveFrom.toISOString(), deleted: existing.deletedAt !== null });
    const updated = await db.feeRate.update({ where: { id: existing.id }, data: { phiMua, phiCaiMay, phiBan, effectiveFrom, deletedAt: null, deletedBy: null, updatedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'FEE_RATE_SET', targetType: 'FeeRate', targetId: String(updated.id), before, after: auditSnapshot({ phiMua, phiCaiMay, phiBan, effectiveFrom: effectiveFrom.toISOString() }) });
    return { ok: true, id: updated.id };
  }
  const created = await db.feeRate.create({ data: { partnerId: input.partnerId, cardTypeId: input.cardTypeId, phiMua, phiCaiMay, phiBan, effectiveFrom, createdBy: user.id } });
  await writeAudit(db, { actorUserId: user.id, action: 'FEE_RATE_SET', targetType: 'FeeRate', targetId: String(created.id), after: auditSnapshot({ partnerId: input.partnerId, cardTypeId: input.cardTypeId, phiMua, phiCaiMay, phiBan, effectiveFrom: effectiveFrom.toISOString() }) });
  return { ok: true, id: created.id };
}

export async function deleteFeeRates(ids: number[], password: string): Promise<MutationResult & { deleted?: number }> {
  const g = await requirePermission(MANAGE, { action: 'FEE_RATE_DELETED', targetType: 'FeeRate' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!ids || ids.length === 0) return { ok: false, error: 'VALIDATION', message: 'Chưa chọn biểu phí để xóa.' };
  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'FEE_RATE_DELETED', targetType: 'FeeRate', after: { denied: true, reason: 'WRONG_PASSWORD', ids } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }
  let deleted = 0;
  for (const id of ids) {
    const row = await db.feeRate.findUnique({ where: { id } });
    if (!row || row.deletedAt) continue;
    await db.feeRate.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id, deletedBy: user.id } });
    await writeAudit(db, { actorUserId: user.id, action: 'FEE_RATE_DELETED', targetType: 'FeeRate', targetId: String(id), before: auditSnapshot({ partnerId: row.partnerId, cardTypeId: row.cardTypeId }) });
    deleted++;
  }
  return { ok: true, deleted };
}
