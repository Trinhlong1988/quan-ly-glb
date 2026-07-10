// Audit log read service (main). IMS_SPEC §16, R_AUDIT_001/004.
// UI is read-only (no delete endpoint exists — R_AUDIT_001). Requires AUDIT_LOG_VIEW.
import { requirePermission } from './guard.js';

export interface AuditRowDto {
  id: number;
  actorUserId: number | null;
  actorUsername: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  ipAddress: string | null;
  deviceInfo: string | null;
  createdAt: string;
}

export interface AuditQuery {
  action?: string;
  search?: string;
  limit?: number;
}

export async function listAudit(
  query: AuditQuery = {}
): Promise<{ ok: boolean; data?: AuditRowDto[]; error?: string; message?: string }> {
  const g = await requirePermission('AUDIT_LOG_VIEW', { action: 'AUDIT_LOG_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.auditLog.findMany({
    where: {
      action: query.action ? query.action : undefined,
      OR: query.search
        ? [
            { action: { contains: query.search, mode: 'insensitive' } },
            { targetType: { contains: query.search, mode: 'insensitive' } },
            { targetId: { contains: query.search, mode: 'insensitive' } }
          ]
        : undefined
    },
    orderBy: { id: 'desc' },
    take: Math.min(query.limit ?? 200, 1000),
    include: { actor: { select: { username: true } } }
  });
  const data: AuditRowDto[] = rows.map((r) => ({
    id: r.id,
    actorUserId: r.actorUserId,
    actorUsername: r.actor?.username ?? null,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    beforeJson: r.beforeJson,
    afterJson: r.afterJson,
    ipAddress: r.ipAddress,
    deviceInfo: r.deviceInfo,
    createdAt: r.createdAt.toISOString()
  }));
  return { ok: true, data };
}
