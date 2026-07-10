// Hòm thư nội bộ + thông báo hệ thống (Nhóm A #2 + Nhóm C #7, LEAD 9/7).
// Bảng messages dùng chung: kind=SYSTEM (thông báo bảo mật, senderId null) | USER (thư người dùng).
// Nhận realtime = renderer poll vài giây (Cách A); tách lớp sẵn để nâng WebSocket khi lên VPS.
import type { Db } from '@glb/database';
import { getDb } from './db.js';
import { requirePermission } from './guard.js';
import { writeAudit } from './audit.js';

export interface MessageDto {
  id: number;
  kind: string;
  category: string | null;
  subject: string;
  body: string;
  senderId: number | null;
  senderName: string | null;
  recipientId: number;
  readAt: string | null;
  createdAt: string;
}

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

/**
 * Gửi thông báo hệ thống tới MỌI quản trị (user ACTIVE có quyền AUDIT_LOG_VIEW = Admin/Manager).
 * Nội bộ — không qua guard (được gọi từ auth-service khi có sự kiện bảo mật). Không ném lỗi ra ngoài.
 */
export async function notifyAdmins(
  db: Db,
  input: { category: string; subject: string; body: string }
): Promise<number> {
  try {
    const admins = await db.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        roles: {
          some: { role: { status: 'ACTIVE', permissions: { some: { permission: { code: 'AUDIT_LOG_VIEW' } } } } }
        }
      },
      select: { id: true }
    });
    if (admins.length === 0) return 0;
    await db.message.createMany({
      data: admins.map((a) => ({
        kind: 'SYSTEM',
        category: input.category,
        subject: input.subject,
        body: input.body,
        senderId: null,
        recipientId: a.id
      }))
    });
    return admins.length;
  } catch {
    // Thông báo là phụ trợ — không được làm hỏng luồng chính (đăng nhập/đổi mật khẩu).
    return 0;
  }
}

function toDto(m: {
  id: number;
  kind: string;
  category: string | null;
  subject: string;
  body: string;
  senderId: number | null;
  recipientId: number;
  readAt: Date | null;
  createdAt: Date;
  sender?: { fullName: string } | null;
}): MessageDto {
  return {
    id: m.id,
    kind: m.kind,
    category: m.category,
    subject: m.subject,
    body: m.body,
    senderId: m.senderId,
    senderName: m.sender?.fullName ?? (m.senderId === null ? 'Hệ thống' : null),
    recipientId: m.recipientId,
    readAt: m.readAt ? m.readAt.toISOString() : null,
    createdAt: m.createdAt.toISOString()
  };
}

/** MESSAGE_VIEW — hòm thư của CHÍNH người đang đăng nhập (thư đến, mới nhất trước). */
export async function listInbox(): Promise<{ ok: boolean; data?: MessageDto[]; error?: string; message?: string }> {
  const g = await requirePermission('MESSAGE_VIEW', { action: 'MESSAGE_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.message.findMany({
    where: { recipientId: g.user.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 200
  });
  // Nạp tên người gửi (nếu có) — 1 lượt.
  const senderIds = [...new Set(rows.map((r) => r.senderId).filter((x): x is number => x !== null))];
  const senders = senderIds.length
    ? await g.db.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, fullName: true } })
    : [];
  const nameById = new Map(senders.map((s) => [s.id, s.fullName]));
  return {
    ok: true,
    data: rows.map((r) => toDto({ ...r, sender: r.senderId !== null ? { fullName: nameById.get(r.senderId) ?? '—' } : null }))
  };
}

/** Số thư CHƯA đọc của người đang đăng nhập (bộ đếm realtime). */
export async function unreadCount(): Promise<{ ok: boolean; data?: number; error?: string; message?: string }> {
  const g = await requirePermission('MESSAGE_VIEW', { action: 'MESSAGE_VIEW' });
  if (!g.ok) return g;
  const n = await g.db.message.count({ where: { recipientId: g.user.id, deletedAt: null, readAt: null } });
  return { ok: true, data: n };
}

/** Đánh dấu ĐÃ đọc (chỉ thư của chính mình). */
export async function markRead(messageId: number): Promise<MutationResult> {
  const g = await requirePermission('MESSAGE_VIEW', { action: 'MESSAGE_MARK_READ', targetType: 'Message', targetId: String(messageId) });
  if (!g.ok) return g;
  const m = await g.db.message.findUnique({ where: { id: messageId }, select: { recipientId: true, readAt: true } });
  if (!m || m.recipientId !== g.user.id) return { ok: false, error: 'NOT_FOUND', message: 'Không tìm thấy thư.' };
  if (!m.readAt) await g.db.message.update({ where: { id: messageId }, data: { readAt: new Date() } });
  return { ok: true, id: messageId };
}

/** Đánh dấu ĐÃ đọc tất cả thư của mình. */
export async function markAllRead(): Promise<MutationResult> {
  const g = await requirePermission('MESSAGE_VIEW', { action: 'MESSAGE_MARK_ALL_READ' });
  if (!g.ok) return g;
  await g.db.message.updateMany({ where: { recipientId: g.user.id, deletedAt: null, readAt: null }, data: { readAt: new Date() } });
  return { ok: true };
}

/** MESSAGE_SEND — gửi thư nội bộ cho một người dùng khác (Nhóm C). */
export async function sendMessage(input: { recipientId: number; subject: string; body: string }): Promise<MutationResult> {
  const g = await requirePermission('MESSAGE_SEND', { action: 'MESSAGE_SEND', targetType: 'User', targetId: String(input.recipientId) });
  if (!g.ok) return g;
  const subject = input.subject?.trim();
  const body = input.body?.trim();
  if (!subject) return { ok: false, error: 'EMPTY_SUBJECT', message: 'Vui lòng nhập tiêu đề thư.' };
  if (!body) return { ok: false, error: 'EMPTY_BODY', message: 'Vui lòng nhập nội dung thư.' };
  const recipient = await g.db.user.findFirst({ where: { id: input.recipientId, deletedAt: null }, select: { id: true } });
  if (!recipient) return { ok: false, error: 'NO_RECIPIENT', message: 'Người nhận không tồn tại.' };
  const created = await g.db.message.create({
    data: { kind: 'USER', subject, body, senderId: g.user.id, recipientId: recipient.id }
  });
  await writeAudit(g.db, {
    actorUserId: g.user.id,
    action: 'MESSAGE_SENT',
    targetType: 'User',
    targetId: String(recipient.id),
    after: { subject }
  });
  return { ok: true, id: created.id };
}
