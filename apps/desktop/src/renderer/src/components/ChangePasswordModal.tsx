import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { Modal } from './Modal.js';
import { Button } from './Button.js';
import { Field, inputCls } from './Field.js';
import { PasswordInput } from './PasswordInput.js';
import { useToast } from '../lib/toast.js';

/**
 * Đổi mật khẩu tự nguyện (Nhóm A #1): mật khẩu cũ + mới + xác nhận KHỚP.
 * Máy chủ xác thực lại (khác cũ, đủ mạnh, khớp xác nhận) + tính vào bộ đếm khóa nếu sai cũ.
 */
export function ChangePasswordModal({ onClose }: { onClose: () => void }): JSX.Element {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!current || !next || !confirm) {
      setError('Vui lòng nhập đủ mật khẩu hiện tại, mật khẩu mới và xác nhận.');
      return;
    }
    if (next !== confirm) {
      setError('Mật khẩu mới và xác nhận không khớp nhau.');
      return;
    }
    setBusy(true);
    try {
      const res = await window.api.changePassword(current, next, confirm);
      if (res.ok) {
        toast.success('Đã đổi mật khẩu thành công.');
        onClose();
      } else {
        const msg = res.message ?? 'Đổi mật khẩu thất bại.';
        setError(msg);
        if (res.error === 'ACCOUNT_LOCKED') toast.alert(msg, 'Tài khoản đã bị khóa');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Đổi mật khẩu" onClose={onClose} width="max-w-md">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Mật khẩu hiện tại" required>
          <PasswordInput value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </Field>
        <Field label="Mật khẩu mới" required>
          <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Xác nhận mật khẩu mới" required>
          <PasswordInput
            className={inputCls + (mismatch ? ' border-danger focus:border-danger focus:ring-danger/20' : '')}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        {mismatch && <p className="-mt-2 text-xs font-medium text-danger">Mật khẩu xác nhận chưa khớp.</p>}

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="neutral" onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" variant="confirm" disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}>
            Đổi mật khẩu
          </Button>
        </div>
      </form>
    </Modal>
  );
}
