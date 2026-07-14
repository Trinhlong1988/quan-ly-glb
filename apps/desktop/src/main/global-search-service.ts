// Tìm kiếm TOÀN CỤC cho ô search topbar (Mr.Long 14/7). Chỉ trả bản ghi user CÓ QUYỀN xem; gom nhóm theo loại;
// giới hạn mỗi nhóm để phản hồi nhanh. Chuỗi trim + độ dài giới hạn; dùng Prisma (không ghép SQL tay).
import { hasPermission } from '@glb/shared';
import { getDb } from './db.js';
import { me } from './auth-service.js';

export type SearchKind = 'customer' | 'tid' | 'pos' | 'transaction';

export interface SearchHit {
  kind: SearchKind;
  id: number;
  code: string; // mã/khóa chính hiển thị
  label: string; // tên/tiêu đề
  sub?: string; // dòng phụ
  /** key trang đích để renderer điều hướng (khớp MENU key ở Dashboard). */
  page: string;
}

export interface GlobalSearchResult {
  ok: boolean;
  error?: string;
  message?: string;
  data?: SearchHit[];
}

const PER_KIND = 6;
const MAX_Q = 64;

export async function globalSearch(rawQuery: string): Promise<GlobalSearchResult> {
  const actor = me();
  if (!actor) return { ok: false, error: 'NOT_AUTHENTICATED', message: 'Bạn chưa đăng nhập.' };
  const q = String(rawQuery ?? '').trim().slice(0, MAX_Q);
  if (q.length < 2) return { ok: true, data: [] }; // < 2 ký tự: không phát truy vấn
  const db = getDb();
  const hits: SearchHit[] = [];
  const contains = { contains: q } as const;

  if (hasPermission(actor, 'CUSTOMER_VIEW')) {
    const rows = await db.customer.findMany({
      where: { deletedAt: null, OR: [{ fullName: contains }, { code: contains }, { nickname: contains }, { phone: contains }] },
      select: { id: true, code: true, fullName: true, phone: true },
      take: PER_KIND,
      orderBy: { fullName: 'asc' }
    });
    for (const r of rows) hits.push({ kind: 'customer', id: r.id, code: r.code ?? `#${r.id}`, label: r.fullName, sub: r.phone ?? undefined, page: 'revdebt' });
  }
  if (hasPermission(actor, 'TID_VIEW')) {
    const rows = await db.tid.findMany({
      where: { deletedAt: null, OR: [{ tid: contains }, { mid: contains }, { hkdName: contains }] },
      select: { id: true, tid: true, mid: true, hkdName: true },
      take: PER_KIND,
      orderBy: { tid: 'asc' }
    });
    for (const r of rows) hits.push({ kind: 'tid', id: r.id, code: r.tid, label: r.hkdName ?? r.mid ?? r.tid, sub: r.mid ? `MID ${r.mid}` : undefined, page: 'tid' });
  }
  if (hasPermission(actor, 'POS_VIEW')) {
    const rows = await db.posDevice.findMany({
      where: { deletedAt: null, serial: contains },
      select: { id: true, serial: true, status: true },
      take: PER_KIND,
      orderBy: { serial: 'asc' }
    });
    for (const r of rows) hits.push({ kind: 'pos', id: r.id, code: r.serial, label: `Máy POS ${r.serial}`, sub: r.status, page: 'pos' });
  }
  if (hasPermission(actor, 'REVENUE_VIEW')) {
    const rows = await db.transaction.findMany({
      where: { deletedAt: null, code: contains },
      select: { id: true, code: true, amount: true },
      take: PER_KIND,
      orderBy: { id: 'desc' }
    });
    for (const r of rows) hits.push({ kind: 'transaction', id: r.id, code: r.code ?? `#${r.id}`, label: `Giao dịch ${r.code ?? '#' + r.id}`, sub: undefined, page: 'revdebt' });
  }
  return { ok: true, data: hits };
}
