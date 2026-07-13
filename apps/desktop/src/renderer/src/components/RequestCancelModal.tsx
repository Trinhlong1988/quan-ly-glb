// R34 (Mr.Long 11/7) — Modal "Yêu cầu hủy" dùng chung cho TID / POS / Khách hàng / Nhân sự.
// "Hủy" = xóa mềm khỏi hệ thống nhưng PHẢI qua duyệt: nút này chỉ TẠO yêu cầu (kèm lý do), Admin/Manager
// duyệt ở trung tâm "Duyệt Hủy". Người yêu cầu ≠ người duyệt. Dùng chung để đồng bộ trải nghiệm mọi trang.
import { useState } from 'react';
import { Modal } from './Modal.js';
import { Button } from './Button.js';
import { Field, inputCls } from './Field.js';
import { useToast } from '../lib/toast.js';

export interface RequestCancelTarget {
  entityType: 'Tid' | 'PosDevice' | 'Customer' | 'User';
  entityId: number;
  entityLabel: string; // hiển thị cho người dùng biết đang hủy cái gì
  typeLabel: string; // 'TID' | 'máy POS' | 'khách hàng' | 'nhân sự'
}

export function RequestCancelModal({ target, onClose, onDone }: { target: RequestCancelTarget; onClose: () => void; onDone: () => void }): JSX.Element {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    const r = reason.trim();
    if (!r) {
      toast.alert('Vui lòng nhập lý do hủy.');
      return;
    }
    setBusy(true);
    const res = await window.api.entityCancelRequest(target.entityType, target.entityId, r);
    setBusy(false);
    if (res.ok) {
      toast.success('Đã gửi yêu cầu hủy — chờ Admin/Quản lý duyệt.');
      onDone();
    } else {
      toast.alert(res.message ?? 'Gửi yêu cầu hủy thất bại.', 'Không gửi được');
    }
  }

  return (
    <Modal title={`Yêu cầu hủy ${target.typeLabel}`} onClose={onClose} width="max-w-lg">
      <div className="space-y-3">
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-slate-600">
          Bạn đang yêu cầu hủy (xóa khỏi hệ thống) <span className="font-semibold text-slate-800">{target.entityLabel}</span>. Thao tác này{' '}
          <span className="font-semibold">cần Admin/Quản lý duyệt</span> mới thực hiện — bạn không thể tự duyệt.
        </div>
        <Field label="Lý do hủy" required>
          <textarea
            className={inputCls + ' min-h-[88px] resize-y'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Nêu rõ lý do để người duyệt xem xét…"
            autoFocus
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>
            Hủy bỏ
          </Button>
          <Button variant="danger" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Đang gửi…' : 'Gửi yêu cầu hủy'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Yêu cầu hủy HÀNG LOẠT (nhiều dòng đã tích) — vẫn PHẢI qua Duyệt Hủy R34: chỉ TẠO yêu cầu (kèm lý do),
 * Admin/Manager duyệt sau. Lặp gọi entityCancelRequest cho từng id (engine chưa hỗ trợ nhiều id/lượt),
 * gộp kết quả n thành công / n lỗi. KHÔNG xóa cứng. Theo "chuẩn hiện hành" của luồng đơn (lý do, không
 * nhập mật khẩu ở bước YÊU CẦU — mật khẩu nhập lúc DUYỆT).
 */
export function BulkRequestCancelModal({
  entityType,
  ids,
  typeLabel,
  onClose,
  onDone
}: {
  entityType: 'Tid' | 'PosDevice' | 'Customer' | 'User';
  ids: number[];
  typeLabel: string;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    const r = reason.trim();
    if (!r) {
      toast.alert('Vui lòng nhập lý do hủy.');
      return;
    }
    setBusy(true);
    let ok = 0;
    const errs: string[] = [];
    for (const id of ids) {
      const res = await window.api.entityCancelRequest(entityType, id, r);
      if (res.ok) ok++;
      else errs.push(res.message ?? 'lỗi');
    }
    setBusy(false);
    if (ok > 0) toast.success(`Đã gửi ${ok}/${ids.length} yêu cầu hủy — chờ Admin/Quản lý duyệt.${errs.length ? ` ${errs.length} mục lỗi.` : ''}`);
    else toast.alert(errs[0] ? `Không gửi được yêu cầu nào. ${errs[0]}` : 'Không gửi được yêu cầu hủy.', 'Không gửi được');
    onDone();
  }

  return (
    <Modal title={`Yêu cầu hủy ${ids.length} ${typeLabel}`} onClose={onClose} width="max-w-lg">
      <div className="space-y-3">
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-slate-600">
          Bạn đang yêu cầu hủy (xóa khỏi hệ thống) <span className="font-semibold text-slate-800">{ids.length} {typeLabel}</span> đã chọn. Thao tác này{' '}
          <span className="font-semibold">cần Admin/Quản lý duyệt</span> mới thực hiện — bạn không thể tự duyệt.
        </div>
        <Field label="Lý do hủy (áp dụng cho tất cả mục đã chọn)" required>
          <textarea
            className={inputCls + ' min-h-[88px] resize-y'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Nêu rõ lý do để người duyệt xem xét…"
            autoFocus
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>
            Hủy bỏ
          </Button>
          <Button variant="danger" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Đang gửi…' : `Gửi yêu cầu hủy (${ids.length})`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
