// TID service (main). IMS_SPEC §A. Event-sourced: assign/replace/recall/markDelivered each write an
// immutable asset_event + pos_tid_binding rows, project TID + POS state, and audit. Guarded (TID_VIEW/TID_MANAGE).
import { decideTidTransition, auditSnapshot, type TidStatus } from '@glb/business-rules';
import { hasPermission } from '@glb/shared';
import type { Db } from '@glb/database';
import { requirePermission } from './guard.js';
import { me } from './auth-service.js';
import { validateRefs as validateConfigRefs } from './tid-config-service.js';
import { writeAudit } from './audit.js';
import { dateRange } from './customer-service.js';

// PHASE K2 (Q-T1): TID có 2 CHIỀU ĐỘC LẬP, DERIVE (không cột bool):
//   • "Gán máy POS"    = deviceAssigned = posSerial != null
//   • "Giao cho khách" = delivered      = deliveredAt != null
// DTO hợp nhất (§1): trả CẢ nhóm vận hành LẪN cấu hình (bank/partner/HKD/…) để UI 1 bề mặt.
export interface TidDto {
  id: number;
  tid: string;
  mid: string | null;
  bank: string | null; // legacy text (G-POS.1)
  status: string; // vòng đời sống/chết: UNASSIGNED|ACTIVE|DEAD|CLOSED|RECALLED
  posSerial: string | null;
  customerId: number | null;
  agentId: number | null;
  openedAt: string | null;
  deliveredAt: string | null;
  closedAt: string | null;
  createdAt: string;
  // ── 2 chiều DERIVE (Q-T1) + máy khách (Q-T6) + HKD (Q-T3) ──
  deviceAssigned: boolean;
  delivered: boolean;
  customerDeviceSerial: string | null;
  dossierId: number | null;
  // ── cấu hình hợp nhất (§1/§9) ──
  bankId: number | null;
  bankCode: string | null;
  bankName: string | null;
  partnerId: number | null;
  partnerCode: string | null;
  partnerName: string | null;
  hkdName: string | null;
  receiveAccountId: number | null;
  issuedAt: string | null;
  configStatusId: number | null;
  configStatusName: string | null;
  dossierSourceId: number | null;
  dossierSourceCode: string | null;
  note: string | null;
  // ── tên tra cứu (Giao cho khách / đại lý) ──
  customerName: string | null;
  agentName: string | null;
}

export interface UndeliveredTidDto extends TidDto {
  /** Days since openedAt (or createdAt) — the "waste" aging metric (§A5). */
  agingDays: number;
}

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

/** Sentinel ném trong $transaction để rollback + trả MutationResult lỗi nghiệp vụ cho caller. */
class TidTxAbort extends Error {
  constructor(public readonly result: MutationResult) {
    super(result.message ?? result.error ?? 'ABORT');
  }
}

export interface TidFilter {
  search?: string;
  bank?: string;
  status?: string;
  /** PHASE K2 Q-T2 — 2 bộ lọc độc lập (derive posSerial / deliveredAt). */
  deviceAssigned?: boolean;
  delivered?: boolean;
  /** ISO date bounds on openedAt (R_UX_FILTER). */
  fromDate?: string;
  toDate?: string;
}

interface TidRow {
  id: number;
  tid: string;
  mid: string | null;
  bank: string | null;
  status: string;
  posSerial: string | null;
  customerId: number | null;
  agentId: number | null;
  openedAt: Date | null;
  deliveredAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  customerDeviceSerial: string | null;
  dossierId: number | null;
  bankId: number | null;
  partnerId: number | null;
  hkdName: string | null;
  receiveAccountId: number | null;
  issuedAt: Date | null;
  configStatusId: number | null;
  dossierSourceId: number | null;
  note: string | null;
}
interface TidNameMaps {
  banks: Map<number, { code: string; name: string }>;
  partners: Map<number, { code: string; name: string }>;
  statuses: Map<number, string>;
  dsources: Map<number, string>;
  customers: Map<number, string>;
  agents: Map<number, string>;
}
function distinctIds(arr: (number | null)[]): number[] {
  return [...new Set(arr.filter((x): x is number => typeof x === 'number'))];
}
/** Resolve FK names (bank/partner/status/source/customer/agent) cho 1 tập tids — join ở service layer. */
async function buildTidMaps(db: Db, rows: TidRow[]): Promise<TidNameMaps> {
  return {
    banks: new Map((await db.bank.findMany({ where: { id: { in: distinctIds(rows.map((r) => r.bankId)) } }, select: { id: true, code: true, name: true } })).map((b) => [b.id, { code: b.code, name: b.name }])),
    partners: new Map((await db.partner.findMany({ where: { id: { in: distinctIds(rows.map((r) => r.partnerId)) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, { code: p.code, name: p.name }])),
    statuses: new Map((await db.tidConfigStatus.findMany({ where: { id: { in: distinctIds(rows.map((r) => r.configStatusId)) } }, select: { id: true, name: true } })).map((s) => [s.id, s.name])),
    dsources: new Map((await db.dossierSource.findMany({ where: { id: { in: distinctIds(rows.map((r) => r.dossierSourceId)) } }, select: { id: true, code: true } })).map((s) => [s.id, s.code])),
    customers: new Map((await db.customer.findMany({ where: { id: { in: distinctIds(rows.map((r) => r.customerId)) } }, select: { id: true, nickname: true, fullName: true } })).map((c) => [c.id, c.nickname || c.fullName])),
    agents: new Map((await db.agent.findMany({ where: { id: { in: distinctIds(rows.map((r) => r.agentId)) } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]))
  };
}
function toDto(t: TidRow, maps: TidNameMaps): TidDto {
  const bank = t.bankId != null ? maps.banks.get(t.bankId) : undefined;
  const partner = t.partnerId != null ? maps.partners.get(t.partnerId) : undefined;
  return {
    id: t.id,
    tid: t.tid,
    mid: t.mid,
    bank: t.bank,
    status: t.status,
    posSerial: t.posSerial,
    customerId: t.customerId,
    agentId: t.agentId,
    openedAt: t.openedAt ? t.openedAt.toISOString() : null,
    deliveredAt: t.deliveredAt ? t.deliveredAt.toISOString() : null,
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    deviceAssigned: t.posSerial != null,
    delivered: t.deliveredAt != null,
    customerDeviceSerial: t.customerDeviceSerial,
    dossierId: t.dossierId,
    bankId: t.bankId,
    bankCode: bank?.code ?? null,
    bankName: bank?.name ?? null,
    partnerId: t.partnerId,
    partnerCode: partner?.code ?? null,
    partnerName: partner?.name ?? null,
    hkdName: t.hkdName,
    receiveAccountId: t.receiveAccountId,
    issuedAt: t.issuedAt ? t.issuedAt.toISOString() : null,
    configStatusId: t.configStatusId,
    configStatusName: t.configStatusId != null ? maps.statuses.get(t.configStatusId) ?? null : null,
    dossierSourceId: t.dossierSourceId,
    dossierSourceCode: t.dossierSourceId != null ? maps.dsources.get(t.dossierSourceId) ?? null : null,
    note: t.note,
    customerName: t.customerId != null ? maps.customers.get(t.customerId) ?? null : null,
    agentName: t.agentId != null ? maps.agents.get(t.agentId) ?? null : null
  };
}

/** TID_VIEW OR CONFIG_TID_VIEW — list TIDs (hợp nhất): search (tid/mid/HKD) + bank/status + 2 chiều derive. */
export async function listTids(filter: TidFilter = {}): Promise<{ ok: boolean; data?: TidDto[]; error?: string; message?: string }> {
  const g = await requireTidView();
  if (!g.ok) return g;
  const rows = await g.db.tid.findMany({
    where: {
      deletedAt: null,
      bank: filter.bank || undefined,
      status: filter.status || undefined,
      openedAt: dateRange(filter.fromDate, filter.toDate),
      // 2 chiều độc lập (Q-T2): lọc theo posSerial / deliveredAt null / not-null (AND).
      posSerial: filter.deviceAssigned === undefined ? undefined : filter.deviceAssigned ? { not: null } : null,
      deliveredAt: filter.delivered === undefined ? undefined : filter.delivered ? { not: null } : null,
      OR: filter.search
        ? [{ tid: { contains: filter.search, mode: 'insensitive' } }, { mid: { contains: filter.search, mode: 'insensitive' } }, { hkdName: { contains: filter.search, mode: 'insensitive' } }]
        : undefined
    },
    orderBy: { id: 'asc' }
  });
  const maps = await buildTidMaps(g.db, rows);
  return { ok: true, data: rows.map((r) => toDto(r, maps)) };
}

/** TID_VIEW OR CONFIG_TID_VIEW — "TID chưa giao" (§A5/§1): còn sống (notIn DEAD/CLOSED/RECALLED),
 *  CHƯA giao (deliveredAt=null), KHÔNG soft-deleted (deletedAt=null). Đồng bộ badge notification. */
export async function listUndeliveredTids(): Promise<{ ok: boolean; data?: UndeliveredTidDto[]; error?: string; message?: string }> {
  const g = await requireTidView();
  if (!g.ok) return g;
  const rows = await g.db.tid.findMany({
    where: {
      deletedAt: null, // BUG soft-delete (§1): trước đây thiếu → TID đã xóa vẫn lọt badge.
      status: { notIn: ['DEAD', 'CLOSED', 'RECALLED'] },
      deliveredAt: null
    },
    orderBy: { openedAt: 'asc' }
  });
  const maps = await buildTidMaps(g.db, rows);
  const now = Date.now();
  const data = rows.map((t) => {
    const base = (t.openedAt ?? t.createdAt).getTime();
    const agingDays = Math.max(0, Math.floor((now - base) / 86_400_000));
    return { ...toDto(t, maps), agingDays };
  });
  // Longest-waiting first — most wasteful at the top.
  data.sort((a, b) => b.agingDays - a.agingDays);
  return { ok: true, data };
}

/** Guard xem TID hợp nhất: chấp nhận TID_VIEW HOẶC CONFIG_TID_VIEW (Q-T4). Không audit dư khi có
 *  1 trong 2 quyền — chỉ audit FORBIDDEN 1 lần khi thiếu CẢ hai. */
async function requireTidView(): ReturnType<typeof requirePermission> {
  const user = me();
  if (user && hasPermission(user, 'TID_VIEW')) return requirePermission('TID_VIEW', { action: 'TID_VIEW' });
  return requirePermission('CONFIG_TID_VIEW', { action: 'CONFIG_TID_VIEW' });
}

export interface CreateTidInput {
  tid: string;
  mid?: string | null;
  bank?: string | null;
  openedAt?: string | null;
}

/** TID_MANAGE — register a TID (UNASSIGNED) + TID_CREATED audit. */
export async function createTid(input: CreateTidInput): Promise<MutationResult> {
  const g = await requirePermission('TID_MANAGE', { action: 'TID_CREATED', targetType: 'Tid' });
  if (!g.ok) return g;
  const { db, user } = g;

  const tid = input.tid?.trim();
  if (!tid) return { ok: false, error: 'VALIDATION', message: 'Số TID bắt buộc.' };
  const dup = await db.tid.findUnique({ where: { tid } });
  if (dup) return { ok: false, error: 'DUPLICATE', message: `TID "${tid}" đã tồn tại.` };

  const created = await db.tid.create({
    data: {
      tid,
      mid: input.mid ?? null,
      bank: input.bank ?? null,
      status: 'UNASSIGNED',
      openedAt: input.openedAt ? parseWhen(input.openedAt) : new Date()
    }
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'TID_CREATED',
    targetType: 'Tid',
    targetId: String(created.id),
    after: auditSnapshot({ tid, bank: created.bank, status: 'UNASSIGNED' })
  });
  return { ok: true, id: created.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE K2 (Q-T5 + Q-T3/T6) — createTidUnified: 1 form tạo TID ĐẦY ĐỦ (gom createConfigTid).
// Cho phép CHƯA gán máy + CHƯA giao (2 chiều độc lập). Nếu có assign/deliver → cùng $transaction.
// Perm: CONFIG_TID_MANAGE (base) + TID_MANAGE (khi có assign/deliver — vận hành).
// ─────────────────────────────────────────────────────────────────────────────
export interface CreateTidUnifiedInput {
  tid: string;
  mid?: string | null;
  dossierId?: number | null; // Q-T3 link HKD
  hkdName: string; // giữ text (hiển thị/backfill)
  partnerId: number;
  bankId: number;
  receiveAccountId?: number | null;
  issuedAt?: string | null;
  configStatusId?: number | null;
  dossierSourceId?: number | null;
  note?: string | null;
  customerDeviceSerial?: string | null; // Q-T6 máy của khách
  assign?: { posSerial: string; customerId: number };
  deliver?: { deliveredAt?: string | null; customerId: number; toAgentId?: number | null };
}

export async function createTidUnified(input: CreateTidUnifiedInput): Promise<MutationResult> {
  const g = await requirePermission('CONFIG_TID_MANAGE', { action: 'TID_CONFIG_CREATED', targetType: 'Tid' });
  if (!g.ok) return g;
  const { db, user } = g;

  const wantsOps = !!input.assign || !!input.deliver;
  if (wantsOps && !hasPermission(user, 'TID_MANAGE')) {
    await writeAudit(db, { actorUserId: user.id, action: 'PERMISSION_DENIED', targetType: 'Tid', after: { deniedAction: 'TID_ASSIGN_OR_DELIVER', requiredPermission: 'TID_MANAGE', actor: user.username } });
    return { ok: false, error: 'FORBIDDEN', message: 'Cần quyền Quản lý TID (gán/giao) để gán máy hoặc giao khách ngay khi tạo.' };
  }

  const tid = input.tid?.trim();
  const hkdName = input.hkdName?.trim();
  if (!tid) return { ok: false, error: 'VALIDATION', message: 'Chuỗi TID bắt buộc.' };
  if (!input.bankId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn ngân hàng.' };
  if (!input.partnerId) return { ok: false, error: 'VALIDATION', message: 'Vui lòng chọn đối tác.' };
  if (!hkdName) return { ok: false, error: 'VALIDATION', message: 'Tên Hộ Kinh Doanh bắt buộc.' };
  const refErr = await validateConfigRefs(db, input);
  if (refErr) return refErr;
  if (input.dossierId != null) {
    const d = await db.dossier.findUnique({ where: { id: input.dossierId } });
    if (!d || d.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Hồ sơ HKD đã chọn không tồn tại.' };
  }

  // Kiểm chứng nhánh assign/deliver TRƯỚC transaction (tránh abort trong tx).
  let devAgentId: number | null = null;
  let assignSerial: string | null = null;
  if (input.assign) {
    assignSerial = input.assign.posSerial?.trim() || null;
    if (!assignSerial) return { ok: false, error: 'VALIDATION', message: 'Phải chọn máy POS để gán TID.' };
    if (input.assign.customerId == null) return { ok: false, error: 'VALIDATION', message: 'Phải chọn khách hàng nhận TID.' };
    const devPre = await db.posDevice.findUnique({ where: { serial: assignSerial } });
    if (!devPre) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy máy POS serial "${assignSerial}".` };
    if (devPre.status === 'RETIRED') return { ok: false, error: 'INVALID_STATE', message: `Máy POS "${assignSerial}" đã thanh lý, không thể gán TID.` };
    // FIX1 (K2 hardening): pre-check bất biến 1 máy 1 TID (re-kiểm lại trong tx sau FOR UPDATE).
    if (devPre.currentTid != null && devPre.currentTid !== tid) {
      return { ok: false, error: 'DEVICE_HAS_TID', message: `Máy ${assignSerial} đang gắn TID ${devPre.currentTid}. Thu hồi TID đó khỏi máy trước khi gán TID khác.` };
    }
  }
  if (input.deliver && input.deliver.customerId == null) {
    return { ok: false, error: 'VALIDATION', message: 'Phải chọn khách hàng để đánh dấu đã giao.' };
  }
  // FIX2 (K2 hardening): customerId/agentId là Int? (không FK) → validate tồn tại để không lưu id bừa.
  const custIds = distinctIds([input.assign?.customerId ?? null, input.deliver?.customerId ?? null]);
  for (const cid of custIds) {
    const c = await db.customer.findUnique({ where: { id: cid } });
    if (!c || c.deletedAt) return { ok: false, error: 'NOT_FOUND', message: `Khách hàng #${cid} không tồn tại.` };
  }
  if (input.deliver?.toAgentId != null) {
    const a = await db.agent.findUnique({ where: { id: input.deliver.toAgentId } });
    if (!a || a.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Đại lý đã chọn không tồn tại.' };
  }

  // tid @unique + soft-delete → phân biệt trùng đang dùng vs trùng trong thùng rác (B05).
  const dup = await db.tid.findFirst({ where: { tid } });
  if (dup) {
    return dup.deletedAt
      ? { ok: false, error: 'DUPLICATE_TRASH', message: `TID "${tid}" đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn TID khác.` }
      : { ok: false, error: 'DUPLICATE', message: `TID "${tid}" đã tồn tại.` };
  }

  const now = new Date();
  let createdId = 0;
  try {
    await db.$transaction(async (tx) => {
      const createdTid = await tx.tid.create({
        data: {
          tid,
          mid: input.mid ?? null,
          status: 'UNASSIGNED',
          openedAt: now,
          bankId: input.bankId,
          partnerId: input.partnerId,
          hkdName,
          dossierId: input.dossierId ?? null,
          receiveAccountId: input.receiveAccountId ?? null,
          issuedAt: parseDateOrNull(input.issuedAt),
          configStatusId: input.configStatusId ?? null,
          dossierSourceId: input.dossierSourceId ?? null,
          customerDeviceSerial: input.customerDeviceSerial?.trim() || null,
          note: input.note?.trim() || null,
          createdBy: user.id
        }
      });
      createdId = createdTid.id;

      let custSet: number | null = null;
      let agentSet: number | null = null;

      if (input.assign && assignSerial) {
        await tx.$queryRaw`SELECT id FROM pos_devices WHERE serial = ${assignSerial} FOR UPDATE`;
        const dev = await tx.posDevice.findUnique({ where: { serial: assignSerial } });
        // FIX4: máy có thể biến mất giữa pre-check và FOR UPDATE re-đọc → NOT_FOUND rõ (không ném thô).
        if (!dev) throw new TidTxAbort({ ok: false, error: 'NOT_FOUND', message: 'Máy POS không còn tồn tại.' });
        // FIX1: BẤT BIẾN 1 máy 1 TID — chặn gán lên máy đang mang TID khác (mồ côi + 2 binding mở).
        if (dev.currentTid != null && dev.currentTid !== tid) {
          throw new TidTxAbort({ ok: false, error: 'DEVICE_HAS_TID', message: `Máy ${assignSerial} đang gắn TID ${dev.currentTid}. Thu hồi TID đó khỏi máy trước khi gán TID khác.` });
        }
        devAgentId = dev.currentAgentId ?? null;
        agentSet = devAgentId;
        custSet = input.assign.customerId;
        await tx.tid.update({ where: { id: createdId }, data: { status: 'ACTIVE', posSerial: assignSerial, customerId: custSet, agentId: agentSet } });
        const posPatch: Record<string, unknown> = { currentTid: tid, currentCustomerId: custSet, updatedBy: user.id };
        if (dev.status === 'IN_STOCK') posPatch.status = 'DEPLOYED';
        await tx.posDevice.update({ where: { id: dev.id }, data: posPatch });
        await tx.posTidBinding.create({ data: { posSerial: assignSerial, tid, boundAt: now } });
        await tx.assetEvent.create({
          data: {
            deviceSerial: assignSerial,
            tid,
            eventType: 'TID_ASSIGN',
            fromState: 'UNASSIGNED',
            toState: 'ACTIVE',
            customerId: custSet,
            toAgentId: agentSet,
            actorUserId: user.id,
            occurredAt: now,
            afterJson: JSON.stringify(auditSnapshot({ tid, posSerial: assignSerial, status: 'ACTIVE' }))
          }
        });
      }

      if (input.deliver) {
        // FIX3: nếu create có CẢ assign lẫn deliver, deliver.occurredAt = max(deliveredAt, assign now)
        // để TID_DELIVERED KHÔNG xếp trước TID_ASSIGN khi deliveredAt lùi ngày (timeline đúng thứ tự).
        const rawDelAt = parseWhen(input.deliver.deliveredAt);
        const delAt = input.assign && rawDelAt.getTime() < now.getTime() ? now : rawDelAt;
        const delCust = input.deliver.customerId;
        const delAgent = input.deliver.toAgentId ?? agentSet ?? null;
        await tx.tid.update({ where: { id: createdId }, data: { deliveredAt: delAt, customerId: delCust, agentId: delAgent } });
        await tx.assetEvent.create({
          data: {
            deviceSerial: assignSerial,
            tid,
            eventType: 'TID_DELIVERED',
            fromState: input.assign ? 'ACTIVE' : 'UNASSIGNED',
            toState: input.assign ? 'ACTIVE' : 'UNASSIGNED',
            customerId: delCust,
            toAgentId: delAgent,
            actorUserId: user.id,
            occurredAt: delAt,
            note: input.customerDeviceSerial ? `Máy khách: ${input.customerDeviceSerial}` : null
          }
        });
      }
    });
  } catch (e) {
    if (e instanceof TidTxAbort) return e.result;
    if (isUniqueViolation(e)) return { ok: false, error: 'DUPLICATE', message: `TID "${tid}" đã tồn tại.` };
    throw e;
  }

  await writeAudit(db, { actorUserId: user.id, action: 'TID_CONFIG_CREATED', targetType: 'Tid', targetId: String(createdId), after: auditSnapshot({ tid, bankId: input.bankId, partnerId: input.partnerId, hkdName, assigned: !!input.assign, delivered: !!input.deliver }) });
  return { ok: true, id: createdId };
}

/** CONFIG_TID_VIEW — endpoint lite (D1) cho form Thêm TID: HKD + đối tác + ngân hàng + map PartnerBank.
 *  KHÔNG dùng quyền CONFIG_BANK_VIEW (giữ role cũ; WAREHOUSE có CONFIG_TID_MANAGE dùng form được). */
export interface TidRefs {
  dossiers: { id: number; hkdName: string; ownerName: string | null }[];
  partners: { id: number; code: string; name: string }[];
  banks: { id: number; code: string; name: string }[];
  /** partnerId → danh sách bankId liên kết (PartnerBank alive). */
  partnerBanks: Record<number, number[]>;
}
export async function tidRefs(): Promise<{ ok: boolean; data?: TidRefs; error?: string; message?: string }> {
  const g = await requirePermission('CONFIG_TID_VIEW', { action: 'CONFIG_TID_VIEW' });
  if (!g.ok) return g;
  const db = g.db;
  const [dossiers, partners, banks, links] = await Promise.all([
    db.dossier.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' }, select: { id: true, hkdName: true, ownerName: true } }),
    db.partner.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' }, select: { id: true, code: true, name: true } }),
    db.bank.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' }, select: { id: true, code: true, name: true } }),
    db.partnerBank.findMany({ where: { deletedAt: null }, select: { partnerId: true, bankId: true } })
  ]);
  const partnerBanks: Record<number, number[]> = {};
  for (const l of links) (partnerBanks[l.partnerId] ??= []).push(l.bankId);
  return {
    ok: true,
    data: {
      dossiers: dossiers.map((d) => ({ id: d.id, hkdName: d.hkdName, ownerName: d.ownerName ?? null })),
      partners,
      banks,
      partnerBanks
    }
  };
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}
function parseDateOrNull(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export interface AssignTidInput {
  posSerial: string;
  customerId: number;
  occurredAt?: string | null;
  note?: string | null;
}

/** TID_MANAGE — bind a UNASSIGNED TID to a POS + customer → ACTIVE (§A3). */
export async function assignTid(tid: string, input: AssignTidInput): Promise<MutationResult> {
  const g = await requirePermission('TID_MANAGE', { action: 'TID_ASSIGNED', targetType: 'Tid' });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.tid.findUnique({ where: { tid } });
  if (!row) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy TID "${tid}".` };
  const decision = decideTidTransition(row.status as TidStatus, 'assign');
  if (!decision.allowed) {
    // Còn lại DEAD/CLOSED/RECALLED (UNASSIGNED + ACTIVE đã cho phép ở state machine K1).
    return { ok: false, error: decision.reason, message: `Không thể gán TID đang ở trạng thái ${row.status} (đã chết/đóng/thu hồi).` };
  }
  // FIX 1 (K1): TID đang gắn trên 1 máy (posSerial!=null) PHẢI thu hồi khỏi máy đó trước khi lắp máy
  // khác — chống 1 TID trên 2 máy. TID mới (UNASSIGNED) và TID đã tháo khỏi máy (ACTIVE, posSerial=null)
  // đều có posSerial=null → gán được.
  if (row.posSerial != null) {
    return { ok: false, error: 'TID_ON_DEVICE', message: `TID "${tid}" đang gắn trên máy ${row.posSerial}. Thu hồi khỏi máy đó trước khi lắp máy khác.` };
  }
  if (!input.posSerial?.trim()) return { ok: false, error: 'VALIDATION', message: 'Phải chọn máy POS để gán TID.' };
  if (input.customerId == null) return { ok: false, error: 'VALIDATION', message: 'Phải chọn khách hàng nhận TID.' };

  const serial = input.posSerial.trim();
  const devPre = await db.posDevice.findUnique({ where: { serial } });
  if (!devPre) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy máy POS serial "${input.posSerial}".` };
  if (devPre.status === 'RETIRED') return { ok: false, error: 'INVALID_STATE', message: `Máy POS "${serial}" đã thanh lý, không thể gán TID.` };

  const occurredAt = parseWhen(input.occurredAt);
  let devAgentId: number | null = null;
  try {
    await db.$transaction(async (tx) => {
      // PHASE K1: khóa hàng tid + máy FOR UPDATE (TOCTOU) rồi re-đọc trong transaction.
      await tx.$queryRaw`SELECT id FROM tids WHERE tid = ${tid} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM pos_devices WHERE serial = ${serial} FOR UPDATE`;
      const dev = await tx.posDevice.findUnique({ where: { serial } });
      // FIX4 (K2 hardening): máy có thể biến mất giữa pre-check và FOR UPDATE re-đọc → NOT_FOUND rõ.
      if (!dev) throw new TidTxAbort({ ok: false, error: 'NOT_FOUND', message: 'Máy POS không còn tồn tại.' });
      // FIX1 (K2 hardening): BẤT BIẾN 1 máy chỉ mang 1 TID. FOR UPDATE đang khóa nhưng chưa kiểm →
      // gán TID lên máy đang mang TID khác = mồ côi TID cũ + 2 binding mở. Chặn DEVICE_HAS_TID.
      if (dev.currentTid != null && dev.currentTid !== tid) {
        throw new TidTxAbort({ ok: false, error: 'DEVICE_HAS_TID', message: `Máy ${serial} đang gắn TID ${dev.currentTid}. Thu hồi TID đó khỏi máy trước khi gán TID khác.` });
      }
      devAgentId = dev.currentAgentId ?? null;
      await tx.tid.update({
        where: { id: row.id },
        data: { status: 'ACTIVE', posSerial: serial, customerId: input.customerId, agentId: devAgentId }
      });
      // Q-P/§2.4: máy vừa nhập kho (IN_STOCK) → DEPLOYED khi gán TID + giao khách; giữ nếu đã DEPLOYED.
      const posPatch: Record<string, unknown> = { currentTid: tid, currentCustomerId: input.customerId, updatedBy: user.id };
      if (dev.status === 'IN_STOCK') posPatch.status = 'DEPLOYED';
      await tx.posDevice.update({ where: { id: dev.id }, data: posPatch });
      await tx.posTidBinding.create({ data: { posSerial: serial, tid, boundAt: occurredAt } });
      await tx.assetEvent.create({
        data: {
          deviceSerial: serial,
          tid,
          eventType: decision.eventType!,
          fromState: row.status,
          toState: 'ACTIVE',
          customerId: input.customerId,
          toAgentId: devAgentId,
          actorUserId: user.id,
          occurredAt,
          note: input.note ?? null,
          afterJson: JSON.stringify(auditSnapshot({ tid, posSerial: serial, status: 'ACTIVE' }))
        }
      });
    });
  } catch (e) {
    if (e instanceof TidTxAbort) return e.result;
    throw e;
  }

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'TID_ASSIGNED',
    targetType: 'Tid',
    targetId: String(row.id),
    before: { status: row.status },
    after: auditSnapshot({ status: 'ACTIVE', posSerial: serial, customerId: input.customerId })
  });
  return { ok: true, id: row.id };
}

export interface ReplaceTidInput {
  newTid: string;
  occurredAt?: string | null;
  note?: string | null;
  unbindReason?: string | null;
}

/** TID_MANAGE — swap: old ACTIVE → DEAD + unbind; new UNASSIGNED → ACTIVE + bind to same POS/customer (§A3). */
export async function replaceTid(oldTid: string, input: ReplaceTidInput): Promise<MutationResult> {
  const g = await requirePermission('TID_MANAGE', { action: 'TID_REPLACED', targetType: 'Tid' });
  if (!g.ok) return g;
  const { db, user } = g;

  const newTidStr = input.newTid?.trim();
  if (!newTidStr) return { ok: false, error: 'VALIDATION', message: 'Phải nhập TID mới để thay thế.' };
  if (newTidStr === oldTid) return { ok: false, error: 'VALIDATION', message: 'TID mới phải khác TID cũ.' };

  const oldRow = await db.tid.findUnique({ where: { tid: oldTid } });
  if (!oldRow) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy TID cũ "${oldTid}".` };
  const oldDecision = decideTidTransition(oldRow.status as TidStatus, 'markDead');
  if (!oldDecision.allowed) {
    return { ok: false, error: oldDecision.reason, message: `TID cũ đang ở trạng thái ${oldRow.status}, chỉ TID đang hoạt động mới thay được.` };
  }
  const newRow = await db.tid.findUnique({ where: { tid: newTidStr } });
  if (!newRow) return { ok: false, error: 'NOT_FOUND', message: `TID mới "${newTidStr}" chưa có trong hệ thống — hãy tạo trước.` };
  const newDecision = decideTidTransition(newRow.status as TidStatus, 'activateReplacement');
  if (!newDecision.allowed) {
    return { ok: false, error: newDecision.reason, message: `TID mới "${newTidStr}" đang ở trạng thái ${newRow.status}, chỉ TID chưa gán mới dùng thay thế được.` };
  }

  const posSerial = oldRow.posSerial;
  const customerId = oldRow.customerId;
  const occurredAt = parseWhen(input.occurredAt);

  await db.$transaction(async (tx) => {
    // Old TID → DEAD + unbind.
    await tx.tid.update({ where: { id: oldRow.id }, data: { status: 'DEAD', closedAt: occurredAt } });
    if (posSerial) {
      await tx.posTidBinding.updateMany({
        where: { posSerial, tid: oldTid, unboundAt: null },
        data: { unboundAt: occurredAt, unbindReason: input.unbindReason ?? 'TID_REPLACE' }
      });
    }
    await tx.assetEvent.create({
      data: {
        deviceSerial: posSerial,
        tid: oldTid,
        eventType: oldDecision.eventType!, // TID_DEAD
        fromState: oldRow.status,
        toState: 'DEAD',
        customerId,
        actorUserId: user.id,
        occurredAt,
        note: input.note ?? null
      }
    });
    // New TID → ACTIVE + bind to the same POS/customer.
    await tx.tid.update({
      where: { id: newRow.id },
      data: { status: 'ACTIVE', posSerial, customerId, agentId: oldRow.agentId }
    });
    if (posSerial) {
      await tx.posTidBinding.create({ data: { posSerial, tid: newTidStr, boundAt: occurredAt } });
      await tx.posDevice.updateMany({ where: { serial: posSerial }, data: { currentTid: newTidStr } });
    }
    await tx.assetEvent.create({
      data: {
        deviceSerial: posSerial,
        tid: newTidStr,
        eventType: newDecision.eventType!, // TID_REPLACE
        fromState: newRow.status,
        toState: 'ACTIVE',
        customerId,
        actorUserId: user.id,
        occurredAt,
        note: input.note ?? null,
        afterJson: JSON.stringify(auditSnapshot({ tid: newTidStr, replaces: oldTid, posSerial }))
      }
    });
  });

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'TID_REPLACED',
    targetType: 'Tid',
    targetId: String(oldRow.id),
    before: auditSnapshot({ oldTid, oldStatus: oldRow.status }),
    after: auditSnapshot({ oldTid, oldStatus: 'DEAD', newTid: newTidStr, newStatus: 'ACTIVE' })
  });
  return { ok: true, id: newRow.id };
}

export interface RecallTidInput {
  occurredAt?: string | null;
  note?: string | null;
}

/** TID_MANAGE — recall (thu hồi) an ACTIVE/DEAD/CLOSED TID → RECALLED + unbind. */
export async function recallTid(tid: string, input: RecallTidInput = {}): Promise<MutationResult> {
  const g = await requirePermission('TID_MANAGE', { action: 'TID_RECALLED', targetType: 'Tid' });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.tid.findUnique({ where: { tid } });
  if (!row) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy TID "${tid}".` };
  const decision = decideTidTransition(row.status as TidStatus, 'recall');
  if (!decision.allowed) {
    return { ok: false, error: decision.reason, message: `Không thể thu hồi TID đang ở trạng thái ${row.status}.` };
  }

  const occurredAt = parseWhen(input.occurredAt);
  await db.$transaction(async (tx) => {
    // D4 (PHASE K2): thu hồi TID → clear posSerial + agentId để chiều derive "Gán máy POS" nhất quán
    // (RECALLED = đã tháo khỏi máy). deliveredAt GIỮ nguyên (2 chiều độc lập — lịch sử giao khách).
    await tx.tid.update({ where: { id: row.id }, data: { status: 'RECALLED', closedAt: occurredAt, posSerial: null, agentId: null } });
    if (row.posSerial) {
      await tx.posTidBinding.updateMany({
        where: { posSerial: row.posSerial, tid, unboundAt: null },
        data: { unboundAt: occurredAt, unbindReason: input.note ?? 'TID_RECALL' }
      });
      await tx.posDevice.updateMany({ where: { serial: row.posSerial, currentTid: tid }, data: { currentTid: null } });
    }
    await tx.assetEvent.create({
      data: {
        deviceSerial: row.posSerial,
        tid,
        eventType: decision.eventType!,
        fromState: row.status,
        toState: 'RECALLED',
        customerId: row.customerId,
        actorUserId: user.id,
        occurredAt,
        note: input.note ?? null
      }
    });
  });

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'TID_RECALLED',
    targetType: 'Tid',
    targetId: String(row.id),
    before: { status: row.status },
    after: auditSnapshot({ status: 'RECALLED' })
  });
  return { ok: true, id: row.id };
}

export interface MarkDeliveredInput {
  deliveredAt?: string | null;
  /** Q-TL1 — bắt buộc khách (nếu row chưa có), tùy chọn đại lý. Cho "Giao khi chưa gán" (máy khách). */
  customerId?: number | null;
  toAgentId?: number | null;
  note?: string | null;
}

/** TID_MANAGE — mark a TID physically delivered (sets deliveredAt + customer + đại lý; §A5/Q-TL1).
 *  Sự kiện TID_DELIVERED ghi ĐỦ customerId + toAgentId. Hỗ trợ "Giao khi chưa gán" (máy khách). */
export async function markTidDelivered(tid: string, input: MarkDeliveredInput = {}): Promise<MutationResult> {
  const g = await requirePermission('TID_MANAGE', { action: 'TID_DELIVERED', targetType: 'Tid' });
  if (!g.ok) return g;
  const { db, user } = g;

  const row = await db.tid.findUnique({ where: { tid } });
  if (!row) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy TID "${tid}".` };
  if (row.deliveredAt) return { ok: false, error: 'ALREADY_DELIVERED', message: `TID "${tid}" đã được đánh dấu đã giao.` };

  const customerId = input.customerId ?? row.customerId;
  if (customerId == null) return { ok: false, error: 'VALIDATION', message: 'Phải chọn khách hàng nhận (TID chưa gán máy nên chưa có khách).' };
  if (input.customerId != null) {
    const c = await db.customer.findUnique({ where: { id: input.customerId } });
    if (!c || c.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Khách hàng đã chọn không tồn tại.' };
  }
  const toAgentId = input.toAgentId ?? row.agentId ?? null;
  if (input.toAgentId != null) {
    const a = await db.agent.findUnique({ where: { id: input.toAgentId } });
    if (!a || a.deletedAt) return { ok: false, error: 'NOT_FOUND', message: 'Đại lý đã chọn không tồn tại.' };
  }

  const deliveredAt = parseWhen(input.deliveredAt);
  await db.$transaction(async (tx) => {
    await tx.tid.update({ where: { id: row.id }, data: { deliveredAt, customerId, agentId: toAgentId } });
    await tx.assetEvent.create({
      data: {
        deviceSerial: row.posSerial,
        tid,
        eventType: 'TID_DELIVERED',
        fromState: row.status,
        toState: row.status,
        customerId,
        toAgentId,
        actorUserId: user.id,
        occurredAt: deliveredAt,
        note: input.note ?? null
      }
    });
  });

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'TID_DELIVERED',
    targetType: 'Tid',
    targetId: String(row.id),
    after: auditSnapshot({ tid, deliveredAt: deliveredAt.toISOString(), customerId, toAgentId })
  });
  return { ok: true, id: row.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE K2 §4 (Q-TL1/TL2) — Timeline cấp TID: nhân getDeviceTimeline (pos-service). Đọc AssetEvent
// theo chuỗi `tid` (index có sẵn, KHÔNG thêm tidId FK). Guard TID_VIEW OR CONFIG_TID_VIEW.
// ─────────────────────────────────────────────────────────────────────────────
export interface TimelineEventDto {
  id: number;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  fromAgentId: number | null;
  toAgentId: number | null;
  customerId: number | null;
  actorUserId: number | null;
  occurredAt: string;
  note: string | null;
}

export async function tidTimeline(tid: string): Promise<{ ok: boolean; data?: TimelineEventDto[]; error?: string; message?: string }> {
  const g = await requireTidView();
  if (!g.ok) return g;
  const row = await g.db.tid.findUnique({ where: { tid } });
  if (!row) return { ok: false, error: 'NOT_FOUND', message: `Không tìm thấy TID "${tid}".` };
  const events = await g.db.assetEvent.findMany({
    where: { tid },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }]
  });
  return {
    ok: true,
    data: events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      fromState: e.fromState,
      toState: e.toState,
      fromAgentId: e.fromAgentId,
      toAgentId: e.toAgentId,
      customerId: e.customerId,
      actorUserId: e.actorUserId,
      occurredAt: e.occurredAt.toISOString(),
      note: e.note
    }))
  };
}

function parseWhen(iso?: string | null): Date {
  if (!iso) return new Date();
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date() : d;
}
