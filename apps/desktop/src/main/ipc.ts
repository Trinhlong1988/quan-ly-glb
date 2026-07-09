// IPC registration (main). Renderer never touches the DB — all DB work lives behind these handlers.
import { ipcMain } from 'electron';
import { validatePassword } from '@glb/shared';
import * as auth from './auth-service.js';
import * as roleSvc from './role-service.js';
import * as userSvc from './user-service.js';
import * as auditSvc from './audit-service.js';
import * as backupSvc from './backup-service.js';
import * as settingSvc from './settings-service.js';
import * as customerSvc from './customer-service.js';
import * as posSvc from './pos-service.js';
import * as tidSvc from './tid-service.js';
import * as notifySvc from './notification-service.js';
import * as bankCfgSvc from './bank-config-service.js';
import * as trashSvc from './trash-service.js';
import { getRemembered, saveRemembered, clearRemembered } from './remember.js';

export function registerIpc(): void {
  // ---- Auth (Phase A) ----------------------------------------------------
  ipcMain.handle('auth:login', async (_e, args: { username: string; password: string; remember?: boolean }) => {
    const { username, password, remember } = args ?? ({} as never);
    const result = await auth.login(username, password);
    if (result.ok) {
      if (remember) saveRemembered(username, password);
      else clearRemembered();
    }
    return result;
  });
  ipcMain.handle('auth:me', async () => auth.me());
  ipcMain.handle('auth:logout', async () => {
    await auth.logout();
    return { ok: true };
  });
  ipcMain.handle('auth:changePassword', async (_e, args: { currentPassword: string; newPassword: string }) => {
    const { currentPassword, newPassword } = args ?? ({} as never);
    return auth.changePassword(currentPassword, newPassword);
  });
  ipcMain.handle('auth:validatePassword', async (_e, pwd: string) => validatePassword(pwd));
  ipcMain.handle('auth:getRemembered', async () => getRemembered());
  ipcMain.handle('auth:saveRemembered', async (_e, args: { username: string; password: string }) => {
    saveRemembered(args.username, args.password);
    return { ok: true };
  });
  ipcMain.handle('auth:clearRemembered', async () => {
    clearRemembered();
    return { ok: true };
  });

  // ---- Roles (Phase B, §8) ----------------------------------------------
  ipcMain.handle('role:list', async () => roleSvc.listRoles());
  ipcMain.handle('role:permissions', async () => roleSvc.listPermissions());
  ipcMain.handle('role:create', async (_e, input: roleSvc.RoleInput) => roleSvc.createRole(input));
  ipcMain.handle('role:update', async (_e, args: { id: number; input: roleSvc.RoleInput }) =>
    roleSvc.updateRole(args.id, args.input)
  );
  ipcMain.handle('role:lock', async (_e, id: number) => roleSvc.lockRole(id));
  ipcMain.handle('role:unlock', async (_e, id: number) => roleSvc.unlockRole(id));
  ipcMain.handle('role:delete', async (_e, args: { id: number; password: string }) =>
    roleSvc.deleteRole(args.id, args.password)
  );

  // ---- Users (Phase B, §9/§11/§12) --------------------------------------
  ipcMain.handle('user:list', async (_e, filter: userSvc.UserFilter) => userSvc.listUsers(filter));
  ipcMain.handle('user:create', async (_e, input: userSvc.CreateUserInput) => userSvc.createUser(input));
  ipcMain.handle('user:update', async (_e, args: { id: number; input: userSvc.UpdateUserInput }) =>
    userSvc.updateUser(args.id, args.input)
  );
  ipcMain.handle('user:lock', async (_e, id: number) => userSvc.lockUser(id));
  ipcMain.handle('user:unlock', async (_e, id: number) => userSvc.unlockUser(id));
  ipcMain.handle('user:delete', async (_e, args: { id: number; password: string }) =>
    userSvc.deleteUser(args.id, args.password)
  );

  // ---- Audit (Phase B, §16) ---------------------------------------------
  ipcMain.handle('audit:list', async (_e, query: auditSvc.AuditQuery) => auditSvc.listAudit(query));

  // ---- Backup / Restore (Phase B, §17) ----------------------------------
  ipcMain.handle('backup:create', async (_e, note?: string) => backupSvc.createBackup(note));
  ipcMain.handle('backup:list', async () => backupSvc.listBackups());
  ipcMain.handle('backup:restore', async (_e, args: { filePath: string; password: string }) =>
    backupSvc.restoreBackup(args.filePath, args.password)
  );

  // ---- Settings (Phase B) ------------------------------------------------
  ipcMain.handle('setting:list', async () => settingSvc.listSettings());
  ipcMain.handle('setting:update', async (_e, args: { key: string; value: string }) =>
    settingSvc.updateSetting(args.key, args.value)
  );

  // ---- Customers (G-POS.1 §A/§D) ----------------------------------------
  ipcMain.handle('customer:list', async (_e, filter: customerSvc.CustomerFilter) => customerSvc.listCustomers(filter));
  ipcMain.handle('customer:create', async (_e, input: customerSvc.CreateCustomerInput) => customerSvc.createCustomer(input));
  ipcMain.handle('customer:update', async (_e, args: { id: number; input: customerSvc.UpdateCustomerInput }) =>
    customerSvc.updateCustomer(args.id, args.input)
  );
  ipcMain.handle('customer:delete', async (_e, args: { id: number; password: string }) =>
    customerSvc.deleteCustomer(args.id, args.password)
  );
  ipcMain.handle('agent:list', async () => customerSvc.listAgents());

  // ---- POS devices (G-POS.1 §A) -----------------------------------------
  ipcMain.handle('pos:list', async (_e, filter: posSvc.PosFilter) => posSvc.listPosDevices(filter));
  ipcMain.handle('pos:timeline', async (_e, serial: string) => posSvc.getDeviceTimeline(serial));
  ipcMain.handle('pos:create', async (_e, input: posSvc.CreatePosInput) => posSvc.createPos(input));
  ipcMain.handle('pos:deploy', async (_e, args: { serial: string; input: posSvc.TransitionInput }) => posSvc.deployPos(args.serial, args.input));
  ipcMain.handle('pos:recall', async (_e, args: { serial: string; input: posSvc.TransitionInput }) => posSvc.recallPos(args.serial, args.input));
  ipcMain.handle('pos:transferAgent', async (_e, args: { serial: string; input: posSvc.TransitionInput }) => posSvc.transferPosAgent(args.serial, args.input));
  ipcMain.handle('pos:reportDamage', async (_e, args: { serial: string; input: posSvc.TransitionInput }) => posSvc.reportPosDamage(args.serial, args.input));
  ipcMain.handle('pos:sendRepair', async (_e, args: { serial: string; input: posSvc.TransitionInput }) => posSvc.sendPosRepair(args.serial, args.input));
  ipcMain.handle('pos:receiveRepaired', async (_e, args: { serial: string; input: posSvc.TransitionInput }) => posSvc.receivePosRepaired(args.serial, args.input));
  ipcMain.handle('pos:retire', async (_e, args: { serial: string; password: string; input: posSvc.TransitionInput }) => posSvc.retirePos(args.serial, args.password, args.input));

  // ---- TIDs (G-POS.1 §A) ------------------------------------------------
  ipcMain.handle('tid:list', async (_e, filter: tidSvc.TidFilter) => tidSvc.listTids(filter));
  ipcMain.handle('tid:undelivered', async () => tidSvc.listUndeliveredTids());
  ipcMain.handle('tid:create', async (_e, input: tidSvc.CreateTidInput) => tidSvc.createTid(input));
  ipcMain.handle('tid:assign', async (_e, args: { tid: string; input: tidSvc.AssignTidInput }) => tidSvc.assignTid(args.tid, args.input));
  ipcMain.handle('tid:replace', async (_e, args: { tid: string; input: tidSvc.ReplaceTidInput }) => tidSvc.replaceTid(args.tid, args.input));
  ipcMain.handle('tid:recall', async (_e, args: { tid: string; input: tidSvc.RecallTidInput }) => tidSvc.recallTid(args.tid, args.input));
  ipcMain.handle('tid:markDelivered', async (_e, args: { tid: string; input: tidSvc.MarkDeliveredInput }) => tidSvc.markTidDelivered(args.tid, args.input));

  // ---- Notifications (undelivered TID — badge REAL, push STUB) -----------
  ipcMain.handle('notify:undeliveredSummary', async () => notifySvc.getUndeliveredSummary());
  ipcMain.handle('notify:pushUndelivered', async () => notifySvc.pushUndeliveredZalo());

  // ---- Cấu hình ngân hàng (G-CFG.1 §C1–C4) ------------------------------
  ipcMain.handle('bank:list', async (_e, filter: bankCfgSvc.BankFilter) => bankCfgSvc.listBanks(filter));
  ipcMain.handle('bank:lite', async () => bankCfgSvc.listBanksLite());
  ipcMain.handle('bank:create', async (_e, input: bankCfgSvc.CreateBankInput) => bankCfgSvc.createBank(input));
  ipcMain.handle('bank:update', async (_e, args: { id: number; input: bankCfgSvc.UpdateBankInput }) => bankCfgSvc.updateBank(args.id, args.input));
  ipcMain.handle('bank:delete', async (_e, args: { ids: number[]; password: string }) => bankCfgSvc.deleteBanks(args.ids, args.password));

  ipcMain.handle('cardType:list', async (_e, filter: bankCfgSvc.CardTypeFilter) => bankCfgSvc.listCardTypes(filter));
  ipcMain.handle('cardType:create', async (_e, input: bankCfgSvc.CreateCardTypeInput) => bankCfgSvc.createCardType(input));
  ipcMain.handle('cardType:update', async (_e, args: { id: number; input: bankCfgSvc.UpdateCardTypeInput }) => bankCfgSvc.updateCardType(args.id, args.input));
  ipcMain.handle('cardType:delete', async (_e, args: { ids: number[]; password: string }) => bankCfgSvc.deleteCardTypes(args.ids, args.password));

  ipcMain.handle('partner:list', async (_e, filter: bankCfgSvc.PartnerFilter) => bankCfgSvc.listPartners(filter));
  ipcMain.handle('partner:create', async (_e, input: bankCfgSvc.CreatePartnerInput) => bankCfgSvc.createPartner(input));
  ipcMain.handle('partner:update', async (_e, args: { id: number; input: bankCfgSvc.UpdatePartnerInput }) => bankCfgSvc.updatePartner(args.id, args.input));
  ipcMain.handle('partner:delete', async (_e, args: { ids: number[]; password: string }) => bankCfgSvc.deletePartners(args.ids, args.password));
  ipcMain.handle('partnerBank:matrix', async () => bankCfgSvc.getPartnerBankMatrix());
  ipcMain.handle('partnerBank:set', async (_e, args: { partnerId: number; bankIds: number[] }) => bankCfgSvc.setPartnerBanks(args.partnerId, args.bankIds));

  // ── E4 Thùng rác ──
  ipcMain.handle('trash:list', async () => trashSvc.listTrash());
  ipcMain.handle('trash:restore', async (_e, args: { entityType: string; id: number }) => trashSvc.restoreItem(args.entityType, args.id));
  ipcMain.handle('trash:linkSummary', async (_e, args: { entityType: string; id: number }) => trashSvc.linkSummary(args.entityType, args.id));
}
