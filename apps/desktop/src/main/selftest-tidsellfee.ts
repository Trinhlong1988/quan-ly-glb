// R30 — Phí bán THỰC TẾ theo TID × loại thẻ — self-test (GLB_SELFTEST=33). Số thật, real service, DB throwaway.
// Phủ: niêm yết mặc định (không override) · set override → doanh thu ưu tiên phí thực tế · phí cài máy vẫn từ
// FeeRate · xóa override → về niêm yết · validate loại thẻ đúng ngân hàng · validate 0–100% · list đối chiếu.
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import { createTransaction } from './transaction-service.js';
import { listTidSellFees, setTidSellFees } from './tid-sell-fee-service.js';

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++;
  else fail++;
  // eslint-disable-next-line no-console
  console.log(`TIDSELLFEE33 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}
const ADMIN_PW = 'Admin@123456';

export async function runTidSellFeeSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', ADMIN_PW);

  // ═══ SETUP: 2 ngân hàng, thẻ, đối tác, biểu phí niêm yết, TID ═══
  const bank = await db.bank.create({ data: { name: 'NH Phí Bán', code: 'SFBANK' } });
  const bankOther = await db.bank.create({ data: { name: 'NH Khác', code: 'SFOTHER' } });
  const card1 = await db.cardType.create({ data: { name: 'Visa SF', code: 'SFV', bankId: bank.id } });
  const card2 = await db.cardType.create({ data: { name: 'Master SF', code: 'SFM', bankId: bank.id } });
  const cardOther = await db.cardType.create({ data: { name: 'Napas Khác', code: 'SFNO', bankId: bankOther.id } });
  const partner = await db.partner.create({ data: { name: 'Đối tác Phí Bán', code: 'SFP' } });
  await db.partnerBank.create({ data: { partnerId: partner.id, bankId: bank.id } });
  // Niêm yết card1: phiMua 3.0 / phiCaiMay 1.0 / phiBan 2.5 (×1000). CL_NCC=2000, CL_KH niêm yết=1500.
  await db.feeRate.create({ data: { partnerId: partner.id, cardTypeId: card1.id, phiMua: 3000, phiCaiMay: 1000, phiBan: 2500, effectiveFrom: new Date('1970-01-01T00:00:00.000Z') } });
  const cust = await db.customer.create({ data: { code: 'KHSF', fullName: 'Khách Phí Bán', nickname: 'KSF' } });
  const tid = await db.tid.create({ data: { tid: 'TIDSF', mid: 'MIDSF', hkdName: 'HKD Phí Bán', bankId: bank.id, partnerId: partner.id, customerId: cust.id } });

  const mkTxn = async (): Promise<number> => {
    const c = await createTransaction({ tidId: tid.id, cardTypeId: card1.id, amount: 10_000_000, txnDate: '2026-07-01T00:00:00.000Z' });
    if (!c.ok || !c.id) throw new Error('mkTxn thất bại: ' + JSON.stringify(c));
    return c.id;
  };

  // ═══ 1) CHƯA override → dùng phí bán NIÊM YẾT ═══
  const t1 = await mkTxn();
  const t1row = await db.transaction.findUnique({ where: { id: t1 } });
  ok('chưa override: sellMarginMilli = phiBan−phiCaiMay niêm yết (2500−1000=1500)', t1row?.sellMarginMilli === 1500, { got: t1row?.sellMarginMilli });
  ok('chưa override: partnerMarginMilli = phiMua−phiCaiMay (3000−1000=2000)', t1row?.partnerMarginMilli === 2000, { got: t1row?.partnerMarginMilli });

  // ═══ 2) LIST đối chiếu: card1 có niêm yết 2.5, card2 chưa có biểu phí (null), chưa override ═══
  const list1 = await listTidSellFees(tid.id);
  const r1c1 = list1.data?.rows.find((r) => r.cardTypeId === card1.id);
  const r1c2 = list1.data?.rows.find((r) => r.cardTypeId === card2.id);
  ok('list: 2 loại thẻ của ngân hàng TID', list1.ok && list1.data?.rows.length === 2, list1.data?.rows.map((r) => r.cardTypeCode));
  ok('list: card1 niêm yết 2.5, thực tế null', r1c1?.phiBanNiemYet === 2.5 && r1c1?.phiBanThucTe === null, r1c1);
  ok('list: card2 chưa có biểu phí → niêm yết null', r1c2?.phiBanNiemYet === null, r1c2);

  // ═══ 3) SET override card1 = 2.0% → doanh thu ưu tiên phí thực tế ═══
  const set1 = await setTidSellFees({ tidId: tid.id, entries: [{ cardTypeId: card1.id, phiBan: 2.0 }] });
  ok('set override card1 = 2.0% → ok', set1.ok === true, set1);
  const list2 = await listTidSellFees(tid.id);
  const r2c1 = list2.data?.rows.find((r) => r.cardTypeId === card1.id);
  ok('list sau set: card1 thực tế 2.0, niêm yết vẫn 2.5', r2c1?.phiBanThucTe === 2.0 && r2c1?.phiBanNiemYet === 2.5, r2c1);
  const t2 = await mkTxn();
  const t2row = await db.transaction.findUnique({ where: { id: t2 } });
  ok('có override: sellMarginMilli = override−phiCaiMay (2000−1000=1000)', t2row?.sellMarginMilli === 1000, { got: t2row?.sellMarginMilli });
  ok('có override: partnerMarginMilli KHÔNG đổi (vẫn 2000)', t2row?.partnerMarginMilli === 2000, { got: t2row?.partnerMarginMilli });

  // ═══ 4) XÓA override (null) → về niêm yết ═══
  const clr = await setTidSellFees({ tidId: tid.id, entries: [{ cardTypeId: card1.id, phiBan: null }] });
  ok('xóa override → ok', clr.ok === true, clr);
  const t3 = await mkTxn();
  const t3row = await db.transaction.findUnique({ where: { id: t3 } });
  ok('sau xóa override: sellMarginMilli về niêm yết 1500', t3row?.sellMarginMilli === 1500, { got: t3row?.sellMarginMilli });
  const list3 = await listTidSellFees(tid.id);
  const r3c1 = list3.data?.rows.find((r) => r.cardTypeId === card1.id);
  ok('list sau xóa: card1 thực tế null', r3c1?.phiBanThucTe === null, r3c1);

  // ═══ 5) VALIDATE: loại thẻ khác ngân hàng → CARD_BANK_MISMATCH; phí ngoài 0–100 → VALIDATION ═══
  const mismatch = await setTidSellFees({ tidId: tid.id, entries: [{ cardTypeId: cardOther.id, phiBan: 1.5 }] });
  ok('set thẻ khác ngân hàng → CARD_BANK_MISMATCH', mismatch.ok === false && mismatch.error === 'CARD_BANK_MISMATCH', mismatch);
  const tooHigh = await setTidSellFees({ tidId: tid.id, entries: [{ cardTypeId: card1.id, phiBan: 150 }] });
  ok('set phí 150% → VALIDATION', tooHigh.ok === false && tooHigh.error === 'VALIDATION', tooHigh);
  // Sau 2 lệnh lỗi, override card1 vẫn KHÔNG bị tạo (đã xóa ở bước 4).
  const list4 = await listTidSellFees(tid.id);
  const r4c1 = list4.data?.rows.find((r) => r.cardTypeId === card1.id);
  ok('lệnh lỗi không ghi override', r4c1?.phiBanThucTe === null, r4c1);

  // ═══ 6) BACKSTOP TƯƠNG TRANH (audit đợt 4): partial-unique 1 override CÒN SỐNG / (tid,thẻ) ═══
  const idx = await db.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes WHERE tablename='tid_sell_fees' AND indexname='tid_sell_fees_active_uq'`
  );
  ok('tồn tại partial-unique index tid_sell_fees_active_uq', Array.isArray(idx) && idx.length === 1, idx);
  // Tạo 1 override hợp lệ rồi cố CHÈN THẲNG dòng active trùng (tid,thẻ) → phải bị index chặn (P2002/23505).
  await setTidSellFees({ tidId: tid.id, entries: [{ cardTypeId: card1.id, phiBan: 2.0 }] });
  let dupBlocked = false;
  try {
    await db.tidSellFee.create({ data: { tidId: tid.id, cardTypeId: card1.id, phiBan: 1900, createdBy: 1, updatedBy: 1 } });
  } catch {
    dupBlocked = true;
  }
  ok('chèn thẳng dòng override active trùng → bị index chặn', dupBlocked);
  const actives = await db.tidSellFee.count({ where: { tidId: tid.id, cardTypeId: card1.id, deletedAt: null } });
  ok('chỉ 1 override CÒN SỐNG / (tid,thẻ)', actives === 1, { actives });

  await logout();
  // eslint-disable-next-line no-console
  console.log(`TIDSELLFEE33 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
