// Cấu hình phí (main). IMS_SPEC §C5. Permission-guarded (CONFIG_FEE_VIEW/MANAGE), audited,
// soft-delete. Gồm: Loại phí (§C5a) · Biểu phí % theo Đối tác × Loại thẻ (§C5b).
// Phí lưu Int = phần trăm × 1000 (≤3 số thập phân, chính xác — KHÔNG float). Chênh lệch NCC/KH
// là cột TÍNH động: CL_NCC = phiMua−phiCaiMay, CL_KH = phiBan−phiCaiMay.
import { auditSnapshot, pickEffectiveRate } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { staleGuard } from './optimistic-lock.js';

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
  expectedUpdatedAt?: string | null; // R48 #2 optimistic-lock — mốc updatedAt client giữ lúc mở form
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
  const stale = staleGuard(row.updatedAt, input.expectedUpdatedAt);
  if (stale) return stale;
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
// FEE_MODEL — 1 % phí bán niêm yết của 1 LOẠI PHÍ trong biểu phí (Đối tác × Loại thẻ × kỳ).
export interface FeeSellQuoteDto {
  feeTypeId: number; // LOẠI PHÍ (Ủy quyền/Tiền chờ/Tiền nhanh…)
  feeTypeName: string | null;
  phiBan: number; // % niêm yết của loại phí này
  clKh: number; // % = phiBan − phiCaiMay (chênh bán của loại phí này)
}
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
  phiMua: number; // % — CỐ ĐỊNH (không theo loại phí)
  phiCaiMay: number; // % — CỐ ĐỊNH (không theo loại phí)
  clNcc: number; // % = phiMua − phiCaiMay (giống nhau mọi loại phí)
  effectiveFrom: string; // ISO — ngày bắt đầu hiệu lực của kỳ giá (P1.1)
  isCurrent: boolean; // kỳ đang hiệu lực HÔM NAY của tổ hợp (đối tác × loại thẻ)
  sellQuotes: FeeSellQuoteDto[]; // phí bán niêm yết theo TỪNG loại phí (cùng kỳ effectiveFrom)
}
export interface FeeRateFilter {
  partnerId?: number;
  bankId?: number;
  cardTypeId?: number;
}
export interface SetFeeRateInput {
  partnerId: number;
  cardTypeId: number;
  phiMua: number; // % — CỐ ĐỊNH
  phiCaiMay: number; // % — CỐ ĐỊNH
  effectiveFrom?: string; // ISO — không truyền = mặc định HÔM NAY (P1.1)
  // Phí bán NIÊM YẾT cho MỌI loại phí bán trong danh mục — mỗi loại phí 1 %.
  sellQuotes: { feeTypeId: number; phiBan: number }[];
}
// Phí bán niêm yết hiệu lực theo loại phí (listSellQuotes) — tham chiếu khi set phí bán TID / xem biểu phí.
export interface SellQuoteEffectiveDto {
  feeTypeId: number;
  feeTypeName: string | null;
  phiBan: number; // %
  effectiveFrom: string; // ISO
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
  // FEE_MODEL — phí bán niêm yết theo TỪNG loại phí (FeeSellQuote), khớp mỗi kỳ FeeRate theo
  // (partnerId, cardTypeId, effectiveFrom) — cùng mốc thời gian (startOfDayLocal khi set).
  const comboCards = [...new Set(rows.map((r) => r.cardTypeId))];
  const comboPartners = [...new Set(rows.map((r) => r.partnerId))];
  const quotes = rows.length
    ? await db.feeSellQuote.findMany({ where: { deletedAt: null, partnerId: { in: comboPartners }, cardTypeId: { in: comboCards } } })
    : [];
  const quotesByPeriod = new Map<string, typeof quotes>();
  for (const q of quotes) {
    const key = `${q.partnerId}:${q.cardTypeId}:${q.effectiveFrom.getTime()}`;
    const arr = quotesByPeriod.get(key) ?? [];
    arr.push(q);
    quotesByPeriod.set(key, arr);
  }
  const names = await resolveUserNames(db, rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  const partners = new Map((await db.partner.findMany({ where: { id: { in: comboPartners } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
  const cards = new Map((await db.cardType.findMany({ where: { id: { in: comboCards } }, select: { id: true, code: true, name: true, bankId: true } })).map((c) => [c.id, c]));
  const banks = new Map((await db.bank.findMany({ where: { id: { in: [...new Set([...cards.values()].map((c) => c.bankId))] } }, select: { id: true, code: true, name: true } })).map((b) => [b.id, b]));
  const feeTypes = new Map((await db.feeType.findMany({ where: { id: { in: [...new Set(quotes.map((q) => q.feeTypeId))] } }, select: { id: true, name: true } })).map((f) => [f.id, f.name]));
  let data = rows.map((r) => {
    const card = cards.get(r.cardTypeId);
    const bank = card ? banks.get(card.bankId) : undefined;
    const periodQuotes = (quotesByPeriod.get(`${r.partnerId}:${r.cardTypeId}:${r.effectiveFrom.getTime()}`) ?? [])
      .slice()
      .sort((a, b) => a.feeTypeId - b.feeTypeId);
    const sellQuotes: FeeSellQuoteDto[] = periodQuotes.map((q) => ({
      feeTypeId: q.feeTypeId,
      feeTypeName: feeTypes.get(q.feeTypeId) ?? null,
      phiBan: milliToPct(q.phiBan),
      clKh: milliToPct(q.phiBan - r.phiCaiMay)
    }));
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
      clNcc: milliToPct(r.phiMua - r.phiCaiMay),
      effectiveFrom: r.effectiveFrom.toISOString(),
      isCurrent: currentIdByCombo.get(`${r.partnerId}:${r.cardTypeId}`) === r.id,
      sellQuotes,
      ...trail(r, names)
    };
  });
  if (filter.bankId) data = data.filter((d) => d.bankId === filter.bankId);
  return { ok: true, data };
}

/**
 * Set biểu phí cho 1 KỲ của tổ hợp (Đối tác × Loại thẻ) tại mốc `effectiveFrom` (P1.1). FEE_MODEL:
 *   • phí MUA + phí CÀI MÁY = 1 giá CỐ ĐỊNH (FeeRate) — KHÔNG theo loại phí.
 *   • phí BÁN NIÊM YẾT theo TỪNG loại phí (FeeSellQuote) — mỗi loại phí 1 %.
 * UPSERT theo (partnerId, cardTypeId, effectiveFrom-NGÀY) cho FeeRate + theo thêm chiều feeTypeId cho mỗi
 * FeeSellQuote. Đã có kỳ CÙNG mốc (kể cả xóa mềm→bật lại) → cập nhật; khác mốc → TẠO KỲ MỚI. Toàn bộ trong
 * 1 $transaction (nguyên tử). Không truyền effectiveFrom → mặc định HÔM NAY.
 */
export async function setFeeRate(input: SetFeeRateInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'FEE_RATE_SET', targetType: 'FeeRate' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!input.partnerId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn đối tác.' };
  if (!input.cardTypeId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn loại thẻ.' };
  const phiMua = pctToMilli(input.phiMua);
  const phiCaiMay = pctToMilli(input.phiCaiMay);
  if (phiMua === null) return { ok: false, error: 'VALIDATION', message: 'Phí mua không hợp lệ (≥0, tối đa 3 số thập phân).' };
  if (phiCaiMay === null) return { ok: false, error: 'VALIDATION', message: 'Phí cài máy không hợp lệ (≥0, tối đa 3 số thập phân).' };
  // Phí bán niêm yết BẮT BUỘC cấu hình cho ≥1 loại phí (danh mục ≥3 loại — UI gửi hết loại phí active).
  if (!Array.isArray(input.sellQuotes) || input.sellQuotes.length === 0)
    return { ok: false, error: 'VALIDATION', message: 'Vui lòng nhập phí bán niêm yết cho ít nhất một loại phí.' };
  // B86 (Mr.Long 23/7, sửa B45 suy luận sai): phí cài máy KHÔNG ràng buộc với phí mua/phí bán (spec
  // IMS_SPEC dòng 1170 chỉ yêu cầu hiển thị âm màu đỏ trong ngoặc, không chặn lưu). Ràng buộc DUY NHẤT
  // trong toàn hệ thống phí: phí bán (niêm yết + thực tế) KHÔNG được thấp hơn phí mua — thấp hơn là bán lỗ.
  const quotesMilli: { feeTypeId: number; phiBan: number }[] = [];
  const seenFeeType = new Set<number>();
  for (const q of input.sellQuotes) {
    if (!q.feeTypeId) return { ok: false, error: 'VALIDATION', message: 'Thiếu loại phí cho phí bán niêm yết.' };
    if (seenFeeType.has(q.feeTypeId)) return { ok: false, error: 'VALIDATION', message: 'Trùng loại phí trong danh sách phí bán niêm yết.' };
    seenFeeType.add(q.feeTypeId);
    const phiBan = pctToMilli(q.phiBan);
    if (phiBan === null) return { ok: false, error: 'VALIDATION', message: 'Phí bán niêm yết không hợp lệ (≥0, tối đa 3 số thập phân).' };
    if (phiBan < phiMua) return { ok: false, error: 'VALIDATION', message: 'Phí bán niêm yết phải ≥ phí mua (bán thấp hơn mua là lỗ).' };
    quotesMilli.push({ feeTypeId: q.feeTypeId, phiBan });
  }
  const effRaw = input.effectiveFrom !== undefined ? parseDate(input.effectiveFrom) : new Date();
  if (!effRaw) return { ok: false, error: 'VALIDATION', message: 'Ngày hiệu lực không hợp lệ.' };
  const effectiveFrom = startOfDayLocal(effRaw);

  const partner = await db.partner.findUnique({ where: { id: input.partnerId } });
  if (!partner || partner.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Đối tác không tồn tại.' };
  const card = await db.cardType.findUnique({ where: { id: input.cardTypeId } });
  if (!card || card.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Loại thẻ không tồn tại.' };
  // Mỗi loại phí niêm yết phải tồn tại + chưa xóa.
  for (const q of quotesMilli) {
    const feeType = await db.feeType.findUnique({ where: { id: q.feeTypeId } });
    if (!feeType || feeType.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Loại phí không tồn tại.' };
  }
  // Loại thẻ thuộc ngân hàng — ngân hàng đó phải liên kết với đối tác (§C5b: chọn NH liên kết đối tác).
  const link = await db.partnerBank.findFirst({ where: { partnerId: input.partnerId, bankId: card.bankId, deletedAt: null } });
  if (!link) return { ok: false, error: 'NOT_LINKED', message: 'Ngân hàng của loại thẻ này chưa liên kết với đối tác. Hãy liên kết ở mục Đối tác trước.' };

  // Upsert theo KỲ (cùng NGÀY effectiveFrom, kể cả bản xóa mềm) — FeeRate + mỗi FeeSellQuote — nguyên tử.
  const dayEnd = new Date(effectiveFrom.getTime() + 86_400_000);
  const rateId = await db.$transaction(async (tx) => {
    const existing = await tx.feeRate.findFirst({
      where: { partnerId: input.partnerId, cardTypeId: input.cardTypeId, effectiveFrom: { gte: effectiveFrom, lt: dayEnd } }
    });
    let id: number;
    if (existing) {
      await tx.feeRate.update({ where: { id: existing.id }, data: { phiMua, phiCaiMay, effectiveFrom, deletedAt: null, deletedBy: null, updatedBy: user.id } });
      id = existing.id;
    } else {
      const created = await tx.feeRate.create({ data: { partnerId: input.partnerId, cardTypeId: input.cardTypeId, phiMua, phiCaiMay, effectiveFrom, createdBy: user.id } });
      id = created.id;
    }
    for (const q of quotesMilli) {
      const exQ = await tx.feeSellQuote.findFirst({
        where: { partnerId: input.partnerId, cardTypeId: input.cardTypeId, feeTypeId: q.feeTypeId, effectiveFrom: { gte: effectiveFrom, lt: dayEnd } }
      });
      if (exQ) {
        await tx.feeSellQuote.update({ where: { id: exQ.id }, data: { phiBan: q.phiBan, effectiveFrom, deletedAt: null, deletedBy: null, updatedBy: user.id } });
      } else {
        await tx.feeSellQuote.create({ data: { partnerId: input.partnerId, cardTypeId: input.cardTypeId, feeTypeId: q.feeTypeId, phiBan: q.phiBan, effectiveFrom, createdBy: user.id } });
      }
    }
    return id;
  });
  await writeAudit(db, { actorUserId: user.id, action: 'FEE_RATE_SET', targetType: 'FeeRate', targetId: String(rateId), after: auditSnapshot({ partnerId: input.partnerId, cardTypeId: input.cardTypeId, phiMua, phiCaiMay, effectiveFrom: effectiveFrom.toISOString(), sellQuotes: quotesMilli }) });
  return { ok: true, id: rateId };
}

/**
 * FEE_MODEL — phí bán NIÊM YẾT hiệu lực theo TỪNG loại phí của (Đối tác × Loại thẻ) tại `at` (mặc định HÔM
 * NAY). Mỗi loại phí lấy KỲ FeeSellQuote hiệu lực (pickEffectiveRate). Dùng cho form phí bán TID (tham chiếu).
 */
export async function listSellQuotes(partnerId: number, cardTypeId: number, at?: string): Promise<{ ok: boolean; data?: SellQuoteEffectiveDto[]; error?: string; message?: string }> {
  const g = await requirePermission(VIEW, { action: VIEW });
  if (!g.ok) return g;
  const db = g.db;
  if (!partnerId || !cardTypeId) return { ok: false, error: 'VALIDATION', message: 'Thiếu đối tác hoặc loại thẻ.' };
  const when = at ? parseDate(at) ?? new Date() : new Date();
  const quotes = await db.feeSellQuote.findMany({ where: { partnerId, cardTypeId, deletedAt: null } });
  const byFeeType = new Map<number, typeof quotes>();
  for (const q of quotes) {
    const arr = byFeeType.get(q.feeTypeId) ?? [];
    arr.push(q);
    byFeeType.set(q.feeTypeId, arr);
  }
  const feeTypeNames = new Map((await db.feeType.findMany({ where: { id: { in: [...byFeeType.keys()] } }, select: { id: true, name: true } })).map((f) => [f.id, f.name]));
  const data: SellQuoteEffectiveDto[] = [];
  for (const [feeTypeId, arr] of byFeeType) {
    const eff = pickEffectiveRate(arr, when);
    if (!eff) continue;
    data.push({ feeTypeId, feeTypeName: feeTypeNames.get(feeTypeId) ?? null, phiBan: milliToPct(eff.phiBan), effectiveFrom: eff.effectiveFrom.toISOString() });
  }
  data.sort((a, b) => a.feeTypeId - b.feeTypeId);
  return { ok: true, data };
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
    const now = new Date();
    // FEE_MODEL — xóa 1 kỳ biểu phí cũng xóa mềm các phí bán niêm yết CÙNG KỲ (partner × card × effectiveFrom).
    await db.$transaction(async (tx) => {
      await tx.feeRate.update({ where: { id }, data: { deletedAt: now, updatedBy: user.id, deletedBy: user.id } });
      await tx.feeSellQuote.updateMany({ where: { partnerId: row.partnerId, cardTypeId: row.cardTypeId, effectiveFrom: row.effectiveFrom, deletedAt: null }, data: { deletedAt: now, updatedBy: user.id, deletedBy: user.id } });
    });
    await writeAudit(db, { actorUserId: user.id, action: 'FEE_RATE_DELETED', targetType: 'FeeRate', targetId: String(id), before: auditSnapshot({ partnerId: row.partnerId, cardTypeId: row.cardTypeId }) });
    deleted++;
  }
  return { ok: true, deleted };
}
