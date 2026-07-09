import { useEffect, useState } from 'react';
import { Plus, Loader2, CreditCard, Link2, RefreshCw, Undo2, PackageCheck, Send } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission } from '@glb/shared';
import type { TidDto, UndeliveredTidDto, PosDto, CustomerDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { Button } from '../components/Button.js';
import { StatusPill, statusLabel } from '../components/StatusPill.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';

const TID_STATUSES = ['UNASSIGNED', 'ACTIVE', 'DEAD', 'CLOSED', 'RECALLED'];
type Tab = 'all' | 'undelivered';

export function TidPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('all');
  const [rows, setRows] = useState<TidDto[]>([]);
  const [undelivered, setUndelivered] = useState<UndeliveredTidDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState<{ tid: TidDto; kind: 'assign' | 'replace' | 'recall' | 'deliver' } | null>(null);

  const canManage = hasPermission(user, 'TID_MANAGE');

  async function reload(): Promise<void> {
    setLoading(true);
    if (tab === 'all') {
      const res = await window.api.tidList({
        search: search || undefined,
        status: statusFilter || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined
      });
      if (res.ok && res.data) setRows(res.data);
      else if (res.message) toast.alert(res.message);
    } else {
      const res = await window.api.tidUndelivered();
      if (res.ok && res.data) setUndelivered(res.data);
      else if (res.message) toast.alert(res.message);
    }
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusFilter]);

  function resetFilters(): void {
    setSearch('');
    setStatusFilter('');
    setFromDate('');
    setToDate('');
    setTimeout(reload, 0);
  }

  function actionsFor(t: TidDto): { kind: 'assign' | 'replace' | 'recall' | 'deliver'; label: string; icon: JSX.Element }[] {
    const a: { kind: 'assign' | 'replace' | 'recall' | 'deliver'; label: string; icon: JSX.Element }[] = [];
    if (t.status === 'UNASSIGNED') a.push({ kind: 'assign', label: 'Gán POS + khách', icon: <Link2 className="h-3.5 w-3.5" /> });
    if (t.status === 'ACTIVE') {
      a.push({ kind: 'replace', label: 'Đổi TID', icon: <RefreshCw className="h-3.5 w-3.5" /> });
      if (!t.deliveredAt) a.push({ kind: 'deliver', label: 'Đánh dấu đã giao', icon: <PackageCheck className="h-3.5 w-3.5" /> });
    }
    if (['ACTIVE', 'DEAD', 'CLOSED'].includes(t.status)) a.push({ kind: 'recall', label: 'Thu hồi', icon: <Undo2 className="h-3.5 w-3.5" /> });
    return a;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">TID</h2>
          <p className="text-sm text-slate-500">Terminal ID · gán/đổi/thu hồi/giao · theo dõi TID chưa giao.</p>
        </div>
        {canManage && (
          <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Thêm TID
          </Button>
        )}
      </div>

      <div className="mb-3 flex items-center gap-1 border-b border-line">
        <TabBtn active={tab === 'all'} onClick={() => setTab('all')}>
          Tất cả TID
        </TabBtn>
        <TabBtn active={tab === 'undelivered'} onClick={() => setTab('undelivered')}>
          TID chưa giao {undelivered.length > 0 && <span className="ml-1 rounded-full bg-danger px-1.5 text-xs text-white">{undelivered.length}</span>}
        </TabBtn>
      </div>

      {tab === 'all' && (
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Tìm TID / MID…"
          fromDate={fromDate}
          toDate={toDate}
          onFromDate={setFromDate}
          onToDate={setToDate}
          selects={[{ key: 'status', placeholder: 'Tất cả trạng thái', value: statusFilter, options: TID_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })), onChange: setStatusFilter }]}
          onApply={reload}
          onReset={resetFilters}
        />
      )}

      <div className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">TID</th>
              <th className="px-4 py-3">Ngân hàng</th>
              <th className="px-4 py-3">POS</th>
              <th className="px-4 py-3">Trạng thái</th>
              {tab === 'undelivered' && <th className="px-4 py-3">Số ngày tồn</th>}
              {tab === 'all' && canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && tab === 'all' && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  <CreditCard className="mx-auto mb-2 h-6 w-6" />
                  Chưa có TID.
                </td>
              </tr>
            )}
            {!loading && tab === 'undelivered' && undelivered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  <PackageCheck className="mx-auto mb-2 h-6 w-6" />
                  Không có TID nào chưa giao. 🎉
                </td>
              </tr>
            )}
            {!loading &&
              tab === 'all' &&
              rows.map((t) => (
                <tr key={t.id} className="hover:bg-appbg/60">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{t.tid}</td>
                  <td className="px-4 py-3 text-slate-600">{t.bank ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{t.posSerial ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={t.status} />
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {actionsFor(t).map((a) => (
                          <button
                            key={a.kind}
                            onClick={() => setAction({ tid: t, kind: a.kind })}
                            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-slate-600 hover:bg-appbg"
                          >
                            {a.icon} {a.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            {!loading &&
              tab === 'undelivered' &&
              undelivered.map((t) => (
                <tr key={t.id} className={t.agingDays >= 30 ? 'bg-danger/5' : 'hover:bg-appbg/60'}>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{t.tid}</td>
                  <td className="px-4 py-3 text-slate-600">{t.bank ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{t.posSerial ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={t.status} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={'font-semibold ' + (t.agingDays >= 30 ? 'text-danger' : t.agingDays >= 14 ? 'text-warning' : 'text-slate-600')}>
                      {t.agingDays} ngày
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <TidForm
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
        />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={'flex items-center border-b-2 px-4 py-2 text-sm font-medium transition ' + (active ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700')}
    >
      {children}
    </button>
  );
}

function TidForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [tid, setTid] = useState('');
  const [mid, setMid] = useState('');
  const [bank, setBank] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (!tid.trim()) return toast.alert('Số TID bắt buộc.');
    setBusy(true);
    const res = await window.api.tidCreate({ tid: tid.trim(), mid: mid || null, bank: bank || null });
    setBusy(false);
    if (res.ok) {
      toast.success(`Đã thêm TID ${tid} (Chưa gán)`);
      onSaved();
    } else {
      toast.alert(res.message ?? 'Thêm TID thất bại');
    }
  }

  return (
    <Modal title="Thêm TID mới" onClose={onClose} width="max-w-lg">
      <div className="grid grid-cols-1 gap-4">
        <Field label="Số TID" required>
          <input className={inputCls} value={tid} onChange={(e) => setTid(e.target.value)} autoFocus />
        </Field>
        <Field label="MID">
          <input className={inputCls} value={mid} onChange={(e) => setMid(e.target.value)} />
        </Field>
        <Field label="Ngân hàng">
          <input className={inputCls} value={bank} onChange={(e) => setBank(e.target.value)} />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-600 hover:bg-appbg">
          Hủy
        </button>
        <button onClick={save} disabled={busy} className="flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Thêm TID
        </button>
      </div>
    </Modal>
  );
}

const KIND_TITLE: Record<string, string> = {
  assign: 'Gán TID vào máy POS + khách hàng',
  replace: 'Đổi TID (TID cũ chết → TID mới)',
  recall: 'Thu hồi TID',
  deliver: 'Đánh dấu TID đã giao'
};

function TidActionModal({ tid, kind, onClose, onDone }: { tid: TidDto; kind: 'assign' | 'replace' | 'recall' | 'deliver'; onClose: () => void; onDone: () => void }): JSX.Element {
  const toast = useToast();
  const [devices, setDevices] = useState<PosDto[]>([]);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [posSerial, setPosSerial] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [newTid, setNewTid] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (kind === 'assign') {
      window.api.posList({}).then((r) => r.ok && r.data && setDevices(r.data));
      window.api.customerList({}).then((r) => r.ok && r.data && setCustomers(r.data));
    }
  }, [kind]);

  async function run(): Promise<void> {
    setBusy(true);
    const when = occurredAt ? new Date(occurredAt).toISOString() : null;
    let res;
    if (kind === 'assign') {
      if (!posSerial) { setBusy(false); return toast.alert('Phải chọn máy POS.'); }
      if (!customerId) { setBusy(false); return toast.alert('Phải chọn khách hàng.'); }
      res = await window.api.tidAssign(tid.tid, { posSerial, customerId: Number(customerId), occurredAt: when, note: note || null });
    } else if (kind === 'replace') {
      if (!newTid.trim()) { setBusy(false); return toast.alert('Phải nhập TID mới (đã tạo sẵn, trạng thái Chưa gán).'); }
      res = await window.api.tidReplace(tid.tid, { newTid: newTid.trim(), occurredAt: when, note: note || null });
    } else if (kind === 'recall') {
      res = await window.api.tidRecall(tid.tid, { occurredAt: when, note: note || null });
    } else {
      res = await window.api.tidMarkDelivered(tid.tid, { deliveredAt: when, note: note || null });
    }
    setBusy(false);
    if (res.ok) {
      toast.success(`${KIND_TITLE[kind]} — thành công cho TID ${tid.tid}`);
      onDone();
    } else {
      toast.alert(res.message ?? 'Thao tác thất bại');
    }
  }

  return (
    <Modal title={`${KIND_TITLE[kind]} — ${tid.tid}`} onClose={onClose} width="max-w-lg">
      <div className="grid grid-cols-1 gap-4">
        {kind === 'assign' && (
          <>
            <Field label="Máy POS" required>
              <select className={inputCls} value={posSerial} onChange={(e) => setPosSerial(e.target.value)}>
                <option value="">— Chọn máy POS —</option>
                {devices.map((d) => (
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
                  <option key={c.id} value={c.id}>
                    {c.display}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        {kind === 'replace' && (
          <Field label="TID mới" required hint="TID mới phải đã được tạo và ở trạng thái Chưa gán">
            <input className={inputCls} value={newTid} onChange={(e) => setNewTid(e.target.value)} autoFocus />
          </Field>
        )}
        <Field label={kind === 'deliver' ? 'Thời gian giao' : 'Thời gian thao tác'} hint="Bỏ trống = hiện tại">
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
        <button onClick={run} disabled={busy} className="flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {kind === 'assign' ? 'Gán TID' : kind === 'replace' ? 'Đổi TID' : kind === 'recall' ? 'Thu hồi' : 'Đã giao'}
          {kind !== 'assign' && kind !== 'replace' && <Send className="h-3.5 w-3.5" />}
        </button>
      </div>
    </Modal>
  );
}
