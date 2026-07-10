import { useEffect, useState } from 'react';
import { Check, X, Loader2, ClipboardCheck, Download } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { fmtDate } from '@glb/shared';
import type { CancelRequestDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Field, inputCls } from '../components/Field.js';
import { Button } from '../components/Button.js';
import { StatBar } from '../components/StatBar.js';
import { statusTone } from '../components/StatusPill.js';
import { useRowSelection, SelectAllCell, SelectCell } from '../components/Selection.js';
import { exportCsv } from '../lib/exportCsv.js';

/** VND, nhóm 3 số bằng dấu chấm (KHÔNG toLocaleString — R_UI QA gate). */
function money(n: number): string {
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '−' : '') + s + 'đ';
}

type Dialog =
  | { kind: 'approve'; row: CancelRequestDto }
  | { kind: 'reject'; row: CancelRequestDto }
  | { kind: 'approveBulk' }
  | { kind: 'rejectBulk' }
  | null;

/**
 * Trang "Duyệt hủy bill" (P1.2 §5). Chỉ hiển thị yêu cầu PENDING mà người đang đăng nhập ĐƯỢC PHÉP
 * duyệt (đã lọc theo phân vai ở service qua cờ canApprove). Duyệt / Từ chối từng cái hoặc hàng loạt
 * ("chọn tất cả" → Duyệt/Từ chối đã chọn). Cái không được phép → service tự bỏ qua kèm lý do.
 */
export function ApprovalPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<CancelRequestDto[]>([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    // Bảng chỉ hiển thị PENDING mà bạn được duyệt; nhưng bộ đếm là TOÀN HỆ THỐNG theo trạng thái.
    // Đếm CLIENT từ 3 danh sách đầy đủ (cancelRequestList trả full, KHÔNG phân trang) — không cần API mới.
    const [pend, appr, rej] = await Promise.all([
      window.api.cancelRequestList('PENDING'),
      window.api.cancelRequestList('APPROVED'),
      window.api.cancelRequestList('REJECTED')
    ]);
    if (pend.ok && pend.data) setRows(pend.data.filter((r) => r.canApprove));
    else if (pend.message) toast.alert(pend.message);
    const pc = pend.ok && pend.data ? pend.data.length : 0;
    const ac = appr.ok && appr.data ? appr.data.length : 0;
    const rc = rej.ok && rej.data ? rej.data.length : 0;
    setStats({ total: pc + ac + rc, pending: pc, approved: ac, rejected: rc });
    sel.clear();
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /** Tóm tắt kết quả bulk: "Đã duyệt N · Bỏ qua M (lý do…)". */
  function summarize(verb: string, done: number, skipped?: { id: number; reason: string; message?: string }[]): void {
    if (skipped && skipped.length > 0) {
      const detail = skipped.map((s) => `#${s.id}: ${s.message ?? s.reason}`).join('\n');
      toast.alert(`${verb} ${done} yêu cầu. Bỏ qua ${skipped.length}:\n${detail}`, 'Kết quả xử lý hàng loạt');
    } else {
      toast.success(`${verb} ${done} yêu cầu.`);
    }
  }

  async function doApprove(row: CancelRequestDto): Promise<void> {
    const res = await window.api.cancelApprove(row.id);
    if (res.ok) toast.success(`Đã duyệt hủy bill ${row.billCode ?? row.transactionId}.`);
    else toast.alert(res.message ?? 'Không duyệt được yêu cầu.', 'Duyệt thất bại');
    setDialog(null);
    await reload();
  }
  async function doReject(row: CancelRequestDto, note: string): Promise<void> {
    const res = await window.api.cancelReject(row.id, note);
    if (res.ok) toast.success(`Đã từ chối yêu cầu hủy bill ${row.billCode ?? row.transactionId}.`);
    else toast.alert(res.message ?? 'Không từ chối được yêu cầu.', 'Từ chối thất bại');
    setDialog(null);
    await reload();
  }
  async function doApproveBulk(): Promise<void> {
    const res = await window.api.cancelApproveBulk([...sel.selected]);
    if (res.ok) summarize('Đã duyệt', res.done ?? 0, res.skipped);
    else toast.alert(res.message ?? 'Duyệt hàng loạt thất bại.', 'Duyệt thất bại');
    setDialog(null);
    await reload();
  }
  async function doRejectBulk(note: string): Promise<void> {
    const res = await window.api.cancelRejectBulk([...sel.selected], note);
    if (res.ok) summarize('Đã từ chối', res.done ?? 0, res.skipped);
    else toast.alert(res.message ?? 'Từ chối hàng loạt thất bại.', 'Từ chối thất bại');
    setDialog(null);
    await reload();
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Duyệt hủy bill</h2>
          <p className="text-sm text-slate-500">Các yêu cầu hủy bill đang chờ bạn duyệt — người tạo yêu cầu khác người duyệt (phân vai theo cấp).</p>
        </div>
        <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('duyet_huy_bill', ['Mã bill', 'Số tiền', 'Lý do hủy', 'Người tạo yêu cầu', 'Thời gian'], rows.map((r) => [r.billCode ?? `#${r.transactionId}`, r.amount, r.reason, r.requestedByName ?? `#${r.requestedBy}`, fmtDate(r.requestedAt)]))}>
          Xuất Excel
        </Button>
      </div>

      <StatBar
        items={[
          { label: 'Tổng yêu cầu', value: stats.total, tone: 'bg-brand-tint text-brand' },
          { label: 'Chờ duyệt', value: stats.pending, tone: statusTone('PENDING') },
          { label: 'Đã duyệt', value: stats.approved, tone: statusTone('ACTIVE') },
          { label: 'Từ chối', value: stats.rejected, tone: statusTone('LOCKED') }
        ]}
      />

      {/* Thanh thao tác hàng loạt */}
      {sel.count > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-brand/30 bg-brand-tint px-4 py-2.5">
          <span className="text-sm font-medium text-brand">Đã chọn {sel.count} yêu cầu</span>
          <div className="flex-1" />
          <Button variant="neutral" onClick={sel.clear}>Bỏ tích</Button>
          <Button variant="danger" onClick={() => setDialog({ kind: 'rejectBulk' })}>Từ chối đã chọn</Button>
          <Button variant="confirm" onClick={() => setDialog({ kind: 'approveBulk' })}>Duyệt đã chọn</Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />
              <th className="px-3 py-3">Mã bill</th>
              <th className="px-3 py-3 text-right">Số tiền</th>
              <th className="px-3 py-3">Lý do hủy</th>
              <th className="px-3 py-3">Người tạo yêu cầu</th>
              <th className="px-3 py-3">Thời gian</th>
              <th className="px-3 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400"><ClipboardCheck className="mx-auto mb-2 h-6 w-6" /> Không có yêu cầu hủy nào chờ bạn duyệt.</td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(r.id) ? 'bg-brand-tint/40' : '')}>
                <SelectCell id={r.id} sel={sel} />
                <td className="px-3 py-3 font-mono text-xs font-medium text-slate-700">{r.billCode ?? `#${r.transactionId}`}</td>
                <td className="px-3 py-3 text-right tabular-nums text-slate-800">{money(r.amount)}</td>
                <td className="px-3 py-3 text-slate-600">{r.reason}</td>
                <td className="px-3 py-3 text-slate-600">{r.requestedByName ?? `#${r.requestedBy}`}</td>
                <td className="px-3 py-3 text-xs text-slate-500">{fmtDate(r.requestedAt)}</td>
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-1">
                    <button title="Duyệt hủy" onClick={() => setDialog({ kind: 'approve', row: r })} className="rounded-md p-1.5 text-success transition hover:bg-success/10"><Check className="h-4 w-4" /></button>
                    <button title="Từ chối" onClick={() => setDialog({ kind: 'reject', row: r })} className="rounded-md p-1.5 text-danger transition hover:bg-danger/10"><X className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog?.kind === 'approve' && (
        <ConfirmDialog
          title="Duyệt hủy bill"
          message={`Duyệt yêu cầu hủy bill "${dialog.row.billCode ?? dialog.row.transactionId}" (${money(dialog.row.amount)})? Bill sẽ chuyển sang Đã hủy và không còn tính vào doanh thu.`}
          confirmLabel="Duyệt hủy"
          onCancel={() => setDialog(null)}
          onConfirm={() => doApprove(dialog.row)}
        />
      )}
      {dialog?.kind === 'approveBulk' && (
        <ConfirmDialog
          title="Duyệt các yêu cầu đã chọn"
          message={`Duyệt ${sel.count} yêu cầu hủy đã chọn? Yêu cầu nào bạn không đủ thẩm quyền sẽ được bỏ qua kèm lý do.`}
          confirmLabel={`Duyệt ${sel.count} yêu cầu`}
          onCancel={() => setDialog(null)}
          onConfirm={() => doApproveBulk()}
        />
      )}
      {dialog?.kind === 'reject' && (
        <NoteModal
          title={`Từ chối yêu cầu hủy bill ${dialog.row.billCode ?? dialog.row.transactionId}`}
          onClose={() => setDialog(null)}
          onSubmit={(note) => doReject(dialog.row, note)}
        />
      )}
      {dialog?.kind === 'rejectBulk' && (
        <NoteModal
          title={`Từ chối ${sel.count} yêu cầu đã chọn`}
          hint="Lý do áp dụng cho tất cả yêu cầu được chọn. Yêu cầu nào bạn không đủ thẩm quyền sẽ được bỏ qua."
          onClose={() => setDialog(null)}
          onSubmit={(note) => doRejectBulk(note)}
        />
      )}
    </div>
  );
}

/** Ô nhập lý do từ chối (bắt buộc). */
function NoteModal({ title, hint, onClose, onSubmit }: { title: string; hint?: string; onClose: () => void; onSubmit: (note: string) => Promise<void> }): JSX.Element {
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
        <textarea className={inputCls + ' min-h-[80px] resize-y'} value={note} autoFocus onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: bill hợp lệ, không cần hủy…" />
      </Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="danger" onClick={submit} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Từ chối</Button>
      </div>
    </Modal>
  );
}
