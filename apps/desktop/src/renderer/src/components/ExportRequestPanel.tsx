import { useEffect, useMemo, useState } from 'react';
import { Loader2, PackagePlus, PackageOpen, Ban } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTimeSec, groupDigits } from '@glb/shared';
import type {
  ExportRequestDto,
  ExportRequestKpi,
  BankLite,
  CustomerDto,
  FundDto,
  PartnerDto,
  FeeTypeDto,
  CreateExportRequestInput
} from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from './Modal.js';
import { Button } from './Button.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { Field, inputCls } from './Field.js';
import { SearchSelect } from './SearchSelect.js';
import { StatBar } from './StatBar.js';
import { FilterBar } from './FilterBar.js';
import { usePagination } from './Pagination.js';

/** VND, nhóm 3 số bằng dấu chấm (KHÔNG toLocaleString — R_UI QA gate).
 *  G2: nhận CHUỖI thập phân (money DTO) HOẶC number — format từ chuỗi, không tính float. */
function money(n: number | string): string {
  if (typeof n === 'string') {
    const m = /^(-?)(\d+)$/.exec(n.trim());
    if (!m) return n + 'đ';
    return (m[1] ? '−' : '') + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
  }
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '−' : '') + s + 'đ';
}

/** G2: chỉ giữ chữ số (chuỗi tiền IPC) — bỏ dấu phân tách/ký tự lạ. */
function digitsOnly(s: string): string {
  return (s ?? '').replace(/[^\d]/g, '');
}

const HANDOVER_LABEL: Record<string, string> = { SALE: 'Bán', RENT: 'Cho thuê' };

/** Badge trạng thái phiếu yêu cầu xuất kho (nhãn tiếng Việt cố định — entity chưa vào StatusOption). */
export function ExportReqStatusBadge({ status }: { status: string }): JSX.Element {
  const map: Record<string, { label: string; cls: string }> = {
    PENDING: { label: 'Chờ duyệt', cls: 'bg-amber-50 text-amber-600' },
    APPROVED: { label: 'Đã duyệt', cls: 'bg-emerald-50 text-emerald-600' },
    REJECTED: { label: 'Từ chối', cls: 'bg-rose-50 text-rose-600' },
    CANCELLED: { label: 'Đã hủy', cls: 'bg-slate-100 text-slate-500' }
  };
  const s = map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-500' };
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

/**
 * Cụm "Yêu cầu xuất kho" dùng chung cho tab trong Quản Lý Máy POS (kind=POS, PHASE 2) và
 * Quản Lý TID (kind=TID, PHASE 3). Tạo phiếu (chưa seri) → danh sách + KPI + phân trang + hủy phiếu chờ.
 * Người DUYỆT chọn seri/TID + trừ tồn kho ở trang "Duyệt xuất kho" (PHASE 4).
 */
export function ExportRequestPanel({ user, kind }: { user: AuthUser; kind: 'POS' | 'TID' }): JSX.Element {
  const toast = useToast();
  const canCreate = hasPermission(user, 'EXPORT_REQUEST_CREATE');
  const [rows, setRows] = useState<ExportRequestDto[]>([]);
  const [kpi, setKpi] = useState<ExportRequestKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [handoverFilter, setHandoverFilter] = useState(''); // '' | SALE | RENT (client-side)
  const [search, setSearch] = useState(''); // tìm client-side theo mã phiếu / khách
  const [creating, setCreating] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ExportRequestDto | null>(null);

  async function reload(): Promise<void> {
    setLoading(true);
    try { // FE53-02: list reject KHÔNG được để loading kẹt + unhandled.
      const res = await window.api.exportReqList({ kind, status: statusFilter || undefined });
      if (res.ok && res.data) {
        setRows(res.data);
        setKpi(res.kpi ?? null);
      } else if (res.message) toast.alert(res.message);
    } catch (e) {
      toast.alert(e instanceof Error ? e.message : 'Không tải được danh sách phiếu.', 'Lỗi tải');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const q = search.trim().toLowerCase();
  const filteredRows = rows.filter((r) =>
    (!handoverFilter || r.handoverKind === handoverFilter) &&
    (!q || (r.code ?? '').toLowerCase().includes(q) || (r.customerName ?? '').toLowerCase().includes(q))
  );
  const { pageRows, bar } = usePagination(filteredRows, 50);

  async function doCancel(r: ExportRequestDto): Promise<void> {
    try { // FE53-02: cancel reject KHÔNG được để dialog kẹt mở.
      const res = await window.api.exportReqCancel(r.id);
      if (res.ok) toast.success(`Đã hủy phiếu yêu cầu xuất kho ${r.code ?? r.id}`);
      else toast.alert(res.message ?? 'Không hủy được phiếu.', 'Hủy thất bại');
    } catch (e) {
      toast.alert(e instanceof Error ? e.message : 'Không hủy được phiếu.', 'Hủy thất bại');
    } finally {
      setCancelTarget(null);
      await reload();
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{filteredRows.length} phiếu yêu cầu xuất kho {kind}</div>
        {canCreate && (
          <Button variant="confirm" icon={<PackagePlus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Tạo phiếu yêu cầu
          </Button>
        )}
      </div>

      <StatBar
        items={[
          { label: 'Chờ duyệt', value: kpi?.pending ?? 0, tone: 'bg-amber-50 text-amber-600' },
          { label: 'Đã duyệt', value: kpi?.approved ?? 0, tone: 'bg-emerald-50 text-emerald-600' },
          { label: 'Từ chối', value: kpi?.rejected ?? 0, tone: 'bg-rose-50 text-rose-600' },
          { label: 'Đã hủy', value: kpi?.cancelled ?? 0, tone: 'bg-slate-100 text-slate-500' },
          { label: 'Tổng phiếu', value: kpi?.total ?? 0, tone: 'bg-brand-tint text-brand' }
        ]}
      />

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Tìm mã phiếu / khách…"
        debounceMs={0}
        selects={[
          { key: 'status', placeholder: 'Tất cả trạng thái', value: statusFilter, options: [
            { value: 'PENDING', label: 'Chờ duyệt' },
            { value: 'APPROVED', label: 'Đã duyệt' },
            { value: 'REJECTED', label: 'Từ chối' },
            { value: 'CANCELLED', label: 'Đã hủy' }
          ], onChange: setStatusFilter },
          { key: 'handover', placeholder: 'Tất cả hình thức', value: handoverFilter, options: [
            { value: 'SALE', label: 'Bán' },
            { value: 'RENT', label: 'Cho thuê' }
          ], onChange: setHandoverFilter }
        ]}
        onApply={reload}
        onReset={() => { setStatusFilter(''); setHandoverFilter(''); setSearch(''); /* FE53-03: reload tự chạy qua useEffect([statusFilter]); search/handover lọc client-side — không setTimeout(reload) đọc filter cũ */ }}
      />

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-20 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Mã phiếu</th>
              <th className="px-4 py-3">Hình thức</th>
              <th className="px-4 py-3">Khách hàng</th>
              {kind === 'TID' && <th className="px-4 py-3">Ngân hàng</th>}
              <th className="px-4 py-3 text-right">SL</th>
              <th className="px-4 py-3 text-right">Đơn giá</th>
              <th className="px-4 py-3 text-right">Thành tiền</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3 whitespace-nowrap">Ngày · giờ tạo</th>
              <th className="px-4 py-3">Người duyệt</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr><td colSpan={kind === 'TID' ? 11 : 10} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            )}
            {!loading && filteredRows.length === 0 && (
              <tr><td colSpan={kind === 'TID' ? 11 : 10} className="px-4 py-10 text-center text-slate-400"><PackageOpen className="mx-auto mb-2 h-6 w-6" /> Chưa có phiếu yêu cầu xuất kho.</td></tr>
            )}
            {!loading && pageRows.map((r) => (
              <tr key={r.id} className="hover:bg-appbg/60">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">{r.code ?? `#${r.id}`}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="rounded-full bg-brand-tint/60 px-2 py-0.5 text-xs font-semibold text-brand">{HANDOVER_LABEL[r.handoverKind] ?? r.handoverKind}</span>
                  {r.withTid && <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">kèm TID</span>}
                  {r.method === 'CK' && <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-600">CK</span>}
                </td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.customerName ?? '—'}</td>
                {kind === 'TID' && <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.bankName ?? '—'}</td>}
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">{r.quantity}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700 whitespace-nowrap">{money(r.unitPrice)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800 whitespace-nowrap">{money(r.amount)}</td>
                <td className="px-4 py-3"><ExportReqStatusBadge status={r.status} /></td>
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(r.requestedAt)} {fmtTimeSec(r.requestedAt)}</td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.decidedByName ?? '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {r.status === 'PENDING' && r.isMine && (
                      <button onClick={() => setCancelTarget(r)} title="Hủy phiếu chờ duyệt của tôi" className="rounded-md border border-danger/30 bg-danger/5 p-1.5 text-danger hover:brightness-110">
                        <Ban className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bar}

      {creating && (
        <ExportRequestForm
          kind={kind}
          onClose={() => setCreating(false)}
          onSaved={async () => { setCreating(false); await reload(); }}
        />
      )}
      {cancelTarget && (
        <ConfirmDialog
          title="Hủy phiếu yêu cầu xuất kho"
          message={`Hủy phiếu "${cancelTarget.code ?? cancelTarget.id}" đang chờ duyệt? Phiếu chưa trừ tồn kho nên hủy an toàn.`}
          confirmLabel="Hủy phiếu"
          danger
          onCancel={() => setCancelTarget(null)}
          onConfirm={() => doCancel(cancelTarget)}
        />
      )}
    </div>
  );
}

/** Ô nhập tiền VND (nhóm nghìn kiểu VN, lưu số trần). */
function MoneyInput({ value, onChange, placeholder, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }): JSX.Element {
  return (
    <input
      className={inputCls + ' text-right tabular-nums' + (disabled ? ' bg-slate-50 text-slate-400' : '')}
      inputMode="numeric"
      value={groupDigits(value)}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
      placeholder={placeholder ?? '0'}
    />
  );
}

/** Form tạo phiếu yêu cầu xuất kho (chưa seri — seri chọn khi DUYỆT). POS = PHASE 2, TID = PHASE 3. */
function ExportRequestForm({ kind, onClose, onSaved }: { kind: 'POS' | 'TID'; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [funds, setFunds] = useState<FundDto[]>([]);
  const [partners, setPartners] = useState<PartnerDto[]>([]);
  const [feeTypes, setFeeTypes] = useState<FeeTypeDto[]>([]);

  const [bankId, setBankId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [feeTypeId, setFeeTypeId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [handoverKind, setHandoverKind] = useState<'SALE' | 'RENT'>('SALE');
  const [withTid, setWithTid] = useState(false); // POS Bán/Cho thuê có thể kèm TID hoặc bán rời
  const [method, setMethod] = useState<'CASH' | 'CK'>('CASH'); // Mr.Long 14/7 — hình thức thanh toán
  // PHASE 3 — hình thức giao TID: 'tid' giao riêng TID (ở đây) | 'pos' kèm máy POS (nhắc quay về tab POS).
  const [tidDelivery, setTidDelivery] = useState<'tid' | 'pos'>('tid');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [fundId, setFundId] = useState('');
  const now = new Date();
  const [reqDate, setReqDate] = useState(now.toISOString().slice(0, 10));
  const [reqTime, setReqTime] = useState(now.toTimeString().slice(0, 5));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.bankLite().then((r) => r.ok && r.data && setBanks(r.data));
    window.api.customerList({}).then((r) => r.ok && r.data && setCustomers(r.data));
    window.api.fundList({}).then((r) => r.ok && r.data && setFunds(r.data.filter((f) => f.active)));
    if (kind === 'TID') {
      window.api.partnerList({}).then((r) => r.ok && r.data && setPartners(r.data));
      window.api.feeTypeList().then((r) => r.ok && r.data && setFeeTypes(r.data));
    }
  }, [kind]);

  // RENT thu qua đơn giá thuê khi duyệt → không nhập "đã thanh toán". Chọn RENT thì xóa paid.
  // Mr.Long 14/7 — BÁN máy POS cũng chọn kèm TID / bán rời (KHÔNG khóa withTid cho SALE nữa).
  useEffect(() => {
    if (handoverKind === 'RENT') setPaidAmount('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoverKind]);

  // G2: SỐ LƯỢNG là số đếm (Number OK). MỌI trường TIỀN tính/so sánh bằng BIGINT — KHÔNG qua Number.
  const qty = Number(quantity) || 0;
  const toBig = (s: string): bigint => { try { return BigInt(digitsOnly(s) || '0'); } catch { return 0n; } };
  const priceB = toBig(unitPrice);
  const depositB = toBig(depositAmount);
  const paidB = toBig(paidAmount);
  const amountB = priceB * BigInt(qty >= 0 ? qty : 0);
  const amountStr = amountB.toString();
  const needsFund = paidB > 0n || depositB > 0n || handoverKind === 'RENT';

  const bankOptions = useMemo(() => banks.map((b) => ({ value: String(b.id), label: `${b.code} · ${b.name}` })), [banks]);
  const customerOptions = useMemo(() => customers.map((c) => ({ value: String(c.id), label: c.display })), [customers]);

  async function save(): Promise<void> {
    if (kind === 'TID' && tidDelivery === 'pos') return toast.alert('Giao TID KÈM máy POS: hãy tạo phiếu ở tab "Yêu cầu xuất kho" trong Quản Lý Máy POS (chọn Cho thuê kèm TID).', 'Quay về giao ở POS');
    if (!customerId) return toast.alert('Vui lòng chọn khách hàng.', 'Thiếu thông tin');
    if (!Number.isInteger(qty) || qty < 1) return toast.alert('Số lượng phải là số nguyên ≥ 1.', 'Số lượng không hợp lệ');
    if (!(priceB > 0n)) return toast.alert('Đơn giá phải > 0.', 'Số tiền không hợp lệ');
    if (kind === 'TID') {
      if (!bankId) return toast.alert('Yêu cầu TID phải chọn ngân hàng (khớp TID khi duyệt).', 'Thiếu ngân hàng');
      if (!partnerId) return toast.alert('Yêu cầu TID phải chọn đối tác (khớp TID khi duyệt).', 'Thiếu đối tác');
    }
    if (handoverKind === 'RENT' && paidB > 0n) return toast.alert('Cho thuê thu qua đơn giá khi duyệt — không nhập "đã thanh toán".', 'Không hợp lệ');
    if (paidB > amountB) return toast.alert('Tiền đã thanh toán không được lớn hơn thành tiền.', 'Số tiền không hợp lệ');
    if (needsFund && !fundId) return toast.alert('Có thu tiền (bán/thuê/cọc) thì phải chọn quỹ nhận.', 'Thiếu quỹ');
    setBusy(true);
    const input: CreateExportRequestInput = {
      kind,
      handoverKind,
      withTid: kind === 'POS' ? withTid : false,
      method,
      bankId: bankId ? Number(bankId) : null,
      partnerId: kind === 'TID' && partnerId ? Number(partnerId) : null,
      customerId: Number(customerId),
      feeTypeId: kind === 'TID' && feeTypeId ? Number(feeTypeId) : null,
      // G2: gửi money là CHUỖI chữ số (không qua Number ở IPC) — backend parseVndStrict → bigint.
      unitPrice: digitsOnly(unitPrice),
      quantity: qty,
      depositAmount: digitsOnly(depositAmount),
      paidAmount: handoverKind === 'RENT' ? '0' : digitsOnly(paidAmount),
      fundId: fundId ? Number(fundId) : null,
      // FE-01 (Codex 15/7): gửi ngày/giờ yêu cầu người dùng chọn (mặc định giờ hiện tại) — trước đây bị bỏ.
      requestedAt: reqDate ? new Date(`${reqDate}T${reqTime || '00:00'}:00`).toISOString() : null,
      note: note.trim() || null
    };
    const res = await window.api.exportReqCreate(input);
    setBusy(false);
    if (res.ok) { toast.success('Đã tạo phiếu yêu cầu xuất kho — chờ Kho/Quản lý duyệt.'); onSaved(); }
    else toast.alert(res.message ?? 'Tạo phiếu thất bại', 'Không tạo được');
  }

  const title = kind === 'POS' ? 'Tạo yêu cầu xuất kho POS' : 'Tạo yêu cầu xuất kho TID';

  return (
    <Modal title={title} onClose={onClose} width="max-w-2xl">
      <div className="mb-2 rounded-md bg-appbg px-3 py-2 text-xs text-slate-500">
        Phiếu CHƯA chọn seri/TID cụ thể. Người có quyền Kho sẽ chọn {kind === 'POS' ? 'máy POS' : 'TID'} và trừ tồn kho khi DUYỆT. Tiền = đơn giá × số lượng.
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="App ngân hàng" required={kind === 'TID'} hint={kind === 'POS' ? 'Tùy chọn — khớp app máy khi duyệt' : 'Khớp ngân hàng của TID khi duyệt'}>
          <SearchSelect value={bankId} onChange={setBankId} options={bankOptions} placeholder="— Chọn ngân hàng —" />
        </Field>
        {kind === 'TID' && (
          <Field label="Đối tác" required hint="Khớp đối tác của TID khi duyệt">
            <select className={inputCls} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">— Chọn đối tác —</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Khách hàng" required hint="Người nhận máy/TID">
          <SearchSelect value={customerId} onChange={setCustomerId} options={customerOptions} placeholder="— Chọn khách —" />
        </Field>
        {kind === 'TID' && (
          <Field label="Loại phí" hint="Metadata phiếu (tùy chọn)">
            <select className={inputCls} value={feeTypeId} onChange={(e) => setFeeTypeId(e.target.value)}>
              <option value="">— Không chọn —</option>
              {feeTypes.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Hình thức" required>
          <select className={inputCls} value={handoverKind} onChange={(e) => setHandoverKind(e.target.value as 'SALE' | 'RENT')}>
            <option value="SALE">Bán</option>
            <option value="RENT">Cho thuê</option>
          </select>
        </Field>
        {kind === 'POS' && (
          <Field
            label={handoverKind === 'SALE' ? 'Bán máy' : 'Kiểu cho thuê'}
            hint="Kèm TID → gán TID khi duyệt; bán/giao rời → chỉ máy POS"
          >
            <select className={inputCls} value={withTid ? 'withtid' : 'plain'} onChange={(e) => setWithTid(e.target.value === 'withtid')}>
              <option value="plain">{handoverKind === 'SALE' ? 'Bán rời (chỉ máy POS)' : 'Không kèm TID'}</option>
              <option value="withtid">Kèm TID (gán khi duyệt)</option>
            </select>
          </Field>
        )}
        <Field label="Hình thức thanh toán" hint="Tiền mặt hoặc chuyển khoản">
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as 'CASH' | 'CK')}>
            <option value="CASH">Tiền mặt</option>
            <option value="CK">Chuyển khoản</option>
          </select>
        </Field>
        {kind === 'TID' && (
          <Field label="Hình thức giao" hint="Giao riêng TID ở đây; kèm máy POS thì tạo ở tab POS">
            <select className={inputCls} value={tidDelivery} onChange={(e) => setTidDelivery(e.target.value as 'tid' | 'pos')}>
              <option value="tid">Giao riêng TID (tại đây)</option>
              <option value="pos">Giao kèm máy POS…</option>
            </select>
          </Field>
        )}
        <Field label="Số lượng" required>
          <input className={inputCls + ' text-right tabular-nums'} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ''))} placeholder="1" />
        </Field>
        <Field label="Đơn giá (VND)" required hint="Đơn giá 1 đơn vị">
          <MoneyInput value={unitPrice} onChange={setUnitPrice} />
        </Field>
        <Field label="Thành tiền (VND)" hint="Tự tính = đơn giá × số lượng">
          <div className="rounded-md border border-line bg-appbg px-3 py-2 text-right text-sm font-semibold tabular-nums text-slate-700">{money(amountStr)}</div>
        </Field>
        <Field label="Đã cọc (VND)" hint="Tiền cọc kèm phiếu (nếu có)">
          <MoneyInput value={depositAmount} onChange={setDepositAmount} />
        </Field>
        <Field label="Đã thanh toán (VND)" hint={handoverKind === 'RENT' ? 'Cho thuê thu qua đơn giá — không nhập' : 'Thu ngay khi duyệt (≤ thành tiền)'}>
          <MoneyInput value={paidAmount} onChange={setPaidAmount} disabled={handoverKind === 'RENT'} />
        </Field>
        <Field label="Quỹ nhận tiền" required={needsFund} hint={needsFund ? 'Bắt buộc khi có thu tiền' : 'Không thu thì bỏ trống'}>
          <select className={inputCls} value={fundId} onChange={(e) => setFundId(e.target.value)}>
            <option value="">— Chọn quỹ —</option>
            {funds.map((f) => <option key={f.id} value={f.id}>{f.code} · {f.name}</option>)}
          </select>
        </Field>
        <Field label="Ngày yêu cầu" hint="Mặc định hôm nay">
          <input type="date" className={inputCls} value={reqDate} onChange={(e) => setReqDate(e.target.value)} />
        </Field>
        <Field label="Giờ yêu cầu" hint="Mặc định giờ hiện tại">
          <input type="time" className={inputCls} value={reqTime} onChange={(e) => setReqTime(e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="Ghi chú"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Xác nhận</Button>
      </div>
    </Modal>
  );
}
