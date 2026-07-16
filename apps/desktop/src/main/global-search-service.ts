// Tìm kiếm TOÀN CỤC cho ô search topbar (Mr.Long 14/7). Chỉ trả bản ghi user CÓ QUYỀN xem; gom nhóm theo loại;
// giới hạn mỗi nhóm để phản hồi nhanh.
// Mr.Long 15/7 — KHÔNG phân biệt HOA/thường + DẤU: Postgres ILIKE không fold Đ↔đ tiếng Việt → dùng
// lower(unaccent(...)) hai vế qua $queryRaw → "đức dũng" / "duc dung" / "ĐỨC DŨNG" đều khớp. Tham số hóa
// (${q}) nên an toàn injection. Bổ sung nhóm HỒ SƠ HKD (dossier) — trước đây bị bỏ sót.
import { hasPermission } from '@glb/shared';
import { getDb } from './db.js';
import { me } from './auth-service.js';

export type SearchKind = 'customer' | 'tid' | 'pos' | 'transaction' | 'dossier';

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
  const like = `%${q}%`; // dùng cho cột số (SĐT) — không unaccent

  // M-3 (audit 16/7, agent phản biện) — nếu tiện ích `unaccent` chưa cài (user Postgres thiếu quyền
  // CREATE EXTENSION và extension chưa pre-install), mọi truy vấn lower(unaccent(...)) sẽ ném. Handler
  // search:global không có wrapper → lỗi DB thô lọt thẳng renderer. Bọc try/catch → báo lỗi mềm {ok:false}.
  try {
  if (hasPermission(actor, 'CUSTOMER_VIEW')) {
    const rows = await db.$queryRaw<{ id: number; code: string | null; full_name: string; phone: string | null }[]>`
      SELECT id, code, full_name, phone FROM customers
      WHERE deleted_at IS NULL AND (
        lower(unaccent(full_name)) LIKE lower(unaccent(${like}))
        OR lower(unaccent(coalesce(code, ''))) LIKE lower(unaccent(${like}))
        OR lower(unaccent(coalesce(nickname, ''))) LIKE lower(unaccent(${like}))
        OR coalesce(phone, '') LIKE ${like}
      ) ORDER BY full_name ASC LIMIT ${PER_KIND}`;
    for (const r of rows) hits.push({ kind: 'customer', id: r.id, code: r.code ?? `#${r.id}`, label: r.full_name, sub: r.phone ?? undefined, page: 'revdebt' });
  }
  if (hasPermission(actor, 'CONFIG_DOSSIER_VIEW')) {
    const rows = await db.$queryRaw<{ id: number; hkd_name: string; owner_name: string; tax_code: string | null }[]>`
      SELECT id, hkd_name, owner_name, tax_code FROM dossiers
      WHERE deleted_at IS NULL AND (
        lower(unaccent(hkd_name)) LIKE lower(unaccent(${like}))
        OR lower(unaccent(owner_name)) LIKE lower(unaccent(${like}))
        OR lower(unaccent(coalesce(tax_code, ''))) LIKE lower(unaccent(${like}))
        OR lower(unaccent(coalesce(cccd_number, ''))) LIKE lower(unaccent(${like}))
      ) ORDER BY hkd_name ASC LIMIT ${PER_KIND}`;
    for (const r of rows) hits.push({ kind: 'dossier', id: r.id, code: r.tax_code ?? `#${r.id}`, label: r.hkd_name, sub: r.owner_name ?? undefined, page: 'dossier' });
  }
  if (hasPermission(actor, 'TID_VIEW')) {
    const rows = await db.$queryRaw<{ id: number; tid: string; mid: string | null; hkd_name: string | null }[]>`
      SELECT id, tid, mid, hkd_name FROM tids
      WHERE deleted_at IS NULL AND (
        lower(unaccent(tid)) LIKE lower(unaccent(${like}))
        OR lower(unaccent(coalesce(mid, ''))) LIKE lower(unaccent(${like}))
        OR lower(unaccent(coalesce(hkd_name, ''))) LIKE lower(unaccent(${like}))
      ) ORDER BY tid ASC LIMIT ${PER_KIND}`;
    for (const r of rows) hits.push({ kind: 'tid', id: r.id, code: r.tid, label: r.hkd_name ?? r.mid ?? r.tid, sub: r.mid ? `MID ${r.mid}` : undefined, page: 'tid' });
  }
  if (hasPermission(actor, 'POS_VIEW')) {
    const rows = await db.$queryRaw<{ id: number; serial: string; status: string }[]>`
      SELECT id, serial, status FROM pos_devices
      WHERE deleted_at IS NULL AND lower(unaccent(serial)) LIKE lower(unaccent(${like}))
      ORDER BY serial ASC LIMIT ${PER_KIND}`;
    for (const r of rows) hits.push({ kind: 'pos', id: r.id, code: r.serial, label: `Máy POS ${r.serial}`, sub: r.status, page: 'pos' });
  }
  if (hasPermission(actor, 'REVENUE_VIEW')) {
    const rows = await db.$queryRaw<{ id: number; code: string | null }[]>`
      SELECT id, code FROM transactions
      WHERE deleted_at IS NULL AND lower(unaccent(coalesce(code, ''))) LIKE lower(unaccent(${like}))
      ORDER BY id DESC LIMIT ${PER_KIND}`;
    for (const r of rows) hits.push({ kind: 'transaction', id: r.id, code: r.code ?? `#${r.id}`, label: `Giao dịch ${r.code ?? '#' + r.id}`, sub: undefined, page: 'revdebt' });
  }
  return { ok: true, data: hits };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: 'SEARCH_FAILED',
      message: /unaccent/i.test(msg)
        ? 'Tìm kiếm tạm thời không khả dụng (máy chủ thiếu tiện ích unaccent — liên hệ quản trị).'
        : 'Tìm kiếm tạm thời không khả dụng.'
    };
  }
}
