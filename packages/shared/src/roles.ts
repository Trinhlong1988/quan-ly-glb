// Default system roles (IMS_SPEC §7). Codes are the source of truth; names are Vietnamese labels.

export interface RoleDef {
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
}

export const ROLES: RoleDef[] = [
  { code: 'ADMIN', name: 'Admin', description: 'Toàn quyền hệ thống', isSystem: true },
  { code: 'MANAGER', name: 'Manager', description: 'Tạo user giới hạn, xem/sửa theo phân quyền', isSystem: true },
  { code: 'D_MANAGER', name: 'D Manager', description: 'Xem/duyệt giới hạn, không tạo/xóa user', isSystem: true },
  { code: 'ACCOUNTANT', name: 'Kế toán', description: 'Thu chi, công nợ, báo cáo (sau này)', isSystem: true },
  { code: 'TECHNICIAN', name: 'Kỹ thuật', description: 'Kỹ thuật, bảo hành, vận hành', isSystem: true },
  { code: 'SUPPORT', name: 'Support', description: 'Hỗ trợ khách hàng', isSystem: true },
  { code: 'WAREHOUSE', name: 'Kho', description: 'Nhập/xuất/tồn kho (sau này)', isSystem: true },
  { code: 'SALES', name: 'Sales', description: 'Bán hàng, khách hàng (sau này)', isSystem: true },
  { code: 'CUSTOMER', name: 'Khách hàng', description: 'Tài khoản khách hàng, quyền rất giới hạn', isSystem: true }
];

export const ROLE_CODES = ROLES.map((r) => r.code);

export const ADMIN_ROLE_CODE = 'ADMIN';
export const MANAGER_ROLE_CODE = 'MANAGER';

/** Vietnamese label for a role code, falls back to the code itself. */
export function roleLabel(code: string): string {
  return ROLES.find((r) => r.code === code)?.name ?? code;
}
