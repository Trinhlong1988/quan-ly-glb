// Validation rules (IMS_SPEC §10, §20). Pure, dependency-free, unit-tested.

/**
 * Username rule (IMS_SPEC §10): ^[A-Za-z0-9]{8,}$
 * - tối thiểu 8 ký tự
 * - không khoảng trắng, không ký tự đặc biệt, không dấu tiếng Việt
 * - chỉ A-Z a-z 0-9
 * NOTE: uniqueness is enforced separately at the DB layer, not here.
 */
export const USERNAME_REGEX = /^[A-Za-z0-9]{8,}$/;

export function isValidUsername(username: string): boolean {
  return typeof username === 'string' && USERNAME_REGEX.test(username);
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateUsername(username: string): ValidationResult {
  if (typeof username !== 'string' || username.length === 0) {
    return { valid: false, error: 'Tên đăng nhập không được để trống.' };
  }
  if (/\s/.test(username)) {
    return { valid: false, error: 'Tên đăng nhập không được chứa khoảng trắng.' };
  }
  if (username.length < 8) {
    return { valid: false, error: 'Tên đăng nhập phải có tối thiểu 8 ký tự.' };
  }
  if (!USERNAME_REGEX.test(username)) {
    return {
      valid: false,
      error: 'Tên đăng nhập chỉ được chứa chữ A-Z, a-z và số 0-9 (không dấu, không ký tự đặc biệt).'
    };
  }
  return { valid: true };
}

/**
 * Password policy for the force-change flow. Kept modest but non-trivial:
 * ≥8 chars, at least one letter and one digit. Admin default "Admin@123456" passes.
 */
export const PASSWORD_MIN_LENGTH = 8;

export function validatePassword(password: string): ValidationResult {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, error: `Mật khẩu phải có tối thiểu ${PASSWORD_MIN_LENGTH} ký tự.` };
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return { valid: false, error: 'Mật khẩu phải gồm cả chữ và số.' };
  }
  return { valid: true };
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}
