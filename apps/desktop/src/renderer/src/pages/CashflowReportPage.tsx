// PHASE H2-core — Thu–Chi: Trang Báo cáo thu – chi (§F). FilterBar từ ngày → đến ngày + danh mục/quỹ;
// bảng phiếu POSTED + dòng tổng THU / tổng CHI / chênh lệch. (Đầy đủ hơn ở H6.)
import { useEffect, useState } from 'react';
import { Loader2, Download, BarChart3, ArrowDownCircle, ArrowUpCircle, Scale } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { fmtDate } from '@glb/shared';
import type { CashEntryDto, CashflowSummary, EntryCategoryLite, FundDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { FilterBar } from '../components/FilterBar.js';
import { Button } from '../components/Button.js';
import { StatBar } from '../components/StatBar.js';
import { statusTone } from '../components/StatusPill.js';
import { exportCsv } from '../lib/exportCsv.js';

function money(n: number): string {
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '−' : '') + s + 'đ';
}

export function CashflowReportPage({ user: _user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<CashEntryDto[]>([]);
  const [summary, setSummary] = useState<CashflowSummary>({ count: 0, totalThu: 0, totalChi: 0, net: 0 });
  const [loading, setLoading] = useState(true);
  const [fKind, setFKind] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fFund, setFFund] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [cats, setCats] = useState<EntryCategoryLite[]>([]);
  const [funds, setFunds] = useState<FundDto[]>([]);

  async function loadRefs(): Promise<void> {
    const [c, f] = await Promise.all([window.api.cashEntryCategoryLite(), window.api.fundList({})]);
    if (c.ok && c.data) setCats(c.data);
    if (f.ok && f.data) setFunds(f.data);
  }
  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.cashEntryReport({
      kind: fKind || undefined,
      categoryId: fCategory ? Number(fCategory) : undefined,
      fundId: fFund ? Number(fFund) : undefined,
      fromDate: fFrom || undefined,
      toDate: fTo || undefined
    });
    if (res.ok && res.data) { setRows(res.data); setSummary(res.summary ?? { count: 0, totalThu: 0, totalChi: 0, net: 0 }); }
    else if (res.message) toast.alert(res.message);
    setLoading(false);
  }
  useEffect(() => { void loadRefs(); }, []);
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [fKind, fCategory, fFund]);

  const catOptions = cats.filter((c) => !fKind || c.kind === fKind);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Báo Cáo Thu – Chi</h2>
        <p className="text-sm text-slate-500">Dòng tiền theo khoảng ngày (chỉ tính phiếu đã ghi). Lọc theo danh mục / quỹ để đối chiếu.</p>
      </div>

      <StatBar items={[
        { label: 'Số phiếu', value: summary.count, icon: <BarChart3 className="h-4 w-4" /> },
        { label: 'Tổng thu', value: money(summary.totalThu), icon: <ArrowDownCircle className="h-4 w-4" />, tone: statusTone('ACTIVE') },
        { label: 'Tổng chi', value: money(summary.totalChi), icon: <ArrowUpCircle className="h-4 w-4" />, tone: 'bg-warning/10 text-warning' },
        { label: 'Chênh lệch (thu − chi)', value: money(summary.net), icon: <Scale className="h-4 w-4" />, tone: summary.net >= 0 ? statusTone('ACTIVE') : 'bg-danger/10 text-danger' }
      ]} />

      <FilterBar search="" onSearch={() => undefined} searchPlaceholder="—"
        fromDate={fFrom} toDate={fTo} onFromDate={setFFrom} onToDate={setFTo}
        selects={[
          { key: 'k', placeholder: 'Thu & Chi', value: fKind, options: [{ value: 'THU', label: 'Chỉ thu' }, { value: 'CHI', label: 'Chỉ chi' }], onChange: (v) => { setFKind(v); setFCategory(''); } },
          { key: 'c', placeholder: 'Tất cả danh mục', value: fCategory, options: catOptions.map((c) => ({ value: String(c.id), label: `${c.kind === 'THU' ? '[Thu] ' : '[Chi] '}${c.name}` })), onChange: setFCategory },
          { key: 'f', placeholder: 'Tất cả quỹ', value: fFund, options: funds.map((f) => ({ value: String(f.id), label: f.name })), onChange: setFFund }
        ]}
        onApply={reload} onReset={() => { setFKind(''); setFCategory(''); setFFund(''); setFFrom(''); setFTo(''); setTimeout(reload, 0); }} />

      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} phiếu{fFrom || fTo ? ` · ${fFrom || '…'} → ${fTo || '…'}` : ''}</div>
        <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('bao_cao_thu_chi', ['Mã', 'Ngày', 'Loại', 'Danh mục', 'Quỹ', 'Số tiền', 'Hình thức', 'Ghi chú'], rows.map((r) => [r.code ?? '', fmtDate(r.entryDate), r.kind === 'THU' ? 'Thu' : 'Chi', r.categoryName ?? '', r.fundName ?? '', String(r.amount), r.method === 'CK' ? 'Chuyển khoản' : 'Tiền mặt', r.note ?? '']))}>Xuất Excel</Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm list-scroll">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Ngày</th>
              <th className="px-4 py-3">Loại</th>
              <th className="px-4 py-3">Danh mục</th>
              <th className="px-4 py-3">Quỹ</th>
              <th className="px-4 py-3 text-right">Số tiền</th>
              <th className="px-4 py-3">Hình thức</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400"><BarChart3 className="mx-auto mb-2 h-6 w-6" /> Không có phiếu trong khoảng lọc.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="hover:bg-appbg/60">
                <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{r.code}</td>
                <td className="px-4 py-3 text-slate-600">{fmtDate(r.entryDate)}</td>
                <td className="px-4 py-3">{r.kind === 'THU' ? <span className="text-success">Thu</span> : <span className="text-warning">Chi</span>}</td>
                <td className="px-4 py-3 text-slate-700">{r.categoryName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{r.fundName ?? '—'}</td>
                <td className={'px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap ' + (r.kind === 'THU' ? 'text-success' : 'text-warning')}>{r.kind === 'THU' ? '' : '−'}{money(r.amount)}</td>
                <td className="px-4 py-3 text-slate-600">{r.method === 'CK' ? 'Chuyển khoản' : 'Tiền mặt'}</td>
              </tr>
            ))}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line bg-[#F8FAFC] font-semibold text-slate-800">
                <td className="px-4 py-3" colSpan={5}>Tổng cộng ({summary.count} phiếu)</td>
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                  <div className="text-success">Thu {money(summary.totalThu)}</div>
                  <div className="text-warning">Chi {money(summary.totalChi)}</div>
                  <div className={summary.net >= 0 ? 'text-brand' : 'text-danger'}>Chênh {money(summary.net)}</div>
                </td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
