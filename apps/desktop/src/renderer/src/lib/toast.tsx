import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, Info, AlertTriangle, HelpCircle } from 'lucide-react';
import { setDialogBridge, type ConfirmOpts } from './dialogBridge.js';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastCtx {
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
  /** Dialog báo lỗi TO, RÕ RÀNG cho thao tác sai/nguy hiểm (R_BUTTON_SEMANTICS, LEAD 9/7). */
  alert: (message: string, title?: string) => void;
  /** Hộp thoại xác nhận 2 nút DÙNG CHUNG (ví dụ "Mở / Không mở" sau khi xuất Excel). Trả Promise<boolean>. */
  confirm: (message: string, opts?: ConfirmOpts) => Promise<boolean>;
}

interface ConfirmState {
  title: string;
  message: string;
  okLabel: string;
  cancelLabel: string;
  resolve: (v: boolean) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast must be used inside <ToastProvider>');
  return c;
}

let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<Toast[]>([]);
  const [alertBox, setAlertBox] = useState<{ title: string; message: string } | null>(null);
  const [confirmBox, setConfirmBox] = useState<ConfirmState | null>(null);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = seq++;
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3800);
  }, []);

  const api = useMemo<ToastCtx>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
      alert: (message, title = 'Thao tác không hợp lệ') => setAlertBox({ title, message }),
      confirm: (message, opts) =>
        new Promise<boolean>((resolve) =>
          setConfirmBox({ title: opts?.title ?? 'Xác nhận', message, okLabel: opts?.okLabel ?? 'Đồng ý', cancelLabel: opts?.cancelLabel ?? 'Hủy', resolve })
        )
    }),
    [push]
  );

  // Đăng ký cầu nối cho code thuần (lib/exportCsv…) dùng chung hộp thoại này.
  useEffect(() => {
    setDialogBridge({ success: api.success, alert: api.alert, confirm: api.confirm });
  }, [api]);

  function closeConfirm(v: boolean): void {
    if (confirmBox) confirmBox.resolve(v);
    setConfirmBox(null);
  }

  return (
    <Ctx.Provider value={api}>
      {children}

      {/* Toast góc phải (thông báo nhẹ) */}
      <div className="fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={
              'flex items-start gap-2 rounded-lg border px-3.5 py-3 shadow-lg ' +
              (t.kind === 'error'
                ? 'border-danger/30 bg-danger/5'
                : t.kind === 'success'
                  ? 'border-success/30 bg-success/5'
                  : 'border-line bg-white')
            }
          >
            {t.kind === 'success' && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />}
            {t.kind === 'error' && <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />}
            {t.kind === 'info' && <Info className="mt-0.5 h-5 w-5 shrink-0 text-brand" />}
            <span className="text-sm leading-snug text-slate-700">{t.message}</span>
          </div>
        ))}
      </div>

      {/* Dialog báo lỗi TO, RÕ RÀNG — thao tác sai/nguy hiểm */}
      {alertBox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setAlertBox(null)}>
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 bg-danger px-6 py-4 text-white">
              <AlertTriangle className="h-7 w-7 shrink-0" />
              <h3 className="text-lg font-bold">{alertBox.title}</h3>
            </div>
            <div className="px-6 py-6">
              <p className="text-[15px] leading-relaxed text-slate-700">{alertBox.message}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
              <button
                onClick={() => setAlertBox(null)}
                className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-hover"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hộp thoại XÁC NHẬN 2 nút DÙNG CHUNG — ví dụ "Mở / Không mở" sau khi xuất Excel */}
      {confirmBox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => closeConfirm(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 bg-brand px-6 py-4 text-white">
              <HelpCircle className="h-7 w-7 shrink-0" />
              <h3 className="text-lg font-bold">{confirmBox.title}</h3>
            </div>
            <div className="px-6 py-6">
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{confirmBox.message}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
              <button onClick={() => closeConfirm(false)} className="rounded-lg bg-brand/10 px-5 py-2.5 text-sm font-semibold text-brand transition hover:bg-brand/20">
                {confirmBox.cancelLabel}
              </button>
              <button onClick={() => closeConfirm(true)} className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-hover">
                {confirmBox.okLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
