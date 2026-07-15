import { useEffect, useState } from 'react';
import { Check, X, Loader2, ClipboardCheck, Download, RefreshCw, Trash2 } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { fmtDate, hasPermission } from '@glb/shared';
import type { CancelRequestDto, EntityCancelRequestDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { Field, inputCls } from '../components/Field.js';
import { Button } from '../components/Button.js';
import { StatBar } from '../components/StatBar.js';
import { statusTone } from '../components/StatusPill.js';
import { useRowSelection, SelectAllCell, SelectCell } from '../components/Selection.js';
import { exportCsv } from '../lib/exportCsv.js';

const ENTITY_APPROVE_PERMS = ['TID_CANCEL_APPROVE', 'POS_CANCEL_APPROVE', 'CUSTOMER_CANCEL_APPROVE', 'USER_CANCEL_APPROVE'];

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
  | { kind: 'approveEntity'; row: EntityCancelRequestDto }
  | { kind: 'rejectEntity'; row: EntityCancelRequestDto }
  | { kind: 'approveEntityBulk' }
  | null;

/**
 * Trang "Duyệt hủy bill" (P1.2 §5). Chỉ hiển thị yêu cầu PENDING mà người đang đăng nhập ĐƯỢC PHÉP
 * duyệt (đã lọc theo phân vai ở service qua cờ canApprove). Duyệt / Từ chối từng cái hoặc hàng loạt
 * ("chọn tất cả" → Duyệt/Từ chối đã chọn). Cái không được phép → service tự bỏ qua kèm lý do.
 */
export function ApprovalPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const canBill = hasPermission(user, 'BILL_CANCEL_APPROVE');
  const canEntity = ENTITY_APPROVE_PERMS.some((p) => hasPermission(user, p));
  const [rows, setRows] = useState<CancelRequestDto[]>([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [entityRows, setEntityRows] = useState<EntityCancelRequestDto[]>([]);
  // Mr.Long 14/7 — "danh sách lệnh duyệt đã xóa": các yêu cầu ĐÃ DUYỆT (bill CANCELLED / entity xóa mềm).
  const [approvedBills, setApprovedBills] = useState<CancelRequestDto[]>([]);
  const [approvedEntities, setApprovedEntities] = useState<EntityCancelRequestDto[]>([]);
  const [showApproved, setShowApproved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const sel = useRowSelection();
  const selEnt = useRowSelection(); // R34 — chọn nhiều phiếu hủy DỮ LIỆU (TID/POS/Khách/NS) để duyệt hàng loạt

  async function reload(): Promise<void> {
    setLoading(true);
    // Bảng chỉ hiển thị PENDING mà bạn được duyệt; nhưng bộ đếm là TOÀN HỆ THỐNG theo trạng thái.
    // Đếm CLIENT từ 3 danh sách đầy đủ (cancelRequestList trả full, KHÔNG phân trang) — không cần API mới.
    if (canBill) {
      const [pend, appr, rej] = await Promise.all([
        window.api.cancelRequestList('PENDING'),
        window.api.cancelRequestList('APPROVED'),
        window.api.cancelRequestList('REJECTED')
      ]);
      // Hiện phiếu bạn ĐƯỢC duyệt HOẶC do CHÍNH bạn tạo (để bạn biết đang chờ người khác duyệt — chống "tạo xong biến mất").
      if (pend.ok && pend.data) setRows(pend.data.filter((r) => r.canApprove || r.isSelf));
      else if (pend.message) toast.alert(pend.message);
      const pc = pend.ok && pend.data ? pend.data.length : 0;
      const ac = appr.ok && appr.data ? appr.data.length : 0;
      const rc = rej.ok && rej.data ? rej.data.length : 0;
      setStats({ total: pc + ac + rc, pending: pc, approved: ac, rejected: rc });
      setApprovedBills(appr.ok && appr.data ? appr.data : []);
    }
    // R34 — yêu cầu hủy dữ liệu (TID/POS/Khách/Nhân sự) đang chờ bạn duyệt.
    if (canEntity) {
      const [ent, entAppr] = await Promise.all([
        window.api.entityCancelList('PENDING'),
        window.api.entityCancelList('APPROVED')
      ]);
      if (ent.ok && ent.data) setEntityRows(ent.data.filter((r) => r.canApprove || r.isSelf));
      else if (ent.message) toast.alert(ent.message);
      setApprovedEntities(entAppr.ok && entAppr.data ? entAppr.data : []);
    }
    sel.clear();
    selEnt.clear();
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

  async function doApprove(row: CancelRequestDto, password: string, note?: string): Promise<void> {
    const res = await window.api.cancelApprove(row.id, password, note);
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
  async function doApproveBulk(password: string): Promise<void> {
    const res = await window.api.cancelApproveBulk([...sel.selected], password);
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
  // R34 — duyệt / từ chối yêu cầu hủy dữ liệu (TID/POS/Khách/Nhân sự). Duyệt BẮT BUỘC nhập mật khẩu (Q2).
  async function doApproveEntity(row: EntityCancelRequestDto, password: string, note?: string): Promise<void> {
    const res = await window.api.entityCancelApprove(row.entityType, row.id, password, note);
    if (res.ok) toast.success(`Đã duyệt hủy ${row.entityTypeLabel} ${row.entityLabel ?? ''}.`);
    else toast.alert(res.message ?? 'Không duyệt được yêu cầu.', 'Duyệt thất bại');
    setDialog(null);
    await reload();
  }
  async function doRejectEntity(row: EntityCancelRequestDto, note: string): Promise<void> {
    const res = await window.api.entityCancelReject(row.entityType, row.id, note);
    if (res.ok) toast.success(`Đã từ chối yêu cầu hủy ${row.entityTypeLabel} ${row.entityLabel ?? ''}.`);
    else toast.alert(res.message ?? 'Không từ chối được yêu cầu.', 'Từ chối thất bại');
    setDialog(null);
    await reload();
  }
  // R34 — duyệt HÀNG LOẠT phiếu hủy dữ liệu đã chọn (mật khẩu nhập 1 lần, lặp per phiếu; backend tự bỏ qua cái không đủ quyền).
  async function doApproveEntityBulk(password: string): Promise<void> {
    const chosen = entityRows.filter((r) => selEnt.selected.has(r.id) && r.canApprove);
    let done = 0;
    const skipped: { id: number; reason: string; message?: string }[] = [];
    for (const r of chosen) {
      const res = await window.api.entityCancelApprove(r.entityType, r.id, password);
      if (res.ok) done++;
      else skipped.push({ id: r.id, reason: res.error ?? 'ERROR', message: res.message });
    }
    summarize('Đã duyệt', done, skipped.length ? skipped : undefined);
    setDialog(null);
    await reload();
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Quản lý dữ liệu yêu cầu duyệt hủy</h2>
          <p className="text-sm text-slate-500">Yêu cầu hủy (bill, TID, máy POS, khách hàng, nhân sự) đang chờ bạn duyệt — người tạo yêu cầu khác người duyệt (phân vai theo cấp).</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="soft" icon={<RefreshCw className="h-4 w-4" />} onClick={reload}>Làm mới</Button>
          {canBill && (
            <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('duyet_huy_bill', ['Mã bill', 'Số tiền', 'Lý do hủy', 'Người tạo yêu cầu', 'Thời gian'], rows.map((r) => [r.billCode ?? `#${r.transactionId}`, r.amount, r.reason, r.requestedByName ?? `#${r.requestedBy}`, fmtDate(r.requestedAt)]))}>
              Xuất Excel
            </Button>
          )}
        </div>
      </div>

      {/* Mr.Long 14/7 — nút xem "danh sách lệnh duyệt đã xóa" (yêu cầu ĐÃ DUYỆT → bill hủy / dữ liệu đã xóa mềm). */}
      <div className="mb-3 flex items-center gap-2">
        <Button variant={showApproved ? 'confirm' : 'neutral'} onClick={() => setShowApproved((v) => !v)}>
          {showApproved ? 'Ẩn danh sách đã duyệt/đã xóa' : `Xem đã duyệt / đã xóa (${approvedBills.length + approvedEntities.length})`}
        </Button>
      </div>

      {showApproved && (
        <div className="mb-5 overflow-x-auto rounded-xl border border-line bg-white shadow-sm list-scroll">
          <div className="border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Lệnh duyệt đã xóa — {approvedBills.length + approvedEntities.length} bản ghi (chỉ xem)
          </div>
          <table className="w-full text-sm">
            <thead className="bg-appbg text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Loại</th>
                <th className="px-3 py-2 text-left">Đối tượng</th>
                <th className="px-3 py-2 text-left">Lý do</th>
                <th className="px-3 py-2 text-left">Người yêu cầu</th>
                <th className="px-3 py-2 text-left">Người duyệt</th>
                <th className="px-3 py-2 text-left">Thời điểm duyệt</th>
              </tr>
            </thead>
            <tbody>
              {approvedBills.map((r) => (
                <tr key={`b-${r.id}`} className="border-t border-line hover:bg-appbg/60">
                  <td className="px-3 py-2"><span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600">Bill hủy</span></td>
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-700">{r.billCode ?? `#${r.transactionId}`}</td>
                  <td className="px-3 py-2 text-slate-600">{r.reason}</td>
                  <td className="px-3 py-2 text-slate-600">{r.requestedByName ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{r.decidedByName ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{r.decidedAt ? new Date(r.decidedAt).toLocaleString('vi-VN') : '—'}</td>
                </tr>
              ))}
              {approvedEntities.map((r) => (
                <tr key={`e-${r.id}`} className="border-t border-line hover:bg-appbg/60">
                  <td className="px-3 py-2"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{r.entityTypeLabel}</span></td>
                  <td className="px-3 py-2 font-medium text-slate-700">{r.entityLabel ?? `#${r.entityId}`}</td>
                  <td className="px-3 py-2 text-slate-600">{r.reason}</td>
                  <td className="px-3 py-2 text-slate-600">{r.requestedByName ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{r.decidedByName ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{r.decidedAt ? new Date(r.decidedAt).toLocaleString('vi-VN') : '—'}</td>
                </tr>
              ))}
              {approvedBills.length + approvedEntities.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-sm text-slate-400">Chưa có lệnh duyệt xóa nào.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {canBill && (
      <StatBar
        items={[
          { label: 'Tổng yêu cầu bill', value: stats.total, tone: 'bg-brand-tint text-brand' },
          { label: 'Chờ duyệt', value: stats.pending, tone: statusTone('PENDING') },
          { label: 'Đã duyệt', value: stats.approved, tone: statusTone('ACTIVE') },
          { label: 'Từ chối', value: stats.rejected, tone: statusTone('LOCKED') }
        ]}
      />
      )}

      {canBill && <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Yêu cầu hủy bill</div>}

      {canBill && (
      <>
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

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm list-scroll">
        {/* Mr.Long 12/7 — table-fixed + colgroup: cột trước "Lý do hủy" (chọn+Mã bill+Số tiền = 21rem) khớp
            đúng cột trước của bảng "Yêu cầu hủy dữ liệu" (Loại+Đối tượng = 21rem) → 4 cột chung THẲNG HÀNG 2 bảng.
            Số tiền cạnh Mã bill (không xa), có khoảng cách với Lý do hủy (không sát). */}
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-12" />
            <col className="w-32" />
            <col className="w-40" />
            <col />
            <col className="w-44" />
            <col className="w-40" />
            <col className="w-24" />
          </colgroup>
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />
              <th className="px-3 py-3">Mã bill</th>
              <th className="px-3 py-3 text-right">Số tiền</th>
              <th className="px-3 py-3 pl-5">Lý do hủy</th>
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
                <td className="px-3 py-3 font-mono text-xs font-medium text-slate-700 whitespace-nowrap">{r.billCode ?? `#${r.transactionId}`}</td>
                <td className="px-3 py-3 text-right tabular-nums text-slate-800 whitespace-nowrap">{money(r.amount)}</td>
                <td className="px-3 py-3 pl-5 text-slate-600">{r.reason}</td>
                <td className="px-3 py-3 text-slate-600">{r.requestedByName ?? `#${r.requestedBy}`}</td>
                <td className="px-3 py-3 text-xs text-slate-500">{fmtDate(r.requestedAt)}</td>
                <td className="px-3 py-3">
                  {r.canApprove ? (
                    <div className="flex justify-end gap-1">
                      <button title="Duyệt hủy" onClick={() => setDialog({ kind: 'approve', row: r })} className="rounded-md p-1.5 text-success transition hover:bg-success/10"><Check className="h-4 w-4" /></button>
                      <button title="Từ chối" onClick={() => setDialog({ kind: 'reject', row: r })} className="rounded-md p-1.5 text-danger transition hover:bg-danger/10"><X className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <div className="text-right text-xs font-semibold text-amber-600 whitespace-nowrap" title="Bạn là người tạo yêu cầu này — cần NGƯỜI KHÁC (có quyền) duyệt.">Chờ người khác duyệt</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
      )}

      {/* R34 — Yêu cầu hủy dữ liệu (TID / POS / Khách hàng / Nhân sự) */}
      {canEntity && (
        <div className={canBill ? 'mt-6' : ''}>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Yêu cầu hủy dữ liệu (TID · Máy POS · Khách hàng · Nhân sự)</div>
            {selEnt.count > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Đã chọn {selEnt.count}</span>
                <Button variant="soft" onClick={() => selEnt.clear()}>Bỏ chọn</Button>
                <Button variant="confirm" onClick={() => setDialog({ kind: 'approveEntityBulk' })}>Duyệt đã chọn ({selEnt.count})</Button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm list-scroll">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-10" />
                <col className="w-24" />
                <col className="w-56" />
                <col />
                <col className="w-44" />
                <col className="w-40" />
                <col className="w-24" />
              </colgroup>
              <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <SelectAllCell ids={entityRows.filter((r) => r.canApprove).map((r) => r.id)} sel={selEnt} />
                  <th className="px-3 py-3">Loại</th>
                  <th className="px-3 py-3">Đối tượng</th>
                  <th className="px-3 py-3 pl-5">Lý do hủy</th>
                  <th className="px-3 py-3">Người tạo yêu cầu</th>
                  <th className="px-3 py-3">Thời gian</th>
                  <th className="px-3 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
                {!loading && entityRows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400"><Trash2 className="mx-auto mb-2 h-6 w-6" /> Không có yêu cầu hủy dữ liệu nào chờ bạn duyệt.</td></tr>
                )}
                {!loading && entityRows.map((r) => (
                  <tr key={`${r.entityType}-${r.id}`} className={'hover:bg-appbg/60 ' + (selEnt.isSelected(r.id) ? 'bg-brand-tint/40' : '')}>
                    {r.canApprove ? <SelectCell id={r.id} sel={selEnt} /> : <td className="px-3 py-3" />}
                    <td className="px-3 py-3"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{r.entityTypeLabel}</span></td>
                    <td className="px-3 py-3 text-slate-700">{r.entityLabel ?? `#${r.entityId}`}</td>
                    <td className="px-3 py-3 pl-5 text-slate-600">{r.reason}</td>
                    <td className="px-3 py-3 text-slate-600">{r.requestedByName ?? `#${r.requestedBy}`}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{fmtDate(r.requestedAt)}</td>
                    <td className="px-3 py-3">
                      {r.canApprove ? (
                        <div className="flex justify-end gap-1">
                          <button title="Duyệt hủy" onClick={() => setDialog({ kind: 'approveEntity', row: r })} className="rounded-md p-1.5 text-success transition hover:bg-success/10"><Check className="h-4 w-4" /></button>
                          <button title="Từ chối" onClick={() => setDialog({ kind: 'rejectEntity', row: r })} className="rounded-md p-1.5 text-danger transition hover:bg-danger/10"><X className="h-4 w-4" /></button>
                        </div>
                      ) : (
                        <div className="text-right text-xs font-semibold text-amber-600 whitespace-nowrap" title="Bạn là người tạo yêu cầu này — cần NGƯỜI KHÁC (có quyền) duyệt, không tự duyệt được.">Chờ người khác duyệt</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dialog?.kind === 'approve' && (
        <ApprovePasswordModal
          title="Duyệt hủy bill"
          message={`Duyệt yêu cầu hủy bill "${dialog.row.billCode ?? dialog.row.transactionId}" (${money(dialog.row.amount)})? Bill sẽ chuyển sang Đã hủy và không còn tính vào doanh thu. Nhập mật khẩu của bạn để xác nhận.`}
          onClose={() => setDialog(null)}
          onSubmit={(password, note) => doApprove(dialog.row, password, note)}
        />
      )}
      {dialog?.kind === 'approveBulk' && (
        <ApprovePasswordModal
          title="Duyệt các yêu cầu đã chọn"
          message={`Duyệt ${sel.count} yêu cầu hủy đã chọn? Yêu cầu nào bạn không đủ thẩm quyền sẽ được bỏ qua kèm lý do. Nhập mật khẩu của bạn để xác nhận.`}
          onClose={() => setDialog(null)}
          onSubmit={(password) => doApproveBulk(password)}
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
      {dialog?.kind === 'approveEntity' && (
        <ApprovePasswordModal
          title={`Duyệt hủy ${dialog.row.entityTypeLabel}`}
          message={`Duyệt hủy ${dialog.row.entityTypeLabel} "${dialog.row.entityLabel ?? '#' + dialog.row.entityId}"? Dữ liệu sẽ bị XÓA khỏi hệ thống (xóa mềm, có thể phục hồi ở Thùng rác). Nhập mật khẩu của bạn để xác nhận.`}
          onClose={() => setDialog(null)}
          onSubmit={(password, note) => doApproveEntity(dialog.row, password, note)}
        />
      )}
      {dialog?.kind === 'approveEntityBulk' && (
        <ApprovePasswordModal
          title={`Duyệt ${selEnt.count} yêu cầu hủy dữ liệu đã chọn`}
          message={`Duyệt hủy ${selEnt.count} mục đã chọn? Dữ liệu tương ứng sẽ bị XÓA (xóa mềm, phục hồi được ở Thùng rác). Yêu cầu nào bạn không đủ thẩm quyền sẽ được bỏ qua kèm lý do. Nhập mật khẩu của bạn để xác nhận.`}
          onClose={() => setDialog(null)}
          onSubmit={(password) => doApproveEntityBulk(password)}
        />
      )}
      {dialog?.kind === 'rejectEntity' && (
        <NoteModal
          title={`Từ chối yêu cầu hủy ${dialog.row.entityTypeLabel} ${dialog.row.entityLabel ?? ''}`}
          onClose={() => setDialog(null)}
          onSubmit={(note) => doRejectEntity(dialog.row, note)}
        />
      )}
    </div>
  );
}

/** R34 — Ô duyệt hủy dữ liệu: BẮT BUỘC nhập mật khẩu người duyệt (Q2) + ghi chú tùy chọn. */
function ApprovePasswordModal({ title, message, onClose, onSubmit }: { title: string; message: string; onClose: () => void; onSubmit: (password: string, note?: string) => Promise<void> }): JSX.Element {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(): Promise<void> {
    if (!password) return toast.alert('Vui lòng nhập mật khẩu để xác nhận.', 'Thiếu mật khẩu');
    setBusy(true);
    try {
      await onSubmit(password, note.trim() || undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose} width="max-w-md">
      <p className="mb-3 text-sm text-slate-600">{message}</p>
      <Field label="Mật khẩu của bạn" required>
        <input type="password" className={inputCls} value={password} autoFocus onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
      </Field>
      <div className="mt-3">
        <Field label="Ghi chú (tùy chọn)">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú khi duyệt…" />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={submit} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Duyệt hủy</Button>
      </div>
    </Modal>
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
