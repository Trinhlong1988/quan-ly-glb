// Công nợ mua thiết bị (Mr.Long 12/7): khách mua máy/TID còn nợ → thu tiền dần.
// Nguồn: deviceSaleReceivables (tổng theo khách) + deviceSaleList (chi tiết từng đơn) + deviceSaleCollect (thu).
import { Fragment, useEffect, useState } from 'react';
import { Loader2, Banknote, ChevronDown, ChevronRight, HardDrive, CreditCard, RefreshCw } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission } from '@glb/shared';
import type { CustomerDeviceReceivable, DeviceSaleDto, FundDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { Field, inputCls } from '../components/Field.js';
import { StatBar } from '../components/StatBar.js';

function money(n: number): string {
  return n.toLocaleString('vi-VN');
}

export function DeviceReceivablePage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const canCollect = hasPermission(user, 'DEVICE_SALE_MANAGE'); // thu tiền = thao tác tiền
  const [rows, setRows] = useState<CustomerDeviceReceivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCust, setOpenCust] = useState<number | null>(null);
  const [sales, setSales] = useState<DeviceSaleDto[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [collectSale, setCollectSale] = useState<DeviceSaleDto | null>(null);

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.deviceSaleReceivables();
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleCust(customerId: number): Promise<void> {
    if (openCust === customerId) {
      setOpenCust(null);
      return;
    }
    setOpenCust(customerId);
    setSalesLoading(true);
    const res = await window.api.deviceSaleList({ customerId, onlyDebt: true });
    if (res.ok && res.data) setSales(res.data);
    else if (res.message) toast.alert(res.message);
    setSalesLoading(false);
  }

  const totalRemaining = rows.reduce((s, r) => s + r.remaining, 0);
  const totalSale = rows.reduce((s, r) => s + r.totalSale, 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Công nợ mua thiết bị</h3>
          <p className="text-sm text-slate-500">Khách mua máy POS / TID còn nợ. Thu dần vào quỹ; doanh thu đã ghi nhận đủ lúc bán.</p>
        </div>
        <button onClick={() => void reload()} title="Tải lại" className="flex items-center gap-1 rounded-md bg-brand/10 px-3 py-2 text-sm font-medium text-brand hover:bg-brand/20">
          <RefreshCw className="h-4 w-4" /> Làm mới
        </button>
      </div>

      <StatBar
        items={[
          { label: 'Khách còn nợ', value: rows.length },
          { label: 'Tổng đã bán (còn nợ)', value: money(totalSale) + ' đ', tone: 'bg-brand/10 text-brand' },
          { label: 'Còn phải thu', value: money(totalRemaining) + ' đ', tone: 'bg-amber-500/10 text-amber-600', icon: <Banknote className="h-4 w-4" /> }
        ]}
      />

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line py-16 text-center text-sm text-slate-400">Không có khách nào còn nợ mua thiết bị.</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-appbg text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Khách hàng</th>
                <th className="px-4 py-3 text-center">Số đơn</th>
                <th className="px-4 py-3 text-right">Tổng bán</th>
                <th className="px-4 py-3 text-right">Đã thu</th>
                <th className="px-4 py-3 text-right">Còn nợ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <Fragment key={r.customerId}>
                  <tr className="cursor-pointer hover:bg-appbg/60" onClick={() => void toggleCust(r.customerId)}>
                    <td className="px-4 py-3 font-medium text-slate-700">
                      <span className="inline-flex items-center gap-1.5">
                        {openCust === r.customerId ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                        {r.customerName ?? `#${r.customerId}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-slate-600">{r.saleCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{money(r.totalSale)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{money(r.totalPaid)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-600">{money(r.remaining)}</td>
                  </tr>
                  {openCust === r.customerId && (
                    <tr>
                      <td colSpan={5} className="bg-appbg/40 px-4 py-3">
                        {salesLoading ? (
                          <div className="flex items-center gap-2 py-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải chi tiết…</div>
                        ) : sales.length === 0 ? (
                          <div className="py-2 text-sm text-slate-400">Không có đơn còn nợ.</div>
                        ) : (
                          <div className="space-y-2">
                            {sales.map((s) => (
                              <div key={s.id} className="flex items-center justify-between rounded-md border border-line bg-white px-3 py-2">
                                <div className="flex items-center gap-2 text-sm">
                                  {s.saleKind === 'TID' ? <CreditCard className="h-4 w-4 text-brand" /> : <HardDrive className="h-4 w-4 text-amber-600" />}
                                  <span className="font-medium text-slate-700">{s.code ?? '—'}</span>
                                  <span className="text-slate-500">{s.saleKind === 'TID' ? `TID ${s.tid ?? ''}` : `Máy ${s.deviceSerial ?? ''}`}</span>
                                </div>
                                <div className="flex items-center gap-4 text-sm tabular-nums">
                                  <span className="text-slate-500">Bán <b className="text-slate-700">{money(s.salePrice)}</b></span>
                                  <span className="text-emerald-600">Thu {money(s.paid)}</span>
                                  <span className="font-semibold text-amber-600">Nợ {money(s.remaining)}</span>
                                  {canCollect && (
                                    <button onClick={() => setCollectSale(s)} className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:brightness-105">
                                      <Banknote className="h-3.5 w-3.5" /> Thu tiền
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {collectSale && (
        <CollectModal
          sale={collectSale}
          onClose={() => setCollectSale(null)}
          onDone={async () => {
            const cust = collectSale.customerId;
            setCollectSale(null);
            await reload();
            // Cập nhật lại chi tiết đang mở (nếu cùng khách).
            if (openCust === cust) {
              setSalesLoading(true);
              const res = await window.api.deviceSaleList({ customerId: cust, onlyDebt: true });
              if (res.ok && res.data) setSales(res.data);
              setSalesLoading(false);
            }
          }}
        />
      )}
    </div>
  );
}

/** Thu tiền cho 1 đơn bán thiết bị còn nợ. */
function CollectModal({ sale, onClose, onDone }: { sale: DeviceSaleDto; onClose: () => void; onDone: () => void }): JSX.Element {
  const toast = useToast();
  const [funds, setFunds] = useState<FundDto[]>([]);
  const [amount, setAmount] = useState(String(sale.remaining));
  const [fundId, setFundId] = useState('');
  const [method, setMethod] = useState('CASH');
  const [entryDate, setEntryDate] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.fundList({ active: true }).then((r) => r.ok && r.data && setFunds(r.data));
  }, []);

  const amt = Number(amount) || 0;

  async function submit(): Promise<void> {
    if (!(amt > 0)) return toast.alert('Số tiền thu phải > 0.', 'Số tiền không hợp lệ');
    if (amt > sale.remaining) return toast.alert(`Chỉ còn nợ ${money(sale.remaining)} đ. Không thu vượt.`, 'Vượt công nợ');
    if (!fundId) return toast.alert('Phải chọn quỹ nhận tiền.', 'Thiếu quỹ');
    setBusy(true);
    const res = await window.api.deviceSaleCollect({
      deviceSaleId: sale.id, amount: amt, fundId: Number(fundId), method,
      entryDate: entryDate ? new Date(entryDate).toISOString() : null
    });
    setBusy(false);
    if (res.ok) { toast.success(`Đã thu ${money(amt)} đ cho đơn ${sale.code ?? sale.id}`); onDone(); }
    else toast.alert(res.message ?? 'Thu tiền thất bại', 'Không thu được');
  }

  return (
    <Modal title={`Thu tiền · ${sale.code ?? ''}`} onClose={onClose} width="max-w-md">
      <div className="mb-3 rounded-md bg-appbg px-3 py-2 text-sm text-slate-600">
        {sale.saleKind === 'TID' ? `TID ${sale.tid ?? ''}` : `Máy ${sale.deviceSerial ?? ''}`} · {sale.customerName ?? ''}
        <div className="mt-1 flex gap-4 text-xs tabular-nums">
          <span>Giá bán: <b>{money(sale.salePrice)}</b></span>
          <span className="text-emerald-600">Đã thu: {money(sale.paid)}</span>
          <span className="font-semibold text-amber-600">Còn nợ: {money(sale.remaining)}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Số tiền thu (VND)" required>
          <input className={inputCls + ' text-right tabular-nums'} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} autoFocus />
        </Field>
        <Field label="Quỹ nhận" required>
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
        <Field label="Ngày thu" hint="Bỏ trống = hiện tại">
          <input type="datetime-local" className={inputCls} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-600 hover:bg-appbg">Hủy</button>
        <button onClick={submit} disabled={busy} className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-105 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Thu tiền
        </button>
      </div>
    </Modal>
  );
}
