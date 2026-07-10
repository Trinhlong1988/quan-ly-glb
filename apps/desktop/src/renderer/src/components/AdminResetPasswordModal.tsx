import { useState } from 'react';
import { KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { Modal } from './Modal.js';
import { Button } from './Button.js';
import { Field, inputCls } from './Field.js';
import { PasswordInput } from './PasswordInput.js';
import { useToast } from '../lib/toast.js';

/**
 * Admin/Manager ĐẶT LẠI mật khẩu cho user khác (Nhóm A #1).
 * Không cần mật khẩu cũ; đặt mật khẩu mới → hệ thống ép user đổi ở lần đăng nhập kế + mở khóa nếu đang khóa.
 */
export function AdminResetPasswordModal({
  target,
  onClose,
  onDone
}: {
  target: { id: number; fullName: string; username: string };
  onClose: () => void;
  onDone?: () => void;
}): JSX.Element {
  const toast = useToast();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && next !== confirm;

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!next || !confirm) {
      setError('Vui lòng nhập mật khẩu mới và xác nhận.');
      return;
    }
    if (next !== confirm) {
      setError('Mật khẩu mới và xác nhận không khớp nhau.');
      return;
    }
    setBusy(true);
    try {
      const res = await window.api.adminResetPassword(target.id, next);
      if (res.ok) {
        toast.success(`Đã đặt lại mật khẩu cho ${target.fullName}. Người dùng sẽ phải đổi mật khẩu ở lần đăng nhập kế.`);
        onDone?.();
        onClose();
      } else {
        const msg = res.message ?? 'Đặt lại mật khẩu thất bại.';
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Đặt lại mật khẩu người dùng" onClose={onClose} width="max-w-md">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm text-slate-600">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            Đặt lại mật khẩu cho <span className="font-semibold text-slate-800">{target.fullName}</span> (
            {target.username}). Người dùng sẽ được yêu cầu đổi mật khẩu ngay ở lần đăng nhập kế tiếp; nếu đang bị
            khóa sẽ được mở khóa.
          </span>
        </div>
        <Field label="Mật khẩu mới" required>
          <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} autoFocus />
        </Field>
        <Field label="Xác nhận mật khẩu mới" required>
          <PasswordInput
            className={inputCls + (mismatch ? ' border-danger focus:border-danger focus:ring-danger/20' : '')}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        {mismatch && <p className="-mt-2 text-xs font-medium text-danger">Mật khẩu xác nhận chưa khớp.</p>}
        {error && <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>}

        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="neutral" onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" variant="confirm" disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}>
            Đặt lại mật khẩu
          </Button>
        </div>
      </form>
    </Modal>
  );
}
