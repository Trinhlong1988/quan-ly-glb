// App settings service (main). IMS_SPEC §16 SETTING_UPDATED audit; §13 permission gates.
import { requirePermission } from './guard.js';
import { writeAudit } from './audit.js';

export interface SettingDto {
  key: string;
  value: string | null;
}

export async function listSettings(): Promise<{ ok: boolean; data?: SettingDto[]; error?: string; message?: string }> {
  const g = await requirePermission('SYSTEM_SETTING_VIEW', { action: 'SETTING_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.appSetting.findMany({ orderBy: { key: 'asc' } });
  return { ok: true, data: rows.map((r) => ({ key: r.key, value: r.value })) };
}

export async function updateSetting(
  key: string,
  value: string
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const g = await requirePermission('SYSTEM_SETTING_UPDATE', { action: 'SETTING_UPDATED', targetType: 'System', targetId: key });
  if (!g.ok) return g;
  const { db, user } = g;
  const before = await db.appSetting.findUnique({ where: { key } });
  await db.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  });
  await writeAudit(db, {
    actorUserId: user.id,
    action: 'SETTING_UPDATED',
    targetType: 'System',
    targetId: key,
    before: before ? { key, value: before.value } : null,
    after: { key, value }
  });
  return { ok: true };
}
