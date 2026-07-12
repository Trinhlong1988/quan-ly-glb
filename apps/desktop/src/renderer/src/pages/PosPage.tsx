import { useEffect, useState } from 'react';
import { Loader2, HardDrive, History, Wrench, Download, List, PackagePlus, Building2, Cpu, Tag, Trash2, Banknote, Undo2 } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTimeSec } from '@glb/shared';
import type { PosDto, TimelineEventDto, CustomerDto, FundDto, LiteRef, WarehouseLite } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { Button } from '../components/Button.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { RequestCancelModal, type RequestCancelTarget } from '../components/RequestCancelModal.js';
import { StatusBadge, useStatusOptions, toneCls } from '../components/StatusBadge.js';
import { StatBar } from '../components/StatBar.js';
import { StaleBanner } from '../lib/realtime.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';
import { TabBar, TabButton } from '../components/Tabs.js';
import { exportCsv } from '../lib/exportCsv.js';
// PHASE K1 — hợp nhất: các tab cấu hình cung ứng POS dùng lại nguyên các panel của PosSupplyPage.
import { SupplierTab, ModelTab, StatusTab, IntakeTab } from './PosSupplyPage.js';

/** Định dạng tiền VND (nhóm 3 chữ số kiểu Việt Nam) — không dùng toLocaleString. */
function fmtVnd(n: number | null): string {
  if (n == null) return '—';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ₫';
}

type PosTab = 'devices' | 'intake' | 'supplier' | 'model' | 'status';

/** PHASE K1 (§2.3) — 1 trang "Quản Lý Máy POS" nhiều tab. Danh sách máy (POS_*) + cấu hình cung ứng
 * (CONFIG_POS_SUPPLY_*). Ẩn/hiện từng tab theo quyền (rủi ro #4: quyền lệch sau gộp menu). */
export function PosPage({ user }: { user: AuthUser }): JSX.Element {
  const canView = hasPermission(user, 'POS_VIEW');
  const canConfigView = hasPermission(user, 'CONFIG_POS_SUPPLY_VIEW');
  const canConfigManage = hasPermission(user, 'CONFIG_POS_SUPPLY_MANAGE');

  const allTabs: { key: PosTab; label: string; icon: JSX.Element; show: boolean }[] = [
    { key: 'devices', label: 'Danh sách máy', icon: <List className="h-4 w-4" />, show: canView },
    { key: 'intake', label: 'Nhập kho', icon: <PackagePlus className="h-4 w-4" />, show: canConfigView },
    { key: 'supplier', label: 'Nhà cung cấp', icon: <Building2 className="h-4 w-4" />, show: canConfigView },
    { key: 'model', label: 'Chủng loại POS', icon: <Cpu className="h-4 w-4" />, show: canConfigView },
    { key: 'status', label: 'Trạng thái nhập', icon: <Tag className="h-4 w-4" />, show: canConfigView }
  ];
  const tabs = allTabs.filter((t) => t.show);

  const [tab, setTab] = useState<PosTab>(tabs[0]?.key ?? 'devices');

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Quản Lý Máy POS</h2>
        <p className="text-sm text-slate-500">Danh sách máy (nguồn sự thật) · nhập kho · nhà cung cấp · chủng loại · trạng thái nhập.</p>
      </div>
      <TabBar>
        {tabs.map((t) => (
          <TabButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)} icon={t.icon}>
            {t.label}
          </TabButton>
        ))}
      </TabBar>
      {tab === 'devices' && <DeviceListTab user={user} />}
      {tab === 'intake' && <IntakeTab canManage={canConfigManage} />}
      {tab === 'supplier' && <SupplierTab canManage={canConfigManage} />}
      {tab === 'model' && <ModelTab canManage={canConfigManage} />}
      {tab === 'status' && <StatusTab canManage={canConfigManage} />}
    </div>
  );
}

/** Tab [Danh sách máy] — nguồn PosDevice. StatBar theo status + hành động vòng đời máy. */
function DeviceListTab({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<PosDto[]>([]);
  const [models, setModels] = useState<LiteRef[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]); // Model 1 — lọc theo kho
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // LANE B (#24) — lọc "Chủng loại" phía client trên tập rows (posList trả full, không phân trang).
  const [modelFilter, setModelFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState(''); // Model 1 — lọc theo kho vật lý (server-side)
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [timelineOf, setTimelineOf] = useState<PosDto | null>(null);
  const [actionOf, setActionOf] = useState<{ device: PosDto; event: string } | null>(null);
  const [saleTarget, setSaleTarget] = useState<PosDto | null>(null);
  const [cancelTarget, setCancelTarget] = useState<RequestCancelTarget | null>(null);
  const [onlyRecall, setOnlyRecall] = useState(false); // #6 — lọc "cần thu hồi"

  const canManage = hasPermission(user, 'POS_MANAGE');
  const canSell = hasPermission(user, 'DEVICE_SALE_MANAGE');
  const canCancelReq = hasPermission(user, 'POS_CANCEL_REQUEST');
  // R14 — danh mục trạng thái máy POS (entity POS_DEVICE) từ catalog tùy biến.
  const { options: posOptions, byCode: posByCode } = useStatusOptions('POS_DEVICE');
  const posStatusLabel = (code: string): string => posByCode.get(code)?.label ?? code;

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.posList({
      search: search || undefined,
      status: statusFilter || undefined,
      warehouseId: warehouseFilter ? Number(warehouseFilter) : undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined
    });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    window.api.posModelLite().then((r) => r.ok && r.data && setModels(r.data));
    window.api.warehouseLite().then((r) => r.ok && r.data && setWarehouses(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Đổi kho là lọc lại ngay (server-side).
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseFilter]);

  // Lọc chủng loại (client-side) trên tập đã lọc phía server. Ưu tiên posModelId; nếu DTO thiếu id
  // nhưng có tên khớp option đang chọn thì fallback theo posModelName.
  const selectedModel = models.find((m) => String(m.id) === modelFilter);
  const filteredRows = (modelFilter
    ? rows.filter((d) =>
        d.posModelId != null
          ? String(d.posModelId) === modelFilter
          : !!selectedModel && d.posModelName === selectedModel.name
      )
    : rows
  ).filter((d) => (onlyRecall ? d.recallPending : true));
  const recallCount = rows.filter((d) => d.recallPending).length;

  function resetFilters(): void {
    setSearch('');
    setStatusFilter('');
    setModelFilter('');
    setWarehouseFilter('');
    setFromDate('');
    setToDate('');
    setTimeout(reload, 0);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{filteredRows.length} máy POS</div>
        <div className="flex items-center gap-2">
          <Button
            variant="confirm"
            icon={<Download className="h-4 w-4" />}
            onClick={() =>
              exportCsv(
                'may_pos',
                ['Serial', 'Chủng loại', 'Nhà cung cấp', 'Giá nhập', 'Ngày nhập', 'Trạng thái', 'Kho', 'TID hiện tại', 'Khách'],
                filteredRows.map((d) => [d.serial, d.posModelName ?? '', d.supplierName ?? '', d.importPrice ?? '', d.importedAt ? fmtDate(d.importedAt) : '', posStatusLabel(d.status), d.warehouseName ?? '', d.currentTid ?? '', d.customerName ?? ''])
              )
            }
          >
            Xuất Excel
          </Button>
        </div>
      </div>

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Tìm serial / TID…"
        fromDate={fromDate}
        toDate={toDate}
        onFromDate={setFromDate}
        onToDate={setToDate}
        selects={[
          { key: 'status', placeholder: 'Tất cả trạng thái', value: statusFilter, options: posOptions.filter((o) => o.active).map((o) => ({ value: o.code, label: o.label })), onChange: setStatusFilter },
          // Lọc chủng loại (client-side) — đổi giá trị là lọc ngay, không cần bấm "Lọc".
          { key: 'model', placeholder: 'Tất cả chủng loại', value: modelFilter, options: models.map((m) => ({ value: String(m.id), label: m.name })), onChange: setModelFilter },
          // Model 1 — lọc theo KHO đang chứa máy (server-side). "Chưa gán kho" bắt máy IN_STOCK chưa có kho.
          { key: 'warehouse', placeholder: 'Tất cả kho', value: warehouseFilter, options: warehouses.map((w) => ({ value: String(w.id), label: `${w.code} · ${w.name}` })), onChange: setWarehouseFilter }
        ]}
        onApply={reload}
        onReset={resetFilters}
      />

      {recallCount > 0 && (
        <button
          onClick={() => setOnlyRecall((v) => !v)}
          className={'mb-2 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition ' + (onlyRecall ? 'border-warning bg-warning/15 text-warning' : 'border-line text-slate-600 hover:bg-appbg')}
        >
          <Undo2 className="h-3.5 w-3.5" /> {onlyRecall ? 'Đang lọc: ' : ''}Cần thu hồi ({recallCount})
        </button>
      )}

      {/* Bộ đếm (đếm CLIENT từ posList — trả full, không phân trang; theo tập kết quả lọc hiện tại). */}
      <StatBar
        items={[
          { label: 'Tổng máy', value: filteredRows.length, tone: 'bg-brand-tint text-brand' },
          ...posOptions.filter((o) => o.active).map((o) => ({
            label: o.label,
            value: filteredRows.filter((d) => d.status === o.code).length,
            tone: toneCls(o.tone)
          }))
        ]}
      />

      <StaleBanner domain="Pos" onReload={reload} className="mb-2" />
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Serial</th>
              <th className="px-4 py-3">Chủng loại</th>
              <th className="px-4 py-3">Nhà cung cấp</th>
              <th className="px-4 py-3 text-right">Giá nhập</th>
              <th className="px-4 py-3">Ngày nhập</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Kho</th>
              <th className="px-4 py-3">TID hiện tại</th>
              <th className="px-4 py-3">Khách</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && filteredRows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                  <HardDrive className="mx-auto mb-2 h-6 w-6" />
                  {rows.length === 0 ? 'Chưa có máy POS.' : 'Không có máy POS khớp bộ lọc.'}
                </td>
              </tr>
            )}
            {!loading &&
              filteredRows.map((d) => (
                <tr key={d.id} className="hover:bg-appbg/60">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">{d.serial}</td>
                  <td className="px-4 py-3 text-slate-600">{d.posModelName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{d.supplierName ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-700 whitespace-nowrap">{fmtVnd(d.importPrice)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{d.importedAt ? fmtDate(d.importedAt) : '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge entity="POS_DEVICE" code={d.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{d.warehouseName ?? (d.status === 'IN_STOCK' ? <span className="text-amber-500">Chưa gán kho</span> : '—')}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{d.currentTid ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{d.customerName ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setTimelineOf(d)}
                        title="Dòng thời gian"
                        className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-slate-600 hover:bg-appbg"
                      >
                        <History className="h-3.5 w-3.5" /> Vòng đời
                      </button>
                      {d.recallPending && (
                        <span title="Khách đã hủy — máy chưa thu về" className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning whitespace-nowrap">Cần thu hồi</span>
                      )}
                      {canManage && (NEXT[d.status]?.length ?? 0) > 0 && (
                        <select
                          className="rounded-md border border-line px-2 py-1 text-xs text-slate-600 hover:bg-appbg"
                          value=""
                          onChange={(e) => e.target.value && setActionOf({ device: d, event: e.target.value })}
                        >
                          <option value="">Thao tác…</option>
                          {NEXT[d.status].map((n) => (
                            <option key={n.key} value={n.key}>
                              {n.label}
                            </option>
                          ))}
                        </select>
                      )}
                      {canSell && (d.status === 'IN_STOCK' || d.status === 'DEPLOYED') && (
                        <button
                          onClick={() => setSaleTarget(d)}
                          title="Bán máy (kèm TID nếu có)"
                          className="flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:brightness-105"
                        >
                          <Banknote className="h-3.5 w-3.5" /> Bán máy
                        </button>
                      )}
                      {canCancelReq && (
                        <button
                          onClick={() => setCancelTarget({ entityType: 'PosDevice', entityId: d.id, entityLabel: d.serial, typeLabel: 'máy POS' })}
                          title="Yêu cầu hủy"
                          className="flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-xs font-semibold text-danger hover:brightness-110"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Yêu cầu hủy
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {timelineOf && <TimelineModal device={timelineOf} onClose={() => setTimelineOf(null)} />}
      {actionOf && (
        <TransitionModal
          device={actionOf.device}
          event={actionOf.event}
          onClose={() => setActionOf(null)}
          onDone={async () => {
            setActionOf(null);
            await reload();
          }}
        />
      )}
      {saleTarget && (
        <SellDeviceModal
          device={saleTarget}
          onClose={() => setSaleTarget(null)}
          onDone={async () => {
            setSaleTarget(null);
            await reload();
          }}
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
    </div>
  );
}

/** #3 — Bán máy POS (kèm TID nếu có). Form tiền + mật khẩu xác nhận. */
function SellDeviceModal({ device, onClose, onDone }: { device: PosDto; onClose: () => void; onDone: () => void }): JSX.Element {
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
    if (!password) return toast.alert('Nhập mật khẩu để xác nhận bán máy.', 'Cần mật khẩu');
    setBusy(true);
    const res = await window.api.deviceSellPos(device.serial, {
      customerId: Number(customerId), salePrice: price, paidNow: paid,
      fundId: fundId ? Number(fundId) : null, method, warehouseId: device.warehouseId ?? null, // ĐỒNG BỘ: kho xuất = kho đang chứa máy
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : null, note: note || null
    }, password);
    setBusy(false);
    if (res.ok) { toast.success(`Đã bán máy ${device.serial}${device.currentTid ? ` (kèm TID ${device.currentTid})` : ''}`); onDone(); }
    else toast.alert(res.message ?? 'Bán máy thất bại', 'Không bán được');
  }

  return (
    <Modal title={`Bán máy ${device.serial}`} onClose={onClose} width="max-w-lg">
      <div className="mb-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
        Máy sẽ chuyển <b>ĐÃ BÁN</b>{device.currentTid ? <> và <b>TID {device.currentTid}</b> bán kèm sang khách mua.</> : '.'} Doanh thu ghi nhận đủ giá ngay; phần chưa thu thành công nợ mua thiết bị.
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
        {device.warehouseId != null && (
          <Field label="Từ kho" hint="Kho đang chứa máy (đồng bộ, không chọn lệch)">
            <div className="rounded-md border border-line bg-appbg px-3 py-2 text-sm font-medium text-slate-700">{device.warehouseName ?? `Kho #${device.warehouseId}`}</div>
          </Field>
        )}
        <Field label="Thời gian bán" hint="Bỏ trống = hiện tại">
          <input type="datetime-local" className={inputCls} value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        </Field>
        <Field label="Ghi chú"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Field label="Mật khẩu xác nhận" required><input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-600 hover:bg-appbg">Hủy</button>
        <button onClick={submit} disabled={busy} className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-105 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Bán máy
        </button>
      </div>
    </Modal>
  );
}

/** Transitions available from each status (mirrors the main-process state machine §A3). */
const NEXT: Record<string, { key: string; label: string }[]> = {
  IN_STOCK: [
    { key: 'deploy', label: 'Triển khai (giao khách)' },
    { key: 'reportDamage', label: 'Báo hỏng' },
    { key: 'retire', label: 'Thanh lý' }
  ],
  DEPLOYED: [
    { key: 'changeCustomer', label: 'Đổi khách giữ máy' },
    { key: 'cancelCustomer', label: 'Hủy khách giữ máy' },
    { key: 'recall', label: 'Thu hồi về kho' },
    { key: 'reportDamage', label: 'Báo hỏng' },
    { key: 'retire', label: 'Thanh lý' }
  ],
  DAMAGED: [
    { key: 'sendRepair', label: 'Gửi bảo trì' },
    { key: 'retire', label: 'Thanh lý' }
  ],
  IN_REPAIR: [
    { key: 'receiveRepaired', label: 'Nhận sửa xong' },
    { key: 'retire', label: 'Thanh lý' }
  ],
  RETIRED: []
};

function TimelineModal({ device, onClose }: { device: PosDto; onClose: () => void }): JSX.Element {
  const [events, setEvents] = useState<TimelineEventDto[] | null>(null);
  useEffect(() => {
    window.api.posTimeline(device.serial).then((r) => setEvents(r.ok && r.data ? r.data : []));
  }, [device.serial]);

  return (
    <Modal title={`Vòng đời máy ${device.serial}`} onClose={onClose} width="max-w-2xl">
      {!events && <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />}
      {events && events.length === 0 && <p className="text-sm text-slate-400">Chưa có sự kiện.</p>}
      {events && events.length > 0 && (
        <ol className="relative ml-3 border-l border-line">
          {events.map((e) => (
            <li key={e.id} className="mb-5 ml-5">
              <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full bg-brand" />
              <div className="flex items-center gap-2">
                <span className="rounded bg-brand-tint px-1.5 py-0.5 text-xs font-medium text-brand">{e.eventType}</span>
                {e.fromState && (
                  <span className="text-xs text-slate-400">
                    {e.fromState} → {e.toState}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-500">{fmtDate(e.occurredAt)} {fmtTimeSec(e.occurredAt)}</div>
              {e.warehouseName && (
                <div className="mt-0.5 text-xs text-slate-500">Từ kho: <span className="font-medium text-slate-700">{e.warehouseName}</span>{e.deliveryAddress ? ` — ${e.deliveryAddress}` : ''}</div>
              )}
              {e.note && <div className="mt-0.5 text-sm text-slate-600">{e.note}</div>}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

const EVENT_LABELS: Record<string, string> = {
  deploy: 'Triển khai (giao khách)',
  recall: 'Thu hồi về kho',
  changeCustomer: 'Đổi khách giữ máy',
  cancelCustomer: 'Hủy khách giữ máy',
  reportDamage: 'Báo hỏng',
  sendRepair: 'Gửi bảo trì',
  receiveRepaired: 'Nhận sửa xong',
  retire: 'Thanh lý'
};

function TransitionModal({ device, event, onClose, onDone }: { device: PosDto; event: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const toast = useToast();
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState(''); // Model 1 — thu hồi/nhận-sửa VỀ kho nào
  const [occurredAt, setOccurredAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);

  const needCustomer = event === 'deploy' || event === 'changeCustomer';
  // R27: giao / đổi-khách ghi "Từ kho" (chọn kho → hiện địa chỉ).
  const needFromWarehouse = event === 'deploy' || event === 'changeCustomer';
  // Model 1: thu hồi / nhận-sửa xong → máy VỀ kho nào.
  const needToWarehouse = event === 'recall' || event === 'receiveRepaired';
  // ĐỒNG BỘ: máy đang có kho (đang trong kho) → deploy xuất TỪ chính kho đó, KHÓA không cho chọn lệch.
  const lockedFromWarehouse = event === 'deploy' && device.warehouseId != null;
  const selectedWarehouse = warehouses.find((w) => String(w.id) === warehouseId);

  useEffect(() => {
    if (needCustomer) window.api.customerList({}).then((r) => r.ok && r.data && setCustomers(r.data));
    if (needFromWarehouse || needToWarehouse) window.api.warehouseLite().then((r) => r.ok && r.data && setWarehouses(r.data));
    if (event === 'deploy' && device.warehouseId != null) setWarehouseId(String(device.warehouseId));
  }, [needCustomer, needFromWarehouse, needToWarehouse, event, device.warehouseId]);

  async function run(password?: string): Promise<void> {
    if (needCustomer && !customerId) return toast.alert(event === 'changeCustomer' ? 'Phải chọn khách hàng mới.' : 'Phải chọn khách hàng nhận máy.');
    if (needToWarehouse && !toWarehouseId) return toast.alert('Phải chọn KHO nhận máy về (để biết máy đang ở kho nào).', 'Thiếu kho');
    setBusy(true);
    const input = {
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : null,
      note: note || null,
      customerId: customerId ? Number(customerId) : null,
      agentId: null,
      fromWarehouseId: needFromWarehouse && warehouseId ? Number(warehouseId) : null,
      toWarehouseId: needToWarehouse && toWarehouseId ? Number(toWarehouseId) : null
    };
    let res;
    switch (event) {
      case 'deploy': res = await window.api.posDeploy(device.serial, input); break;
      case 'recall': res = await window.api.posRecall(device.serial, input); break;
      case 'changeCustomer': res = await window.api.posChangeCustomer(device.serial, input); break;
      case 'cancelCustomer': res = await window.api.posCancelCustomer(device.serial, input); break;
      case 'reportDamage': res = await window.api.posReportDamage(device.serial, input); break;
      case 'sendRepair': res = await window.api.posSendRepair(device.serial, input); break;
      case 'receiveRepaired': res = await window.api.posReceiveRepaired(device.serial, input); break;
      case 'retire': res = await window.api.posRetire(device.serial, password ?? '', input); break;
      default: res = { ok: false, message: 'Sự kiện không hợp lệ' };
    }
    setBusy(false);
    if (res.ok) {
      toast.success(`${EVENT_LABELS[event]} — thành công cho máy ${device.serial}`);
      onDone();
    } else {
      toast.alert(res.message ?? 'Thao tác thất bại');
    }
  }

  // Retire is destructive → password confirm dialog.
  if (event === 'retire' && confirmRetire) {
    return (
      <ConfirmDialog
        title="Thanh lý máy POS"
        message={`Thanh lý (RETIRED) máy "${device.serial}" là thao tác không hoàn tác. Nếu máy còn gắn TID, TID sẽ được gỡ và thu hồi. Nhập lại mật khẩu để xác nhận.`}
        confirmLabel="Thanh lý"
        danger
        requirePassword
        onCancel={() => setConfirmRetire(false)}
        onConfirm={(pwd) => run(pwd)}
      />
    );
  }

  return (
    <Modal title={`${EVENT_LABELS[event]} — ${device.serial}`} onClose={onClose} width="max-w-lg">
      <div className="mb-2 flex items-center gap-2 rounded-md bg-appbg px-3 py-2 text-sm text-slate-600">
        <Wrench className="h-4 w-4 text-brand" /> Trạng thái hiện tại: <StatusBadge entity="POS_DEVICE" code={device.status} />
      </div>
      {event === 'recall' && device.currentTid && (
        <div className="mb-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">Thu hồi máy sẽ GỠ gán TID {device.currentTid} (TID về "chưa gán máy").</div>
      )}
      {event === 'changeCustomer' && (
        <div className="mb-2 rounded-md bg-brand-tint px-3 py-2 text-xs text-brand">
          Khách đang giữ: <b>{device.customerName ?? '—'}</b>. Máy giữ nguyên trạng thái đang triển khai
          {device.currentTid ? <> và TID <b>{device.currentTid}</b> sẽ đi theo khách mới.</> : '.'}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4">
        {needCustomer && (
          <Field label={event === 'changeCustomer' ? 'Khách hàng mới' : 'Khách hàng nhận máy'} required>
            <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— Chọn khách hàng —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display}
                </option>
              ))}
            </select>
          </Field>
        )}
        {needFromWarehouse && lockedFromWarehouse && (
          <Field label="Từ kho" hint="Máy đang trong kho này — xuất giao từ đúng kho (đồng bộ, không chọn lệch)">
            <div className="rounded-md border border-line bg-appbg px-3 py-2 text-sm font-medium text-slate-700">{device.warehouseName ?? `Kho #${device.warehouseId}`}</div>
            {selectedWarehouse?.address && (
              <div className="mt-1.5 rounded-md bg-appbg px-3 py-2 text-xs text-slate-600"><span className="text-slate-400">Địa chỉ giao: </span>{selectedWarehouse.address}</div>
            )}
          </Field>
        )}
        {needFromWarehouse && !lockedFromWarehouse && (
          <Field label="Từ kho" hint="Chọn kho xuất — địa chỉ kho sẽ hiện bên dưới">
            <select className={inputCls} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">— Không chọn kho —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </select>
            {selectedWarehouse && (
              <div className="mt-1.5 rounded-md bg-appbg px-3 py-2 text-xs text-slate-600">
                <span className="text-slate-400">Địa chỉ giao: </span>
                {selectedWarehouse.address || <span className="italic text-slate-400">kho chưa có địa chỉ</span>}
              </div>
            )}
          </Field>
        )}
        {needToWarehouse && (
          <Field label="Về kho" required hint="Máy thu về kho nào (để lọc/biết máy đang ở kho nào)">
            <select className={inputCls} value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
              <option value="">— Chọn kho nhận —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Thời gian thao tác" hint="Bỏ trống = thời điểm hiện tại">
          <input type="datetime-local" className={inputCls} value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        </Field>
        <Field label="Ghi chú">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-600 hover:bg-appbg">
          Hủy
        </button>
        <button
          onClick={() => (event === 'retire' ? setConfirmRetire(true) : run())}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {EVENT_LABELS[event]}
        </button>
      </div>
    </Modal>
  );
}
