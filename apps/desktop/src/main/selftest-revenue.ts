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
  debtSummary
} from './transaction-service.js';
import { setFeeRate, listFeeRates } from './fee-config-service.js';
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
  // phiMua 3% (3000), phiCaiMay 1% (1000), phiBan 2.5% (2500)
  //   → chênh đối tác milli = 2000 (2%) ; chênh bán milli = 1500 (1.5%)
  // Kỳ giá mốc sàn (1970) → phủ mọi txnDate trong khối test cũ (P1.1 backfill-compatible).
  const rate = await db.feeRate.create({ data: { partnerId: partner.id, cardTypeId: card.id, phiMua: 3000, phiCaiMay: 1000, phiBan: 2500, effectiveFrom: new Date('1970-01-01T00:00:00.000Z') } });
  const cust = await db.customer.create({ data: { code: 'KHREV1', fullName: 'Khách Doanh Thu', nickname: 'KHR1' } });
  const cust2 = await db.customer.create({ data: { code: 'KHREV2', fullName: 'Khách Hai', nickname: 'KHR2' } });
  const tid = await db.tid.create({
    data: { tid: 'TIDREV1', mid: 'MIDREV001', hkdName: 'HKD Doanh Thu', bankId: bank.id, partnerId: partner.id, customerId: cust.id }
  });

  // ═══════════ A) GHI NHẬN GIAO DỊCH → BÓC 2 KHOẢN, CỘNG GỘP ═══════════
  const amount = 10_000_000;
  const c1 = await createTransaction({ tidId: tid.id, cardTypeId: card.id, amount, txnDate: '2026-07-01T00:00:00.000Z' });
  ok('tạo giao dịch → ok', c1.ok === true, c1);
  const t1 = await db.transaction.findUnique({ where: { id: c1.id! } });
  ok('snapshot chênh đối tác milli = 2000 (phiMua−phiCaiMay)', t1?.partnerMarginMilli === 2000, { got: t1?.partnerMarginMilli });
  ok('snapshot chênh bán milli = 1500 (phiBan−phiCaiMay)', t1?.sellMarginMilli === 1500, { got: t1?.sellMarginMilli });
  ok('doanh thu đối tác = 10.000.000 × 2% = 200.000', t1?.revenuePartner === 200_000, { got: t1?.revenuePartner });
  ok('doanh thu bán = 10.000.000 × 1.5% = 150.000', t1?.revenueSell === 150_000, { got: t1?.revenueSell });
  ok('doanh thu TỔNG = 200.000 + 150.000 = 350.000 (cộng gộp)', t1?.revenueAmount === 350_000, { got: t1?.revenueAmount });
  ok('sinh mã GD tự động', t1?.code === 'GD' + String(c1.id).padStart(5, '0'), { code: t1?.code });
  ok('khách mặc định lấy theo TID', t1?.customerId === cust.id, { got: t1?.customerId });

  // ═══════════ B) SNAPSHOT — đổi biểu phí sau KHÔNG làm sai doanh thu đã ghi ═══════════
  await db.feeRate.update({ where: { id: rate.id }, data: { phiMua: 9000, phiCaiMay: 0, phiBan: 9000 } });
  const t1b = await db.transaction.findUnique({ where: { id: c1.id! } });
  ok('đổi biểu phí → doanh thu GD cũ GIỮ NGUYÊN 350.000 (snapshot)', t1b?.revenueAmount === 350_000, { got: t1b?.revenueAmount });
  // khôi phục biểu phí về mức chuẩn cho các bước sau
  await db.feeRate.update({ where: { id: rate.id }, data: { phiMua: 3000, phiCaiMay: 1000, phiBan: 2500 } });

  // ═══════════ C) GIAO DỊCH THỨ 2 (khách khác) + LỌC + SUMMARY ═══════════
  const c2 = await createTransaction({ tidId: tid.id, cardTypeId: card.id, amount: 4_000_000, txnDate: '2026-07-02T00:00:00.000Z', customerId: cust2.id });
  ok('tạo giao dịch 2 → ok', c2.ok === true, c2);
  // GD2: chênh đối tác 4tr×2% = 80.000 ; chênh bán 4tr×1.5% = 60.000 ; tổng 140.000
  const t2 = await db.transaction.findUnique({ where: { id: c2.id! } });
  ok('GD2 doanh thu tổng = 140.000', t2?.revenueAmount === 140_000, { got: t2?.revenueAmount });

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
  const fNoPartner = await createTransaction({ tidId: tidNoPartner.id, cardTypeId: card.id, amount: 1_000_000, txnDate: '2026-07-03T00:00:00.000Z' });
  ok('TID thiếu đối tác → NO_PARTNER', fNoPartner.ok === false && fNoPartner.error === 'NO_PARTNER', fNoPartner);

  const fMismatch = await createTransaction({ tidId: tid.id, cardTypeId: cardOther.id, amount: 1_000_000, txnDate: '2026-07-03T00:00:00.000Z' });
  ok('loại thẻ lệch ngân hàng TID → CARD_BANK_MISMATCH', fMismatch.ok === false && fMismatch.error === 'CARD_BANK_MISMATCH', fMismatch);

  // đối tác chưa có biểu phí cho loại thẻ này
  const partner2 = await db.partner.create({ data: { name: 'Đối tác chưa phí', code: 'NOFEE' } });
  await db.partnerBank.create({ data: { partnerId: partner2.id, bankId: bank.id } });
  const tidNoFee = await db.tid.create({ data: { tid: 'TIDNOFEE', bankId: bank.id, partnerId: partner2.id } });
  const fNoFee = await createTransaction({ tidId: tidNoFee.id, cardTypeId: card.id, amount: 1_000_000, txnDate: '2026-07-03T00:00:00.000Z' });
  ok('chưa có biểu phí → NO_FEE_RATE', fNoFee.ok === false && fNoFee.error === 'NO_FEE_RATE', fNoFee);

  const fBadAmount = await createTransaction({ tidId: tid.id, cardTypeId: card.id, amount: -5, txnDate: '2026-07-03T00:00:00.000Z' });
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
  await db.feeRate.update({ where: { id: rate.id }, data: { phiMua: 9000, phiCaiMay: 0, phiBan: 9000 } });
  const rC1 = await db.transaction.findUnique({ where: { id: c1.id! } });
  const upNote = await updateTransaction(c1.id!, { note: 'ghi chú mới' });
  ok('sửa ghi chú GD1 (đã đối soát) → BILL_IMMUTABLE', upNote.ok === false && upNote.error === 'BILL_IMMUTABLE', upNote);
  const c1After = await db.transaction.findUnique({ where: { id: c1.id! } });
  ok('SNAPSHOT: bill bất biến giữ nguyên doanh thu (350.000 dù biểu phí đã đổi)', c1After?.revenueAmount === rC1?.revenueAmount && c1After?.revenueAmount === 350_000, { before: rC1?.revenueAmount, after: c1After?.revenueAmount });
  ok('SNAPSHOT: margin đã lưu giữ nguyên (bill bất biến)', c1After?.partnerMarginMilli === 2000 && c1After?.sellMarginMilli === 1500, { p: c1After?.partnerMarginMilli, s: c1After?.sellMarginMilli });
  await db.feeRate.update({ where: { id: rate.id }, data: { phiMua: 3000, phiCaiMay: 1000, phiBan: 2500 } });

  // G3) LỌC bao gồm GD của TID đã XÓA MỀM (regression Defect 2): GD phải vẫn hiện khi lọc.
  const tidDel = await db.tid.create({ data: { tid: 'TIDDEL', mid: 'MIDDEL9', hkdName: 'HKD Del', bankId: bank.id, partnerId: partner.id, customerId: cust.id } });
  const cDel = await createTransaction({ tidId: tidDel.id, cardTypeId: card.id, amount: 1_000_000, txnDate: '2026-07-04T00:00:00.000Z' });
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
  const setK1 = await setFeeRate({ partnerId: kyPartner.id, cardTypeId: kyCard.id, phiMua: 3, phiCaiMay: 1, phiBan: 2.5, effectiveFrom: '2026-01-01T00:00:00.000Z' });
  ok('lập kỳ K1 (2026-01-01) → ok', setK1.ok === true, setK1);
  // (2) Kỳ K2 hiệu lực 2026-07-01: phiMua 5% / phiCaiMay 1% / phiBan 4% → margin đối tác 4%, bán 3%. KHÔNG xóa K1.
  const setK2 = await setFeeRate({ partnerId: kyPartner.id, cardTypeId: kyCard.id, phiMua: 5, phiCaiMay: 1, phiBan: 4, effectiveFrom: '2026-07-01T00:00:00.000Z' });
  ok('lập kỳ K2 (2026-07-01) → ok, KHÔNG xóa K1', setK2.ok === true && setK1.id !== setK2.id, { k1: setK1.id, k2: setK2.id });
  const kyRates = await listFeeRates({ partnerId: kyPartner.id });
  ok('2 KỲ giá cùng tồn tại cho tổ hợp', kyRates.data?.length === 2, { len: kyRates.data?.length });
  ok('kỳ đang hiệu lực HÔM NAY = K2 (2026-07-01)', kyRates.data?.find((r) => r.isCurrent)?.id === setK2.id, kyRates.data?.map((r) => ({ id: r.id, eff: r.effectiveFrom, cur: r.isCurrent })));

  // (3) GD txnDate 2026-06-15 (trong K1) → PHẢI ăn giá K1 (margin 2% & 1.5%), tổng 350.000.
  const gK1 = await createTransaction({ tidId: kyTid.id, cardTypeId: kyCard.id, amount: 10_000_000, txnDate: '2026-06-15T00:00:00.000Z' });
  ok('GD 2026-06-15 → ok', gK1.ok === true, gK1);
  const tK1 = await db.transaction.findUnique({ where: { id: gK1.id! } });
  ok('GD 2026-06-15 ăn giá K1: margin 2000/1500', tK1?.partnerMarginMilli === 2000 && tK1?.sellMarginMilli === 1500, { p: tK1?.partnerMarginMilli, s: tK1?.sellMarginMilli });
  ok('GD 2026-06-15 doanh thu = 200.000 + 150.000 = 350.000', tK1?.revenueAmount === 350_000, { got: tK1?.revenueAmount });

  // (4) GD txnDate 2026-07-10 (trong K2) → PHẢI ăn giá K2 (margin 4% & 3%), tổng 700.000.
  const gK2 = await createTransaction({ tidId: kyTid.id, cardTypeId: kyCard.id, amount: 10_000_000, txnDate: '2026-07-10T00:00:00.000Z' });
  ok('GD 2026-07-10 → ok', gK2.ok === true, gK2);
  const tK2 = await db.transaction.findUnique({ where: { id: gK2.id! } });
  ok('GD 2026-07-10 ăn giá K2: margin 4000/3000', tK2?.partnerMarginMilli === 4000 && tK2?.sellMarginMilli === 3000, { p: tK2?.partnerMarginMilli, s: tK2?.sellMarginMilli });
  ok('GD 2026-07-10 doanh thu = 400.000 + 300.000 = 700.000', tK2?.revenueAmount === 700_000, { got: tK2?.revenueAmount });

  // (5) GD BACKDATE txnDate 2026-03-01 (lập SAU khi K2 đã tồn tại) → vẫn ăn K1 (I-P2).
  const gBack = await createTransaction({ tidId: kyTid.id, cardTypeId: kyCard.id, amount: 10_000_000, txnDate: '2026-03-01T00:00:00.000Z' });
  ok('GD backdate 2026-03-01 → ok', gBack.ok === true, gBack);
  const tBack = await db.transaction.findUnique({ where: { id: gBack.id! } });
  ok('GD backdate 2026-03-01 vẫn ăn K1 (margin 2000/1500) — I-P2', tBack?.partnerMarginMilli === 2000 && tBack?.sellMarginMilli === 1500, { p: tBack?.partnerMarginMilli, s: tBack?.sellMarginMilli });

  // (6) GD txnDate 2025-12-31 (trước MỌI kỳ) → NO_FEE_RATE (I-P3, không lấy đại kỳ tương lai).
  const gNone = await createTransaction({ tidId: kyTid.id, cardTypeId: kyCard.id, amount: 10_000_000, txnDate: '2025-12-31T00:00:00.000Z' });
  ok('GD 2025-12-31 (trước mọi kỳ) → NO_FEE_RATE (I-P3)', gNone.ok === false && gNone.error === 'NO_FEE_RATE', gNone);

  // (7) ĐỔI GIÁ K1 (update kỳ K1) → các bill đã tạo ở K1/K2 GIỮ NGUYÊN doanh thu (I-P1 snapshot bất biến).
  const revK1Before = tK1?.revenueAmount, revBackBefore = tBack?.revenueAmount, revK2Before = tK2?.revenueAmount;
  const upK1 = await setFeeRate({ partnerId: kyPartner.id, cardTypeId: kyCard.id, phiMua: 9, phiCaiMay: 0, phiBan: 9, effectiveFrom: '2026-01-01T00:00:00.000Z' });
  ok('đổi giá kỳ K1 (cùng mốc 2026-01-01) → update, KHÔNG tạo kỳ mới', upK1.ok === true && upK1.id === setK1.id, { upK1, k1: setK1.id });
  ok('vẫn đúng 2 kỳ sau khi đổi giá K1', (await listFeeRates({ partnerId: kyPartner.id })).data?.length === 2);
  const tK1After = await db.transaction.findUnique({ where: { id: gK1.id! } });
  const tBackAfter = await db.transaction.findUnique({ where: { id: gBack.id! } });
  const tK2After = await db.transaction.findUnique({ where: { id: gK2.id! } });
  ok('I-P1: bill K1 (2026-06-15) GIỮ doanh thu 350.000 sau khi đổi giá K1', tK1After?.revenueAmount === revK1Before && tK1After?.revenueAmount === 350_000, { before: revK1Before, after: tK1After?.revenueAmount });
  ok('I-P1: bill backdate (2026-03-01) GIỮ doanh thu 350.000 sau khi đổi giá K1', tBackAfter?.revenueAmount === revBackBefore && tBackAfter?.revenueAmount === 350_000, { before: revBackBefore, after: tBackAfter?.revenueAmount });
  ok('I-P1: bill K2 (2026-07-10) GIỮ doanh thu 700.000 (không đụng)', tK2After?.revenueAmount === revK2Before && tK2After?.revenueAmount === 700_000, { before: revK2Before, after: tK2After?.revenueAmount });

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
  const setUiPrev = await setFeeRate({ partnerId: uiPartner.id, cardTypeId: uiCard.id, phiMua: 3, phiCaiMay: 1, phiBan: 2.5, effectiveFrom: uiPrevEff });
  ok('UI-path: lập kỳ 01/07 (parse local) → ok', setUiPrev.ok === true, setUiPrev);
  // Kỳ 2026-08-01 (đường UI local): margin đối tác 4%, bán 3%.
  const uiAugEff = new Date('2026-08-01T00:00:00').toISOString(); // LOCAL parse (KHÔNG 'Z') — như UI gửi
  const setUiAug = await setFeeRate({ partnerId: uiPartner.id, cardTypeId: uiCard.id, phiMua: 5, phiCaiMay: 1, phiBan: 4, effectiveFrom: uiAugEff });
  ok('UI-path: lập kỳ 01/08 (parse local) → ok', setUiAug.ok === true, setUiAug);

  // ✦ ASSERT LÕI B16/F1: ngày HIỂN THỊ = đúng ngày user nhập (không lệch −1 ngày trên UTC+7).
  const uiRates = await listFeeRates({ partnerId: uiPartner.id });
  const uiAugDto = uiRates.data?.find((r) => r.id === setUiAug.id);
  ok('UI-path: fmtDate(effectiveFrom kỳ 01/08) === "01/08/2026" (KHÔNG lệch −1 ngày)', fmtDate(uiAugDto?.effectiveFrom) === '01/08/2026', { got: fmtDate(uiAugDto?.effectiveFrom), iso: uiAugDto?.effectiveFrom });
  const uiPrevDto = uiRates.data?.find((r) => r.id === setUiPrev.id);
  ok('UI-path: fmtDate(effectiveFrom kỳ 01/07) === "01/07/2026"', fmtDate(uiPrevDto?.effectiveFrom) === '01/07/2026', { got: fmtDate(uiPrevDto?.effectiveFrom), iso: uiPrevDto?.effectiveFrom });

  // ✦ GD đường UI: txnDate local 2026-08-01 → ăn kỳ 01/08 (margin 4000/3000).
  const gUiAug = await createTransaction({ tidId: uiTid.id, cardTypeId: uiCard.id, amount: 10_000_000, txnDate: new Date('2026-08-01T00:00:00').toISOString() });
  ok('UI-path: GD local 2026-08-01 → ok', gUiAug.ok === true, gUiAug);
  const tUiAug = await db.transaction.findUnique({ where: { id: gUiAug.id! } });
  ok('UI-path: GD 2026-08-01 ăn kỳ 01/08 (margin 4000/3000)', tUiAug?.partnerMarginMilli === 4000 && tUiAug?.sellMarginMilli === 3000, { p: tUiAug?.partnerMarginMilli, s: tUiAug?.sellMarginMilli });
  // ✦ GD đường UI: txnDate local 2026-07-31 → KHÔNG ăn kỳ 01/08, ăn kỳ trước 01/07 (margin 2000/1500).
  const gUiJul = await createTransaction({ tidId: uiTid.id, cardTypeId: uiCard.id, amount: 10_000_000, txnDate: new Date('2026-07-31T00:00:00').toISOString() });
  ok('UI-path: GD local 2026-07-31 → ok', gUiJul.ok === true, gUiJul);
  const tUiJul = await db.transaction.findUnique({ where: { id: gUiJul.id! } });
  ok('UI-path: GD 2026-07-31 KHÔNG ăn kỳ 01/08 — ăn kỳ 01/07 (margin 2000/1500)', tUiJul?.partnerMarginMilli === 2000 && tUiJul?.sellMarginMilli === 1500, { p: tUiJul?.partnerMarginMilli, s: tUiJul?.sellMarginMilli });

  // ═══════════ I) PHÂN QUYỀN ═══════════
  await userSvc.createUser({ fullName: 'KH ngoài rev', username: 'custnorev', password: 'Cust@12345', roleCodes: ['CUSTOMER'] }).catch(() => undefined);
  await logout();
  await login('custnorev', 'Cust@12345');
  const forbView = await listTransactions({});
  ok('CUSTOMER không REVENUE_VIEW → FORBIDDEN (list)', forbView.ok === false && forbView.error === 'FORBIDDEN', forbView.error);
  const forbCreate = await createTransaction({ tidId: tid.id, cardTypeId: card.id, amount: 1_000_000, txnDate: '2026-07-03T00:00:00.000Z' });
  ok('CUSTOMER không REVENUE_MANAGE → FORBIDDEN (create)', forbCreate.ok === false && forbCreate.error === 'FORBIDDEN', forbCreate.error);
  const forbDebt = await debtSummary({});
  ok('CUSTOMER không DEBT_VIEW → FORBIDDEN (công nợ)', forbDebt.ok === false && forbDebt.error === 'FORBIDDEN', forbDebt.error);

  await logout();
  // eslint-disable-next-line no-console
  console.log(`REV15 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
