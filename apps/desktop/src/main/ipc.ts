// IPC registration (main). Renderer never touches the DB — all DB work lives behind these handlers.
import { ipcMain, dialog, BrowserWindow } from 'electron';
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
import * as posSupplySvc from './pos-supply-service.js';
import * as feeCfgSvc from './fee-config-service.js';
import * as rcvAcctSvc from './receive-account-service.js';
import * as dossierSvc from './dossier-service.js';
import * as tidCfgSvc from './tid-config-service.js';
import * as industryCfgSvc from './industry-service.js';
import * as cashCatSvc from './cash-category-service.js';
import * as fundSvc from './fund-service.js';
import * as cashEntrySvc from './cash-entry-service.js';
import { readAttachmentDataUrl } from './file-store.js';
import * as trashSvc from './trash-service.js';
import * as msgSvc from './message-service.js';
import * as dashboardSvc from './dashboard-service.js';
import * as txnSvc from './transaction-service.js';
import * as approvalSvc from './approval-service.js';
import * as storageSvc from './storage-service.js';
import * as healthSvc from './health-scan.js';
import { getRemembered, saveRemembered, clearRemembered } from './remember.js';
import { getServerConfig, testServerConfig, saveServerConfig } from './db.js';
import type { ServerConfigInput } from '@glb/shared';

export function registerIpc(): void {
  // ---- Cấu hình máy chủ (G10.3 — client first-run) ----------------------
  ipcMain.handle('serverConfig:get', async () => getServerConfig());
  ipcMain.handle('serverConfig:test', async (_e, input: ServerConfigInput) => testServerConfig(input ?? {}));
  ipcMain.handle('serverConfig:save', async (_e, input: ServerConfigInput) => saveServerConfig(input ?? {}));

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
  ipcMain.handle('auth:changePassword', async (_e, args: { currentPassword: string; newPassword: string; confirmPassword?: string }) => {
    const { currentPassword, newPassword, confirmPassword } = args ?? ({} as never);
    return auth.changePassword(currentPassword, newPassword, confirmPassword);
  });
  ipcMain.handle('auth:adminResetPassword', async (_e, args: { userId: number; newPassword: string; actorPassword: string }) => {
    const { userId, newPassword, actorPassword } = args ?? ({} as never);
    return auth.adminResetPassword(userId, newPassword, actorPassword);
  });
  ipcMain.handle('auth:level2Status', async () => auth.getLevel2Status());
  ipcMain.handle('auth:setLevel2', async (_e, args: { level1: string; newLevel2: string; confirmLevel2: string }) => {
    const { level1, newLevel2, confirmLevel2 } = args ?? ({} as never);
    return auth.setLevel2Password(level1, newLevel2, confirmLevel2);
  });
  ipcMain.handle('auth:resetLevel2', async (_e, args: { level1: string; oldLevel2: string; newLevel2: string; confirmLevel2: string }) => {
    const { level1, oldLevel2, newLevel2, confirmLevel2 } = args ?? ({} as never);
    return auth.resetLevel2Password(level1, oldLevel2, newLevel2, confirmLevel2);
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
  // Xóa hàng loạt nhân sự (P1.2 §5) — xác thực mật khẩu 1 lần, lặp guard, skip kèm lý do.
  ipcMain.handle('user:deleteMany', async (_e, args: { ids: number[]; password: string }) =>
    userSvc.deleteUsers(args.ids, args.password)
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

  // ---- Dashboard (Nhóm B — KPI realtime + tăng trưởng) ------------------
  ipcMain.handle('dashboard:stats', async () => dashboardSvc.getStats());
  ipcMain.handle('dashboard:profit', async () => dashboardSvc.getMonthlyProfit());

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

  // ── G-CFG.2 Cấu hình cung ứng POS (§C6–C8) ──
  ipcMain.handle('supplier:list', async (_e, filter: posSupplySvc.SupplierFilter) => posSupplySvc.listSuppliers(filter));
  ipcMain.handle('supplier:lite', async () => posSupplySvc.listSuppliersLite());
  ipcMain.handle('supplier:create', async (_e, input: posSupplySvc.CreateSupplierInput) => posSupplySvc.createSupplier(input));
  ipcMain.handle('supplier:update', async (_e, args: { id: number; input: posSupplySvc.UpdateSupplierInput }) => posSupplySvc.updateSupplier(args.id, args.input));
  ipcMain.handle('supplier:delete', async (_e, args: { ids: number[]; password: string }) => posSupplySvc.deleteSuppliers(args.ids, args.password));

  ipcMain.handle('posModel:list', async (_e, filter: posSupplySvc.PosModelFilter) => posSupplySvc.listPosModels(filter));
  ipcMain.handle('posModel:lite', async () => posSupplySvc.listPosModelsLite());
  ipcMain.handle('posModel:create', async (_e, input: posSupplySvc.CreatePosModelInput) => posSupplySvc.createPosModel(input));
  ipcMain.handle('posModel:update', async (_e, args: { id: number; input: posSupplySvc.UpdatePosModelInput }) => posSupplySvc.updatePosModel(args.id, args.input));
  ipcMain.handle('posModel:delete', async (_e, args: { ids: number[]; password: string }) => posSupplySvc.deletePosModels(args.ids, args.password));

  ipcMain.handle('intakeStatus:list', async () => posSupplySvc.listIntakeStatuses());
  ipcMain.handle('intakeStatus:create', async (_e, input: posSupplySvc.CreateIntakeStatusInput) => posSupplySvc.createIntakeStatus(input));
  ipcMain.handle('intakeStatus:update', async (_e, args: { id: number; input: posSupplySvc.UpdateIntakeStatusInput }) => posSupplySvc.updateIntakeStatus(args.id, args.input));
  ipcMain.handle('intakeStatus:delete', async (_e, args: { ids: number[]; password: string }) => posSupplySvc.deleteIntakeStatuses(args.ids, args.password));

  ipcMain.handle('posIntake:list', async (_e, filter: posSupplySvc.PosIntakeFilter) => posSupplySvc.listPosIntakes(filter));
  ipcMain.handle('posIntake:create', async (_e, input: posSupplySvc.CreatePosIntakeInput) => posSupplySvc.createPosIntake(input));
  ipcMain.handle('posIntake:update', async (_e, args: { id: number; input: posSupplySvc.UpdatePosIntakeInput }) => posSupplySvc.updatePosIntake(args.id, args.input));
  ipcMain.handle('posIntake:delete', async (_e, args: { ids: number[]; password: string }) => posSupplySvc.deletePosIntakes(args.ids, args.password));

  // ── G-CFG.3 Cấu hình phí (§C5) ──
  ipcMain.handle('feeType:list', async () => feeCfgSvc.listFeeTypes());
  ipcMain.handle('feeType:create', async (_e, input: feeCfgSvc.CreateFeeTypeInput) => feeCfgSvc.createFeeType(input));
  ipcMain.handle('feeType:update', async (_e, args: { id: number; input: feeCfgSvc.UpdateFeeTypeInput }) => feeCfgSvc.updateFeeType(args.id, args.input));
  ipcMain.handle('feeType:delete', async (_e, args: { ids: number[]; password: string }) => feeCfgSvc.deleteFeeTypes(args.ids, args.password));

  ipcMain.handle('feeRate:list', async (_e, filter: feeCfgSvc.FeeRateFilter) => feeCfgSvc.listFeeRates(filter));
  ipcMain.handle('feeRate:set', async (_e, input: feeCfgSvc.SetFeeRateInput) => feeCfgSvc.setFeeRate(input));
  ipcMain.handle('feeRate:delete', async (_e, args: { ids: number[]; password: string }) => feeCfgSvc.deleteFeeRates(args.ids, args.password));

  // ── G-CFG.4 Tài khoản nhận tiền – ủy quyền (§8) ──
  ipcMain.handle('rcvSource:list', async () => rcvAcctSvc.listSources());
  ipcMain.handle('rcvSource:create', async (_e, input: rcvAcctSvc.CreateRcvSourceInput) => rcvAcctSvc.createSource(input));
  ipcMain.handle('rcvSource:update', async (_e, args: { id: number; input: rcvAcctSvc.UpdateRcvSourceInput }) => rcvAcctSvc.updateSource(args.id, args.input));
  ipcMain.handle('rcvSource:delete', async (_e, args: { ids: number[]; password: string }) => rcvAcctSvc.deleteSources(args.ids, args.password));

  ipcMain.handle('rcvAccount:list', async (_e, filter: rcvAcctSvc.RcvAccountFilter) => rcvAcctSvc.listAccounts(filter));
  ipcMain.handle('rcvAccount:create', async (_e, input: rcvAcctSvc.RcvAccountInput) => rcvAcctSvc.createAccount(input));
  ipcMain.handle('rcvAccount:update', async (_e, args: { id: number; input: rcvAcctSvc.RcvAccountInput }) => rcvAcctSvc.updateAccount(args.id, args.input));
  ipcMain.handle('rcvAccount:delete', async (_e, args: { ids: number[]; password: string }) => rcvAcctSvc.deleteAccounts(args.ids, args.password));

  // Chọn ảnh (PNG/JPG/PDF) qua hộp thoại hệ điều hành → trả đường dẫn tuyệt đối.
  ipcMain.handle('file:pickImage', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Ảnh/PDF', extensions: ['png', 'jpg', 'jpeg', 'pdf'] }] })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Ảnh/PDF', extensions: ['png', 'jpg', 'jpeg', 'pdf'] }] });
    if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true };
    return { ok: true, path: res.filePaths[0] };
  });
  ipcMain.handle('file:read', async (_e, relPath: string) => readAttachmentDataUrl(relPath));

  // ── G-CFG.5 (§10) Quản lý Hồ sơ HKD ──
  ipcMain.handle('dossierSource:list', async () => dossierSvc.listSources());
  ipcMain.handle('dossierSource:create', async (_e, input: dossierSvc.CreateDossierSourceInput) => dossierSvc.createSource(input));
  ipcMain.handle('dossierSource:update', async (_e, args: { id: number; input: dossierSvc.UpdateDossierSourceInput }) => dossierSvc.updateSource(args.id, args.input));
  ipcMain.handle('dossierSource:delete', async (_e, args: { ids: number[]; password: string }) => dossierSvc.deleteSources(args.ids, args.password));

  ipcMain.handle('dossier:list', async (_e, filter: dossierSvc.DossierFilter) => dossierSvc.listDossiers(filter));
  ipcMain.handle('dossier:create', async (_e, input: dossierSvc.DossierInput) => dossierSvc.createDossier(input));
  ipcMain.handle('dossier:update', async (_e, args: { id: number; input: dossierSvc.DossierInput }) => dossierSvc.updateDossier(args.id, args.input));
  ipcMain.handle('dossier:delete', async (_e, args: { ids: number[]; password: string }) => dossierSvc.deleteDossiers(args.ids, args.password));

  // ── G-CFG.6 (§9) Cấu hình TID ──
  ipcMain.handle('tidStatus:list', async () => tidCfgSvc.listStatuses());
  ipcMain.handle('tidStatus:create', async (_e, input: tidCfgSvc.CreateTidConfigStatusInput) => tidCfgSvc.createStatus(input));
  ipcMain.handle('tidStatus:update', async (_e, args: { id: number; input: tidCfgSvc.UpdateTidConfigStatusInput }) => tidCfgSvc.updateStatus(args.id, args.input));
  ipcMain.handle('tidStatus:delete', async (_e, args: { ids: number[]; password: string }) => tidCfgSvc.deleteStatuses(args.ids, args.password));

  ipcMain.handle('tidConfig:list', async (_e, filter: tidCfgSvc.ConfigTidFilter) => tidCfgSvc.listConfigTids(filter));
  ipcMain.handle('tidConfig:create', async (_e, input: tidCfgSvc.ConfigTidInput) => tidCfgSvc.createConfigTid(input));
  ipcMain.handle('tidConfig:update', async (_e, args: { id: number; input: tidCfgSvc.ConfigTidInput }) => tidCfgSvc.updateConfigTid(args.id, args.input));
  ipcMain.handle('tidConfig:delete', async (_e, args: { ids: number[]; password: string }) => tidCfgSvc.deleteConfigTids(args.ids, args.password));

  // ── G-CFG.7 (§11 Pha I1) Cấu hình ngành nghề (master) ──
  ipcMain.handle('industry:list', async (_e, filter: industryCfgSvc.IndustryFilter) => industryCfgSvc.listIndustries(filter));
  ipcMain.handle('industry:create', async (_e, input: industryCfgSvc.CreateIndustryInput) => industryCfgSvc.createIndustry(input));
  ipcMain.handle('industry:update', async (_e, args: { id: number; input: industryCfgSvc.UpdateIndustryInput }) => industryCfgSvc.updateIndustry(args.id, args.input));
  ipcMain.handle('industry:delete', async (_e, args: { ids: number[]; password: string }) => industryCfgSvc.deleteIndustries(args.ids, args.password));

  // ── PHASE H1 — Thu–Chi: danh mục thu/chi ──
  ipcMain.handle('cashCategory:list', async (_e, filter: cashCatSvc.CashCategoryFilter) => cashCatSvc.listCashCategories(filter));
  ipcMain.handle('cashCategory:create', async (_e, input: cashCatSvc.CreateCashCategoryInput) => cashCatSvc.createCashCategory(input));
  ipcMain.handle('cashCategory:update', async (_e, args: { id: number; input: cashCatSvc.UpdateCashCategoryInput }) => cashCatSvc.updateCashCategory(args.id, args.input));
  ipcMain.handle('cashCategory:remove', async (_e, args: { ids: number[]; password: string }) => cashCatSvc.deleteCashCategories(args.ids, args.password));

  // ── PHASE H2-core — Thu–Chi: Quỹ (Fund) ──
  ipcMain.handle('fund:list', async (_e, filter: fundSvc.FundFilter) => fundSvc.listFunds(filter));
  ipcMain.handle('fund:userLite', async () => fundSvc.listCashflowUsersLite());
  ipcMain.handle('fund:create', async (_e, input: fundSvc.CreateFundInput) => fundSvc.createFund(input));
  ipcMain.handle('fund:update', async (_e, args: { id: number; input: fundSvc.UpdateFundInput }) => fundSvc.updateFund(args.id, args.input));
  ipcMain.handle('fund:remove', async (_e, args: { ids: number[]; password: string }) => fundSvc.deleteFunds(args.ids, args.password));

  // ── PHASE H2-core — Thu–Chi: Phiếu thu/chi (CashEntry) + báo cáo dòng tiền ──
  ipcMain.handle('cashEntry:list', async (_e, filter: cashEntrySvc.CashEntryFilter) => cashEntrySvc.listCashEntries(filter));
  ipcMain.handle('cashEntry:report', async (_e, filter: cashEntrySvc.CashEntryFilter) => cashEntrySvc.cashflowReport(filter));
  ipcMain.handle('cashEntry:categoryLite', async () => cashEntrySvc.listEntryCategoriesLite());
  ipcMain.handle('cashEntry:create', async (_e, input: cashEntrySvc.CreateCashEntryInput) => cashEntrySvc.createCashEntry(input));
  ipcMain.handle('cashEntry:createDebtReceipt', async (_e, input: cashEntrySvc.CreateDebtReceiptInput) => cashEntrySvc.createDebtReceipt(input));
  ipcMain.handle('cashEntry:cancel', async (_e, args: { id: number; reason: string; password: string }) => cashEntrySvc.cancelCashEntry(args.id, args.reason, args.password));

  // ── E4 Thùng rác ──
  ipcMain.handle('trash:list', async () => trashSvc.listTrash());
  ipcMain.handle('trash:restore', async (_e, args: { entityType: string; id: number }) => trashSvc.restoreItem(args.entityType, args.id));
  ipcMain.handle('trash:linkSummary', async (_e, args: { entityType: string; id: number }) => trashSvc.linkSummary(args.entityType, args.id));
  ipcMain.handle('trash:purge', async (_e, args: { entityType: string; id: number; password: string }) => trashSvc.purgeItem(args.entityType, args.id, args.password));
  ipcMain.handle('trash:emptyAll', async (_e, args: { level2Password: string }) => trashSvc.emptyTrash(args.level2Password));

  // ── Hòm thư nội bộ + thông báo bảo mật (Nhóm A #2 / Nhóm C #7) ──
  ipcMain.handle('message:inbox', async () => msgSvc.listInbox());
  ipcMain.handle('message:unreadCount', async () => msgSvc.unreadCount());
  ipcMain.handle('message:markRead', async (_e, id: number) => msgSvc.markRead(id));
  ipcMain.handle('message:markAllRead', async () => msgSvc.markAllRead());
  ipcMain.handle('message:send', async (_e, input: { recipientId: number; subject: string; body: string }) => msgSvc.sendMessage(input));

  // ── Nhóm B — Doanh thu & Công nợ ──
  ipcMain.handle('transaction:list', async (_e, filter: txnSvc.TransactionFilter) => txnSvc.listTransactions(filter));
  ipcMain.handle('transaction:create', async (_e, input: txnSvc.CreateTransactionInput) => txnSvc.createTransaction(input));
  ipcMain.handle('transaction:update', async (_e, args: { id: number; input: txnSvc.UpdateTransactionInput }) => txnSvc.updateTransaction(args.id, args.input));
  ipcMain.handle('transaction:delete', async (_e, args: { ids: number[]; password: string }) => txnSvc.deleteTransactions(args.ids, args.password));
  // H5 — GỠ handler 'transaction:settle' (toggle settled thủ công vô hiệu hóa). settled chỉ đổi qua
  //       phiếu Thu công nợ (cashEntry:createDebtReceipt) / hủy phiếu thu.
  ipcMain.handle('debt:summary', async (_e, filter: txnSvc.TransactionFilter) => txnSvc.debtSummary(filter));
  ipcMain.handle('debt:openTransactions', async (_e, filter: txnSvc.TransactionFilter) => txnSvc.debtOpenTransactions(filter));
  // H2b — phân loại chất lượng công nợ + ghi giảm nợ xấu.
  ipcMain.handle('debt:byQuality', async (_e, filter: txnSvc.TransactionFilter) => txnSvc.debtByQuality(filter));
  ipcMain.handle('debt:classify', async (_e, args: { transactionId: number; quality: string; reason?: string }) => txnSvc.classifyDebt(args.transactionId, args.quality, args.reason));
  ipcMain.handle('debt:qualityHistory', async (_e, transactionId: number) => txnSvc.debtQualityHistory(transactionId));
  ipcMain.handle('debt:writeOff', async (_e, args: { transactionId: number; actorPassword: string }) => txnSvc.writeOffBadDebt(args.transactionId, args.actorPassword));

  // ── P1.2 Approval Engine — hủy bill có duyệt (phân vai trong service) ──
  ipcMain.handle('approval:requestCancel', async (_e, args: { transactionId: number; reason: string }) => approvalSvc.requestCancelBill(args.transactionId, args.reason));
  ipcMain.handle('approval:list', async (_e, status?: string) => approvalSvc.listCancelRequests(status));
  ipcMain.handle('approval:approve', async (_e, args: { requestId: number; note?: string }) => approvalSvc.approveCancelBill(args.requestId, args.note));
  ipcMain.handle('approval:reject', async (_e, args: { requestId: number; note: string }) => approvalSvc.rejectCancelBill(args.requestId, args.note));
  ipcMain.handle('approval:approveBulk', async (_e, args: { requestIds: number[]; note?: string }) => approvalSvc.approveCancelBills(args.requestIds, args.note));
  ipcMain.handle('approval:rejectBulk', async (_e, args: { requestIds: number[]; note: string }) => approvalSvc.rejectCancelBills(args.requestIds, args.note));

  // ── Nhóm E — Bảo trì & Bộ nhớ (Storage-Guard) ──
  ipcMain.handle('storage:status', async () => storageSvc.getStorageStatus());
  ipcMain.handle('storage:cleanup', async (_e, opts: storageSvc.CleanupOptions) => storageSvc.runCleanup(opts));
  ipcMain.handle('storage:updateConfig', async (_e, cfg: Parameters<typeof storageSvc.updateStorageConfig>[0]) => storageSvc.updateStorageConfig(cfg));

  // ── Bảo trì: quét sức khỏe toàn hệ thống + lịch sử ──
  ipcMain.handle('health:scan', async (_e, opts: { autoFix?: boolean }) => healthSvc.runScan(opts ?? {}));
  ipcMain.handle('health:runs', async (_e, limit?: number) => healthSvc.listRuns(limit));
  ipcMain.handle('health:run', async (_e, id: number) => healthSvc.getRun(id));
}
