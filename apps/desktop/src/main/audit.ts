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

// R48 Pha 3 — nhận CẢ Db đầy đủ LẪN client trong $transaction (chỉ cần .auditLog + .changeToken): cho phép ghi
// audit TRONG cùng transaction với thao tác tiền → tiền + log commit/rollback ATOMIC (không mất log nếu crash).
// R48 Pha 4 — cần .changeToken để bump version realtime cùng chỗ (mọi mutation đã đi qua writeAudit).
type AuditDb = Pick<Db, 'auditLog' | 'changeToken'>;

export async function writeAudit(db: AuditDb, input: AuditInput): Promise<void> {
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
    // R48 Pha 4 — tăng "đồng hồ thay đổi" của miền dữ liệu này (targetType) cho realtime poll. Best-effort:
    // nằm trong try, lỗi bị nuốt như audit (không được làm hỏng thao tác gốc).
    const domain = input.targetType ?? 'GLOBAL';
    await db.changeToken.upsert({ where: { domain }, create: { domain, version: 1 }, update: { version: { increment: 1 } } });
  } catch (err) {
    // Audit must never crash the operation; log to console for diagnosis.
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write', input.action, err);
  }
}
