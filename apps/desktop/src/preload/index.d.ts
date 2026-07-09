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
}

declare global {
  interface Window {
    api: GlbApi;
  }
}
