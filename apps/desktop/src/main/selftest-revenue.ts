// Nhóm B — Doanh thu & Công nợ — self-test (GLB_SELFTEST=15).
// Chứng minh bằng SỐ THẬT (LEAD 9/7):
//   • Doanh thu = BÓC 2 khoản: chênh đối tác (phiMua−phiCaiMay) + chênh bán (phiBan−phiCaiMay), cộng gộp.
//   • Snapshot phí vào giao dịch — đổi biểu phí sau KHÔNG làm sai doanh thu đã ghi.
//   • Lọc TID/MID/HKD/khách; summary tổng toàn bộ (không chỉ trang); phân trang.
//   • Công nợ thu về = tổng 2 khoản của giao dịch CHƯA đối soát; settle → công nợ giảm.
//   • Ràng buộc: TID thiếu đối tác / chưa có biểu phí / loại thẻ lệch ngân hàng → từ chối rõ ràng.
//   • Phân quyền REVENUE_VIEW/MANAGE/DEBT_*; soft-delete cần mật khẩu.
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import {
  createTransaction,
  updateTransaction,
  deleteTransactions,
  settleTransactions,
  listTransactions,
  debtSummary,
  revenueByFeeType
} from './transaction-service.js';
import { setFeeRate, listFeeRates } from './fee-config-service.js';
import { setTidSellFees } from './tid-sell-fee-service.js';
import { fmtDate } from '@glb/shared';

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++;
  else fail++;
  // eslint-disable-next-line no-console
  console.log(`REV15 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

const ADMIN_PW = 'Admin@123456';

export async function runRevenueSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', ADMIN_PW);

  // ═══════════ SETUP: ngân hàng + loại thẻ + đối tác + biểu phí + TID + khách ═══════════
  const bank = await db.bank.create({ data: { name: 'NH Doanh Thu', code: 'REVBANK' } });
  const bank2 = await db.bank.create({ data: { name: 'NH Khác', code: 'OTHBANK' } });
  const card = await db.cardType.create({ data: { name: 'Thẻ nội địa', code: 'REVND', bankId: bank.id } });
  const cardOther = await db.cardType.create({ data: { name: 'Thẻ NH khác', code: 'OTHND', bankId: bank2.id } });
  const partner = await db.partner.create({ data: { name: 'Đối tác REV', code: 'REVP' } });
  await db.partnerBank.create({ data: { partnerId: partner.id, bankId: bank.id } });
  // FEE_TYPE — loại phí chính cho toàn khối test (mọi biểu phí + GD dùng ft.id trừ khối "2 loại phí khác giá").
  const ft = await db.feeType.create({ data: { name: 'Loại phí REV' } });
  // FEE_MODEL — phí mua/cài CỐ ĐỊNH ở FeeRate; phí bán NIÊM YẾT theo loại phí ở FeeSellQuote.
  // phiMua 3% (3000), phiCaiMay 1% (1000) → chênh đối tác milli = 2000 (2%).
  // phiBan niêm yết 2.5% (2500) cho loại phí ft → chênh bán milli = 1500 (1.5%).
  // Kỳ giá mốc sàn (1970) → phủ mọi txnDate trong khối test cũ (P1.1 backfill-compatible).
  const rate = await db.feeRate.create({ data: { partnerId: partner.id, cardTypeId: card.id, phiMua: 3000, phiCaiMay: 1000, effectiveFrom: new Date('1970-01-01T00:00:00.000Z') } });
  const quote = await db.feeSellQuote.create({ data: { partnerId: partner.id, cardTypeId: card.id, feeTypeId: ft.id, phiBan: 2500, effectiveFrom: new Date('1970-01-01T00:00:00.000Z') } });
  const cust = await db.customer.create({ data: { code: 'KHREV1', fullName: 'Khách Doanh Thu', nickname: 'KHR1' } });
  const cust2 = await db.customer.create({ data: { code: 'KHREV2', fullName: 'Khách Hai', nickname: 'KHR2' } });
  const tid = await db.tid.create({
    data: { tid: 'TIDREV1', mid: 'MIDREV001', hkdName: 'HKD Doanh Thu', bankId: bank.id, partnerId: partner.id, customerId: cust.id }
  });

  // ═══════════ A) GHI NHẬN GIAO DỊCH → BÓC 2 KHOẢN, CỘNG GỘP ═══════════
  const amount = 10_000_000;
  const c1 = await createTransaction({ feeTypeId: ft.id, tidId: tid.id, cardTypeId: card.id, amount, txnDate: '2026-07-01T00:00:00.000Z' });
  ok('tạo giao dịch → ok', c1.ok === true, c1);
  const t1 = await db.transaction.findUnique({ where: { id: c1.id! } });
  ok('snapshot chênh đối tác milli = 2000 (phiMua−phiCaiMay)', t1?.partnerMarginMilli === 2000, { got: t1?.partnerMarginMilli });
  ok('snapshot chênh bán milli = 1500 (phiBan−phiCaiMay)', t1?.sellMarginMilli === 1500, { got: t1?.sellMarginMilli });
  ok('doanh thu đối tác = 10.000.000 × 2% = 200.000', Number(t1?.revenuePartner) === 200_000, { got: t1?.revenuePartner });
  ok('doanh thu bán = 10.000.000 × 1.5% = 150.000', Number(t1?.revenueSell) === 150_000, { got: t1?.revenueSell });
  ok('doanh thu TỔNG = 200.000 + 150.000 = 350.000 (cộng gộp)', Number(t1?.revenueAmount) === 350_000, { got: t1?.revenueAmount });
  ok('sinh mã GD tự động', t1?.code === 'GD' + String(c1.id).padStart(5, '0'), { code: t1?.code });
  ok('khách mặc định lấy theo TID', t1?.customerId === cust.id, { got: t1?.customerId });

  // ═══════════ B) SNAPSHOT — đổi biểu phí sau KHÔNG làm sai doanh thu đã ghi ═══════════
  await db.feeRate.update({ where: { id: rate.id }, data: { phiMua: 9000, phiCaiMay: 0 } });
  await db.feeSellQuote.update({ where: { id: quote.id }, data: { phiBan: 9000 } });
  const t1b = await db.transaction.findUnique({ where: { id: c1.id! } });
  ok('đổi biểu phí → doanh thu GD cũ GIỮ NGUYÊN 350.000 (snapshot)', Number(t1b?.revenueAmount) === 350_000, { got: t1b?.revenueAmount });
  // khôi phục biểu phí về mức chuẩn cho các bước sau
  await db.feeRate.update({ where: { id: rate.id }, data: { phiMua: 3000, phiCaiMay: 1000 } });
  await db.feeSellQuote.update({ where: { id: quote.id }, data: { phiBan: 2500 } });

  // ═══════════ C) GIAO DỊCH THỨ 2 (khách khác) + LỌC + SUMMARY ═══════════
  const c2 = await createTransaction({ feeTypeId: ft.id, tidId: tid.id, cardTypeId: card.id, amount: 4_000_000, txnDate: '2026-07-02T00:00:00.000Z', customerId: cust2.id });
  ok('tạo giao dịch 2 → ok', c2.ok === true, c2);
  // GD2: chênh đối tác 4tr×2% = 80.000 ; chênh bán 4tr×1.5% = 60.000 ; tổng 140.000
  const t2 = await db.transaction.findUnique({ where: { id: c2.id! } });
  ok('GD2 doanh thu tổng = 140.000', Number(t2?.revenueAmount) === 140_000, { got: t2?.revenueAmount });

  const all = await listTransactions({ tidId: tid.id });
  ok('list trả 2 giao dịch', all.data?.length === 2, { len: all.data?.length });
  ok('summary tổng doanh thu = 350.000 + 140.000 = 490.000', all.summary?.totalRevenue === 490_000, all.summary);
  ok('summary tổng chênh đối tác = 200.000 + 80.000 = 280.000', all.summary?.totalRevenuePartner === 280_000, all.summary);
  ok('summary tổng chênh bán = 150.000 + 60.000 = 210.000', all.summary?.totalRevenueSell === 210_000, all.summary);
  ok('summary tổng số tiền GD = 14.000.000', all.summary?.totalAmount === 14_000_000, all.summary);

  const byCust2 = await listTransactions({ customerId: cust2.id });
  ok('lọc theo khách 2 → chỉ 1 GD, doanh thu 140.000', byCust2.data?.length === 1 && byCust2.summary?.totalRevenue === 140_000, byCust2.summary);
  const byMid = await listTransactions({ mid: 'MIDREV' });
  ok('lọc theo MID (chứa) → 2 GD', byMid.data?.length === 2, { len: byMid.data?.length });
  const byHkd = await listTransactions({ hkdName: 'Doanh Thu' });
  ok('lọc theo tên HKD (chứa) → 2 GD', byHkd.data?.length === 2, { len: byHkd.data?.length });
  const byPartner = await listTransactions({ partnerId: partner.id });
  ok('lọc theo đối tác → 2 GD', byPartner.data?.length === 2, { len: byPartner.data?.length });
  const noMatch = await listTransactions({ mid: 'KHONG_TON_TAI' });
  ok('lọc MID không khớp → 0 GD, summary 0', noMatch.data?.length === 0 && noMatch.summary?.totalRevenue === 0, noMatch.summary);
  const dto = all.data?.find((d) => d.id === c1.id);
  ok('DTO có nhãn TID/MID/HKD/khách/loại thẻ', !!dto && dto.mid === 'MIDREV001' && dto.hkdName === 'HKD Doanh Thu' && dto.customerName === 'Khách Doanh Thu' && dto.cardTypeName === 'Thẻ nội địa', dto);

  // ═══════════ D) PHÂN TRANG ═══════════
  const p1 = await listTransactions({ tidId: tid.id, page: 1, pageSize: 1 });
  ok('phân trang: pageSize=1 → 1 dòng, total=2', p1.data?.length === 1 && p1.total === 2, { len: p1.data?.length, total: p1.total });
  ok('phân trang: summary vẫn tính TOÀN BỘ (490.000)', p1.summary?.totalRevenue === 490_000, p1.summary);

  // ═══════════ E) CÔNG NỢ THU VỀ = 2 khoản của GD chưa đối soát ═══════════
  const d0 = await debtSummary({ tidId: tid.id });
  ok('công nợ tổng = 490.000 (chưa đối soát)', d0.data?.debtTotal === 490_000, d0.data);
  ok('công nợ đối tác = 280.000', d0.data?.debtPartner === 280_000, d0.data);
  ok('công nợ bán = 210.000', d0.data?.debtSell === 210_000, d0.data);
  ok('số GD công nợ = 2', d0.data?.count === 2, d0.data);

  // Đối soát công nợ THỦ CÔNG đã TẮT (chuyển sang phiếu Thu công nợ — Phase H2) → phải trả DEBT_SETTLE_DISABLED,
  // KHÔNG đổi công nợ. (Test cũ kỳ vọng changed=1 là stale — full-suite rerun sau đổi lõi auth bắt được.)
  const st = await settleTransactions([c1.id!], true);
  ok('đối soát thủ công đã tắt → DEBT_SETTLE_DISABLED', st.ok === false && st.error === 'DEBT_SETTLE_DISABLED', st);
  const d1 = await debtSummary({ tidId: tid.id });
  ok('công nợ KHÔNG đổi (vẫn 490.000 — không settle thủ công)', d1.data?.debtTotal === 490_000, d1.data);
  const unsettledList = await listTransactions({ tidId: tid.id, settled: false });
  ok('chưa đối soát vẫn 2 GD', unsettledList.data?.length === 2, { len: unsettledList.data?.length });

  // ═══════════ F) RÀNG BUỘC ═══════════
  const tidNoPartner = await db.tid.create({ data: { tid: 'TIDNOPART', bankId: bank.id } });
  const fNoPartner = await createTransaction({ feeTypeId: ft.id, tidId: tidNoPartner.id, cardTypeId: card.id, amount: 1_000_000, txnDate: '2026-07-03T00:00:00.000Z' });
  ok('TID thiếu đối tác → NO_PARTNER', fNoPartner.ok === false && fNoPartner.error === 'NO_PARTNER', fNoPartner);

  const fMismatch = await createTransaction({ feeTypeId: ft.id, tidId: tid.id, cardTypeId: cardOther.id, amount: 1_000_000, txnDate: '2026-07-03T00:00:00.000Z' });
  ok('loại thẻ lệch ngân hàng TID → CARD_BANK_MISMATCH', fMismatch.ok === false && fMismatch.error === 'CARD_BANK_MISMATCH', fMismatch);

  // đối tác chưa có biểu phí cho loại thẻ này
  const partner2 = await db.partner.create({ data: { name: 'Đối tác chưa phí', code: 'NOFEE' } });
  await db.partnerBank.create({ data: { partnerId: partner2.id, bankId: bank.id } });
  const tidNoFee = await db.tid.create({ data: { tid: 'TIDNOFEE', bankId: bank.id, partnerId: partner2.id } });
  const fNoFee = await createTransaction({ feeTypeId: ft.id, tidId: tidNoFee.id, cardTypeId: card.id, amount: 1_000_000, txnDate: '2026-07-03T00:00:00.000Z' });
  ok('chưa có biểu phí → NO_FEE_RATE', fNoFee.ok === false && fNoFee.error === 'NO_FEE_RATE', fNoFee);

  // FEE_MODEL — có phí mua/cài (FeeRate) nhưng THIẾU phí bán niêm yết (FeeSellQuote) cho loại phí → NO_SELL_QUOTE.
  const partner3 = await db.partner.create({ data: { name: 'Đối tác thiếu niêm yết', code: 'NOSQ' } });
  await db.partnerBank.create({ data: { partnerId: partner3.id, bankId: bank.id } });
  await db.feeRate.create({ data: { partnerId: partner3.id, cardTypeId: card.id, phiMua: 3000, phiCaiMay: 1000, effectiveFrom: new Date('1970-01-01T00:00:00.000Z') } });
  const tidNoSq = await db.tid.create({ data: { tid: 'TIDNOSQ', bankId: bank.id, partnerId: partner3.id } });
  const fNoSq = await createTransaction({ feeTypeId: ft.id, tidId: tidNoSq.id, cardTypeId: card.id, amount: 1_000_000, txnDate: '2026-07-03T00:00:00.000Z' });
  ok('có phí mua/cài nhưng thiếu phí bán niêm yết → NO_SELL_QUOTE', fNoSq.ok === false && fNoSq.error === 'NO_SELL_QUOTE', fNoSq);

  const fBadAmount = await createTransaction({ feeTypeId: ft.id, tidId: tid.id, cardTypeId: card.id, amount: -5, txnDate: '2026-07-03T00:00:00.000Z' });
  ok('số tiền âm → VALIDATION', fBadAmount.ok === false && fBadAmount.error === 'VALIDATION', fBadAmount);

  // ═══════════ G) BILL BẤT BIẾN (P1.2): mọi sửa GD → BILL_IMMUTABLE, snapshot đóng băng ═══════════
  // P1.2 thay thế hành vi cũ "sửa GD → tính lại": bill đã POSTED KHÔNG sửa được nữa
  // (muốn đổi thì tạo yêu cầu hủy → duyệt → tạo bill mới). Regression khóa hành vi mới này.
  const t2Before = await db.transaction.findUnique({ where: { id: c2.id! } });
  const up = await updateTransaction(c2.id!, { amount: 20_000_000 });
  ok('sửa số tiền GD2 → BILL_IMMUTABLE', up.ok === false && up.error === 'BILL_IMMUTABLE', up);
  const t2b = await db.transaction.findUnique({ where: { id: c2.id! } });
  ok('GD2 KHÔNG đổi số tiền/doanh thu sau khi bị từ chối sửa', t2b?.amount === t2Before?.amount && t2b?.revenueAmount === t2Before?.revenueAmount, { amount: t2b?.amount, rev: t2b?.revenueAmount });

  // G2) BẤT BIẾN SNAPSHOT (regression Defect 1 audit): đổi biểu phí rồi thử sửa ghi chú GD cũ
  //     → sửa bị chặn BILL_IMMUTABLE, doanh thu + margin đã snapshot giữ nguyên (không tra phí mới).
  await db.feeRate.update({ where: { id: rate.id }, data: { phiMua: 9000, phiCaiMay: 0 } });
  await db.feeSellQuote.update({ where: { id: quote.id }, data: { phiBan: 9000 } });
  const rC1 = await db.transaction.findUnique({ where: { id: c1.id! } });
  const upNote = await updateTransaction(c1.id!, { note: 'ghi chú mới' });
  ok('sửa ghi chú GD1 (đã đối soát) → BILL_IMMUTABLE', upNote.ok === false && upNote.error === 'BILL_IMMUTABLE', upNote);
  const c1After = await db.transaction.findUnique({ where: { id: c1.id! } });
  ok('SNAPSHOT: bill bất biến giữ nguyên doanh thu (350.000 dù biểu phí đã đổi)', c1After?.revenueAmount === rC1?.revenueAmount && Number(c1After?.revenueAmount) === 350_000, { before: rC1?.revenueAmount, after: c1After?.revenueAmount });
  ok('SNAPSHOT: margin đã lưu giữ nguyên (bill bất biến)', c1After?.partnerMarginMilli === 2000 && c1After?.sellMarginMilli === 1500, { p: c1After?.partnerMarginMilli, s: c1After?.sellMarginMilli });
  await db.feeRate.update({ where: { id: rate.id }, data: { phiMua: 3000, phiCaiMay: 1000 } });
  await db.feeSellQuote.update({ where: { id: quote.id }, data: { phiBan: 2500 } });

  // G3) LỌC bao gồm GD của TID đã XÓA MỀM (regression Defect 2): GD phải vẫn hiện khi lọc.
  const tidDel = await db.tid.create({ data: { tid: 'TIDDEL', mid: 'MIDDEL9', hkdName: 'HKD Del', bankId: bank.id, partnerId: partner.id, customerId: cust.id } });
  const cDel = await createTransaction({ feeTypeId: ft.id, tidId: tidDel.id, cardTypeId: card.id, amount: 1_000_000, txnDate: '2026-07-04T00:00:00.000Z' });
  await db.tid.update({ where: { id: tidDel.id }, data: { deletedAt: new Date(), deletedBy: 1 } });
  const byMidDel = await listTransactions({ mid: 'MIDDEL9' });
  ok('lọc theo MID của TID đã xóa mềm → VẪN thấy GD (không bỏ sót)', byMidDel.data?.length === 1 && byMidDel.data?.[0].id === cDel.id, { len: byMidDel.data?.length });
  // dọn để không ảnh hưởng các assert đếm sau
  await db.transaction.delete({ where: { id: cDel.id! } });
  await db.tid.delete({ where: { id: tidDel.id } });

  // ═══════════ H) XÓA MỀM CẦN MẬT KHẨU ═══════════
  const delBad = await deleteTransactions([c2.id!], 'sai-mat-khau');
  ok('xóa sai mật khẩu → WRONG_PASSWORD', delBad.ok === false && delBad.error === 'WRONG_PASSWORD', delBad);
  const delOk = await deleteTransactions([c2.id!], ADMIN_PW);
  ok('xóa đúng mật khẩu → deleted=1', delOk.ok === true && delOk.deleted === 1, delOk);
  const afterDel = await listTransactions({ tidId: tid.id });
  ok('sau xóa → còn 1 GD trong danh sách', afterDel.data?.length === 1, { len: afterDel.data?.length });

  // ═══════════ K) GIÁ THEO KỲ (P1.1) — 8 bước §4.1, KHÔNG khôi phục giá trước khi tạo GD ═══════════
  // Tổ hợp RIÊNG (KYP × KYCARD) để độc lập mọi assert đếm ở trên. Điểm mù cũ: selftest đổi phí rồi
  // khôi phục về chuẩn TRƯỚC khi tạo GD → không kỳ nào lệch. Khối này để 2 KỲ khác nhau CÙNG TỒN TẠI.
  const kyBank = await db.bank.create({ data: { name: 'NH Giá Kỳ', code: 'KYBANK' } });
  const kyCard = await db.cardType.create({ data: { name: 'Thẻ Giá Kỳ', code: 'KYND', bankId: kyBank.id } });
  const kyPartner = await db.partner.create({ data: { name: 'Đối tác Giá Kỳ', code: 'KYP' } });
  await db.partnerBank.create({ data: { partnerId: kyPartner.id, bankId: kyBank.id } });
  const kyTid = await db.tid.create({ data: { tid: 'TIDKY1', mid: 'MIDKY', hkdName: 'HKD Giá Kỳ', bankId: kyBank.id, partnerId: kyPartner.id, customerId: cust.id } });

  // (1) Kỳ K1 hiệu lực 2026-01-01: phiMua 3% / phiCaiMay 1% / phiBan 2.5% → margin đối tác 2%, bán 1.5%.
  const setK1 = await setFeeRate({ partnerId: kyPartner.id, cardTypeId: kyCard.id, phiMua: 3, phiCaiMay: 1, effectiveFrom: '2026-01-01T00:00:00.000Z', sellQuotes: [{ feeTypeId: ft.id, phiBan: 2.5 }] });
  ok('lập kỳ K1 (2026-01-01) → ok', setK1.ok === true, setK1);
  // (2) Kỳ K2 hiệu lực 2026-07-01: phiMua 5% / phiCaiMay 1% / phiBan 4% → margin đối tác 4%, bán 3%. KHÔNG xóa K1.
  const setK2 = await setFeeRate({ partnerId: kyPartner.id, cardTypeId: kyCard.id, phiMua: 5, phiCaiMay: 1, effectiveFrom: '2026-07-01T00:00:00.000Z', sellQuotes: [{ feeTypeId: ft.id, phiBan: 4 }] });
  ok('lập kỳ K2 (2026-07-01) → ok, KHÔNG xóa K1', setK2.ok === true && setK1.id !== setK2.id, { k1: setK1.id, k2: setK2.id });
  const kyRates = await listFeeRates({ partnerId: kyPartner.id });
  ok('2 KỲ giá cùng tồn tại cho tổ hợp', kyRates.data?.length === 2, { len: kyRates.data?.length });
  ok('kỳ đang hiệu lực HÔM NAY = K2 (2026-07-01)', kyRates.data?.find((r) => r.isCurrent)?.id === setK2.id, kyRates.data?.map((r) => ({ id: r.id, eff: r.effectiveFrom, cur: r.isCurrent })));

  // (3) GD txnDate 2026-06-15 (trong K1) → PHẢI ăn giá K1 (margin 2% & 1.5%), tổng 350.000.
  const gK1 = await createTransaction({ feeTypeId: ft.id, tidId: kyTid.id, cardTypeId: kyCard.id, amount: 10_000_000, txnDate: '2026-06-15T00:00:00.000Z' });
  ok('GD 2026-06-15 → ok', gK1.ok === true, gK1);
  const tK1 = await db.transaction.findUnique({ where: { id: gK1.id! } });
  ok('GD 2026-06-15 ăn giá K1: margin 2000/1500', tK1?.partnerMarginMilli === 2000 && tK1?.sellMarginMilli === 1500, { p: tK1?.partnerMarginMilli, s: tK1?.sellMarginMilli });
  ok('GD 2026-06-15 doanh thu = 200.000 + 150.000 = 350.000', Number(tK1?.revenueAmount) === 350_000, { got: tK1?.revenueAmount });

  // (4) GD txnDate 2026-07-10 (trong K2) → PHẢI ăn giá K2 (margin 4% & 3%), tổng 700.000.
  const gK2 = await createTransaction({ feeTypeId: ft.id, tidId: kyTid.id, cardTypeId: kyCard.id, amount: 10_000_000, txnDate: '2026-07-10T00:00:00.000Z' });
  ok('GD 2026-07-10 → ok', gK2.ok === true, gK2);
  const tK2 = await db.transaction.findUnique({ where: { id: gK2.id! } });
  ok('GD 2026-07-10 ăn giá K2: margin 4000/3000', tK2?.partnerMarginMilli === 4000 && tK2?.sellMarginMilli === 3000, { p: tK2?.partnerMarginMilli, s: tK2?.sellMarginMilli });
  ok('GD 2026-07-10 doanh thu = 400.000 + 300.000 = 700.000', Number(tK2?.revenueAmount) === 700_000, { got: tK2?.revenueAmount });

  // (5) GD BACKDATE txnDate 2026-03-01 (lập SAU khi K2 đã tồn tại) → vẫn ăn K1 (I-P2).
  const gBack = await createTransaction({ feeTypeId: ft.id, tidId: kyTid.id, cardTypeId: kyCard.id, amount: 10_000_000, txnDate: '2026-03-01T00:00:00.000Z' });
  ok('GD backdate 2026-03-01 → ok', gBack.ok === true, gBack);
  const tBack = await db.transaction.findUnique({ where: { id: gBack.id! } });
  ok('GD backdate 2026-03-01 vẫn ăn K1 (margin 2000/1500) — I-P2', tBack?.partnerMarginMilli === 2000 && tBack?.sellMarginMilli === 1500, { p: tBack?.partnerMarginMilli, s: tBack?.sellMarginMilli });

  // (6) GD txnDate 2025-12-31 (trước MỌI kỳ) → NO_FEE_RATE (I-P3, không lấy đại kỳ tương lai).
  const gNone = await createTransaction({ feeTypeId: ft.id, tidId: kyTid.id, cardTypeId: kyCard.id, amount: 10_000_000, txnDate: '2025-12-31T00:00:00.000Z' });
  ok('GD 2025-12-31 (trước mọi kỳ) → NO_FEE_RATE (I-P3)', gNone.ok === false && gNone.error === 'NO_FEE_RATE', gNone);

  // (7) ĐỔI GIÁ K1 (update kỳ K1) → các bill đã tạo ở K1/K2 GIỮ NGUYÊN doanh thu (I-P1 snapshot bất biến).
  const revK1Before = tK1?.revenueAmount, revBackBefore = tBack?.revenueAmount, revK2Before = tK2?.revenueAmount;
  const upK1 = await setFeeRate({ partnerId: kyPartner.id, cardTypeId: kyCard.id, phiMua: 9, phiCaiMay: 0, effectiveFrom: '2026-01-01T00:00:00.000Z', sellQuotes: [{ feeTypeId: ft.id, phiBan: 9 }] });
  ok('đổi giá kỳ K1 (cùng mốc 2026-01-01) → update, KHÔNG tạo kỳ mới', upK1.ok === true && upK1.id === setK1.id, { upK1, k1: setK1.id });
  ok('vẫn đúng 2 kỳ sau khi đổi giá K1', (await listFeeRates({ partnerId: kyPartner.id })).data?.length === 2);
  const tK1After = await db.transaction.findUnique({ where: { id: gK1.id! } });
  const tBackAfter = await db.transaction.findUnique({ where: { id: gBack.id! } });
  const tK2After = await db.transaction.findUnique({ where: { id: gK2.id! } });
  ok('I-P1: bill K1 (2026-06-15) GIỮ doanh thu 350.000 sau khi đổi giá K1', tK1After?.revenueAmount === revK1Before && Number(tK1After?.revenueAmount) === 350_000, { before: revK1Before, after: tK1After?.revenueAmount });
  ok('I-P1: bill backdate (2026-03-01) GIỮ doanh thu 350.000 sau khi đổi giá K1', tBackAfter?.revenueAmount === revBackBefore && Number(tBackAfter?.revenueAmount) === 350_000, { before: revBackBefore, after: tBackAfter?.revenueAmount });
  ok('I-P1: bill K2 (2026-07-10) GIỮ doanh thu 700.000 (không đụng)', tK2After?.revenueAmount === revK2Before && Number(tK2After?.revenueAmount) === 700_000, { before: revK2Before, after: tK2After?.revenueAmount });

  // ═══════════ L) GIÁ THEO KỲ — ĐƯỜNG UI (B16/F1) — parse-LOCAL, KHÔNG 'Z' ═══════════
  // Điểm mù cũ (thất bại quy trình test): mọi ca GIÁ THEO KỲ ở trên dùng ISO có 'Z' (UTC thuần) → KHÔNG
  // đi qua đường UI thật. UI gửi `new Date(d+'T00:00:00').toISOString()` (parse theo giờ LOCAL của máy).
  // Trên máy UTC+7, floor UTC-day lệch −1 NGÀY (nhập 01/08 → lưu/hiện 31/07). Khối này CHẠY đúng đường đó:
  // set kỳ effectiveFrom local-midnight → listFeeRates → fmtDate PHẢI ra ĐÚNG ngày user nhập.
  const uiBank = await db.bank.create({ data: { name: 'NH UI Ngày', code: 'UIBANK' } });
  const uiCard = await db.cardType.create({ data: { name: 'Thẻ UI Ngày', code: 'UIND', bankId: uiBank.id } });
  const uiPartner = await db.partner.create({ data: { name: 'Đối tác UI Ngày', code: 'UIP' } });
  await db.partnerBank.create({ data: { partnerId: uiPartner.id, bankId: uiBank.id } });
  const uiTid = await db.tid.create({ data: { tid: 'TIDUI1', mid: 'MIDUI', hkdName: 'HKD UI Ngày', bankId: uiBank.id, partnerId: uiPartner.id, customerId: cust.id } });

  // Kỳ TRƯỚC hiệu lực 2026-07-01 (đường UI local): margin đối tác 2%, bán 1.5%.
  const uiPrevEff = new Date('2026-07-01T00:00:00').toISOString(); // LOCAL parse (KHÔNG 'Z') — như UI gửi
  const setUiPrev = await setFeeRate({ partnerId: uiPartner.id, cardTypeId: uiCard.id, phiMua: 3, phiCaiMay: 1, effectiveFrom: uiPrevEff, sellQuotes: [{ feeTypeId: ft.id, phiBan: 2.5 }] });
  ok('UI-path: lập kỳ 01/07 (parse local) → ok', setUiPrev.ok === true, setUiPrev);
  // Kỳ 2026-08-01 (đường UI local): margin đối tác 4%, bán 3%.
  const uiAugEff = new Date('2026-08-01T00:00:00').toISOString(); // LOCAL parse (KHÔNG 'Z') — như UI gửi
  const setUiAug = await setFeeRate({ partnerId: uiPartner.id, cardTypeId: uiCard.id, phiMua: 5, phiCaiMay: 1, effectiveFrom: uiAugEff, sellQuotes: [{ feeTypeId: ft.id, phiBan: 4 }] });
  ok('UI-path: lập kỳ 01/08 (parse local) → ok', setUiAug.ok === true, setUiAug);

  // ✦ ASSERT LÕI B16/F1: ngày HIỂN THỊ = đúng ngày user nhập (không lệch −1 ngày trên UTC+7).
  const uiRates = await listFeeRates({ partnerId: uiPartner.id });
  const uiAugDto = uiRates.data?.find((r) => r.id === setUiAug.id);
  ok('UI-path: fmtDate(effectiveFrom kỳ 01/08) === "01/08/2026" (KHÔNG lệch −1 ngày)', fmtDate(uiAugDto?.effectiveFrom) === '01/08/2026', { got: fmtDate(uiAugDto?.effectiveFrom), iso: uiAugDto?.effectiveFrom });
  const uiPrevDto = uiRates.data?.find((r) => r.id === setUiPrev.id);
  ok('UI-path: fmtDate(effectiveFrom kỳ 01/07) === "01/07/2026"', fmtDate(uiPrevDto?.effectiveFrom) === '01/07/2026', { got: fmtDate(uiPrevDto?.effectiveFrom), iso: uiPrevDto?.effectiveFrom });

  // ✦ GD đường UI: txnDate local 2026-08-01 → ăn kỳ 01/08 (margin 4000/3000).
  const gUiAug = await createTransaction({ feeTypeId: ft.id, tidId: uiTid.id, cardTypeId: uiCard.id, amount: 10_000_000, txnDate: new Date('2026-08-01T00:00:00').toISOString() });
  ok('UI-path: GD local 2026-08-01 → ok', gUiAug.ok === true, gUiAug);
  const tUiAug = await db.transaction.findUnique({ where: { id: gUiAug.id! } });
  ok('UI-path: GD 2026-08-01 ăn kỳ 01/08 (margin 4000/3000)', tUiAug?.partnerMarginMilli === 4000 && tUiAug?.sellMarginMilli === 3000, { p: tUiAug?.partnerMarginMilli, s: tUiAug?.sellMarginMilli });
  // ✦ GD đường UI: txnDate local 2026-07-31 → KHÔNG ăn kỳ 01/08, ăn kỳ trước 01/07 (margin 2000/1500).
  const gUiJul = await createTransaction({ feeTypeId: ft.id, tidId: uiTid.id, cardTypeId: uiCard.id, amount: 10_000_000, txnDate: new Date('2026-07-31T00:00:00').toISOString() });
  ok('UI-path: GD local 2026-07-31 → ok', gUiJul.ok === true, gUiJul);
  const tUiJul = await db.transaction.findUnique({ where: { id: gUiJul.id! } });
  ok('UI-path: GD 2026-07-31 KHÔNG ăn kỳ 01/08 — ăn kỳ 01/07 (margin 2000/1500)', tUiJul?.partnerMarginMilli === 2000 && tUiJul?.sellMarginMilli === 1500, { p: tUiJul?.partnerMarginMilli, s: tUiJul?.sellMarginMilli });

  // ═══════════ M) FEE_MODEL — LOẠI PHÍ CHỈ ĐỔI PHÍ BÁN: chênh BÁN khác, chênh MUA GIỐNG ═══════════
  // Entities RIÊNG (không đụng đếm khối trên). 1 đối tác × 1 thẻ. Phí mua/cài CỐ ĐỊNH (phiMua 5%, phiCài 1%
  // → CL_NCC 4% = 400.000 cho MỌI loại phí). Phí bán NIÊM YẾT KHÁC nhau theo loại phí:
  //   • loại phí X: phiBán niêm yết 2.5% → CL_KH 1.5% (150.000) → doanh thu 400.000 + 150.000 = 550.000
  //   • loại phí Y: phiBán niêm yết 4%   → CL_KH 3%   (300.000) → doanh thu 400.000 + 300.000 = 700.000
  const mBank = await db.bank.create({ data: { name: 'NH Loại Phí', code: 'MFTBANK' } });
  const mCard = await db.cardType.create({ data: { name: 'Thẻ Loại Phí', code: 'MFTND', bankId: mBank.id } });
  const mPartner = await db.partner.create({ data: { name: 'Đối tác Loại Phí', code: 'MFTP' } });
  await db.partnerBank.create({ data: { partnerId: mPartner.id, bankId: mBank.id } });
  const mTid = await db.tid.create({ data: { tid: 'TIDMFT', mid: 'MIDMFT', hkdName: 'HKD Loại Phí', bankId: mBank.id, partnerId: mPartner.id, customerId: cust.id } });
  const ftX = await db.feeType.create({ data: { name: 'Ủy quyền MFT' } });
  const ftY = await db.feeType.create({ data: { name: 'Tiền chờ MFT' } });
  // 1 biểu phí: phí mua/cài CỐ ĐỊNH + 2 phí bán niêm yết (X=2.5, Y=4) — CÙNG (đối tác × thẻ × kỳ).
  const setMFT = await setFeeRate({ partnerId: mPartner.id, cardTypeId: mCard.id, phiMua: 5, phiCaiMay: 1, effectiveFrom: '2026-01-01T00:00:00.000Z', sellQuotes: [{ feeTypeId: ftX.id, phiBan: 2.5 }, { feeTypeId: ftY.id, phiBan: 4 }] });
  ok('lập biểu phí (mua/cài cố định + 2 phí bán niêm yết X/Y) → ok', setMFT.ok === true, setMFT);
  // 2 GD CÙNG (đối tác × thẻ), KHÁC loại phí → chênh MUA GIỐNG (4000), chênh BÁN KHÁC.
  const gX = await createTransaction({ feeTypeId: ftX.id, tidId: mTid.id, cardTypeId: mCard.id, amount: 10_000_000, txnDate: '2026-06-15T00:00:00.000Z' });
  const gY = await createTransaction({ feeTypeId: ftY.id, tidId: mTid.id, cardTypeId: mCard.id, amount: 10_000_000, txnDate: '2026-06-15T00:00:00.000Z' });
  const tX = await db.transaction.findUnique({ where: { id: gX.id! } });
  const tY = await db.transaction.findUnique({ where: { id: gY.id! } });
  ok('GD loại phí X: chênh MUA 4000, chênh BÁN 1500 → doanh thu 550.000', tX?.partnerMarginMilli === 4000 && tX?.sellMarginMilli === 1500 && Number(tX?.revenueAmount) === 550_000, { p: tX?.partnerMarginMilli, s: tX?.sellMarginMilli, rev: tX?.revenueAmount });
  ok('GD loại phí Y: chênh MUA 4000 (GIỐNG X), chênh BÁN 3000 (KHÁC) → doanh thu 700.000', tY?.partnerMarginMilli === 4000 && tY?.sellMarginMilli === 3000 && Number(tY?.revenueAmount) === 700_000, { p: tY?.partnerMarginMilli, s: tY?.sellMarginMilli, rev: tY?.revenueAmount });
  ok('chênh MUA của X và Y GIỐNG NHAU (loại phí không đổi phí mua)', tX?.partnerMarginMilli === tY?.partnerMarginMilli, { x: tX?.partnerMarginMilli, y: tY?.partnerMarginMilli });
  ok('GD lưu đúng feeTypeId (X/Y)', tX?.feeTypeId === ftX.id && tY?.feeTypeId === ftY.id, { x: tX?.feeTypeId, y: tY?.feeTypeId });
  // TidSellFee override loại phí X trên mTid = 3.0% → GD X sau đó dùng override (CL_KH 2000), loại Y vẫn niêm yết.
  const ovX = await setTidSellFees({ tidId: mTid.id, feeTypeId: ftX.id, entries: [{ cardTypeId: mCard.id, phiBan: 3.0 }] });
  ok('override phí bán TID loại phí X = 3.0% → ok', ovX.ok === true, ovX);
  const gXo = await createTransaction({ feeTypeId: ftX.id, tidId: mTid.id, cardTypeId: mCard.id, amount: 10_000_000, txnDate: '2026-06-16T00:00:00.000Z' });
  const gYo = await createTransaction({ feeTypeId: ftY.id, tidId: mTid.id, cardTypeId: mCard.id, amount: 10_000_000, txnDate: '2026-06-16T00:00:00.000Z' });
  const tXo = await db.transaction.findUnique({ where: { id: gXo.id! } });
  const tYo = await db.transaction.findUnique({ where: { id: gYo.id! } });
  ok('GD X sau override: chênh BÁN = override 3.0−1 = 2000 (doanh thu 400.000+200.000=600.000)', tXo?.sellMarginMilli === 2000 && Number(tXo?.revenueAmount) === 600_000, { s: tXo?.sellMarginMilli, rev: tXo?.revenueAmount });
  ok('GD Y KHÔNG override → vẫn niêm yết (chênh BÁN 3000)', tYo?.sellMarginMilli === 3000, { s: tYo?.sellMarginMilli });
  // BÁO CÁO TÁCH THEO LOẠI PHÍ: lọc theo TID này → 2 dòng. X = 550k + 600k = 1.150.000; Y = 700k + 700k = 1.400.000.
  const bft = await revenueByFeeType({ tidId: mTid.id });
  ok('revenueByFeeType → ok, 2 dòng (2 loại phí)', bft.ok === true && bft.data?.length === 2, bft.data);
  const rowX = bft.data?.find((r) => r.feeTypeId === ftX.id);
  const rowY = bft.data?.find((r) => r.feeTypeId === ftY.id);
  ok('breakdown loại phí X: 2 GD, doanh thu 1.150.000, tên đúng', rowX?.count === 2 && rowX?.totalRevenue === 1_150_000 && rowX?.feeTypeName === 'Ủy quyền MFT', rowX);
  ok('breakdown loại phí Y: 2 GD, doanh thu 1.400.000, tên đúng', rowY?.count === 2 && rowY?.totalRevenue === 1_400_000 && rowY?.feeTypeName === 'Tiền chờ MFT', rowY);
  ok('breakdown sắp doanh thu giảm dần: Y (1.4tr) đứng trước X (1.15tr)', bft.data?.[0]?.feeTypeId === ftY.id, bft.data?.map((r) => r.feeTypeId));
  // LỌC report theo 1 loại phí → chỉ dòng đó.
  const bftX = await revenueByFeeType({ tidId: mTid.id, feeTypeId: ftX.id });
  ok('revenueByFeeType lọc loại phí X → 1 dòng đúng loại X', bftX.data?.length === 1 && bftX.data?.[0]?.feeTypeId === ftX.id, bftX.data);
  // LỌC danh sách GD theo loại phí Y → 2 GD Y (doanh thu 1.400.000).
  const listY = await listTransactions({ tidId: mTid.id, feeTypeId: ftY.id });
  ok('listTransactions lọc loại phí Y → 2 GD, doanh thu 1.400.000', listY.data?.length === 2 && listY.summary?.totalRevenue === 1_400_000 && listY.data?.[0]?.feeTypeName === 'Tiền chờ MFT', { len: listY.data?.length, sum: listY.summary?.totalRevenue });

  // ═══════════ I) PHÂN QUYỀN ═══════════
  await userSvc.createUser({ fullName: 'KH ngoài rev', username: 'custnorev', password: 'Cust@12345', roleCodes: ['CUSTOMER'] }).catch(() => undefined);
  await logout();
  await login('custnorev', 'Cust@12345');
  const forbView = await listTransactions({});
  ok('CUSTOMER không REVENUE_VIEW → FORBIDDEN (list)', forbView.ok === false && forbView.error === 'FORBIDDEN', forbView.error);
  const forbCreate = await createTransaction({ feeTypeId: ft.id, tidId: tid.id, cardTypeId: card.id, amount: 1_000_000, txnDate: '2026-07-03T00:00:00.000Z' });
  ok('CUSTOMER không REVENUE_MANAGE → FORBIDDEN (create)', forbCreate.ok === false && forbCreate.error === 'FORBIDDEN', forbCreate.error);
  const forbDebt = await debtSummary({});
  ok('CUSTOMER không DEBT_VIEW → FORBIDDEN (công nợ)', forbDebt.ok === false && forbDebt.error === 'FORBIDDEN', forbDebt.error);

  // ═══════════ G) BIGINT (R48) — GD VƯỢT trần int4 (2.147.483.647) phải lưu ĐÚNG, KHÔNG tràn/cắt ═══════════
  await login('adminroot', ADMIN_PW);
  const bigAmt = 50_000_000_000; // 50 tỷ >> int4 max ~2,15 tỷ
  const cBig = await createTransaction({ feeTypeId: ft.id, tidId: tid.id, cardTypeId: card.id, amount: bigAmt, txnDate: '2026-07-06T00:00:00.000Z' });
  ok('tạo GD 50 tỷ (>> trần int4) → ok (không crash tràn số)', cBig.ok === true, cBig);
  const tBig = await db.transaction.findUnique({ where: { id: cBig.id! } });
  ok('lưu ĐÚNG 50.000.000.000 (không bị cắt xuống int4)', Number(tBig?.amount) === bigAmt, { got: String(tBig?.amount) });
  // 50 tỷ × (2% + 1.5%) = 50 tỷ × 3.5% = 1.750.000.000 (cũng > int4 → chứng minh revenue* BigInt)
  ok('doanh thu 50 tỷ = 1.750.000.000 (revenue* BigInt, không tràn)', Number(tBig?.revenueAmount) === 1_750_000_000, { got: String(tBig?.revenueAmount) });

  // ═══════════ N) FORM Ghi nhận GD (Mr.Long live-test): KHÔNG truyền customerId + txnDate có GIỜ cụ thể ═══════════
  // #7 — form bỏ dropdown khách: createTransaction KHÔNG nhận customerId (undefined) → khách lấy theo TID (tid.customerId).
  // #8 — form thêm ô Giờ → txnDate ghép ngày+giờ (đường UI: new Date('...T14:30:00').toISOString()) → PHẢI lưu đúng giờ, KHÔNG ép 00:00.
  const timeIso = new Date('2026-07-09T14:30:00').toISOString(); // parse LOCAL như UI gửi (ngày + giờ)
  const midnightIso = new Date('2026-07-09T00:00:00').toISOString();
  const cForm = await createTransaction({ feeTypeId: ft.id, tidId: tid.id, cardTypeId: card.id, amount: 1_000_000, txnDate: timeIso });
  ok('#7 GD KHÔNG truyền customerId → tạo ok', cForm.ok === true, cForm);
  const tForm = await db.transaction.findUnique({ where: { id: cForm.id! } });
  ok('#7 khách lấy theo TID (customerId = tid.customerId)', tForm?.customerId === cust.id, { got: tForm?.customerId, want: cust.id });
  ok('#8 txnDate lưu ĐÚNG giờ cụ thể (14:30) — không bị ép 00:00', tForm?.txnDate.toISOString() === timeIso && timeIso !== midnightIso, { got: tForm?.txnDate.toISOString(), want: timeIso });
  await db.transaction.delete({ where: { id: cForm.id! } }); // dọn để không ảnh hưởng assert đếm khác

  await logout();
  // eslint-disable-next-line no-console
  console.log(`REV15 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
