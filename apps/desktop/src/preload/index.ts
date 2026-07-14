// Preload — the ONLY bridge between renderer and main. Exposes a typed `window.api`.
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Auth
  login: (username: string, password: string, remember: boolean, force?: boolean) =>
    ipcRenderer.invoke('auth:login', { username, password, remember, force }),
  me: () => ipcRenderer.invoke('auth:me'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  // R46 nhịp tim + R41 danh sách đang đăng nhập.
  sessionHeartbeat: () => ipcRenderer.invoke('session:heartbeat'),
  onlineUsers: () => ipcRenderer.invoke('session:onlineUsers'),
  realtimeTokens: () => ipcRenderer.invoke('realtime:tokens'),
  changePassword: (currentPassword: string, newPassword: string, confirmPassword?: string) =>
    ipcRenderer.invoke('auth:changePassword', { currentPassword, newPassword, confirmPassword }),
  adminResetPassword: (userId: number, newPassword: string, actorPassword: string) =>
    ipcRenderer.invoke('auth:adminResetPassword', { userId, newPassword, actorPassword }),
  level2Status: () => ipcRenderer.invoke('auth:level2Status'),
  setLevel2: (level1: string, newLevel2: string, confirmLevel2: string) =>
    ipcRenderer.invoke('auth:setLevel2', { level1, newLevel2, confirmLevel2 }),
  resetLevel2: (level1: string, oldLevel2: string, newLevel2: string, confirmLevel2: string) =>
    ipcRenderer.invoke('auth:resetLevel2', { level1, oldLevel2, newLevel2, confirmLevel2 }),
  validatePassword: (pwd: string) => ipcRenderer.invoke('auth:validatePassword', pwd),
  getRemembered: () => ipcRenderer.invoke('auth:getRemembered'),
  loginRemembered: (force?: boolean) => ipcRenderer.invoke('auth:loginRemembered', { force }),
  saveRemembered: (username: string, password: string) =>
    ipcRenderer.invoke('auth:saveRemembered', { username, password }),
  clearRemembered: () => ipcRenderer.invoke('auth:clearRemembered'),

  // Cấu hình máy chủ (G10.3 — client first-run)
  serverConfigGet: () => ipcRenderer.invoke('serverConfig:get'),
  serverConfigTest: (input: unknown) => ipcRenderer.invoke('serverConfig:test', input),
  serverConfigSave: (input: unknown) => ipcRenderer.invoke('serverConfig:save', input),

  // Roles
  roleList: () => ipcRenderer.invoke('role:list'),
  rolePermissions: () => ipcRenderer.invoke('role:permissions'),
  roleCreate: (input: unknown) => ipcRenderer.invoke('role:create', input),
  roleUpdate: (id: number, input: unknown) => ipcRenderer.invoke('role:update', { id, input }),
  roleLock: (id: number) => ipcRenderer.invoke('role:lock', id),
  roleUnlock: (id: number) => ipcRenderer.invoke('role:unlock', id),
  roleDelete: (id: number, password: string) => ipcRenderer.invoke('role:delete', { id, password }),

  // Users
  userList: (filter: unknown) => ipcRenderer.invoke('user:list', filter),
  userCreate: (input: unknown) => ipcRenderer.invoke('user:create', input),
  userUpdate: (id: number, input: unknown) => ipcRenderer.invoke('user:update', { id, input }),
  userLock: (id: number) => ipcRenderer.invoke('user:lock', id),
  userUnlock: (id: number) => ipcRenderer.invoke('user:unlock', id),

  // Audit
  auditList: (query: unknown) => ipcRenderer.invoke('audit:list', query),

  // Backup / Restore
  backupCreate: (note?: string) => ipcRenderer.invoke('backup:create', note),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupRestore: (filePath: string, password: string) =>
    ipcRenderer.invoke('backup:restore', { filePath, password }),
  backupMirrorConfigGet: () => ipcRenderer.invoke('backup:mirrorConfigGet'),
  backupMirrorConfigSet: (input: { mirrorDir: string | null; keep?: number }, password: string) =>
    ipcRenderer.invoke('backup:mirrorConfigSet', { input, password }),

  // Settings
  settingList: () => ipcRenderer.invoke('setting:list'),
  settingUpdate: (key: string, value: string) => ipcRenderer.invoke('setting:update', { key, value }),

  // Customers (G-POS.1)
  customerList: (filter: unknown) => ipcRenderer.invoke('customer:list', filter),
  customerCounts: () => ipcRenderer.invoke('customer:counts'),
  customerCreate: (input: unknown) => ipcRenderer.invoke('customer:create', input),
  customerUpdate: (id: number, input: unknown) => ipcRenderer.invoke('customer:update', { id, input }),
  agentList: () => ipcRenderer.invoke('agent:list'),

  // POS devices (G-POS.1)
  posList: (filter: unknown) => ipcRenderer.invoke('pos:list', filter),
  posTimeline: (serial: string) => ipcRenderer.invoke('pos:timeline', serial),
  posCreate: (input: unknown) => ipcRenderer.invoke('pos:create', input),
  posUpdate: (id: number, input: unknown) => ipcRenderer.invoke('pos:update', { id, input }),
  posDeploy: (serial: string, input: unknown) => ipcRenderer.invoke('pos:deploy', { serial, input }),
  posRecall: (serial: string, input: unknown) => ipcRenderer.invoke('pos:recall', { serial, input }),
  posTransferAgent: (serial: string, input: unknown) => ipcRenderer.invoke('pos:transferAgent', { serial, input }),
  posChangeCustomer: (serial: string, input: unknown) => ipcRenderer.invoke('pos:changeCustomer', { serial, input }),
  posCancelCustomer: (serial: string, input: unknown) => ipcRenderer.invoke('pos:cancelCustomer', { serial, input }),
  deviceSellPos: (serial: string, input: unknown, password: string) => ipcRenderer.invoke('deviceSale:sellPos', { serial, input, password }),
  deviceSellTid: (tid: string, input: unknown, password: string) => ipcRenderer.invoke('deviceSale:sellTid', { tid, input, password }),
  deviceSaleCollect: (input: unknown) => ipcRenderer.invoke('deviceSale:collect', input),
  deviceSaleList: (filter: unknown) => ipcRenderer.invoke('deviceSale:list', filter),
  deviceSaleReceivables: () => ipcRenderer.invoke('deviceSale:receivables'),
  posReportDamage: (serial: string, input: unknown) => ipcRenderer.invoke('pos:reportDamage', { serial, input }),
  posSendRepair: (serial: string, input: unknown) => ipcRenderer.invoke('pos:sendRepair', { serial, input }),
  posReceiveRepaired: (serial: string, input: unknown) => ipcRenderer.invoke('pos:receiveRepaired', { serial, input }),
  posRetire: (serial: string, password: string, input: unknown) => ipcRenderer.invoke('pos:retire', { serial, password, input }),

  // TIDs (G-POS.1)
  tidList: (filter: unknown) => ipcRenderer.invoke('tid:list', filter),
  tidUndelivered: () => ipcRenderer.invoke('tid:undelivered'),
  tidCreate: (input: unknown) => ipcRenderer.invoke('tid:create', input),
  tidRefs: () => ipcRenderer.invoke('tid:refs'),
  tidTimeline: (tid: string) => ipcRenderer.invoke('tid:timeline', tid),
  tidRevenueRanking: (filter: unknown) => ipcRenderer.invoke('tid:revenueRanking', filter),
  tidAssign: (tid: string, input: unknown) => ipcRenderer.invoke('tid:assign', { tid, input }),
  tidReplace: (tid: string, input: unknown) => ipcRenderer.invoke('tid:replace', { tid, input }),
  tidRecall: (tid: string, input: unknown) => ipcRenderer.invoke('tid:recall', { tid, input }),
  tidMarkDelivered: (tid: string, input: unknown) => ipcRenderer.invoke('tid:markDelivered', { tid, input }),
  tidSellFeeList: (tidId: number, feeTypeId: number) => ipcRenderer.invoke('tid:sellFeeList', { tidId, feeTypeId }),
  tidSellFeeSet: (input: unknown) => ipcRenderer.invoke('tid:sellFeeSet', input),

  // Notifications (undelivered TID)
  notifyUndeliveredSummary: () => ipcRenderer.invoke('notify:undeliveredSummary'),
  notifyPushUndelivered: () => ipcRenderer.invoke('notify:pushUndelivered'),

  // Cấu hình ngân hàng (G-CFG.1)
  warehouseList: (filter: unknown) => ipcRenderer.invoke('warehouse:list', filter),
  warehouseLite: () => ipcRenderer.invoke('warehouse:lite'),
  warehouseManagerCandidates: () => ipcRenderer.invoke('warehouse:managerCandidates'),
  warehouseCreate: (input: unknown) => ipcRenderer.invoke('warehouse:create', input),
  warehouseUpdate: (id: number, input: unknown) => ipcRenderer.invoke('warehouse:update', { id, input }),
  warehouseDelete: (ids: number[], password: string) => ipcRenderer.invoke('warehouse:delete', { ids, password }),
  bankList: (filter: unknown) => ipcRenderer.invoke('bank:list', filter),
  bankLite: () => ipcRenderer.invoke('bank:lite'),
  bankCreate: (input: unknown) => ipcRenderer.invoke('bank:create', input),
  bankUpdate: (id: number, input: unknown) => ipcRenderer.invoke('bank:update', { id, input }),
  bankDelete: (ids: number[], password: string) => ipcRenderer.invoke('bank:delete', { ids, password }),

  cardTypeList: (filter: unknown) => ipcRenderer.invoke('cardType:list', filter),
  cardTypeCreate: (input: unknown) => ipcRenderer.invoke('cardType:create', input),
  cardTypeUpdate: (id: number, input: unknown) => ipcRenderer.invoke('cardType:update', { id, input }),
  cardTypeDelete: (ids: number[], password: string) => ipcRenderer.invoke('cardType:delete', { ids, password }),

  partnerList: (filter: unknown) => ipcRenderer.invoke('partner:list', filter),
  partnerCreate: (input: unknown) => ipcRenderer.invoke('partner:create', input),
  partnerUpdate: (id: number, input: unknown) => ipcRenderer.invoke('partner:update', { id, input }),
  partnerDelete: (ids: number[], password: string) => ipcRenderer.invoke('partner:delete', { ids, password }),
  partnerBankMatrix: () => ipcRenderer.invoke('partnerBank:matrix'),
  partnerBankSet: (partnerId: number, bankIds: number[]) => ipcRenderer.invoke('partnerBank:set', { partnerId, bankIds }),
  statusOptionList: (entity: string, includeInactive?: boolean) => ipcRenderer.invoke('statusOption:list', { entity, includeInactive }),
  statusOptionListMany: (entities: string[]) => ipcRenderer.invoke('statusOption:listMany', entities),
  statusOptionEntities: () => ipcRenderer.invoke('statusOption:entities'),
  statusOptionCreate: (input: unknown) => ipcRenderer.invoke('statusOption:create', input),
  statusOptionUpdate: (id: number, input: unknown) => ipcRenderer.invoke('statusOption:update', { id, input }),
  statusOptionDelete: (id: number) => ipcRenderer.invoke('statusOption:delete', id),

  // Cấu hình cung ứng POS (G-CFG.2 §C6–C8)
  supplierList: (filter: unknown) => ipcRenderer.invoke('supplier:list', filter),
  supplierLite: () => ipcRenderer.invoke('supplier:lite'),
  supplierCreate: (input: unknown) => ipcRenderer.invoke('supplier:create', input),
  supplierUpdate: (id: number, input: unknown) => ipcRenderer.invoke('supplier:update', { id, input }),
  supplierDelete: (ids: number[], password: string) => ipcRenderer.invoke('supplier:delete', { ids, password }),

  posModelList: (filter: unknown) => ipcRenderer.invoke('posModel:list', filter),
  posModelLite: () => ipcRenderer.invoke('posModel:lite'),
  posModelCreate: (input: unknown) => ipcRenderer.invoke('posModel:create', input),
  posModelUpdate: (id: number, input: unknown) => ipcRenderer.invoke('posModel:update', { id, input }),
  posModelDelete: (ids: number[], password: string) => ipcRenderer.invoke('posModel:delete', { ids, password }),

  intakeStatusList: () => ipcRenderer.invoke('intakeStatus:list'),
  intakeStatusCreate: (input: unknown) => ipcRenderer.invoke('intakeStatus:create', input),
  intakeStatusUpdate: (id: number, input: unknown) => ipcRenderer.invoke('intakeStatus:update', { id, input }),
  intakeStatusDelete: (ids: number[], password: string) => ipcRenderer.invoke('intakeStatus:delete', { ids, password }),

  posIntakeList: (filter: unknown) => ipcRenderer.invoke('posIntake:list', filter),
  posIntakeCreate: (input: unknown) => ipcRenderer.invoke('posIntake:create', input),
  posIntakeUpdate: (id: number, input: unknown) => ipcRenderer.invoke('posIntake:update', { id, input }),
  posIntakeDelete: (ids: number[], password: string) => ipcRenderer.invoke('posIntake:delete', { ids, password }),

  // Cấu hình phí (G-CFG.3 §C5)
  feeTypeList: () => ipcRenderer.invoke('feeType:list'),
  feeTypeCreate: (input: unknown) => ipcRenderer.invoke('feeType:create', input),
  feeTypeUpdate: (id: number, input: unknown) => ipcRenderer.invoke('feeType:update', { id, input }),
  feeTypeDelete: (ids: number[], password: string) => ipcRenderer.invoke('feeType:delete', { ids, password }),

  // LOẠI GIAO MÁY (Mr.Long) — danh mục loại giao + báo cáo cọc/doanh thu theo loại giao
  handoverTypeList: () => ipcRenderer.invoke('handoverType:list'),
  handoverTypeListLite: () => ipcRenderer.invoke('handoverType:listLite'),
  handoverTypeCreate: (input: unknown) => ipcRenderer.invoke('handoverType:create', input),
  handoverTypeUpdate: (id: number, input: unknown) => ipcRenderer.invoke('handoverType:update', { id, input }),
  handoverTypeDelete: (ids: number[], password: string) => ipcRenderer.invoke('handoverType:delete', { ids, password }),
  depositsHeld: (customerId?: number) => ipcRenderer.invoke('deposit:held', customerId),
  revenueByHandover: (filter: unknown) => ipcRenderer.invoke('deposit:revenueByHandover', filter),

  feeRateList: (filter: unknown) => ipcRenderer.invoke('feeRate:list', filter),
  feeRateSet: (input: unknown) => ipcRenderer.invoke('feeRate:set', input),
  feeRateDelete: (ids: number[], password: string) => ipcRenderer.invoke('feeRate:delete', { ids, password }),
  // FEE_MODEL — phí bán niêm yết hiệu lực theo loại phí (tham chiếu).
  feeSellQuoteList: (partnerId: number, cardTypeId: number, at?: string) => ipcRenderer.invoke('feeSellQuote:list', { partnerId, cardTypeId, at }),

  // Tài khoản nhận tiền – ủy quyền (G-CFG.4 §8)
  rcvSourceList: () => ipcRenderer.invoke('rcvSource:list'),
  rcvSourceCreate: (input: unknown) => ipcRenderer.invoke('rcvSource:create', input),
  rcvSourceUpdate: (id: number, input: unknown) => ipcRenderer.invoke('rcvSource:update', { id, input }),
  rcvSourceDelete: (ids: number[], password: string) => ipcRenderer.invoke('rcvSource:delete', { ids, password }),

  rcvAccountList: (filter: unknown) => ipcRenderer.invoke('rcvAccount:list', filter),
  rcvAccountCreate: (input: unknown) => ipcRenderer.invoke('rcvAccount:create', input),
  rcvAccountUpdate: (id: number, input: unknown) => ipcRenderer.invoke('rcvAccount:update', { id, input }),
  rcvAccountDelete: (ids: number[], password: string) => ipcRenderer.invoke('rcvAccount:delete', { ids, password }),

  pickImage: () => ipcRenderer.invoke('file:pickImage'),
  readAttachment: (relPath: string) => ipcRenderer.invoke('file:read', relPath),

  // Quản lý Hồ sơ HKD (G-CFG.5 §10)
  dossierSourceList: () => ipcRenderer.invoke('dossierSource:list'),
  dossierSourceCreate: (input: unknown) => ipcRenderer.invoke('dossierSource:create', input),
  dossierSourceUpdate: (id: number, input: unknown) => ipcRenderer.invoke('dossierSource:update', { id, input }),
  dossierSourceDelete: (ids: number[], password: string) => ipcRenderer.invoke('dossierSource:delete', { ids, password }),

  dossierList: (filter: unknown) => ipcRenderer.invoke('dossier:list', filter),
  dossierCreate: (input: unknown) => ipcRenderer.invoke('dossier:create', input),
  dossierUpdate: (id: number, input: unknown) => ipcRenderer.invoke('dossier:update', { id, input }),
  dossierDelete: (ids: number[], password: string) => ipcRenderer.invoke('dossier:delete', { ids, password }),

  // Cấu hình TID (G-CFG.6 §9)
  tidStatusList: () => ipcRenderer.invoke('tidStatus:list'),
  tidStatusCreate: (input: unknown) => ipcRenderer.invoke('tidStatus:create', input),
  tidStatusUpdate: (id: number, input: unknown) => ipcRenderer.invoke('tidStatus:update', { id, input }),
  tidStatusDelete: (ids: number[], password: string) => ipcRenderer.invoke('tidStatus:delete', { ids, password }),

  tidConfigList: (filter: unknown) => ipcRenderer.invoke('tidConfig:list', filter),
  tidConfigCreate: (input: unknown) => ipcRenderer.invoke('tidConfig:create', input),
  tidConfigUpdate: (id: number, input: unknown) => ipcRenderer.invoke('tidConfig:update', { id, input }),

  // Cấu hình ngành nghề (G-CFG.7 §11 Pha I1)
  industryList: (filter: unknown) => ipcRenderer.invoke('industry:list', filter),
  industryCreate: (input: unknown) => ipcRenderer.invoke('industry:create', input),
  industryUpdate: (id: number, input: unknown) => ipcRenderer.invoke('industry:update', { id, input }),
  industryDelete: (ids: number[], password: string) => ipcRenderer.invoke('industry:delete', { ids, password }),
  // ── PHASE H1 — Thu–Chi: danh mục thu/chi ──
  cashCategoryList: (filter: unknown) => ipcRenderer.invoke('cashCategory:list', filter),
  cashCategoryCreate: (input: unknown) => ipcRenderer.invoke('cashCategory:create', input),
  cashCategoryUpdate: (id: number, input: unknown) => ipcRenderer.invoke('cashCategory:update', { id, input }),
  cashCategoryDelete: (ids: number[], password: string) => ipcRenderer.invoke('cashCategory:remove', { ids, password }),
  // ── PHASE H2-core — Thu–Chi: Quỹ + Phiếu thu/chi ──
  fundList: (filter: unknown) => ipcRenderer.invoke('fund:list', filter),
  fundUserLite: () => ipcRenderer.invoke('fund:userLite'),
  fundCreate: (input: unknown) => ipcRenderer.invoke('fund:create', input),
  fundUpdate: (id: number, input: unknown) => ipcRenderer.invoke('fund:update', { id, input }),
  fundDelete: (ids: number[], password: string) => ipcRenderer.invoke('fund:remove', { ids, password }),
  cashEntryList: (filter: unknown) => ipcRenderer.invoke('cashEntry:list', filter),
  cashEntryReport: (filter: unknown) => ipcRenderer.invoke('cashEntry:report', filter),
  cashEntryCategoryLite: () => ipcRenderer.invoke('cashEntry:categoryLite'),
  cashEntryCreate: (input: unknown) => ipcRenderer.invoke('cashEntry:create', input),
  cashEntryCreateDebtReceipt: (input: unknown) => ipcRenderer.invoke('cashEntry:createDebtReceipt', input),
  cashEntryCancel: (id: number, reason: string, password: string) => ipcRenderer.invoke('cashEntry:cancel', { id, reason, password }),

  // Nhập liệu hàng loạt từ Excel (#9)
  // Xuất Excel chuẩn nhà (.xlsx) → lưu qua hộp thoại + mở file (R38/R39).
  reportExport: (p: { kind?: 'report' | 'template'; fileBase: string; fileName: string; title: string; headers: string[]; rows?: (string | number | null | undefined)[][]; summary?: string; hints?: { header: string; required?: boolean; hint?: string }[] }) => ipcRenderer.invoke('report:export', p),
  openFilePath: (path: string) => ipcRenderer.invoke('file:open', path),

  importTemplate: (entityKey: string) => ipcRenderer.invoke('import:template', entityKey),
  importDryRun: (entityKey: string, rows: Record<string, unknown>[]) => ipcRenderer.invoke('import:dryRun', { entityKey, rows }),
  importRun: (entityKey: string, rows: Record<string, unknown>[]) => ipcRenderer.invoke('import:run', { entityKey, rows }),

  // Thùng rác (E4)
  trashList: () => ipcRenderer.invoke('trash:list'),
  trashRestore: (entityType: string, id: number) => ipcRenderer.invoke('trash:restore', { entityType, id }),
  trashLinkSummary: (entityType: string, id: number) => ipcRenderer.invoke('trash:linkSummary', { entityType, id }),
  trashPurge: (entityType: string, id: number, password: string) => ipcRenderer.invoke('trash:purge', { entityType, id, password }),
  trashEmptyAll: (level2Password: string) => ipcRenderer.invoke('trash:emptyAll', { level2Password }),

  // Dashboard (Nhóm B)
  dashboardStats: () => ipcRenderer.invoke('dashboard:stats'),
  dashboardProfit: () => ipcRenderer.invoke('dashboard:profit'),

  // Hòm thư nội bộ + thông báo bảo mật
  messageInbox: () => ipcRenderer.invoke('message:inbox'),
  messageUnreadCount: () => ipcRenderer.invoke('message:unreadCount'),
  messageMarkRead: (id: number) => ipcRenderer.invoke('message:markRead', id),
  messageMarkAllRead: () => ipcRenderer.invoke('message:markAllRead'),
  messageSend: (input: { recipientId: number; subject: string; body: string }) => ipcRenderer.invoke('message:send', input),

  // Doanh thu & Công nợ (Nhóm B)
  transactionList: (filter: unknown) => ipcRenderer.invoke('transaction:list', filter),
  transactionCreate: (input: unknown) => ipcRenderer.invoke('transaction:create', input),
  revenueByFeeType: (filter: unknown) => ipcRenderer.invoke('transaction:revenueByFeeType', filter),
  transactionDelete: (ids: number[], password: string) => ipcRenderer.invoke('transaction:delete', { ids, password }),
  // FIX 2 — GỠ transactionSettle (H5): handler 'transaction:settle' đã gỡ → gọi sẽ reject "No handler". API chết.
  debtSummary: (filter: unknown) => ipcRenderer.invoke('debt:summary', filter),
  debtOpenTransactions: (filter: unknown) => ipcRenderer.invoke('debt:openTransactions', filter),
  // H2b — phân loại chất lượng công nợ + ghi giảm nợ xấu
  debtByQuality: (filter: unknown) => ipcRenderer.invoke('debt:byQuality', filter),
  debtClassify: (transactionId: number, quality: string, reason?: string) => ipcRenderer.invoke('debt:classify', { transactionId, quality, reason }),
  debtQualityHistory: (transactionId: number) => ipcRenderer.invoke('debt:qualityHistory', transactionId),
  debtWriteOff: (transactionId: number, actorPassword: string) => ipcRenderer.invoke('debt:writeOff', { transactionId, actorPassword }),

  // Duyệt hủy bill (P1.2 Approval Engine)
  cancelRequest: (transactionId: number, reason: string) => ipcRenderer.invoke('approval:requestCancel', { transactionId, reason }),
  cancelRequestList: (status?: string) => ipcRenderer.invoke('approval:list', status),
  globalSearch: (q: string) => ipcRenderer.invoke('search:global', q),
  cancelApprove: (requestId: number, password: string, note?: string) => ipcRenderer.invoke('approval:approve', { requestId, password, note }),
  cancelReject: (requestId: number, note: string) => ipcRenderer.invoke('approval:reject', { requestId, note }),
  cancelApproveBulk: (requestIds: number[], password: string, note?: string) => ipcRenderer.invoke('approval:approveBulk', { requestIds, password, note }),
  cancelRejectBulk: (requestIds: number[], note: string) => ipcRenderer.invoke('approval:rejectBulk', { requestIds, note }),
  // R34 — Duyệt hủy (xóa qua duyệt) TID/POS/Khách/Nhân sự.
  entityCancelRequest: (entityType: string, entityId: number, reason: string) => ipcRenderer.invoke('entityCancel:request', { entityType, entityId, reason }),
  entityCancelList: (status?: string, entityType?: string) => ipcRenderer.invoke('entityCancel:list', { status, entityType }),
  entityCancelApprove: (entityType: string, requestId: number, password: string, note?: string) => ipcRenderer.invoke('entityCancel:approve', { entityType, requestId, password, note }),
  entityCancelReject: (entityType: string, requestId: number, note: string) => ipcRenderer.invoke('entityCancel:reject', { entityType, requestId, note }),
  exportReqCreate: (input: unknown) => ipcRenderer.invoke('exportReq:create', input),
  exportReqList: (filter?: unknown) => ipcRenderer.invoke('exportReq:list', filter),
  exportReqApprove: (requestId: number, lines: unknown, password: string, note?: string) => ipcRenderer.invoke('exportReq:approve', { requestId, lines, password, note }),
  exportReqReject: (requestId: number, note: string) => ipcRenderer.invoke('exportReq:reject', { requestId, note }),
  exportReqCancel: (requestId: number, note?: string) => ipcRenderer.invoke('exportReq:cancel', { requestId, note }),

  // Bảo trì & Bộ nhớ (Nhóm E — Storage-Guard)
  storageStatus: () => ipcRenderer.invoke('storage:status'),
  storageCleanup: (opts: { clearHistory?: boolean; purgeTrash?: boolean; password: string }) => ipcRenderer.invoke('storage:cleanup', opts),
  storageUpdateConfig: (cfg: { thresholdPct?: number; auditRetentionDays?: number; trashRetentionDays?: number; backupIntervalHours?: number; maintenanceDayOfWeek?: number; maintenanceHour?: number; maintenanceEnabled?: boolean; autoPurgeWeekly?: boolean }) => ipcRenderer.invoke('storage:updateConfig', cfg),

  // Bảo trì: quét sức khỏe toàn hệ thống + lịch sử bảo trì
  healthScan: (opts: { autoFix?: boolean }) => ipcRenderer.invoke('health:scan', opts),
  healthRuns: (limit?: number) => ipcRenderer.invoke('health:runs', limit),
  healthRun: (id: number) => ipcRenderer.invoke('health:run', id),

  // ── G11 Cập nhật phần mềm tích hợp (electron-updater) ──
  // Lệnh (renderer → main):
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  startUpdate: () => ipcRenderer.invoke('update:start'),
  installUpdateNow: () => ipcRenderer.invoke('update:installNow'),
  // [H2] Kết quả BOOT (success/failed) lấy bằng PULL lúc mount (KHÔNG nghe push — push rơi trước mount).
  getUpdateBootResult: () => ipcRenderer.invoke('update:getBootResult'),
  // Sự kiện realtime (main → renderer). Trả hàm hủy đăng ký để cleanup lúc unmount ([M8]).
  onUpdateAvailable: (cb: (p: { version: string }) => void) => {
    const h = (_e: unknown, p: { version: string }): void => cb(p);
    ipcRenderer.on('update-available', h);
    return () => ipcRenderer.removeListener('update-available', h);
  },
  onDownloadProgress: (cb: (p: { percent: number }) => void) => {
    const h = (_e: unknown, p: { percent: number }): void => cb(p);
    ipcRenderer.on('download-progress', h);
    return () => ipcRenderer.removeListener('download-progress', h);
  },
  onUpdateDownloaded: (cb: (p: { version: string }) => void) => {
    const h = (_e: unknown, p: { version: string }): void => cb(p);
    ipcRenderer.on('update-downloaded', h);
    return () => ipcRenderer.removeListener('update-downloaded', h);
  },
  onUpdateError: (cb: (p: { message: string }) => void) => {
    const h = (_e: unknown, p: { message: string }): void => cb(p);
    ipcRenderer.on('update-error', h);
    return () => ipcRenderer.removeListener('update-error', h);
  }
};

export type GlbApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
