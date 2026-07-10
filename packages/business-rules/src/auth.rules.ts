// Auth business rules (IMS_SPEC §5, §10, §11). Pure logic — no DB, no Electron.
// The DB service (main process) fetches a UserRecord and delegates decisions here.
import bcrypt from 'bcryptjs';
import type { UserStatus } from '@glb/shared';

export const BCRYPT_ROUNDS = 10;
/** Pass cấp 2 (xóa vĩnh viễn) băm sâu hơn — cost cao chống dò/phá hoại. */
export const BCRYPT_ROUNDS_L2 = 12;
/** Sai xác thực quá số lần này (đăng nhập / đổi mật khẩu / pass cấp 2) → tự khóa tài khoản. */
export const MAX_FAILED_ATTEMPTS = 5;

/** Minimal record the auth rules need — DB layer maps its row into this shape. */
export interface AuthUserRecord {
  id: number;
  username: string;
  passwordHash: string;
  status: UserStatus;
  forceChangePassword: boolean;
}

export type LoginDenyReason =
  | 'INVALID_CREDENTIALS'
  | 'STATUS_PENDING'
  | 'STATUS_LOCKED'
  | 'STATUS_DISABLED'
  | 'STATUS_DELETED';

export interface LoginDecision {
  allowed: boolean;
  reason?: LoginDenyReason;
  mustChangePassword: boolean;
}

/** Statuses that may NOT log in (IMS_SPEC §11 R_USER_STATUS_001/003/004/005). */
const BLOCKED_STATUS: Record<Exclude<UserStatus, 'ACTIVE'>, LoginDenyReason> = {
  PENDING: 'STATUS_PENDING',
  LOCKED: 'STATUS_LOCKED',
  DISABLED: 'STATUS_DISABLED',
  DELETED: 'STATUS_DELETED'
};

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  if (!hash) return false;
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

/** True only for a real bcrypt hash (defence-in-depth: never store/compare plaintext). */
export function isBcryptHash(value: string): boolean {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$.{53}$/.test(value);
}

/** Băm mật khẩu CẤP 2 (cost cao hơn — mã hóa sâu, một chiều, không thể khôi phục). */
export function hashLevel2(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS_L2);
}

/** Đối chiếu mật khẩu cấp 2 với băm đã lưu. */
export function verifyLevel2(plain: string, hash: string | null | undefined): boolean {
  if (!hash) return false;
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

/** Sau lần xác thực SAI: đã chạm ngưỡng khóa chưa? (đếm gồm cả lần vừa sai) */
export function reachesLockout(failedAttempts: number): boolean {
  return failedAttempts >= MAX_FAILED_ATTEMPTS;
}

/**
 * Core login decision (R002 bcrypt, R003 force change, R_USER_STATUS_*).
 * Password is verified BEFORE returning STATUS_* so we never reveal status of a wrong-password attempt.
 * Returns INVALID_CREDENTIALS when the user is missing (caller passes null).
 */
export function decideLogin(record: AuthUserRecord | null, password: string): LoginDecision {
  if (!record) {
    return { allowed: false, reason: 'INVALID_CREDENTIALS', mustChangePassword: false };
  }
  if (!verifyPassword(password, record.passwordHash)) {
    return { allowed: false, reason: 'INVALID_CREDENTIALS', mustChangePassword: false };
  }
  if (record.status !== 'ACTIVE') {
    return { allowed: false, reason: BLOCKED_STATUS[record.status], mustChangePassword: false };
  }
  return { allowed: true, mustChangePassword: !!record.forceChangePassword };
}

/** Human-friendly Vietnamese message for a deny reason (for toast / audit note). */
export function loginDenyMessage(reason: LoginDenyReason): string {
  switch (reason) {
    case 'INVALID_CREDENTIALS':
      return 'Tên đăng nhập hoặc mật khẩu không đúng.';
    case 'STATUS_PENDING':
      return 'Tài khoản chưa được kích hoạt.';
    case 'STATUS_LOCKED':
      return 'Tài khoản đã bị khóa.';
    case 'STATUS_DISABLED':
      return 'Tài khoản đã ngưng sử dụng.';
    case 'STATUS_DELETED':
      return 'Tài khoản không tồn tại.';
    default:
      return 'Đăng nhập không hợp lệ.';
  }
}
