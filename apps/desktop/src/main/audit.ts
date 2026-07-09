// Audit helper (IMS_SPEC §16). Every important action writes one row.
import os from 'node:os';
import type { Db } from '@glb/database';
import type { AuditAction } from '@glb/shared';

export interface AuditInput {
  actorUserId: number | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
}

const DEVICE_INFO = `${os.hostname()} (${os.platform()} ${os.release()})`;

export async function writeAudit(db: Db, input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? undefined,
        action: input.action,
        targetType: input.targetType ?? undefined,
        targetId: input.targetId ?? undefined,
        beforeJson: input.before === undefined ? undefined : JSON.stringify(input.before),
        afterJson: input.after === undefined ? undefined : JSON.stringify(input.after),
        ipAddress: 'local',
        deviceInfo: DEVICE_INFO
      }
    });
  } catch (err) {
    // Audit must never crash the operation; log to console for diagnosis.
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write', input.action, err);
  }
}
