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
  | 'SETTING_UPDATED'
  // ── G-POS.1 (§A/§D) ──
  | 'CUSTOMER_CREATED'
  | 'CUSTOMER_UPDATED'
  | 'CUSTOMER_DELETED'
  | 'POS_CREATED'
  | 'POS_UPDATED'
  | 'POS_TRANSITION'
  | 'TID_CREATED'
  | 'TID_UPDATED'
  | 'TID_ASSIGNED'
  | 'TID_REPLACED'
  | 'TID_RECALLED'
  | 'TID_DELIVERED'
  | 'ASSET_EXPORTED'
  // ── G-CFG.1 (§C1–C4) — Cấu hình ngân hàng ──
  | 'BANK_CREATED'
  | 'BANK_UPDATED'
  | 'BANK_DELETED'
  | 'CARD_TYPE_CREATED'
  | 'CARD_TYPE_UPDATED'
  | 'CARD_TYPE_DELETED'
  | 'PARTNER_CREATED'
  | 'PARTNER_UPDATED'
  | 'PARTNER_DELETED'
  | 'PARTNER_BANK_LINKED'
  | 'PARTNER_BANK_UNLINKED'
  // ── G-CFG.2 (§C6–C8) — Cấu hình cung ứng POS ──
  | 'SUPPLIER_CREATED'
  | 'SUPPLIER_UPDATED'
  | 'SUPPLIER_DELETED'
  | 'POS_MODEL_CREATED'
  | 'POS_MODEL_UPDATED'
  | 'POS_MODEL_DELETED'
  | 'INTAKE_STATUS_CREATED'
  | 'INTAKE_STATUS_UPDATED'
  | 'INTAKE_STATUS_DELETED'
  | 'POS_INTAKE_CREATED'
  | 'POS_INTAKE_UPDATED'
  | 'POS_INTAKE_DELETED'
  // ── G-CFG.3 (§C5) — Cấu hình phí ──
  | 'FEE_TYPE_CREATED'
  | 'FEE_TYPE_UPDATED'
  | 'FEE_TYPE_DELETED'
  | 'FEE_RATE_SET'
  | 'FEE_RATE_DELETED'
  // Extra (superset of §16 minimum): a mutation refused because the actor lacked the
  // required permission MUST still be logged (R_AUDIT_003).
  | 'PERMISSION_DENIED';
