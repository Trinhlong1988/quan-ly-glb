import { useEffect, useState } from 'react';
import { Plus, Loader2, CreditCard, Link2, RefreshCw, Undo2, PackageCheck, Send, Download, History, Tag, Trophy, FilterX, Percent, Trash2, Banknote, Pencil, PackageOpen } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, hasAnyPermission, fmtDate } from '@glb/shared';
import type { TidDto, UndeliveredTidDto, PosDto, CustomerDto, FundDto, TidRefs, TimelineEventDto, CreateTidInput, ConfigTidInput, TidRevenueRankRow, TidSellFeeRowDto, FeeTypeDto, HandoverTypeLite } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { isStaleWrite, STALE_TITLE } from '../lib/optlock.js';
import { Modal } from '../components/Modal.js';
import { Button } from '../components/Button.js';
import { StatusPill, statusLabel, statusTone } from '../components/StatusPill.js';
import { MONEY_KIND_LABEL } from './HandoverConfigPage.js';
import { StatBar } from '../components/StatBar.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';
import { StaleBanner } from '../lib/realtime.js';
import { ImportButton } from '../components/ImportModal.js';
import { RequestCancelModal, BulkRequestCancelModal, type RequestCancelTarget } from '../components/RequestCancelModal.js';
import { useRowSelection, SelectionBar, SelectAllCell, SelectCell } from '../components/Selection.js';
import { usePagination } from '../components/Pagination.js';
import { exportCsv } from '../lib/exportCsv.js';
import { StatusTab, FeePreview } from './TidConfigPage.js';
import { TabBar, TabButton } from '../components/Tabs.js';
// PHASE 3 — tab "Yêu cầu xuất kho TID" (tạo phiếu TID chưa seri → duyệt sau).
import { ExportRequestPanel } from '../components/ExportRequestPanel.js';

const TID_STATUSES = ['UNASSIGNED', 'ACTIVE', 'DEAD', 'CLOSED', 'RECALLED'];
type Tab = 'all' | 'undelivered' | 'exportreq' | 'status' | 'ranking';

/** VND, nhóm 3 số bằng dấu chấm (KHÔNG toLocaleString — R_UI QA gate). Giữ dấu âm. Đồng bộ RevenuePage. */
function money(n: number): string {
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '−' : '') + s + 'đ';
}

export function TidPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const canView = hasPermission(user, 'TID_VIEW') || hasPermission(user, 'CONFIG_TID_VIEW');
  const canOps = hasPermission(user, 'TID_MANAGE'); // gán/đổi/thu hồi/giao (vận hành)
  const canConfig = hasPermission(user, 'CONFIG_TID_MANAGE'); // thêm/sửa/xóa cấu hình
  const canConfigView = hasPermission(user, 'CONFIG_TID_VIEW');
  const canRevenue = hasPermission(user, 'REVENUE_VIEW'); // #13: tab xếp hạng doanh số (dữ liệu tài chính)
  const canCancelReq = hasPermission(user, 'TID_CANCEL_REQUEST'); // R34: yêu cầu hủy (xóa mềm qua duyệt)
  const canSell = hasPermission(user, 'DEVICE_SALE_MANAGE'); // Bán TID rời (doanh thu — quyền tiền, không dùng TID_MANAGE)
  const canExportReq = hasAnyPermission(user, ['EXPORT_REQUEST_VIEW', 'EXPORT_REQUEST_CREATE']); // PHASE 3 — yêu cầu xuất kho TID

  const [tab, setTab] = useState<Tab>('all');
  const [rows, setRows] = useState<TidDto[]>([]);
  const [undelivered, setUndelivered] = useState<UndeliveredTidDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assignFilter, setAssignFilter] = useState(''); // '', 'yes', 'no'
  const [deliverFilter, setDeliverFilter] = useState('');
  const [industryFilter, setIndustryFilter] = useState(''); // LANE A (#11) — lọc theo ngành nghề (industryId)
  const [industries, setIndustries] = useState<{ id: number; code: string; name: string }[]>([]);
  const [holdingCustomerFilter, setHoldingCustomerFilter] = useState(''); // Mr.Long 12/7 — lọc theo khách hàng đang giữ
  const [dossierSourceFilter, setDossierSourceFilter] = useState(''); // Mr.Long 12/7 — lọc theo nguồn hồ sơ
  const [custOpts, setCustOpts] = useState<{ id: number; label: string }[]>([]);
  const [dossierSourceOpts, setDossierSourceOpts] = useState<{ id: number; label: string }[]>([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [deliveredFrom, setDeliveredFrom] = useState(''); // #14 "Kỳ giao" (deliveredAt) từ ngày
  const [deliveredTo, setDeliveredTo] = useState(''); // #14 "Kỳ giao" (deliveredAt) đến ngày
  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState<{ tid: TidDto; kind: 'assign' | 'replace' | 'recall' | 'deliver' } | null>(null);
  const [timelineTid, setTimelineTid] = useState<TidDto | null>(null);
  const [sellFeeTid, setSellFeeTid] = useState<TidDto | null>(null); // R30: phí bán thực tế theo TID × thẻ
  const [cancelTarget, setCancelTarget] = useState<RequestCancelTarget | null>(null); // R34: yêu cầu hủy TID
  const [editTid, setEditTid] = useState<TidDto | null>(null); // Nhóm 1: sửa full thông tin TID
  const [bulkCancel, setBulkCancel] = useState(false); // Nhóm 1: yêu cầu hủy hàng loạt (qua Duyệt Hủy)
  const [sellTidTarget, setSellTidTarget] = useState<TidDto | null>(null); // Bán TID rời (chưa gắn máy, chưa giao)
  const sel = useRowSelection();
  // Mr.Long 14/7 — lọc TID theo CÀI APP (ngân hàng của TID), client-side, đồng bộ như danh sách máy POS.
  const [bankFilter, setBankFilter] = useState('');
  const tidBankOptions = (() => {
    const m = new Map<number, string>();
    for (const t of rows) if (t.bankId != null && !m.has(t.bankId)) m.set(t.bankId, t.bankCode ?? t.bankName ?? `NH #${t.bankId}`);
    return [...m.entries()].map(([id, label]) => ({ value: String(id), label }));
  })();
  // Mr.Long 14/7 — phân trang 50 dòng/trang cho danh sách TID (tab "all"/"chưa giao"), >50 sang trang 2.
  const tidDisplay = (tab === 'all' ? rows : undelivered).filter((t) => !bankFilter || String((t as TidDto).bankId ?? '') === bankFilter);
  const { pageRows: tidPageRows, bar: tidBar } = usePagination(tidDisplay, 50);

  async function reload(): Promise<void> {
    setLoading(true);
    if (tab === 'undelivered') {
      const res = await window.api.tidUndelivered();
      if (res.ok && res.data) setUndelivered(res.data);
      else if (res.message) toast.alert(res.message);
    } else if (tab === 'all') {
      const res = await window.api.tidList({
        search: search || undefined,
        status: statusFilter || undefined,
        deviceAssigned: assignFilter ? assignFilter === 'yes' : undefined,
        delivered: deliverFilter ? deliverFilter === 'yes' : undefined,
        industryId: industryFilter ? Number(industryFilter) : undefined,
        holdingCustomerId: holdingCustomerFilter ? Number(holdingCustomerFilter) : undefined,
        dossierSourceId: dossierSourceFilter ? Number(dossierSourceFilter) : undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        deliveredFrom: deliveredFrom || undefined,
        deliveredTo: deliveredTo || undefined
      });
      if (res.ok && res.data) setRows(res.data);
      else if (res.message) toast.alert(res.message);
      sel.clear();
    }
    setLoading(false);
  }
  useEffect(() => {
    if (tab !== 'status' && tab !== 'ranking' && tab !== 'exportreq') void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusFilter, assignFilter, deliverFilter, industryFilter, holdingCustomerFilter, dossierSourceFilter, deliveredFrom, deliveredTo]);

  // LANE A (#11): nạp danh sách ngành nghề (active) cho bộ lọc — dùng tidRefs (không cần quyền ngành nghề).
  useEffect(() => {
    if (canView) window.api.tidRefs().then((r) => r.ok && r.data && setIndustries(r.data.industries));
  }, [canView]);

  // Mr.Long 12/7 — nạp khách hàng (đang giữ) + nguồn hồ sơ cho 2 bộ lọc mới (rỗng nếu thiếu quyền — graceful).
  useEffect(() => {
    if (!canView) return;
    window.api.customerList({}).then((r) => r.ok && r.data && setCustOpts(r.data.map((c) => ({ id: c.id, label: `${c.code} · ${c.nickname}` }))));
    window.api.dossierSourceList().then((r) => r.ok && r.data && setDossierSourceOpts(r.data.map((s) => ({ id: s.id, label: s.code }))));
  }, [canView]);

  function resetFilters(): void {
    setSearch('');
    setStatusFilter('');
    setAssignFilter('');
    setDeliverFilter('');
    setIndustryFilter('');
    setHoldingCustomerFilter('');
    setDossierSourceFilter('');
    setFromDate('');
    setToDate('');
    setDeliveredFrom('');
    setDeliveredTo('');
    setTimeout(reload, 0);
  }

  function actionsFor(t: TidDto): { kind: 'assign' | 'replace' | 'recall' | 'deliver'; label: string; icon: JSX.Element }[] {
    const a: { kind: 'assign' | 'replace' | 'recall' | 'deliver'; label: string; icon: JSX.Element }[] = [];
    // Gán máy: khi CHƯA gán (posSerial=null) và còn sống (không DEAD/CLOSED/RECALLED).
    if (!t.deviceAssigned && ['UNASSIGNED', 'ACTIVE'].includes(t.status)) a.push({ kind: 'assign', label: 'Gán máy POS', icon: <Link2 className="h-3.5 w-3.5" /> });
    if (t.status === 'ACTIVE') a.push({ kind: 'replace', label: 'Đổi TID', icon: <RefreshCw className="h-3.5 w-3.5" /> });
    // Giao khách: khi CHƯA giao và còn sống.
    if (!t.delivered && ['UNASSIGNED', 'ACTIVE'].includes(t.status)) a.push({ kind: 'deliver', label: 'Giao cho khách', icon: <PackageCheck className="h-3.5 w-3.5" /> });
    if (['ACTIVE', 'DEAD', 'CLOSED'].includes(t.status)) a.push({ kind: 'recall', label: 'Thu hồi', icon: <Undo2 className="h-3.5 w-3.5" /> });
    return a;
  }

  const assignedCount = rows.filter((t) => t.deviceAssigned).length;
  const deliveredCount = rows.filter((t) => t.delivered).length;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Quản Lý TID</h2>
          <p className="text-sm text-slate-500">Terminal ID · 2 chiều độc lập: Gán máy POS · Giao cho khách · vòng đời + timeline TID.</p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'undelivered' && (
            <button onClick={() => void reload()} title="Tải lại dữ liệu mới nhất (giữ nguyên bộ lọc)" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-brand/10 text-brand hover:bg-brand/20">
              <RefreshCw className="h-4 w-4" /> Làm mới
            </button>
          )}
          {tab === 'all' && (
            <Button
              variant="confirm"
              icon={<Download className="h-4 w-4" />}
              onClick={() =>
                exportCsv(
                  'tid',
                  ['TID', 'MID', 'HKD', 'Ngân hàng', 'Ngành nghề', 'Đối tác', 'Gán máy POS', 'Giao cho khách', 'Khách hàng đang giữ', 'Vòng đời'],
                  rows.map((t) => [t.tid, t.mid ?? '', t.hkdName ?? '', t.bankCode ?? t.bank ?? '', t.industryName ?? '', t.partnerName ?? '', t.deviceAssigned ? (t.posSerial ?? 'Đã gán') : (t.customerDeviceSerial ? 'Máy khách' : 'Chưa gán'), t.delivered ? 'Đã giao' : 'Chưa giao', t.holdingCustomerName ?? '', statusLabel(t.status)])
                )
              }
            >
              Xuất Excel
            </Button>
          )}
          {tab === 'all' && canConfig && <ImportButton entityKey="tid" label="TID" onImported={reload} />}
          {tab === 'all' && canConfig && (
            <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Thêm TID
            </Button>
          )}
        </div>
      </div>

      <TabBar>
        <TabButton active={tab === 'all'} onClick={() => setTab('all')} icon={<CreditCard className="h-4 w-4" />}>
          Danh sách TID
        </TabButton>
        <TabButton active={tab === 'undelivered'} onClick={() => setTab('undelivered')} icon={<PackageCheck className="h-4 w-4" />}>
          TID chưa giao {undelivered.length > 0 && <span className="ml-1 rounded-full bg-danger px-1.5 text-xs text-white">{undelivered.length}</span>}
        </TabButton>
        {canExportReq && (
          <TabButton active={tab === 'exportreq'} onClick={() => setTab('exportreq')} icon={<PackageOpen className="h-4 w-4" />}>
            Yêu cầu xuất kho TID
          </TabButton>
        )}
        {canRevenue && (
          <TabButton active={tab === 'ranking'} onClick={() => setTab('ranking')} icon={<Trophy className="h-4 w-4" />}>
            Xếp hạng doanh số
          </TabButton>
        )}
        {canConfigView && (
          <TabButton active={tab === 'status'} onClick={() => setTab('status')} icon={<Tag className="h-4 w-4" />}>
            Trạng thái TID cấu hình
          </TabButton>
        )}
      </TabBar>

      {tab === 'status' && <StatusTab canManage={canConfig} />}
      {tab === 'ranking' && <RevenueRankingTab />}
      {tab === 'exportreq' && <ExportRequestPanel user={user} kind="TID" />}

      {/* 2 nhóm StatBar theo 2 chiều độc lập (§3.4). Đếm CLIENT từ tidList (trả full). */}
      {tab === 'all' && (
        <>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Gán máy POS</div>
          <StatBar
            items={[
              { label: 'Đã gán máy', value: assignedCount, tone: statusTone('ACTIVE') },
              { label: 'Chưa gán máy', value: rows.length - assignedCount, tone: statusTone('UNASSIGNED') }
            ]}
          />
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Giao cho khách</div>
          <StatBar
            items={[
              { label: 'Đã giao', value: deliveredCount, tone: statusTone('ACTIVE') },
              { label: 'Chưa giao', value: rows.length - deliveredCount, tone: statusTone('UNASSIGNED') }
            ]}
          />
          {/* Mr.Long 14/7 — bộ đếm TID theo CÀI APP (ngân hàng). Đếm CLIENT từ rows (trả full). */}
          {tidBankOptions.length > 0 && (
            <>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Cài APP (ngân hàng)</div>
              <div className="mb-3 flex flex-wrap gap-2">
                {tidBankOptions.map((b) => (
                  <span key={b.value} className="rounded-full border border-line bg-white px-3 py-1 text-xs text-slate-600">
                    {b.label}: <b className="text-brand">{rows.filter((t) => String(t.bankId ?? '') === b.value).length}</b>
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'all' && (
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Tìm TID / MID / HKD…"
          fromDate={fromDate}
          toDate={toDate}
          onFromDate={setFromDate}
          onToDate={setToDate}
          selects={[
            { key: 'bankapp', placeholder: 'Cài APP (tất cả ngân hàng)', value: bankFilter, options: tidBankOptions, onChange: setBankFilter },
            { key: 'assign', placeholder: 'Gán máy POS (tất cả)', value: assignFilter, options: [{ value: 'yes', label: 'Đã gán máy' }, { value: 'no', label: 'Chưa gán máy' }], onChange: setAssignFilter },
            { key: 'deliver', placeholder: 'Giao cho khách (tất cả)', value: deliverFilter, options: [{ value: 'yes', label: 'Đã giao' }, { value: 'no', label: 'Chưa giao' }], onChange: setDeliverFilter },
            { key: 'industry', placeholder: 'Ngành nghề (tất cả)', value: industryFilter, options: industries.map((i) => ({ value: String(i.id), label: `${i.code} · ${i.name}` })), onChange: setIndustryFilter },
            { key: 'holding', placeholder: 'Khách hàng giữ (tất cả)', value: holdingCustomerFilter, options: custOpts.map((c) => ({ value: String(c.id), label: c.label })), onChange: setHoldingCustomerFilter },
            { key: 'dsource', placeholder: 'Nguồn hồ sơ (tất cả)', value: dossierSourceFilter, options: dossierSourceOpts.map((s) => ({ value: String(s.id), label: s.label })), onChange: setDossierSourceFilter },
            { key: 'status', placeholder: 'Tất cả trạng thái', value: statusFilter, options: TID_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })), onChange: setStatusFilter }
          ]}
          onApply={reload}
          onReset={resetFilters}
        />
      )}

      {/* #14 "Kỳ giao" — bộ lọc khoảng ngày giao (deliveredAt), áp dụng ngay khi chọn (useEffect). */}
      {tab === 'all' && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Kỳ giao</span>
          <span className="text-xs">Từ</span>
          <input type="date" className={inputCls} value={deliveredFrom} onChange={(e) => setDeliveredFrom(e.target.value)} />
          <span className="text-xs">đến</span>
          <input type="date" className={inputCls} value={deliveredTo} onChange={(e) => setDeliveredTo(e.target.value)} />
          {(deliveredFrom || deliveredTo) && (
            <button
              onClick={() => {
                setDeliveredFrom('');
                setDeliveredTo('');
              }}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-brand hover:bg-brand/10"
            >
              <FilterX className="h-3.5 w-3.5" /> Bỏ kỳ giao
            </button>
          )}
        </div>
      )}

      {/* StatBar tab "TID chưa giao" — đếm CLIENT theo số ngày tồn (agingDays) từ tidUndelivered. */}
      {tab === 'undelivered' && (
        <StatBar
          items={[
            { label: 'Tổng chưa giao', value: undelivered.length, tone: 'bg-brand-tint text-brand' },
            { label: 'Tồn ≥ 30 ngày', value: undelivered.filter((u) => u.agingDays >= 30).length, tone: 'bg-rose-50 text-rose-600' },
            { label: 'Tồn 14–29 ngày', value: undelivered.filter((u) => u.agingDays >= 14 && u.agingDays < 30).length, tone: 'bg-amber-50 text-amber-600' },
            { label: 'Tồn dưới 14 ngày', value: undelivered.filter((u) => u.agingDays < 14).length, tone: 'bg-emerald-50 text-emerald-600' }
          ]}
        />
      )}

      {tab === 'all' && canCancelReq && <SelectionBar count={sel.count} entityLabel="TID" onClear={sel.clear} onDelete={() => setBulkCancel(true)} actionLabel={`Yêu cầu hủy (${sel.count})`} />}
      {(tab === 'all' || tab === 'undelivered') && <StaleBanner domain="Tid" onReload={reload} className="mb-2" />}
      {(tab === 'all' || tab === 'undelivered') && (
        <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {tab === 'all' && canCancelReq && <SelectAllCell ids={(tidPageRows as TidDto[]).map((r) => r.id)} sel={sel} />}
                <th className="px-4 py-3 whitespace-nowrap">TID</th>
                <th className="px-4 py-3 whitespace-nowrap">HKD</th>
                <th className="px-4 py-3 whitespace-nowrap">Ngân hàng</th>
                <th className="px-4 py-3 whitespace-nowrap">Ngành nghề</th>
                <th className="px-4 py-3 whitespace-nowrap">Gán máy POS</th>
                <th className="px-4 py-3 whitespace-nowrap">Giao cho khách</th>
                <th className="px-4 py-3 whitespace-nowrap">Khách hàng đang giữ</th>
                <th className="px-4 py-3 whitespace-nowrap">Trạng thái</th>
                {tab === 'undelivered' && <th className="px-4 py-3 whitespace-nowrap">Số ngày tồn</th>}
                {(tab === 'all' || tab === 'undelivered') && <th className="px-4 py-3 text-right whitespace-nowrap">Thao tác</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading && (
                <tr>
                  <td colSpan={tab === 'undelivered' ? 10 : 9 + (canCancelReq ? 1 : 0)} className="px-4 py-8 text-center text-slate-400">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              )}
              {!loading && tab === 'all' && rows.length === 0 && (
                <tr>
                  <td colSpan={9 + (canCancelReq ? 1 : 0)} className="px-4 py-10 text-center text-slate-400">
                    <CreditCard className="mx-auto mb-2 h-6 w-6" />
                    Chưa có TID.
                  </td>
                </tr>
              )}
              {!loading && tab === 'undelivered' && undelivered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                    <PackageCheck className="mx-auto mb-2 h-6 w-6" />
                    Không có TID nào chưa giao. 🎉
                  </td>
                </tr>
              )}
              {!loading && (tidPageRows as (TidDto | UndeliveredTidDto)[]).map((t) => (
                <tr key={t.id} className={(tab === 'undelivered' && (t as UndeliveredTidDto).agingDays >= 30 ? 'bg-danger/5 ' : 'hover:bg-appbg/60 ') + (tab === 'all' && sel.isSelected(t.id) ? 'bg-brand-tint/40' : '')}>
                  {tab === 'all' && canCancelReq && <SelectCell id={t.id} sel={sel} />}
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">{t.tid}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{t.hkdName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{t.bankCode ?? t.bank ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{t.industryName ?? '—'}</td>
                  <td className="px-4 py-3">
                    <AssignCell t={t} />
                  </td>
                  <td className="px-4 py-3">
                    <DeliverCell t={t} />
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{t.holdingCustomerName ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={t.status} />
                  </td>
                  {tab === 'undelivered' && (
                    <td className="px-4 py-3">
                      <span className={'font-semibold ' + ((t as UndeliveredTidDto).agingDays >= 30 ? 'text-danger' : (t as UndeliveredTidDto).agingDays >= 14 ? 'text-warning' : 'text-slate-600')}>
                        {(t as UndeliveredTidDto).agingDays} ngày
                      </span>
                    </td>
                  )}
                  {(tab === 'all' || tab === 'undelivered') && (
                    <td className="px-4 py-3">
                      {/* Mr.Long 12/7 — nút thao tác ICON-ONLY (tooltip) cho gọn: cột Thao tác không còn chiếm nhiều
                          chỗ, nhường bề ngang cho dữ liệu (TID/HKD/Khách giữ hiển thị đủ 1 hàng). */}
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setTimelineTid(t)} title="Vòng đời TID" className="rounded-md border border-line p-1.5 text-slate-600 hover:bg-appbg hover:brightness-110">
                          <History className="h-4 w-4" />
                        </button>
                        {tab === 'all' && canConfig && (
                          <button onClick={() => setEditTid(t)} title="Sửa thông tin TID" className="rounded-md border border-warning/40 bg-warning/5 p-1.5 text-warning hover:brightness-110">
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {canOps && (
                          <button onClick={() => setSellFeeTid(t)} className="rounded-md border border-brand/30 bg-brand/5 p-1.5 text-brand hover:brightness-110" title="Phí bán thực tế theo loại thẻ (thỏa thuận khi giao)">
                            <Percent className="h-4 w-4" />
                          </button>
                        )}
                        {canSell && !t.deviceAssigned && !t.delivered && ['UNASSIGNED', 'ACTIVE'].includes(t.status) && (
                          <button onClick={() => setSellTidTarget(t)} title="Bán TID rời (chưa gắn máy)" className="rounded-md border border-emerald-300 bg-emerald-50 p-1.5 text-emerald-700 hover:brightness-110">
                            <Banknote className="h-4 w-4" />
                          </button>
                        )}
                        {canOps &&
                          actionsFor(t).map((a) => {
                            // R33: mỗi thao tác 1 sắc thái riêng để phân biệt rõ (không còn xám giống nhau).
                            const tone =
                              a.kind === 'assign' || a.kind === 'deliver'
                                ? 'border-brand/30 bg-brand/5 text-brand font-semibold'
                                : a.kind === 'recall'
                                  ? 'border-warning/30 bg-warning/5 text-warning font-semibold'
                                  : 'border-line text-slate-600 hover:bg-appbg';
                            return (
                              <button
                                key={a.kind}
                                onClick={() => setAction({ tid: t, kind: a.kind })}
                                title={a.label}
                                className={'rounded-md border p-1.5 hover:brightness-110 ' + tone}
                              >
                                {a.icon}
                              </button>
                            );
                          })}
                        {canCancelReq && (
                          <button
                            onClick={() => setCancelTarget({ entityType: 'Tid', entityId: t.id, entityLabel: t.tid, typeLabel: 'TID' })}
                            title="Yêu cầu hủy"
                            className="rounded-md border border-danger/30 bg-danger/5 p-1.5 text-danger hover:brightness-110"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {tidBar}
        </div>
      )}

      {creating && (
        <TidCreateForm
          canOps={canOps}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await reload();
          }}
        />
      )}
      {action && (
        <TidActionModal
          tid={action.tid}
          kind={action.kind}
          onClose={() => setAction(null)}
          onDone={async () => {
            setAction(null);
            await reload();
          }}
          onOpenSell={
            canSell
              ? () => {
                  const t = action.tid;
                  setAction(null);
                  setSellTidTarget(t);
                }
              : undefined
          }
        />
      )}
      {timelineTid && <TidTimelineModal tid={timelineTid} onClose={() => setTimelineTid(null)} />}
      {sellFeeTid && (
        <TidSellFeeModal
          tid={sellFeeTid}
          onClose={() => setSellFeeTid(null)}
          onSaved={() => setSellFeeTid(null)}
        />
      )}
      {cancelTarget && (
        <RequestCancelModal
          target={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={() => {
            setCancelTarget(null);
            void reload();
          }}
        />
      )}
      {sellTidTarget && (
        <SellTidModal
          tid={sellTidTarget}
          onClose={() => setSellTidTarget(null)}
          onDone={async () => {
            setSellTidTarget(null);
            await reload();
          }}
        />
      )}
      {editTid && (
        <TidEditForm
          tid={editTid}
          onClose={() => setEditTid(null)}
          onSaved={async () => {
            setEditTid(null);
            await reload();
          }}
        />
      )}
      {bulkCancel && (
        <BulkRequestCancelModal
          entityType="Tid"
          ids={[...sel.selected]}
          typeLabel="TID"
          onClose={() => setBulkCancel(false)}
          onDone={() => {
            setBulkCancel(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}

/** Nhóm 1 — Sửa FULL thông tin TID (cấu hình): HKD/đối tác/ngân hàng/ngành nghề/MID/ghi chú/ngày cấp/máy
 *  khách. Chuỗi TID = định danh (khóa join event-log) → CHỈ ĐỌC. Vận hành (gán/giao/thu hồi) qua nút riêng. */
function TidEditForm({ tid, onClose, onSaved }: { tid: TidDto; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [refs, setRefs] = useState<TidRefs | null>(null);
  const [dossierId, setDossierId] = useState(tid.dossierId ? String(tid.dossierId) : '');
  const [hkdName, setHkdName] = useState(tid.hkdName ?? '');
  const [partnerId, setPartnerId] = useState(tid.partnerId ? String(tid.partnerId) : '');
  const [bankId, setBankId] = useState(tid.bankId ? String(tid.bankId) : '');
  const [industryId, setIndustryId] = useState(tid.industryId ? String(tid.industryId) : '');
  const [mid, setMid] = useState(tid.mid ?? '');
  const [issuedAt, setIssuedAt] = useState(tid.issuedAt ? tid.issuedAt.slice(0, 10) : '');
  const [customerDeviceSerial, setCustomerDeviceSerial] = useState(tid.customerDeviceSerial ?? '');
  const [note, setNote] = useState(tid.note ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.tidRefs().then((r) => r.ok && r.data && setRefs(r.data));
  }, []);

  // Ngân hàng lọc theo liên kết đối tác (PartnerBank) — nhất quán form Thêm TID.
  const linkedBankIds = partnerId && refs ? refs.partnerBanks[Number(partnerId)] ?? [] : [];
  const linkedBanks = refs ? refs.banks.filter((b) => linkedBankIds.includes(b.id)) : [];

  function onPickDossier(id: string): void {
    setDossierId(id);
    const d = refs?.dossiers.find((x) => String(x.id) === id);
    if (d) setHkdName(d.hkdName);
  }

  async function save(): Promise<void> {
    if (!partnerId) return toast.alert('Vui lòng chọn đối tác.', 'Thiếu thông tin');
    if (!bankId) return toast.alert('Vui lòng chọn ngân hàng.', 'Thiếu thông tin');
    if (!hkdName.trim()) return toast.alert('Tên Hộ Kinh Doanh bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const input: ConfigTidInput = {
      tid: tid.tid, // định danh — server giữ nguyên (không đổi qua form này)
      partnerId: Number(partnerId),
      bankId: Number(bankId),
      hkdName: hkdName.trim(),
      industryId: industryId ? Number(industryId) : null,
      mid: mid.trim() || null,
      issuedAt: issuedAt || null,
      dossierId: dossierId ? Number(dossierId) : null,
      customerDeviceSerial: customerDeviceSerial.trim() || null,
      note: note.trim() || null
    };
    const res = await window.api.tidConfigUpdate(tid.id, input);
    setBusy(false);
    if (res.ok) { toast.success(`Đã cập nhật TID ${tid.tid}`); onSaved(); }
    else if (isStaleWrite(res)) { toast.alert(res.message ?? 'Bản ghi đã được người khác cập nhật, vui lòng mở lại.', STALE_TITLE); onSaved(); }
    else toast.alert(res.message ?? 'Cập nhật TID thất bại', 'Không lưu được');
  }

  return (
    <Modal title={`Sửa TID ${tid.tid}`} onClose={onClose} width="max-w-2xl">
      {!refs && <div className="py-6 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>}
      {refs && (
        <>
          <div className="mb-2 rounded-md bg-appbg px-3 py-2 text-xs text-slate-500">
            Chuỗi TID <b className="font-mono text-slate-700">{tid.tid}</b> là định danh cố định — không sửa ở đây. Gán máy / giao khách / thu hồi đổi qua nút thao tác riêng.
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Hộ Kinh Doanh (HKD)" hint="Chọn để tự điền tên + gắn hồ sơ">
              <select className={inputCls} value={dossierId} onChange={(e) => onPickDossier(e.target.value)}>
                <option value="">— Chọn HKD —</option>
                {refs.dossiers.map((d) => <option key={d.id} value={d.id}>{d.hkdName}{d.ownerName ? ` · ${d.ownerName}` : ''}</option>)}
              </select>
            </Field>
            <Field label="Tên Hộ Kinh Doanh" required>
              <input className={inputCls} value={hkdName} onChange={(e) => setHkdName(e.target.value)} />
            </Field>
            <Field label="Đối tác" required>
              <select className={inputCls} value={partnerId} onChange={(e) => { setPartnerId(e.target.value); setBankId(''); }}>
                <option value="">— Chọn đối tác —</option>
                {refs.partners.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
              </select>
            </Field>
            <Field label="Ngân hàng" required hint="Lọc theo liên kết đối tác ↔ ngân hàng">
              <select className={inputCls} value={bankId} onChange={(e) => setBankId(e.target.value)}>
                <option value="">— Chọn ngân hàng —</option>
                {(partnerId ? linkedBanks : refs.banks).map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select>
            </Field>
            <Field label="Ngành nghề" hint="Theo ĐKKD của HKD">
              <select className={inputCls} value={industryId} onChange={(e) => setIndustryId(e.target.value)}>
                <option value="">— Không chọn —</option>
                {refs.industries.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
              </select>
            </Field>
            <Field label="Chuỗi MID">
              <input className={inputCls} value={mid} onChange={(e) => setMid(e.target.value)} />
            </Field>
            <Field label="Ngày cấp TID">
              <input type="date" className={inputCls} value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
            </Field>
            <Field label="Serial máy của khách" hint="Tùy chọn — tra cứu, không tạo máy trong kho">
              <input className={inputCls} value={customerDeviceSerial} onChange={(e) => setCustomerDeviceSerial(e.target.value)} />
            </Field>
            <div className="col-span-2">
              <Field label="Ghi chú">
                <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose}>Hủy</Button>
            <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Lưu thay đổi</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Bán TID rời (chưa gắn máy). Form tiền + mật khẩu xác nhận. Không có trường kho (TID không phải thiết bị vật lý). */
function SellTidModal({ tid, onClose, onDone }: { tid: TidDto; onClose: () => void; onDone: () => void }): JSX.Element {
  const toast = useToast();
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [funds, setFunds] = useState<FundDto[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [paidNow, setPaidNow] = useState('');
  const [fundId, setFundId] = useState('');
  const [method, setMethod] = useState('CASH');
  const [occurredAt, setOccurredAt] = useState('');
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.customerList({}).then((r) => r.ok && r.data && setCustomers(r.data));
    window.api.fundList({}).then((r) => r.ok && r.data && setFunds(r.data.filter((f) => f.active)));
  }, []);

  const price = Number(salePrice) || 0;
  const paid = Number(paidNow) || 0;
  const remaining = Math.max(0, price - paid);

  async function submit(): Promise<void> {
    if (!customerId) return toast.alert('Phải chọn khách mua.', 'Thiếu thông tin');
    if (!(price > 0)) return toast.alert('Giá bán phải > 0.', 'Số tiền không hợp lệ');
    if (paid < 0 || paid > price) return toast.alert('Số tiền thu phải từ 0 đến giá bán.', 'Số tiền không hợp lệ');
    if (paid > 0 && !fundId) return toast.alert('Có thu tiền thì phải chọn quỹ nhận.', 'Thiếu quỹ');
    if (!password) return toast.alert('Nhập mật khẩu để xác nhận bán TID.', 'Cần mật khẩu');
    setBusy(true);
    const res = await window.api.deviceSellTid(tid.tid, {
      customerId: Number(customerId), salePrice: price, paidNow: paid,
      fundId: fundId ? Number(fundId) : null, method,
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : null, note: note || null
    }, password);
    setBusy(false);
    if (res.ok) { toast.success(`Đã bán TID ${tid.tid}`); onDone(); }
    else toast.alert(res.message ?? 'Bán TID thất bại', 'Không bán được');
  }

  return (
    <Modal title={`Bán TID ${tid.tid}`} onClose={onClose} width="max-w-lg">
      <div className="mb-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
        TID sẽ chuyển <b>ĐÃ BÁN</b> sang khách mua. Doanh thu ghi nhận đủ giá ngay; phần chưa thu thành công nợ mua thiết bị.
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Khách mua" required>
          <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)} autoFocus>
            <option value="">— Chọn khách —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.display}</option>)}
          </select>
        </Field>
        <Field label="Giá bán (VND)" required>
          <input className={inputCls + ' text-right tabular-nums'} inputMode="numeric" value={salePrice} onChange={(e) => setSalePrice(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" />
        </Field>
        <Field label="Thu ngay (VND)" hint={`Còn nợ: ${remaining.toLocaleString('vi-VN')}`}>
          <input className={inputCls + ' text-right tabular-nums'} inputMode="numeric" value={paidNow} onChange={(e) => setPaidNow(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" />
        </Field>
        <Field label="Quỹ nhận tiền" hint={paid > 0 ? 'Bắt buộc khi có thu' : 'Không thu thì bỏ trống'}>
          <select className={inputCls} value={fundId} onChange={(e) => setFundId(e.target.value)}>
            <option value="">— Chọn quỹ —</option>
            {funds.map((f) => <option key={f.id} value={f.id}>{f.code} · {f.name}</option>)}
          </select>
        </Field>
        <Field label="Hình thức">
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH">Tiền mặt</option>
            <option value="CK">Chuyển khoản</option>
          </select>
        </Field>
        <Field label="Thời gian bán" hint="Bỏ trống = hiện tại">
          <input type="datetime-local" className={inputCls} value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        </Field>
        <Field label="Ghi chú"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Field label="Mật khẩu xác nhận" required><input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-600 hover:bg-appbg">Hủy</button>
        <button onClick={submit} disabled={busy} className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-105 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Bán TID
        </button>
      </div>
    </Modal>
  );
}

// ── #13 Xếp hạng doanh số theo TID — kỳ mặc định tháng hiện tại + lọc kỳ (tháng khác / from–to) ──
/** yyyy-mm → { from: 'yyyy-mm-01', to: 'yyyy-mm-<lastDay>' }. */
function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate(); // ngày 0 của tháng sau = ngày cuối tháng này
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}
function currentMonthStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function RevenueRankingTab(): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<TidRevenueRankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(currentMonthStr()); // ô chọn tháng (hiển thị + nhanh)
  const [from, setFrom] = useState(''); // kỳ tùy chỉnh — rỗng = dùng mặc định (server tính tháng hiện tại)
  const [to, setTo] = useState('');

  async function load(f?: string, t?: string): Promise<void> {
    setLoading(true);
    const res = await window.api.tidRevenueRanking({ from: f || undefined, to: t || undefined });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    setLoading(false);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyMonth(ym: string): void {
    setMonth(ym);
    if (!ym) return;
    const b = monthBounds(ym);
    setFrom('');
    setTo('');
    void load(b.from, b.to);
  }
  function reset(): void {
    setMonth(currentMonthStr());
    setFrom('');
    setTo('');
    void load();
  }
  const total = rows.reduce((s, r) => s + r.revenue, 0);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Xếp hạng doanh số theo TID {rows.length > 0 && <span className="ml-1 text-slate-500">· {rows.length} TID · tổng {money(total)}</span>}
        </div>
        <Button
          variant="confirm"
          icon={<Download className="h-4 w-4" />}
          onClick={() => exportCsv('xep_hang_doanh_so_tid', ['Hạng', 'Chuỗi TID', 'HKD', 'Khách', 'Ngành nghề', 'Doanh số', 'Hoạt động'], rows.map((r) => [r.rank, r.tid, r.hkdName ?? '', r.customerName ?? '', r.industryName ?? '', money(r.revenue), r.active ? 'Đang hoạt động' : 'Ngừng']))}
        >
          Xuất Excel
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Kỳ</span>
        <input type="month" className={inputCls} value={month} onChange={(e) => applyMonth(e.target.value)} />
        <span className="text-xs">hoặc từ</span>
        <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-xs">đến</span>
        <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        <button onClick={() => load(from, to)} className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-hover">
          Lọc
        </button>
        <button onClick={reset} title="Về kỳ mặc định (tháng hiện tại)" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-brand/10 text-brand hover:bg-brand/20">
          <FilterX className="h-4 w-4" /> Xóa lọc
        </button>
        <button onClick={() => void load(from, to)} title="Tải lại dữ liệu mới nhất (giữ nguyên bộ lọc)" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-brand/10 text-brand hover:bg-brand/20">
          <RefreshCw className="h-4 w-4" /> Làm mới
        </button>
      </div>

      {/* StatBar tab "Xếp hạng doanh số" — đếm CLIENT từ kết quả kỳ đang xem. */}
      <StatBar
        items={[
          { label: 'Tổng TID', value: rows.length, tone: 'bg-brand-tint text-brand' },
          { label: 'Đang hoạt động', value: rows.filter((r) => r.active).length, tone: 'bg-emerald-50 text-emerald-600' },
          { label: 'Ngừng', value: rows.filter((r) => !r.active).length, tone: 'bg-slate-100 text-slate-500' },
          { label: 'Tổng doanh số', value: money(total), tone: 'bg-brand-tint text-brand' }
        ]}
      />

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Hạng</th>
              <th className="px-4 py-3">Chuỗi TID</th>
              <th className="px-4 py-3">HKD</th>
              <th className="px-4 py-3">Khách</th>
              <th className="px-4 py-3">Ngành nghề</th>
              <th className="px-4 py-3 text-right">Doanh số</th>
              <th className="px-4 py-3">Hoạt động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  <Trophy className="mx-auto mb-2 h-6 w-6" />
                  Chưa có giao dịch nào trong kỳ này.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.tidId} className="hover:bg-appbg/60">
                  <td className="px-4 py-3 font-semibold text-slate-700">{r.rank}</td>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">{r.tid}</td>
                  <td className="px-4 py-3 text-slate-600">{r.hkdName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{r.customerName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{r.industryName ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800 whitespace-nowrap">{money(r.revenue)}</td>
                  <td className="px-4 py-3">
                    {r.active ? (
                      <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">Đang hoạt động</span>
                    ) : (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">Ngừng</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AssignCell({ t }: { t: TidDto }): JSX.Element {
  if (t.deviceAssigned) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-brand-tint px-1.5 py-0.5 text-xs font-medium text-brand">Đã gán máy</span>
        {t.posSerial && <span className="font-mono text-xs text-slate-500 whitespace-nowrap">{t.posSerial}</span>}
      </div>
    );
  }
  if (t.customerDeviceSerial) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">Máy khách</span>
        <span className="font-mono text-xs text-slate-500 whitespace-nowrap">{t.customerDeviceSerial}</span>
      </div>
    );
  }
  return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">Chưa gán máy</span>;
}

function DeliverCell({ t }: { t: TidDto }): JSX.Element {
  if (t.delivered) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">Đã giao</span>
        {t.deliveredAt && <span className="text-xs text-slate-500">{fmtDate(t.deliveredAt)}</span>}
      </div>
    );
  }
  return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">Chưa giao</span>;
}

// ── Form Thêm TID — chuỗi phụ thuộc HKD → đối tác → ngân hàng (PartnerBank) + chế độ gán/giao ──
function TidCreateForm({ canOps, onClose, onSaved }: { canOps: boolean; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [refs, setRefs] = useState<TidRefs | null>(null);
  const [devices, setDevices] = useState<PosDto[]>([]);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [busy, setBusy] = useState(false);

  const [dossierId, setDossierId] = useState('');
  const [hkdName, setHkdName] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [bankId, setBankId] = useState('');
  const [industryId, setIndustryId] = useState(''); // LANE A (#11) — ngành nghề BẮT BUỘC
  const [tid, setTid] = useState('');
  const [mid, setMid] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [note, setNote] = useState('');
  // chế độ gán: 'none' (chưa gán) | 'pos' (máy ta) | 'customer' (máy khách)
  const [assignMode, setAssignMode] = useState<'none' | 'pos' | 'customer'>('none');
  const [posSerial, setPosSerial] = useState('');
  const [customerDeviceSerial, setCustomerDeviceSerial] = useState('');
  const [assignCustomerId, setAssignCustomerId] = useState('');
  // giao khách
  const [deliverNow, setDeliverNow] = useState(false);
  const [deliverCustomerId, setDeliverCustomerId] = useState('');
  const [deliveredAt, setDeliveredAt] = useState('');

  useEffect(() => {
    window.api.tidRefs().then((r) => r.ok && r.data && setRefs(r.data));
    if (canOps) {
      window.api.posList({}).then((r) => r.ok && r.data && setDevices(r.data));
      window.api.customerList({}).then((r) => r.ok && r.data && setCustomers(r.data));
    }
  }, [canOps]);

  // Quy tắc ưu tiên ngân hàng theo PartnerBank (Mr.Long KHÓA): 1 → tự chọn, ≥2 → dropdown, 0 → cảnh báo.
  const linkedBankIds = partnerId && refs ? refs.partnerBanks[Number(partnerId)] ?? [] : [];
  const linkedBanks = refs ? refs.banks.filter((b) => linkedBankIds.includes(b.id)) : [];
  useEffect(() => {
    if (linkedBanks.length === 1) setBankId(String(linkedBanks[0].id));
    else setBankId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);

  function onPickDossier(id: string): void {
    setDossierId(id);
    const d = refs?.dossiers.find((x) => String(x.id) === id);
    if (d) setHkdName(d.hkdName);
  }

  async function save(): Promise<void> {
    if (!tid.trim()) return toast.alert('Chuỗi TID bắt buộc.', 'Thiếu thông tin');
    if (!partnerId) return toast.alert('Vui lòng chọn đối tác.', 'Thiếu thông tin');
    if (!bankId) return toast.alert('Vui lòng chọn ngân hàng.', 'Thiếu thông tin');
    if (!industryId) return toast.alert('Phải chọn ngành nghề khi tạo TID.', 'Thiếu thông tin');
    if (!hkdName.trim()) return toast.alert('Tên Hộ Kinh Doanh bắt buộc (chọn HKD hoặc nhập tay).', 'Thiếu thông tin');
    if (assignMode === 'pos') {
      if (!posSerial) return toast.alert('Chọn máy POS để gán.', 'Thiếu thông tin');
      if (!assignCustomerId) return toast.alert('Chọn khách hàng nhận máy.', 'Thiếu thông tin');
    }
    const wantDeliver = deliverNow;
    const deliverCust = assignMode === 'pos' ? assignCustomerId : deliverCustomerId;
    if (wantDeliver && !deliverCust) return toast.alert('Chọn khách hàng để đánh dấu đã giao.', 'Thiếu thông tin');

    const input: CreateTidInput = {
      tid: tid.trim(),
      mid: mid.trim() || null,
      dossierId: dossierId ? Number(dossierId) : null,
      industryId: Number(industryId),
      hkdName: hkdName.trim(),
      partnerId: Number(partnerId),
      bankId: Number(bankId),
      issuedAt: issuedAt || null,
      note: note.trim() || null,
      customerDeviceSerial: assignMode === 'customer' ? customerDeviceSerial.trim() || null : null,
      assign: assignMode === 'pos' ? { posSerial, customerId: Number(assignCustomerId) } : undefined,
      deliver: wantDeliver ? { deliveredAt: deliveredAt ? new Date(deliveredAt).toISOString() : null, customerId: Number(deliverCust), toAgentId: null } : undefined
    };
    setBusy(true);
    const res = await window.api.tidCreate(input);
    setBusy(false);
    if (res.ok) {
      toast.success(`Đã thêm TID ${tid}`);
      onSaved();
    } else {
      toast.alert(res.message ?? 'Thêm TID thất bại', 'Không lưu được');
    }
  }

  const inStock = devices.filter((d) => d.status === 'IN_STOCK');

  return (
    <Modal title="Thêm TID mới" onClose={onClose} width="max-w-2xl">
      {!refs && (
        <div className="py-6 text-center text-slate-400">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      )}
      {refs && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Hộ Kinh Doanh (HKD)" hint="Chọn để tự điền tên + gắn hồ sơ">
              <select className={inputCls} value={dossierId} onChange={(e) => onPickDossier(e.target.value)} autoFocus>
                <option value="">— Chọn HKD —</option>
                {refs.dossiers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.hkdName}
                    {d.ownerName ? ` · ${d.ownerName}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tên Hộ Kinh Doanh" required hint="Tự điền từ HKD, có thể sửa">
              <input className={inputCls} value={hkdName} onChange={(e) => setHkdName(e.target.value)} />
            </Field>
            <Field label="Đối tác" required>
              <select className={inputCls} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">— Chọn đối tác —</option>
                {refs.partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ngân hàng" required hint="Lọc theo liên kết đối tác ↔ ngân hàng">
              {partnerId && linkedBanks.length === 0 ? (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-slate-600">Đối tác này chưa liên kết ngân hàng nào (cấu hình ở Cấu hình ngân hàng → Đối tác).</div>
              ) : (
                <select className={inputCls} value={bankId} onChange={(e) => setBankId(e.target.value)} disabled={linkedBanks.length === 1}>
                  <option value="">— Chọn ngân hàng —</option>
                  {(partnerId ? linkedBanks : refs.banks).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Ngành nghề" required hint="Bắt buộc — theo ĐKKD của HKD">
              <select className={inputCls} value={industryId} onChange={(e) => setIndustryId(e.target.value)}>
                <option value="">— Chọn ngành nghề —</option>
                {refs.industries.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} · {i.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {partnerId && bankId && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Biểu phí (mua / cài máy / bán) của đối tác</div>
              <FeePreview bankId={Number(bankId)} partnerId={Number(partnerId)} />
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-4">
            <Field label="Chuỗi TID" required>
              <input className={inputCls} value={tid} onChange={(e) => setTid(e.target.value)} />
            </Field>
            <Field label="Chuỗi MID">
              <input className={inputCls} value={mid} onChange={(e) => setMid(e.target.value)} />
            </Field>
            <Field label="Ngày cấp TID">
              <input type="date" className={inputCls} value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
            </Field>
            <Field label="Ghi chú">
              <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>

          {canOps && (
            <>
              <div className="mt-4 rounded-lg border border-line p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Gán máy POS (tùy chọn)</div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-1.5"><input type="radio" checked={assignMode === 'none'} onChange={() => setAssignMode('none')} /> Chưa gán</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={assignMode === 'pos'} onChange={() => setAssignMode('pos')} /> Gắn máy của công ty</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={assignMode === 'customer'} onChange={() => setAssignMode('customer')} /> Gắn máy của khách</label>
                </div>
                {assignMode === 'pos' && (
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <Field label="Máy POS trong kho công ty" required>
                      <select className={inputCls} value={posSerial} onChange={(e) => setPosSerial(e.target.value)}>
                        <option value="">— Chọn máy POS —</option>
                        {inStock.map((d) => (
                          <option key={d.id} value={d.serial}>
                            {d.serial} {d.bank ? `(${d.bank})` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Khách hàng nhận" required>
                      <select className={inputCls} value={assignCustomerId} onChange={(e) => setAssignCustomerId(e.target.value)}>
                        <option value="">— Chọn khách hàng —</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>{c.display}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                )}
                {assignMode === 'customer' && (
                  <div className="mt-3">
                    <Field label="Serial máy của khách" hint="Tùy chọn — tra cứu, KHÔNG tạo máy trong kho ta">
                      <input className={inputCls} value={customerDeviceSerial} onChange={(e) => setCustomerDeviceSerial(e.target.value)} />
                    </Field>
                  </div>
                )}
              </div>

              <div className="mt-3 rounded-lg border border-line p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" checked={deliverNow} onChange={(e) => setDeliverNow(e.target.checked)} /> Đánh dấu đã giao cho khách ngay
                </label>
                {deliverNow && (
                  <div className="mt-3 grid grid-cols-3 gap-4">
                    {assignMode !== 'pos' && (
                      <Field label="Khách hàng" required>
                        <select className={inputCls} value={deliverCustomerId} onChange={(e) => setDeliverCustomerId(e.target.value)}>
                          <option value="">— Chọn khách hàng —</option>
                          {customers.map((c) => (
                            <option key={c.id} value={c.id}>{c.display}</option>
                          ))}
                        </select>
                      </Field>
                    )}
                    <Field label="Ngày giao" hint="Bỏ trống = hiện tại">
                      <input type="datetime-local" className={inputCls} value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} />
                    </Field>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose}>Hủy</Button>
            <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Thêm TID</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

const KIND_TITLE: Record<string, string> = {
  assign: 'Gán TID vào máy POS + khách hàng',
  replace: 'Đổi TID (TID cũ chết → TID mới)',
  recall: 'Thu hồi TID',
  deliver: 'Giao TID cho khách'
};

function TidActionModal({ tid, kind, onClose, onDone, onOpenSell }: { tid: TidDto; kind: 'assign' | 'replace' | 'recall' | 'deliver'; onClose: () => void; onDone: () => void; onOpenSell?: () => void }): JSX.Element {
  const toast = useToast();
  const [devices, setDevices] = useState<PosDto[]>([]);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [posSerial, setPosSerial] = useState('');
  const [customerId, setCustomerId] = useState(tid.customerId ? String(tid.customerId) : '');
  const [newTid, setNewTid] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // LOẠI GIAO MÁY (Mr.Long) — "Gán máy POS" = giao TID kèm máy: loại giao + số tiền + quỹ.
  const [handoverTypes, setHandoverTypes] = useState<HandoverTypeLite[]>([]);
  const [handoverTypeId, setHandoverTypeId] = useState('');
  const [handoverAmount, setHandoverAmount] = useState('');
  const [fundId, setFundId] = useState('');
  const [method, setMethod] = useState('CASH');
  const [funds, setFunds] = useState<FundDto[]>([]);

  const selectedHandover = handoverTypes.find((h) => String(h.id) === handoverTypeId);
  const moneyKind = selectedHandover?.moneyKind ?? 'NONE';
  const amountNum = Number(handoverAmount) || 0;

  useEffect(() => {
    if (kind === 'assign') {
      window.api.posList({}).then((r) => r.ok && r.data && setDevices(r.data));
      window.api.customerList({}).then((r) => r.ok && r.data && setCustomers(r.data));
      window.api.handoverTypeListLite().then((r) => {
        if (r.ok && r.data) {
          const sorted = [...r.data].sort((a, b) => a.sortOrder - b.sortOrder);
          setHandoverTypes(sorted);
          if (sorted[0]) setHandoverTypeId(String(sorted[0].id));
        }
      });
      window.api.fundList({}).then((r) => r.ok && r.data && setFunds(r.data.filter((f) => f.active)));
    }
    if (kind === 'deliver') {
      window.api.customerList({}).then((r) => r.ok && r.data && setCustomers(r.data));
    }
  }, [kind]);

  // Mượn (NONE) — khóa số tiền = 0.
  useEffect(() => {
    if (kind === 'assign' && moneyKind === 'NONE') { setHandoverAmount('0'); setFundId(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moneyKind, kind]);

  async function run(): Promise<void> {
    const when = occurredAt ? new Date(occurredAt).toISOString() : null;
    let res;
    if (kind === 'assign') {
      if (!posSerial) return toast.alert('Phải chọn máy POS.');
      if (!customerId) return toast.alert('Phải chọn khách hàng.');
      if (!handoverTypeId) return toast.alert('Phải chọn loại giao.', 'Thiếu thông tin');
      if (moneyKind === 'SALE') return toast.alert('Loại giao "Bán" dùng chức năng Bán TID riêng — không gán qua luồng này.', 'Dùng chức năng Bán TID');
      if (moneyKind === 'DEPOSIT' && !(amountNum > 0)) return toast.alert('Loại giao "Cọc" phải nhập số tiền cọc > 0.', 'Thiếu số tiền');
      if (amountNum > 0 && !fundId) return toast.alert('Có số tiền thì phải chọn quỹ nhận.', 'Thiếu quỹ');
      setBusy(true);
      res = await window.api.tidAssign(tid.tid, {
        posSerial,
        customerId: Number(customerId),
        occurredAt: when,
        note: note || null,
        handoverTypeId: Number(handoverTypeId),
        handoverAmount: amountNum,
        fundId: fundId ? Number(fundId) : null,
        method
      });
    } else if (kind === 'replace') {
      if (!newTid.trim()) return toast.alert('Phải nhập TID mới (đã tạo sẵn, trạng thái Chưa gán).');
      setBusy(true);
      res = await window.api.tidReplace(tid.tid, { newTid: newTid.trim(), occurredAt: when, note: note || null });
    } else if (kind === 'recall') {
      setBusy(true);
      res = await window.api.tidRecall(tid.tid, { occurredAt: when, note: note || null });
    } else {
      if (!customerId) return toast.alert('Phải chọn khách hàng nhận.');
      setBusy(true);
      res = await window.api.tidMarkDelivered(tid.tid, { deliveredAt: when, customerId: Number(customerId), toAgentId: null, note: note || null });
    }
    setBusy(false);
    if (res.ok) {
      toast.success(`${KIND_TITLE[kind]} — thành công cho TID ${tid.tid}`);
      onDone();
    } else {
      toast.alert(res.message ?? 'Thao tác thất bại');
    }
  }

  const inStock = devices.filter((d) => d.status === 'IN_STOCK');

  return (
    <Modal title={`${KIND_TITLE[kind]} — ${tid.tid}`} onClose={onClose} width="max-w-lg">
      <div className="grid grid-cols-1 gap-4">
        {kind === 'assign' && (
          <>
            <Field label="Máy POS (IN_STOCK)" required>
              <select className={inputCls} value={posSerial} onChange={(e) => setPosSerial(e.target.value)}>
                <option value="">— Chọn máy POS —</option>
                {inStock.map((d) => (
                  <option key={d.id} value={d.serial}>
                    {d.serial} {d.bank ? `(${d.bank})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Khách hàng" required>
              <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— Chọn khách hàng —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.display}</option>
                ))}
              </select>
            </Field>
            <Field label="Loại giao" required hint="Hình thức giao TID kèm máy cho khách">
              <select className={inputCls} value={handoverTypeId} onChange={(e) => setHandoverTypeId(e.target.value)}>
                {handoverTypes.length === 0 && <option value="">— Chưa có loại giao —</option>}
                {handoverTypes.map((h) => <option key={h.id} value={h.id}>{h.name} ({MONEY_KIND_LABEL[h.moneyKind] ?? h.moneyKind})</option>)}
              </select>
            </Field>
            {moneyKind === 'SALE' && (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-slate-600">
                Loại giao <b>Bán</b> — TID bán đứt, không gán qua luồng này. Hãy dùng chức năng <b>Bán TID</b>.
                {onOpenSell && (
                  <div className="mt-2">
                    <Button variant="confirm" onClick={onOpenSell}>Mở Bán TID</Button>
                  </div>
                )}
              </div>
            )}
            {moneyKind !== 'SALE' && (
              <div className="grid grid-cols-2 gap-4">
                <Field label={moneyKind === 'DEPOSIT' ? 'Số tiền cọc (VND)' : moneyKind === 'RENT' ? 'Số tiền thuê (VND)' : 'Số tiền (VND)'} required={moneyKind === 'DEPOSIT'} hint={moneyKind === 'NONE' ? 'Mượn — khóa 0đ' : undefined}>
                  <input
                    className={inputCls + ' text-right tabular-nums'}
                    inputMode="numeric"
                    value={handoverAmount}
                    disabled={moneyKind === 'NONE'}
                    onChange={(e) => setHandoverAmount(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="0"
                  />
                </Field>
                <Field label="Quỹ nhận tiền" hint={amountNum > 0 ? 'Bắt buộc khi có số tiền' : 'Không thu thì bỏ trống'}>
                  <select className={inputCls} value={fundId} disabled={moneyKind === 'NONE'} onChange={(e) => setFundId(e.target.value)}>
                    <option value="">— Chọn quỹ —</option>
                    {funds.map((f) => <option key={f.id} value={f.id}>{f.code} · {f.name}</option>)}
                  </select>
                </Field>
                {amountNum > 0 && (
                  <Field label="Hình thức">
                    <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
                      <option value="CASH">Tiền mặt</option>
                      <option value="CK">Chuyển khoản</option>
                    </select>
                  </Field>
                )}
              </div>
            )}
          </>
        )}
        {kind === 'replace' && (
          <Field label="TID mới" required hint="TID mới phải đã được tạo và ở trạng thái Chưa gán">
            <input className={inputCls} value={newTid} onChange={(e) => setNewTid(e.target.value)} autoFocus />
          </Field>
        )}
        {kind === 'deliver' && (
          <>
            <Field label="Khách hàng nhận" required hint="TID chưa gán máy (máy khách) cần chọn khách">
              <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— Chọn khách hàng —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.display}</option>
                ))}
              </select>
            </Field>
          </>
        )}
        <Field label={kind === 'deliver' ? 'Thời gian giao' : 'Thời gian thao tác'} hint="Bỏ trống = hiện tại">
          <input type="datetime-local" className={inputCls} value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        </Field>
        <Field label="Ghi chú">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={run} disabled={busy || (kind === 'assign' && moneyKind === 'SALE')} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}>
          {kind === 'assign' ? 'Gán TID' : kind === 'replace' ? 'Đổi TID' : kind === 'recall' ? 'Thu hồi' : 'Đã giao'}
        </Button>
      </div>
    </Modal>
  );
}

const TID_EVENT_LABELS: Record<string, string> = {
  STOCK_IN: 'Nhập kho',
  TID_ASSIGN: 'Gán TID lên máy',
  TID_DELIVERED: 'Giao TID cho khách',
  TID_SELL: 'Bán TID',
  TID_UNBIND: 'Gỡ TID khỏi máy',
  TID_RECALL: 'Thu hồi TID',
  TID_DEAD: 'TID chết (đổi)',
  TID_CLOSE: 'Đóng TID',
  TID_REPLACE: 'TID mới thay thế',
  DEPLOY: 'Giao máy',
  RECALL: 'Thu hồi máy',
  SELL: 'Bán máy',
  RETIRE: 'Thanh lý'
};

// Nhãn trạng thái TID cho dòng "fromState → toState" trong vòng đời.
const TID_STATE_LABELS: Record<string, string> = {
  UNASSIGNED: 'Chưa gán máy',
  ACTIVE: 'Đang hoạt động',
  DEAD: 'Chết',
  CLOSED: 'Đã đóng',
  RECALLED: 'Đã thu hồi',
  SOLD: 'Đã bán'
};

// eventType có "khách" mang ý nghĩa giao/bán cho khách (dòng "Khách: …") trong vòng đời TID.
const TID_CUSTOMER_EVENT_TYPES = new Set(['DEPLOY', 'CHANGE_CUSTOMER', 'TID_DELIVERED', 'SELL', 'TID_SELL']);

// R30 — Phí bán THỰC TẾ theo TID × loại thẻ. Nhập khi giao máy; cột "Niêm yết" (FeeRate.phiBan hiệu lực)
// để đối chiếu tránh điền sai. Để trống = dùng niêm yết. Doanh thu GD sau đó ưu tiên phí thực tế này.
function pctText(p: number | null): string {
  if (p == null) return '—';
  return `${String(p).replace('.', ',')}%`;
}
function TidSellFeeModal({ tid, onClose, onSaved }: { tid: TidDto; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<TidSellFeeRowDto[] | null>(null);
  const [hasPartner, setHasPartner] = useState(true);
  const [edited, setEdited] = useState<Record<number, string>>({});
  // FEE_MODEL — mỗi loại thẻ chọn 1 trong 2: 'quote' = dùng phí bán NIÊM YẾT (read-only) | 'custom' = phí TÙY CHỈNH.
  const [mode, setMode] = useState<Record<number, 'quote' | 'custom'>>({});
  const [busy, setBusy] = useState(false);
  // FEE_TYPE — phí bán thực tế theo TID × thẻ × LOẠI PHÍ. MẶC ĐỊNH loại phí phần tử ĐẦU (Mr.Long "thứ tự 1").
  const [feeTypes, setFeeTypes] = useState<FeeTypeDto[]>([]);
  const [feeTypeId, setFeeTypeId] = useState('');

  useEffect(() => {
    window.api.feeTypeList().then((r) => {
      if (r.ok && r.data) {
        setFeeTypes(r.data);
        if (r.data[0]) setFeeTypeId(String(r.data[0].id));
      }
    });
  }, []);

  useEffect(() => {
    if (!feeTypeId) return;
    let alive = true;
    setRows(null);
    window.api.tidSellFeeList(tid.id, Number(feeTypeId)).then((r) => {
      if (!alive) return;
      if (r.ok && r.data) {
        setRows(r.data.rows);
        setHasPartner(r.data.partnerId != null);
        const init: Record<number, string> = {};
        const initMode: Record<number, 'quote' | 'custom'> = {};
        for (const row of r.data.rows) {
          init[row.cardTypeId] = row.phiBanThucTe != null ? String(row.phiBanThucTe) : '';
          initMode[row.cardTypeId] = row.hasOverride ? 'custom' : 'quote';
        }
        setEdited(init);
        setMode(initMode);
      } else {
        toast.alert(r.message ?? 'Không tải được phí bán.');
        setRows([]);
      }
    });
    return () => {
      alive = false;
    };
  }, [tid.id, feeTypeId]);

  async function save(): Promise<void> {
    if (!rows || rows.length === 0) return;
    if (!feeTypeId) { toast.alert('Vui lòng chọn loại phí.'); return; }
    // 'quote' = dùng niêm yết → phiBan null (KHÔNG tạo/giữ override). 'custom' = phí tùy chỉnh → gửi số nhập.
    const entries = rows.map((row) => {
      if ((mode[row.cardTypeId] ?? 'quote') === 'quote') return { cardTypeId: row.cardTypeId, phiBan: null };
      const raw = (edited[row.cardTypeId] ?? '').trim().replace(',', '.');
      return { cardTypeId: row.cardTypeId, phiBan: raw === '' ? null : Number(raw) };
    });
    for (const e of entries) {
      if (e.phiBan != null && (!Number.isFinite(e.phiBan) || e.phiBan < 0 || e.phiBan > 100)) {
        toast.alert('Phí bán phải là số trong khoảng 0–100%.');
        return;
      }
    }
    setBusy(true);
    const res = await window.api.tidSellFeeSet({ tidId: tid.id, feeTypeId: Number(feeTypeId), entries });
    setBusy(false);
    if (res.ok) {
      toast.success('Đã lưu phí bán thực tế.');
      onSaved();
    } else {
      toast.alert(res.message ?? 'Lưu phí bán thất bại.', 'Không lưu được');
    }
  }

  return (
    <Modal title={`Phí bán thực tế — TID ${tid.tid}`} onClose={onClose} width="max-w-2xl" onSubmit={() => void save()}>
      <p className="mb-3 text-sm text-slate-500">
        Mỗi <span className="font-medium text-slate-600">loại thẻ</span> chọn 1 trong 2: <span className="font-medium text-slate-600">Niêm yết</span> (dùng % niêm yết của loại phí) hoặc{' '}
        <span className="font-medium text-slate-600">Tùy chỉnh</span> (nhập % phí bán thực tế khi giao máy). Chọn Niêm yết = không tạo phí tùy chỉnh.
      </p>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-600">Loại phí</span>
        <select className={inputCls + ' w-56'} value={feeTypeId} onChange={(e) => setFeeTypeId(e.target.value)}>
          <option value="">— Chọn loại phí —</option>
          {feeTypes.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
      {rows === null && (
        <div className="py-6 text-center text-slate-400">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      )}
      {rows !== null && rows.length === 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-slate-600">
          TID chưa gán ngân hàng hoặc ngân hàng chưa có loại thẻ. Hãy cấu hình TID (ngân hàng) và loại thẻ trước khi đặt phí bán.
        </div>
      )}
      {rows !== null && rows.length > 0 && (
        <>
          {!hasPartner && (
            <div className="mb-3 rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-slate-600">
              TID chưa gán đối tác nên chưa có phí niêm yết để đối chiếu — vẫn có thể nhập phí bán thực tế.
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Loại thẻ</th>
                  <th className="px-4 py-2.5 text-right">Niêm yết</th>
                  <th className="px-4 py-2.5">Cách tính phí bán</th>
                  <th className="px-4 py-2.5 text-right">Phí bán áp dụng (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => {
                  const m = mode[row.cardTypeId] ?? 'quote';
                  return (
                  <tr key={row.cardTypeId} className="hover:bg-appbg/60">
                    <td className="px-4 py-2.5 text-slate-700">
                      {row.cardTypeCode ? <span className="font-mono text-xs font-semibold text-brand whitespace-nowrap">{row.cardTypeCode}</span> : null} {row.cardTypeName}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{pctText(row.phiBanNiemYet)}</td>
                    <td className="px-4 py-2.5">
                      <div className="inline-flex overflow-hidden rounded-md border border-line text-xs">
                        <button
                          type="button"
                          className={'px-2.5 py-1 ' + (m === 'quote' ? 'bg-brand text-white' : 'bg-white text-slate-600 hover:bg-appbg')}
                          onClick={() => setMode((s) => ({ ...s, [row.cardTypeId]: 'quote' }))}
                        >Niêm yết</button>
                        <button
                          type="button"
                          className={'px-2.5 py-1 ' + (m === 'custom' ? 'bg-brand text-white' : 'bg-white text-slate-600 hover:bg-appbg')}
                          onClick={() => setMode((s) => ({ ...s, [row.cardTypeId]: 'custom' }))}
                        >Tùy chỉnh</button>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {m === 'quote' ? (
                        <span className="text-slate-500">{pctText(row.phiBanNiemYet)} <span className="text-xs text-slate-400">(niêm yết)</span></span>
                      ) : (
                        <input
                          className={inputCls + ' w-28 text-right'}
                          inputMode="decimal"
                          placeholder={row.phiBanNiemYet != null ? String(row.phiBanNiemYet) : '—'}
                          value={edited[row.cardTypeId] ?? ''}
                          onChange={(e) => setEdited((s) => ({ ...s, [row.cardTypeId]: e.target.value }))}
                        />
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose}>
              Hủy
            </Button>
            <Button variant="confirm" onClick={() => void save()} disabled={busy}>
              {busy ? 'Đang lưu…' : 'Lưu phí bán'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function TidTimelineModal({ tid, onClose }: { tid: TidDto; onClose: () => void }): JSX.Element {
  const [events, setEvents] = useState<TimelineEventDto[] | null>(null);
  useEffect(() => {
    window.api.tidTimeline(tid.tid).then((r) => setEvents(r.ok && r.data ? r.data : []));
  }, [tid.tid]);

  return (
    <Modal title={`Vòng đời TID ${tid.tid}`} onClose={onClose} width="max-w-2xl">
      {!events && <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />}
      {events && events.length === 0 && <p className="text-sm text-slate-400">Chưa có sự kiện — TID mới cấp, chưa gán/giao.</p>}
      {events && events.length > 0 && (
        <ol className="relative ml-3 border-l border-line">
          {events.map((e) => (
            <li key={e.id} className="mb-5 ml-5">
              <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full bg-brand" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-brand-tint px-1.5 py-0.5 text-xs font-medium text-brand">{TID_EVENT_LABELS[e.eventType] ?? e.eventType}</span>
                {e.fromState && (
                  <span className="text-xs text-slate-400">
                    {TID_STATE_LABELS[e.fromState] ?? e.fromState} → {e.toState ? (TID_STATE_LABELS[e.toState] ?? e.toState) : ''}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-500">{fmtDate(e.occurredAt)}</div>
              {e.customerName && TID_CUSTOMER_EVENT_TYPES.has(e.eventType) && (
                <div className="mt-0.5 text-xs text-slate-500">Khách: <span className="font-medium text-slate-700">{e.customerName}</span></div>
              )}
              {e.warehouseName && (
                <div className="mt-0.5 text-xs text-slate-500">Về kho: <span className="font-medium text-slate-700">{e.warehouseName}</span>{e.deliveryAddress ? ` — ${e.deliveryAddress}` : ''}</div>
              )}
              {e.handoverName && (
                <div className="mt-0.5 text-xs text-slate-500">
                  · <span className="font-medium text-slate-700">{e.handoverName}</span>
                  {e.handoverAmount != null && <span className="ml-1 font-medium text-slate-700">{money(e.handoverAmount)}</span>}
                </div>
              )}
              {e.actorName && (
                <div className="mt-0.5 text-xs text-slate-500">Người thực hiện: <span className="font-medium text-slate-700">{e.actorName}</span></div>
              )}
              {e.note && <div className="mt-0.5 text-sm text-slate-600">{e.note}</div>}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
