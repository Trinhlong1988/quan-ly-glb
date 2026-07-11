// DB bootstrap for the Electron main process (G10: FULL-SWITCH → PostgreSQL).
// - Connection = postgresql:// built from GLB_DB_URL (self-test), DATABASE_URL (.env dev),
//   or the client server-config file (userData/server-config.json — màn "Cấu hình máy chủ").
// - Role split (G10 model A): CHỈ máy chủ (GLB_ROLE=server) chạy seed. Client (mặc định) chỉ connect.
//   Prisma 7 `prisma-client` KHÔNG kèm migrate engine → migrate chạy bằng prisma CLI phía server,
//   KHÔNG từ .exe.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { Client } from 'pg';
import { createPrisma, type Db } from '@glb/database';
import {
  PERMISSIONS,
  ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  validateServerConfig,
  DEFAULT_SERVER_PORT,
  DEFAULT_SERVER_DATABASE,
  DEFAULT_SERVER_USER,
  type ServerConfigInput,
  type NormalizedServerConfig
} from '@glb/shared';
import { hashPassword } from '@glb/business-rules';
import { backfillEmployeeCodes } from './code-service.js';
import { writeAudit } from './audit.js';

const ADMIN_USERNAME = 'adminroot';
const ADMIN_DEFAULT_PASSWORD = 'Admin@123456';

// ── G-CFG.7 §11 Pha I1 — bug class "DB tiến hóa" (memory 9/7 H7) ──────────────
// Quyền ngành nghề MỚI phải được cấp cho role ĐÃ TỒN TẠI trên DB cũ (không chỉ role tạo mới
// hay ADMIN). ADMIN đã tự đồng bộ ĐỦ quyền mỗi boot (R_ADMIN_SUPERUSER). MANAGER (+ role
// quản-lý-cấu-hình) cần cấp 1 LẦN — idempotent, guard bằng cờ AppSetting để KHÔNG cấp lại quyền
// admin đã CHỦ ĐỘNG gỡ về sau (tôn trọng G-POS-A01: reboot không tự bật lại quyền đã tắt).
const INDUSTRY_PERM_CODES = ['CONFIG_INDUSTRY_VIEW', 'CONFIG_INDUSTRY_CREATE', 'CONFIG_INDUSTRY_UPDATE', 'CONFIG_INDUSTRY_DELETE'];
const INDUSTRY_PERM_TARGET_ROLES = ['MANAGER'];
const INDUSTRY_GRANT_FLAG = 'seed.industryPermsGrantedV1';

/**
 * Cấp (idempotent) quyền ngành nghề cho các role đã có sẵn trên DB (db-evolution).
 * Trả về số (role×quyền) vừa được thêm mới. Bỏ qua cặp đã có → an toàn chạy lại.
 * Không guard cờ ở đây (để selftest gọi trực tiếp mô phỏng DB tiến hóa); cờ guard nằm ở seedIfEmpty.
 */
export async function grantIndustryPermsToExistingRoles(db: Db): Promise<number> {
  const perms = await db.permission.findMany({ where: { code: { in: INDUSTRY_PERM_CODES } }, select: { id: true } });
  let granted = 0;
  for (const roleCode of INDUSTRY_PERM_TARGET_ROLES) {
    const role = await db.role.findUnique({ where: { code: roleCode }, select: { id: true } });
    if (!role) continue;
    for (const perm of perms) {
      const existing = await db.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }
      });
      if (existing) continue;
      await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
      granted++;
    }
  }
  return granted;
}

// ── PHASE H1 — Thu–Chi: bug class "DB tiến hóa" (H7) ──────────────────────────
// Quyền thu-chi MỚI (CASHCAT_*) phải cấp cho role ĐÃ TỒN TẠI trên DB cũ (không chỉ role tạo mới).
// Cùng khuôn với ngành nghề: ADMIN tự đồng bộ mỗi boot (R_ADMIN_SUPERUSER); MANAGER cấp 1 LẦN
// idempotent, guard bằng cờ AppSetting để KHÔNG cấp lại quyền admin đã CHỦ ĐỘNG gỡ về sau.
const CASHCAT_PERM_CODES = ['CASHCAT_VIEW', 'CASHCAT_CREATE', 'CASHCAT_UPDATE', 'CASHCAT_DELETE'];
const CASHCAT_PERM_TARGET_ROLES = ['MANAGER'];
const CASHCAT_GRANT_FLAG = 'seed.cashCatPermsGrantedV1';

/**
 * Cấp (idempotent) quyền thu-chi (CASHCAT_*) cho các role đã có sẵn trên DB (db-evolution).
 * Trả về số (role×quyền) vừa thêm mới. Bỏ qua cặp đã có → an toàn chạy lại.
 * Không guard cờ ở đây (để selftest gọi trực tiếp mô phỏng DB tiến hóa); cờ guard nằm ở seedIfEmpty.
 */
export async function grantCashCatPermsToExistingRoles(db: Db): Promise<number> {
  const perms = await db.permission.findMany({ where: { code: { in: CASHCAT_PERM_CODES } }, select: { id: true } });
  let granted = 0;
  for (const roleCode of CASHCAT_PERM_TARGET_ROLES) {
    const role = await db.role.findUnique({ where: { code: roleCode }, select: { id: true } });
    if (!role) continue;
    for (const perm of perms) {
      const existing = await db.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }
      });
      if (existing) continue;
      await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
      granted++;
    }
  }
  return granted;
}

// ── PHASE H2-core — Thu–Chi: bug class "DB tiến hóa" (H7) ─────────────────────
// Quyền quỹ + phiếu thu/chi MỚI (FUND_*/CASHENTRY_*) phải cấp cho role ĐÃ TỒN TẠI trên DB cũ
// (không chỉ role tạo mới). Cùng khuôn CASHCAT: ADMIN tự đồng bộ mỗi boot (R_ADMIN_SUPERUSER);
// MANAGER + ACCOUNTANT cấp 1 LẦN idempotent, guard bằng cờ AppSetting để KHÔNG cấp lại quyền admin
// đã CHỦ ĐỘNG gỡ về sau. Kế toán (ACCOUNTANT) = vai chính thu-chi (spec §6.4).
const CASHFLOW_PERM_CODES = ['FUND_VIEW', 'FUND_CREATE', 'FUND_UPDATE', 'FUND_DELETE', 'CASHENTRY_VIEW', 'CASHENTRY_CREATE', 'CASHENTRY_CANCEL'];
const CASHFLOW_PERM_TARGET_ROLES = ['MANAGER', 'ACCOUNTANT'];

// ── PHASE H2b — Thu–Chi: bug class "DB tiến hóa" (H7) cho quyền phân loại / ghi giảm công nợ ──────
// DEBT_CLASSIFY (phân loại chất lượng công nợ) cấp cho MANAGER + ACCOUNTANT; DEBT_WRITEOFF (ghi giảm
// nợ xấu — quyền cao) CHỈ MANAGER (ADMIN tự đủ mỗi boot qua R_ADMIN_SUPERUSER). Cấp 1 LẦN idempotent
// cho role ĐÃ TỒN TẠI trên DB cũ (cờ AppSetting), KHÔNG cấp lại quyền admin đã chủ động gỡ về sau.
const DEBT_QUALITY_GRANTS: { role: string; codes: string[] }[] = [
  { role: 'MANAGER', codes: ['DEBT_CLASSIFY', 'DEBT_WRITEOFF'] },
  { role: 'ACCOUNTANT', codes: ['DEBT_CLASSIFY'] }
];
const DEBT_QUALITY_GRANT_FLAG = 'seed.debtQualityPermsGrantedV1';

/**
 * Cấp (idempotent) quyền phân loại/ghi giảm công nợ (DEBT_CLASSIFY/DEBT_WRITEOFF) cho role đã có sẵn
 * trên DB (db-evolution). Mỗi role chỉ nhận đúng whitelist của mình (§6.4/task). Trả số cặp mới thêm.
 * Không guard cờ ở đây (selftest gọi trực tiếp mô phỏng DB tiến hóa); cờ guard nằm ở seedIfEmpty.
 */
export async function grantDebtQualityPermsToExistingRoles(db: Db): Promise<number> {
  let granted = 0;
  for (const { role: roleCode, codes } of DEBT_QUALITY_GRANTS) {
    const role = await db.role.findUnique({ where: { code: roleCode }, select: { id: true } });
    if (!role) continue;
    const perms = await db.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
    for (const perm of perms) {
      const existing = await db.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }
      });
      if (existing) continue;
      await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
      granted++;
    }
  }
  return granted;
}
const CASHFLOW_GRANT_FLAG = 'seed.cashflowPermsGrantedV1';

/**
 * Cấp (idempotent) quyền quỹ + phiếu thu/chi (FUND_* / CASHENTRY_*) cho các role đã có sẵn trên DB
 * (db-evolution). Trả về số (role×quyền) vừa thêm mới. Bỏ qua cặp đã có → an toàn chạy lại.
 * Không guard cờ ở đây (để selftest gọi trực tiếp mô phỏng DB tiến hóa); cờ guard nằm ở seedIfEmpty.
 */
export async function grantCashflowPermsToExistingRoles(db: Db): Promise<number> {
  const perms = await db.permission.findMany({ where: { code: { in: CASHFLOW_PERM_CODES } }, select: { id: true } });
  let granted = 0;
  for (const roleCode of CASHFLOW_PERM_TARGET_ROLES) {
    const role = await db.role.findUnique({ where: { code: roleCode }, select: { id: true } });
    if (!role) continue;
    for (const perm of perms) {
      const existing = await db.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }
      });
      if (existing) continue;
      await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
      granted++;
    }
  }
  return granted;
}

// ── PHASE H1 — Thu–Chi: seed danh mục thu/chi HỆ THỐNG (isSystem=true), idempotent ────────────
// Khóa tự nhiên = (kind, name). Có → skip; chưa → tạo. Gán affectsPnl đúng bất biến §2.1/§5:
//   sourceKind nội bộ (DEBT_*/DEPOSIT/DEPOSIT_REFUND/ADVANCE/DEVICE_DEPOSIT/FUND_TRANSFER) = false;
//   doanh thu bán trực tiếp (SALE_POS/SALE_TID/DT khác) + chi phí vận hành + chi lương (SALARY) = true.
interface SeedCat { kind: 'THU' | 'CHI'; name: string; unit: string | null; sourceKind: string; affectsPnl: boolean; }
const SYSTEM_CASH_CATEGORIES: SeedCat[] = [
  // THU
  { kind: 'THU', name: 'Công nợ khách hàng', unit: 'đồng', sourceKind: 'DEBT_CUSTOMER', affectsPnl: false },
  { kind: 'THU', name: 'Công nợ đối tác', unit: 'đồng', sourceKind: 'DEBT_PARTNER', affectsPnl: false },
  { kind: 'THU', name: 'Doanh thu bán máy POS', unit: 'đồng', sourceKind: 'SALE_POS', affectsPnl: true },
  { kind: 'THU', name: 'Doanh thu bán TID', unit: 'đồng', sourceKind: 'SALE_TID', affectsPnl: true },
  { kind: 'THU', name: 'Doanh thu khác', unit: 'đồng', sourceKind: 'MANUAL', affectsPnl: true },
  { kind: 'THU', name: 'Thu cọc máy', unit: 'đồng', sourceKind: 'DEPOSIT', affectsPnl: false },
  { kind: 'THU', name: 'Hoàn ứng (thu lại tạm ứng)', unit: 'đồng', sourceKind: 'ADVANCE', affectsPnl: false },
  { kind: 'THU', name: 'Chuyển quỹ đến', unit: 'đồng', sourceKind: 'FUND_TRANSFER', affectsPnl: false },
  // CHI
  { kind: 'CHI', name: 'Chi lương', unit: 'đồng', sourceKind: 'SALARY', affectsPnl: true },
  { kind: 'CHI', name: 'Chi phí vận hành', unit: 'đồng', sourceKind: 'MANUAL', affectsPnl: true },
  { kind: 'CHI', name: 'Chi phí văn phòng', unit: 'đồng', sourceKind: 'MANUAL', affectsPnl: true },
  { kind: 'CHI', name: 'Chi phí khác', unit: 'đồng', sourceKind: 'MANUAL', affectsPnl: true },
  { kind: 'CHI', name: 'Chi tạm ứng', unit: 'đồng', sourceKind: 'ADVANCE', affectsPnl: false },
  { kind: 'CHI', name: 'Hoàn cọc máy', unit: 'đồng', sourceKind: 'DEPOSIT_REFUND', affectsPnl: false },
  { kind: 'CHI', name: 'Chuyển quỹ đi', unit: 'đồng', sourceKind: 'FUND_TRANSFER', affectsPnl: false },
  // H2b — Ghi giảm nợ xấu (write-off): chi phí thật → affectsPnl=true (trừ thẳng lợi nhuận accrual).
  { kind: 'CHI', name: 'Chi phí nợ xấu', unit: 'đồng', sourceKind: 'BAD_DEBT', affectsPnl: true }
];

/** Seed idempotent danh mục thu/chi hệ thống. Trả về số danh mục vừa tạo mới. */
export async function seedSystemCashCategories(db: Db): Promise<number> {
  let created = 0;
  for (const c of SYSTEM_CASH_CATEGORIES) {
    const existing = await db.cashCategory.findFirst({ where: { kind: c.kind, name: c.name }, select: { id: true } });
    if (existing) continue;
    await db.cashCategory.create({
      data: { kind: c.kind, name: c.name, unit: c.unit, periodType: 'NONE', sourceKind: c.sourceKind, affectsPnl: c.affectsPnl, isSystem: true, active: true }
    });
    created++;
  }
  return created;
}

// ── VIỆC 1 — seed mặc định "Trạng thái nhập máy POS" (§C8a) ───────────────────
// Bug gốc: PosIntakeStatus KHÔNG được seed → nút/màn "Nhập kho máy POS" bị chặn vĩnh viễn
// (gate PosSupplyPage đòi statuses.length > 0). Seed 4 trạng thái chuẩn (đúng ví dụ trong UI) cho
// CẢ DB mới LẪN DB đã tồn tại: seedIfEmpty chạy mỗi boot máy chủ theo kiểu ADDITIVE (giống các
// seedSystemCashCategories / grant*) nên phủ luôn DB cũ của Mr.Long.
// Idempotent theo khóa tự nhiên = name, so khớp KHÔNG PHÂN BIỆT HOA/THƯỜNG (fix db-evolution-gap
// 11/7): DB cũ có thể đã có biến thể khác hoa/thường (vd "Máy Mới") → nếu dùng findUnique khớp
// chính xác thì seed đẻ thêm "Máy mới" gần trùng, gây 2 dòng lẫn lộn trong dropdown. Dùng findFirst
// insensitive: (a) chưa có biến thể nào → tạo; (b) đã có bất kỳ biến thể (kể cả xóa mềm) → bỏ qua.
// Vừa tránh trùng gần-giống, vừa KHÔNG "hồi sinh" trạng thái admin đã CHỦ ĐỘNG xóa (tôn trọng
// G-POS-A01: reboot không tự bật lại cái admin đã tắt). createdBy = null (system seed).
const DEFAULT_INTAKE_STATUS_NAMES = ['Máy mới', 'Máy cũ', 'Máy đổi', 'Máy thuê'];

/** Seed idempotent 4 trạng thái nhập máy POS mặc định. Trả về số trạng thái vừa tạo mới. */
export async function seedDefaultIntakeStatusesIfMissing(db: Db): Promise<number> {
  let created = 0;
  for (const name of DEFAULT_INTAKE_STATUS_NAMES) {
    const existing = await db.posIntakeStatus.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true }
    });
    if (existing) continue;
    await db.posIntakeStatus.create({ data: { name, createdBy: null } });
    created++;
  }
  return created;
}

// ── PHASE K1 — Hợp nhất POS: backfill PosDevice từ PosIntake (§2.2, desync #22) ───────────────
// PosDevice = nguồn sự thật DUY NHẤT. DB cũ có phiếu nhập (pos_intakes) nhưng CHƯA có bản ghi máy
// (pos_devices) → máy "tàng hình" ở "Danh sách máy" + không gán TID được. Backfill idempotent:
//   • serial CHƯA có ở pos_devices  → tạo PosDevice IN_STOCK (điền cột nhập) + AssetEvent(STOCK_IN).
//   • serial ĐÃ có ở cả 2 bảng       → chỉ ĐIỀN cột nhập còn TRỐNG; TUYỆT ĐỐI KHÔNG đụng
//     status/currentTid/currentCustomerId/currentAgentId đang chạy.
//   • posModelId ← model(text) nếu match tên/mã PosModel; bankId ← bank(text) nếu match Bank; else null.
//   • Đảm bảo MỌI máy có ≥1 AssetEvent STOCK_IN (timeline gốc).
// Chạy 2 lần KHÔNG nhân đôi PosDevice/AssetEvent. Guard cờ nằm ở seedIfEmpty (1 lần/DB), giống grant*.
const POS_UNIFY_BACKFILL_FLAG = 'seed.posUnifyBackfilledV1';

export interface PosBackfillReport {
  created: number; // số PosDevice mới tạo từ phiếu nhập
  filled: number; // số PosDevice đã có được điền thêm cột nhập
  stockInAdded: number; // số AssetEvent(STOCK_IN) bổ sung
  intakeSerials: number; // distinct serial alive ở pos_intakes
  deviceSerials: number; // số pos_devices tương ứng các serial đó (đối soát)
}

export async function backfillPosDevicesFromIntakes(db: Db): Promise<PosBackfillReport> {
  const norm = (s: string): string => s.trim().toLowerCase();
  const models = await db.posModel.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true } });
  const banks = await db.bank.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true } });
  const modelByKey = new Map<string, number>();
  for (const m of models) { modelByKey.set(norm(m.code), m.id); modelByKey.set(norm(m.name), m.id); }
  const bankByKey = new Map<string, number>();
  for (const b of banks) { bankByKey.set(norm(b.code), b.id); bankByKey.set(norm(b.name), b.id); }

  const intakes = await db.posIntake.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' } });
  let created = 0, filled = 0, stockInAdded = 0;
  for (const it of intakes) {
    const dev = await db.posDevice.findUnique({ where: { serial: it.serial } });
    if (!dev) {
      await db.$transaction(async (tx) => {
        await tx.posDevice.create({
          data: { serial: it.serial, status: 'IN_STOCK', posModelId: it.posModelId, supplierId: it.supplierId, intakeStatusId: it.intakeStatusId, importPrice: it.importPrice, importedAt: it.importedAt, createdBy: it.createdBy }
        });
        await tx.assetEvent.create({
          data: { deviceSerial: it.serial, eventType: 'STOCK_IN', toState: 'IN_STOCK', actorUserId: it.createdBy, occurredAt: it.importedAt, afterJson: JSON.stringify({ serial: it.serial, backfill: true }) }
        });
      });
      created++;
      stockInAdded++;
    } else {
      // Chỉ ĐIỀN cột nhập còn TRỐNG — KHÔNG đụng trạng thái vận hành đang chạy.
      const patch: Record<string, unknown> = {};
      if (dev.posModelId == null && it.posModelId != null) patch.posModelId = it.posModelId;
      if (dev.supplierId == null && it.supplierId != null) patch.supplierId = it.supplierId;
      if (dev.intakeStatusId == null && it.intakeStatusId != null) patch.intakeStatusId = it.intakeStatusId;
      if (dev.importPrice == null && it.importPrice != null) patch.importPrice = it.importPrice;
      if (dev.importedAt == null && it.importedAt != null) patch.importedAt = it.importedAt;
      if (Object.keys(patch).length > 0) { await db.posDevice.update({ where: { id: dev.id }, data: patch }); filled++; }
      const hasStockIn = await db.assetEvent.findFirst({ where: { deviceSerial: dev.serial, eventType: 'STOCK_IN' }, select: { id: true } });
      if (!hasStockIn) {
        await db.assetEvent.create({
          data: { deviceSerial: dev.serial, eventType: 'STOCK_IN', toState: dev.status, actorUserId: it.createdBy, occurredAt: it.importedAt ?? dev.createdAt, afterJson: JSON.stringify({ serial: dev.serial, backfill: true }) }
        });
        stockInAdded++;
      }
    }
  }
  // Pass 2: map text model/bank → FK cho MỌI máy còn trống (kể cả máy tạo tay không qua phiếu nhập).
  const devsToMap = await db.posDevice.findMany({
    where: { deletedAt: null, OR: [{ posModelId: null, model: { not: null } }, { bankId: null, bank: { not: null } }] },
    select: { id: true, model: true, bank: true, posModelId: true, bankId: true }
  });
  for (const d of devsToMap) {
    const patch: Record<string, unknown> = {};
    if (d.posModelId == null && d.model) { const id = modelByKey.get(norm(d.model)); if (id) patch.posModelId = id; }
    if (d.bankId == null && d.bank) { const id = bankByKey.get(norm(d.bank)); if (id) patch.bankId = id; }
    if (Object.keys(patch).length > 0) { await db.posDevice.update({ where: { id: d.id }, data: patch }); filled++; }
  }
  const distinctSerials = [...new Set(intakes.map((i) => i.serial))];
  const deviceSerials = await db.posDevice.count({ where: { serial: { in: distinctSerials } } });
  return { created, filled, stockInAdded, intakeSerials: distinctSerials.length, deviceSerials };
}

let prisma: Db | undefined;

/** Cấu hình kết nối máy chủ PostgreSQL (client nhập ở màn "Cấu hình máy chủ", G10 model A). */
interface ServerConfig {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
}

/** Đường dẫn file cấu hình máy chủ (nằm trong userData của client). */
export function serverConfigPath(): string {
  return join(app.getPath('userData'), 'server-config.json');
}

/** Đọc cấu hình máy chủ nếu client đã cấu hình. Trả null nếu chưa (→ UI hiện màn cấu hình). */
export function readServerConfig(): ServerConfig | null {
  const p = serverConfigPath();
  if (!existsSync(p)) return null;
  try {
    const cfg = JSON.parse(readFileSync(p, 'utf8')) as Partial<ServerConfig>;
    if (!cfg.host || !cfg.database || !cfg.user || cfg.password == null) return null;
    return { host: cfg.host, port: cfg.port ?? 5432, database: cfg.database, user: cfg.user, password: cfg.password };
  } catch {
    return null;
  }
}

/** Dựng chuỗi postgresql:// (URL-encode user/password để không vỡ khi có ký tự đặc biệt). */
function buildPgUrl(cfg: ServerConfig): string {
  const user = encodeURIComponent(cfg.user);
  const pass = encodeURIComponent(cfg.password);
  return `postgresql://${user}:${pass}@${cfg.host}:${cfg.port ?? 5432}/${cfg.database}`;
}

/** Resolve the PostgreSQL connection URL (postgresql://...) for the current run. */
export function resolveDatabaseUrl(): string {
  // Explicit override (self-test harness points at a throwaway Postgres database).
  if (process.env['GLB_DB_URL']) return process.env['GLB_DB_URL'] as string;
  // Dev (.env) — máy chủ dev + selftest CLI.
  if (!app.isPackaged && process.env['DATABASE_URL']) return process.env['DATABASE_URL'] as string;
  // Client đóng gói: đọc cấu hình máy chủ (IP:port + tài khoản pg chung).
  const cfg = readServerConfig();
  if (cfg) return buildPgUrl(cfg);
  throw new Error(
    'CHƯA cấu hình máy chủ PostgreSQL. Hãy mở "Cấu hình máy chủ" nhập IP:port + tài khoản, ' +
      'hoặc đặt DATABASE_URL (dev).'
  );
}

/** True nếu tiến trình này là MÁY CHỦ (được phép seed/migrate). Mặc định = client (fail-safe). */
export function isServerRole(): boolean {
  return process.env['GLB_ROLE'] === 'server';
}

export function getDb(): Db {
  if (!prisma) throw new Error('DB not initialised — call initDb() first.');
  return prisma;
}

/**
 * Provision the catalog + default admin. Idempotent and ADDITIVE:
 * - permissions/roles/role_permissions are always upserted so schema evolution
 *   (e.g. new G-POS CUSTOMER/POS/TID permissions) lands on existing databases too.
 * - the default admin is created only when NO admin exists (R001).
 * - every user missing an employee_code is backfilled a NV## code (adminroot → NV01, §D).
 */
export async function seedIfEmpty(db: Db): Promise<void> {
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { code: p.code },
      update: { name: p.name, group: p.group },
      create: { code: p.code, name: p.name, group: p.group }
    });
  }
  // LEAD lock 9/7: app KHÔNG được tự ý hoàn tác/đổi dữ liệu (đặc biệt quyền) một cách âm thầm.
  // → default role-permissions chỉ được gắn khi role được TẠO MỚI lần đầu. Với role đã tồn tại,
  //   chỉnh tay của admin (thêm/bớt quyền) được GIỮ NGUYÊN — reboot KHÔNG tự cấp lại quyền đã gỡ.
  //   (fix G-POS-A01)
  const freshlyCreatedRoleCodes = new Set<string>();
  for (const r of ROLES) {
    const existed = await db.role.findUnique({ where: { code: r.code }, select: { id: true } });
    await db.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description, isSystem: r.isSystem },
      create: { name: r.name, code: r.code, description: r.description, isSystem: r.isSystem, status: 'ACTIVE' }
    });
    if (!existed) freshlyCreatedRoleCodes.add(r.code);
  }
  for (const [roleCode, permCodes] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    // Chỉ seed quyền mặc định cho role vừa tạo mới. Role cũ giữ nguyên cấu hình admin đã sửa.
    if (!freshlyCreatedRoleCodes.has(roleCode)) continue;
    const role = await db.role.findUnique({ where: { code: roleCode } });
    if (!role) continue;
    for (const code of permCodes) {
      const perm = await db.permission.findUnique({ where: { code } });
      if (!perm) continue;
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id }
      });
    }
  }
  // R_ADMIN_SUPERUSER (LEAD 9/7): ADMIN = superuser → LUÔN đồng bộ ĐỦ mọi quyền mỗi boot,
  // kể cả quyền MỚI thêm sau này (chống bug "thêm feature → thêm permission → role ADMIN cũ
  // thiếu quyền → menu/tính năng bị ẩn"). Role khác vẫn giữ chỉnh tay của admin (không tự cấp lại).
  {
    const adminRoleForSync = await db.role.findUnique({ where: { code: 'ADMIN' }, select: { id: true } });
    if (adminRoleForSync) {
      const allPerms = await db.permission.findMany({ select: { id: true } });
      for (const perm of allPerms) {
        await db.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: adminRoleForSync.id, permissionId: perm.id } },
          update: {},
          create: { roleId: adminRoleForSync.id, permissionId: perm.id }
        });
      }
    }
  }

  // db-evolution (G-CFG.7 I1): cấp quyền ngành nghề cho role CŨ 1 lần/DB (cờ AppSetting). Trên DB
  // mới, role vừa tạo đã có quyền qua DEFAULT_ROLE_PERMISSIONS → bước này grant=0 (an toàn no-op).
  {
    const flag = await db.appSetting.findUnique({ where: { key: INDUSTRY_GRANT_FLAG } });
    if (!flag) {
      const granted = await grantIndustryPermsToExistingRoles(db);
      await db.appSetting.upsert({
        where: { key: INDUSTRY_GRANT_FLAG },
        update: {},
        create: { key: INDUSTRY_GRANT_FLAG, value: new Date().toISOString() }
      });
      if (granted > 0) {
        await writeAudit(db, {
          actorUserId: null,
          action: 'INDUSTRY_PERMS_GRANTED',
          targetType: 'System',
          after: { granted, roles: INDUSTRY_PERM_TARGET_ROLES, perms: INDUSTRY_PERM_CODES }
        });
      }
    }
  }

  // db-evolution (PHASE H1): cấp quyền thu-chi (CASHCAT_*) cho role CŨ 1 lần/DB (cờ AppSetting).
  // DB mới → role vừa tạo đã có quyền qua DEFAULT_ROLE_PERMISSIONS → grant=0 (no-op an toàn).
  {
    const flag = await db.appSetting.findUnique({ where: { key: CASHCAT_GRANT_FLAG } });
    if (!flag) {
      const granted = await grantCashCatPermsToExistingRoles(db);
      await db.appSetting.upsert({
        where: { key: CASHCAT_GRANT_FLAG },
        update: {},
        create: { key: CASHCAT_GRANT_FLAG, value: new Date().toISOString() }
      });
      if (granted > 0) {
        await writeAudit(db, {
          actorUserId: null,
          action: 'CASHCAT_PERMS_GRANTED',
          targetType: 'System',
          after: { granted, roles: CASHCAT_PERM_TARGET_ROLES, perms: CASHCAT_PERM_CODES }
        });
      }
    }
  }

  // db-evolution (PHASE H2-core): cấp quyền quỹ + phiếu thu/chi (FUND_*/CASHENTRY_*) cho role CŨ
  // (MANAGER/ACCOUNTANT) 1 lần/DB (cờ AppSetting). DB mới → role vừa tạo đã có quyền qua
  // DEFAULT_ROLE_PERMISSIONS → grant=0 (no-op an toàn).
  {
    const flag = await db.appSetting.findUnique({ where: { key: CASHFLOW_GRANT_FLAG } });
    if (!flag) {
      const granted = await grantCashflowPermsToExistingRoles(db);
      await db.appSetting.upsert({
        where: { key: CASHFLOW_GRANT_FLAG },
        update: {},
        create: { key: CASHFLOW_GRANT_FLAG, value: new Date().toISOString() }
      });
      if (granted > 0) {
        await writeAudit(db, {
          actorUserId: null,
          action: 'CASHFLOW_PERMS_GRANTED',
          targetType: 'System',
          after: { granted, roles: CASHFLOW_PERM_TARGET_ROLES, perms: CASHFLOW_PERM_CODES }
        });
      }
    }
  }

  // db-evolution (PHASE H2b): cấp quyền phân loại/ghi giảm công nợ (DEBT_CLASSIFY/DEBT_WRITEOFF) cho
  // role CŨ (MANAGER/ACCOUNTANT) 1 lần/DB (cờ AppSetting). DB mới → role vừa tạo đã có quyền qua
  // DEFAULT_ROLE_PERMISSIONS → grant=0 (no-op an toàn).
  {
    const flag = await db.appSetting.findUnique({ where: { key: DEBT_QUALITY_GRANT_FLAG } });
    if (!flag) {
      const granted = await grantDebtQualityPermsToExistingRoles(db);
      await db.appSetting.upsert({
        where: { key: DEBT_QUALITY_GRANT_FLAG },
        update: {},
        create: { key: DEBT_QUALITY_GRANT_FLAG, value: new Date().toISOString() }
      });
      if (granted > 0) {
        await writeAudit(db, {
          actorUserId: null,
          action: 'DEBT_QUALITY_PERMS_GRANTED',
          targetType: 'System',
          after: { granted, grants: DEBT_QUALITY_GRANTS }
        });
      }
    }
  }

  // PHASE H1: seed danh mục thu/chi hệ thống (idempotent — bỏ qua danh mục đã tồn tại).
  await seedSystemCashCategories(db);

  // VIỆC 1: seed 4 trạng thái nhập máy POS mặc định (idempotent theo name). Fix màn/nút "Nhập kho
  // máy POS" bị chặn vĩnh viễn khi PosIntakeStatus rỗng — áp cho cả DB mới lẫn DB đã tồn tại.
  await seedDefaultIntakeStatusesIfMissing(db);

  // PHASE K1 (§2.2, desync #22): backfill PosDevice từ pos_intakes 1 LẦN/DB (cờ AppSetting). DB mới
  // (chưa có phiếu nhập) → no-op an toàn. Idempotent nên kể cả không guard cũng không nhân đôi; cờ
  // chỉ để tránh quét lại toàn bảng mỗi boot.
  {
    const flag = await db.appSetting.findUnique({ where: { key: POS_UNIFY_BACKFILL_FLAG } });
    if (!flag) {
      const report = await backfillPosDevicesFromIntakes(db);
      await db.appSetting.upsert({
        where: { key: POS_UNIFY_BACKFILL_FLAG },
        update: {},
        create: { key: POS_UNIFY_BACKFILL_FLAG, value: new Date().toISOString() }
      });
      if (report.created > 0 || report.filled > 0 || report.stockInAdded > 0) {
        await writeAudit(db, { actorUserId: null, action: 'POS_UNIFY_BACKFILL', targetType: 'System', after: report });
      }
      if (report.intakeSerials !== report.deviceSerials) {
        // eslint-disable-next-line no-console
        console.warn(`[pos-unify] đối soát lệch: ${report.intakeSerials} serial phiếu nhập vs ${report.deviceSerials} máy tương ứng`);
      }
    }
  }

  const adminRole = await db.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  const existingAdmin = await db.user.findFirst({
    where: { deletedAt: null, roles: { some: { roleId: adminRole.id } } }
  });
  if (!existingAdmin) {
    await db.user.create({
      data: {
        fullName: 'Quản trị hệ thống',
        username: ADMIN_USERNAME,
        passwordHash: hashPassword(ADMIN_DEFAULT_PASSWORD),
        status: 'ACTIVE',
        forceChangePassword: true,
        roles: { create: { roleId: adminRole.id } }
      }
    });
  }

  // §D: ensure every user carries a mã NV (adminroot → NV01).
  await backfillEmployeeCodes(db);
}

export async function initDb(): Promise<Db> {
  const url = resolveDatabaseUrl();
  prisma = createPrisma(url);
  // G10 model A: CHỈ máy chủ seed (1 lần). Client chỉ connect (DB đã được server migrate+seed).
  // Client seed mỗi boot lên DB dùng chung = churn/deadlock (bài học HIGH-4). Migrate KHÔNG chạy
  // từ .exe (Prisma 7 prisma-client thiếu migrate engine) — máy chủ migrate bằng prisma CLI.
  if (isServerRole()) {
    await seedIfEmpty(prisma);
  }
  return prisma;
}

// ── G10.3 Cấu hình máy chủ (client first-run) ────────────────────────────────

/**
 * True nếu tiến trình này PHẢI dựa vào file server-config.json để biết máy chủ (→ có thể cần màn cấu hình).
 * Máy chủ (GLB_ROLE=server), selftest (GLB_DB_URL) và dev có DATABASE_URL đều KHÔNG dùng màn này.
 */
function isClientConfigMode(): boolean {
  if (isServerRole()) return false;
  if (process.env['GLB_DB_URL']) return false;
  if (!app.isPackaged && process.env['DATABASE_URL']) return false;
  return true;
}

/** Kiểm tra kết nối SỐNG bằng 1 truy vấn nhẹ. Trả false nếu chưa init hoặc mất kết nối. */
async function probeConnection(): Promise<boolean> {
  if (!prisma) return false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Trạng thái CSDL cho renderer quyết định luồng khởi động:
 * - `ready`: đã kết nối được (SELECT 1 OK) → vào đăng nhập.
 * - `needsConfig`: client dựa server-config nhưng CHƯA kết nối được → hiện màn "Cấu hình máy chủ".
 * - `serverRole`: máy chủ KHÔNG bao giờ hiện màn cấu hình.
 */
export async function getDbStatus(): Promise<{ ready: boolean; needsConfig: boolean; serverRole: boolean }> {
  const serverRole = isServerRole();
  const ready = await probeConnection();
  const needsConfig = isClientConfigMode() && !ready;
  return { ready, needsConfig, serverRole };
}

/** Cấu hình hiện tại (để đổ vào form). Thiếu → trả giá trị mặc định để form gợi ý sẵn. */
function currentServerConfig(): NormalizedServerConfig {
  const cfg = readServerConfig();
  if (cfg) return { host: cfg.host, port: cfg.port ?? DEFAULT_SERVER_PORT, database: cfg.database, user: cfg.user, password: cfg.password };
  return { host: '', port: DEFAULT_SERVER_PORT, database: DEFAULT_SERVER_DATABASE, user: DEFAULT_SERVER_USER, password: '' };
}

/** IPC `serverConfig:get` — trạng thái CSDL + cấu hình hiện có (đổ form). */
export async function getServerConfig(): Promise<{
  ready: boolean;
  needsConfig: boolean;
  serverRole: boolean;
  configured: boolean;
  config: NormalizedServerConfig;
}> {
  const status = await getDbStatus();
  return { ...status, configured: readServerConfig() != null, config: currentServerConfig() };
}

/** Gói lỗi pg thành thông điệp tiếng Việt dễ hiểu (giữ nguyên chi tiết gốc phía sau). */
function friendlyPgError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const raw = e?.message ?? String(err);
  if (e?.code === 'ECONNREFUSED') return `Máy chủ từ chối kết nối (kiểm tra IP/cổng + PostgreSQL đang chạy). ${raw}`;
  if (e?.code === 'ETIMEDOUT' || /timeout/i.test(raw)) return `Hết thời gian chờ kết nối tới máy chủ (kiểm tra IP/mạng LAN/tường lửa). ${raw}`;
  if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') return `Không tìm thấy máy chủ theo địa chỉ đã nhập. ${raw}`;
  if (e?.code === '28P01' || e?.code === '28000') return `Sai tài khoản hoặc mật khẩu PostgreSQL. ${raw}`;
  if (e?.code === '3D000') return `Cơ sở dữ liệu không tồn tại trên máy chủ. ${raw}`;
  return raw;
}

/** IPC `serverConfig:test` — thử `new Client(...).connect()` (pg) với timeout, KHÔNG ghi file. */
export async function testServerConfig(input: ServerConfigInput): Promise<{ ok: boolean; error?: string }> {
  const v = validateServerConfig(input);
  if (!v.valid || !v.config) return { ok: false, error: v.error ?? 'Cấu hình không hợp lệ.' };
  const c = v.config;
  const client = new Client({
    host: c.host,
    port: c.port,
    database: c.database,
    user: c.user,
    password: c.password,
    connectionTimeoutMillis: 6000
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyPgError(err) };
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore cleanup error */
    }
  }
}

/** Đóng kết nối cũ + init lại theo cấu hình mới, rồi xác nhận kết nối sống. */
async function reinitDb(): Promise<{ ok: boolean; error?: string }> {
  try {
    if (prisma) {
      try {
        await prisma.$disconnect();
      } catch {
        /* ignore */
      }
      prisma = undefined;
    }
    await initDb();
    if (!(await probeConnection())) {
      return { ok: false, error: 'Đã lưu cấu hình nhưng không kết nối được tới máy chủ. Kiểm tra lại thông tin.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyPgError(err) };
  }
}

/** IPC `serverConfig:save` — validate → ghi server-config.json → init lại kết nối. */
export async function saveServerConfig(input: ServerConfigInput): Promise<{ ok: boolean; error?: string }> {
  const v = validateServerConfig(input);
  if (!v.valid || !v.config) return { ok: false, error: v.error ?? 'Cấu hình không hợp lệ.' };
  try {
    writeFileSync(serverConfigPath(), JSON.stringify(v.config, null, 2), 'utf8');
  } catch (err) {
    return { ok: false, error: 'Không ghi được file cấu hình máy chủ: ' + (err as Error).message };
  }
  return reinitDb();
}
