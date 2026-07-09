// Permission matrix (IMS_SPEC §13). ALWAYS check by permission code, never by role name.
import type { AuthUser } from './types.js';

export interface PermissionDef {
  code: string;
  name: string;
  group: string;
}

export const PERMISSIONS: PermissionDef[] = [
  { code: 'DASHBOARD_VIEW', name: 'Xem Dashboard', group: 'DASHBOARD' },
  { code: 'USER_CREATE', name: 'Tạo user', group: 'USER' },
  { code: 'USER_CREATE_LIMITED', name: 'Tạo user giới hạn', group: 'USER' },
  { code: 'USER_READ', name: 'Xem user', group: 'USER' },
  { code: 'USER_UPDATE', name: 'Sửa user', group: 'USER' },
  { code: 'USER_DELETE', name: 'Xóa user', group: 'USER' },
  { code: 'USER_LOCK', name: 'Khóa user', group: 'USER' },
  { code: 'USER_UNLOCK', name: 'Mở khóa user', group: 'USER' },
  { code: 'ROLE_CREATE', name: 'Tạo vai trò', group: 'ROLE' },
  { code: 'ROLE_READ', name: 'Xem vai trò', group: 'ROLE' },
  { code: 'ROLE_UPDATE', name: 'Sửa vai trò', group: 'ROLE' },
  { code: 'ROLE_DELETE', name: 'Xóa vai trò', group: 'ROLE' },
  { code: 'ROLE_LOCK', name: 'Khóa vai trò', group: 'ROLE' },
  { code: 'ROLE_UNLOCK', name: 'Mở khóa vai trò', group: 'ROLE' },
  { code: 'ROLE_ASSIGN', name: 'Gán quyền cho vai trò', group: 'ROLE' },
  { code: 'AUDIT_LOG_VIEW', name: 'Xem nhật ký hệ thống', group: 'AUDIT' },
  { code: 'BACKUP_CREATE', name: 'Tạo backup', group: 'BACKUP' },
  { code: 'BACKUP_RESTORE', name: 'Restore backup', group: 'BACKUP' },
  { code: 'SYSTEM_SETTING_VIEW', name: 'Xem cấu hình', group: 'SYSTEM' },
  { code: 'SYSTEM_SETTING_UPDATE', name: 'Sửa cấu hình', group: 'SYSTEM' }
];

export const PERMISSION_CODES = PERMISSIONS.map((p) => p.code);

/**
 * Default role → permission map (IMS_SPEC §7/§12/§13).
 * ADMIN = every permission. MANAGER = limited user creation, no ROLE admin / no USER_CREATE full.
 * Other roles get no administrative permissions in G1 (module perms come later).
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: [...PERMISSION_CODES],
  MANAGER: [
    'DASHBOARD_VIEW',
    'USER_CREATE_LIMITED',
    'USER_READ',
    'USER_UPDATE',
    'USER_LOCK',
    'USER_UNLOCK',
    'ROLE_READ'
  ],
  D_MANAGER: ['DASHBOARD_VIEW', 'USER_READ', 'ROLE_READ'],
  ACCOUNTANT: ['DASHBOARD_VIEW'],
  TECHNICIAN: ['DASHBOARD_VIEW'],
  SUPPORT: ['DASHBOARD_VIEW'],
  WAREHOUSE: ['DASHBOARD_VIEW'],
  SALES: ['DASHBOARD_VIEW'],
  CUSTOMER: []
};

/** THE permission check. Use everywhere — never compare role names directly. */
export function hasPermission(user: Pick<AuthUser, 'permissions'> | null | undefined, code: string): boolean {
  if (!user || !user.permissions) return false;
  return user.permissions.includes(code);
}

export function hasAnyPermission(user: Pick<AuthUser, 'permissions'> | null | undefined, codes: string[]): boolean {
  return codes.some((c) => hasPermission(user, c));
}
