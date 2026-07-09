import type { AuthUser, ValidationResult } from '@glb/shared';

export interface LoginOutcome {
  ok: boolean;
  user?: AuthUser;
  mustChangePassword?: boolean;
  error?: string;
  message?: string;
}
export interface MutationOutcome {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
  filePath?: string;
}
export interface RememberedCreds {
  username: string;
  password: string;
}

export interface RoleDto {
  id: number;
  name: string;
  code: string;
  description: string | null;
  status: string;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}
export interface PermissionDto {
  code: string;
  name: string;
  group: string | null;
}
export interface UserDto {
  id: number;
  employeeCode: string | null;
  fullName: string;
  birthDate: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  username: string;
  status: string;
  forceChangePassword: boolean;
  joinedAt: string | null;
  createdAt: string;
  roles: string[];
}
export interface AuditRowDto {
  id: number;
  actorUserId: number | null;
  actorUsername: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  ipAddress: string | null;
  deviceInfo: string | null;
  createdAt: string;
}
export interface BackupDto {
  id: number;
  filePath: string;
  fileName: string;
  fileSize: number | null;
  checksum: string | null;
  createdBy: number | null;
  createdAt: string;
  note: string | null;
  exists: boolean;
}
export interface SettingDto {
  key: string;
  value: string | null;
}

// ── G-POS.1 DTOs ──
export interface CustomerDto {
  id: number;
  code: string;
  fullName: string;
  nickname: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  agentId: number | null;
  note: string | null;
  display: string;
  createdAt: string;
}
export interface AgentDto {
  id: number;
  code: string | null;
  name: string;
  region: string | null;
}
export interface PosDto {
  id: number;
  serial: string;
  model: string | null;
  bank: string | null;
  status: string;
  currentAgentId: number | null;
  currentCustomerId: number | null;
  currentTid: string | null;
  warehouseLoc: string | null;
  note: string | null;
  createdAt: string;
}
export interface TimelineEventDto {
  id: number;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  fromAgentId: number | null;
  toAgentId: number | null;
  customerId: number | null;
  actorUserId: number | null;
  occurredAt: string;
  note: string | null;
}
export interface TidDto {
  id: number;
  tid: string;
  mid: string | null;
  bank: string | null;
  status: string;
  posSerial: string | null;
  customerId: number | null;
  agentId: number | null;
  openedAt: string | null;
  deliveredAt: string | null;
  closedAt: string | null;
  createdAt: string;
}
export interface UndeliveredTidDto extends TidDto {
  agingDays: number;
}
export interface UndeliveredSummary {
  count: number;
  totalAgingDays: number;
  topAgingDays: number;
  topTid: string | null;
}
export interface CustomerFilter {
  search?: string;
  agentId?: number;
  fromDate?: string;
  toDate?: string;
}
export interface CreateCustomerInput {
  fullName: string;
  nickname: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  agentId?: number | null;
  note?: string | null;
}
export interface UpdateCustomerInput {
  fullName?: string;
  nickname?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  agentId?: number | null;
  note?: string | null;
}
export interface PosFilter {
  search?: string;
  bank?: string;
  status?: string;
  agentId?: number;
  fromDate?: string;
  toDate?: string;
}
export interface CreatePosInput {
  serial: string;
  model?: string | null;
  bank?: string | null;
  warehouseLoc?: string | null;
  note?: string | null;
  occurredAt?: string | null;
}
export interface TransitionInput {
  occurredAt?: string | null;
  note?: string | null;
  agentId?: number | null;
  customerId?: number | null;
}
export interface TidFilter {
  search?: string;
  bank?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
}
export interface CreateTidInput {
  tid: string;
  mid?: string | null;
  bank?: string | null;
  openedAt?: string | null;
}
export interface AssignTidInput {
  posSerial: string;
  customerId: number;
  occurredAt?: string | null;
  note?: string | null;
}
export interface ReplaceTidInput {
  newTid: string;
  occurredAt?: string | null;
  note?: string | null;
  unbindReason?: string | null;
}
export interface RecallTidInput {
  occurredAt?: string | null;
  note?: string | null;
}
export interface MarkDeliveredInput {
  deliveredAt?: string | null;
  note?: string | null;
}

export interface ListResult<T> {
  ok: boolean;
  data?: T[];
  error?: string;
  message?: string;
}

export interface RoleInput {
  name: string;
  code: string;
  description?: string;
  status?: string;
  permissionCodes: string[];
}
export interface CreateUserInput {
  fullName: string;
  birthDate?: string | null;
  gender?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  joinDate?: string | null;
  username: string;
  password: string;
  status?: string;
  roleCodes: string[];
}
export interface UpdateUserInput {
  fullName?: string;
  birthDate?: string | null;
  gender?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  joinDate?: string | null;
  status?: string;
  roleCodes?: string[];
}
export interface UserFilter {
  roleCode?: string;
  status?: string;
  search?: string;
}
export interface AuditQuery {
  action?: string;
  search?: string;
  limit?: number;
}

export interface GlbApi {
  login(username: string, password: string, remember: boolean): Promise<LoginOutcome>;
  me(): Promise<AuthUser | null>;
  logout(): Promise<{ ok: boolean }>;
  changePassword(currentPassword: string, newPassword: string): Promise<MutationOutcome>;
  validatePassword(pwd: string): Promise<ValidationResult>;
  getRemembered(): Promise<RememberedCreds | null>;
  saveRemembered(username: string, password: string): Promise<{ ok: boolean }>;
  clearRemembered(): Promise<{ ok: boolean }>;

  roleList(): Promise<ListResult<RoleDto>>;
  rolePermissions(): Promise<ListResult<PermissionDto>>;
  roleCreate(input: RoleInput): Promise<MutationOutcome>;
  roleUpdate(id: number, input: RoleInput): Promise<MutationOutcome>;
  roleLock(id: number): Promise<MutationOutcome>;
  roleUnlock(id: number): Promise<MutationOutcome>;
  roleDelete(id: number, password: string): Promise<MutationOutcome>;

  userList(filter: UserFilter): Promise<ListResult<UserDto>>;
  userCreate(input: CreateUserInput): Promise<MutationOutcome>;
  userUpdate(id: number, input: UpdateUserInput): Promise<MutationOutcome>;
  userLock(id: number): Promise<MutationOutcome>;
  userUnlock(id: number): Promise<MutationOutcome>;
  userDelete(id: number, password: string): Promise<MutationOutcome>;

  auditList(query: AuditQuery): Promise<ListResult<AuditRowDto>>;

  backupCreate(note?: string): Promise<MutationOutcome>;
  backupList(): Promise<ListResult<BackupDto>>;
  backupRestore(filePath: string, password: string): Promise<MutationOutcome>;

  settingList(): Promise<ListResult<SettingDto>>;
  settingUpdate(key: string, value: string): Promise<MutationOutcome>;

  // ── G-POS.1 ──
  customerList(filter: CustomerFilter): Promise<ListResult<CustomerDto>>;
  customerCreate(input: CreateCustomerInput): Promise<MutationOutcome>;
  customerUpdate(id: number, input: UpdateCustomerInput): Promise<MutationOutcome>;
  customerDelete(id: number, password: string): Promise<MutationOutcome>;
  agentList(): Promise<ListResult<AgentDto>>;

  posList(filter: PosFilter): Promise<ListResult<PosDto>>;
  posTimeline(serial: string): Promise<ListResult<TimelineEventDto>>;
  posCreate(input: CreatePosInput): Promise<MutationOutcome>;
  posDeploy(serial: string, input: TransitionInput): Promise<MutationOutcome>;
  posRecall(serial: string, input: TransitionInput): Promise<MutationOutcome>;
  posTransferAgent(serial: string, input: TransitionInput): Promise<MutationOutcome>;
  posReportDamage(serial: string, input: TransitionInput): Promise<MutationOutcome>;
  posSendRepair(serial: string, input: TransitionInput): Promise<MutationOutcome>;
  posReceiveRepaired(serial: string, input: TransitionInput): Promise<MutationOutcome>;
  posRetire(serial: string, password: string, input: TransitionInput): Promise<MutationOutcome>;

  tidList(filter: TidFilter): Promise<ListResult<TidDto>>;
  tidUndelivered(): Promise<ListResult<UndeliveredTidDto>>;
  tidCreate(input: CreateTidInput): Promise<MutationOutcome>;
  tidAssign(tid: string, input: AssignTidInput): Promise<MutationOutcome>;
  tidReplace(tid: string, input: ReplaceTidInput): Promise<MutationOutcome>;
  tidRecall(tid: string, input: RecallTidInput): Promise<MutationOutcome>;
  tidMarkDelivered(tid: string, input: MarkDeliveredInput): Promise<MutationOutcome>;

  notifyUndeliveredSummary(): Promise<{ ok: boolean; data?: UndeliveredSummary; error?: string; message?: string }>;
  notifyPushUndelivered(): Promise<{ ok: boolean; stub: true; message?: string; error?: string }>;
}

declare global {
  interface Window {
    api: GlbApi;
  }
}
