// G-POS.1 asset lifecycle rules (IMS_SPEC §A3). Pure, dependency-free, unit-tested.
// State machines for POS device + TID, and identifier-code formatting (§D).
// These predicates are the enforceable core; the service layer wires them to the DB + audit.

export type PosStatus = 'IN_STOCK' | 'DEPLOYED' | 'IN_REPAIR' | 'DAMAGED' | 'RETIRED' | 'SOLD';
export type TidStatus = 'UNASSIGNED' | 'ACTIVE' | 'DEAD' | 'CLOSED' | 'RECALLED' | 'SOLD';

export const TID_STATUSES: TidStatus[] = ['UNASSIGNED', 'ACTIVE', 'DEAD', 'CLOSED', 'RECALLED', 'SOLD'];

/** POS lifecycle events → allowed source states + resulting state (§A3). */
export type PosEvent = 'deploy' | 'recall' | 'transferAgent' | 'changeCustomer' | 'cancelCustomer' | 'sell' | 'reportDamage' | 'sendRepair' | 'receiveRepaired' | 'retire';

interface PosRule {
  from: PosStatus[];
  to: PosStatus;
  /** Audit event type recorded on the immutable log. */
  eventType: string;
}

export const POS_TRANSITIONS: Record<PosEvent, PosRule> = {
  deploy: { from: ['IN_STOCK'], to: 'DEPLOYED', eventType: 'DEPLOY' },
  recall: { from: ['DEPLOYED'], to: 'IN_STOCK', eventType: 'RECALL' },
  // Agent-to-agent transfer keeps the device DEPLOYED.
  transferAgent: { from: ['DEPLOYED'], to: 'DEPLOYED', eventType: 'TRANSFER_AGENT' },
  // POS #2 (Mr.Long 12/7) — đổi khách giữ máy: máy giữ nguyên DEPLOYED, giữ nguyên TID; TID đi theo
  // khách mới (giao máy-có-TID = giao cả TID). 1 bước atomic, không recall+deploy rời.
  changeCustomer: { from: ['DEPLOYED'], to: 'DEPLOYED', eventType: 'CHANGE_CUSTOMER' },
  // #6 (Mr.Long 12/7) — hủy khách giữ máy: GIỮ DEPLOYED + GIỮ khách (để biết máy đang ở đâu mà thu về),
  // chỉ đánh dấu "chờ thu hồi". KHÁC recall (recall = máy về kho). TID giữ nguyên trên máy.
  cancelCustomer: { from: ['DEPLOYED'], to: 'DEPLOYED', eventType: 'CANCEL_CUSTOMER' },
  // #3 (Mr.Long 12/7) — bán đứt máy: từ trong kho HOẶC đang cho khách dùng → ĐÃ BÁN (terminal, rời tồn kho).
  // Máy có TID → TID bán kèm sang khách mua (xử lý ở service). Có tiền → nhập lại mật khẩu (service).
  sell: { from: ['IN_STOCK', 'DEPLOYED'], to: 'SOLD', eventType: 'SELL' },
  reportDamage: { from: ['DEPLOYED', 'IN_STOCK'], to: 'DAMAGED', eventType: 'REPORT_DAMAGE' },
  sendRepair: { from: ['DAMAGED'], to: 'IN_REPAIR', eventType: 'SEND_REPAIR' },
  receiveRepaired: { from: ['IN_REPAIR'], to: 'IN_STOCK', eventType: 'RECEIVE_REPAIRED' },
  // A device may be retired from any live state (never from RETIRED — terminal).
  retire: { from: ['IN_STOCK', 'DEPLOYED', 'IN_REPAIR', 'DAMAGED'], to: 'RETIRED', eventType: 'RETIRE' }
};

export interface TransitionDecision<S> {
  allowed: boolean;
  to?: S;
  eventType?: string;
  reason?: string;
}

/** Validate a POS device transition. Returns the target state + audit eventType when allowed. */
export function decidePosTransition(from: PosStatus, event: PosEvent): TransitionDecision<PosStatus> {
  const rule = POS_TRANSITIONS[event];
  if (!rule) return { allowed: false, reason: 'UNKNOWN_EVENT' };
  if (!rule.from.includes(from)) return { allowed: false, reason: 'INVALID_STATE' };
  return { allowed: true, to: rule.to, eventType: rule.eventType };
}

/** TID lifecycle events → allowed source states + resulting state (§A3). */
export type TidEvent = 'assign' | 'markDead' | 'close' | 'recall' | 'activateReplacement' | 'sell';

interface TidRule {
  from: TidStatus[];
  to: TidStatus;
  eventType: string;
}

export const TID_TRANSITIONS: Record<TidEvent, TidRule> = {
  // PHASE K1 (spec §2.5): cho gán từ UNASSIGNED (TID mới) HOẶC ACTIVE (TID đã thu hồi khỏi máy,
  // posSerial=null — lắp sang máy khác). Chặn TID trên máy (posSerial!=null) + DEAD/CLOSED/RECALLED
  // ở service layer (assignTid guard TID_ON_DEVICE). Query "chưa giao" KHÔNG bị ô nhiễm vì status
  // GIỮ ACTIVE + deliveredAt không đổi.
  assign: { from: ['UNASSIGNED', 'ACTIVE'], to: 'ACTIVE', eventType: 'TID_ASSIGN' },
  markDead: { from: ['ACTIVE'], to: 'DEAD', eventType: 'TID_DEAD' },
  close: { from: ['ACTIVE'], to: 'CLOSED', eventType: 'TID_CLOSE' },
  recall: { from: ['ACTIVE', 'DEAD', 'CLOSED'], to: 'RECALLED', eventType: 'TID_RECALL' },
  // The replacement TID coming online during a TID swap.
  activateReplacement: { from: ['UNASSIGNED'], to: 'ACTIVE', eventType: 'TID_REPLACE' },
  // #3 (Mr.Long 12/7) — bán TID: TID chưa trên máy (posSerial=null, chưa giao) bán cho khách → ĐÃ BÁN.
  // Áp cho: (a) bán kèm khi bán máy (TID đang ACTIVE trên máy → service tháo rồi set SOLD);
  // (b) bán TID riêng lẻ (UNASSIGNED / ACTIVE chưa trên máy). Guard posSerial ở service.
  sell: { from: ['UNASSIGNED', 'ACTIVE'], to: 'SOLD', eventType: 'TID_SELL' }
};

export function decideTidTransition(from: TidStatus, event: TidEvent): TransitionDecision<TidStatus> {
  const rule = TID_TRANSITIONS[event];
  if (!rule) return { allowed: false, reason: 'UNKNOWN_EVENT' };
  if (!rule.from.includes(from)) return { allowed: false, reason: 'INVALID_STATE' };
  return { allowed: true, to: rule.to, eventType: rule.eventType };
}

// ── Identifier codes (§D) ────────────────────────────────────────────────────

/** A code prefix is 2-4 uppercase letters (NV, KH, POS…). */
export const CODE_PREFIX_REGEX = /^[A-Z]{2,4}$/;

export function isValidCodePrefix(prefix: string): boolean {
  return typeof prefix === 'string' && CODE_PREFIX_REGEX.test(prefix);
}

/** Format a counter value as PREFIX + zero-padded number (min 2 digits): NV01, NV100. */
export function formatCode(prefix: string, value: number): string {
  if (!isValidCodePrefix(prefix)) throw new Error(`Prefix mã không hợp lệ: ${prefix}`);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Giá trị mã không hợp lệ: ${value}`);
  return prefix + String(value).padStart(2, '0');
}

/** Does `code` match `PREFIX` followed by ≥2 digits (no leading letters mismatch)? */
export function isValidCode(prefix: string, code: string): boolean {
  if (!isValidCodePrefix(prefix)) return false;
  return new RegExp('^' + prefix + '\\d{2,}$').test(code);
}
