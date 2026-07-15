import { useEffect, useMemo, useState } from 'react';
import { Plus, Ban, Trash2, Loader2, TrendingUp, Download, Receipt, Handshake, Users, FilterX, RefreshCw, Pencil } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, groupDigits } from '@glb/shared';
import type {
  TransactionDto,
  RevenueSummary,
  ConfigTidDto,
  CardTypeDto,
  CustomerDto,
  LiteRef,
  CreateTransactionInput,
  FeeTypeDto,
  TidSellFeeRowDto,
  RevenueByFeeTypeRow,
  RevenueByHandoverRow,
  DepositHeldRow
} from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Field, inputCls } from '../components/Field.js';
import { SearchSelect } from '../components/SearchSelect.js';
import { Button } from '../components/Button.js';
import { useRowSelection, SelectionBar, SelectAllCell, SelectCell } from '../components/Selection.js';
import { StatBar } from '../components/StatBar.js';
import { StaleBanner } from '../lib/realtime.js';
import { exportCsv } from '../lib/exportCsv.js';
import { MONEY_KIND_LABEL } from './HandoverConfigPage.js';

/** VND, nhóm 3 số bằng dấu chấm (KHÔNG toLocaleString — R_UI QA gate). Giữ dấu âm. */
function money(n: number): string {
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '−' : '') + s + 'đ';
}

function IconBtn({ children, title, variant, onClick }: { children: JSX.Element; title: string; variant?: 'edit' | 'danger'; onClick: () => void }): JSX.Element {
  const tone = variant === 'danger' ? 'text-danger hover:bg-danger/10' : variant === 'edit' ? 'text-warning hover:bg-warning/10' : 'text-slate-400 hover:bg-brand-tint hover:text-brand';
  return <button title={title} onClick={onClick} className={'rounded-md p-1.5 transition ' + tone}>{children}</button>;
}

/** Badge trạng thái bill (P1.2): Đã ghi / Chờ duyệt hủy / Đã hủy — theo R_UI màu. */
function BillStatusBadge({ status }: { status: string }): JSX.Element {
  const map: Record<string, { label: string; cls: string }> = {
    POSTED: { label: 'Đã ghi', cls: 'bg-success/10 text-success' },
    CANCEL_PENDING: { label: 'Chờ duyệt hủy', cls: 'bg-warning/10 text-warning' },
    CANCELLED: { label: 'Đã hủy', cls: 'bg-slate-200 text-slate-500' }
  };
  const s = map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-500' };
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

const emptySummary: RevenueSummary = { count: 0, totalAmount: 0, totalRevenuePartner: 0, totalRevenueSell: 0, totalRevenue: 0 };

/** #4 — giá trị điền sẵn cho form Ghi nhận giao dịch khi Điều chỉnh (từ bill cũ). Tất cả dạng chuỗi (state form). */
interface TxnFormInitial {
  bankId?: string;
  hkdName?: string;
  tidId?: string;
  cardTypeId?: string;
  feeTypeId?: string;
  amount?: string;
  note?: string;
}

export function RevenuePage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const canManage = hasPermission(user, 'REVENUE_MANAGE');
  const canRequestCancel = hasPermission(user, 'BILL_CANCEL_REQUEST');
  const [rows, setRows] = useState<TransactionDto[]>([]);
  const [summary, setSummary] = useState<RevenueSummary>(emptySummary);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [loading, setLoading] = useState(true);

  // Bộ lọc đa chiều
  const [fMid, setFMid] = useState('');
  const [fHkd, setFHkd] = useState('');
  const [fBank, setFBank] = useState('');
  const [fPartner, setFPartner] = useState('');
  const [fCustomer, setFCustomer] = useState('');
  const [fTid, setFTid] = useState('');
  const [fFeeType, setFFeeType] = useState('');
  const [fSettled, setFSettled] = useState(''); // '' | 'yes' | 'no'
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');

  // Dữ liệu nền
  const [tids, setTids] = useState<ConfigTidDto[]>([]);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [banks, setBanks] = useState<LiteRef[]>([]);
  const [partners, setPartners] = useState<{ id: number; name: string; code: string | null }[]>([]);
  const [feeTypes, setFeeTypes] = useState<FeeTypeDto[]>([]);
  // FEE_TYPE — báo cáo doanh thu tách theo loại phí (tổng toàn bộ theo bộ lọc).
  const [byFeeType, setByFeeType] = useState<RevenueByFeeTypeRow[]>([]);
  // LOẠI GIAO MÁY (Mr.Long) — doanh thu theo loại giao (Bán/Cho thuê/Cọc/Mượn) + cọc đang giữ (KHÔNG phải doanh thu).
  const [byHandover, setByHandover] = useState<RevenueByHandoverRow[]>([]);
  const [depositsHeldRows, setDepositsHeldRows] = useState<DepositHeldRow[]>([]);

  const [showForm, setShowForm] = useState(false); // GD chỉ GHI NHẬN (create); bill bất biến — sửa = hủy+tạo lại (BILL_IMMUTABLE)
  const [formInitial, setFormInitial] = useState<TxnFormInitial | undefined>(undefined); // #4 — điền sẵn khi Điều chỉnh
  const [del, setDel] = useState<TransactionDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<TransactionDto | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<TransactionDto | null>(null); // #4 — Điều chỉnh (hủy cũ + tạo mới)
  const sel = useRowSelection();

  function buildFilter(pg: number): Record<string, unknown> {
    return {
      mid: fMid.trim() || undefined,
      hkdName: fHkd.trim() || undefined,
      bankId: fBank ? Number(fBank) : undefined,
      partnerId: fPartner ? Number(fPartner) : undefined,
      customerId: fCustomer ? Number(fCustomer) : undefined,
      tidId: fTid ? Number(fTid) : undefined,
      feeTypeId: fFeeType ? Number(fFeeType) : undefined,
      settled: fSettled === 'yes' ? true : fSettled === 'no' ? false : undefined,
      dateFrom: fFrom ? new Date(fFrom + 'T00:00:00').toISOString() : undefined,
      dateTo: fTo ? new Date(fTo + 'T23:59:59').toISOString() : undefined,
      page: pg,
      pageSize
    };
  }

  async function loadRefs(): Promise<void> {
    const [t, c, b, p, f] = await Promise.all([
      window.api.tidConfigList({}),
      window.api.customerList({}),
      window.api.bankLite(),
      window.api.partnerList({}),
      window.api.feeTypeList()
    ]);
    if (t.ok && t.data) setTids(t.data);
    if (c.ok && c.data) setCustomers(c.data);
    if (b.ok && b.data) setBanks(b.data);
    if (p.ok && p.data) setPartners(p.data.map((x: { id: number; name: string; code: string | null }) => ({ id: x.id, name: x.name, code: x.code })));
    if (f.ok && f.data) setFeeTypes(f.data);
  }

  async function reload(pg = page): Promise<void> {
    setLoading(true);
    const filter = buildFilter(pg);
    // LOẠI GIAO MÁY — tôn trọng cùng khoảng ngày Từ/Đến đang lọc trên trang (fFrom/fTo, raw yyyy-mm-dd).
    const [res, bf, bh, dh] = await Promise.all([
      window.api.transactionList(filter),
      window.api.revenueByFeeType(filter),
      window.api.revenueByHandover({ from: fFrom || undefined, to: fTo || undefined }),
      window.api.depositsHeld()
    ]);
    if (res.ok) {
      setRows(res.data ?? []);
      setSummary(res.summary ?? emptySummary);
      setTotal(res.total ?? 0);
      setPage(res.page ?? pg);
    } else if (res.message) toast.alert(res.message);
    setByFeeType(bf.ok && bf.data ? bf.data : []);
    setByHandover(bh.ok && bh.data ? bh.data : []);
    setDepositsHeldRows(dh.ok && dh.data ? dh.data : []);
    sel.clear();
    setLoading(false);
  }

  useEffect(() => { void loadRefs(); }, []);
  useEffect(() => { void reload(1); /* eslint-disable-next-line */ }, []);

  function applyFilter(): void { void reload(1); }
  function resetFilter(): void {
    setFMid(''); setFHkd(''); setFBank(''); setFPartner(''); setFCustomer(''); setFTid(''); setFFeeType(''); setFSettled(''); setFFrom(''); setFTo('');
    setTimeout(() => void reload(1), 0);
  }

  async function doDelete(t: TransactionDto, password?: string): Promise<void> {
    const res = await window.api.transactionDelete([t.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa giao dịch ${t.code ?? t.id}`);
    else toast.alert(res.message ?? 'Xóa giao dịch thất bại', 'Xóa thất bại');
    setDel(null); await reload();
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.transactionDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} giao dịch`);
    else toast.alert(res.message ?? 'Xóa giao dịch thất bại', 'Xóa thất bại');
    setBulkDel(false); await reload();
  }

  async function doRequestCancel(t: TransactionDto, reason: string): Promise<void> {
    const res = await window.api.cancelRequest(t.id, reason);
    if (res.ok) toast.success(`Đã gửi yêu cầu hủy bill ${t.code ?? t.id} — chờ Quản lý/Admin duyệt.`);
    else toast.alert(res.message ?? 'Không gửi được yêu cầu hủy.', 'Yêu cầu hủy thất bại');
    setCancelTarget(null);
    await reload();
  }

  // #4 Điều chỉnh bill (phương án 1 Mr.Long): bill bất biến → tạo YÊU CẦU HỦY bill cũ (qua duyệt) rồi
  // MỞ SẴN form tạo bill mới, điền sẵn TID/thẻ/loại phí/số tiền của bill cũ để sửa + tạo lại.
  async function doAdjust(t: TransactionDto, reason: string): Promise<void> {
    const res = await window.api.cancelRequest(t.id, reason);
    if (res.ok) {
      toast.success(`Đã gửi yêu cầu hủy bill ${t.code ?? t.id} — điền form để tạo bill mới thay thế.`);
      setFormInitial({
        bankId: t.bankId != null ? String(t.bankId) : '',
        hkdName: t.hkdName ?? '',
        tidId: String(t.tidId),
        cardTypeId: t.cardTypeId != null ? String(t.cardTypeId) : '',
        feeTypeId: t.feeTypeId != null ? String(t.feeTypeId) : '',
        amount: String(t.amount),
        note: t.note ?? ''
      });
      setShowForm(true);
      await reload();
    } else {
      toast.alert(res.message ?? 'Không gửi được yêu cầu hủy.', 'Điều chỉnh thất bại');
    }
    setAdjustTarget(null);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showActions = canManage || canRequestCancel;
  // 13 cột dữ liệu (thêm Loại phí) + ô chọn (canManage) + ô thao tác (showActions).
  const colCount = 13 + (canManage ? 1 : 0) + (showActions ? 1 : 0);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Quản Lý Doanh Thu</h2>
          <p className="text-sm text-slate-500">Ghi nhận giao dịch qua TID · doanh thu = chênh đối tác (phí mua − phí cài máy) + chênh bán (phí bán − phí cài máy).</p>
        </div>
        {canManage && (
          <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => tids.length ? setShowForm(true) : toast.alert('Cần có ít nhất 1 TID đã cấu hình Đối tác trước.', 'Thiếu dữ liệu nền')}>Ghi nhận giao dịch</Button>
        )}
      </div>

      {/* KPI realtime — GIÁ TRỊ TỪ summary (đếm ở MAIN trên toàn bộ theo bộ lọc, KHÔNG từ mảng đã
          phân trang) → tránh count-pagination-drift. StatBar dùng CHUNG mọi trang. */}
      <StatBar
        items={[
          { icon: <TrendingUp className="h-4 w-4" />, tone: 'bg-brand-tint text-brand', label: 'Tổng doanh thu', value: money(summary.totalRevenue) },
          { icon: <Handshake className="h-4 w-4" />, tone: 'bg-indigo-50 text-indigo-500', label: 'Chênh đối tác', value: money(summary.totalRevenuePartner) },
          { icon: <Users className="h-4 w-4" />, tone: 'bg-emerald-50 text-emerald-500', label: 'Chênh bán', value: money(summary.totalRevenueSell) },
          { icon: <Receipt className="h-4 w-4" />, tone: 'bg-slate-100 text-slate-500', label: 'Số giao dịch', value: summary.count }
        ]}
      />

      {/* FEE_TYPE — báo cáo doanh thu TÁCH theo loại phí (Ủy quyền/Đối ứng/Tiền chờ…), tổng toàn bộ theo bộ lọc. */}
      {byFeeType.length > 0 && (
        <div className="mb-3 overflow-x-auto rounded-xl border border-line bg-white p-3 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-700">Doanh thu theo loại phí</div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Loại phí</th>
                <th className="px-3 py-2 text-right">Số GD</th>
                <th className="px-3 py-2 text-right">Số tiền</th>
                <th className="px-3 py-2 text-right">Chênh đối tác</th>
                <th className="px-3 py-2 text-right">Chênh bán</th>
                <th className="px-3 py-2 text-right">Doanh thu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {byFeeType.map((r) => (
                <tr key={r.feeTypeId ?? 'null'} className="hover:bg-appbg/60">
                  <td className="px-3 py-2 font-medium text-slate-700">{r.feeTypeName ?? '(Chưa gán loại phí)'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.count}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(r.totalAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-indigo-600">{money(r.totalRevenuePartner)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{money(r.totalRevenueSell)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{money(r.totalRevenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* LOẠI GIAO MÁY (Mr.Long) — doanh thu TÁCH theo loại giao (Bán/Cho thuê/Cọc/Mượn), tôn trọng khoảng ngày Từ/Đến. */}
      {byHandover.length > 0 && (
        <div className="mb-3 overflow-x-auto rounded-xl border border-line bg-white p-3 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-700">Doanh thu theo loại giao</div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Loại giao</th>
                <th className="px-3 py-2">Hình thức tiền</th>
                <th className="px-3 py-2 text-right">Số chứng từ</th>
                <th className="px-3 py-2 text-right">Doanh thu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {byHandover.map((r) => (
                <tr key={r.handoverTypeId ?? 'null'} className="hover:bg-appbg/60">
                  <td className="px-3 py-2 font-medium text-slate-700">{r.handoverName}</td>
                  <td className="px-3 py-2 text-slate-600">{MONEY_KIND_LABEL[r.moneyKind] ?? r.moneyKind}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.docCount}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{money(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Đang giữ cọc — CÔNG NỢ PHẢI TRẢ khách (chưa hoàn cọc), KHÔNG phải doanh thu. Hiển thị riêng để không lẫn vào KPI doanh thu. */}
      {depositsHeldRows.length > 0 && (
        <div className="mb-3 overflow-x-auto rounded-xl border border-amber-300/60 bg-amber-50/40 p-3 shadow-sm">
          <div className="mb-0.5 text-sm font-semibold text-amber-700">Đang giữ cọc của khách</div>
          <p className="mb-2 text-xs text-amber-700/80">Công nợ phải trả khách (tiền cọc chưa hoàn) — KHÔNG tính vào doanh thu ở trên.</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-medium uppercase tracking-wide text-amber-700/70">
              <tr>
                <th className="px-3 py-2">Khách hàng</th>
                <th className="px-3 py-2 text-right">Số lần cọc</th>
                <th className="px-3 py-2 text-right">Còn giữ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-200/60">
              {depositsHeldRows.map((r) => (
                <tr key={r.customerId} className="hover:bg-amber-100/40">
                  <td className="px-3 py-2 font-medium text-slate-700">{r.customerName ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.depositCount}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-amber-700">{money(r.remaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bộ lọc đa chiều — mỗi chiều một ô riêng */}
      <div className="mb-3 rounded-xl border border-line bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-slate-500">Mã MID
            <input className={inputCls + ' w-36'} value={fMid} onChange={(e) => setFMid(e.target.value)} placeholder="Chứa…" onKeyDown={(e) => e.key === 'Enter' && applyFilter()} />
          </label>
          <label className="flex flex-col text-xs text-slate-500">Tên Hộ Kinh Doanh
            <input className={inputCls + ' w-44'} value={fHkd} onChange={(e) => setFHkd(e.target.value)} placeholder="Chứa…" onKeyDown={(e) => e.key === 'Enter' && applyFilter()} />
          </label>
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
          <label className="flex flex-col text-xs text-slate-500">Loại phí
            <select className={inputCls + ' w-36'} value={fFeeType} onChange={(e) => setFFeeType(e.target.value)}><option value="">Tất cả</option>{feeTypes.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          </label>
          <label className="flex flex-col text-xs text-slate-500">Đối soát
            <select className={inputCls + ' w-32'} value={fSettled} onChange={(e) => setFSettled(e.target.value)}><option value="">Tất cả</option><option value="no">Chưa đối soát</option><option value="yes">Đã đối soát</option></select>
          </label>
          <label className="flex flex-col text-xs text-slate-500">Từ ngày
            <input type="date" className={inputCls} value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          </label>
          <label className="flex flex-col text-xs text-slate-500">Đến ngày
            <input type="date" className={inputCls} value={fTo} onChange={(e) => setFTo(e.target.value)} />
          </label>
          <button onClick={applyFilter} className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-hover">Lọc</button>
          <button onClick={resetFilter} title="Xóa toàn bộ bộ lọc, đưa về mặc định" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-brand/10 text-brand hover:bg-brand/20"><FilterX className="h-4 w-4" /> Xóa lọc</button>
          <button onClick={() => void reload()} title="Tải lại dữ liệu mới nhất (giữ nguyên bộ lọc)" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-brand/10 text-brand hover:bg-brand/20"><RefreshCw className="h-4 w-4" /> Làm mới</button>
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('doanh_thu', ['Mã GD', 'Ngày', 'TID', 'MID', 'HKD', 'Khách', 'Loại thẻ', 'Loại phí', 'Số tiền', 'Chênh đối tác', 'Chênh bán', 'Doanh thu', 'Đối soát'], rows.map((r) => [r.code ?? '', fmtDate(r.txnDate), r.tid ?? '', r.mid ?? '', r.hkdName ?? '', r.customerName ?? '', r.cardTypeName ?? '', r.feeTypeName ?? '', String(r.amount), String(r.revenuePartner), String(r.revenueSell), String(r.revenueAmount), r.settled ? 'Đã đối soát' : 'Chưa']))}>Xuất Excel</Button>
        </div>
      </div>

      {canManage && <SelectionBar count={sel.count} entityLabel="giao dịch" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}

      <StaleBanner domain="Transaction" onReload={reload} className="mb-2" />
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm list-scroll">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-3 py-3">Mã GD</th>
              <th className="px-3 py-3">Ngày</th>
              <th className="px-3 py-3">TID · MID</th>
              <th className="px-3 py-3">Hộ Kinh Doanh</th>
              <th className="px-3 py-3">Khách hàng</th>
              <th className="px-3 py-3">Loại thẻ</th>
              <th className="px-3 py-3">Loại phí</th>
              <th className="px-3 py-3 text-right">Số tiền</th>
              <th className="px-3 py-3 text-right">Chênh đối tác</th>
              <th className="px-3 py-3 text-right">Chênh bán</th>
              <th className="px-3 py-3 text-right">Doanh thu</th>
              <th className="px-3 py-3 text-center">Trạng thái</th>
              <th className="px-3 py-3 text-center">Đối soát</th>
              {(canManage || canRequestCancel) && <th className="px-3 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={colCount} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={colCount} className="px-4 py-10 text-center text-slate-400"><Receipt className="mx-auto mb-2 h-6 w-6" /> Chưa có giao dịch nào khớp bộ lọc.</td></tr>}
            {!loading && rows.map((r) => {
              const cancelled = r.status === 'CANCELLED';
              return (
              <tr key={r.id} className={'hover:bg-appbg/60 ' + (cancelled ? 'opacity-50 ' : '') + (sel.isSelected(r.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={r.id} sel={sel} />}
                <td className="px-3 py-3 font-mono text-xs font-medium text-slate-700 whitespace-nowrap">{r.code ?? '—'}</td>
                <td className="px-3 py-3 text-xs text-slate-500">{fmtDate(r.txnDate)}</td>
                <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{r.tid ?? '—'}{r.mid ? <span className="block text-xs text-slate-400">{r.mid}</span> : null}</td>
                <td className="px-3 py-3 text-slate-600">{r.hkdName ?? '—'}</td>
                <td className="px-3 py-3 text-slate-600">{r.customerName ?? <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-3 text-slate-600">{r.cardTypeName ?? '—'}</td>
                <td className="px-3 py-3 text-slate-600">{r.feeTypeName ?? '—'}</td>
                <td className="px-3 py-3 text-right tabular-nums text-slate-700 whitespace-nowrap">{money(r.amount)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-indigo-600 whitespace-nowrap">{money(r.revenuePartner)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-emerald-600 whitespace-nowrap">{money(r.revenueSell)}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-800 whitespace-nowrap">{money(r.revenueAmount)}</td>
                <td className="px-3 py-3 text-center"><BillStatusBadge status={r.status} /></td>
                <td className="px-3 py-3 text-center">{r.settled ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-600">Đã thu</span> : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-600">Chưa</span>}</td>
                {showActions && (
                  <td className="px-3 py-3"><div className="flex justify-end gap-1">
                    {canManage && canRequestCancel && r.status === 'POSTED' && (
                      <IconBtn title="Điều chỉnh (yêu cầu hủy bill cũ + tạo bill mới)" variant="edit" onClick={() => setAdjustTarget(r)}><Pencil className="h-4 w-4" /></IconBtn>
                    )}
                    {canRequestCancel && r.status === 'POSTED' && (
                      <IconBtn title="Yêu cầu hủy bill" variant="edit" onClick={() => setCancelTarget(r)}><Ban className="h-4 w-4" /></IconBtn>
                    )}
                    {canManage && <IconBtn title="Xóa" variant="danger" onClick={() => setDel(r)}><Trash2 className="h-4 w-4" /></IconBtn>}
                  </div></td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phân trang */}
      {total > pageSize && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
          <span>Trang {page}/{totalPages} · {total.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} giao dịch</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => void reload(page - 1)} className="rounded-md border border-line px-3 py-1.5 disabled:opacity-40 hover:bg-appbg">Trước</button>
            <button disabled={page >= totalPages} onClick={() => void reload(page + 1)} className="rounded-md border border-line px-3 py-1.5 disabled:opacity-40 hover:bg-appbg">Sau</button>
          </div>
        </div>
      )}

      {showForm && <TransactionForm tids={tids} feeTypes={feeTypes} initial={formInitial} onClose={() => { setShowForm(false); setFormInitial(undefined); }} onSaved={() => { setShowForm(false); setFormInitial(undefined); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa giao dịch" message={`Giao dịch "${del.code ?? del.id}" (${money(del.amount)}) sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều giao dịch" message={`${sel.count} giao dịch đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
      {cancelTarget && <CancelReasonModal bill={cancelTarget} onClose={() => setCancelTarget(null)} onSubmit={(reason) => doRequestCancel(cancelTarget, reason)} />}
      {adjustTarget && <AdjustReasonModal bill={adjustTarget} onClose={() => setAdjustTarget(null)} onSubmit={(reason) => doAdjust(adjustTarget, reason)} />}
    </div>
  );
}

/** #4 — Ô lý do khi Điều chỉnh bill: gửi yêu cầu hủy bill cũ (qua duyệt) + mở form tạo bill mới điền sẵn. */
function AdjustReasonModal({ bill, onClose, onSubmit }: { bill: TransactionDto; onClose: () => void; onSubmit: (reason: string) => Promise<void> }): JSX.Element {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(): Promise<void> {
    if (!reason.trim()) return toast.alert('Vui lòng nhập lý do điều chỉnh (làm lý do hủy bill cũ).', 'Thiếu lý do');
    setBusy(true);
    try { await onSubmit(reason.trim()); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Điều chỉnh bill ${bill.code ?? bill.id}`} onClose={onClose} width="max-w-md">
      <p className="mb-3 text-sm text-slate-600">Bill đã ghi là <b>bất biến</b>. Điều chỉnh = gửi <b>yêu cầu hủy</b> bill cũ (Quản lý/Admin duyệt) và mở sẵn form <b>tạo bill mới</b> đã điền TID / loại thẻ / loại phí / số tiền của bill cũ để bạn sửa lại. Bill cũ giữ nguyên tới khi được duyệt hủy.</p>
      <Field label="Lý do điều chỉnh" required>
        <textarea className={inputCls + ' min-h-[80px] resize-y'} value={reason} autoFocus onChange={(e) => setReason(e.target.value)} placeholder="Ví dụ: nhập nhầm số tiền / sai loại thẻ — tạo lại bill đúng…" />
      </Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={submit} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Gửi yêu cầu hủy & mở form mới</Button>
      </div>
    </Modal>
  );
}

/** Ô nhập lý do hủy bill (bắt buộc) — gửi yêu cầu hủy cho Quản lý/Admin duyệt (P1.2 §5). */
function CancelReasonModal({ bill, onClose, onSubmit }: { bill: TransactionDto; onClose: () => void; onSubmit: (reason: string) => Promise<void> }): JSX.Element {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(): Promise<void> {
    if (!reason.trim()) return toast.alert('Vui lòng nhập lý do hủy bill.', 'Thiếu lý do');
    setBusy(true);
    try { await onSubmit(reason.trim()); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Yêu cầu hủy bill ${bill.code ?? bill.id}`} onClose={onClose} width="max-w-md">
      <p className="mb-3 text-sm text-slate-600">Bill đã ghi là <b>bất biến</b> — không sửa được. Gửi yêu cầu hủy (kèm lý do) để Quản lý/Admin duyệt; duyệt xong bill mới chuyển sang <b>Đã hủy</b> và không còn tính vào doanh thu.</p>
      <Field label="Lý do hủy" required>
        <textarea className={inputCls + ' min-h-[80px] resize-y'} value={reason} autoFocus onChange={(e) => setReason(e.target.value)} placeholder="Ví dụ: nhập nhầm số tiền / sai loại thẻ…" />
      </Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={submit} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Gửi yêu cầu hủy</Button>
      </div>
    </Modal>
  );
}

/** % biểu phí (giá trị đã ÷1000 ở main) — dấu phẩy thập phân kiểu VN, đồng nhất TidPage/TidSellFeeModal. */
function pctText(p: number | null): string {
  if (p == null) return 'chưa cấu hình';
  return `${String(p).replace('.', ',')}%`;
}

function TransactionForm({ tids, feeTypes, initial, onClose, onSaved }: { tids: ConfigTidDto[]; feeTypes: FeeTypeDto[]; initial?: TxnFormInitial; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  // #10 — luồng CASCADING theo thứ tự Mr.Long: Ngân hàng → Tên HKD → TID → Loại thẻ → Loại phí → …
  // #4 — điền sẵn từ `initial` khi Điều chỉnh (tạo lại bill từ bill cũ vừa gửi yêu cầu hủy).
  const [bankId, setBankId] = useState(initial?.bankId ?? '');
  const [hkdName, setHkdName] = useState(initial?.hkdName ?? '');
  const [tidId, setTidId] = useState(initial?.tidId ?? '');
  const [cardTypeId, setCardTypeId] = useState(initial?.cardTypeId ?? '');
  // Loại phí: MẶC ĐỊNH phần tử ĐẦU danh sách (Mr.Long "hiển thị theo thứ tự 1").
  const [feeTypeId, setFeeTypeId] = useState(initial?.feeTypeId ?? (feeTypes[0] ? String(feeTypes[0].id) : ''));
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [txnDate, setTxnDate] = useState(new Date().toISOString().slice(0, 10));
  // #8 — Giờ giao dịch: mặc định GIỜ HIỆN TẠI lúc mở form (HH:mm), cho sửa; ghép ngày+giờ khi lưu.
  const [txnTime, setTxnTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [note, setNote] = useState(initial?.note ?? '');
  const [cards, setCards] = useState<CardTypeDto[]>([]);
  // #6 — biểu phí tham chiếu cho (TID × thẻ × loại phí) đang chọn.
  const [sellFee, setSellFee] = useState<TidSellFeeRowDto | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedTid = tids.find((t) => t.id === Number(tidId));

  // #10/#11 — danh sách CASCADING, mỗi cấp lọc theo cấp trên (nguồn = prop tids đã kèm bank/hkd/khách).
  // (1) Ngân hàng = distinct theo bankId trong tids.
  const bankOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of tids) if (t.bankId != null && !m.has(t.bankId)) m.set(t.bankId, t.bankName ?? t.bankCode ?? `NH #${t.bankId}`);
    return [...m.entries()].map(([id, label]) => ({ value: String(id), label }));
  }, [tids]);
  // (2) Tên HKD = distinct hkdName của các TID thuộc ngân hàng đã chọn.
  const hkdOptions = useMemo(() => {
    if (!bankId) return [];
    const s = new Set<string>();
    for (const t of tids) if (String(t.bankId) === bankId && t.hkdName) s.add(t.hkdName);
    return [...s].map((h) => ({ value: h, label: h }));
  }, [tids, bankId]);
  // (3) TID = các TID thuộc ĐÚNG ngân hàng + HKD đã chọn.
  const tidOptions = useMemo(() => {
    if (!bankId || !hkdName) return [];
    return tids
      .filter((t) => String(t.bankId) === bankId && t.hkdName === hkdName)
      .map((t) => ({ value: String(t.id), label: t.tid + (t.partnerName ? ` · ${t.partnerName}` : '') }));
  }, [tids, bankId, hkdName]);

  // Reset cấp dưới khi đổi cấp trên (chống dữ liệu "mồ côi" không còn khớp bộ lọc).
  function onBank(v: string): void { setBankId(v); setHkdName(''); setTidId(''); setCardTypeId(''); }
  function onHkd(v: string): void { setHkdName(v); setTidId(''); setCardTypeId(''); }
  function onTid(v: string): void { setTidId(v); setCardTypeId(''); }

  // Nạp loại thẻ theo ngân hàng của TID được chọn.
  useEffect(() => {
    if (!selectedTid?.bankId) { setCards([]); return; }
    void window.api.cardTypeList({ bankId: selectedTid.bankId }).then((r) => {
      if (r.ok && r.data) setCards(r.data);
    });
  }, [selectedTid?.bankId]);

  // #6 — sau khi chọn đủ TID + Loại thẻ + Loại phí → tra biểu phí (phí mua/cài máy/bán thực tế|niêm yết).
  useEffect(() => {
    if (!tidId || !cardTypeId || !feeTypeId) { setSellFee(null); return; }
    let alive = true;
    void window.api.tidSellFeeList(Number(tidId), Number(feeTypeId)).then((r) => {
      if (!alive) return;
      const row = r.ok && r.data ? r.data.rows.find((x) => x.cardTypeId === Number(cardTypeId)) ?? null : null;
      setSellFee(row);
    });
    return () => { alive = false; };
  }, [tidId, cardTypeId, feeTypeId]);

  // Phí bán áp dụng = THỰC TẾ (override) nếu có, ngược lại NIÊM YẾT; chênh bán = bán − cài máy.
  const phiBanApplied = sellFee ? (sellFee.hasOverride ? sellFee.phiBanThucTe : sellFee.phiBanNiemYet) : null;
  const chenhBan = phiBanApplied != null && sellFee?.phiCaiMayNiemYet != null ? Number((phiBanApplied - sellFee.phiCaiMayNiemYet).toFixed(3)) : null;
  const showFee = !!(tidId && cardTypeId && feeTypeId);

  async function save(): Promise<void> {
    if (!bankId) return toast.alert('Vui lòng chọn ngân hàng.', 'Thiếu thông tin');
    if (!hkdName) return toast.alert('Vui lòng chọn Hộ Kinh Doanh.', 'Thiếu thông tin');
    if (!tidId) return toast.alert('Vui lòng chọn TID.', 'Thiếu thông tin');
    if (!cardTypeId) return toast.alert('Vui lòng chọn loại thẻ.', 'Thiếu thông tin');
    if (!feeTypeId) return toast.alert('Vui lòng chọn loại phí.', 'Thiếu thông tin');
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0 || !Number.isInteger(amt)) return toast.alert('Số tiền phải là số nguyên ≥ 0.', 'Số tiền không hợp lệ');
    if (!txnDate) return toast.alert('Vui lòng chọn ngày giao dịch.', 'Thiếu thông tin');
    if (!txnTime) return toast.alert('Vui lòng chọn giờ giao dịch.', 'Thiếu thông tin');
    setBusy(true);
    // #8 — ghép NGÀY + GIỜ (local) → ISO; giữ đúng giờ nhập (không còn ép 00:00).
    const iso = new Date(txnDate + 'T' + txnTime + ':00').toISOString();
    // #7 — KHÔNG gửi customerId: backend tự lấy khách theo TID (Tid.customerId).
    const input: CreateTransactionInput = { tidId: Number(tidId), cardTypeId: Number(cardTypeId), feeTypeId: Number(feeTypeId), amount: amt, txnDate: iso, note };
    const res = await window.api.transactionCreate(input);
    setBusy(false);
    if (res.ok) { toast.success('Đã ghi nhận giao dịch'); onSaved(); }
    else toast.alert(res.message ?? 'Lưu giao dịch thất bại', 'Không lưu được');
  }

  return (
    <Modal title="Ghi nhận giao dịch" onClose={onClose} width="max-w-3xl">
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        {/* #10/#11 — (1) Ngân hàng · (2) Tên HKD · (3) TID: 3 ô TÌM KIẾM ĐỘC LẬP, cascading. */}
        <Field label="Ngân hàng" required hint="Gõ để tìm nhanh ngân hàng">
          <SearchSelect value={bankId} onChange={onBank} options={bankOptions} placeholder="— Chọn ngân hàng —" />
        </Field>
        <Field label="Tên Hộ Kinh Doanh" required hint={bankId ? 'Chỉ HKD có TID thuộc ngân hàng đã chọn' : 'Chọn ngân hàng trước'}>
          <SearchSelect value={hkdName} onChange={onHkd} options={hkdOptions} placeholder="— Chọn Hộ Kinh Doanh —" disabled={!bankId} />
        </Field>
        <Field label="TID" required hint={hkdName ? 'Chỉ TID của HKD + ngân hàng đã chọn' : 'Chọn HKD trước'}>
          <SearchSelect value={tidId} onChange={onTid} options={tidOptions} placeholder="— Chọn TID —" disabled={!hkdName} />
        </Field>
        {/* (4) Loại thẻ · (5) Loại phí: danh sách ngắn → giữ select thường. */}
        <Field label="Loại thẻ" required hint={selectedTid ? `Ngân hàng: ${selectedTid.bankName ?? selectedTid.bankCode ?? '—'}` : 'Chọn TID trước'}>
          <select className={inputCls} value={cardTypeId} onChange={(e) => setCardTypeId(e.target.value)} disabled={!cards.length}>
            <option value="">— Chọn loại thẻ —</option>
            {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Loại phí" required hint="Tra biểu phí theo loại phí này">
          <select className={inputCls} value={feeTypeId} onChange={(e) => setFeeTypeId(e.target.value)}>
            <option value="">— Chọn loại phí —</option>
            {feeTypes.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        {/* (6) SHOW PHÍ — khối tham chiếu biểu phí đã cài (full-width) ngay dưới Loại phí. */}
        <div className="col-span-2">
          {showFee ? (
            <div className="rounded-lg border border-line bg-appbg/60 px-3 py-2.5 text-sm text-slate-600">
              <span className="font-medium text-slate-700">Biểu phí đã cài: </span>
              Phí mua: <b className="tabular-nums text-slate-800">{pctText(sellFee?.phiMuaNiemYet ?? null)}</b>
              {' · '}Phí cài máy: <b className="tabular-nums text-slate-800">{pctText(sellFee?.phiCaiMayNiemYet ?? null)}</b>
              {' · '}Phí bán: <b className="tabular-nums text-slate-800">{pctText(phiBanApplied)}</b>
              {' '}<span className="text-xs text-slate-400">({sellFee?.hasOverride ? 'thực tế' : 'niêm yết'})</span>
              {' · '}Chênh bán: <b className="tabular-nums text-emerald-600">{pctText(chenhBan)}</b>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line bg-appbg/40 px-3 py-2.5 text-sm text-slate-400">Chọn TID, loại thẻ và loại phí để xem biểu phí đã cài.</div>
          )}
        </div>
        {/* (7) Số tiền — #5 hiển thị NHÓM NGHÌN kiểu VN (5.000.000); lưu số trần qua replace. */}
        <Field label="Số tiền giao dịch (VND)" required><input className={inputCls + ' text-right tabular-nums'} inputMode="numeric" value={groupDigits(amount)} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" /></Field>
        {/* (8) Ngày · (9) Giờ (#8 mặc định giờ hiện tại, cho sửa). */}
        <Field label="Ngày giao dịch" required><input type="date" className={inputCls} value={txnDate} onChange={(e) => setTxnDate(e.target.value)} /></Field>
        <Field label="Giờ giao dịch" required hint="Mặc định giờ hiện tại — sửa nếu cần"><input type="time" className={inputCls} value={txnTime} onChange={(e) => setTxnTime(e.target.value)} /></Field>
        {/* (10) Khách hàng — #7 TỰ liên kết theo TID (read-only), KHÔNG chọn tay. */}
        <Field label="Khách hàng (theo TID)" hint="Người được giao TID"><input className={inputCls + ' bg-slate-50 text-slate-600'} readOnly value={!selectedTid ? '' : (selectedTid.customerName ?? 'TID chưa giao khách')} placeholder="Chọn TID trước" /></Field>
        <Field label="Ghi chú"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      {selectedTid && !selectedTid.partnerId && <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">TID này chưa gán Đối tác — không tra được biểu phí. Hãy cấu hình TID trước.</div>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Ghi nhận</Button>
      </div>
    </Modal>
  );
}
