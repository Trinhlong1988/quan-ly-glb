import { useEffect, useState } from 'react';
import { Loader2, Coins, Handshake, Users, CheckCircle2, Download, FilterX } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate } from '@glb/shared';
import type { TransactionDto, DebtSummary, ConfigTidDto, CustomerDto, LiteRef } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { inputCls } from '../components/Field.js';
import { Button } from '../components/Button.js';
import { useRowSelection, SelectAllCell, SelectCell } from '../components/Selection.js';
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
  const canSettle = hasPermission(user, 'DEBT_SETTLE');
  const [rows, setRows] = useState<TransactionDto[]>([]);
  const [debt, setDebt] = useState<DebtSummary>(emptyDebt);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

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
  const sel = useRowSelection();

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
    const [t, c, b, p] = await Promise.all([window.api.tidConfigList({}), window.api.customerList({}), window.api.bankLite(), window.api.partnerList({})]);
    if (t.ok && t.data) setTids(t.data);
    if (c.ok && c.data) setCustomers(c.data);
    if (b.ok && b.data) setBanks(b.data);
    if (p.ok && p.data) setPartners(p.data.map((x: { id: number; name: string }) => ({ id: x.id, name: x.name })));
  }

  async function reload(pg = page): Promise<void> {
    setLoading(true);
    const [list, ds] = await Promise.all([
      window.api.transactionList({ ...baseFilter(), settled: false, page: pg, pageSize }),
      window.api.debtSummary(baseFilter())
    ]);
    if (list.ok) { setRows(list.data ?? []); setTotal(list.total ?? 0); setPage(list.page ?? pg); }
    else if (list.message) toast.alert(list.message);
    if (ds.ok && ds.data) setDebt(ds.data);
    else if (ds.message) toast.alert(ds.message);
    sel.clear();
    setLoading(false);
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => { void loadRefs(); }, []);
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  function resetFilter(): void {
    setFBank(''); setFPartner(''); setFCustomer(''); setFTid(''); setFFrom(''); setFTo('');
    setTimeout(() => void reload(1), 0);
  }

  async function settleSelected(): Promise<void> {
    if (sel.count === 0) return;
    const res = await window.api.transactionSettle([...sel.selected], true);
    if (res.ok) toast.success(`Đã đối soát ${res.changed ?? sel.count} giao dịch`);
    else toast.alert(res.message ?? 'Đối soát thất bại', 'Không đối soát được');
    await reload();
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Quản Lý Công Nợ</h2>
        <p className="text-sm text-slate-500">Công nợ thu về = 2 khoản chênh (đối tác + bán) của các giao dịch chưa đối soát. Đánh dấu đã thu để tất toán.</p>
      </div>

      {/* KPI công nợ — GIÁ TRỊ TỪ debtSummary (đếm ở MAIN trên toàn bộ theo bộ lọc, KHÔNG từ mảng
          đã phân trang) → tránh count-pagination-drift. StatBar dùng CHUNG mọi trang. */}
      <StatBar
        items={[
          { icon: <Coins className="h-4 w-4" />, tone: 'bg-brand-tint text-brand', label: 'Tổng công nợ thu về', value: money(debt.debtTotal), sub: `${debt.count} giao dịch chưa đối soát` },
          { icon: <Handshake className="h-4 w-4" />, tone: 'bg-indigo-50 text-indigo-500', label: 'Công nợ đối tác', value: money(debt.debtPartner) },
          { icon: <Users className="h-4 w-4" />, tone: 'bg-emerald-50 text-emerald-500', label: 'Công nợ khách/bán', value: money(debt.debtSell) },
          { icon: <CheckCircle2 className="h-4 w-4" />, tone: 'bg-slate-100 text-slate-500', label: 'Đã chọn', value: sel.count, sub: canSettle ? 'Chọn để đối soát' : 'Chỉ xem' }
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
          <button onClick={() => void reload(1)} className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-hover">Lọc</button>
          <button onClick={resetFilter} title="Xóa toàn bộ bộ lọc, đưa về mặc định" className="flex items-center gap-1 rounded-md border border-line px-3 py-2 text-sm text-slate-600 hover:bg-appbg"><FilterX className="h-4 w-4" /> Xóa lọc</button>
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('cong_no', ['Mã GD', 'Ngày', 'TID', 'HKD', 'Khách', 'Nợ đối tác', 'Nợ bán', 'Tổng nợ'], rows.map((r) => [r.code ?? '', fmtDate(r.txnDate), r.tid ?? '', r.hkdName ?? '', r.customerName ?? '', String(r.revenuePartner), String(r.revenueSell), String(r.revenueAmount)]))}>Xuất Excel</Button>
        </div>
      </div>

      {canSettle && sel.count > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-brand/30 bg-brand-tint/40 px-4 py-2 text-sm">
          <span className="text-slate-700">Đã chọn <b>{sel.count}</b> giao dịch để đối soát.</span>
          <Button variant="confirm" icon={<CheckCircle2 className="h-4 w-4" />} onClick={settleSelected}>Đánh dấu đã thu</Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canSettle && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-3 py-3">Mã GD</th>
              <th className="px-3 py-3">Ngày</th>
              <th className="px-3 py-3">TID · MID</th>
              <th className="px-3 py-3">Hộ Kinh Doanh</th>
              <th className="px-3 py-3">Khách hàng</th>
              <th className="px-3 py-3 text-right">Nợ đối tác</th>
              <th className="px-3 py-3 text-right">Nợ khách/bán</th>
              <th className="px-3 py-3 text-right">Tổng nợ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canSettle ? 9 : 8} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canSettle ? 9 : 8} className="px-4 py-10 text-center text-slate-400"><CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-400" /> Không còn công nợ nào — đã đối soát hết.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(r.id) ? 'bg-brand-tint/40' : '')}>
                {canSettle && <SelectCell id={r.id} sel={sel} />}
                <td className="px-3 py-3 font-mono text-xs font-medium text-slate-700">{r.code ?? '—'}</td>
                <td className="px-3 py-3 text-xs text-slate-500">{fmtDate(r.txnDate)}</td>
                <td className="px-3 py-3 text-slate-700">{r.tid ?? '—'}{r.mid ? <span className="block text-xs text-slate-400">{r.mid}</span> : null}</td>
                <td className="px-3 py-3 text-slate-600">{r.hkdName ?? '—'}</td>
                <td className="px-3 py-3 text-slate-600">{r.customerName ?? <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-3 text-right tabular-nums text-indigo-600">{money(r.revenuePartner)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-emerald-600">{money(r.revenueSell)}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-800">{money(r.revenueAmount)}</td>
              </tr>
            ))}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line bg-[#F8FAFC] font-semibold text-slate-800">
                <td colSpan={canSettle ? 6 : 5} className="px-3 py-3 text-right">Tổng cộng ({debt.count} giao dịch)</td>
                <td className="px-3 py-3 text-right tabular-nums text-indigo-700">{money(debt.debtPartner)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-emerald-700">{money(debt.debtSell)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{money(debt.debtTotal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {total > pageSize && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
          <span>Trang {page}/{totalPages} · hiển thị {rows.length}/{total.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} giao dịch chưa đối soát (tổng công nợ tính trên toàn bộ)</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => void reload(page - 1)} className="rounded-md border border-line px-3 py-1.5 disabled:opacity-40 hover:bg-appbg">Trước</button>
            <button disabled={page >= totalPages} onClick={() => void reload(page + 1)} className="rounded-md border border-line px-3 py-1.5 disabled:opacity-40 hover:bg-appbg">Sau</button>
          </div>
        </div>
      )}
    </div>
  );
}
