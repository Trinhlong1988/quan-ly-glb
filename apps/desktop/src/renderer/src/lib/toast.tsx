import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, Info } from 'lucide-react';

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

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = seq++;
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3800);
  }, []);

  const api = useMemo<ToastCtx>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m)
    }),
    [push]
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className="flex items-start gap-2 rounded-lg border border-line bg-white px-3.5 py-3 shadow-lg"
          >
            {t.kind === 'success' && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />}
            {t.kind === 'error' && <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />}
            {t.kind === 'info' && <Info className="mt-0.5 h-5 w-5 shrink-0 text-brand" />}
            <span className="text-sm leading-snug text-slate-700">{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
