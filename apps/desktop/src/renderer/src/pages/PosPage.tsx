import { useEffect, useState } from 'react';
import { Loader2, HardDrive, History, Wrench, Download, List, PackagePlus, Building2, Cpu, Tag } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTimeSec } from '@glb/shared';
import type { PosDto, TimelineEventDto, CustomerDto, LiteRef } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { Button } from '../components/Button.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { StatusBadge, useStatusOptions, toneCls } from '../components/StatusBadge.js';
import { StatBar } from '../components/StatBar.js';
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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // LANE B (#24) — lọc "Chủng loại" phía client trên tập rows (posList trả full, không phân trang).
  const [modelFilter, setModelFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [timelineOf, setTimelineOf] = useState<PosDto | null>(null);
  const [actionOf, setActionOf] = useState<{ device: PosDto; event: string } | null>(null);

  const canManage = hasPermission(user, 'POS_MANAGE');
  // R14 — danh mục trạng thái máy POS (entity POS_DEVICE) từ catalog tùy biến.
  const { options: posOptions, byCode: posByCode } = useStatusOptions('POS_DEVICE');
  const posStatusLabel = (code: string): string => posByCode.get(code)?.label ?? code;

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.posList({
      search: search || undefined,
      status: statusFilter || undefined,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lọc chủng loại (client-side) trên tập đã lọc phía server. Ưu tiên posModelId; nếu DTO thiếu id
  // nhưng có tên khớp option đang chọn thì fallback theo posModelName.
  const selectedModel = models.find((m) => String(m.id) === modelFilter);
  const filteredRows = modelFilter
    ? rows.filter((d) =>
        d.posModelId != null
          ? String(d.posModelId) === modelFilter
          : !!selectedModel && d.posModelName === selectedModel.name
      )
    : rows;

  function resetFilters(): void {
    setSearch('');
    setStatusFilter('');
    setModelFilter('');
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
                ['Serial', 'Chủng loại', 'Nhà cung cấp', 'Giá nhập', 'Ngày nhập', 'Trạng thái', 'TID hiện tại', 'Khách'],
                filteredRows.map((d) => [d.serial, d.posModelName ?? '', d.supplierName ?? '', d.importPrice ?? '', d.importedAt ? fmtDate(d.importedAt) : '', posStatusLabel(d.status), d.currentTid ?? '', d.customerName ?? ''])
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
          { key: 'model', placeholder: 'Tất cả chủng loại', value: modelFilter, options: models.map((m) => ({ value: String(m.id), label: m.name })), onChange: setModelFilter }
        ]}
        onApply={reload}
        onReset={resetFilters}
      />

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
              <th className="px-4 py-3">TID hiện tại</th>
              <th className="px-4 py-3">Khách</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && filteredRows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                  <HardDrive className="mx-auto mb-2 h-6 w-6" />
                  {rows.length === 0 ? 'Chưa có máy POS.' : 'Không có máy POS khớp bộ lọc.'}
                </td>
              </tr>
            )}
            {!loading &&
              filteredRows.map((d) => (
                <tr key={d.id} className="hover:bg-appbg/60">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{d.serial}</td>
                  <td className="px-4 py-3 text-slate-600">{d.posModelName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{d.supplierName ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{fmtVnd(d.importPrice)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{d.importedAt ? fmtDate(d.importedAt) : '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge entity="POS_DEVICE" code={d.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{d.currentTid ?? '—'}</td>
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
    </div>
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
  reportDamage: 'Báo hỏng',
  sendRepair: 'Gửi bảo trì',
  receiveRepaired: 'Nhận sửa xong',
  retire: 'Thanh lý'
};

function TransitionModal({ device, event, onClose, onDone }: { device: PosDto; event: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const toast = useToast();
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);

  const needCustomer = event === 'deploy';

  useEffect(() => {
    if (needCustomer) window.api.customerList({}).then((r) => r.ok && r.data && setCustomers(r.data));
  }, [needCustomer]);

  async function run(password?: string): Promise<void> {
    if (needCustomer && !customerId) return toast.alert('Phải chọn khách hàng nhận máy.');
    setBusy(true);
    const input = {
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : null,
      note: note || null,
      customerId: customerId ? Number(customerId) : null,
      agentId: null
    };
    let res;
    switch (event) {
      case 'deploy': res = await window.api.posDeploy(device.serial, input); break;
      case 'recall': res = await window.api.posRecall(device.serial, input); break;
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
      <div className="grid grid-cols-1 gap-4">
        {needCustomer && (
          <Field label="Khách hàng nhận máy" required>
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
