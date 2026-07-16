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
  | 'WAREHOUSE_CREATED'
  | 'WAREHOUSE_UPDATED'
  | 'WAREHOUSE_DELETED'
  | 'WAREHOUSE_PERMS_GRANTED'
  | 'DEVICE_SOLD'
  | 'TID_SOLD'
  | 'DEVICE_SALE_COLLECT'
  | 'DEVICE_SALE_PERMS_GRANTED'
  | 'POS_CANCEL_CUSTOMER'
  | 'CARD_TYPE_CREATED'
  | 'CARD_TYPE_UPDATED'
  | 'CARD_TYPE_DELETED'
  | 'PARTNER_CREATED'
  | 'PARTNER_UPDATED'
  | 'PARTNER_DELETED'
  | 'PARTNER_BANK_LINKED'
  | 'PARTNER_BANK_UNLINKED'
  | 'STATUS_OPTION_CREATED'
  | 'STATUS_OPTION_UPDATED'
  | 'STATUS_OPTION_DELETED'
  | 'TID_SELL_FEE_SET'
  // ── R34 — Duyệt hủy (xóa qua duyệt) TID / POS / Khách / Nhân sự ──
  | 'TID_CANCEL_REQUESTED'
  | 'TID_CANCEL_APPROVED'
  | 'TID_CANCEL_REJECTED'
  | 'POS_CANCEL_REQUESTED'
  | 'POS_CANCEL_APPROVED'
  | 'POS_CANCEL_REJECTED'
  | 'CUSTOMER_CANCEL_REQUESTED'
  | 'CUSTOMER_CANCEL_APPROVED'
  | 'CUSTOMER_CANCEL_REJECTED'
  | 'USER_CANCEL_REQUESTED'
  | 'USER_CANCEL_APPROVED'
  | 'USER_CANCEL_REJECTED'
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
  // ── PHASE K1 — Hợp nhất POS ──
  | 'POS_UNIFY_BACKFILL'
  // ── PHASE K2 — Hợp nhất TID ──
  | 'TID_UNIFY_DOSSIER_BACKFILL'
  // ── G-CFG.3 (§C5) — Cấu hình phí ──
  | 'FEE_TYPE_CREATED'
  | 'FEE_TYPE_UPDATED'
  | 'FEE_TYPE_DELETED'
  | 'FEE_RATE_SET'
  | 'FEE_RATE_DELETED'
  // ── LOẠI GIAO MÁY (Mr.Long) — danh mục loại giao (Bán/Cho thuê/Mượn/Cọc) ──
  | 'HANDOVER_TYPE_CREATED'
  | 'HANDOVER_TYPE_UPDATED'
  | 'HANDOVER_TYPE_DELETED'
  | 'HANDOVER_PERMS_GRANTED'
  // ── G-CFG.4 (§8) — Tài khoản nhận tiền – ủy quyền ──
  | 'RCV_ACCT_SOURCE_CREATED'
  | 'RCV_ACCT_SOURCE_UPDATED'
  | 'RCV_ACCT_SOURCE_DELETED'
  | 'RCV_ACCT_CREATED'
  | 'RCV_ACCT_UPDATED'
  | 'RCV_ACCT_DELETED'
  | 'DOSSIER_SOURCE_CREATED'
  | 'DOSSIER_SOURCE_UPDATED'
  | 'DOSSIER_SOURCE_DELETED'
  | 'DOSSIER_CREATED'
  | 'DOSSIER_UPDATED'
  | 'DOSSIER_DELETED'
  | 'TID_CONFIG_STATUS_CREATED'
  | 'TID_CONFIG_STATUS_UPDATED'
  | 'TID_CONFIG_STATUS_DELETED'
  | 'TID_CONFIG_CREATED'
  | 'TID_CONFIG_UPDATED'
  | 'TID_CONFIG_DELETED'
  // ── G-CFG.7 (§11 Pha I1) — Cấu hình ngành nghề ──
  | 'INDUSTRY_CREATED'
  | 'INDUSTRY_UPDATED'
  | 'INDUSTRY_DELETED'
  | 'INDUSTRY_PERMS_GRANTED'
  // ── PHASE H1 — Thu–Chi: danh mục thu/chi (CashCategory) ──
  | 'CASH_CATEGORY_CREATED'
  | 'CASH_CATEGORY_UPDATED'
  | 'CASH_CATEGORY_DELETED'
  | 'CASHCAT_PERMS_GRANTED'
  // ── PHASE H2-core — Thu–Chi: Quỹ + Phiếu thu/chi ──
  | 'FUND_CREATED'
  | 'FUND_UPDATED'
  | 'FUND_DELETED'
  | 'CASH_ENTRY_CREATED'
  | 'CASH_ENTRY_CANCELLED'
  | 'CASH_DEBT_RECEIPT_CREATED'
  | 'CASHFLOW_PERMS_GRANTED'
  // ── H2b — phân loại chất lượng công nợ + ghi giảm nợ xấu ──
  | 'DEBT_CLASSIFIED'
  | 'DEBT_WRITTEN_OFF'
  | 'DEBT_QUALITY_PERMS_GRANTED'
  // ── Nhóm A — Bảo mật & tài khoản ──
  | 'USER_AUTO_LOCKED'
  | 'USER_AUTO_UNLOCKED'
  | 'PASSWORD_RESET_BY_ADMIN'
  | 'LEVEL2_SET'
  | 'LEVEL2_RESET'
  | 'TRASH_PURGED'
  | 'TRASH_EMPTIED'
  // ── Nhóm C — Hòm thư nội bộ ──
  | 'MESSAGE_SENT'
  // ── Nhóm B — Doanh thu & Công nợ ──
  | 'TRANSACTION_CREATED'
  | 'TRANSACTION_UPDATED'
  | 'TRANSACTION_DELETED'
  | 'DEBT_SETTLED'
  // ── P1.2 — Duyệt hủy bill ──
  | 'BILL_CANCEL_REQUESTED'
  | 'BILL_CANCEL_APPROVED'
  | 'BILL_CANCEL_REJECTED'
  // ── PHASE 1 (Mr.Long 13/7) — Yêu cầu xuất kho POS/TID → Duyệt → đối trừ tồn kho ──
  | 'EXPORT_REQUEST_CREATED'
  | 'EXPORT_REQUEST_APPROVED'
  | 'EXPORT_REQUEST_REJECTED'
  | 'EXPORT_REQUEST_CANCELLED'
  | 'EXPORT_REQ_PERMS_GRANTED'
  // ── Bill giải trình (Mr.Long 16/7) — thư viện sản phẩm + sinh bill ──
  | 'BILLEXPLAIN_PERMS_GRANTED'
  | 'PRODUCT_CREATED'
  | 'PRODUCT_UPDATED'
  | 'PRODUCT_DELETED'
  | 'PRODUCT_IMPORTED'
  | 'BILLEXPLAIN_CREATED'
  | 'BILLEXPLAIN_DELETED'
  // ── Nhóm E — Bảo trì & Bộ nhớ ──
  | 'AUTO_BACKUP'
  | 'AUTO_BACKUP_FAILED'
  | 'BACKUP_STALE'
  | 'BACKUP_MIRRORED'
  | 'BACKUP_MIRROR_FAILED'
  | 'STORAGE_ALERT'
  | 'STORAGE_CLEANUP'
  // Extra (superset of §16 minimum): a mutation refused because the actor lacked the
  // required permission MUST still be logged (R_AUDIT_003).
  | 'PERMISSION_DENIED';
