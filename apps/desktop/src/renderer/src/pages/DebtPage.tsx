import { useEffect, useState } from 'react';
import { Loader2, Coins, Handshake, Users, CheckCircle2, Download, FilterX, HandCoins } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate } from '@glb/shared';
import type { DebtSummary, DebtOpenTxnDto, ConfigTidDto, CustomerDto, LiteRef, FundDto, EntryCategoryLite, CreateDebtReceiptInput } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { inputCls, Field } from '../components/Field.js';
import { Button } from '../components/Button.js';
import { Modal } from '../components/Modal.js';
import { StatBar } from '../components/StatBar.js';
import { exportCsv } from '../lib/exportCsv.js';

/** VND, nhóm 3 số bằng dấu chấm (KHÔNG toLocaleString). Giữ dấu âm. */
function money(n: number): string {
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '−' : '') + s + 'đ';
}

const emptyDebt: DebtSummary = { count: 0, debtPartner: 0, debtSell: 0, debtTotal: 0 };

export function DebtPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  // H5 — KHÔNG còn toggle "đã thu" thủ công; thu công nợ = lập phiếu Thu công nợ (CASHENTRY_CREATE).
  const canReceipt = hasPermission(user, 'CASHENTRY_CREATE');
  const [rows, setRows] = useState<DebtOpenTxnDto[]>([]);
  const [debt, setDebt] = useState<DebtSummary>(emptyDebt);
  const [loading, setLoading] = useState(true);

  const [fBank, setFBank] = useState('');
  const [fPartner, setFPartner] = useState('');
  const [fCustomer, setFCustomer] = useState('');
  const [fTid, setFTid] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');

  const [tids, setTids] = useState<ConfigTidDto[]>([]);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [banks, setBanks] = useState<LiteRef[]>([]);
  const [partners, setPartners] = useState<{ id: number; name: string }[]>([]);

  // Dữ liệu form Thu công nợ.
  const [funds, setFunds] = useState<FundDto[]>([]);
  const [debtCats, setDebtCats] = useState<EntryCategoryLite[]>([]);
  const [receiptGd, setReceiptGd] = useState<DebtOpenTxnDto | null>(null);

  function baseFilter(): Record<string, unknown> {
    return {
      bankId: fBank ? Number(fBank) : undefined,
      partnerId: fPartner ? Number(fPartner) : undefined,
      customerId: fCustomer ? Number(fCustomer) : undefined,
      tidId: fTid ? Number(fTid) : undefined,
      dateFrom: fFrom ? new Date(fFrom + 'T00:00:00').toISOString() : undefined,
      dateTo: fTo ? new Date(fTo + 'T23:59:59').toISOString() : undefined
    };
  }

  async function loadRefs(): Promise<void> {
    const [t, c, b, p] = await Promise.all([
      window.api.tidConfigList({}),
      window.api.customerList({}),
      window.api.bankLite(),
      window.api.partnerList({})
    ]);
    if (t.ok && t.data) setTids(t.data);
    if (c.ok && c.data) setCustomers(c.data);
    if (b.ok && b.data) setBanks(b.data);
    if (p.ok && p.data) setPartners(p.data.map((x: { id: number; name: string }) => ({ id: x.id, name: x.name })));
    // Dữ liệu form Thu công nợ chỉ cần khi có quyền lập phiếu.
    if (canReceipt) {
      const [f, cat] = await Promise.all([window.api.fundList({ active: true }), window.api.cashEntryCategoryLite()]);
      if (f.ok && f.data) setFunds(f.data);
      if (cat.ok && cat.data) setDebtCats(cat.data.filter((x) => x.sourceKind === 'DEBT_CUSTOMER' || x.sourceKind === 'DEBT_PARTNER'));
    }
  }

  async function reload(): Promise<void> {
    setLoading(true);
    const [list, ds] = await Promise.all([
      window.api.debtOpenTransactions(baseFilter()),
      window.api.debtSummary(baseFilter())
    ]);
    if (list.ok) setRows(list.data ?? []);
    else if (list.message) toast.alert(list.message);
    if (ds.ok && ds.data) setDebt(ds.data);
    else if (ds.message) toast.alert(ds.message);
    setLoading(false);
  }

  useEffect(() => { void loadRefs(); }, []);
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  function resetFilter(): void {
    setFBank(''); setFPartner(''); setFCustomer(''); setFTid(''); setFFrom(''); setFTo('');
    setTimeout(() => void reload(), 0);
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Quản Lý Công Nợ</h2>
        <p className="text-sm text-slate-500">Công nợ CÒN LẠI = 2 khoản chênh (đối tác + bán) trừ đi phần đã thu qua phiếu Thu công nợ. Số liệu tính net theo từng khoản — không đếm trùng.</p>
      </div>

      {/* KPI công nợ — GIÁ TRỊ NET TỪ debtSummary (đếm ở MAIN trên toàn bộ theo bộ lọc). StatBar dùng CHUNG mọi trang. */}
      <StatBar
        items={[
          { icon: <Coins className="h-4 w-4" />, tone: 'bg-brand-tint text-brand', label: 'Tổng công nợ còn lại', value: money(debt.debtTotal), sub: `${debt.count} giao dịch còn nợ` },
          { icon: <Handshake className="h-4 w-4" />, tone: 'bg-indigo-50 text-indigo-500', label: 'Nợ đối tác (còn lại)', value: money(debt.debtPartner) },
          { icon: <Users className="h-4 w-4" />, tone: 'bg-emerald-50 text-emerald-500', label: 'Nợ khách/bán (còn lại)', value: money(debt.debtSell) },
          { icon: <HandCoins className="h-4 w-4" />, tone: 'bg-slate-100 text-slate-500', label: 'Thu công nợ', value: canReceipt ? 'Lập phiếu' : 'Chỉ xem', sub: canReceipt ? 'Bấm “Thu” ở từng dòng' : undefined }
        ]}
      />

      <div className="mb-3 rounded-xl border border-line bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-slate-500">TID
            <select className={inputCls + ' w-40'} value={fTid} onChange={(e) => setFTid(e.target.value)}><option value="">Tất cả TID</option>{tids.map((t) => <option key={t.id} value={t.id}>{t.tid}{t.hkdName ? ` · ${t.hkdName}` : ''}</option>)}</select>
          </label>
          <label className="flex flex-col text-xs text-slate-500">Ngân hàng
            <select className={inputCls + ' w-36'} value={fBank} onChange={(e) => setFBank(e.target.value)}><option value="">Tất cả</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select>
          </label>
          <label className="flex flex-col text-xs text-slate-500">Đối tác
            <select className={inputCls + ' w-36'} value={fPartner} onChange={(e) => setFPartner(e.target.value)}><option value="">Tất cả</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <label className="flex flex-col text-xs text-slate-500">Khách hàng
            <select className={inputCls + ' w-40'} value={fCustomer} onChange={(e) => setFCustomer(e.target.value)}><option value="">Tất cả</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.nickname} ({c.fullName})</option>)}</select>
          </label>
          <label className="flex flex-col text-xs text-slate-500">Từ ngày
            <input type="date" className={inputCls} value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          </label>
          <label className="flex flex-col text-xs text-slate-500">Đến ngày
            <input type="date" className={inputCls} value={fTo} onChange={(e) => setFTo(e.target.value)} />
          </label>
          <button onClick={() => void reload()} className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-hover">Lọc</button>
          <button onClick={resetFilter} title="Xóa toàn bộ bộ lọc, đưa về mặc định" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-brand/10 text-brand hover:bg-brand/20"><FilterX className="h-4 w-4" /> Xóa lọc</button>
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('cong_no', ['Mã GD', 'Ngày', 'TID', 'HKD', 'Khách', 'Nợ đối tác còn lại', 'Nợ bán còn lại'], rows.map((r) => [r.code ?? '', fmtDate(r.txnDate), r.tid ?? '', r.hkdName ?? '', r.customerName ?? '', String(r.remainingPartner), String(r.remainingSell)]))}>Xuất Excel</Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-3">Mã GD</th>
              <th className="px-3 py-3">Ngày</th>
              <th className="px-3 py-3">TID · MID</th>
              <th className="px-3 py-3">Hộ Kinh Doanh</th>
              <th className="px-3 py-3">Khách hàng</th>
              <th className="px-3 py-3 text-right">Nợ đối tác còn lại</th>
              <th className="px-3 py-3 text-right">Nợ khách/bán còn lại</th>
              <th className="px-3 py-3 text-right">Tổng còn lại</th>
              {canReceipt && <th className="px-3 py-3 text-right">Thu</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canReceipt ? 9 : 8} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canReceipt ? 9 : 8} className="px-4 py-10 text-center text-slate-400"><CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-400" /> Không còn công nợ nào — đã thu hết.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="hover:bg-appbg/60">
                <td className="px-3 py-3 font-mono text-xs font-medium text-slate-700">{r.code ?? '—'}</td>
                <td className="px-3 py-3 text-xs text-slate-500">{fmtDate(r.txnDate)}</td>
                <td className="px-3 py-3 text-slate-700">{r.tid ?? '—'}{r.mid ? <span className="block text-xs text-slate-400">{r.mid}</span> : null}</td>
                <td className="px-3 py-3 text-slate-600">{r.hkdName ?? '—'}</td>
                <td className="px-3 py-3 text-slate-600">{r.customerName ?? <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-3 text-right tabular-nums text-indigo-600">{money(r.remainingPartner)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-emerald-600">{money(r.remainingSell)}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-800">{money(r.remainingPartner + r.remainingSell)}</td>
                {canReceipt && (
                  <td className="px-3 py-3 text-right">
                    <button onClick={() => setReceiptGd(r)} className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-brand/20"><HandCoins className="h-3.5 w-3.5" /> Thu</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line bg-[#F8FAFC] font-semibold text-slate-800">
                <td colSpan={5} className="px-3 py-3 text-right">Tổng cộng ({debt.count} giao dịch)</td>
                <td className="px-3 py-3 text-right tabular-nums text-indigo-700">{money(debt.debtPartner)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-emerald-700">{money(debt.debtSell)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{money(debt.debtTotal)}</td>
                {canReceipt && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {receiptGd && (
        <DebtReceiptModal
          gd={receiptGd}
          funds={funds}
          debtCats={debtCats}
          onClose={() => setReceiptGd(null)}
          onDone={() => { setReceiptGd(null); void reload(); }}
        />
      )}
    </div>
  );
}

/** Modal lập phiếu Thu công nợ cho 1 GD: nhập số thu từng khoản (≤ còn lại) + quỹ/hình thức/ngày. */
function DebtReceiptModal({
  gd, funds, debtCats, onClose, onDone
}: {
  gd: DebtOpenTxnDto;
  funds: FundDto[];
  debtCats: EntryCategoryLite[];
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const toast = useToast();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [amtPartner, setAmtPartner] = useState('');
  const [amtSell, setAmtSell] = useState('');
  const [fundId, setFundId] = useState(funds[0]?.id ? String(funds[0].id) : '');
  const [method, setMethod] = useState('CASH');
  const [entryDate, setEntryDate] = useState(todayStr);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  function money(n: number): string {
    return Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
  }
  // FIX 3 — side ↔ danh mục PHẢI khớp: SELL ↔ Công nợ khách hàng (DEBT_CUSTOMER, đối tượng = KH);
  // PARTNER ↔ Công nợ đối tác (DEBT_PARTNER, đối tượng = đối tác). 1 phiếu = 1 danh mục nên khi thu CẢ
  // 2 khoản của 1 GD → TÁCH thành 2 phiếu đúng danh mục/đối tượng (nhãn dòng tiền không lệch).
  const customerCat = debtCats.find((c) => c.sourceKind === 'DEBT_CUSTOMER');
  const partnerCat = debtCats.find((c) => c.sourceKind === 'DEBT_PARTNER');

  async function submit(): Promise<void> {
    const p = Number(amtPartner), s = Number(amtSell);
    const partnerAmt = amtPartner.trim() && Number.isFinite(p) && p > 0 ? Math.round(p) : 0;
    const sellAmt = amtSell.trim() && Number.isFinite(s) && s > 0 ? Math.round(s) : 0;
    if (partnerAmt === 0 && sellAmt === 0) { toast.alert('Nhập số tiền thu ít nhất 1 khoản (> 0).'); return; }
    if (partnerAmt > gd.remainingPartner) { toast.alert(`Nợ đối tác còn lại chỉ ${money(gd.remainingPartner)}.`); return; }
    if (sellAmt > gd.remainingSell) { toast.alert(`Nợ khách/bán còn lại chỉ ${money(gd.remainingSell)}.`); return; }
    if (!fundId) { toast.alert('Chọn quỹ nhận tiền.'); return; }

    // Dựng tối đa 2 phiếu (mỗi phiếu 1 side ↔ danh mục ↔ đối tượng).
    const receipts: CreateDebtReceiptInput[] = [];
    if (partnerAmt > 0) {
      if (!partnerCat) { toast.alert('Thiếu danh mục Công nợ đối tác hệ thống.'); return; }
      if (gd.partnerId == null) { toast.alert('Giao dịch này không có đối tác để thu công nợ đối tác.'); return; }
      receipts.push({ categoryId: partnerCat.id, fundId: Number(fundId), method, entryDate, partnerId: gd.partnerId, note: note.trim() || undefined, lines: [{ transactionId: gd.id, side: 'PARTNER', amount: partnerAmt }] });
    }
    if (sellAmt > 0) {
      if (!customerCat) { toast.alert('Thiếu danh mục Công nợ khách hàng hệ thống.'); return; }
      if (gd.customerId == null) { toast.alert('Giao dịch này không có khách hàng để thu công nợ khách/bán.'); return; }
      receipts.push({ categoryId: customerCat.id, fundId: Number(fundId), method, entryDate, customerId: gd.customerId, note: note.trim() || undefined, lines: [{ transactionId: gd.id, side: 'SELL', amount: sellAmt }] });
    }

    setBusy(true);
    let done = 0; let failMsg = '';
    for (const r of receipts) {
      const res = await window.api.cashEntryCreateDebtReceipt(r);
      if (res.ok) done++; else { failMsg = res.message ?? 'Lập phiếu thất bại'; break; }
    }
    setBusy(false);
    if (done === receipts.length) { toast.success(receipts.length > 1 ? 'Đã lập 2 phiếu Thu công nợ (đối tác + khách/bán)' : 'Đã lập phiếu Thu công nợ'); onDone(); }
    else { toast.alert(failMsg + (done > 0 ? ` (đã lập ${done} phiếu trước đó)` : ''), 'Không thu được công nợ'); if (done > 0) onDone(); }
  }

  return (
    <Modal title={`Thu công nợ · GD ${gd.code ?? '#' + gd.id}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg bg-appbg/60 px-3 py-2 text-sm text-slate-600">
          <div>Đối tượng: <b>{gd.customerName ?? gd.partnerName ?? '—'}</b></div>
          <div className="mt-1 flex gap-4 text-xs">
            <span>Nợ đối tác còn lại: <b className="text-indigo-600">{money(gd.remainingPartner)}</b></span>
            <span>Nợ khách/bán còn lại: <b className="text-emerald-600">{money(gd.remainingSell)}</b></span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Thu khoản đối tác" hint={`≤ ${money(gd.remainingPartner)}`}>
            <input className={inputCls} inputMode="numeric" value={amtPartner} onChange={(e) => setAmtPartner(e.target.value.replace(/[^\d]/g, ''))} disabled={gd.remainingPartner <= 0} placeholder="0" />
          </Field>
          <Field label="Thu khoản khách/bán" hint={`≤ ${money(gd.remainingSell)}`}>
            <input className={inputCls} inputMode="numeric" value={amtSell} onChange={(e) => setAmtSell(e.target.value.replace(/[^\d]/g, ''))} disabled={gd.remainingSell <= 0} placeholder="0" />
          </Field>
          <Field label="Quỹ nhận tiền" required>
            <select className={inputCls} value={fundId} onChange={(e) => setFundId(e.target.value)}>
              <option value="">— Chọn quỹ —</option>
              {funds.map((f) => <option key={f.id} value={f.id}>{f.code} · {f.name}</option>)}
            </select>
          </Field>
          <Field label="Hình thức" required>
            <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Tiền mặt</option>
              <option value="CK">Chuyển khoản</option>
            </select>
          </Field>
          <Field label="Ngày thu" required>
            <input type="date" className={inputCls} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
          <Field label="Ghi chú">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tùy chọn" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="neutral" onClick={onClose}>Hủy</Button>
          <Button variant="confirm" icon={<HandCoins className="h-4 w-4" />} onClick={submit} disabled={busy}>{busy ? 'Đang lưu…' : 'Lập phiếu thu'}</Button>
        </div>
      </div>
    </Modal>
  );
}
