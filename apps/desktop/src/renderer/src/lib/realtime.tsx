// R48 Pha 4 — Realtime (client): poll realtimeTokens ~10s, cung cấp version từng miền + số chờ duyệt.
// Dùng: bọc app trong <RealtimeProvider>; badge menu đọc useRealtime().pendingCancels; mỗi trang danh sách
// đặt <StaleBanner domain="Tid" onReload={reload} /> → khi người khác sửa miền đó, hiện thanh "Tải lại".
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface RealtimeState {
  byDomain: Record<string, number>;
  pendingCancels: number;
  ready: boolean; // đã có ít nhất 1 lần poll thành công (tránh báo "mới" giả lúc vừa mở)
}
const RealtimeCtx = createContext<RealtimeState>({ byDomain: {}, pendingCancels: 0, ready: false });

export function RealtimeProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [state, setState] = useState<RealtimeState>({ byDomain: {}, pendingCancels: 0, ready: false });
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const r = await window.api.realtimeTokens();
        if (alive && r.ok && r.data) setState({ byDomain: r.data.byDomain, pendingCancels: r.data.pendingCancels, ready: true });
      } catch {
        /* mạng chập chờn — bỏ qua nhịp này */
      }
    };
    void tick();
    const id = setInterval(tick, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return <RealtimeCtx.Provider value={state}>{children}</RealtimeCtx.Provider>;
}

export function useRealtime(): RealtimeState {
  return useContext(RealtimeCtx);
}

/**
 * Theo dõi 1 hoặc nhiều miền dữ liệu (khớp targetType audit, vd 'Tid'/'Customer'/'Fund'). Trả `stale=true` khi
 * version tăng so với mốc đã "ack" gần nhất (người khác vừa sửa). `ack()` đặt lại mốc (gọi sau khi trang tải lại).
 */
export function useDomainStale(domains: string | string[]): { stale: boolean; ack: () => void } {
  const { byDomain, ready } = useRealtime();
  const list = Array.isArray(domains) ? domains : [domains];
  const sig = list.map((d) => byDomain[d] ?? 0).join(',');
  const baseline = useRef<string | null>(null);
  // Chỉ chốt mốc khi ĐÃ có dữ liệu poll (ready) — tránh mốc '0,0' rồi báo "mới" giả ở nhịp đầu.
  useEffect(() => {
    if (ready && baseline.current === null) baseline.current = sig;
  }, [ready, sig]);
  const stale = ready && baseline.current !== null && baseline.current !== sig;
  const ack = useCallback(() => {
    baseline.current = sig;
  }, [sig]);
  return { stale, ack };
}

/** Thanh mảnh "Dữ liệu vừa được cập nhật ở nơi khác — Tải lại". Ẩn khi không có thay đổi. */
export function StaleBanner({ domain, onReload, className }: { domain: string | string[]; onReload: () => void; className?: string }): JSX.Element | null {
  const { stale, ack } = useDomainStale(domain);
  if (!stale) return null;
  return (
    <div className={'flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 ' + (className ?? '')}>
      <span className="flex items-center gap-2">
        <RefreshCw className="h-4 w-4" /> Dữ liệu vừa được người khác cập nhật.
      </span>
      <button
        onClick={async () => {
          // FE-11 (Codex 15/7): ACK SAU khi reload xong (trước đây ack trước → reload lỗi làm banner biến mất
          // trong khi bảng vẫn cũ, không cảnh báo lại tới lần đổi version sau).
          await onReload();
          ack();
        }}
        className="rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-amber-600"
      >
        Tải lại
      </button>
    </div>
  );
}
