// Customer CRUD service (main). IMS_SPEC §A/§D. Permission-guarded (§13), audited, soft-delete.
// Mã KH## auto-minted atomically; nickname ("biệt danh dễ gọi") is MANDATORY (§D).
// R_UX_WARN (§E): every failure returns a specific Vietnamese {ok,error,message}.
import { auditSnapshot } from '@glb/business-rules';
import { hasPermission } from '@glb/shared';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { me } from './auth-service.js';
import { getDb } from './db.js';
import { writeAudit } from './audit.js';
import { nextCode } from './code-service.js';

export interface CustomerDto {
  id: number;
  code: string;
  fullName: string;
  nickname: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  agentId: number | null;
  note: string | null;
  status: string; // ACTIVE | LOCKED | CANCELLED
  /** `KH03 · Anh Thanh Hải Phòng (Nguyễn Văn Thanh)` (§D). */
  display: string;
  createdAt: string;
}

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

export interface CustomerFilter {
  search?: string;
  agentId?: number;
  status?: string; // ACTIVE | LOCKED | CANCELLED. Bỏ trống = ẩn CANCELLED (chỉ ACTIVE + LOCKED).
  /** ISO date bounds on createdAt (R_UX_FILTER). */
  fromDate?: string;
  toDate?: string;
}

/** Build a Prisma date range from optional ISO strings; `toDate` is inclusive (end-of-day). */
export function dateRange(fromDate?: string, toDate?: string): { gte?: Date; lte?: Date } | undefined {
  const gte = fromDate ? new Date(fromDate) : undefined;
  const lte = toDate ? new Date(new Date(toDate).getTime() + 86_400_000 - 1) : undefined;
  if ((gte && !isNaN(gte.getTime())) || (lte && !isNaN(lte.getTime()))) {
    return {
      ...(gte && !isNaN(gte.getTime()) ? { gte } : {}),
      ...(lte && !isNaN(lte.getTime()) ? { lte } : {})
    };
  }
  return undefined;
}

function toDto(c: {
  id: number;
  code: string;
  fullName: string;
  nickname: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  agentId: number | null;
  note: string | null;
  status: string;
  createdAt: Date;
}): CustomerDto {
  return {
    id: c.id,
    code: c.code,
    fullName: c.fullName,
    nickname: c.nickname,
    phone: c.phone,
    email: c.email,
    address: c.address,
    agentId: c.agentId,
    note: c.note,
    status: c.status,
    display: `${c.code} · ${c.nickname} (${c.fullName})`,
    createdAt: c.createdAt.toISOString()
  };
}

/** CUSTOMER_VIEW — list customers (excludes soft-deleted), with search + agent filter. */
export async function listCustomers(
  filter: CustomerFilter = {}
): Promise<{ ok: boolean; data?: CustomerDto[]; error?: string; message?: string }> {
  const g = await requirePermission('CUSTOMER_VIEW', { action: 'CUSTOMER_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.customer.findMany({
    where: {
      deletedAt: null,
      // Lọc trạng thái: chọn rõ → đúng trạng thái đó; bỏ trống → ẩn CANCELLED (đã hủy) khỏi list mặc định.
      status: filter.status ? filter.status : { not: 'CANCELLED' },
      agentId: filter.agentId ?? undefined,
      createdAt: dateRange(filter.fromDate, filter.toDate),
      OR: filter.search
        ? [
            { code: { contains: filter.search, mode: 'insensitive' } },
            { nickname: { contains: filter.search, mode: 'insensitive' } },
            { fullName: { contains: filter.search, mode: 'insensitive' } },
            { phone: { contains: filter.search, mode: 'insensitive' } }
          ]
        : undefined
    },
    orderBy: { id: 'asc' }
  });
  return { ok: true, data: rows.map(toDto) };
}

export interface CreateCustomerInput {
  fullName: string;
  nickname: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  agentId?: number | null;
  note?: string | null;
  status?: string;
}

const CUSTOMER_STATUSES = ['ACTIVE', 'LOCKED', 'CANCELLED'];
function normCustomerStatus(s: string | undefined, fallback: string): string {
  return s !== undefined && CUSTOMER_STATUSES.includes(s) ? s : fallback;
}

/** CUSTOMER_CREATE — auto KH## + mandatory nickname (§D) + audit CUSTOMER_CREATED. */
export async function createCustomer(input: CreateCustomerInput): Promise<MutationResult> {
  const g = await requirePermission('CUSTOMER_CREATE', { action: 'CUSTOMER_CREATED', targetType: 'Customer' });
  if (!g.ok) return g;
  const { db, user } = g;

  if (!input.fullName?.trim()) return { ok: false, error: 'VALIDATION', message: 'Tên thật khách hàng bắt buộc.' };
  if (!input.nickname?.trim()) {
    return { ok: false, error: 'VALIDATION', message: 'Biệt danh (tên dễ gọi) của khách hàng là bắt buộc.' };
  }

  const created = await db.$transaction(async (tx) => {
    const code = await nextCode('KH', tx);
    return tx.customer.create({
      data: {
        code,
        fullName: input.fullName.trim(),
        nickname: input.nickname.trim(),
        phone: input.phone ?? null,
        email: input.email || null,
        address: input.address ?? null,
        agentId: input.agentId ?? null,
        note: input.note ?? null,
        status: normCustomerStatus(input.status, 'ACTIVE'),
        createdBy: user.id
      }
    });
  });

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'CUSTOMER_CREATED',
    targetType: 'Customer',
    targetId: String(created.id),
    after: auditSnapshot({ code: created.code, fullName: created.fullName, nickname: created.nickname, phone: created.phone })
  });
  return { ok: true, id: created.id };
}

export interface UpdateCustomerInput {
  fullName?: string;
  nickname?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  agentId?: number | null;
  note?: string | null;
  status?: string;
}

/** CUSTOMER_UPDATE — nickname stays mandatory; audit before/after (R_AUDIT_002). Code is immutable. */
export async function updateCustomer(id: number, input: UpdateCustomerInput): Promise<MutationResult> {
  const g = await requirePermission('CUSTOMER_UPDATE', { action: 'CUSTOMER_UPDATED', targetType: 'Customer', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.customer.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Khách hàng không tồn tại.' };

  if (input.fullName !== undefined && !input.fullName.trim()) {
    return { ok: false, error: 'VALIDATION', message: 'Tên thật khách hàng không được để trống.' };
  }
  if (input.nickname !== undefined && !input.nickname.trim()) {
    return { ok: false, error: 'VALIDATION', message: 'Biệt danh (tên dễ gọi) của khách hàng là bắt buộc.' };
  }

  const before = auditSnapshot({
    fullName: row.fullName,
    nickname: row.nickname,
    phone: row.phone,
    email: row.email,
    address: row.address,
    agentId: row.agentId,
    note: row.note,
    status: row.status
  });

  const updated = await db.customer.update({
    where: { id },
    data: {
      fullName: input.fullName?.trim() ?? row.fullName,
      nickname: input.nickname?.trim() ?? row.nickname,
      phone: input.phone !== undefined ? input.phone : row.phone,
      email: input.email !== undefined ? input.email || null : row.email,
      address: input.address !== undefined ? input.address : row.address,
      agentId: input.agentId !== undefined ? input.agentId : row.agentId,
      note: input.note !== undefined ? input.note : row.note,
      status: normCustomerStatus(input.status, row.status)
    }
  });

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'CUSTOMER_UPDATED',
    targetType: 'Customer',
    targetId: String(id),
    before,
    after: auditSnapshot({
      fullName: updated.fullName,
      nickname: updated.nickname,
      phone: updated.phone,
      email: updated.email,
      address: updated.address,
      agentId: updated.agentId,
      note: updated.note,
      status: updated.status
    })
  });
  return { ok: true, id };
}

/** CUSTOMER_DELETE — soft-delete + re-enter password (§14) + audit. */
export async function deleteCustomer(id: number, password: string): Promise<MutationResult> {
  const g = await requirePermission('CUSTOMER_DELETE', { action: 'CUSTOMER_DELETED', targetType: 'Customer', targetId: String(id) });
  if (!g.ok) return g;
  const { db, user } = g;

  if (!(await verifyActorPassword(user, password))) {
    await writeAudit(db, {
      actorUserId: user.id,
      action: 'CUSTOMER_DELETED',
      targetType: 'Customer',
      targetId: String(id),
      after: { denied: true, reason: 'WRONG_PASSWORD' }
    });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }

  const row = await db.customer.findUnique({ where: { id } });
  if (!row || row.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Khách hàng không tồn tại.' };

  await db.customer.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.id } });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'CUSTOMER_DELETED',
    targetType: 'Customer',
    targetId: String(id),
    before: auditSnapshot({ code: row.code, fullName: row.fullName, nickname: row.nickname })
  });
  return { ok: true, id };
}

/** Small helper for other services / UI: agents for the dropdown. */
export async function listAgents(): Promise<{ ok: boolean; data?: { id: number; code: string | null; name: string; region: string | null }[]; error?: string; message?: string }> {
  const actor = me();
  if (!actor) return { ok: false, error: 'NOT_AUTHENTICATED', message: 'Bạn chưa đăng nhập.' };
  if (!hasPermission(actor, 'CUSTOMER_VIEW') && !hasPermission(actor, 'POS_VIEW') && !hasPermission(actor, 'TID_VIEW')) {
    return { ok: false, error: 'FORBIDDEN', message: 'Bạn không có quyền xem danh sách đại lý.' };
  }
  const db = getDb();
  const rows = await db.agent.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' } });
  return { ok: true, data: rows.map((a) => ({ id: a.id, code: a.code, name: a.name, region: a.region })) };
}
