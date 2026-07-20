// IPC registration (main). Renderer never touches the DB — all DB work lives behind these handlers.
import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { validatePassword } from '@glb/shared';
import * as auth from './auth-service.js';
import { realtimeTokens } from './realtime-service.js';
import * as roleSvc from './role-service.js';
import * as userSvc from './user-service.js';
import * as auditSvc from './audit-service.js';
import * as backupSvc from './backup-service.js';
import * as settingSvc from './settings-service.js';
import * as customerSvc from './customer-service.js';
import { globalSearch } from './global-search-service.js';
import { captureRegion, openScreenshotDir } from './screenshot-service.js';
import * as posSvc from './pos-service.js';
import * as tidSvc from './tid-service.js';
import * as notifySvc from './notification-service.js';
import * as bankCfgSvc from './bank-config-service.js';
import * as whSvc from './warehouse-service.js';
import * as saleSvc from './device-sale-service.js';
import * as statusSvc from './status-catalog-service.js';
import * as posSupplySvc from './pos-supply-service.js';
import * as feeCfgSvc from './fee-config-service.js';
import * as handoverSvc from './handover-service.js';
import * as depositSvc from './deposit-service.js';
import * as rcvAcctSvc from './receive-account-service.js';
import * as dossierSvc from './dossier-service.js';
import * as tidCfgSvc from './tid-config-service.js';
import * as tidSellFeeSvc from './tid-sell-fee-service.js';
import * as industryCfgSvc from './industry-service.js';
import * as billExplainSvc from './bill-explain-service.js';
import * as cashCatSvc from './cash-category-service.js';
import * as fundSvc from './fund-service.js';
import * as cashEntrySvc from './cash-entry-service.js';
import * as importSvc from './import-service.js';
import * as exportSvc from './export-service.js';
import { readAttachmentDataUrl } from './file-store.js';
import { requirePermission } from './guard.js';
import { deviceId } from './device-id.js';
import * as trashSvc from './trash-service.js';
import * as msgSvc from './message-service.js';
import * as dashboardSvc from './dashboard-service.js';
import * as txnSvc from './transaction-service.js';
import * as approvalSvc from './approval-service.js';
import * as entityCancelSvc from './entity-cancel-service.js';
import * as exportReqSvc from './export-request-service.js';
import * as storageSvc from './storage-service.js';
import * as healthSvc from './health-scan.js';
import { getRemembered, getRememberedUsername, saveRemembered, clearRemembered } from './remember.js';
import { getServerConfig, testServerConfig, saveServerConfig } from './db.js';
import type { ServerConfigInput } from '@glb/shared';

// ── P1-04 + P2-03 (hardening 16/7): MỌI IPC đi qua wrapper `handle()` ──────────────────────────────────
// P1-04 verify SENDER: chỉ nhận lời gọi từ top-frame của chính app (file:// khi đóng gói, http://localhost khi
// dev electron-vite) — chặn frame/webview lạ gọi IPC. P2-03 MAP LỖI: exception ngoài dự kiến (nhất là lỗi kết
// nối Postgres) log ĐẦY ĐỦ ở main nhưng CHỈ trả renderer thông điệp CHUNG — không lộ host/user/port/schema.
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  const url = frame.url || '';
  return frame === frame.top && (url.startsWith('file://') || url.startsWith('http://localhost'));
}

/** True nếu lỗi lộ chi tiết HẠ TẦNG CSDL (kết nối/định danh Postgres) → phải nuốt, không cho ra renderer. */
function isDbInfraLeak(code: string, msg: string): boolean {
  if (/^(28|08|57|3D|53)/.test(code)) return true; // PG SQLSTATE: auth / connection / admin / bad-db / insufficient-resources
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|EPIPE/.test(code)) return true;
  return /password authentication|getaddrinfo|ECONNREFUSED|role "[^"]*" does not exist|database "[^"]*" does not exist|connection to server|no pg_hba/i.test(msg);
}

function mapSafeError(channel: string, e: unknown): Error {
  // Log ĐẦY ĐỦ ở main (nhật ký nội bộ) — KHÔNG ra renderer.
  // eslint-disable-next-line no-console
  console.error(`[ipc:${channel}]`, e);
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string })?.code ?? '';
  if (isDbInfraLeak(code, msg)) return new Error('Không kết nối được cơ sở dữ liệu. Kiểm tra máy chủ / cấu hình kết nối.');
  return e instanceof Error ? e : new Error(msg); // lỗi nghiệp vụ khác GIỮ NGUYÊN (không lộ hạ tầng)
}

// P1-01 (hardening 16/7): FAIL-CLOSED khi DB init lỗi. Trước đây initDb lỗi bị nuốt → app vẫn mở + mọi IPC dữ
// liệu chạy trên DB hỏng (leak lỗi/trạng thái nửa vời). Nay: DB chưa sẵn sàng → CHẶN mọi handler dữ liệu, CHỈ
// cho nhóm cấu-hình-máy-chủ + cửa sổ + version/update (để người dùng SỬA kết nối rồi thử lại). index.ts gọi
// setDbReady(true) sau initDb thành công.
let dbReady = false;
export function setDbReady(v: boolean): void { dbReady = v; }
const DB_OPTIONAL = new Set<string>([
  'serverConfig:get', 'serverConfig:test', 'serverConfig:save',
  'app:getVersion', 'update:check', 'update:start', 'update:installNow', 'update:getBootResult'
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;
const rawIpcHandle = ipcMain.handle.bind(ipcMain); // alias để wrapper KHÔNG bị đổi khi rename ipcMain.handle→handle
function handle(channel: string, fn: IpcHandler): void {
  rawIpcHandle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Nguồn gọi không hợp lệ.'); // P1-04
    if (!dbReady && !DB_OPTIONAL.has(channel)) throw new Error('Cơ sở dữ liệu chưa sẵn sàng. Kiểm tra cấu hình máy chủ rồi thử lại.'); // P1-01 fail-closed
    try {
      return await fn(event, ...args);
    } catch (e) {
      throw mapSafeError(channel, e); // P2-03
    }
  });
}

export function registerIpc(): void {
  // ---- Cấu hình máy chủ (G10.3 — client first-run) ----------------------
  handle('serverConfig:get', async () => getServerConfig());
  handle('serverConfig:test', async (_e, input: ServerConfigInput) => testServerConfig(input ?? {}));
  handle('serverConfig:save', async (_e, input: ServerConfigInput) => saveServerConfig(input ?? {}));

  // ---- Auth (Phase A) ----------------------------------------------------
  handle('auth:login', async (_e, args: { username: string; password: string; remember?: boolean; force?: boolean }) => {
    const { username, password, remember, force } = args ?? ({} as never);
    // R46: hostname để HIỂN THỊ; R48: deviceId (GUID bền, sinh ở main) làm KHÓA same-device chống giả mạo.
    const result = await auth.login(username, password, { force, deviceInfo: os.hostname(), deviceId: deviceId() });
    if (result.ok) {
      if (remember) saveRemembered(username, password);
      else clearRemembered();
    }
    return result;
  });
  // R46 nhịp tim (renderer gọi ~15s) + R41 danh sách user đang đăng nhập.
  handle('session:heartbeat', async () => auth.heartbeat());
  handle('session:onlineUsers', async () => auth.listOnlineUsers());
  handle('realtime:tokens', async () => realtimeTokens()); // R48 Pha 4 — poll thay đổi dữ liệu + badge chờ duyệt
  handle('auth:me', async () => auth.me());
  handle('auth:logout', async () => {
    await auth.logout();
    return { ok: true };
  });
  handle('auth:changePassword', async (_e, args: { currentPassword: string; newPassword: string; confirmPassword?: string }) => {
    const { currentPassword, newPassword, confirmPassword } = args ?? ({} as never);
    return auth.changePassword(currentPassword, newPassword, confirmPassword);
  });
  handle('auth:adminResetPassword', async (_e, args: { userId: number; newPassword: string; actorPassword: string }) => {
    const { userId, newPassword, actorPassword } = args ?? ({} as never);
    return auth.adminResetPassword(userId, newPassword, actorPassword);
  });
  handle('auth:level2Status', async () => auth.getLevel2Status());
  handle('auth:setLevel2', async (_e, args: { level1: string; newLevel2: string; confirmLevel2: string }) => {
    const { level1, newLevel2, confirmLevel2 } = args ?? ({} as never);
    return auth.setLevel2Password(level1, newLevel2, confirmLevel2);
  });
  handle('auth:resetLevel2', async (_e, args: { level1: string; oldLevel2: string; newLevel2: string; confirmLevel2: string }) => {
    const { level1, oldLevel2, newLevel2, confirmLevel2 } = args ?? ({} as never);
    return auth.resetLevel2Password(level1, oldLevel2, newLevel2, confirmLevel2);
  });
  handle('auth:validatePassword', async (_e, pwd: string) => validatePassword(pwd));
  // P1-03: renderer CHỈ nhận username (điền sẵn), KHÔNG nhận mật khẩu. Đăng nhập-đã-nhớ do MAIN tự giải mã.
  handle('auth:getRemembered', async () => {
    const username = getRememberedUsername();
    return username ? { username } : null;
  });
  handle('auth:loginRemembered', async (_e, args: { force?: boolean }) => {
    const creds = getRemembered(); // đọc + giải mã TRONG main, không trả mật khẩu ra ngoài
    if (!creds) return { ok: false, error: 'NO_REMEMBERED', message: 'Chưa lưu đăng nhập.' };
    const result = await auth.login(creds.username, creds.password, { force: args?.force, deviceInfo: os.hostname(), deviceId: deviceId() });
    if (result.ok) saveRemembered(creds.username, creds.password); // gia hạn bản nhớ
    return result;
  });
  handle('auth:saveRemembered', async (_e, args: { username: string; password: string }) => {
    saveRemembered(args.username, args.password);
    return { ok: true };
  });
  handle('auth:clearRemembered', async () => {
    clearRemembered();
    return { ok: true };
  });

  // ---- Roles (Phase B, §8) ----------------------------------------------
  handle('role:list', async () => roleSvc.listRoles());
  handle('role:permissions', async () => roleSvc.listPermissions());
  handle('role:create', async (_e, input: roleSvc.RoleInput) => roleSvc.createRole(input));
  handle('role:update', async (_e, args: { id: number; input: roleSvc.RoleInput }) =>
    roleSvc.updateRole(args.id, args.input)
  );
  handle('role:lock', async (_e, id: number) => roleSvc.lockRole(id));
  handle('role:unlock', async (_e, id: number) => roleSvc.unlockRole(id));
  handle('role:delete', async (_e, args: { id: number; password: string }) =>
    roleSvc.deleteRole(args.id, args.password)
  );

  // ---- Users (Phase B, §9/§11/§12) --------------------------------------
  handle('user:list', async (_e, filter: userSvc.UserFilter) => userSvc.listUsers(filter));
  handle('user:create', async (_e, input: userSvc.CreateUserInput) => userSvc.createUser(input));
  handle('user:update', async (_e, args: { id: number; input: userSvc.UpdateUserInput }) =>
    userSvc.updateUser(args.id, args.input)
  );
  handle('user:lock', async (_e, id: number) => userSvc.lockUser(id));
  handle('user:unlock', async (_e, id: number) => userSvc.unlockUser(id));
  // R34 (Mr.Long 11/7): GỠ IPC xóa trực tiếp nhân sự — xóa nhân sự nay CHỈ qua Duyệt Hủy
  // (entityCancel:* → USER_CANCEL_REQUEST/APPROVE). deleteUser/deleteUsers giữ cho selftest/nội bộ.

  // ---- Audit (Phase B, §16) ---------------------------------------------
  handle('audit:list', async (_e, query: auditSvc.AuditQuery) => auditSvc.listAudit(query));

  // ---- Backup / Restore (Phase B, §17) ----------------------------------
  handle('backup:create', async (_e, note?: string) => backupSvc.createBackup(note));
  handle('backup:list', async () => backupSvc.listBackups());
  handle('backup:restore', async (_e, args: { filePath: string; password: string }) =>
    backupSvc.restoreBackup(args.filePath, args.password)
  );
  handle('backup:mirrorConfigGet', async () => backupSvc.getBackupMirrorConfig());
  handle('backup:mirrorConfigSet', async (_e, args: { input: { mirrorDir: string | null; keep?: number }; password: string }) =>
    backupSvc.setBackupMirrorConfig(args.input, args.password)
  );

  // ---- Settings (Phase B) ------------------------------------------------
  handle('setting:list', async () => settingSvc.listSettings());
  handle('setting:update', async (_e, args: { key: string; value: string }) =>
    settingSvc.updateSetting(args.key, args.value)
  );

  // ---- Customers (G-POS.1 §A/§D) ----------------------------------------
  handle('search:global', async (_e, q: string) => globalSearch(q));
  handle('capture:region', async (_e, opts?: { hideApp?: boolean }) => captureRegion(opts));
  handle('capture:openDir', async () => openScreenshotDir());
  handle('customer:list', async (_e, filter: customerSvc.CustomerFilter) => customerSvc.listCustomers(filter));
  handle('customer:counts', async () => customerSvc.countCustomers());
  handle('customer:create', async (_e, input: customerSvc.CreateCustomerInput) => customerSvc.createCustomer(input));
  handle('customer:update', async (_e, args: { id: number; input: customerSvc.UpdateCustomerInput }) =>
    customerSvc.updateCustomer(args.id, args.input)
  );
  // R34: GỠ IPC xóa trực tiếp khách hàng — nay CHỈ qua Duyệt Hủy (CUSTOMER_CANCEL_*). deleteCustomer giữ nội bộ.
  handle('agent:list', async () => customerSvc.listAgents());

  // ---- POS devices (G-POS.1 §A) -----------------------------------------
  handle('pos:list', async (_e, filter: posSvc.PosFilter) => posSvc.listPosDevices(filter));
  handle('pos:timeline', async (_e, serial: string) => posSvc.getDeviceTimeline(serial));
  handle('pos:create', async (_e, input: posSvc.CreatePosInput) => posSvc.createPos(input));
  handle('pos:update', async (_e, args: { id: number; input: posSvc.UpdatePosInput }) => posSvc.updatePos(args.id, args.input));
  handle('pos:deploy', async (_e, args: { serial: string; input: posSvc.TransitionInput }) => posSvc.deployPos(args.serial, args.input));
  handle('pos:recall', async (_e, args: { serial: string; input: posSvc.TransitionInput }) => posSvc.recallPos(args.serial, args.input));
  handle('pos:transferAgent', async (_e, args: { serial: string; input: posSvc.TransitionInput }) => posSvc.transferPosAgent(args.serial, args.input));
  handle('pos:changeCustomer', async (_e, args: { serial: string; input: posSvc.TransitionInput }) => posSvc.changeCustomerPos(args.serial, args.input));
  handle('pos:cancelCustomer', async (_e, args: { serial: string; input: posSvc.TransitionInput }) => posSvc.cancelCustomerPos(args.serial, args.input));
  handle('deviceSale:sellPos', async (_e, args: { serial: string; input: saleSvc.SellPosInput; password: string }) => saleSvc.sellPos(args.serial, args.input, args.password));
  handle('deviceSale:sellTid', async (_e, args: { tid: string; input: saleSvc.SellTidInput; password: string }) => saleSvc.sellTid(args.tid, args.input, args.password));
  handle('deviceSale:collect', async (_e, input: saleSvc.CollectInput) => saleSvc.collectDeviceSaleDebt(input));
  handle('deviceSale:list', async (_e, filter: saleSvc.DeviceSaleFilter) => saleSvc.listDeviceSales(filter));
  handle('deviceSale:receivables', async () => saleSvc.customerDeviceReceivables());
  handle('pos:reportDamage', async (_e, args: { serial: string; input: posSvc.TransitionInput }) => posSvc.reportPosDamage(args.serial, args.input));
  handle('pos:sendRepair', async (_e, args: { serial: string; input: posSvc.TransitionInput }) => posSvc.sendPosRepair(args.serial, args.input));
  handle('pos:receiveRepaired', async (_e, args: { serial: string; input: posSvc.TransitionInput }) => posSvc.receivePosRepaired(args.serial, args.input));
  handle('pos:retire', async (_e, args: { serial: string; password: string; input: posSvc.TransitionInput }) => posSvc.retirePos(args.serial, args.password, args.input));

  // ---- TIDs (G-POS.1 §A) ------------------------------------------------
  handle('tid:list', async (_e, filter: tidSvc.TidFilter) => tidSvc.listTids(filter));
  handle('tid:undelivered', async () => tidSvc.listUndeliveredTids());
  // PHASE K2 (Q-T5): tid:create → form ĐẦY ĐỦ hợp nhất (cho phép chưa gán + chưa giao). Helper
  // createTid nội bộ (D3) GIỮ cho selftest gpos/posunify, KHÔNG expose qua IPC nữa.
  handle('tid:create', async (_e, input: tidSvc.CreateTidUnifiedInput) => tidSvc.createTidUnified(input));
  handle('tid:refs', async () => tidSvc.tidRefs());
  handle('tid:timeline', async (_e, tid: string) => tidSvc.tidTimeline(tid));
  // #13: xếp hạng doanh số theo TID (mặc định tháng hiện tại + lọc kỳ). Gate REVENUE_VIEW (trong service).
  handle('tid:revenueRanking', async (_e, filter: tidSvc.TidRevenueRankFilter) => tidSvc.tidRevenueRanking(filter));
  handle('tid:assign', async (_e, args: { tid: string; input: tidSvc.AssignTidInput }) => tidSvc.assignTid(args.tid, args.input));
  handle('tid:replace', async (_e, args: { tid: string; input: tidSvc.ReplaceTidInput }) => tidSvc.replaceTid(args.tid, args.input));
  handle('tid:recall', async (_e, args: { tid: string; input: tidSvc.RecallTidInput }) => tidSvc.recallTid(args.tid, args.input));
  handle('tid:markDelivered', async (_e, args: { tid: string; input: tidSvc.MarkDeliveredInput }) => tidSvc.markTidDelivered(args.tid, args.input));
  // R30 — phí bán thực tế theo TID × loại thẻ (set khi giao máy, hiện phí niêm yết để đối chiếu).
  handle('tid:sellFeeList', async (_e, args: { tidId: number; feeTypeId: number }) => tidSellFeeSvc.listTidSellFees(args.tidId, args.feeTypeId));
  handle('tid:sellFeeSet', async (_e, input: tidSellFeeSvc.SetTidSellFeesInput) => tidSellFeeSvc.setTidSellFees(input));

  // ---- Dashboard (Nhóm B — KPI realtime + tăng trưởng) ------------------
  handle('dashboard:stats', async () => dashboardSvc.getStats());
  handle('dashboard:profit', async () => dashboardSvc.getMonthlyProfit());

  // ---- Notifications (undelivered TID — badge REAL, push STUB) -----------
  handle('notify:undeliveredSummary', async () => notifySvc.getUndeliveredSummary());
  handle('notify:pushUndelivered', async () => notifySvc.pushUndeliveredZalo());

  // ---- Cấu hình ngân hàng (G-CFG.1 §C1–C4) ------------------------------
  handle('warehouse:list', async (_e, filter: whSvc.WarehouseFilter) => whSvc.listWarehouses(filter));
  handle('warehouse:lite', async () => whSvc.listWarehousesLite());
  handle('warehouse:managerCandidates', async () => whSvc.listWarehouseManagerCandidates());
  handle('warehouse:create', async (_e, input: whSvc.CreateWarehouseInput) => whSvc.createWarehouse(input));
  handle('warehouse:update', async (_e, args: { id: number; input: whSvc.UpdateWarehouseInput }) => whSvc.updateWarehouse(args.id, args.input));
  handle('warehouse:delete', async (_e, args: { ids: number[]; password: string }) => whSvc.deleteWarehouses(args.ids, args.password));

  handle('bank:list', async (_e, filter: bankCfgSvc.BankFilter) => bankCfgSvc.listBanks(filter));
  handle('bank:lite', async () => bankCfgSvc.listBanksLite());
  handle('bank:create', async (_e, input: bankCfgSvc.CreateBankInput) => bankCfgSvc.createBank(input));
  handle('bank:update', async (_e, args: { id: number; input: bankCfgSvc.UpdateBankInput }) => bankCfgSvc.updateBank(args.id, args.input));
  handle('bank:delete', async (_e, args: { ids: number[]; password: string }) => bankCfgSvc.deleteBanks(args.ids, args.password));

  handle('cardType:list', async (_e, filter: bankCfgSvc.CardTypeFilter) => bankCfgSvc.listCardTypes(filter));
  handle('cardType:create', async (_e, input: bankCfgSvc.CreateCardTypeInput) => bankCfgSvc.createCardType(input));
  handle('cardType:update', async (_e, args: { id: number; input: bankCfgSvc.UpdateCardTypeInput }) => bankCfgSvc.updateCardType(args.id, args.input));
  handle('cardType:delete', async (_e, args: { ids: number[]; password: string }) => bankCfgSvc.deleteCardTypes(args.ids, args.password));

  handle('partner:list', async (_e, filter: bankCfgSvc.PartnerFilter) => bankCfgSvc.listPartners(filter));
  handle('partner:create', async (_e, input: bankCfgSvc.CreatePartnerInput) => bankCfgSvc.createPartner(input));
  handle('partner:update', async (_e, args: { id: number; input: bankCfgSvc.UpdatePartnerInput }) => bankCfgSvc.updatePartner(args.id, args.input));
  handle('partner:delete', async (_e, args: { ids: number[]; password: string }) => bankCfgSvc.deletePartners(args.ids, args.password));
  handle('partnerBank:matrix', async () => bankCfgSvc.getPartnerBankMatrix());
  handle('partnerBank:set', async (_e, args: { partnerId: number; bankIds: number[] }) => bankCfgSvc.setPartnerBanks(args.partnerId, args.bankIds));

  // ── R14 Danh mục trạng thái tùy biến dùng chung ──
  handle('statusOption:list', async (_e, args: { entity: string; includeInactive?: boolean }) => statusSvc.listStatusOptions(args.entity, { includeInactive: args.includeInactive }));
  handle('statusOption:listMany', async (_e, entities: string[]) => statusSvc.listStatusOptionsMany(entities));
  handle('statusOption:entities', async () => statusSvc.listStatusEntities());
  handle('statusOption:create', async (_e, input: statusSvc.CreateStatusOptionInput) => statusSvc.createStatusOption(input));
  handle('statusOption:update', async (_e, args: { id: number; input: statusSvc.UpdateStatusOptionInput }) => statusSvc.updateStatusOption(args.id, args.input));
  handle('statusOption:delete', async (_e, id: number) => statusSvc.deleteStatusOption(id));

  // ── G-CFG.2 Cấu hình cung ứng POS (§C6–C8) ──
  handle('supplier:list', async (_e, filter: posSupplySvc.SupplierFilter) => posSupplySvc.listSuppliers(filter));
  handle('supplier:lite', async () => posSupplySvc.listSuppliersLite());
  handle('supplier:create', async (_e, input: posSupplySvc.CreateSupplierInput) => posSupplySvc.createSupplier(input));
  handle('supplier:update', async (_e, args: { id: number; input: posSupplySvc.UpdateSupplierInput }) => posSupplySvc.updateSupplier(args.id, args.input));
  handle('supplier:delete', async (_e, args: { ids: number[]; password: string }) => posSupplySvc.deleteSuppliers(args.ids, args.password));

  handle('posModel:list', async (_e, filter: posSupplySvc.PosModelFilter) => posSupplySvc.listPosModels(filter));
  handle('posModel:lite', async () => posSupplySvc.listPosModelsLite());
  handle('posModel:create', async (_e, input: posSupplySvc.CreatePosModelInput) => posSupplySvc.createPosModel(input));
  handle('posModel:update', async (_e, args: { id: number; input: posSupplySvc.UpdatePosModelInput }) => posSupplySvc.updatePosModel(args.id, args.input));
  handle('posModel:delete', async (_e, args: { ids: number[]; password: string }) => posSupplySvc.deletePosModels(args.ids, args.password));

  handle('intakeStatus:list', async () => posSupplySvc.listIntakeStatuses());
  handle('intakeStatus:create', async (_e, input: posSupplySvc.CreateIntakeStatusInput) => posSupplySvc.createIntakeStatus(input));
  handle('intakeStatus:update', async (_e, args: { id: number; input: posSupplySvc.UpdateIntakeStatusInput }) => posSupplySvc.updateIntakeStatus(args.id, args.input));
  handle('intakeStatus:delete', async (_e, args: { ids: number[]; password: string }) => posSupplySvc.deleteIntakeStatuses(args.ids, args.password));

  handle('posIntake:list', async (_e, filter: posSupplySvc.PosIntakeFilter) => posSupplySvc.listPosIntakes(filter));
  handle('posIntake:create', async (_e, input: posSupplySvc.CreatePosIntakeInput) => posSupplySvc.createPosIntake(input));
  handle('posIntake:update', async (_e, args: { id: number; input: posSupplySvc.UpdatePosIntakeInput }) => posSupplySvc.updatePosIntake(args.id, args.input));
  handle('posIntake:delete', async (_e, args: { ids: number[]; password: string }) => posSupplySvc.deletePosIntakes(args.ids, args.password));

  // ── G-CFG.3 Cấu hình phí (§C5) ──
  handle('feeType:list', async () => feeCfgSvc.listFeeTypes());
  handle('feeType:create', async (_e, input: feeCfgSvc.CreateFeeTypeInput) => feeCfgSvc.createFeeType(input));
  handle('feeType:update', async (_e, args: { id: number; input: feeCfgSvc.UpdateFeeTypeInput }) => feeCfgSvc.updateFeeType(args.id, args.input));
  handle('feeType:delete', async (_e, args: { ids: number[]; password: string }) => feeCfgSvc.deleteFeeTypes(args.ids, args.password));

  // ---- LOẠI GIAO MÁY (Mr.Long) — danh mục loại giao + báo cáo cọc/doanh thu theo loại giao ----
  handle('handoverType:list', async () => handoverSvc.listHandoverTypes());
  handle('handoverType:listLite', async () => handoverSvc.listHandoverTypesLite());
  handle('handoverType:create', async (_e, input: handoverSvc.CreateHandoverTypeInput) => handoverSvc.createHandoverType(input));
  handle('handoverType:update', async (_e, args: { id: number; input: handoverSvc.UpdateHandoverTypeInput }) => handoverSvc.updateHandoverType(args.id, args.input));
  handle('handoverType:delete', async (_e, args: { ids: number[]; password: string }) => handoverSvc.deleteHandoverTypes(args.ids, args.password));
  handle('deposit:held', async (_e, customerId?: number) => depositSvc.depositsHeld(customerId));
  handle('deposit:revenueByHandover', async (_e, filter: depositSvc.RevenueByHandoverFilter) => depositSvc.revenueByHandoverType(filter));

  handle('feeRate:list', async (_e, filter: feeCfgSvc.FeeRateFilter) => feeCfgSvc.listFeeRates(filter));
  handle('feeRate:set', async (_e, input: feeCfgSvc.SetFeeRateInput) => feeCfgSvc.setFeeRate(input));
  handle('feeRate:delete', async (_e, args: { ids: number[]; password: string }) => feeCfgSvc.deleteFeeRates(args.ids, args.password));
  // FEE_MODEL — phí bán niêm yết hiệu lực theo loại phí (tham chiếu khi đặt phí bán TID).
  handle('feeSellQuote:list', async (_e, args: { partnerId: number; cardTypeId: number; at?: string }) => feeCfgSvc.listSellQuotes(args.partnerId, args.cardTypeId, args.at));

  // ── G-CFG.4 Tài khoản nhận tiền – ủy quyền (§8) ──
  handle('rcvSource:list', async () => rcvAcctSvc.listSources());
  handle('rcvSource:create', async (_e, input: rcvAcctSvc.CreateRcvSourceInput) => rcvAcctSvc.createSource(input));
  handle('rcvSource:update', async (_e, args: { id: number; input: rcvAcctSvc.UpdateRcvSourceInput }) => rcvAcctSvc.updateSource(args.id, args.input));
  handle('rcvSource:delete', async (_e, args: { ids: number[]; password: string }) => rcvAcctSvc.deleteSources(args.ids, args.password));

  handle('rcvAccount:list', async (_e, filter: rcvAcctSvc.RcvAccountFilter) => rcvAcctSvc.listAccounts(filter));
  handle('rcvAccount:create', async (_e, input: rcvAcctSvc.RcvAccountInput) => rcvAcctSvc.createAccount(input));
  handle('rcvAccount:update', async (_e, args: { id: number; input: rcvAcctSvc.RcvAccountInput }) => rcvAcctSvc.updateAccount(args.id, args.input));
  handle('rcvAccount:delete', async (_e, args: { ids: number[]; password: string }) => rcvAcctSvc.deleteAccounts(args.ids, args.password));

  // Chọn ảnh (PNG/JPG/PDF) qua hộp thoại hệ điều hành → trả đường dẫn tuyệt đối.
  handle('file:pickImage', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Ảnh/PDF', extensions: ['png', 'jpg', 'jpeg', 'pdf'] }] })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Ảnh/PDF', extensions: ['png', 'jpg', 'jpeg', 'pdf'] }] });
    if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true };
    return { ok: true, path: res.filePaths[0] };
  });
  // R48 — GẮN QUYỀN đọc tệp đính kèm (trước đây MỞ cho mọi phiên → IDOR đọc trộm CCCD/ĐKKD). Ảnh thuộc
  // hồ sơ HKD (dossier) → CONFIG_DOSSIER_VIEW; tài khoản nhận tiền (receiveAccount) → CONFIG_RCV_ACCT_VIEW;
  // tiền tố lạ → chặn. (Trước đây dùng mã DOSSIER_VIEW/RCV_ACCT_VIEW KHÔNG tồn tại → fail-closed chặn cả ADMIN.)
  handle('file:read', async (_e, relPath: string) => {
    const kind = String(relPath ?? '').split('/')[0];
    const perm = kind === 'dossier' ? 'CONFIG_DOSSIER_VIEW' : kind === 'receiveAccount' ? 'CONFIG_RCV_ACCT_VIEW' : null;
    if (!perm) return { ok: false, error: 'FORBIDDEN', message: 'Không có quyền xem tệp này.' };
    const g = await requirePermission(perm, { action: 'file:read', targetType: kind });
    if (!g.ok) return g;
    return readAttachmentDataUrl(relPath);
  });

  // ── G-CFG.5 (§10) Quản lý Hồ sơ HKD ──
  handle('dossierSource:list', async () => dossierSvc.listSources());
  handle('dossierSource:create', async (_e, input: dossierSvc.CreateDossierSourceInput) => dossierSvc.createSource(input));
  handle('dossierSource:update', async (_e, args: { id: number; input: dossierSvc.UpdateDossierSourceInput }) => dossierSvc.updateSource(args.id, args.input));
  handle('dossierSource:delete', async (_e, args: { ids: number[]; password: string }) => dossierSvc.deleteSources(args.ids, args.password));

  handle('dossier:list', async (_e, filter: dossierSvc.DossierFilter) => dossierSvc.listDossiers(filter));
  handle('dossier:create', async (_e, input: dossierSvc.DossierInput) => dossierSvc.createDossier(input));
  handle('dossier:update', async (_e, args: { id: number; input: dossierSvc.DossierInput }) => dossierSvc.updateDossier(args.id, args.input));
  handle('dossier:delete', async (_e, args: { ids: number[]; password: string }) => dossierSvc.deleteDossiers(args.ids, args.password));

  // ── G-CFG.6 (§9) Cấu hình TID ──
  handle('tidStatus:list', async () => tidCfgSvc.listStatuses());
  handle('tidStatus:create', async (_e, input: tidCfgSvc.CreateTidConfigStatusInput) => tidCfgSvc.createStatus(input));
  handle('tidStatus:update', async (_e, args: { id: number; input: tidCfgSvc.UpdateTidConfigStatusInput }) => tidCfgSvc.updateStatus(args.id, args.input));
  handle('tidStatus:delete', async (_e, args: { ids: number[]; password: string }) => tidCfgSvc.deleteStatuses(args.ids, args.password));

  handle('tidConfig:list', async (_e, filter: tidCfgSvc.ConfigTidFilter) => tidCfgSvc.listConfigTids(filter));
  handle('tidConfig:create', async (_e, input: tidCfgSvc.ConfigTidInput) => tidCfgSvc.createConfigTid(input));
  handle('tidConfig:update', async (_e, args: { id: number; input: tidCfgSvc.ConfigTidInput }) => tidCfgSvc.updateConfigTid(args.id, args.input));
  // R34: GỠ IPC xóa cấu hình TID trực tiếp — xóa TID nay CHỈ qua Duyệt Hủy (TID_CANCEL_*). deleteConfigTids giữ nội bộ.

  // ── G-CFG.7 (§11 Pha I1) Cấu hình ngành nghề (master) ──
  handle('industry:list', async (_e, filter: industryCfgSvc.IndustryFilter) => industryCfgSvc.listIndustries(filter));
  handle('industry:create', async (_e, input: industryCfgSvc.CreateIndustryInput) => industryCfgSvc.createIndustry(input));
  handle('industry:update', async (_e, args: { id: number; input: industryCfgSvc.UpdateIndustryInput }) => industryCfgSvc.updateIndustry(args.id, args.input));
  handle('industry:delete', async (_e, args: { ids: number[]; password: string }) => industryCfgSvc.deleteIndustries(args.ids, args.password));

  // ── Bill giải trình (Mr.Long 16/7): thư viện SP + sinh bill + theo dõi + template ──
  handle('product:list', async (_e, filter: billExplainSvc.ProductFilter) => billExplainSvc.listProducts(filter));
  handle('product:create', async (_e, input: billExplainSvc.CreateProductInput) => billExplainSvc.createProduct(input));
  handle('product:update', async (_e, args: { id: number; input: billExplainSvc.UpdateProductInput }) => billExplainSvc.updateProduct(args.id, args.input));
  handle('product:delete', async (_e, args: { ids: number[]; password: string }) => billExplainSvc.deleteProducts(args.ids, args.password));
  handle('product:import', async (_e, args: { industryId: number; rows: { name?: string; unit?: string; price?: unknown }[] }) => billExplainSvc.importProducts(args.industryId, args.rows));
  handle('billExplain:generate', async (_e, input: billExplainSvc.GenerateBillsInput) => {
    const res = await billExplainSvc.generateBills(input);
    // Cho phép mở file bill vừa sinh qua file:open (allowlist exportedFiles chống RCE — xem file:open bên dưới).
    if (res.ok && res.file) exportedFiles.add(res.file);
    return res;
  });
  handle('billExplain:list', async (_e, filter: billExplainSvc.BillExplainFilter) => billExplainSvc.listBillExplains(filter));
  handle('billExplain:delete', async (_e, args: { ids: number[]; password: string }) => billExplainSvc.deleteBillExplains(args.ids, args.password));
  handle('billExplain:config', async () => billExplainSvc.getBillExplainConfig());
  handle('billExplain:setConfig', async (_e, input: billExplainSvc.SetBillExplainConfigInput) => billExplainSvc.setBillExplainConfig(input));
  handle('billExplain:importTemplate', async () => billExplainSvc.importInvoiceTemplate());
  handle('billExplain:resetTemplate', async () => billExplainSvc.resetInvoiceTemplate());
  handle('billExplain:exportTemplate', async () => billExplainSvc.exportInvoiceTemplate());
  handle('billExplain:openFile', async (_e, id: number) => {
    const res = await billExplainSvc.getBillFilePath(id);
    if (!res.ok || !res.path) return res;
    const err = await shell.openPath(res.path);
    return err ? { ok: false, message: 'Không mở được file: ' + err } : { ok: true };
  });
  // Mở THƯ MỤC chứa bill (đường dẫn từ cấu hình DB — an toàn RCE). shell.openPath mở thư mục bằng Explorer.
  handle('billExplain:openFolder', async () => {
    const res = await billExplainSvc.getBillOutputDir();
    if (!res.ok || !res.path) return res;
    const err = await shell.openPath(res.path);
    return err ? { ok: false, message: 'Không mở được thư mục: ' + err } : { ok: true };
  });

  // ── PHASE H1 — Thu–Chi: danh mục thu/chi ──
  handle('cashCategory:list', async (_e, filter: cashCatSvc.CashCategoryFilter) => cashCatSvc.listCashCategories(filter));
  handle('cashCategory:create', async (_e, input: cashCatSvc.CreateCashCategoryInput) => cashCatSvc.createCashCategory(input));
  handle('cashCategory:update', async (_e, args: { id: number; input: cashCatSvc.UpdateCashCategoryInput }) => cashCatSvc.updateCashCategory(args.id, args.input));
  handle('cashCategory:remove', async (_e, args: { ids: number[]; password: string }) => cashCatSvc.deleteCashCategories(args.ids, args.password));

  // ── PHASE H2-core — Thu–Chi: Quỹ (Fund) ──
  handle('fund:list', async (_e, filter: fundSvc.FundFilter) => fundSvc.listFunds(filter));
  handle('fund:userLite', async () => fundSvc.listCashflowUsersLite());
  handle('fund:create', async (_e, input: fundSvc.CreateFundInput) => fundSvc.createFund(input));
  handle('fund:update', async (_e, args: { id: number; input: fundSvc.UpdateFundInput }) => fundSvc.updateFund(args.id, args.input));
  handle('fund:remove', async (_e, args: { ids: number[]; password: string }) => fundSvc.deleteFunds(args.ids, args.password));

  // ── PHASE H2-core — Thu–Chi: Phiếu thu/chi (CashEntry) + báo cáo dòng tiền ──
  handle('cashEntry:list', async (_e, filter: cashEntrySvc.CashEntryFilter) => cashEntrySvc.listCashEntries(filter));
  handle('cashEntry:report', async (_e, filter: cashEntrySvc.CashEntryFilter) => cashEntrySvc.cashflowReport(filter));
  handle('cashEntry:categoryLite', async () => cashEntrySvc.listEntryCategoriesLite());
  handle('cashEntry:partnerLite', async () => cashEntrySvc.listPartnersLite());
  handle('cashEntry:create', async (_e, input: cashEntrySvc.CreateCashEntryInput) => cashEntrySvc.createCashEntry(input));
  handle('cashEntry:createDebtReceipt', async (_e, input: cashEntrySvc.CreateDebtReceiptInput) => cashEntrySvc.createDebtReceipt(input));
  handle('cashEntry:cancel', async (_e, args: { id: number; reason: string; password: string }) => cashEntrySvc.cancelCashEntry(args.id, args.reason, args.password));

  // ── XUẤT EXCEL chuẩn nhà (.xlsx thật) + LƯU qua hộp thoại HĐH + MỞ file (R38/R39) ──
  // Nhớ thư mục lưu gần nhất để lần sau gợi ý đúng chỗ (đỡ phải dò lại).
  let lastExportDir: string | null = null;
  // R48 — chỉ cho file:open MỞ đúng các file .xlsx do CHÍNH app này vừa xuất (report:export) trong phiên.
  // Không nhận đường dẫn tùy ý từ renderer → chặn RCE (shell.openPath THỰC THI .exe/.bat/.lnk qua ShellExecute).
  const exportedFiles = new Set<string>();
  handle('report:export', async (_e, p: { kind?: 'report' | 'template'; fileBase: string; fileName: string; title: string; headers: string[]; rows?: exportSvc.Cell[][]; summary?: string; hints?: { header: string; required?: boolean; hint?: string }[] }) => {
    try {
      const buf = p.kind === 'template'
        ? await exportSvc.buildTemplateWorkbook({ title: p.title, headers: p.headers, hints: p.hints })
        : await exportSvc.buildReportWorkbook({ title: p.title, headers: p.headers, rows: p.rows ?? [], summary: p.summary });
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const suggested = (lastExportDir ? lastExportDir + '\\' : '') + p.fileName;
      const opts = { defaultPath: suggested, filters: [{ name: 'Excel', extensions: ['xlsx'] }] };
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return { ok: true, canceled: true };
      await writeFile(res.filePath, buf);
      lastExportDir = res.filePath.replace(/[\\/][^\\/]*$/, '');
      exportedFiles.add(res.filePath);
      return { ok: true, path: res.filePath };
    } catch (e) {
      return { ok: false, error: 'EXPORT_FAILED', message: 'Không xuất được Excel: ' + (e instanceof Error ? e.message : String(e)) };
    }
  });
  // Mở file vừa lưu bằng ứng dụng mặc định (Excel). CHỈ mở file .xlsx do app này vừa xuất trong phiên
  // (exportedFiles) → chống RCE: renderer bị chèn script không thể ép mở .exe/.bat/UNC payload tùy ý.
  handle('file:open', async (_e, path: string) => {
    if (typeof path !== 'string' || !exportedFiles.has(path)) {
      return { ok: false, message: 'Chỉ mở được file vừa xuất từ phần mềm.' };
    }
    const err = await shell.openPath(path);
    return err ? { ok: false, message: 'Không mở được file: ' + err } : { ok: true };
  });

  // ── PHASE IMPORT (#9) — Nhập liệu hàng loạt từ Excel ──
  handle('import:template', async (_e, entityKey: string) => importSvc.importTemplateColumns(entityKey));
  handle('import:dryRun', async (_e, args: { entityKey: string; rows: Record<string, unknown>[] }) => importSvc.dryRunImport(args?.entityKey, args?.rows ?? []));
  handle('import:run', async (_e, args: { entityKey: string; rows: Record<string, unknown>[] }) => importSvc.runImport(args?.entityKey, args?.rows ?? []));

  // ── E4 Thùng rác ──
  handle('trash:list', async () => trashSvc.listTrash());
  handle('trash:restore', async (_e, args: { entityType: string; id: number }) => trashSvc.restoreItem(args.entityType, args.id));
  handle('trash:linkSummary', async (_e, args: { entityType: string; id: number }) => trashSvc.linkSummary(args.entityType, args.id));
  handle('trash:purge', async (_e, args: { entityType: string; id: number; password: string }) => trashSvc.purgeItem(args.entityType, args.id, args.password));
  handle('trash:emptyAll', async (_e, args: { level2Password: string }) => trashSvc.emptyTrash(args.level2Password));

  // ── Hòm thư nội bộ + thông báo bảo mật (Nhóm A #2 / Nhóm C #7) ──
  handle('message:inbox', async () => msgSvc.listInbox());
  handle('message:unreadCount', async () => msgSvc.unreadCount());
  handle('message:markRead', async (_e, id: number) => msgSvc.markRead(id));
  handle('message:markAllRead', async () => msgSvc.markAllRead());
  handle('message:send', async (_e, input: { recipientId: number; subject: string; body: string }) => msgSvc.sendMessage(input));

  // ── Nhóm B — Doanh thu & Công nợ ──
  handle('transaction:list', async (_e, filter: txnSvc.TransactionFilter) => txnSvc.listTransactions(filter));
  handle('transaction:create', async (_e, input: txnSvc.CreateTransactionInput) => txnSvc.createTransaction(input));
  // FEE_TYPE — báo cáo doanh thu tách theo LOẠI PHÍ (Ủy quyền/Đối ứng/Tiền chờ…).
  handle('transaction:revenueByFeeType', async (_e, filter: txnSvc.TransactionFilter) => txnSvc.revenueByFeeType(filter));
  // Bill BẤT BIẾN: không có wire 'transaction:update' (updateTransaction chỉ còn là guard BILL_IMMUTABLE, test trực tiếp). Sửa GD = hủy + tạo lại.
  handle('transaction:delete', async (_e, args: { ids: number[]; password: string }) => txnSvc.deleteTransactions(args.ids, args.password));
  // H5 — GỠ handler 'transaction:settle' (toggle settled thủ công vô hiệu hóa). settled chỉ đổi qua
  //       phiếu Thu công nợ (cashEntry:createDebtReceipt) / hủy phiếu thu.
  handle('debt:summary', async (_e, filter: txnSvc.TransactionFilter) => txnSvc.debtSummary(filter));
  handle('debt:openTransactions', async (_e, filter: txnSvc.TransactionFilter) => txnSvc.debtOpenTransactions(filter));
  // H2b — phân loại chất lượng công nợ + ghi giảm nợ xấu.
  handle('debt:byQuality', async (_e, filter: txnSvc.TransactionFilter) => txnSvc.debtByQuality(filter));
  handle('debt:classify', async (_e, args: { transactionId: number; quality: string; reason?: string }) => txnSvc.classifyDebt(args.transactionId, args.quality, args.reason));
  handle('debt:qualityHistory', async (_e, transactionId: number) => txnSvc.debtQualityHistory(transactionId));
  handle('debt:writeOff', async (_e, args: { transactionId: number; actorPassword: string }) => txnSvc.writeOffBadDebt(args.transactionId, args.actorPassword));

  // ── P1.2 Approval Engine — hủy bill có duyệt (phân vai trong service) ──
  handle('approval:requestCancel', async (_e, args: { transactionId: number; reason: string }) => approvalSvc.requestCancelBill(args.transactionId, args.reason));
  handle('approval:list', async (_e, status?: string) => approvalSvc.listCancelRequests(status));
  handle('approval:approve', async (_e, args: { requestId: number; password: string; note?: string }) => approvalSvc.approveCancelBill(args.requestId, args.password, args.note));
  handle('approval:reject', async (_e, args: { requestId: number; note: string }) => approvalSvc.rejectCancelBill(args.requestId, args.note));
  handle('approval:approveBulk', async (_e, args: { requestIds: number[]; password: string; note?: string }) => approvalSvc.approveCancelBills(args.requestIds, args.password, args.note));
  handle('approval:rejectBulk', async (_e, args: { requestIds: number[]; note: string }) => approvalSvc.rejectCancelBills(args.requestIds, args.note));
  // R34 — Duyệt hủy (xóa qua duyệt) cho TID / POS / Khách hàng / Nhân sự (engine generic riêng).
  handle('entityCancel:request', async (_e, a: { entityType: string; entityId: number; reason: string }) => entityCancelSvc.requestEntityCancel(a.entityType, a.entityId, a.reason));
  handle('entityCancel:list', async (_e, a?: { status?: string; entityType?: string }) => entityCancelSvc.listEntityCancelRequests(a?.status, a?.entityType));
  handle('entityCancel:approve', async (_e, a: { entityType: string; requestId: number; password: string; note?: string }) => entityCancelSvc.approveEntityCancel(a.entityType, a.requestId, a.password, a.note));
  handle('entityCancel:reject', async (_e, a: { entityType: string; requestId: number; note: string }) => entityCancelSvc.rejectEntityCancel(a.entityType, a.requestId, a.note));

  // PHASE 1 — Yêu cầu xuất kho POS/TID → Duyệt → đối trừ tồn kho.
  handle('exportReq:create', async (_e, input: exportReqSvc.CreateExportRequestInput) => exportReqSvc.createExportRequest(input));
  handle('exportReq:list', async (_e, filter?: exportReqSvc.ExportRequestFilter) => exportReqSvc.listExportRequests(filter ?? {}));
  handle('exportReq:approve', async (_e, a: { requestId: number; lines: exportReqSvc.ApproveLineInput[]; password: string; note?: string }) => exportReqSvc.approveExportRequest(a.requestId, a.lines, a.password, a.note));
  handle('exportReq:reject', async (_e, a: { requestId: number; note: string }) => exportReqSvc.rejectExportRequest(a.requestId, a.note));
  handle('exportReq:cancel', async (_e, a: { requestId: number; note?: string }) => exportReqSvc.cancelExportRequest(a.requestId, a.note));

  // ── Nhóm E — Bảo trì & Bộ nhớ (Storage-Guard) ──
  handle('storage:status', async () => storageSvc.getStorageStatus());
  handle('storage:cleanup', async (_e, opts: storageSvc.CleanupOptions) => storageSvc.runCleanup(opts));
  handle('storage:updateConfig', async (_e, cfg: Parameters<typeof storageSvc.updateStorageConfig>[0]) => storageSvc.updateStorageConfig(cfg));

  // ── Bảo trì: quét sức khỏe toàn hệ thống + lịch sử ──
  handle('health:scan', async (_e, opts: { autoFix?: boolean }) => healthSvc.runScan(opts ?? {}));
  handle('health:runs', async (_e, limit?: number) => healthSvc.listRuns(limit));
  handle('health:run', async (_e, id: number) => healthSvc.getRun(id));
}
