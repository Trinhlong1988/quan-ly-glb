// PHASE H2-core — Thu–Chi: Trang Phiếu thu / Phiếu chi (§D/§E). 1 component, prop `kind` phân biệt
// THU (phiếu thu) / CHI (phiếu chi). Form lập phiếu (phiếu chi BẮT BUỘC người chi — I#3) + list
// realtime + lọc (danh mục/quỹ/khoảng ngày) + nút Hủy phiếu (xác nhận mật khẩu + lý do).
// Số dư quỹ tính realtime từ phiếu POSTED (phiếu CANCELLED không tính). Tiền = VND nguyên > 0.
import { useEffect, useState } from 'react';
import { Plus, Ban, Loader2, Receipt, Download, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate } from '@glb/shared';
import type { CashEntryDto, CashflowSummary, CashflowUserLite, EntryCategoryLite, FundDto, CreateCashEntryInput } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';
import { Button } from '../components/Button.js';
import { StatBar } from '../components/StatBar.js';
import { StaleBanner } from '../lib/realtime.js';
import { statusTone } from '../components/StatusPill.js';
import { PasswordInput } from '../components/PasswordInput.js';
import { ImportButton } from '../components/ImportModal.js';
import { exportCsv } from '../lib/exportCsv.js';
import { useRowSelection, SelectAllCell, SelectCell } from '../components/Selection.js';

/** Phiếu hủy TRỰC TIẾP được: thủ công (sourceType=null) + thu tiền bán máy (SALE_COLLECT). Phiếu hệ
 *  thống khác (cọc/thuê/nợ xấu/doanh thu bán máy) phải hủy ở nghiệp vụ gốc — backend cũng chặn (SOURCE_LOCKED). */
function isCancellable(r: CashEntryDto): boolean {
  return r.status === 'POSTED' && (r.sourceType === null || r.sourceType === 'SALE_COLLECT');
}

function money(n: number): string {
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '−' : '') + s + 'đ';
}
/** Ngày hôm nay dạng YYYY-MM-DD (local) cho input[type=date]. */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const map: Record<string, { label: string; cls: string }> = {
    POSTED: { label: 'Đã ghi', cls: 'bg-success/10 text-success' },
    CANCELLED: { label: 'Đã hủy', cls: 'bg-slate-200 text-slate-500' },
    DRAFT: { label: 'Nháp', cls: 'bg-warning/10 text-warning' }
  };
  const s = map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-500' };
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export function CashEntryPage({ user, kind }: { user: AuthUser; kind: 'THU' | 'CHI' }): JSX.Element {
  const toast = useToast();
  const canCreate = hasPermission(user, 'CASHENTRY_CREATE');
  const canCancel = hasPermission(user, 'CASHENTRY_CANCEL');
  const isThu = kind === 'THU';

  const [rows, setRows] = useState<CashEntryDto[]>([]);
  const [summary, setSummary] = useState<CashflowSummary>({ count: 0, totalThu: 0, totalChi: 0, net: 0 });
  const [loading, setLoading] = useState(true);
  const [fCategory, setFCategory] = useState('');
  const [fFund, setFFund] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');

  const [cats, setCats] = useState<EntryCategoryLite[]>([]);
  const [funds, setFunds] = useState<FundDto[]>([]);
  const [users, setUsers] = useState<CashflowUserLite[]>([]);

  const [form, setForm] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CashEntryDto | null>(null);
  const sel = useRowSelection();
  const [bulkOpen, setBulkOpen] = useState(false);

  const kindCats = cats.filter((c) => c.kind === kind);
  const selectableIds = rows.filter(isCancellable).map((r) => r.id);
  const selectedRows = rows.filter((r) => sel.isSelected(r.id));
  const selectedTotal = selectedRows.reduce((s, r) => s + r.amount, 0);

  async function loadRefs(): Promise<void> {
    const [c, f, u] = await Promise.all([window.api.cashEntryCategoryLite(), window.api.fundList({ active: true }), window.api.fundUserLite()]);
    if (c.ok && c.data) setCats(c.data);
    if (f.ok && f.data) setFunds(f.data);
    if (u.ok && u.data) setUsers(u.data);
  }
  async function reload(): Promise<void> {
    setLoading(true);
    sel.clear(); // audit 15/7 — dọn lựa chọn cũ để không thao tác nhầm hàng đã bị lọc/ẩn
    try {
      const res = await window.api.cashEntryList({
        kind,
        categoryId: fCategory ? Number(fCategory) : undefined,
        fundId: fFund ? Number(fFund) : undefined,
        status: fStatus || undefined,
        fromDate: fFrom || undefined,
        toDate: fTo || undefined
      });
      if (res.ok && res.data) { setRows(res.data); setSummary(res.summary ?? { count: 0, totalThu: 0, totalChi: 0, net: 0 }); }
      else if (res.message) toast.alert(res.message);
    } catch (e) {
      // FE-03 (Codex 15/7): IPC reject không được để spinner treo mãi.
      toast.alert(e instanceof Error ? e.message : 'Không tải được dữ liệu (mất kết nối máy chủ?).', 'Lỗi tải dữ liệu');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadRefs(); }, []);
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [kind, fCategory, fFund, fStatus]);

  const totalThisKind = isThu ? summary.totalThu : summary.totalChi;

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">{isThu ? 'Phiếu Thu' : 'Phiếu Chi'}</h2>
          <p className="text-sm text-slate-500">{isThu ? 'Ghi nhận mỗi lần THU tiền (bán máy, doanh thu khác…). Thu công nợ dùng chức năng riêng (pha sau).' : 'Ghi nhận mỗi lần CHI tiền (chi phí, chi lương…). Bắt buộc chọn người chi.'}</p>
        </div>
        {canCreate && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => funds.length ? setForm(true) : toast.alert('Cần tạo ít nhất 1 quỹ trước khi lập phiếu.', 'Thiếu quỹ')}>{isThu ? 'Lập phiếu thu' : 'Lập phiếu chi'}</Button>}
      </div>

      <StatBar items={[
        { label: 'Số phiếu (đã ghi)', value: summary.count, icon: <Receipt className="h-4 w-4" /> },
        { label: isThu ? 'Tổng thu' : 'Tổng chi', value: money(totalThisKind), icon: isThu ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />, tone: isThu ? statusTone('ACTIVE') : 'bg-warning/10 text-warning' }
      ]} />

      <FilterBar search="" onSearch={() => undefined} searchPlaceholder=""
        fromDate={fFrom} toDate={fTo} onFromDate={setFFrom} onToDate={setFTo}
        selects={[
          { key: 'c', placeholder: 'Tất cả danh mục', value: fCategory, options: kindCats.map((c) => ({ value: String(c.id), label: c.name })), onChange: setFCategory },
          { key: 'f', placeholder: 'Tất cả quỹ', value: fFund, options: funds.map((f) => ({ value: String(f.id), label: f.name })), onChange: setFFund },
          { key: 's', placeholder: 'Tất cả trạng thái', value: fStatus, options: [{ value: 'POSTED', label: 'Đã ghi' }, { value: 'CANCELLED', label: 'Đã hủy' }], onChange: setFStatus }
        ]}
        onApply={reload} onReset={() => { setFCategory(''); setFFund(''); setFStatus(''); setFFrom(''); setFTo(''); setTimeout(reload, 0); }} />

      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} phiếu</div>
        <div className="flex items-center gap-2">
        {canCreate && <ImportButton entityKey={isThu ? 'cashThu' : 'cashChi'} label={isThu ? 'Phiếu thu' : 'Phiếu chi'} onImported={reload} />}
        <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv(isThu ? 'phieu_thu' : 'phieu_chi', ['Mã', 'Ngày', 'Danh mục', 'Quỹ', 'Số tiền', 'Hình thức', isThu ? 'Người nhận' : 'Người chi', 'Trạng thái', 'Ghi chú'], rows.map((r) => [r.code ?? '', fmtDate(r.entryDate), r.categoryName ?? '', r.fundName ?? '', String(r.amount), r.method === 'CK' ? 'Chuyển khoản' : 'Tiền mặt', (isThu ? r.receiverUserName : r.payerUserName) ?? '', r.status === 'POSTED' ? 'Đã ghi' : r.status === 'CANCELLED' ? 'Đã hủy' : r.status, r.note ?? '']))}>Xuất Excel</Button>
        </div>
      </div>

      <StaleBanner domain="CashEntry" onReload={reload} className="mb-2" />
      {canCancel && sel.count > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-2.5">
          <span className="text-sm font-medium text-slate-700">Đã chọn <b>{sel.count}</b> phiếu · tổng <b className="tabular-nums">{money(selectedTotal)}</b></span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => sel.clear()} className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">Bỏ chọn</button>
            <button onClick={() => setBulkOpen(true)} className="flex items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-sm font-semibold text-white hover:bg-danger/90"><Ban className="h-4 w-4" /> Hủy {sel.count} phiếu đã chọn</button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm list-scroll">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canCancel && <SelectAllCell ids={selectableIds} sel={sel} />}
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Ngày</th>
              <th className="px-4 py-3">Danh mục</th>
              <th className="px-4 py-3">Quỹ</th>
              <th className="px-4 py-3 text-right">Số tiền</th>
              <th className="px-4 py-3">Hình thức</th>
              <th className="px-4 py-3">{isThu ? 'Người nhận' : 'Người chi'}</th>
              <th className="px-4 py-3">Trạng thái</th>
              {canCancel && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canCancel ? 10 : 8} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canCancel ? 10 : 8} className="px-4 py-10 text-center text-slate-400"><Receipt className="mx-auto mb-2 h-6 w-6" /> Chưa có phiếu {isThu ? 'thu' : 'chi'}.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className={'hover:bg-appbg/60 ' + (r.status === 'CANCELLED' ? 'opacity-60' : '')}>
                {canCancel && (isCancellable(r) ? <SelectCell id={r.id} sel={sel} /> : <td className="px-4 py-3" />)}
                <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{r.code}</td>
                <td className="px-4 py-3 text-slate-600">{fmtDate(r.entryDate)}</td>
                <td className="px-4 py-3 text-slate-700">{r.categoryName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{r.fundName ?? '—'}</td>
                <td className={'px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap ' + (isThu ? 'text-success' : 'text-warning')}>{money(r.amount)}</td>
                <td className="px-4 py-3 text-slate-600">{r.method === 'CK' ? 'Chuyển khoản' : 'Tiền mặt'}</td>
                <td className="px-4 py-3 text-slate-600">{(isThu ? r.receiverUserName : r.payerUserName) ?? '—'}</td>
                <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                {canCancel && (
                  <td className="px-4 py-3"><div className="flex justify-end">
                    {isCancellable(r) && <button title="Hủy phiếu" onClick={() => setCancelTarget(r)} className="rounded-md p-1.5 text-danger transition hover:bg-danger/10"><Ban className="h-4 w-4" /></button>}
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && <CashEntryForm kind={kind} cats={kindCats} funds={funds} users={users} onClose={() => setForm(false)} onSaved={() => { setForm(false); void reload(); }} />}
      {cancelTarget && <CancelEntryModal entry={cancelTarget} isThu={isThu} onClose={() => setCancelTarget(null)} onDone={() => { setCancelTarget(null); void reload(); }} />}
      {bulkOpen && <BulkCancelEntryModal entries={selectedRows} isThu={isThu} onClose={() => setBulkOpen(false)} onDone={() => { setBulkOpen(false); void reload(); }} />}
    </div>
  );
}

/** Hủy hàng loạt phiếu thu/chi: nhập lý do + mật khẩu MỘT lần, gọi cashEntryCancel từng phiếu (mỗi
 *  phiếu = 1 transaction backend, tự re-check quyền + sourceType). Báo cáo TRUNG THỰC số hủy được / bỏ qua. */
function BulkCancelEntryModal({ entries, isThu, onClose, onDone }: { entries: CashEntryDto[]; isThu: boolean; onClose: () => void; onDone: () => void }): JSX.Element {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const total = entries.reduce((s, e) => s + e.amount, 0);

  async function run(): Promise<void> {
    if (!reason.trim()) return toast.alert('Vui lòng nhập lý do hủy phiếu.', 'Thiếu lý do');
    if (!password) return;
    setBusy(true);
    let done = 0;
    const failed: string[] = [];
    for (const e of entries) {
      const res = await window.api.cashEntryCancel(e.id, reason.trim(), password);
      if (res.ok) done++;
      else failed.push(`${e.code ?? '#' + e.id}: ${res.message ?? res.error}`);
    }
    setBusy(false);
    if (done > 0) toast.success(`Đã hủy ${done}/${entries.length} phiếu ${isThu ? 'thu' : 'chi'}.`);
    if (failed.length) toast.alert(`Bỏ qua ${failed.length} phiếu:\n${failed.slice(0, 8).join('\n')}`, 'Kết quả hủy hàng loạt');
    onDone();
  }

  return (
    <Modal title={`Hủy ${entries.length} phiếu ${isThu ? 'thu' : 'chi'} đã chọn`} onClose={onClose} width="max-w-md">
      <p className="text-sm text-slate-600">Tổng tiền <b className="tabular-nums">{money(total)}</b>. Phiếu đã hủy không còn tính vào số dư quỹ. Mỗi phiếu ghi nhật ký riêng; phiếu sinh từ nghiệp vụ khác sẽ bị bỏ qua.</p>
      <Field label="Lý do hủy" required><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      <label className="mt-2 flex flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700">Nhập lại mật khẩu để xác nhận</span>
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="Mật khẩu của bạn" />
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Đóng</Button>
        <button onClick={run} disabled={busy || !password} className="flex items-center gap-2 rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-danger/90 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Hủy {entries.length} phiếu
        </button>
      </div>
    </Modal>
  );
}

function CashEntryForm({ kind, cats, funds, users, onClose, onSaved }: { kind: 'THU' | 'CHI'; cats: EntryCategoryLite[]; funds: FundDto[]; users: CashflowUserLite[]; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const isThu = kind === 'THU';
  // Danh mục cho phép lập phiếu (H2-core chặn công nợ DEBT_*).
  const selectable = cats.filter((c) => c.sourceKind !== 'DEBT_CUSTOMER' && c.sourceKind !== 'DEBT_PARTNER');
  const [categoryId, setCategoryId] = useState<string>(selectable[0] ? String(selectable[0].id) : '');
  const [fundId, setFundId] = useState<string>(funds[0] ? String(funds[0].id) : '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [entryDate, setEntryDate] = useState(todayStr());
  const [payerUserId, setPayerUserId] = useState('');
  const [receiverUserId, setReceiverUserId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0) return toast.alert('Số tiền phải là số nguyên dương (VND).', 'Số tiền không hợp lệ');
    if (!categoryId) return toast.alert('Vui lòng chọn danh mục.', 'Thiếu danh mục');
    if (!fundId) return toast.alert('Vui lòng chọn quỹ.', 'Thiếu quỹ');
    if (!isThu && !payerUserId) return toast.alert('Phiếu chi bắt buộc chọn người chi.', 'Thiếu người chi');
    setBusy(true);
    const input: CreateCashEntryInput = {
      kind, categoryId: Number(categoryId), fundId: Number(fundId), amount: amt, method, entryDate,
      payerUserId: payerUserId ? Number(payerUserId) : null,
      receiverUserId: receiverUserId ? Number(receiverUserId) : null,
      note: note.trim() || null
    };
    const res = await window.api.cashEntryCreate(input);
    setBusy(false);
    if (res.ok) { toast.success(isThu ? 'Đã lập phiếu thu' : 'Đã lập phiếu chi'); onSaved(); }
    else toast.alert(res.message ?? 'Lưu thất bại', 'Không lập được phiếu');
  }

  return (
    <Modal title={isThu ? 'Lập phiếu thu' : 'Lập phiếu chi'} onClose={onClose} width="max-w-lg" onSubmit={() => void save()}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Danh mục" required>
          <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {selectable.length === 0 && <option value="">(chưa có danh mục)</option>}
            {selectable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Quỹ" required>
          <select className={inputCls} value={fundId} onChange={(e) => setFundId(e.target.value)}>
            {funds.length === 0 && <option value="">(chưa có quỹ)</option>}
            {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <Field label="Số tiền (VND)" required hint="Số nguyên đồng, không nhân 1000."><input className={inputCls} type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label="Hình thức" required>
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH">Tiền mặt</option>
            <option value="CK">Chuyển khoản</option>
          </select>
        </Field>
        <Field label="Ngày" required><input className={inputCls} type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></Field>
        {isThu ? (
          <Field label="Người nhận (thu hộ)" hint="Tùy chọn.">
            <select className={inputCls} value={receiverUserId} onChange={(e) => setReceiverUserId(e.target.value)}>
              <option value="">— Không chỉ định —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.code ? `${u.code} · ` : ''}{u.name}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Người chi" required hint="Bắt buộc — chọn nhân sự chi tiền.">
            <select className={inputCls} value={payerUserId} onChange={(e) => setPayerUserId(e.target.value)}>
              <option value="">— Chọn người chi —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.code ? `${u.code} · ` : ''}{u.name}</option>)}
            </select>
          </Field>
        )}
      </div>
      <Field label="Ghi chú"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{isThu ? 'Lập phiếu thu' : 'Lập phiếu chi'}</Button>
      </div>
    </Modal>
  );
}

function CancelEntryModal({ entry, isThu, onClose, onDone }: { entry: CashEntryDto; isThu: boolean; onClose: () => void; onDone: () => void }): JSX.Element {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(): Promise<void> {
    if (!reason.trim()) return toast.alert('Vui lòng nhập lý do hủy phiếu.', 'Thiếu lý do');
    if (!password) return;
    setBusy(true);
    const res = await window.api.cashEntryCancel(entry.id, reason.trim(), password);
    setBusy(false);
    if (res.ok) { toast.success(`Đã hủy phiếu ${entry.code ?? entry.id}`); onDone(); }
    else toast.alert(res.message ?? 'Hủy thất bại', 'Không hủy được phiếu');
  }

  return (
    <Modal title={`Hủy phiếu ${isThu ? 'thu' : 'chi'} ${entry.code ?? ''}`} onClose={onClose} width="max-w-md">
      <p className="text-sm text-slate-600">Phiếu đã hủy sẽ không còn tính vào số dư quỹ. Thao tác được ghi nhật ký.</p>
      <Field label="Lý do hủy" required><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      <label className="mt-2 flex flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700">Nhập lại mật khẩu để xác nhận</span>
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="Mật khẩu của bạn" />
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Đóng</Button>
        <button onClick={run} disabled={busy || !password} className="flex items-center gap-2 rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-danger/90 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Hủy phiếu
        </button>
      </div>
    </Modal>
  );
}
