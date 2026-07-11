import { useEffect, useState } from 'react';
import { Plus, Loader2, CreditCard, Link2, RefreshCw, Undo2, PackageCheck, Send, Download, History, Tag } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate } from '@glb/shared';
import type { TidDto, UndeliveredTidDto, PosDto, CustomerDto, AgentDto, TidRefs, TimelineEventDto, CreateTidInput } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { Button } from '../components/Button.js';
import { StatusPill, statusLabel, statusTone } from '../components/StatusPill.js';
import { StatBar } from '../components/StatBar.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';
import { ImportButton } from '../components/ImportModal.js';
import { exportCsv } from '../lib/exportCsv.js';
import { StatusTab, FeePreview } from './TidConfigPage.js';

const TID_STATUSES = ['UNASSIGNED', 'ACTIVE', 'DEAD', 'CLOSED', 'RECALLED'];
type Tab = 'all' | 'undelivered' | 'status';

export function TidPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const canView = hasPermission(user, 'TID_VIEW') || hasPermission(user, 'CONFIG_TID_VIEW');
  const canOps = hasPermission(user, 'TID_MANAGE'); // gán/đổi/thu hồi/giao (vận hành)
  const canConfig = hasPermission(user, 'CONFIG_TID_MANAGE'); // thêm/sửa/xóa cấu hình
  const canConfigView = hasPermission(user, 'CONFIG_TID_VIEW');

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
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState<{ tid: TidDto; kind: 'assign' | 'replace' | 'recall' | 'deliver' } | null>(null);
  const [timelineTid, setTimelineTid] = useState<TidDto | null>(null);

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
        fromDate: fromDate || undefined,
        toDate: toDate || undefined
      });
      if (res.ok && res.data) setRows(res.data);
      else if (res.message) toast.alert(res.message);
    }
    setLoading(false);
  }
  useEffect(() => {
    if (tab !== 'status') void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusFilter, assignFilter, deliverFilter, industryFilter]);

  // LANE A (#11): nạp danh sách ngành nghề (active) cho bộ lọc — dùng tidRefs (không cần quyền ngành nghề).
  useEffect(() => {
    if (canView) window.api.tidRefs().then((r) => r.ok && r.data && setIndustries(r.data.industries));
  }, [canView]);

  function resetFilters(): void {
    setSearch('');
    setStatusFilter('');
    setAssignFilter('');
    setDeliverFilter('');
    setIndustryFilter('');
    setFromDate('');
    setToDate('');
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
          {tab === 'all' && (
            <Button
              variant="confirm"
              icon={<Download className="h-4 w-4" />}
              onClick={() =>
                exportCsv(
                  'tid',
                  ['TID', 'MID', 'HKD', 'Ngành nghề', 'Ngân hàng', 'Đối tác', 'Gán máy POS', 'Giao cho khách', 'Vòng đời'],
                  rows.map((t) => [t.tid, t.mid ?? '', t.hkdName ?? '', t.industryName ?? '', t.bankCode ?? t.bank ?? '', t.partnerName ?? '', t.deviceAssigned ? (t.posSerial ?? 'Đã gán') : (t.customerDeviceSerial ? 'Máy khách' : 'Chưa gán'), t.delivered ? 'Đã giao' : 'Chưa giao', statusLabel(t.status)])
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

      <div className="mb-3 flex items-center gap-1 border-b border-line">
        <TabBtn active={tab === 'all'} onClick={() => setTab('all')}>
          <CreditCard className="mr-1 h-4 w-4" /> Danh sách TID
        </TabBtn>
        <TabBtn active={tab === 'undelivered'} onClick={() => setTab('undelivered')}>
          <PackageCheck className="mr-1 h-4 w-4" /> TID chưa giao {undelivered.length > 0 && <span className="ml-1 rounded-full bg-danger px-1.5 text-xs text-white">{undelivered.length}</span>}
        </TabBtn>
        {canConfigView && (
          <TabBtn active={tab === 'status'} onClick={() => setTab('status')}>
            <Tag className="mr-1 h-4 w-4" /> Trạng thái TID cấu hình
          </TabBtn>
        )}
      </div>

      {tab === 'status' && <StatusTab canManage={canConfig} />}

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
            { key: 'assign', placeholder: 'Gán máy POS (tất cả)', value: assignFilter, options: [{ value: 'yes', label: 'Đã gán máy' }, { value: 'no', label: 'Chưa gán máy' }], onChange: setAssignFilter },
            { key: 'deliver', placeholder: 'Giao cho khách (tất cả)', value: deliverFilter, options: [{ value: 'yes', label: 'Đã giao' }, { value: 'no', label: 'Chưa giao' }], onChange: setDeliverFilter },
            { key: 'industry', placeholder: 'Ngành nghề (tất cả)', value: industryFilter, options: industries.map((i) => ({ value: String(i.id), label: `${i.code} · ${i.name}` })), onChange: setIndustryFilter },
            { key: 'status', placeholder: 'Tất cả trạng thái', value: statusFilter, options: TID_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })), onChange: setStatusFilter }
          ]}
          onApply={reload}
          onReset={resetFilters}
        />
      )}

      {tab !== 'status' && (
        <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">TID</th>
                <th className="px-4 py-3">HKD</th>
                <th className="px-4 py-3">Ngành nghề</th>
                <th className="px-4 py-3">Ngân hàng</th>
                <th className="px-4 py-3">Gán máy POS</th>
                <th className="px-4 py-3">Giao cho khách</th>
                <th className="px-4 py-3">Trạng thái</th>
                {tab === 'undelivered' && <th className="px-4 py-3">Số ngày tồn</th>}
                {tab === 'all' && <th className="px-4 py-3 text-right">Thao tác</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              )}
              {!loading && tab === 'all' && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                    <CreditCard className="mx-auto mb-2 h-6 w-6" />
                    Chưa có TID.
                  </td>
                </tr>
              )}
              {!loading && tab === 'undelivered' && undelivered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                    <PackageCheck className="mx-auto mb-2 h-6 w-6" />
                    Không có TID nào chưa giao. 🎉
                  </td>
                </tr>
              )}
              {!loading && (tab === 'all' ? rows : undelivered).map((t) => (
                <tr key={t.id} className={tab === 'undelivered' && (t as UndeliveredTidDto).agingDays >= 30 ? 'bg-danger/5' : 'hover:bg-appbg/60'}>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{t.tid}</td>
                  <td className="px-4 py-3 text-slate-600">{t.hkdName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{t.industryName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{t.bankCode ?? t.bank ?? '—'}</td>
                  <td className="px-4 py-3">
                    <AssignCell t={t} />
                  </td>
                  <td className="px-4 py-3">
                    <DeliverCell t={t} />
                  </td>
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
                  {tab === 'all' && (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        <button onClick={() => setTimelineTid(t)} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-slate-600 hover:bg-appbg hover:brightness-110">
                          <History className="h-3.5 w-3.5" /> Vòng đời TID
                        </button>
                        {canOps &&
                          actionsFor(t).map((a) => (
                            <button
                              key={a.kind}
                              onClick={() => setAction({ tid: t, kind: a.kind })}
                              className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-slate-600 hover:bg-appbg hover:brightness-110"
                            >
                              {a.icon} {a.label}
                            </button>
                          ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
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
        />
      )}
      {timelineTid && <TidTimelineModal tid={timelineTid} onClose={() => setTimelineTid(null)} />}
    </div>
  );
}

function AssignCell({ t }: { t: TidDto }): JSX.Element {
  if (t.deviceAssigned) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-brand-tint px-1.5 py-0.5 text-xs font-medium text-brand">Đã gán máy</span>
        {t.posSerial && <span className="font-mono text-xs text-slate-500">{t.posSerial}</span>}
      </div>
    );
  }
  if (t.customerDeviceSerial) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">Máy khách</span>
        <span className="font-mono text-xs text-slate-500">{t.customerDeviceSerial}</span>
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

// ── Form Thêm TID — chuỗi phụ thuộc HKD → đối tác → ngân hàng (PartnerBank) + chế độ gán/giao ──
function TidCreateForm({ canOps, onClose, onSaved }: { canOps: boolean; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [refs, setRefs] = useState<TidRefs | null>(null);
  const [devices, setDevices] = useState<PosDto[]>([]);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [agents, setAgents] = useState<AgentDto[]>([]);
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
  const [deliverAgentId, setDeliverAgentId] = useState('');
  const [deliveredAt, setDeliveredAt] = useState('');

  useEffect(() => {
    window.api.tidRefs().then((r) => r.ok && r.data && setRefs(r.data));
    if (canOps) {
      window.api.posList({}).then((r) => r.ok && r.data && setDevices(r.data));
      window.api.customerList({}).then((r) => r.ok && r.data && setCustomers(r.data));
      window.api.agentList().then((r) => r.ok && r.data && setAgents(r.data));
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
      deliver: wantDeliver ? { deliveredAt: deliveredAt ? new Date(deliveredAt).toISOString() : null, customerId: Number(deliverCust), toAgentId: deliverAgentId ? Number(deliverAgentId) : null } : undefined
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
                  <label className="flex items-center gap-1.5"><input type="radio" checked={assignMode === 'pos'} onChange={() => setAssignMode('pos')} /> Gán máy của ta (IN_STOCK)</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={assignMode === 'customer'} onChange={() => setAssignMode('customer')} /> Máy của khách</label>
                </div>
                {assignMode === 'pos' && (
                  <div className="mt-3 grid grid-cols-2 gap-4">
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
                    <Field label="Đại lý" hint="Tùy chọn">
                      <select className={inputCls} value={deliverAgentId} onChange={(e) => setDeliverAgentId(e.target.value)}>
                        <option value="">— Không qua đại lý —</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </Field>
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

function TidActionModal({ tid, kind, onClose, onDone }: { tid: TidDto; kind: 'assign' | 'replace' | 'recall' | 'deliver'; onClose: () => void; onDone: () => void }): JSX.Element {
  const toast = useToast();
  const [devices, setDevices] = useState<PosDto[]>([]);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [posSerial, setPosSerial] = useState('');
  const [customerId, setCustomerId] = useState(tid.customerId ? String(tid.customerId) : '');
  const [agentId, setAgentId] = useState('');
  const [newTid, setNewTid] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (kind === 'assign') {
      window.api.posList({}).then((r) => r.ok && r.data && setDevices(r.data));
      window.api.customerList({}).then((r) => r.ok && r.data && setCustomers(r.data));
    }
    if (kind === 'deliver') {
      window.api.customerList({}).then((r) => r.ok && r.data && setCustomers(r.data));
      window.api.agentList().then((r) => r.ok && r.data && setAgents(r.data));
    }
  }, [kind]);

  async function run(): Promise<void> {
    const when = occurredAt ? new Date(occurredAt).toISOString() : null;
    let res;
    if (kind === 'assign') {
      if (!posSerial) return toast.alert('Phải chọn máy POS.');
      if (!customerId) return toast.alert('Phải chọn khách hàng.');
      setBusy(true);
      res = await window.api.tidAssign(tid.tid, { posSerial, customerId: Number(customerId), occurredAt: when, note: note || null });
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
      res = await window.api.tidMarkDelivered(tid.tid, { deliveredAt: when, customerId: Number(customerId), toAgentId: agentId ? Number(agentId) : null, note: note || null });
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
            <Field label="Đại lý" hint="Tùy chọn — giao trực tiếp thì bỏ trống">
              <select className={inputCls} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">— Không qua đại lý —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
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
        <Button variant="confirm" onClick={run} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}>
          {kind === 'assign' ? 'Gán TID' : kind === 'replace' ? 'Đổi TID' : kind === 'recall' ? 'Thu hồi' : 'Đã giao'}
        </Button>
      </div>
    </Modal>
  );
}

const TID_EVENT_LABELS: Record<string, string> = {
  STOCK_IN: 'Nhập kho',
  TID_ASSIGN: 'Gán lên máy',
  TID_DELIVERED: 'Giao cho khách',
  TID_RECALL: 'Thu hồi TID',
  TID_DEAD: 'TID chết (đổi)',
  TID_REPLACE: 'TID mới thay thế',
  TID_UNBIND: 'Gỡ khỏi máy',
  DEPLOY: 'Triển khai máy',
  RECALL: 'Thu hồi máy',
  RETIRE: 'Thanh lý'
};

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
                    {e.fromState} → {e.toState}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-500">{fmtDate(e.occurredAt)}</div>
              {(e.customerId != null || e.toAgentId != null) && (
                <div className="mt-0.5 text-xs text-slate-500">
                  {e.customerId != null && <>Khách #{e.customerId} </>}
                  {e.toAgentId != null && <>· Đại lý #{e.toAgentId}</>}
                </div>
              )}
              {e.note && <div className="mt-0.5 text-sm text-slate-600">{e.note}</div>}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
