// Phase B integration self-test (headless). Drives the REAL service layer against the live DB
// (run on a throwaway copy via GLB_DB_URL) to prove the enforceable rules end-to-end:
//   403 + audit on missing permission (R_AUDIT_003), manager cannot create admin (R_MANAGER_002),
//   delete role-with-users blocked (R_ROLE_005), delete protected ADMIN role blocked (R_ROLE_006),
//   last-admin delete blocked (R004), backup produces file + checksum + audit (R_BACKUP).
import { login, logout, validateCurrentSession } from './auth-service.js';
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
  // B20: pg_restore --clean ghi đè bảng backup_logs bằng rows CŨ của dump → dòng "auto pre-restore
  // snapshot" bị mất. restoreBackup PHẢI re-insert lại. Verify: (1) vẫn còn ≥1 backup tra cứu được
  // sau restore; (2) bản ghi mới nhất (id desc → phần tử [0]) ĐÚNG là pre-restore snapshot + file khớp.
  const afterList = (await backupSvc.listBackups()).data ?? [];
  const backupsAfterRestore = afterList.length;
  const preRestoreRow = afterList[0];
  assert(
    'restore preserves pre-restore snapshot log after pg_restore (R_BACKUP_003 / B20)',
    backupsAfterRestore >= 1 &&
      !!preRestoreRow &&
      preRestoreRow.note === 'auto pre-restore snapshot' &&
      preRestoreRow.exists === true,
    {
      backupsBeforeRestore,
      backupsAfterRestore,
      note: preRestoreRow?.note,
      exists: preRestoreRow?.exists,
      file: preRestoreRow?.fileName
    }
  );

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

  // ═══ REGRESSION Codex 15/7 — AUTH-02/06/03/01 (bypass status qua *:update + snapshot phiên cũ) ═══
  await login(ADMIN.u, ADMIN.p);
  // AUTH-02: actor CHỈ có USER_UPDATE (thiếu USER_LOCK) không được khóa/vô-hiệu qua updateUser.
  await roleSvc.createRole({ name: 'Chỉ sửa user', code: 'ONLYUSRUPD', permissionCodes: ['USER_READ', 'USER_UPDATE'] });
  await userSvc.createUser({ fullName: 'NV Sua User', username: 'usrupd01xx', password: 'Passw0rd@1', roleCodes: ['ONLYUSRUPD'] });
  const victim = await userSvc.createUser({ fullName: 'Nan Nhan', username: 'victim01xx', password: 'Passw0rd@1', roleCodes: ['SALES'] });
  // AUTH-06: actor CHỈ có ROLE_UPDATE (thiếu ROLE_LOCK) không được khóa role qua updateRole.
  await roleSvc.createRole({ name: 'Chỉ sửa role', code: 'ONLYROLEUPD', permissionCodes: ['ROLE_READ', 'ROLE_UPDATE'] });
  await userSvc.createUser({ fullName: 'NV Sua Role', username: 'rlupd001xx', password: 'Passw0rd@1', roleCodes: ['ONLYROLEUPD'] });
  const tgtRole = await roleSvc.createRole({ name: 'Muc tieu', code: 'TARGETROLE', permissionCodes: ['DASHBOARD_VIEW'] });
  // AUTH-03/01: user phiên-sống bị DISABLE / bị khóa role → mất phiên/quyền NGAY.
  const sessU = await userSvc.createUser({ fullName: 'Phien Test', username: 'sess0001xx', password: 'Passw0rd@1', roleCodes: ['SALES'] });
  await roleSvc.createRole({ name: 'Role Live', code: 'LIVEROLE', permissionCodes: ['DASHBOARD_VIEW', 'USER_READ'] });
  await userSvc.createUser({ fullName: 'Live User', username: 'live0001xx', password: 'Passw0rd@1', roleCodes: ['LIVEROLE'] });
  await logout();

  await login('usrupd01xx', 'Passw0rd@1');
  const a2lock = await userSvc.updateUser(victim.id!, { status: 'LOCKED' });
  assert('AUTH-02: USER_UPDATE thiếu USER_LOCK → KHÔNG khóa được qua update (FORBIDDEN)', a2lock.ok === false && a2lock.error === 'FORBIDDEN', a2lock);
  const a2ok = await userSvc.updateUser(victim.id!, { fullName: 'Doi Ten OK' });
  assert('AUTH-02: sửa trường thường (không đụng status) vẫn OK', a2ok.ok === true, a2ok);
  await logout();

  await login('rlupd001xx', 'Passw0rd@1');
  const a6 = await roleSvc.updateRole(tgtRole.id!, { name: 'Muc tieu', code: 'TARGETROLE', status: 'LOCKED', permissionCodes: ['DASHBOARD_VIEW'] });
  assert('AUTH-06: ROLE_UPDATE thiếu ROLE_LOCK → KHÔNG khóa role qua update (FORBIDDEN)', a6.ok === false && a6.error === 'FORBIDDEN', a6);
  await logout();

  await login('sess0001xx', 'Passw0rd@1');
  await db.user.update({ where: { id: sessU.id! }, data: { status: 'DISABLED' } });
  const a3 = await validateCurrentSession();
  assert('AUTH-03: phiên user DISABLED bị revoke NGAY (validateCurrentSession=null)', a3 === null, a3);
  await logout();

  await login('live0001xx', 'Passw0rd@1');
  const liveBefore = await validateCurrentSession();
  const hadRead = liveBefore?.user.permissions.includes('USER_READ') ?? false;
  await db.role.update({ where: { code: 'LIVEROLE' }, data: { status: 'LOCKED' } });
  const liveAfter = await validateCurrentSession();
  assert('AUTH-01: khóa role → phiên đang sống MẤT quyền ngay (rebuild snapshot, không còn USER_READ)',
    hadRead && liveAfter !== null && !liveAfter.user.permissions.includes('USER_READ'), { hadRead, after: liveAfter?.user.permissions });
  await logout();
  await login(ADMIN.u, ADMIN.p); // trả về admin cho phần audit-summary phía dưới nếu có
  await logout();

  // eslint-disable-next-line no-console
  console.log(`SELFTEST2 SUMMARY | failures=${failures}`);
  return failures === 0 ? 0 : 1;
}
