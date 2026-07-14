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

function auditData(input: AuditInput): Parameters<AuditDb['auditLog']['create']>[0]['data'] {
  return {
    actorUserId: input.actorUserId ?? undefined,
    action: input.action,
    targetType: input.targetType ?? undefined,
    targetId: input.targetId ?? undefined,
    beforeJson: input.before === undefined ? undefined : JSON.stringify(input.before),
    afterJson: input.after === undefined ? undefined : JSON.stringify(input.after),
    ipAddress: 'local',
    deviceInfo: DEVICE_INFO
  };
}

/** Best-effort realtime "đồng hồ thay đổi" (R48 Pha 4). TÁCH khỏi audit: lỗi bump KHÔNG được làm rollback
 *  nghiệp vụ. Gọi NGOÀI transaction nghiệp vụ (sau commit) để một lỗi realtime không đầu độc tx tiền/kho. */
export async function bumpChangeToken(db: AuditDb, targetType?: string | null): Promise<void> {
  try {
    const domain = targetType ?? 'GLOBAL';
    await db.changeToken.upsert({ where: { domain }, create: { domain, version: 1 }, update: { version: { increment: 1 } } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[changeToken] bump failed', targetType, err);
  }
}

/**
 * G1 (PING) — AUDIT NGHIÊM (tier-1: tiền/kho/approval-hủy/khóa-user/đổi-quyền/server-config).
 * KHÔNG nuốt lỗi: nếu ghi audit thất bại → NÉM → `$transaction` bao ngoài ROLLBACK cả mutation.
 * Đảm bảo invariant #5: không có mutation quan trọng nào commit mà thiếu dấu vết audit.
 * PHẢI gọi TRONG `$transaction` (txc). changeToken KHÔNG bump ở đây (tách riêng, best-effort — dùng bumpChangeToken).
 * `GLB_AUDIT_FAULT=1` = chốt fault-injection cho selftest (ép audit ném để chứng minh rollback).
 */
export async function writeAuditStrict(txc: AuditDb, input: AuditInput): Promise<void> {
  if (process.env['GLB_AUDIT_FAULT'] === '1') throw new Error('[audit] injected fault (GLB_AUDIT_FAULT=1)');
  await txc.auditLog.create({ data: auditData(input) }); // KHÔNG try/catch → lỗi lan ra → rollback tx
}

export async function writeAudit(db: AuditDb, input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({ data: auditData(input) });
    const domain = input.targetType ?? 'GLOBAL';
    await db.changeToken.upsert({ where: { domain }, create: { domain, version: 1 }, update: { version: { increment: 1 } } });
  } catch (err) {
    // Audit must never crash the operation; log to console for diagnosis.
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write', input.action, err);
  }
}
