// R30 (Mr.Long 11/7) — Phí BÁN THỰC TẾ theo từng TID × Loại thẻ (tùy biến theo khách, set khi GIAO máy).
// Biểu phí FeeRate (Đối tác × Loại thẻ) = phí NIÊM YẾT chung; phí bán thật thỏa thuận riêng mỗi TID/thẻ.
// Lưu Int = %×1000 (như FeeRate). `resolveFeeForTxn` (transaction-service) ưu tiên override này thay cho
// FeeRate.phiBan khi tính CL_KH; phí cài máy vẫn lấy từ kỳ FeeRate hiệu lực tại ngày GD.
// View = TID_VIEW; set = TID_MANAGE (thao tác vận hành lúc giao). Audit đầy đủ, soft-delete-aware upsert.
import { pickEffectiveRate } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission } from './guard.js';
import { writeAudit } from './audit.js';

const VIEW = 'TID_VIEW';
const MANAGE = 'TID_MANAGE';
const SCALE = 1000; // phần trăm × 1000

const milliToPct = (m: number): number => m / SCALE;
const pctToMilli = (p: number): number => Math.round(p * SCALE);

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

export interface TidSellFeeRowDto {
  cardTypeId: number;
  cardTypeCode: string | null;
  cardTypeName: string;
  phiMuaNiemYet: number | null; // % — phí MUA niêm yết (FeeRate hiệu lực; tham chiếu chênh mua = mua − cài máy)
  phiBanNiemYet: number | null; // % — phí bán niêm yết (FeeSellQuote loại phí này, hiệu lực hôm nay), null nếu chưa cấu hình
  phiCaiMayNiemYet: number | null; // % — phí cài máy niêm yết (FeeRate hiệu lực; tham chiếu CL_KH = bán − cài máy)
  phiBanThucTe: number | null; // % — phí bán THỰC TẾ (override), null = dùng niêm yết
  hasOverride: boolean; // có TidSellFee tùy chỉnh cho (tid × thẻ × loại phí) đang xem
}
export interface TidSellFeeListDto {
  tidId: number;
  tid: string;
  feeTypeId: number; // LOẠI PHÍ đang xem
  bankId: number | null;
  bankCode: string | null;
  partnerId: number | null;
  rows: TidSellFeeRowDto[];
}

/**
 * Liệt kê phí bán theo TID: mỗi loại thẻ của NGÂN HÀNG của TID → phí bán niêm yết (kỳ FeeRate hiệu lực
 * hôm nay của Đối tác × thẻ) + phí bán thực tế đã set (nếu có). UI dùng để đối chiếu khi nhập.
 */
export async function listTidSellFees(tidId: number, feeTypeId: number): Promise<{ ok: boolean; error?: string; message?: string; data?: TidSellFeeListDto }> {
  const g = await requirePermission(VIEW, { action: 'TID_VIEW', targetType: 'Tid', targetId: String(tidId) });
  if (!g.ok) return g;
  const { db } = g;
  if (!feeTypeId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn loại phí.' };
  const tid = await db.tid.findUnique({ where: { id: tidId } });
  if (!tid || tid.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'TID không tồn tại.' };
  // FEE_TYPE — phí bán thực tế + niêm yết đều tra theo LOẠI PHÍ đã chọn.
  const feeType = await db.feeType.findUnique({ where: { id: feeTypeId } });
  if (!feeType || feeType.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Loại phí không tồn tại.' };

  const bank = tid.bankId != null ? await db.bank.findUnique({ where: { id: tid.bankId }, select: { code: true } }) : null;
  // Loại thẻ của ngân hàng TID (nếu TID chưa gán ngân hàng → rỗng, UI báo cấu hình TID trước).
  const cards = tid.bankId != null ? await db.cardType.findMany({ where: { bankId: tid.bankId, deletedAt: null }, orderBy: { id: 'asc' } }) : [];
  // orderBy id asc → Map giữ dòng CUỐI = id lớn nhất (mới nhất), khớp resolveFeeForTxn (orderBy id desc → id lớn nhất).
  const overrides = await db.tidSellFee.findMany({ where: { tidId, feeTypeId, deletedAt: null }, orderBy: { id: 'asc' } });
  const ovByCard = new Map(overrides.map((o) => [o.cardTypeId, o]));
  const now = new Date();

  const rows: TidSellFeeRowDto[] = [];
  for (const c of cards) {
    let phiMuaNiemYet: number | null = null;
    let phiBanNiemYet: number | null = null;
    let phiCaiMayNiemYet: number | null = null;
    if (tid.partnerId != null) {
      // FEE_MODEL — phí mua + phí cài máy niêm yết từ FeeRate (cố định, không loại phí); phí bán niêm yết từ
      // FeeSellQuote theo LOẠI PHÍ đã chọn (mỗi loại phí 1 % niêm yết).
      const rates = await db.feeRate.findMany({ where: { partnerId: tid.partnerId, cardTypeId: c.id, deletedAt: null } });
      const rate = pickEffectiveRate(rates, now);
      if (rate) { phiMuaNiemYet = milliToPct(rate.phiMua); phiCaiMayNiemYet = milliToPct(rate.phiCaiMay); }
      const quotes = await db.feeSellQuote.findMany({ where: { partnerId: tid.partnerId, cardTypeId: c.id, feeTypeId, deletedAt: null } });
      const quote = pickEffectiveRate(quotes, now);
      if (quote) phiBanNiemYet = milliToPct(quote.phiBan);
    }
    const ov = ovByCard.get(c.id);
    rows.push({
      cardTypeId: c.id,
      cardTypeCode: c.code ?? null,
      cardTypeName: c.name,
      phiMuaNiemYet,
      phiBanNiemYet,
      phiCaiMayNiemYet,
      phiBanThucTe: ov ? milliToPct(ov.phiBan) : null,
      hasOverride: ov != null
    });
  }
  return {
    ok: true,
    data: { tidId: tid.id, tid: tid.tid, feeTypeId, bankId: tid.bankId, bankCode: bank?.code ?? null, partnerId: tid.partnerId, rows }
  };
}

export interface SetTidSellFeesInput {
  tidId: number;
  feeTypeId: number; // LOẠI PHÍ (bắt buộc) — phí bán thực tế theo (tid × thẻ × loại phí)
  entries: { cardTypeId: number; phiBan: number | null }[]; // phiBan % — null = xóa override (dùng lại niêm yết)
}

/**
 * Đặt phí bán thực tế cho TID (upsert theo (tidId, cardTypeId) còn sống). phiBan null → soft-delete override
 * (quay về niêm yết). Validate loại thẻ thuộc đúng ngân hàng của TID. Không đụng FeeRate (niêm yết chung).
 */
export async function setTidSellFees(input: SetTidSellFeesInput): Promise<MutationResult> {
  const g = await requirePermission(MANAGE, { action: 'TID_SELL_FEE_SET', targetType: 'Tid', targetId: String(input.tidId) });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!input.feeTypeId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn loại phí.' };
  const tid = await db.tid.findUnique({ where: { id: input.tidId } });
  if (!tid || tid.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'TID không tồn tại.' };
  const feeType = await db.feeType.findUnique({ where: { id: input.feeTypeId } });
  if (!feeType || feeType.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Loại phí không tồn tại.' };
  if (!Array.isArray(input.entries) || input.entries.length === 0)
    return { ok: false, error: 'VALIDATION', message: 'Không có phí bán nào để lưu.' };

  // Validate mọi loại thẻ thuộc đúng ngân hàng của TID + phí hợp lệ (0..100%).
  const cardIds = [...new Set(input.entries.map((e) => e.cardTypeId))];
  const cards = await db.cardType.findMany({ where: { id: { in: cardIds }, deletedAt: null } });
  const cardById = new Map(cards.map((c) => [c.id, c]));
  for (const e of input.entries) {
    const c = cardById.get(e.cardTypeId);
    if (!c) return { ok: false, error: 'NOT_FOUND', message: 'Loại thẻ không tồn tại.' };
    if (tid.bankId != null && c.bankId !== tid.bankId)
      return { ok: false, error: 'CARD_BANK_MISMATCH', message: `Loại thẻ "${c.name}" không thuộc ngân hàng của TID này.` };
    if (e.phiBan != null && (!Number.isFinite(e.phiBan) || e.phiBan < 0 || e.phiBan > 100))
      return { ok: false, error: 'VALIDATION', message: 'Phí bán phải trong khoảng 0–100%.' };
    // R48 Pha 3 — phí bán thực tế cũng KHÔNG được < phí cài máy (chênh bán âm → doanh thu âm).
    // FEE_MODEL — phí cài máy là CỐ ĐỊNH ở FeeRate (không theo loại phí).
    if (e.phiBan != null && tid.partnerId != null) {
      const rates = await db.feeRate.findMany({ where: { partnerId: tid.partnerId, cardTypeId: e.cardTypeId, deletedAt: null } });
      const rate = pickEffectiveRate(rates, new Date());
      if (rate) {
        const phiCaiMayPct = milliToPct(rate.phiCaiMay);
        if (e.phiBan < phiCaiMayPct)
          return { ok: false, error: 'VALIDATION', message: `Phí bán (${e.phiBan}%) phải ≥ phí cài máy (${phiCaiMayPct}%) — chênh bán không được âm.` };
      }
    }
  }

  const now = new Date();
  const changed: { cardTypeId: number; phiBan: number | null }[] = [];
  await db.$transaction(async (txc) => {
    // Khóa hàng TID để serialize 2 lệnh set song song cùng TID (chống race tạo 2 dòng override active — tiền sai).
    // Sau khóa, findFirst đọc trong khóa thấy dòng luồng trước đã commit → update thay vì create trùng.
    await txc.$queryRawUnsafe('SELECT id FROM tids WHERE id = $1 FOR UPDATE', tid.id);
    for (const e of input.entries) {
      const existing = await txc.tidSellFee.findFirst({ where: { tidId: tid.id, cardTypeId: e.cardTypeId, feeTypeId: input.feeTypeId, deletedAt: null }, orderBy: { id: 'desc' } });
      if (e.phiBan == null) {
        // Xóa override → quay về niêm yết.
        if (existing) {
          await txc.tidSellFee.update({ where: { id: existing.id }, data: { deletedAt: now, deletedBy: user.id, updatedBy: user.id } });
          changed.push({ cardTypeId: e.cardTypeId, phiBan: null });
        }
        continue;
      }
      const milli = pctToMilli(e.phiBan);
      if (existing) {
        if (existing.phiBan !== milli) {
          await txc.tidSellFee.update({ where: { id: existing.id }, data: { phiBan: milli, updatedBy: user.id } });
          changed.push({ cardTypeId: e.cardTypeId, phiBan: e.phiBan });
        }
      } else {
        await txc.tidSellFee.create({ data: { tidId: tid.id, cardTypeId: e.cardTypeId, feeTypeId: input.feeTypeId, phiBan: milli, createdBy: user.id, updatedBy: user.id } });
        changed.push({ cardTypeId: e.cardTypeId, phiBan: e.phiBan });
      }
    }
  });

  if (changed.length > 0)
    await writeAudit(db, { actorUserId: user.id, action: 'TID_SELL_FEE_SET', targetType: 'Tid', targetId: String(tid.id), after: { tid: tid.tid, feeTypeId: input.feeTypeId, changed } });
  return { ok: true, id: tid.id };
}
