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
  phiBanNiemYet: number | null; // % — phí bán niêm yết (FeeRate hiệu lực hôm nay), null nếu chưa cấu hình biểu phí
  phiCaiMayNiemYet: number | null; // % — phí cài máy niêm yết (để tham chiếu CL_KH = bán − cài máy)
  phiBanThucTe: number | null; // % — phí bán THỰC TẾ (override), null = dùng niêm yết
}
export interface TidSellFeeListDto {
  tidId: number;
  tid: string;
  bankId: number | null;
  bankCode: string | null;
  partnerId: number | null;
  rows: TidSellFeeRowDto[];
}

/**
 * Liệt kê phí bán theo TID: mỗi loại thẻ của NGÂN HÀNG của TID → phí bán niêm yết (kỳ FeeRate hiệu lực
 * hôm nay của Đối tác × thẻ) + phí bán thực tế đã set (nếu có). UI dùng để đối chiếu khi nhập.
 */
export async function listTidSellFees(tidId: number): Promise<{ ok: boolean; error?: string; message?: string; data?: TidSellFeeListDto }> {
  const g = await requirePermission(VIEW, { action: 'TID_VIEW', targetType: 'Tid', targetId: String(tidId) });
  if (!g.ok) return g;
  const { db } = g;
  const tid = await db.tid.findUnique({ where: { id: tidId } });
  if (!tid || tid.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'TID không tồn tại.' };

  const bank = tid.bankId != null ? await db.bank.findUnique({ where: { id: tid.bankId }, select: { code: true } }) : null;
  // Loại thẻ của ngân hàng TID (nếu TID chưa gán ngân hàng → rỗng, UI báo cấu hình TID trước).
  const cards = tid.bankId != null ? await db.cardType.findMany({ where: { bankId: tid.bankId, deletedAt: null }, orderBy: { id: 'asc' } }) : [];
  const overrides = await db.tidSellFee.findMany({ where: { tidId, deletedAt: null } });
  const ovByCard = new Map(overrides.map((o) => [o.cardTypeId, o]));
  const now = new Date();

  const rows: TidSellFeeRowDto[] = [];
  for (const c of cards) {
    let phiBanNiemYet: number | null = null;
    let phiCaiMayNiemYet: number | null = null;
    if (tid.partnerId != null) {
      const rates = await db.feeRate.findMany({ where: { partnerId: tid.partnerId, cardTypeId: c.id, deletedAt: null } });
      const rate = pickEffectiveRate(rates, now);
      if (rate) {
        phiBanNiemYet = milliToPct(rate.phiBan);
        phiCaiMayNiemYet = milliToPct(rate.phiCaiMay);
      }
    }
    const ov = ovByCard.get(c.id);
    rows.push({
      cardTypeId: c.id,
      cardTypeCode: c.code ?? null,
      cardTypeName: c.name,
      phiBanNiemYet,
      phiCaiMayNiemYet,
      phiBanThucTe: ov ? milliToPct(ov.phiBan) : null
    });
  }
  return {
    ok: true,
    data: { tidId: tid.id, tid: tid.tid, bankId: tid.bankId, bankCode: bank?.code ?? null, partnerId: tid.partnerId, rows }
  };
}

export interface SetTidSellFeesInput {
  tidId: number;
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
  const tid = await db.tid.findUnique({ where: { id: input.tidId } });
  if (!tid || tid.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'TID không tồn tại.' };
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
  }

  const now = new Date();
  const changed: { cardTypeId: number; phiBan: number | null }[] = [];
  await db.$transaction(async (txc) => {
    for (const e of input.entries) {
      const existing = await txc.tidSellFee.findFirst({ where: { tidId: tid.id, cardTypeId: e.cardTypeId, deletedAt: null } });
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
        await txc.tidSellFee.create({ data: { tidId: tid.id, cardTypeId: e.cardTypeId, phiBan: milli, createdBy: user.id, updatedBy: user.id } });
        changed.push({ cardTypeId: e.cardTypeId, phiBan: e.phiBan });
      }
    }
  });

  if (changed.length > 0)
    await writeAudit(db, { actorUserId: user.id, action: 'TID_SELL_FEE_SET', targetType: 'Tid', targetId: String(tid.id), after: { tid: tid.tid, changed } });
  return { ok: true, id: tid.id };
}
