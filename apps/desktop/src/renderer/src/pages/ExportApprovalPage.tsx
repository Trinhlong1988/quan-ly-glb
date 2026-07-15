import { useEffect, useMemo, useState } from 'react';
import { Loader2, PackageOpen, Check, X, RefreshCw, Download } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTimeSec } from '@glb/shared';
import type { ExportRequestDto, ExportRequestKpi, PosDto, TidDto, ApproveExportLineInput } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { Button } from '../components/Button.js';
import { Field, inputCls } from '../components/Field.js';
import { SearchSelect } from '../components/SearchSelect.js';
import { StatBar } from '../components/StatBar.js';
import { useRowSelection, SelectAllCell, SelectCell } from '../components/Selection.js';
import { exportCsv } from '../lib/exportCsv.js';
import { ExportReqStatusBadge } from '../components/ExportRequestPanel.js';

/** VND, nhóm 3 số bằng dấu chấm (KHÔNG toLocaleString — R_UI QA gate).
 *  G2: nhận CHUỖI thập phân (money DTO ExportRequest) HOẶC number. */
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
const HANDOVER_LABEL: Record<string, string> = { SALE: 'Bán', RENT: 'Cho thuê' };
const KIND_LABEL: Record<string, string> = { POS: 'Máy POS', TID: 'TID' };

/**
 * PHASE 4 — "Duyệt xuất kho": danh sách phiếu PENDING + KPI + tích chọn. Duyệt 1 phiếu → modal chọn
 * N seri/TID (theo quantity) rồi nhập mật khẩu → exportReqApprove trừ tồn kho + tiền. Từ chối (lý do).
 * Đặt là MENU RIÊNG (không nhét vào trang "Duyệt hủy") vì luồng chọn-seri khác hẳn duyệt-hủy.
 */
export function ExportApprovalPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const canApprove = hasPermission(user, 'EXPORT_REQUEST_APPROVE');
  const [rows, setRows] = useState<ExportRequestDto[]>([]);
  const [kpi, setKpi] = useState<ExportRequestKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [approveTarget, setApproveTarget] = useState<ExportRequestDto | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ExportRequestDto | null>(null);
  const [bulkReject, setBulkReject] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.exportReqList({ status: 'PENDING' });
    if (res.ok && res.data) { setRows(res.data); setKpi(res.kpi ?? null); }
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function doReject(r: ExportRequestDto, note: string): Promise<void> {
    const res = await window.api.exportReqReject(r.id, note);
    if (res.ok) toast.success(`Đã từ chối phiếu ${r.code ?? r.id}`);
    else toast.alert(res.message ?? 'Không từ chối được phiếu.', 'Từ chối thất bại');
    setRejectTarget(null);
    await reload();
  }
  async function doBulkReject(note: string): Promise<void> {
    const chosen = rows.filter((r) => sel.selected.has(r.id));
    let done = 0;
    const skipped: string[] = [];
    for (const r of chosen) {
      const res = await window.api.exportReqReject(r.id, note);
      if (res.ok) done++;
      else skipped.push(`${r.code ?? r.id}: ${res.message ?? res.error ?? 'lỗi'}`);
    }
    if (skipped.length) toast.alert(`Đã từ chối ${done} phiếu. Bỏ qua ${skipped.length}:\n${skipped.join('\n')}`, 'Kết quả xử lý hàng loạt');
    else toast.success(`Đã từ chối ${done} phiếu.`);
    setBulkReject(false);
    await reload();
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Duyệt xuất kho</h2>
          <p className="text-sm text-slate-500">Phiếu yêu cầu xuất kho POS/TID đang chờ duyệt. Duyệt = chọn seri máy / TID cụ thể (theo số lượng) + nhập mật khẩu → trừ tồn kho và ghi tiền.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="soft" icon={<RefreshCw className="h-4 w-4" />} onClick={reload}>Làm mới</Button>
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('duyet_xuat_kho', ['Mã phiếu', 'Loại', 'Hình thức', 'Khách', 'Số lượng', 'Đơn giá', 'Thành tiền', 'Người tạo', 'Thời gian'], rows.map((r) => [r.code ?? `#${r.id}`, KIND_LABEL[r.kind] ?? r.kind, HANDOVER_LABEL[r.handoverKind] ?? r.handoverKind, r.customerName ?? '', r.quantity, r.unitPrice, r.amount, r.requesterName ?? '', fmtDate(r.requestedAt)]))}>Xuất Excel</Button>
        </div>
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

      {canApprove && sel.count > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-brand/30 bg-brand-tint px-4 py-2.5">
          <span className="text-sm font-medium text-brand">Đã chọn {sel.count} phiếu</span>
          <div className="flex-1" />
          <Button variant="neutral" onClick={sel.clear}>Bỏ tích</Button>
          <Button variant="danger" onClick={() => setBulkReject(true)}>Từ chối đã chọn</Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm list-scroll">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {canApprove && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Mã phiếu</th>
              <th className="px-4 py-3">Loại</th>
              <th className="px-4 py-3">Hình thức</th>
              <th className="px-4 py-3">Khách hàng</th>
              <th className="px-4 py-3">Ngân hàng</th>
              <th className="px-4 py-3 text-right">SL</th>
              <th className="px-4 py-3 text-right">Đơn giá</th>
              <th className="px-4 py-3 text-right">Thành tiền</th>
              <th className="px-4 py-3">Người tạo</th>
              <th className="px-4 py-3 whitespace-nowrap">Thời gian</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canApprove ? 12 : 11} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={canApprove ? 12 : 11} className="px-4 py-10 text-center text-slate-400"><PackageOpen className="mx-auto mb-2 h-6 w-6" /> Không có phiếu yêu cầu xuất kho nào chờ duyệt.</td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(r.id) ? 'bg-brand-tint/40' : '')}>
                {canApprove && <SelectCell id={r.id} sel={sel} />}
                <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">{r.code ?? `#${r.id}`}</td>
                <td className="px-4 py-3 whitespace-nowrap"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{KIND_LABEL[r.kind] ?? r.kind}</span></td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="rounded-full bg-brand-tint/60 px-2 py-0.5 text-xs font-semibold text-brand">{HANDOVER_LABEL[r.handoverKind] ?? r.handoverKind}</span>
                  {r.withTid && <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">kèm TID</span>}
                </td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.customerName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.bankName ?? '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">{r.quantity}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700 whitespace-nowrap">{money(r.unitPrice)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800 whitespace-nowrap">{money(r.amount)}</td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.requesterName ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(r.requestedAt)} {fmtTimeSec(r.requestedAt)}</td>
                <td className="px-4 py-3">
                  {canApprove ? (
                    <div className="flex justify-end gap-1">
                      <button title="Duyệt (chọn seri/TID)" onClick={() => setApproveTarget(r)} className="rounded-md p-1.5 text-success transition hover:bg-success/10"><Check className="h-4 w-4" /></button>
                      <button title="Từ chối" onClick={() => setRejectTarget(r)} className="rounded-md p-1.5 text-danger transition hover:bg-danger/10"><X className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <div className="text-right text-xs text-slate-400">—</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {approveTarget && (
        <ExportApproveModal
          req={approveTarget}
          onClose={() => setApproveTarget(null)}
          onDone={async () => { setApproveTarget(null); await reload(); }}
        />
      )}
      {rejectTarget && (
        <RejectModal
          title={`Từ chối phiếu ${rejectTarget.code ?? rejectTarget.id}`}
          onClose={() => setRejectTarget(null)}
          onSubmit={(note) => doReject(rejectTarget, note)}
        />
      )}
      {bulkReject && (
        <RejectModal
          title={`Từ chối ${sel.count} phiếu đã chọn`}
          hint="Lý do áp dụng cho tất cả phiếu được chọn."
          onClose={() => setBulkReject(false)}
          onSubmit={(note) => doBulkReject(note)}
        />
      )}
    </div>
  );
}

/** Modal duyệt: N dòng (stt 1..quantity) — mỗi dòng chọn máy POS (IN_STOCK cùng bank) và/hoặc TID + mật khẩu. */
function ExportApproveModal({ req, onClose, onDone }: { req: ExportRequestDto; onClose: () => void; onDone: () => void }): JSX.Element {
  const toast = useToast();
  const [devices, setDevices] = useState<PosDto[]>([]);
  const [tids, setTids] = useState<TidDto[]>([]);
  const [lines, setLines] = useState<{ posSerial: string; tid: string }[]>(
    Array.from({ length: req.quantity }, () => ({ posSerial: '', tid: '' }))
  );
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const needPosPick = req.kind === 'POS';
  const needTidPick = req.kind === 'TID' || (req.kind === 'POS' && req.withTid);

  useEffect(() => {
    if (needPosPick) {
      window.api.posList({ status: 'IN_STOCK', bankId: req.bankId ?? undefined }).then((r) => {
        if (r.ok && r.data) setDevices(r.data.filter((d) => d.currentTid == null));
      });
    }
    if (needTidPick) {
      window.api.tidList({ delivered: false }).then((r) => {
        if (!r.ok || !r.data) return;
        let list = r.data.filter((t) => !t.delivered);
        if (req.bankId != null) list = list.filter((t) => t.bankId === req.bankId);
        if (req.kind === 'TID' && req.partnerId != null) list = list.filter((t) => t.partnerId === req.partnerId);
        // POS kèm TID: TID phải CHƯA gắn máy + còn sống.
        if (req.kind === 'POS') list = list.filter((t) => !t.deviceAssigned && ['UNASSIGNED', 'ACTIVE'].includes(t.status));
        setTids(list);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deviceOptions = useMemo(() => devices.map((d) => ({ value: d.serial, label: `${d.serial}${d.posModelName ? ` · ${d.posModelName}` : ''}` })), [devices]);
  const tidOptions = useMemo(() => tids.map((t) => ({ value: t.tid, label: `${t.tid}${t.hkdName ? ` · ${t.hkdName}` : ''}` })), [tids]);

  function setLine(i: number, patch: Partial<{ posSerial: string; tid: string }>): void {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit(): Promise<void> {
    for (let i = 0; i < lines.length; i++) {
      if (needPosPick && !lines[i].posSerial) return toast.alert(`Dòng ${i + 1}: chưa chọn máy POS.`, 'Thiếu seri');
      if (needTidPick && !lines[i].tid) return toast.alert(`Dòng ${i + 1}: chưa chọn TID.`, 'Thiếu TID');
    }
    if (!password) return toast.alert('Nhập mật khẩu để xác nhận duyệt.', 'Cần mật khẩu');
    const payload: ApproveExportLineInput[] = lines.map((l, i) => ({
      seq: i + 1,
      posSerial: needPosPick ? l.posSerial : null,
      tid: needTidPick ? l.tid : null
    }));
    setBusy(true);
    const res = await window.api.exportReqApprove(req.id, payload, password, note.trim() || undefined);
    setBusy(false);
    if (res.ok) { toast.success(`Đã duyệt phiếu ${req.code ?? req.id} — đã trừ tồn kho ${req.quantity} đơn vị.`); onDone(); }
    else toast.alert(res.message ?? 'Duyệt thất bại', 'Không duyệt được');
  }

  return (
    <Modal title={`Duyệt xuất kho ${req.code ?? '#' + req.id}`} onClose={onClose} width="max-w-2xl">
      <div className="mb-3 rounded-md bg-appbg px-3 py-2 text-xs text-slate-600">
        <b>{KIND_LABEL[req.kind] ?? req.kind}</b> · {HANDOVER_LABEL[req.handoverKind] ?? req.handoverKind}{req.withTid ? ' (kèm TID)' : ''} · Khách <b>{req.customerName ?? '—'}</b>
        {req.bankName ? <> · NH <b>{req.bankName}</b></> : null} · SL <b>{req.quantity}</b> × {money(req.unitPrice)} = <b>{money(req.amount)}</b>
        <div className="mt-1 text-slate-500">Chọn đủ {req.quantity} {req.kind === 'POS' ? 'máy POS' : 'TID'} — mỗi dòng 1 đơn vị. Không trùng.</div>
      </div>
      <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-tint text-xs font-semibold text-brand">{i + 1}</span>
            {needPosPick && (
              <div className="flex-1">
                <SearchSelect value={l.posSerial} onChange={(v) => setLine(i, { posSerial: v })} options={deviceOptions} placeholder="— Chọn máy POS (IN_STOCK) —" />
              </div>
            )}
            {needTidPick && (
              <div className="flex-1">
                <SearchSelect value={l.tid} onChange={(v) => setLine(i, { tid: v })} options={tidOptions} placeholder="— Chọn TID chưa giao —" />
              </div>
            )}
          </div>
        ))}
        {needPosPick && deviceOptions.length === 0 && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">Không có máy POS IN_STOCK{req.bankName ? ` cùng app ${req.bankName}` : ''} chưa gắn TID để xuất.</div>
        )}
        {needTidPick && tidOptions.length === 0 && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">Không có TID phù hợp (chưa giao{req.bankName ? `, cùng ngân hàng ${req.bankName}` : ''}) để gán.</div>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <Field label="Ghi chú duyệt (tùy chọn)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú khi duyệt…" /></Field>
        <Field label="Mật khẩu xác nhận" required><input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={submit} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Duyệt & trừ kho</Button>
      </div>
    </Modal>
  );
}

/** Ô nhập lý do từ chối (bắt buộc). */
function RejectModal({ title, hint, onClose, onSubmit }: { title: string; hint?: string; onClose: () => void; onSubmit: (note: string) => Promise<void> }): JSX.Element {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(): Promise<void> {
    if (!note.trim()) return toast.alert('Vui lòng nhập lý do từ chối.', 'Thiếu lý do');
    setBusy(true);
    try { await onSubmit(note.trim()); } finally { setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose} width="max-w-md">
      {hint && <p className="mb-3 text-sm text-slate-500">{hint}</p>}
      <Field label="Lý do từ chối" required>
        <textarea className={inputCls + ' min-h-[80px] resize-y'} value={note} autoFocus onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: hết máy trong kho / sai thông tin…" />
      </Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="danger" onClick={submit} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Từ chối</Button>
      </div>
    </Modal>
  );
}
