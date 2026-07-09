// DB bootstrap for the Electron main process.
// - Dev (not packaged): reuse the already-seeded packages/database/dev.db for fast iteration.
// - Prod (packaged): use app.getPath('userData')/glb.db and seed it inline when empty (R001/R002).
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app } from 'electron';
import { createPrisma, type Db } from '@glb/database';
import { PERMISSIONS, ROLES, DEFAULT_ROLE_PERMISSIONS } from '@glb/shared';
import { hashPassword } from '@glb/business-rules';

const ADMIN_USERNAME = 'adminroot';
const ADMIN_DEFAULT_PASSWORD = 'Admin@123456';

let prisma: Db | undefined;

/** Resolve the SQLite database URL (file:...) for the current run. */
export function resolveDatabaseUrl(): string {
  // Explicit override (used by the headless self-test to run on a throwaway copy).
  if (process.env['GLB_DB_URL']) return process.env['GLB_DB_URL'] as string;
  if (app.isPackaged) {
    return 'file:' + join(app.getPath('userData'), 'glb.db');
  }
  // Dev: point at the seeded workspace DB (packages/database/dev.db).
  // __dirname at runtime = apps/desktop/out/main → climb to repo root.
  const devDb = resolve(__dirname, '../../../../packages/database/dev.db');
  return 'file:' + devDb;
}

export function getDb(): Db {
  if (!prisma) throw new Error('DB not initialised — call initDb() first.');
  return prisma;
}

/** Seed permissions/roles/role_permissions + default admin when the DB is empty (idempotent). */
async function seedIfEmpty(db: Db): Promise<void> {
  const userCount = await db.user.count();
  const permCount = await db.permission.count();
  if (userCount > 0 && permCount > 0) return; // already provisioned

  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { code: p.code },
      update: { name: p.name, group: p.group },
      create: { code: p.code, name: p.name, group: p.group }
    });
  }
  for (const r of ROLES) {
    await db.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description, isSystem: r.isSystem },
      create: { name: r.name, code: r.code, description: r.description, isSystem: r.isSystem, status: 'ACTIVE' }
    });
  }
  for (const [roleCode, permCodes] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
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
}

export async function initDb(): Promise<Db> {
  const url = resolveDatabaseUrl();
  const filePath = url.replace(/^file:/, '');
  const preexisting = existsSync(filePath);
  prisma = createPrisma(url);
  // In prod the file/schema won't exist yet — packaging must ship migrations (Phase C).
  // For now: attempt seed; if tables are missing this throws and is surfaced to the user.
  await seedIfEmpty(prisma);
  if (!preexisting && !app.isPackaged) {
    // eslint-disable-next-line no-console
    console.warn('[db] dev DB file was missing at', filePath);
  }
  return prisma;
}
