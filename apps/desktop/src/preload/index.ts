// Preload — the ONLY bridge between renderer and main. Exposes a typed `window.api`.
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Auth
  login: (username: string, password: string, remember: boolean) =>
    ipcRenderer.invoke('auth:login', { username, password, remember }),
  me: () => ipcRenderer.invoke('auth:me'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    ipcRenderer.invoke('auth:changePassword', { currentPassword, newPassword }),
  validatePassword: (pwd: string) => ipcRenderer.invoke('auth:validatePassword', pwd),
  getRemembered: () => ipcRenderer.invoke('auth:getRemembered'),
  saveRemembered: (username: string, password: string) =>
    ipcRenderer.invoke('auth:saveRemembered', { username, password }),
  clearRemembered: () => ipcRenderer.invoke('auth:clearRemembered'),

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
  userDelete: (id: number, password: string) => ipcRenderer.invoke('user:delete', { id, password }),

  // Audit
  auditList: (query: unknown) => ipcRenderer.invoke('audit:list', query),

  // Backup / Restore
  backupCreate: (note?: string) => ipcRenderer.invoke('backup:create', note),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupRestore: (filePath: string, password: string) =>
    ipcRenderer.invoke('backup:restore', { filePath, password }),

  // Settings
  settingList: () => ipcRenderer.invoke('setting:list'),
  settingUpdate: (key: string, value: string) => ipcRenderer.invoke('setting:update', { key, value }),

  // Customers (G-POS.1)
  customerList: (filter: unknown) => ipcRenderer.invoke('customer:list', filter),
  customerCreate: (input: unknown) => ipcRenderer.invoke('customer:create', input),
  customerUpdate: (id: number, input: unknown) => ipcRenderer.invoke('customer:update', { id, input }),
  customerDelete: (id: number, password: string) => ipcRenderer.invoke('customer:delete', { id, password }),
  agentList: () => ipcRenderer.invoke('agent:list'),

  // POS devices (G-POS.1)
  posList: (filter: unknown) => ipcRenderer.invoke('pos:list', filter),
  posTimeline: (serial: string) => ipcRenderer.invoke('pos:timeline', serial),
  posCreate: (input: unknown) => ipcRenderer.invoke('pos:create', input),
  posDeploy: (serial: string, input: unknown) => ipcRenderer.invoke('pos:deploy', { serial, input }),
  posRecall: (serial: string, input: unknown) => ipcRenderer.invoke('pos:recall', { serial, input }),
  posTransferAgent: (serial: string, input: unknown) => ipcRenderer.invoke('pos:transferAgent', { serial, input }),
  posReportDamage: (serial: string, input: unknown) => ipcRenderer.invoke('pos:reportDamage', { serial, input }),
  posSendRepair: (serial: string, input: unknown) => ipcRenderer.invoke('pos:sendRepair', { serial, input }),
  posReceiveRepaired: (serial: string, input: unknown) => ipcRenderer.invoke('pos:receiveRepaired', { serial, input }),
  posRetire: (serial: string, password: string, input: unknown) => ipcRenderer.invoke('pos:retire', { serial, password, input }),

  // TIDs (G-POS.1)
  tidList: (filter: unknown) => ipcRenderer.invoke('tid:list', filter),
  tidUndelivered: () => ipcRenderer.invoke('tid:undelivered'),
  tidCreate: (input: unknown) => ipcRenderer.invoke('tid:create', input),
  tidAssign: (tid: string, input: unknown) => ipcRenderer.invoke('tid:assign', { tid, input }),
  tidReplace: (tid: string, input: unknown) => ipcRenderer.invoke('tid:replace', { tid, input }),
  tidRecall: (tid: string, input: unknown) => ipcRenderer.invoke('tid:recall', { tid, input }),
  tidMarkDelivered: (tid: string, input: unknown) => ipcRenderer.invoke('tid:markDelivered', { tid, input }),

  // Notifications (undelivered TID)
  notifyUndeliveredSummary: () => ipcRenderer.invoke('notify:undeliveredSummary'),
  notifyPushUndelivered: () => ipcRenderer.invoke('notify:pushUndelivered'),

  // Cấu hình ngân hàng (G-CFG.1)
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

  feeRateList: (filter: unknown) => ipcRenderer.invoke('feeRate:list', filter),
  feeRateSet: (input: unknown) => ipcRenderer.invoke('feeRate:set', input),
  feeRateDelete: (ids: number[], password: string) => ipcRenderer.invoke('feeRate:delete', { ids, password }),

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
  tidConfigDelete: (ids: number[], password: string) => ipcRenderer.invoke('tidConfig:delete', { ids, password }),

  // Thùng rác (E4)
  trashList: () => ipcRenderer.invoke('trash:list'),
  trashRestore: (entityType: string, id: number) => ipcRenderer.invoke('trash:restore', { entityType, id }),
  trashLinkSummary: (entityType: string, id: number) => ipcRenderer.invoke('trash:linkSummary', { entityType, id })
};

export type GlbApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
