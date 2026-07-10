// DB bootstrap for the Electron main process (G10: FULL-SWITCH → PostgreSQL).
// - Connection = postgresql:// built from GLB_DB_URL (self-test), DATABASE_URL (.env dev),
//   or the client server-config file (userData/server-config.json — màn "Cấu hình máy chủ").
// - Role split (G10 model A): CHỈ máy chủ (GLB_ROLE=server) chạy seed. Client (mặc định) chỉ connect.
//   Prisma 7 `prisma-client` KHÔNG kèm migrate engine → migrate chạy bằng prisma CLI phía server,
//   KHÔNG từ .exe.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { createPrisma, type Db } from '@glb/database';
import { PERMISSIONS, ROLES, DEFAULT_ROLE_PERMISSIONS } from '@glb/shared';
import { hashPassword } from '@glb/business-rules';
import { backfillEmployeeCodes } from './code-service.js';

const ADMIN_USERNAME = 'adminroot';
const ADMIN_DEFAULT_PASSWORD = 'Admin@123456';

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
