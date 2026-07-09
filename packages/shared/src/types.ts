// Shared domain types — no runtime deps, safe to import from renderer, main, rules & tests.

export type UserStatus = 'ACTIVE' | 'PENDING' | 'LOCKED' | 'DISABLED' | 'DELETED';

export type RoleStatus = 'ACTIVE' | 'LOCKED';

/** Minimal user shape carried in a session / used by permission + auth rules. */
export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  status: UserStatus;
  forceChangePassword: boolean;
  /** Role codes assigned to the user (e.g. ['ADMIN']). */
  roles: string[];
  /** Effective permission codes (flattened from all roles). */
  permissions: string[];
}

export interface LoginRequest {
  username: string;
  password: string;
  remember?: boolean;
}

export interface LoginResult {
  ok: boolean;
  /** Present when ok. */
  user?: AuthUser;
  /** Error code for failed login, e.g. INVALID_CREDENTIALS / STATUS_BLOCKED. */
  error?: string;
  message?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ApiOk<T> {
  ok: true;
  data: T;
}
export interface ApiErr {
  ok: false;
  error: string;
  message: string;
}
export type ApiResult<T> = ApiOk<T> | ApiErr;

/** Audit action codes (IMS_SPEC §16). */
export type AuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_LOCKED'
  | 'USER_UNLOCKED'
  | 'USER_DELETED'
  | 'ROLE_CREATED'
  | 'ROLE_UPDATED'
  | 'ROLE_LOCKED'
  | 'ROLE_UNLOCKED'
  | 'ROLE_DELETED'
  | 'PASSWORD_CHANGED'
  | 'BACKUP_CREATED'
  | 'RESTORE_EXECUTED'
  | 'SETTING_UPDATED';
