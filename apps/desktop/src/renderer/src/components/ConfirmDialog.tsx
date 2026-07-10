import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Modal } from './Modal.js';
import { PasswordInput } from './PasswordInput.js';

/**
 * Confirmation dialog (IMS_SPEC §14). ALWAYS has a Hủy (cancel) button.
 * When `requirePassword` is set, a password field is shown and passed to onConfirm — used for
 * xóa user / xóa role (nhập lại mật khẩu).
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Đồng ý',
  danger = false,
  requirePassword = false,
  onCancel,
  onConfirm
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  requirePassword?: boolean;
  onCancel: () => void;
  onConfirm: (password?: string) => Promise<void> | void;
}): JSX.Element {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(): Promise<void> {
    if (requirePassword && !password) return;
    setBusy(true);
    try {
      await onConfirm(requirePassword ? password : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onCancel} width="max-w-md">
      <div className="flex gap-3">
        <div
          className={
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ' +
            (danger ? 'bg-danger/10 text-danger' : 'bg-brand-tint text-brand')
          }
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{message}</p>
          {requirePassword && (
            <label className="mt-4 flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Nhập lại mật khẩu để xác nhận</span>
              <PasswordInput
                value={password}
                autoFocus
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && run()}
                placeholder="Mật khẩu của bạn"
              />
            </label>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-600 hover:bg-appbg"
        >
          Hủy
        </button>
        <button
          onClick={run}
          disabled={busy || (requirePassword && !password)}
          className={
            'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ' +
            (danger ? 'bg-danger hover:bg-danger/90' : 'bg-brand hover:bg-brand-hover')
          }
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
