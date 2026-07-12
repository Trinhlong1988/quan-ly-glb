// R48 Pha 4 — Realtime: đo lường thay đổi dữ liệu giữa các máy/người dùng.
// Client poll realtimeTokens() (~10s): so version của MIỀN mình đang xem với lần trước — tăng nghĩa là người
// khác vừa sửa → nhắc "Có dữ liệu mới, tải lại". pendingCancels = badge số yêu-cầu-hủy đang chờ trên menu Duyệt hủy.
// Đọc bảng change_tokens tí hon (bump trong writeAudit) → O(1) dù audit log phình vô hạn.
import { getDb } from './db.js';
import { validateCurrentSession } from './auth-service.js';

export interface RealtimeTokens {
  byDomain: Record<string, number>; // targetType → version (đồng hồ thay đổi của miền)
  pendingCancels: number; // số ApprovalRequest PENDING (bill + dữ liệu R34) — badge menu Duyệt hủy
  serverNow: string;
}

export async function realtimeTokens(): Promise<{ ok: boolean; data?: RealtimeTokens; error?: string; message?: string }> {
  const v = await validateCurrentSession();
  if (!v) return { ok: false, error: 'NOT_AUTHENTICATED', message: 'Phiên không hợp lệ.' };
  const db = getDb();
  const [tokens, pendingCancels] = await Promise.all([
    db.changeToken.findMany({ select: { domain: true, version: true } }),
    db.approvalRequest.count({ where: { status: 'PENDING' } })
  ]);
  const byDomain: Record<string, number> = {};
  for (const t of tokens) byDomain[t.domain] = Number(t.version); // BigInt → number (biên đọc)
  return { ok: true, data: { byDomain, pendingCancels, serverNow: new Date().toISOString() } };
}
