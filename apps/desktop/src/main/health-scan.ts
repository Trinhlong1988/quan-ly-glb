// Quét sức khỏe hệ thống (Nhóm E — "Bảo trì quét toàn hệ thống", LEAD 9/7).
// Chạy một BỘ KIỂM TRA toàn vẹn dữ liệu → trả về danh sách phát hiện (lỗi/bug) kèm ĐỀ XUẤT FIX,
// và một số mục TỰ SỬA được (autoFix). Mỗi lần quét lưu 1 dòng maintenance_runs + báo cáo JSON.
// Kiểm thử bằng cách NHỒI DỮ LIỆU SAI (selftest 17): mỗi loại lỗi cố ý tạo ra phải bị bắt đúng.
import { computeRevenue } from '@glb/business-rules';
import type { Db } from '@glb/database';
import { requirePermission } from './guard.js';
import { writeAudit } from './audit.js';
import { systemBackup } from './backup-service.js';

export type Severity = 'ERROR' | 'WARN' | 'INFO';

export interface Finding {
  code: string;
  severity: Severity;
  title: string;
  count: number;
  detail: string;
  suggestion: string;
  autoFixable: boolean;
  sampleIds?: number[];
}

async function idSet(model: { findMany: (a: { select: { id: true } }) => Promise<{ id: number }[]> }): Promise<Set<number>> {
  return new Set((await model.findMany({ select: { id: true } })).map((r) => r.id));
}

/**
 * Bộ kiểm tra toàn vẹn — CHỈ ĐỌC (không sửa). Trả danh sách phát hiện.
 * Mỗi check độc lập, bọc try/catch để 1 check hỏng không làm sập cả lần quét.
 */
export async function collectFindings(db: Db): Promise<Finding[]> {
  const f: Finding[] = [];
  const safe = async (fn: () => Promise<void>): Promise<void> => {
    try { await fn(); } catch (err) { /* eslint-disable-next-line no-console */ console.error('[health-scan] check failed', err); }
  };

  // Nạp sẵn tập id hợp lệ (kể cả đã xóa mềm — vẫn tồn tại bản ghi).
  const [tidIds, cardIds, custIds, partnerIds, bankIds] = await Promise.all([
    idSet(db.tid), idSet(db.cardType), idSet(db.customer), idSet(db.partner), idSet(db.bank)
  ]);

  const txns = await db.transaction.findMany({
    where: { deletedAt: null },
    select: { id: true, amount: true, tidId: true, cardTypeId: true, customerId: true, partnerMarginMilli: true, sellMarginMilli: true, revenuePartner: true, revenueSell: true, revenueAmount: true }
  });

  // 1) ERROR — doanh thu không khớp công thức (revenueAmount ≠ chênh đối tác + chênh bán).
  await safe(async () => {
    const bad: number[] = [];
    for (const t of txns) {
      const exp = computeRevenue(t.amount, t.partnerMarginMilli, t.sellMarginMilli);
      if (exp.revenuePartner !== t.revenuePartner || exp.revenueSell !== t.revenueSell || exp.revenueAmount !== t.revenueAmount || t.revenueAmount !== t.revenuePartner + t.revenueSell) bad.push(t.id);
    }
    if (bad.length) f.push({ code: 'REVENUE_MISMATCH', severity: 'ERROR', title: 'Doanh thu giao dịch không khớp công thức 2 khoản chênh', count: bad.length, detail: 'revenueAmount ≠ (chênh đối tác + chênh bán) hoặc lệch so với biểu phí snapshot đã lưu.', suggestion: 'Bấm "Tự sửa" để tính lại doanh thu từ 2 khoản chênh đã lưu trên từng giao dịch.', autoFixable: true, sampleIds: bad.slice(0, 10) });
  });

  // 2) ERROR — số tiền giao dịch âm.
  await safe(async () => {
    const bad = txns.filter((t) => t.amount < 0).map((t) => t.id);
    if (bad.length) f.push({ code: 'TXN_NEGATIVE_AMOUNT', severity: 'ERROR', title: 'Giao dịch có số tiền âm', count: bad.length, detail: 'Số tiền giao dịch phải ≥ 0.', suggestion: 'Kiểm tra & sửa lại số tiền, hoặc xóa giao dịch nhập sai.', autoFixable: false, sampleIds: bad.slice(0, 10) });
  });

  // 3) ERROR — giao dịch trỏ tới TID không tồn tại (orphan).
  await safe(async () => {
    const bad = txns.filter((t) => !tidIds.has(t.tidId)).map((t) => t.id);
    if (bad.length) f.push({ code: 'TXN_ORPHAN_TID', severity: 'ERROR', title: 'Giao dịch trỏ tới TID không tồn tại', count: bad.length, detail: 'tid_id không còn bản ghi TID tương ứng.', suggestion: 'Phục hồi TID bị xóa hoặc gán lại giao dịch cho TID đúng.', autoFixable: false, sampleIds: bad.slice(0, 10) });
  });

  // 4) WARN — giao dịch trỏ tới khách/loại thẻ không tồn tại.
  await safe(async () => {
    const badCust = txns.filter((t) => t.customerId != null && !custIds.has(t.customerId)).map((t) => t.id);
    if (badCust.length) f.push({ code: 'TXN_ORPHAN_CUSTOMER', severity: 'WARN', title: 'Giao dịch trỏ tới khách hàng không tồn tại', count: badCust.length, detail: 'customer_id không còn bản ghi khách tương ứng.', suggestion: 'Gán lại khách đúng hoặc để trống (theo TID).', autoFixable: false, sampleIds: badCust.slice(0, 10) });
    const badCard = txns.filter((t) => t.cardTypeId != null && !cardIds.has(t.cardTypeId)).map((t) => t.id);
    if (badCard.length) f.push({ code: 'TXN_ORPHAN_CARDTYPE', severity: 'WARN', title: 'Giao dịch trỏ tới loại thẻ không tồn tại', count: badCard.length, detail: 'card_type_id không còn bản ghi loại thẻ.', suggestion: 'Gán lại loại thẻ hợp lệ cho giao dịch.', autoFixable: false, sampleIds: badCard.slice(0, 10) });
  });

  // 5) WARN — biểu phí trỏ tới đối tác/loại thẻ không tồn tại.
  await safe(async () => {
    const rates = await db.feeRate.findMany({ where: { deletedAt: null }, select: { id: true, partnerId: true, cardTypeId: true } });
    const bad = rates.filter((r) => !partnerIds.has(r.partnerId) || !cardIds.has(r.cardTypeId)).map((r) => r.id);
    if (bad.length) f.push({ code: 'FEERATE_ORPHAN', severity: 'WARN', title: 'Biểu phí trỏ tới đối tác/loại thẻ không tồn tại', count: bad.length, detail: 'Bản ghi biểu phí tham chiếu đối tác hoặc loại thẻ đã bị xóa cứng.', suggestion: 'Xóa biểu phí mồ côi hoặc khôi phục đối tác/loại thẻ liên quan.', autoFixable: false, sampleIds: bad.slice(0, 10) });
  });

  // 6) WARN — TID trỏ tới đối tác/ngân hàng không tồn tại.
  await safe(async () => {
    const tids = await db.tid.findMany({ where: { deletedAt: null }, select: { id: true, partnerId: true, bankId: true } });
    const bad = tids.filter((t) => (t.partnerId != null && !partnerIds.has(t.partnerId)) || (t.bankId != null && !bankIds.has(t.bankId))).map((t) => t.id);
    if (bad.length) f.push({ code: 'TID_ORPHAN_REF', severity: 'WARN', title: 'TID trỏ tới đối tác/ngân hàng không tồn tại', count: bad.length, detail: 'partner_id/bank_id của TID không còn bản ghi tương ứng.', suggestion: 'Cập nhật lại đối tác/ngân hàng cho TID trong Cấu hình TID.', autoFixable: false, sampleIds: bad.slice(0, 10) });
  });

  // 7) ERROR — không còn quản trị viên hoạt động (ADMIN active).
  await safe(async () => {
    const adminActive = await db.user.count({ where: { deletedAt: null, status: 'ACTIVE', roles: { some: { role: { code: 'ADMIN', status: 'ACTIVE' } } } } });
    if (adminActive === 0) f.push({ code: 'NO_ACTIVE_ADMIN', severity: 'ERROR', title: 'Không còn quản trị viên (ADMIN) hoạt động', count: 1, detail: 'Hệ thống phải luôn có ít nhất 1 tài khoản ADMIN đang hoạt động.', suggestion: 'Kích hoạt hoặc tạo lại một tài khoản ADMIN ngay.', autoFixable: false });
  });

  // 8) WARN — bản ghi trong thùng rác thiếu người xóa (deletedBy null) — dấu vết bug tiến hóa DB cũ.
  await safe(async () => {
    const models: { name: string; m: { count: (a: { where: { deletedAt: { not: null }; deletedBy: null } }) => Promise<number> } }[] = [
      { name: 'customer', m: db.customer }, { name: 'tid', m: db.tid }, { name: 'transaction', m: db.transaction },
      { name: 'feeRate', m: db.feeRate }, { name: 'dossier', m: db.dossier }, { name: 'receiveAccount', m: db.receiveAccount }
    ];
    let total = 0;
    for (const { m } of models) { try { total += await m.count({ where: { deletedAt: { not: null }, deletedBy: null } }); } catch { /* bỏ */ } }
    if (total) f.push({ code: 'TRASH_MISSING_DELETER', severity: 'WARN', title: 'Bản ghi trong thùng rác thiếu thông tin người xóa', count: total, detail: 'deleted_at có nhưng deleted_by null (dữ liệu xóa trước khi có truy vết per-user).', suggestion: 'Chấp nhận (dữ liệu cũ) hoặc dọn dẹp trong Bảo trì; các lần xóa mới đã ghi đủ người xóa.', autoFixable: false });
  });

  // 9) WARN — tài khoản đang bị khóa do nhập sai mật khẩu (cần admin mở khóa).
  await safe(async () => {
    const locked = await db.user.count({ where: { deletedAt: null, lockedAt: { not: null } } });
    if (locked) f.push({ code: 'USERS_LOCKED', severity: 'WARN', title: 'Có tài khoản đang bị khóa (nhập sai mật khẩu ≥ 5 lần)', count: locked, detail: 'Người dùng bị khóa cho tới khi admin mở khóa/đặt lại mật khẩu.', suggestion: 'Vào Quản Lý Nhân Sự để mở khóa hoặc đặt lại mật khẩu cho các tài khoản này.', autoFixable: false });
  });

  // 10) WARN — chưa từng backup / backup quá cũ (> 48h).
  await safe(async () => {
    const row = await db.appSetting.findUnique({ where: { key: 'backup.lastAt' } });
    const last = row?.value ? new Date(row.value).getTime() : 0;
    const staleMs = 48 * 3600_000;
    if (!last || Date.now() - last > staleMs) f.push({ code: 'BACKUP_STALE', severity: 'WARN', title: 'Chưa backup gần đây', count: 1, detail: last ? `Backup gần nhất đã quá ${Math.round((Date.now() - last) / 3600_000)} giờ.` : 'Chưa có bản backup nào được ghi nhận.', suggestion: 'Chạy backup thủ công hoặc để lịch backup định kỳ chạy (mặc định 24h/lần).', autoFixable: false });
  });

  // 11) ERROR — toàn vẹn file SQLite (PRAGMA integrity_check). Phát hiện DB hỏng/lỗi trang.
  await safe(async () => {
    const rows = (await db.$queryRawUnsafe('PRAGMA integrity_check')) as { integrity_check?: string }[];
    const msgs = rows.map((r) => r.integrity_check ?? '').filter((m) => m && m.toLowerCase() !== 'ok');
    if (msgs.length) f.push({ code: 'DB_INTEGRITY', severity: 'ERROR', title: 'Cơ sở dữ liệu có dấu hiệu hỏng (integrity_check)', count: msgs.length, detail: msgs.slice(0, 5).join(' · '), suggestion: 'NGƯNG ghi dữ liệu, khôi phục từ bản backup gần nhất còn tốt (Sao lưu & Phục hồi) và kiểm tra ổ đĩa.', autoFixable: false });
  });

  // 12) ERROR — vi phạm khóa ngoại còn lại (PRAGMA foreign_key_check). Với thiết kế scalar-id
  //      (không FK cứng) thường rỗng — bắt được nếu về sau có bảng khai báo FK bị lệch.
  await safe(async () => {
    const rows = (await db.$queryRawUnsafe('PRAGMA foreign_key_check')) as { table?: string; rowid?: number; parent?: string }[];
    if (rows.length) {
      const tables = [...new Set(rows.map((r) => r.table).filter(Boolean))].slice(0, 6).join(', ');
      f.push({ code: 'DB_FOREIGN_KEY', severity: 'ERROR', title: 'Có vi phạm khóa ngoại trong cơ sở dữ liệu', count: rows.length, detail: `Bảng liên quan: ${tables}.`, suggestion: 'Rà soát & sửa/xóa các bản ghi trỏ tới bản ghi cha không tồn tại; khôi phục từ backup nếu cần.', autoFixable: false });
    }
  });

  return f;
}

/** Áp dụng TỰ SỬA cho các phát hiện autoFixable. Hiện hỗ trợ: REVENUE_MISMATCH (tính lại doanh thu). */
export async function applyAutoFixes(db: Db, findings: Finding[]): Promise<number> {
  let fixed = 0;
  const revMismatch = findings.find((x) => x.code === 'REVENUE_MISMATCH');
  if (revMismatch) {
    const txns = await db.transaction.findMany({ where: { deletedAt: null }, select: { id: true, amount: true, partnerMarginMilli: true, sellMarginMilli: true, revenuePartner: true, revenueSell: true, revenueAmount: true } });
    for (const t of txns) {
      const exp = computeRevenue(t.amount, t.partnerMarginMilli, t.sellMarginMilli);
      if (exp.revenuePartner !== t.revenuePartner || exp.revenueSell !== t.revenueSell || exp.revenueAmount !== t.revenueAmount) {
        await db.transaction.update({ where: { id: t.id }, data: { revenuePartner: exp.revenuePartner, revenueSell: exp.revenueSell, revenueAmount: exp.revenueAmount } });
        fixed++;
      }
    }
  }
  return fixed;
}

function severityRollup(findings: Finding[]): { status: 'OK' | 'WARN' | 'ERROR'; errorCount: number; warnCount: number } {
  const errorCount = findings.filter((x) => x.severity === 'ERROR').reduce((s, x) => s + 1, 0);
  const warnCount = findings.filter((x) => x.severity === 'WARN').reduce((s, x) => s + 1, 0);
  return { status: errorCount > 0 ? 'ERROR' : warnCount > 0 ? 'WARN' : 'OK', errorCount, warnCount };
}

export interface ScanResult {
  runId: number;
  status: 'OK' | 'WARN' | 'ERROR';
  checksTotal: number;
  issuesFound: number;
  errorCount: number;
  warnCount: number;
  autoFixed: number;
  durationMs: number;
  findings: Finding[];
}

const CHECKS_TOTAL = 12; // số nhóm kiểm tra chạy trong collectFindings (gồm 2 PRAGMA integrity)

/**
 * Lưu 1 lần quét vào maintenance_runs (dùng chung cho quét thủ công & bảo trì định kỳ).
 */
export async function persistRun(
  db: Db,
  args: { kind: 'MANUAL' | 'SCHEDULED'; findings: Finding[]; actorId: number | null; startedAt: Date; autoFixed?: number; backupFile?: string | null; auditDeleted?: number; trashDeleted?: number; vacuumed?: boolean }
): Promise<ScanResult> {
  const { status, errorCount, warnCount } = severityRollup(args.findings);
  const issuesFound = args.findings.reduce((s, x) => s + x.count, 0);
  const durationMs = Date.now() - args.startedAt.getTime();
  const run = await db.maintenanceRun.create({
    data: {
      kind: args.kind,
      status,
      checksTotal: CHECKS_TOTAL,
      issuesFound,
      errorCount,
      warnCount,
      reportJson: JSON.stringify(args.findings),
      backupFile: args.backupFile ?? null,
      auditDeleted: args.auditDeleted ?? 0,
      trashDeleted: args.trashDeleted ?? 0,
      vacuumed: args.vacuumed ?? false,
      autoFixed: args.autoFixed ?? 0,
      durationMs,
      triggeredBy: args.actorId,
      startedAt: args.startedAt,
      finishedAt: new Date()
    }
  });
  return { runId: run.id, status, checksTotal: CHECKS_TOTAL, issuesFound, errorCount, warnCount, autoFixed: args.autoFixed ?? 0, durationMs, findings: args.findings };
}

/** STORAGE_VIEW (quét) / STORAGE_CLEANUP (khi autoFix) — quét thủ công từ UI "Quét ngay". */
export async function runScan(opts: { autoFix?: boolean } = {}): Promise<{ ok: boolean; error?: string; message?: string; data?: ScanResult }> {
  const perm = opts.autoFix ? 'STORAGE_CLEANUP' : 'STORAGE_VIEW';
  const g = await requirePermission(perm, { action: 'STORAGE_CLEANUP', targetType: 'System' });
  if (!g.ok) return g;
  const { db, user } = g;
  const startedAt = new Date();
  let findings = await collectFindings(db);
  let autoFixed = 0;
  if (opts.autoFix) {
    // AN TOÀN (audit Nhóm E): backup TRƯỚC khi ghi đè dữ liệu tài chính; fail backup → HỦY tự sửa.
    const bk = await systemBackup(db, 'pre-autofix snapshot (Health-Scan)');
    if (!bk.ok) return { ok: false, error: 'BACKUP_FAILED', message: `Không tạo được backup an toàn trước khi tự sửa — HỦY: ${bk.error}` };
    autoFixed = await applyAutoFixes(db, findings);
    if (autoFixed > 0) findings = await collectFindings(db); // quét lại để phản ánh sau khi sửa
  }
  const res = await persistRun(db, { kind: 'MANUAL', findings, actorId: user.id, startedAt, autoFixed });
  await writeAudit(db, { actorUserId: user.id, action: 'STORAGE_CLEANUP', targetType: 'System', targetId: 'scan', after: { runId: res.runId, status: res.status, issuesFound: res.issuesFound, autoFixed } });
  return { ok: true, data: res };
}

export interface MaintenanceRunDto {
  id: number;
  kind: string;
  status: string;
  checksTotal: number;
  issuesFound: number;
  errorCount: number;
  warnCount: number;
  autoFixed: number;
  vacuumed: boolean;
  auditDeleted: number;
  trashDeleted: number;
  durationMs: number;
  triggeredByName: string | null;
  startedAt: string;
  finishedAt: string | null;
  findings?: Finding[];
}

/** STORAGE_VIEW — lịch sử bảo trì (mới nhất trước). */
export async function listRuns(limit = 50): Promise<{ ok: boolean; error?: string; message?: string; data?: MaintenanceRunDto[] }> {
  const g = await requirePermission('STORAGE_VIEW', { action: 'STORAGE_VIEW' });
  if (!g.ok) return g;
  const rows = await g.db.maintenanceRun.findMany({ orderBy: { id: 'desc' }, take: Math.min(200, Math.max(1, limit)) });
  const uids = [...new Set(rows.map((r) => r.triggeredBy).filter((x): x is number => x != null))];
  const names = new Map((uids.length ? await g.db.user.findMany({ where: { id: { in: uids } }, select: { id: true, fullName: true } }) : []).map((u) => [u.id, u.fullName]));
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id, kind: r.kind, status: r.status, checksTotal: r.checksTotal, issuesFound: r.issuesFound,
      errorCount: r.errorCount, warnCount: r.warnCount, autoFixed: r.autoFixed, vacuumed: r.vacuumed,
      auditDeleted: r.auditDeleted, trashDeleted: r.trashDeleted, durationMs: r.durationMs,
      triggeredByName: r.triggeredBy != null ? names.get(r.triggeredBy) ?? null : (r.kind === 'SCHEDULED' ? 'Hệ thống' : null),
      startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null
    }))
  };
}

/** STORAGE_VIEW — chi tiết 1 lần quét (kèm báo cáo findings). */
export async function getRun(id: number): Promise<{ ok: boolean; error?: string; message?: string; data?: MaintenanceRunDto }> {
  const g = await requirePermission('STORAGE_VIEW', { action: 'STORAGE_VIEW' });
  if (!g.ok) return g;
  const r = await g.db.maintenanceRun.findUnique({ where: { id } });
  if (!r) return { ok: false, error: 'NOT_FOUND', message: 'Không tìm thấy lần quét.' };
  let findings: Finding[] = [];
  try { findings = r.reportJson ? (JSON.parse(r.reportJson) as Finding[]) : []; } catch { findings = []; }
  const name = r.triggeredBy != null ? (await g.db.user.findUnique({ where: { id: r.triggeredBy }, select: { fullName: true } }))?.fullName ?? null : (r.kind === 'SCHEDULED' ? 'Hệ thống' : null);
  return {
    ok: true,
    data: {
      id: r.id, kind: r.kind, status: r.status, checksTotal: r.checksTotal, issuesFound: r.issuesFound,
      errorCount: r.errorCount, warnCount: r.warnCount, autoFixed: r.autoFixed, vacuumed: r.vacuumed,
      auditDeleted: r.auditDeleted, trashDeleted: r.trashDeleted, durationMs: r.durationMs, triggeredByName: name,
      startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null, findings
    }
  };
}

/**
 * Dùng cho BẢO TRÌ ĐỊNH KỲ (scheduler): quét + persist 1 MaintenanceRun kind=SCHEDULED,
 * kèm số liệu backup/purge/vacuum do storage-service thực hiện. KHÔNG guard (nội bộ).
 */
export async function persistScheduledRun(db: Db, extra: { backupFile: string | null; auditDeleted: number; trashDeleted: number; vacuumed: boolean }): Promise<ScanResult> {
  const startedAt = new Date();
  const findings = await collectFindings(db);
  const res = await persistRun(db, { kind: 'SCHEDULED', findings, actorId: null, startedAt, ...extra });
  await writeAudit(db, { actorUserId: null, action: 'STORAGE_CLEANUP', targetType: 'System', targetId: 'weekly-scan', after: { runId: res.runId, status: res.status, issuesFound: res.issuesFound } });
  return res;
}
