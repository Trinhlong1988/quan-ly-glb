// Storage-Guard (Nhóm E, LEAD 9/7): chống tràn bộ nhớ khi lên server.
//  • Đo dung lượng DB + ổ đĩa; cảnh báo khi vượt ngưỡng (mặc định 80%).
//  • Dọn dẹp AN TOÀN: LUÔN backup trước khi xóa lịch sử (audit cũ) + thùng rác cũ.
//  • Backup ĐỊNH KỲ 1 lần/ngày (scheduler gọi systemBackupIfDue).
//  • Cảnh báo vượt ngưỡng đẩy vào hòm thư Admin/Manager + cờ để renderer bật dialog xác nhận.
// Nguyên tắc: KHÔNG bao giờ xóa mà chưa có bản sao lưu; mọi thao tác ghi audit.
import { statfsSync } from 'node:fs';
import type { Db } from '@glb/database';
import { requirePermission, verifyActorPassword } from './guard.js';
import { writeAudit } from './audit.js';
import { systemBackup } from './backup-service.js';
import { notifyAdmins } from './message-service.js';

const K = {
  thresholdPct: 'storage.thresholdPct',
  auditRetentionDays: 'storage.auditRetentionDays',
  trashRetentionDays: 'storage.trashRetentionDays',
  backupIntervalHours: 'backup.intervalHours',
  lastBackupAt: 'backup.lastAt',
  lastAlertAt: 'storage.lastAlertAt',
  maintenanceEnabled: 'maintenance.enabled', // '1' bật / '0' tắt tự động
  maintenanceDayOfWeek: 'maintenance.dayOfWeek', // 0=Chủ nhật … 6=Thứ bảy
  maintenanceHour: 'maintenance.hour', // 0..23
  autoPurgeWeekly: 'maintenance.autoPurge', // '1' = tự dọn dữ liệu quá hạn khi bảo trì tuần
  lastMaintenanceAt: 'maintenance.lastAt',
  lastBackupFailureAt: 'backup.lastFailureAt', // C1 — mốc backup tự động thất bại gần nhất
  lastBackupFailAlertAt: 'backup.lastFailAlertAt', // C1 — throttle thông báo thất bại
  lastBackupStaleAlertAt: 'backup.lastStaleAlertAt' // C2 — throttle cảnh báo backup quá hạn
} as const;

const DEFAULTS = {
  thresholdPct: 80,
  auditRetentionDays: 180,
  trashRetentionDays: 90,
  backupIntervalHours: 24,
  maintenanceDayOfWeek: 0, // Chủ nhật
  maintenanceHour: 2 // 02:00
};

// SÀN AN TOÀN (audit Nhóm E): chống retention=0/rỗng xóa sạch dữ liệu vừa tạo. Đọc & ghi đều kẹp.
const MIN_AUDIT_DAYS = 7;
const MIN_TRASH_DAYS = 1;
const MIN_BACKUP_HOURS = 1;

async function getNum(db: Db, key: string, def: number): Promise<number> {
  const row = await db.appSetting.findUnique({ where: { key } });
  const n = row?.value != null ? Number(row.value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : def;
}
async function getStr(db: Db, key: string): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}
async function setStr(db: Db, key: string, value: string): Promise<void> {
  await db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
// Retention/interval ĐÃ KẸP SÀN — dùng ở MỌI nơi tính cutoff/purge để 0/rỗng không xóa sạch.
const auditRetention = async (db: Db): Promise<number> => Math.max(MIN_AUDIT_DAYS, await getNum(db, K.auditRetentionDays, DEFAULTS.auditRetentionDays));
const trashRetention = async (db: Db): Promise<number> => Math.max(MIN_TRASH_DAYS, await getNum(db, K.trashRetentionDays, DEFAULTS.trashRetentionDays));
const backupInterval = async (db: Db): Promise<number> => Math.max(MIN_BACKUP_HOURS, await getNum(db, K.backupIntervalHours, DEFAULTS.backupIntervalHours));

/** Tổng dung lượng DB PostgreSQL (bytes) qua pg_database_size(). */
async function dbBytes(db: Db): Promise<number> {
  const rows = await db.$queryRawUnsafe<Array<{ size: bigint | number | string }>>(
    'SELECT pg_database_size(current_database()) AS size'
  );
  const raw = rows?.[0]?.size ?? 0;
  const n = typeof raw === 'bigint' ? Number(raw) : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Thư mục dữ liệu của máy chủ PostgreSQL (dùng làm nhãn + để đo ổ đĩa trên máy chủ). */
async function pgDataDirectory(db: Db): Promise<string | null> {
  try {
    const rows = await db.$queryRawUnsafe<Array<{ data_directory: string }>>('SHOW data_directory');
    return rows?.[0]?.data_directory ?? null;
  } catch {
    return null;
  }
}

/**
 * Dung lượng ổ đĩa chứa DB. Trên MÁY CHỦ (cùng máy với Postgres) statfs vào data_directory cho số thật.
 * Trên máy CLIENT (data_directory là đường dẫn của máy khác) statfs fail → trả null (thành thật "không
 * xác định được", KHÔNG báo bừa) — cảnh báo ngưỡng chỉ có ý nghĩa khi chạy trên máy chủ.
 */
async function diskInfo(db: Db): Promise<{ total: number; free: number } | null> {
  const dir = await pgDataDirectory(db);
  if (!dir) return null;
  try {
    const s = statfsSync(dir);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    if (total > 0) return { total, free };
    return null;
  } catch {
    return null;
  }
}

export interface StorageStatus {
  dbBytes: number;
  dbPath: string;
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
  diskUsedPct: number | null; // % ổ đĩa đã dùng
  thresholdPct: number;
  over: boolean; // đã vượt ngưỡng chưa
  lastBackupAt: string | null;
  lastAlertAt: string | null;
  lastMaintenanceAt: string | null;
  backupIntervalHours: number;
  maintenanceEnabled: boolean;
  maintenanceDayOfWeek: number; // 0=CN..6=T7
  maintenanceHour: number; // 0..23
  autoPurgeWeekly: boolean;
  cleanable: {
    auditOld: number; // số dòng nhật ký cũ hơn hạn lưu
    trashOld: number; // số bản ghi trong thùng rác cũ hơn hạn lưu
    auditRetentionDays: number;
    trashRetentionDays: number;
  };
}

/** Danh sách thực thể có thùng rác (khớp trash-service) để dọn bản ghi cũ. */
type Purger = { deleteMany: (a: { where: { deletedAt: { lt: Date } } }) => Promise<{ count: number }>; count: (a: { where: { deletedAt: { lt: Date } } }) => Promise<number> };
function trashModels(db: Db): Purger[] {
  const d = db as unknown as Record<string, Purger>;
  return [
    d.customer, d.agent, d.bank, d.cardType, d.partner, d.supplier, d.posModel, d.posIntakeStatus,
    d.posIntake, d.feeType, d.feeRate, d.receiveAccountSource, d.receiveAccount, d.dossierSource,
    d.dossier, d.tidConfigStatus, d.tid, d.transaction
  ];
}

async function computeStatus(db: Db): Promise<StorageStatus> {
  const thresholdPct = await getNum(db, K.thresholdPct, DEFAULTS.thresholdPct);
  const auditRetentionDays = await auditRetention(db);
  const trashRetentionDays = await trashRetention(db);
  const backupIntervalHours = await backupInterval(db);
  const disk = await diskInfo(db);
  const diskUsedPct = disk ? Math.round(((disk.total - disk.free) / disk.total) * 1000) / 10 : null;

  const auditCutoff = new Date(Date.now() - auditRetentionDays * 86400_000);
  const trashCutoff = new Date(Date.now() - trashRetentionDays * 86400_000);
  const auditOld = await db.auditLog.count({ where: { createdAt: { lt: auditCutoff } } });
  let trashOld = 0;
  for (const m of trashModels(db)) {
    try { trashOld += await m.count({ where: { deletedAt: { lt: trashCutoff } } }); } catch { /* model thiếu deletedAt → bỏ */ }
  }

  return {
    dbBytes: await dbBytes(db),
    dbPath: (await pgDataDirectory(db)) ?? 'postgresql',
    diskTotalBytes: disk?.total ?? null,
    diskFreeBytes: disk?.free ?? null,
    diskUsedPct,
    thresholdPct,
    over: diskUsedPct != null && diskUsedPct >= thresholdPct,
    lastBackupAt: await getStr(db, K.lastBackupAt),
    lastAlertAt: await getStr(db, K.lastAlertAt),
    lastMaintenanceAt: await getStr(db, K.lastMaintenanceAt),
    backupIntervalHours,
    maintenanceEnabled: (await getStr(db, K.maintenanceEnabled)) !== '0', // mặc định bật
    maintenanceDayOfWeek: await getNum(db, K.maintenanceDayOfWeek, DEFAULTS.maintenanceDayOfWeek),
    maintenanceHour: await getNum(db, K.maintenanceHour, DEFAULTS.maintenanceHour),
    autoPurgeWeekly: (await getStr(db, K.autoPurgeWeekly)) !== '0', // mặc định bật
    cleanable: { auditOld, trashOld, auditRetentionDays, trashRetentionDays }
  };
}

/** Mốc lịch bảo trì gần nhất ≤ now (theo thứ trong tuần + giờ). Dùng để bù khi app tắt lúc đến hạn. */
function lastScheduledOccurrence(now: Date, dayOfWeek: number, hour: number): Date {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  // lùi về đúng thứ trong tuần
  let back = (d.getDay() - dayOfWeek + 7) % 7;
  if (back === 0 && d.getTime() > now.getTime()) back = 7; // hôm nay đúng thứ nhưng chưa tới giờ → tuần trước
  d.setDate(d.getDate() - back);
  return d;
}

/** STORAGE_VIEW — tình trạng bộ nhớ cho UI (bảng bảo trì + dialog cảnh báo). */
export async function getStorageStatus(): Promise<{ ok: boolean; data?: StorageStatus; error?: string; message?: string }> {
  const g = await requirePermission('STORAGE_VIEW', { action: 'STORAGE_VIEW' });
  if (!g.ok) return g;
  return { ok: true, data: await computeStatus(g.db) };
}

export interface CleanupOptions {
  clearHistory?: boolean; // xóa nhật ký cũ hơn hạn lưu
  purgeTrash?: boolean; // xóa vĩnh viễn bản ghi thùng rác cũ hơn hạn lưu
  password: string; // mật khẩu Admin xác nhận (thao tác phá hủy)
}

/**
 * STORAGE_CLEANUP — dọn dẹp AN TOÀN. Trình tự bắt buộc: xác thực mật khẩu → BACKUP → xóa.
 * Chỉ xóa dữ liệu CŨ HƠN hạn lưu (audit/thùng rác), không đụng dữ liệu trong hạn.
 */
export async function runCleanup(opts: CleanupOptions): Promise<{ ok: boolean; error?: string; message?: string; backupFile?: string; auditDeleted?: number; trashDeleted?: number }> {
  const g = await requirePermission('STORAGE_CLEANUP', { action: 'STORAGE_CLEANUP', targetType: 'System' });
  if (!g.ok) return g;
  const { db, user } = g;
  if (!opts.clearHistory && !opts.purgeTrash) return { ok: false, error: 'NOTHING_SELECTED', message: 'Hãy chọn ít nhất một mục để dọn dẹp.' };
  if (!(await verifyActorPassword(user, opts.password))) {
    await writeAudit(db, { actorUserId: user.id, action: 'STORAGE_CLEANUP', targetType: 'System', after: { denied: true, reason: 'WRONG_PASSWORD' } });
    return { ok: false, error: 'WRONG_PASSWORD', message: 'Mật khẩu xác nhận không đúng.' };
  }

  // R_SAFE_CLEANUP: LUÔN backup trước khi xóa để đảm bảo dữ liệu luôn khôi phục được.
  const bk = await systemBackup(db, 'pre-cleanup snapshot (Storage-Guard)');
  if (!bk.ok) return { ok: false, error: 'BACKUP_FAILED', message: `Không tạo được backup an toàn trước khi dọn — HỦY dọn dẹp: ${bk.error}` };

  const auditRetentionDays = await auditRetention(db);
  const trashRetentionDays = await trashRetention(db);
  let auditDeleted = 0;
  let trashDeleted = 0;

  if (opts.clearHistory) {
    const cutoff = new Date(Date.now() - auditRetentionDays * 86400_000);
    const r = await db.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    auditDeleted = r.count;
  }
  if (opts.purgeTrash) {
    const cutoff = new Date(Date.now() - trashRetentionDays * 86400_000);
    for (const m of trashModels(db)) {
      try { trashDeleted += (await m.deleteMany({ where: { deletedAt: { lt: cutoff } } })).count; } catch { /* bỏ model thiếu cột */ }
    }
  }

  await writeAudit(db, {
    actorUserId: user.id,
    action: 'STORAGE_CLEANUP',
    targetType: 'System',
    after: { backupFile: bk.filePath, auditDeleted, trashDeleted, auditRetentionDays, trashRetentionDays }
  });
  return { ok: true, backupFile: bk.filePath, auditDeleted, trashDeleted };
}

// ═════════════════════════════════════════════════════════════════════════════
// SCHEDULER (không phiên đăng nhập) — gọi từ main tick định kỳ.
// ═════════════════════════════════════════════════════════════════════════════

/** Backup ĐỊNH KỲ: chạy nếu đã quá `backup.intervalHours` kể từ lần cuối. */
export async function systemBackupIfDue(db: Db): Promise<{ ran: boolean; filePath?: string }> {
  const intervalHours = await backupInterval(db);
  const last = await getStr(db, K.lastBackupAt);
  const dueMs = intervalHours * 3600_000;
  if (last) {
    const elapsed = Date.now() - new Date(last).getTime();
    if (Number.isFinite(elapsed) && elapsed < dueMs) return { ran: false };
  }
  const bk = await systemBackup(db, 'auto daily backup (Storage-Guard)');
  if (bk.ok) {
    await setStr(db, K.lastBackupAt, new Date().toISOString());
    return { ran: true, filePath: bk.filePath };
  }
  await reportBackupFailure(db, 'sao lưu tự động hằng ngày', bk.error);
  return { ran: false };
}

/**
 * C1 (R48) — KHÔNG để backup thất bại LẶNG. Ghi audit AUTO_BACKUP_FAILED + đẩy thông báo Admin/Manager
 * (throttle 6h để không spam). Lưu mốc thất bại để watchdog/StorageStatus hiển thị.
 */
async function reportBackupFailure(db: Db, whichBackup: string, error?: string): Promise<void> {
  await setStr(db, K.lastBackupFailureAt, new Date().toISOString());
  await writeAudit(db, { actorUserId: null, action: 'AUTO_BACKUP_FAILED', targetType: 'System', after: { backup: whichBackup, error: error ?? 'không rõ' } });
  const lastAlert = await getStr(db, K.lastBackupFailAlertAt);
  if (lastAlert && Date.now() - new Date(lastAlert).getTime() < 6 * 3600_000) return;
  await notifyAdmins(db, {
    category: 'BACKUP_FAIL',
    subject: '🛑 SAO LƯU TỰ ĐỘNG THẤT BẠI',
    body: `Tác vụ "${whichBackup}" KHÔNG tạo được bản sao lưu. Lỗi: ${error ?? 'không rõ'}.\n` +
      `Hãy kiểm tra pg_dump / dung lượng đĩa / quyền ghi thư mục backup NGAY — dữ liệu đang KHÔNG được sao lưu.`
  });
  await setStr(db, K.lastBackupFailAlertAt, new Date().toISOString());
}

/**
 * C2 (R48) — Watchdog: nếu bản sao lưu gần nhất QUÁ CŨ (chưa từng backup, hoặc > 2× chu kỳ) → cảnh báo
 * Admin/Manager + audit BACKUP_STALE (throttle 24h). Đây là chốt chặn "sót backup" quan trọng nhất.
 * Gọi định kỳ (mỗi giờ) từ housekeeping.
 */
export async function backupWatchdog(db: Db): Promise<{ stale: boolean; lastBackupAt: string | null; ageHours: number | null }> {
  const intervalH = await backupInterval(db);
  const last = await getStr(db, K.lastBackupAt);
  const ageHours = last ? (Date.now() - new Date(last).getTime()) / 3600_000 : null;
  const stale = ageHours == null || ageHours > 2 * intervalH;
  if (!stale) return { stale: false, lastBackupAt: last, ageHours };
  const lastAlert = await getStr(db, K.lastBackupStaleAlertAt);
  if (lastAlert && Date.now() - new Date(lastAlert).getTime() < 24 * 3600_000) return { stale: true, lastBackupAt: last, ageHours };
  const ageTxt = ageHours == null ? 'CHƯA CÓ bản sao lưu nào' : `bản gần nhất đã ${Math.round(ageHours)} giờ trước`;
  await notifyAdmins(db, {
    category: 'BACKUP_STALE',
    subject: '⚠️ SAO LƯU QUÁ HẠN',
    body: `Hệ thống ${ageTxt} (chu kỳ ${intervalH}h). Có thể scheduler không chạy / app tắt lâu / backup lỗi.\n` +
      `Vào Bảo trì hệ thống tạo backup thủ công + kiểm tra lịch sao lưu.`
  });
  await writeAudit(db, { actorUserId: null, action: 'BACKUP_STALE', targetType: 'System', after: { lastBackupAt: last, ageHours: ageHours == null ? null : Math.round(ageHours) } });
  await setStr(db, K.lastBackupStaleAlertAt, new Date().toISOString());
  return { stale: true, lastBackupAt: last, ageHours };
}

/**
 * Kiểm tra ngưỡng bộ nhớ. Nếu vượt và CHƯA cảnh báo trong 24h → đẩy thông báo hòm thư Admin/Manager
 * + ghi cờ lastAlertAt (renderer poll để bật dialog xác nhận dọn dẹp). Trả về trạng thái.
 */
export async function systemStorageCheck(db: Db): Promise<{ over: boolean; usedPct: number | null; notified: boolean }> {
  const status = await computeStatus(db);
  if (!status.over) return { over: false, usedPct: status.diskUsedPct, notified: false };

  const lastAlert = await getStr(db, K.lastAlertAt);
  const alertedRecently = lastAlert ? Date.now() - new Date(lastAlert).getTime() < 24 * 3600_000 : false;
  if (alertedRecently) return { over: true, usedPct: status.diskUsedPct, notified: false };

  await notifyAdmins(db, {
    category: 'STORAGE_ALERT',
    subject: `⚠️ Bộ nhớ đã dùng ${status.diskUsedPct}% (ngưỡng ${status.thresholdPct}%)`,
    body:
      `Ổ đĩa chứa cơ sở dữ liệu đã dùng ${status.diskUsedPct}% dung lượng, vượt ngưỡng an toàn ${status.thresholdPct}%.\n` +
      `Có thể dọn: ${status.cleanable.auditOld} dòng nhật ký cũ (>${status.cleanable.auditRetentionDays} ngày), ` +
      `${status.cleanable.trashOld} bản ghi thùng rác cũ (>${status.cleanable.trashRetentionDays} ngày).\n` +
      `Vào Bảo trì hệ thống → Dọn dẹp (hệ thống sẽ tự backup an toàn trước khi xóa).`
  });
  await setStr(db, K.lastAlertAt, new Date().toISOString());
  await writeAudit(db, { actorUserId: null, action: 'STORAGE_ALERT', targetType: 'System', after: { usedPct: status.diskUsedPct, thresholdPct: status.thresholdPct } });
  return { over: true, usedPct: status.diskUsedPct, notified: true };
}

/**
 * BẢO TRÌ ĐỊNH KỲ (mặc định 1 tuần/lần) — scheduler gọi. Trình tự an toàn:
 *   backup → (nếu bật autoPurge) xóa audit/thùng rác QUÁ HẠN → VACUUM (ANALYZE) (thu hồi chỗ trống +
 *   cập nhật thống kê Postgres) → ghi mốc + thông báo Admin. KHÔNG đụng dữ liệu trong hạn, KHÔNG "reset".
 */
export async function systemWeeklyMaintenanceIfDue(db: Db): Promise<{ ran: boolean; auditDeleted?: number; trashDeleted?: number; vacuumed?: boolean }> {
  // Tắt tự động → không chạy.
  if ((await getStr(db, K.maintenanceEnabled)) === '0') return { ran: false };
  const dayOfWeek = await getNum(db, K.maintenanceDayOfWeek, DEFAULTS.maintenanceDayOfWeek);
  const hour = await getNum(db, K.maintenanceHour, DEFAULTS.maintenanceHour);
  const now = new Date();
  const scheduled = lastScheduledOccurrence(now, dayOfWeek, hour);
  const last = await getStr(db, K.lastMaintenanceAt);
  // Đến hạn nếu chưa từng chạy, hoặc lần chạy cuối TRƯỚC mốc lịch gần nhất (bù cả khi app từng tắt).
  if (last && new Date(last).getTime() >= scheduled.getTime()) return { ran: false };
  // 1) backup an toàn — nếu FAIL: KHÔNG dọn (an toàn) + KHÔNG lặng (C1: báo Admin).
  const bk = await systemBackup(db, 'weekly maintenance snapshot (Storage-Guard)');
  if (!bk.ok) { await reportBackupFailure(db, 'sao lưu trước bảo trì tuần', bk.error); return { ran: false }; }

  // 2) tự dọn dữ liệu quá hạn (nếu bật)
  const autoPurge = (await getStr(db, K.autoPurgeWeekly)) !== '0';
  let auditDeleted = 0, trashDeleted = 0;
  if (autoPurge) {
    const auditRetentionDays = await auditRetention(db);
    const trashRetentionDays = await trashRetention(db);
    auditDeleted = (await db.auditLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - auditRetentionDays * 86400_000) } } })).count;
    const trashCutoff = new Date(Date.now() - trashRetentionDays * 86400_000);
    for (const m of trashModels(db)) {
      try { trashDeleted += (await m.deleteMany({ where: { deletedAt: { lt: trashCutoff } } })).count; } catch { /* bỏ */ }
    }
  }

  // 3) thu hồi chỗ trống + cập nhật thống kê PostgreSQL (an toàn — không mất dữ liệu).
  //    VACUUM (ANALYZE) KHÔNG chạy trong transaction → dùng $executeRawUnsafe ngoài tx.
  let vacuumed = false;
  try {
    await db.$executeRawUnsafe('VACUUM (ANALYZE)');
    vacuumed = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[maintenance] VACUUM (ANALYZE) failed', err);
  }

  await setStr(db, K.lastMaintenanceAt, new Date().toISOString());

  // 4) QUÉT sức khỏe toàn hệ thống + lưu vào lịch sử bảo trì (maintenance_runs).
  const { persistScheduledRun } = await import('./health-scan.js');
  const scan = await persistScheduledRun(db, { backupFile: bk.filePath ?? null, auditDeleted, trashDeleted, vacuumed });

  await writeAudit(db, { actorUserId: null, action: 'STORAGE_CLEANUP', targetType: 'System', targetId: 'weekly', after: { weekly: true, backupFile: bk.filePath, auditDeleted, trashDeleted, vacuumed, runId: scan.runId, status: scan.status } });
  await notifyAdmins(db, {
    category: 'MAINTENANCE',
    subject: `🧹 Bảo trì định kỳ: ${scan.status === 'OK' ? 'hệ thống ổn định' : scan.status === 'WARN' ? 'có cảnh báo' : 'phát hiện lỗi'}`,
    body:
      `Đã tự backup, dọn ${auditDeleted} nhật ký + ${trashDeleted} bản ghi thùng rác quá hạn, thu hồi chỗ trống (VACUUM ${vacuumed ? 'OK' : 'bỏ qua'}).\n` +
      `Quét sức khỏe: ${scan.errorCount} lỗi · ${scan.warnCount} cảnh báo (${scan.issuesFound} mục). Xem chi tiết ở Bảo trì hệ thống → Lịch sử bảo trì.`
  });
  return { ran: true, auditDeleted, trashDeleted, vacuumed };
}

/** Cập nhật cấu hình bảo trì — STORAGE_CLEANUP. */
export async function updateStorageConfig(cfg: {
  thresholdPct?: number;
  auditRetentionDays?: number;
  trashRetentionDays?: number;
  backupIntervalHours?: number;
  maintenanceDayOfWeek?: number;
  maintenanceHour?: number;
  maintenanceEnabled?: boolean;
  autoPurgeWeekly?: boolean;
}): Promise<{ ok: boolean; error?: string; message?: string }> {
  const g = await requirePermission('STORAGE_CLEANUP', { action: 'SETTING_UPDATED', targetType: 'System' });
  if (!g.ok) return g;
  const { db, user } = g;
  const pairs: [string, number | undefined][] = [
    [K.thresholdPct, cfg.thresholdPct],
    [K.auditRetentionDays, cfg.auditRetentionDays],
    [K.trashRetentionDays, cfg.trashRetentionDays],
    [K.backupIntervalHours, cfg.backupIntervalHours],
    [K.maintenanceDayOfWeek, cfg.maintenanceDayOfWeek],
    [K.maintenanceHour, cfg.maintenanceHour]
  ];
  for (const [key, val] of pairs) {
    if (val === undefined) continue;
    if (!Number.isFinite(val) || val < 0) return { ok: false, error: 'VALIDATION', message: 'Giá trị cấu hình phải là số ≥ 0.' };
    if (key === K.thresholdPct && (val < 1 || val > 100)) return { ok: false, error: 'VALIDATION', message: 'Ngưỡng cảnh báo phải trong khoảng 1–100%.' };
    if (key === K.maintenanceDayOfWeek && val > 6) return { ok: false, error: 'VALIDATION', message: 'Thứ trong tuần phải từ 0 (Chủ nhật) đến 6 (Thứ bảy).' };
    if (key === K.maintenanceHour && val > 23) return { ok: false, error: 'VALIDATION', message: 'Giờ phải từ 0 đến 23.' };
    // Sàn an toàn chống xóa sạch: hạn lưu nhật ký ≥ 7 ngày, thùng rác ≥ 1 ngày, chu kỳ backup ≥ 1 giờ.
    if (key === K.auditRetentionDays && val < MIN_AUDIT_DAYS) return { ok: false, error: 'VALIDATION', message: `Hạn lưu nhật ký tối thiểu ${MIN_AUDIT_DAYS} ngày (chống xóa nhầm dữ liệu).` };
    if (key === K.trashRetentionDays && val < MIN_TRASH_DAYS) return { ok: false, error: 'VALIDATION', message: `Hạn lưu thùng rác tối thiểu ${MIN_TRASH_DAYS} ngày.` };
    if (key === K.backupIntervalHours && val < MIN_BACKUP_HOURS) return { ok: false, error: 'VALIDATION', message: `Chu kỳ backup tối thiểu ${MIN_BACKUP_HOURS} giờ.` };
    await setStr(db, key, String(val));
  }
  if (cfg.maintenanceEnabled !== undefined) await setStr(db, K.maintenanceEnabled, cfg.maintenanceEnabled ? '1' : '0');
  if (cfg.autoPurgeWeekly !== undefined) await setStr(db, K.autoPurgeWeekly, cfg.autoPurgeWeekly ? '1' : '0');
  await writeAudit(db, { actorUserId: user.id, action: 'SETTING_UPDATED', targetType: 'System', targetId: 'storage.config', after: cfg });
  return { ok: true };
}
