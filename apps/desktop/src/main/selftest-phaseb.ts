// Phase B integration self-test (headless). Drives the REAL service layer against the live DB
// (run on a throwaway copy via GLB_DB_URL) to prove the enforceable rules end-to-end:
//   403 + audit on missing permission (R_AUDIT_003), manager cannot create admin (R_MANAGER_002),
//   delete role-with-users blocked (R_ROLE_005), delete protected ADMIN role blocked (R_ROLE_006),
//   last-admin delete blocked (R004), backup produces file + checksum + audit (R_BACKUP).
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as roleSvc from './role-service.js';
import * as userSvc from './user-service.js';
import * as auditSvc from './audit-service.js';
import * as backupSvc from './backup-service.js';

let failures = 0;
function assert(name: string, cond: boolean, extra?: unknown): void {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  // eslint-disable-next-line no-console
  console.log(`SELFTEST2 ${status} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

export async function runServiceSelfTest(): Promise<number> {
  const db = getDb();
  const ADMIN = { u: 'adminroot', p: 'Admin@123456' };

  // --- as ADMIN ----------------------------------------------------------
  const adminLogin = await login(ADMIN.u, ADMIN.p);
  assert('admin login ok', adminLogin.ok === true);
  const adminUserId = adminLogin.user!.id;

  const mkMgr = await userSvc.createUser({
    fullName: 'Quản Lý Một',
    phone: '0900000001',
    email: 'mgr1@glb.test',
    username: 'manager01',
    password: 'Manager@123',
    roleCodes: ['MANAGER']
  });
  assert('admin creates MANAGER user', mkMgr.ok === true, mkMgr.error);

  const mkSales = await userSvc.createUser({
    fullName: 'Nhân Viên Sales',
    phone: '0900000002',
    email: 'sales1@glb.test',
    username: 'salesuser1',
    password: 'Sales@1234',
    roleCodes: ['SALES']
  });
  assert('admin creates SALES user', mkSales.ok === true, mkSales.error);

  // duplicate username blocked
  const dup = await userSvc.createUser({
    fullName: 'Trùng',
    phone: '0900000003',
    email: 'dupe@glb.test',
    username: 'manager01',
    password: 'Dupe@1234',
    roleCodes: ['SALES']
  });
  assert('duplicate username blocked', dup.ok === false && dup.error === 'DUPLICATE');

  // invalid username blocked
  const badU = await userSvc.createUser({
    fullName: 'Sai',
    phone: '0900000004',
    email: 'bad@glb.test',
    username: 'kt-001',
    password: 'Good@1234',
    roleCodes: ['SALES']
  });
  assert('invalid username blocked', badU.ok === false && badU.error === 'VALIDATION');

  // R004: cannot delete the last admin (admin deletes self)
  const delSelf = await userSvc.deleteUser(adminUserId, ADMIN.p);
  assert('cannot delete last admin (R004)', delSelf.ok === false && delSelf.error === 'LAST_ADMIN');

  // R_ROLE_005: cannot delete MANAGER role (now has a user)
  const mgrRole = await db.role.findFirstOrThrow({ where: { code: 'MANAGER' } });
  const delMgrRole = await roleSvc.deleteRole(mgrRole.id, ADMIN.p);
  assert('cannot delete role-with-users (R_ROLE_005)', delMgrRole.ok === false && delMgrRole.error === 'ROLE_HAS_USERS', delMgrRole.error);

  // R_ROLE_006: cannot delete protected ADMIN role
  const adminRole = await db.role.findFirstOrThrow({ where: { code: 'ADMIN' } });
  const delAdminRole = await roleSvc.deleteRole(adminRole.id, ADMIN.p);
  assert('cannot delete ADMIN system role (R_ROLE_006)', delAdminRole.ok === false && delAdminRole.error === 'ROLE_IS_SYSTEM_ADMIN', delAdminRole.error);

  // wrong password blocks role delete of an empty custom role
  const custom = await roleSvc.createRole({ name: 'Tạm', code: 'TAMTHOI', permissionCodes: ['DASHBOARD_VIEW'] });
  assert('admin creates custom role', custom.ok === true, custom.error);
  const delWrongPw = await roleSvc.deleteRole(custom.id!, 'not-the-password');
  assert('role delete wrong password blocked (R_ROLE_009)', delWrongPw.ok === false && delWrongPw.error === 'WRONG_PASSWORD');
  const delOk = await roleSvc.deleteRole(custom.id!, ADMIN.p);
  assert('role delete correct password ok', delOk.ok === true, delOk.error);

  // backup create (R_BACKUP): file + checksum + audit
  const backup = await backupSvc.createBackup('selftest');
  assert('admin creates backup', backup.ok === true && !!backup.filePath, backup.error);
  const backupList = await backupSvc.listBackups();
  const hasChecksum = backupList.ok && (backupList.data ?? []).some((b) => b.checksum && b.checksum.length === 64 && b.exists);
  assert('backup has checksum + file exists', hasChecksum);

  // restore path (R_BACKUP_002 password, R_BACKUP_003 self-backup first)
  const backupFile = (backupList.data ?? [])[0]?.filePath ?? '';
  const restoreWrongPw = await backupSvc.restoreBackup(backupFile, 'wrong-password');
  assert('restore wrong password blocked (R_BACKUP_002)', restoreWrongPw.ok === false && restoreWrongPw.error === 'WRONG_PASSWORD');
  const backupsBeforeRestore = ((await backupSvc.listBackups()).data ?? []).length;
  const restoreOk = await backupSvc.restoreBackup(backupFile, ADMIN.p);
  assert('restore correct password ok', restoreOk.ok === true, restoreOk.error);
  const backupsAfterRestore = ((await backupSvc.listBackups()).data ?? []).length;
  assert('restore auto-created pre-restore backup (R_BACKUP_003)', backupsAfterRestore > backupsBeforeRestore, {
    backupsBeforeRestore,
    backupsAfterRestore
  });

  const auditBefore = await auditSvc.listAudit({ action: 'PERMISSION_DENIED', limit: 1000 });
  const deniedBefore = auditBefore.ok ? (auditBefore.data ?? []).length : -1;

  await logout();

  // --- as MANAGER --------------------------------------------------------
  const mgrLogin = await login('manager01', 'Manager@123');
  assert('manager login ok', mgrLogin.ok === true);

  // R_MANAGER_002: manager cannot create an ADMIN
  const mgrMakesAdmin = await userSvc.createUser({
    fullName: 'Kẻ Mạo Danh',
    phone: '0900000009',
    email: 'evil@glb.test',
    username: 'eviladmin1',
    password: 'Evil@1234',
    roleCodes: ['ADMIN']
  });
  assert('manager cannot create ADMIN (R_MANAGER_002)', mgrMakesAdmin.ok === false && mgrMakesAdmin.error === 'MANAGER_SCOPE', mgrMakesAdmin.error);

  // manager CAN create a normal-role user (USER_CREATE_LIMITED)
  const mgrMakesSupport = await userSvc.createUser({
    fullName: 'Hỗ Trợ Viên',
    phone: '0900000010',
    email: 'support1@glb.test',
    username: 'supportx01',
    password: 'Suppt@123',
    roleCodes: ['SUPPORT']
  });
  assert('manager creates limited user (R_MANAGER_001)', mgrMakesSupport.ok === true, mgrMakesSupport.error);

  // manager lacks ROLE_CREATE → FORBIDDEN + audit
  const mgrMakesRole = await roleSvc.createRole({ name: 'Lén', code: 'LENLUT', permissionCodes: [] });
  assert('manager cannot create role → FORBIDDEN (§13)', mgrMakesRole.ok === false && mgrMakesRole.error === 'FORBIDDEN', mgrMakesRole.error);

  await logout();

  // --- as SALES (no admin perms) ----------------------------------------
  const salesLogin = await login('salesuser1', 'Sales@1234');
  assert('sales login ok', salesLogin.ok === true);
  const salesLists = await userSvc.listUsers({});
  assert('sales cannot list users → FORBIDDEN', salesLists.ok === false && salesLists.error === 'FORBIDDEN', salesLists.error);
  await logout();

  // --- verify audit captured the permission denials (R_AUDIT_003) --------
  await login(ADMIN.u, ADMIN.p);
  const auditAfter = await auditSvc.listAudit({ action: 'PERMISSION_DENIED', limit: 1000 });
  const deniedAfter = auditAfter.ok ? (auditAfter.data ?? []).length : -1;
  assert('permission denials were audited (R_AUDIT_003)', deniedAfter > deniedBefore, { deniedBefore, deniedAfter });
  await logout();

  // eslint-disable-next-line no-console
  console.log(`SELFTEST2 SUMMARY | failures=${failures}`);
  return failures === 0 ? 0 : 1;
}
