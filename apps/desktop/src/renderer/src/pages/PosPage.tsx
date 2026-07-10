import { useEffect, useState } from 'react';
import { Plus, Loader2, HardDrive, History, Wrench } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTimeSec } from '@glb/shared';
import type { PosDto, TimelineEventDto, CustomerDto, AgentDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { Button } from '../components/Button.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { StatusPill, statusLabel } from '../components/StatusPill.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';

const POS_STATUSES = ['IN_STOCK', 'DEPLOYED', 'IN_REPAIR', 'DAMAGED', 'RETIRED'];

/** Transitions available from each status (mirrors the main-process state machine §A3). */
const NEXT: Record<string, { key: string; label: string }[]> = {
  IN_STOCK: [
    { key: 'deploy', label: 'Triển khai (giao khách)' },
    { key: 'reportDamage', label: 'Báo hỏng' },
    { key: 'retire', label: 'Thanh lý' }
  ],
  DEPLOYED: [
    { key: 'recall', label: 'Thu hồi về kho' },
    { key: 'transferAgent', label: 'Chuyển đại lý' },
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

export function PosPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<PosDto[]>([]);
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [agentId, setAgentId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [timelineOf, setTimelineOf] = useState<PosDto | null>(null);
  const [actionOf, setActionOf] = useState<{ device: PosDto; event: string } | null>(null);

  const canManage = hasPermission(user, 'POS_MANAGE');

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.posList({
      search: search || undefined,
      status: statusFilter || undefined,
      agentId: agentId ? Number(agentId) : undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined
    });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    window.api.agentList().then((r) => r.ok && r.data && setAgents(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetFilters(): void {
    setSearch('');
    setStatusFilter('');
    setAgentId('');
    setFromDate('');
    setToDate('');
    setTimeout(reload, 0);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Quản Lý Máy POS</h2>
          <p className="text-sm text-slate-500">Danh tính = serial bất biến · vòng đời có nhật ký sự kiện.</p>
        </div>
        {canManage && (
          <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Thêm máy POS
          </Button>
        )}
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
          { key: 'status', placeholder: 'Tất cả trạng thái', value: statusFilter, options: POS_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })), onChange: setStatusFilter },
          { key: 'agent', placeholder: 'Tất cả đại lý', value: agentId, options: agents.map((a) => ({ value: String(a.id), label: a.name })), onChange: setAgentId }
        ]}
        onApply={reload}
        onReset={resetFilters}
      />

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Serial</th>
              <th className="px-4 py-3">Ngân hàng</th>
              <th className="px-4 py-3">TID hiện tại</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  <HardDrive className="mx-auto mb-2 h-6 w-6" />
                  Chưa có máy POS.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((d) => (
                <tr key={d.id} className="hover:bg-appbg/60">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{d.serial}</td>
                  <td className="px-4 py-3 text-slate-600">{d.bank ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{d.currentTid ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={d.status} />
                  </td>
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

      {creating && (
        <PosForm
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await reload();
          }}
        />
      )}
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

function PosForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [serial, setSerial] = useState('');
  const [model, setModel] = useState('');
  const [bank, setBank] = useState('');
  const [warehouseLoc, setWarehouseLoc] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (!serial.trim()) return toast.alert('Serial máy POS bắt buộc.');
    setBusy(true);
    const res = await window.api.posCreate({ serial: serial.trim(), model: model || null, bank: bank || null, warehouseLoc: warehouseLoc || null, note: note || null });
    setBusy(false);
    if (res.ok) {
      toast.success(`Đã thêm máy POS ${serial} (Trong kho)`);
      onSaved();
    } else {
      toast.alert(res.message ?? 'Thêm máy POS thất bại');
    }
  }

  return (
    <Modal title="Thêm máy POS mới" onClose={onClose} width="max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Serial" required hint="Danh tính bất biến của máy">
          <input className={inputCls} value={serial} onChange={(e) => setSerial(e.target.value)} autoFocus />
        </Field>
        <Field label="Model">
          <input className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field label="Ngân hàng">
          <input className={inputCls} value={bank} onChange={(e) => setBank(e.target.value)} />
        </Field>
        <Field label="Vị trí kho">
          <input className={inputCls} value={warehouseLoc} onChange={(e) => setWarehouseLoc(e.target.value)} />
        </Field>
        <Field label="Ghi chú">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-600 hover:bg-appbg">
          Hủy
        </button>
        <button onClick={save} disabled={busy} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Thêm máy
        </button>
      </div>
    </Modal>
  );
}

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
  transferAgent: 'Chuyển đại lý',
  reportDamage: 'Báo hỏng',
  sendRepair: 'Gửi bảo trì',
  receiveRepaired: 'Nhận sửa xong',
  retire: 'Thanh lý'
};

function TransitionModal({ device, event, onClose, onDone }: { device: PosDto; event: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const toast = useToast();
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);

  const needCustomer = event === 'deploy';
  const needAgent = event === 'transferAgent';

  useEffect(() => {
    if (needCustomer) window.api.customerList({}).then((r) => r.ok && r.data && setCustomers(r.data));
    if (needAgent) window.api.agentList().then((r) => r.ok && r.data && setAgents(r.data));
  }, [needCustomer, needAgent]);

  async function run(password?: string): Promise<void> {
    if (needCustomer && !customerId) return toast.alert('Phải chọn khách hàng nhận máy.');
    if (needAgent && !agentId) return toast.alert('Phải chọn đại lý đích.');
    setBusy(true);
    const input = {
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : null,
      note: note || null,
      customerId: customerId ? Number(customerId) : null,
      agentId: agentId ? Number(agentId) : null
    };
    let res;
    switch (event) {
      case 'deploy': res = await window.api.posDeploy(device.serial, input); break;
      case 'recall': res = await window.api.posRecall(device.serial, input); break;
      case 'transferAgent': res = await window.api.posTransferAgent(device.serial, input); break;
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
        message={`Thanh lý (RETIRED) máy "${device.serial}" là thao tác không hoàn tác. Nhập lại mật khẩu để xác nhận.`}
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
        <Wrench className="h-4 w-4 text-brand" /> Trạng thái hiện tại: <StatusPill status={device.status} />
      </div>
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
        {needAgent && (
          <Field label="Đại lý đích" required>
            <select className={inputCls} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">— Chọn đại lý —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
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
