// Undelivered-TID notification (§A5).
// STATUS: STUB. The in-app badge (getUndeliveredSummary) is REAL — it queries live data.
// The daily Zalo push (pushUndeliveredZalo) and the scheduler (startDailyUndeliveredScheduler)
// are STUBS: they format + log the message but do NOT actually send to Zalo yet. Real Zalo
// delivery (reuse of the QLTK Zalo Web infra) is a follow-up task — see design proposal §A5.
import { requirePermission } from './guard.js';
import { listUndeliveredTids } from './tid-service.js';

export interface UndeliveredSummary {
  count: number;
  totalAgingDays: number;
  topAgingDays: number;
  topTid: string | null;
}

/** REAL: in-app badge summary of TID chưa giao (TID_VIEW). */
export async function getUndeliveredSummary(): Promise<{ ok: boolean; data?: UndeliveredSummary; error?: string; message?: string }> {
  const g = await requirePermission('TID_VIEW', { action: 'TID_VIEW' });
  if (!g.ok) return g;
  const res = await listUndeliveredTids();
  if (!res.ok || !res.data) return { ok: true, data: { count: 0, totalAgingDays: 0, topAgingDays: 0, topTid: null } };
  const list = res.data;
  const totalAgingDays = list.reduce((s, t) => s + t.agingDays, 0);
  const top = list[0]; // already sorted longest-first
  return {
    ok: true,
    data: {
      count: list.length,
      totalAgingDays,
      topAgingDays: top?.agingDays ?? 0,
      topTid: top?.tid ?? null
    }
  };
}

/** Compose the daily push text (pure) — reused by the stub push + future real sender. */
export function composeUndeliveredMessage(s: UndeliveredSummary): string {
  if (s.count === 0) return 'Tuyệt vời: hiện KHÔNG có TID nào chưa giao.';
  return (
    `[Nhắc nhở TID chưa giao] Có ${s.count} TID chưa giao, tổng ${s.totalAgingDays} ngày tồn. ` +
    `Lâu nhất: ${s.topTid} (${s.topAgingDays} ngày). TID chưa giao = lãng phí, không ra doanh thu.`
  );
}

/** STUB: would push the summary to Zalo. Currently only logs + returns the message. */
export async function pushUndeliveredZalo(): Promise<{ ok: boolean; stub: true; message?: string; error?: string }> {
  const summary = await getUndeliveredSummary();
  if (!summary.ok || !summary.data) return { ok: false, stub: true, error: summary.error };
  const text = composeUndeliveredMessage(summary.data);
  // eslint-disable-next-line no-console
  console.log('[notification][STUB] would push to Zalo:', text);
  return { ok: true, stub: true, message: text };
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * STUB scheduler: in a full build this fires every morning (cron). Here it is a no-op
 * interface that can be started/stopped; it does NOT actually send anything.
 */
export function startDailyUndeliveredScheduler(): { started: boolean; stub: true } {
  if (timer) return { started: true, stub: true };
  // Intentionally NOT wired to a real daily trigger yet (stub). Kept as an interface.
  return { started: false, stub: true };
}

export function stopDailyUndeliveredScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
