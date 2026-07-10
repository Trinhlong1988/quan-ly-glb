import { useEffect, useState } from 'react';
import { ShieldCheck, Loader2, ShieldAlert } from 'lucide-react';
import { Modal } from './Modal.js';
import { Button } from './Button.js';
import { Field, inputCls } from './Field.js';
import { PasswordInput } from './PasswordInput.js';
import { useToast } from '../lib/toast.js';

/**
 * Đặt / Đổi mật khẩu CẤP 2 (Nhóm A #3 — chỉ Admin/Manager).
 * - Chưa có → ĐẶT: mật khẩu cấp 1 (đăng nhập) + cấp 2 mới ×2.
 * - Đã có → ĐỔI: mật khẩu cấp 1 + cấp 2 CŨ + cấp 2 mới ×2. Sai quá 5 lần → khóa tài khoản.
 * Mật khẩu cấp 2 dùng để DỌN SẠCH thùng rác (xóa cứng) — băm sâu chống phá hoại.
 */
export function Level2PasswordModal({ onClose }: { onClose: () => void }): JSX.Element {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [hasLevel2, setHasLevel2] = useState(false);
  const [level1, setLevel1] = useState('');
  const [oldL2, setOldL2] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && next !== confirm;

  useEffect(() => {
    window.api.level2Status().then((r) => {
      if (r.ok) setHasLevel2(!!r.hasLevel2);
      setLoading(false);
    });
  }, []);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('Mật khẩu cấp 2 mới và xác nhận không khớp nhau.');
      return;
    }
    setBusy(true);
    try {
      const res = hasLevel2
        ? await window.api.resetLevel2(level1, oldL2, next, confirm)
        : await window.api.setLevel2(level1, next, confirm);
      if (res.ok) {
        toast.success(hasLevel2 ? 'Đã đổi mật khẩu cấp 2.' : 'Đã đặt mật khẩu cấp 2.');
        onClose();
      } else {
        const msg = res.message ?? 'Thao tác thất bại.';
        setError(msg);
        if (res.error === 'ACCOUNT_LOCKED') toast.alert(msg, 'Tài khoản đã bị khóa');
      }
    } finally {
      setBusy(false);
    }
  }

  const title = hasLevel2 ? 'Đổi mật khẩu cấp 2' : 'Đặt mật khẩu cấp 2';
  return (
    <Modal title={title} onClose={onClose} width="max-w-md">
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải…</div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-lg border border-brand/20 bg-brand-tint px-3 py-2.5 text-sm text-slate-600">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <span>Mật khẩu cấp 2 được mã hóa sâu (một chiều) và dùng để <b>dọn sạch thùng rác</b> (xóa vĩnh viễn). Hãy đặt mật khẩu mạnh, khác mật khẩu đăng nhập.</span>
          </div>
          <Field label="Mật khẩu đăng nhập (cấp 1)" required>
            <PasswordInput value={level1} onChange={(e) => setLevel1(e.target.value)} autoFocus />
          </Field>
          {hasLevel2 && (
            <Field label="Mật khẩu cấp 2 hiện tại" required>
              <PasswordInput value={oldL2} onChange={(e) => setOldL2(e.target.value)} />
            </Field>
          )}
          <Field label="Mật khẩu cấp 2 mới" required>
            <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Xác nhận mật khẩu cấp 2 mới" required>
            <PasswordInput
              className={inputCls + (mismatch ? ' border-danger focus:border-danger focus:ring-danger/20' : '')}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          {mismatch && <p className="-mt-2 text-xs font-medium text-danger">Mật khẩu xác nhận chưa khớp.</p>}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="neutral" onClick={onClose}>Hủy</Button>
            <Button type="submit" variant="confirm" disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}>
              {title}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
