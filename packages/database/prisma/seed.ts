// Seed (IMS_SPEC §5/§7/§13). Idempotent — an toàn chạy lại.
// R001: chỉ tạo Admin mặc định khi DB CHƯA có Admin. R002: mật khẩu hash bcrypt.
import { createPrisma } from "../src/client.js";
import { PERMISSIONS, ROLES, DEFAULT_ROLE_PERMISSIONS } from "@glb/shared";
import { hashPassword } from "@glb/business-rules";

const ADMIN_USERNAME = "adminroot";
const ADMIN_DEFAULT_PASSWORD = "Admin@123456";

async function main() {
  const prisma = createPrisma();

  // 1) Permissions (20) — §13
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { name: p.name, group: p.group },
      create: { code: p.code, name: p.name, group: p.group },
    });
  }

  // 2) Roles (9) — §7
  for (const r of ROLES) {
    await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description, isSystem: r.isSystem },
      create: { name: r.name, code: r.code, description: r.description, isSystem: r.isSystem, status: "ACTIVE" },
    });
  }

  // 3) role_permissions từ ma trận mặc định — §7/§12/§13
  for (const [roleCode, permCodes] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const role = await prisma.role.findUnique({ where: { code: roleCode } });
    if (!role) continue;
    for (const code of permCodes) {
      const perm = await prisma.permission.findUnique({ where: { code } });
      if (!perm) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  // 4) Admin mặc định — R001 (chỉ khi CHƯA có Admin nào), R002 (hash), R003 (force change)
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
  const existingAdmin = await prisma.user.findFirst({
    where: { deletedAt: null, roles: { some: { roleId: adminRole.id } } },
  });

  if (!existingAdmin) {
    const admin = await prisma.user.create({
      data: {
        fullName: "Quản trị hệ thống",
        username: ADMIN_USERNAME,
        passwordHash: hashPassword(ADMIN_DEFAULT_PASSWORD),
        status: "ACTIVE",
        forceChangePassword: true,
        roles: { create: { roleId: adminRole.id } },
      },
    });
    console.log(`[seed] Created default admin '${admin.username}' (force_change_password=true).`);
  } else {
    console.log(`[seed] Admin already exists (id=${existingAdmin.id}) — R001 skip create.`);
  }

  const counts = {
    permissions: await prisma.permission.count(),
    roles: await prisma.role.count(),
    rolePermissions: await prisma.rolePermission.count(),
    users: await prisma.user.count(),
  };
  console.log("[seed] Done:", counts);
}

main().catch((e) => {
  console.error("[seed] FAILED:", e);
  process.exit(1);
});
