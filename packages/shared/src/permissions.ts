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
  { code: 'SYSTEM_SETTING_UPDATE', name: 'Sửa cấu hình', group: 'SYSTEM' },
  // ── G-POS.1 (§A/§D) ──
  { code: 'CUSTOMER_VIEW', name: 'Xem khách hàng', group: 'CUSTOMER' },
  { code: 'CUSTOMER_CREATE', name: 'Tạo khách hàng', group: 'CUSTOMER' },
  { code: 'CUSTOMER_UPDATE', name: 'Sửa khách hàng', group: 'CUSTOMER' },
  { code: 'CUSTOMER_DELETE', name: 'Xóa khách hàng', group: 'CUSTOMER' },
  { code: 'POS_VIEW', name: 'Xem máy POS', group: 'POS' },
  { code: 'POS_MANAGE', name: 'Quản lý máy POS (tạo/luân chuyển/sửa chữa)', group: 'POS' },
  { code: 'TID_VIEW', name: 'Xem TID', group: 'TID' },
  { code: 'TID_MANAGE', name: 'Quản lý TID (gán/đổi/thu hồi/giao)', group: 'TID' },
  { code: 'ASSET_EXPORT', name: 'Xuất dữ liệu tài sản POS/TID', group: 'POS' },
  // ── G-CFG.1 (§C1–C4) — Cấu hình ngân hàng ──
  { code: 'CONFIG_BANK_VIEW', name: 'Xem cấu hình ngân hàng', group: 'Cấu hình ngân hàng' },
  { code: 'CONFIG_BANK_MANAGE', name: 'Quản lý cấu hình ngân hàng (ngân hàng/loại thẻ/đối tác)', group: 'Cấu hình ngân hàng' },
  // ── G-CFG.2 (§C6–C8) — Cấu hình chuỗi cung ứng máy POS ──
  { code: 'CONFIG_POS_SUPPLY_VIEW', name: 'Xem cấu hình cung ứng POS (NCC/chủng loại/nhập kho)', group: 'Cấu hình máy POS' },
  { code: 'CONFIG_POS_SUPPLY_MANAGE', name: 'Quản lý cung ứng POS (NCC/chủng loại/nhập kho)', group: 'Cấu hình máy POS' },
  // ── G-CFG.3 (§C5) — Cấu hình phí ──
  { code: 'CONFIG_FEE_VIEW', name: 'Xem cấu hình phí (loại phí/biểu phí)', group: 'Cấu hình phí' },
  { code: 'CONFIG_FEE_MANAGE', name: 'Quản lý cấu hình phí (loại phí/biểu phí)', group: 'Cấu hình phí' },
  // ── G-CFG.4 (§8) — Tài khoản nhận tiền – ủy quyền ──
  { code: 'CONFIG_RCV_ACCT_VIEW', name: 'Xem tài khoản nhận tiền – ủy quyền', group: 'Tài khoản nhận tiền' },
  { code: 'CONFIG_RCV_ACCT_MANAGE', name: 'Quản lý tài khoản nhận tiền – ủy quyền', group: 'Tài khoản nhận tiền' },
  // ── G-CFG.5 (§10) — Quản lý Hồ sơ HKD ──
  { code: 'CONFIG_DOSSIER_VIEW', name: 'Xem hồ sơ HKD (nguồn hồ sơ + hồ sơ)', group: 'Hồ sơ HKD' },
  { code: 'CONFIG_DOSSIER_MANAGE', name: 'Quản lý hồ sơ HKD (nguồn hồ sơ + hồ sơ)', group: 'Hồ sơ HKD' },
  // ── G-CFG.6 (§9) — Cấu hình TID ──
  { code: 'CONFIG_TID_VIEW', name: 'Xem cấu hình TID (trạng thái + TID)', group: 'Cấu hình TID' },
  { code: 'CONFIG_TID_MANAGE', name: 'Quản lý cấu hình TID (trạng thái + TID)', group: 'Cấu hình TID' },
  // ── R27 (§C kho) — Danh mục Kho ──
  { code: 'CONFIG_WAREHOUSE_VIEW', name: 'Xem danh mục kho', group: 'Danh mục kho' },
  { code: 'CONFIG_WAREHOUSE_MANAGE', name: 'Quản lý danh mục kho (thêm/sửa/xóa)', group: 'Danh mục kho' },
  // ── G-CFG.7 (§11 Pha I1) — Cấu hình ngành nghề (master) ──
  { code: 'CONFIG_INDUSTRY_VIEW', name: 'Xem cấu hình ngành nghề', group: 'Cấu hình ngành nghề' },
  { code: 'CONFIG_INDUSTRY_CREATE', name: 'Tạo ngành nghề', group: 'Cấu hình ngành nghề' },
  { code: 'CONFIG_INDUSTRY_UPDATE', name: 'Sửa ngành nghề', group: 'Cấu hình ngành nghề' },
  { code: 'CONFIG_INDUSTRY_DELETE', name: 'Xóa ngành nghề', group: 'Cấu hình ngành nghề' },
  // ── PHASE H1 (§A/§B) — Thu – Chi: danh mục thu/chi ──
  { code: 'CASHCAT_VIEW', name: 'Xem danh mục thu – chi', group: 'Thu – Chi' },
  { code: 'CASHCAT_CREATE', name: 'Tạo danh mục thu – chi', group: 'Thu – Chi' },
  { code: 'CASHCAT_UPDATE', name: 'Sửa danh mục thu – chi', group: 'Thu – Chi' },
  { code: 'CASHCAT_DELETE', name: 'Xóa danh mục thu – chi', group: 'Thu – Chi' },
  // ── PHASE H2-core (§J/§D/§E) — Quỹ + Phiếu thu/chi ──
  { code: 'FUND_VIEW', name: 'Xem quỹ & số dư', group: 'Thu – Chi' },
  { code: 'FUND_CREATE', name: 'Tạo quỹ', group: 'Thu – Chi' },
  { code: 'FUND_UPDATE', name: 'Sửa quỹ', group: 'Thu – Chi' },
  { code: 'FUND_DELETE', name: 'Xóa quỹ', group: 'Thu – Chi' },
  { code: 'CASHENTRY_VIEW', name: 'Xem phiếu thu – chi & báo cáo dòng tiền', group: 'Thu – Chi' },
  { code: 'CASHENTRY_CREATE', name: 'Lập phiếu thu / phiếu chi', group: 'Thu – Chi' },
  { code: 'CASHENTRY_CANCEL', name: 'Hủy phiếu thu – chi', group: 'Thu – Chi' },
  // ── Thùng rác (R_TRASH_RESTORE) ──
  { code: 'TRASH_VIEW', name: 'Xem thùng rác (của mình)', group: 'Thùng rác' },
  { code: 'TRASH_VIEW_ALL', name: 'Xem thùng rác TỔNG (mọi người dùng)', group: 'Thùng rác' },
  { code: 'TRASH_RESTORE', name: 'Phục hồi dữ liệu đã xóa', group: 'Thùng rác' },
  { code: 'TRASH_PURGE', name: 'Xóa vĩnh viễn / dọn sạch thùng rác', group: 'Thùng rác' },
  // ── Nhóm A — Bảo mật & tài khoản ──
  { code: 'USER_RESET_PASSWORD', name: 'Đặt lại mật khẩu cho user khác', group: 'USER' },
  { code: 'LEVEL2_MANAGE', name: 'Đặt / đổi mật khẩu cấp 2 (xóa vĩnh viễn)', group: 'Bảo mật' },
  // ── Nhóm C — Hòm thư nội bộ ──
  { code: 'MESSAGE_VIEW', name: 'Xem hòm thư (thư & thông báo của mình)', group: 'Hòm thư' },
  { code: 'MESSAGE_SEND', name: 'Gửi thư nội bộ cho người dùng khác', group: 'Hòm thư' },
  // ── Nhóm B — Doanh thu & Công nợ ──
  { code: 'REVENUE_VIEW', name: 'Xem doanh thu & giao dịch', group: 'Doanh thu & Công nợ' },
  { code: 'REVENUE_MANAGE', name: 'Ghi nhận / sửa / xóa giao dịch doanh thu', group: 'Doanh thu & Công nợ' },
  { code: 'DEBT_VIEW', name: 'Xem công nợ thu về', group: 'Doanh thu & Công nợ' },
  { code: 'DEBT_SETTLE', name: 'Đối soát / đánh dấu đã thu công nợ', group: 'Doanh thu & Công nợ' },
  // ── PHASE H2b — Phân loại chất lượng công nợ + Ghi giảm nợ xấu ──
  { code: 'DEBT_CLASSIFY', name: 'Phân loại chất lượng công nợ (Dễ / Khó / Không thu hồi)', group: 'Doanh thu & Công nợ' },
  { code: 'DEBT_WRITEOFF', name: 'Ghi giảm nợ xấu (write-off — trừ thẳng lợi nhuận)', group: 'Doanh thu & Công nợ' },
  // ── P1.2 — Duyệt hủy bill (chứng từ bất biến) ──
  { code: 'BILL_CANCEL_REQUEST', name: 'Tạo yêu cầu hủy bill (kèm lý do)', group: 'Doanh thu & Công nợ' },
  { code: 'BILL_CANCEL_APPROVE', name: 'Duyệt / từ chối yêu cầu hủy bill', group: 'Doanh thu & Công nợ' },
  { code: 'BILL_CANCEL_APPROVE_ELEVATED', name: 'Duyệt yêu cầu hủy bill do Quản lý/Admin tạo (cấp Admin)', group: 'Doanh thu & Công nợ' },
  // ── R34 (Mr.Long 11/7) — Duyệt hủy (XÓA qua duyệt) cho TID / POS / Khách hàng / Nhân sự ──
  // "Hủy" = xóa mềm khỏi hệ thống, BẮT BUỘC qua duyệt (người yêu cầu ≠ người duyệt). APPROVE gán
  // ADMIN + MANAGER; ELEVATED (duyệt yêu cầu do Quản lý/Admin tạo) chỉ ADMIN. Mật khẩu nhập lúc DUYỆT.
  { code: 'TID_CANCEL_REQUEST', name: 'Tạo yêu cầu hủy (xóa) TID', group: 'TID' },
  { code: 'TID_CANCEL_APPROVE', name: 'Duyệt / từ chối yêu cầu hủy TID', group: 'TID' },
  { code: 'TID_CANCEL_APPROVE_ELEVATED', name: 'Duyệt yêu cầu hủy TID do Quản lý/Admin tạo (cấp Admin)', group: 'TID' },
  { code: 'POS_CANCEL_REQUEST', name: 'Tạo yêu cầu hủy (xóa) máy POS', group: 'POS' },
  { code: 'POS_CANCEL_APPROVE', name: 'Duyệt / từ chối yêu cầu hủy máy POS', group: 'POS' },
  { code: 'POS_CANCEL_APPROVE_ELEVATED', name: 'Duyệt yêu cầu hủy POS do Quản lý/Admin tạo (cấp Admin)', group: 'POS' },
  { code: 'CUSTOMER_CANCEL_REQUEST', name: 'Tạo yêu cầu hủy (xóa) khách hàng', group: 'CUSTOMER' },
  { code: 'CUSTOMER_CANCEL_APPROVE', name: 'Duyệt / từ chối yêu cầu hủy khách hàng', group: 'CUSTOMER' },
  { code: 'CUSTOMER_CANCEL_APPROVE_ELEVATED', name: 'Duyệt yêu cầu hủy khách hàng do Quản lý/Admin tạo (cấp Admin)', group: 'CUSTOMER' },
  { code: 'USER_CANCEL_REQUEST', name: 'Tạo yêu cầu hủy (xóa) nhân sự', group: 'USER' },
  { code: 'USER_CANCEL_APPROVE', name: 'Duyệt / từ chối yêu cầu hủy nhân sự', group: 'USER' },
  { code: 'USER_CANCEL_APPROVE_ELEVATED', name: 'Duyệt yêu cầu hủy nhân sự do Quản lý/Admin tạo (cấp Admin)', group: 'USER' },
  // ── #3 (Mr.Long 12/7) — Bán máy/TID + công nợ mua thiết bị (đúng vai trò: hành động tiền) ──
  { code: 'DEVICE_SALE_VIEW', name: 'Xem bán thiết bị & công nợ mua thiết bị', group: 'Doanh thu & Công nợ' },
  { code: 'DEVICE_SALE_MANAGE', name: 'Bán máy/TID + thu nợ mua thiết bị', group: 'Doanh thu & Công nợ' },
  // ── Nhóm E — Bảo trì & Bộ nhớ (chống tràn, dọn dẹp, backup định kỳ) ──
  { code: 'STORAGE_VIEW', name: 'Xem tình trạng bộ nhớ & bảo trì', group: 'Bảo trì hệ thống' },
  { code: 'STORAGE_CLEANUP', name: 'Dọn dẹp bộ nhớ (lịch sử + thùng rác) & backup thủ công', group: 'Bảo trì hệ thống' }
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
    'ROLE_READ',
    // G-POS: managers run the customer book and can read POS/TID (not mutate).
    'CUSTOMER_VIEW',
    'CUSTOMER_CREATE',
    'CUSTOMER_UPDATE',
    'CUSTOMER_DELETE',
    'POS_VIEW',
    'TID_VIEW',
    // G-CFG.1: managers cấu hình ngân hàng/loại thẻ/đối tác.
    'CONFIG_BANK_VIEW',
    'CONFIG_BANK_MANAGE',
    // G-CFG.2: managers cấu hình cung ứng POS.
    'CONFIG_POS_SUPPLY_VIEW',
    'CONFIG_POS_SUPPLY_MANAGE',
    // G-CFG.3: managers cấu hình phí.
    'CONFIG_FEE_VIEW',
    'CONFIG_FEE_MANAGE',
    // G-CFG.4: managers quản lý TK nhận tiền.
    'CONFIG_RCV_ACCT_VIEW',
    'CONFIG_RCV_ACCT_MANAGE',
    // G-CFG.5: managers quản lý hồ sơ HKD.
    'CONFIG_DOSSIER_VIEW',
    'CONFIG_DOSSIER_MANAGE',
    // G-CFG.6: managers quản lý cấu hình TID.
    'CONFIG_TID_VIEW',
    'CONFIG_TID_MANAGE',
    // G-CFG.7: managers quản lý cấu hình ngành nghề (§11 Pha I1).
    'CONFIG_INDUSTRY_VIEW',
    'CONFIG_INDUSTRY_CREATE',
    'CONFIG_INDUSTRY_UPDATE',
    'CONFIG_INDUSTRY_DELETE',
    // R27: managers quản lý danh mục kho.
    'CONFIG_WAREHOUSE_VIEW',
    'CONFIG_WAREHOUSE_MANAGE',
    // PHASE H1: managers quản lý danh mục thu – chi.
    'CASHCAT_VIEW',
    'CASHCAT_CREATE',
    'CASHCAT_UPDATE',
    'CASHCAT_DELETE',
    // PHASE H2-core: managers quản lý quỹ + phiếu thu/chi.
    'FUND_VIEW',
    'FUND_CREATE',
    'FUND_UPDATE',
    'FUND_DELETE',
    'CASHENTRY_VIEW',
    'CASHENTRY_CREATE',
    'CASHENTRY_CANCEL',
    // Nhóm A: managers đặt lại mật khẩu, đặt pass cấp 2, xem & dọn thùng rác tổng.
    'USER_RESET_PASSWORD',
    'LEVEL2_MANAGE',
    'TRASH_VIEW',
    'TRASH_VIEW_ALL',
    'TRASH_PURGE',
    // Nhóm B: managers xem/ghi nhận doanh thu, theo dõi & đối soát công nợ.
    'REVENUE_VIEW',
    'REVENUE_MANAGE',
    'DEBT_VIEW',
    'DEBT_SETTLE',
    // #3: managers bán máy/TID + thu nợ mua thiết bị.
    'DEVICE_SALE_VIEW',
    'DEVICE_SALE_MANAGE',
    // PHASE H2b: managers phân loại chất lượng công nợ + ghi giảm nợ xấu (quyền cao).
    'DEBT_CLASSIFY',
    'DEBT_WRITEOFF',
    // P1.2: managers tạo yêu cầu hủy + duyệt hủy bill (KHÔNG có ELEVATED — cấp Admin mới duyệt yêu cầu của Manager/Admin).
    'BILL_CANCEL_REQUEST',
    'BILL_CANCEL_APPROVE',
    // R34: managers = người duyệt hủy chính (Mr.Long "admin và manager mới có quyền duyệt") + được tạo yêu cầu.
    // KHÔNG có *_ELEVATED (chỉ Admin duyệt yêu cầu do Quản lý/Admin tạo).
    'TID_CANCEL_REQUEST',
    'TID_CANCEL_APPROVE',
    'POS_CANCEL_REQUEST',
    'POS_CANCEL_APPROVE',
    'CUSTOMER_CANCEL_REQUEST',
    'CUSTOMER_CANCEL_APPROVE',
    'USER_CANCEL_REQUEST',
    'USER_CANCEL_APPROVE',
    // Nhóm E: managers xem tình trạng bộ nhớ & dọn dẹp bảo trì.
    'STORAGE_VIEW',
    'STORAGE_CLEANUP'
  ],
  D_MANAGER: ['DASHBOARD_VIEW', 'USER_READ', 'ROLE_READ', 'CUSTOMER_VIEW', 'POS_VIEW', 'TID_VIEW', 'CONFIG_BANK_VIEW', 'CONFIG_WAREHOUSE_VIEW', 'DEVICE_SALE_VIEW'],
  ACCOUNTANT: ['DASHBOARD_VIEW', 'CUSTOMER_VIEW', 'CONFIG_BANK_VIEW', 'CONFIG_FEE_VIEW', 'CONFIG_FEE_MANAGE', 'CONFIG_RCV_ACCT_VIEW', 'CONFIG_RCV_ACCT_MANAGE', 'CONFIG_DOSSIER_VIEW', 'CONFIG_DOSSIER_MANAGE', 'REVENUE_VIEW', 'REVENUE_MANAGE', 'DEBT_VIEW', 'DEBT_SETTLE', 'DEBT_CLASSIFY', 'BILL_CANCEL_REQUEST',
    // #3: kế toán = vai tiền chính → bán máy/TID + thu nợ mua thiết bị.
    'DEVICE_SALE_VIEW', 'DEVICE_SALE_MANAGE',
    // PHASE H2-core: kế toán = vai chính thu-chi (quỹ + phiếu thu/chi + báo cáo dòng tiền).
    'FUND_VIEW', 'FUND_CREATE', 'FUND_UPDATE', 'FUND_DELETE', 'CASHENTRY_VIEW', 'CASHENTRY_CREATE', 'CASHENTRY_CANCEL'],
  TECHNICIAN: ['DASHBOARD_VIEW', 'POS_VIEW'],
  SUPPORT: ['DASHBOARD_VIEW', 'CUSTOMER_VIEW'],
  WAREHOUSE: ['DASHBOARD_VIEW', 'POS_VIEW', 'TID_VIEW', 'CONFIG_POS_SUPPLY_VIEW', 'CONFIG_POS_SUPPLY_MANAGE', 'CONFIG_TID_VIEW', 'CONFIG_TID_MANAGE',
    // R27: kho vận quản lý danh mục kho.
    'CONFIG_WAREHOUSE_VIEW', 'CONFIG_WAREHOUSE_MANAGE',
    // #3: kho vận CHỈ XEM bán thiết bị (bán = vai tiền, không cho kho tự bán).
    'DEVICE_SALE_VIEW',
    // R34: kho vận hành TID/POS → được TẠO yêu cầu hủy (duyệt vẫn do Admin/Manager).
    'TID_CANCEL_REQUEST', 'POS_CANCEL_REQUEST'],
  SALES: ['DASHBOARD_VIEW', 'CUSTOMER_VIEW', 'CUSTOMER_CREATE'],
  CUSTOMER: []
};

// Hòm thư + thùng rác cá nhân: MỌI người dùng đều có hòm thư của mình, gửi thư cho nhau,
// và có thùng rác riêng (chỉ thấy đồ MÌNH xóa; Admin/Manager thấy TỔNG qua TRASH_VIEW_ALL).
for (const roleCode of Object.keys(DEFAULT_ROLE_PERMISSIONS)) {
  for (const code of ['MESSAGE_VIEW', 'MESSAGE_SEND', 'TRASH_VIEW']) {
    if (!DEFAULT_ROLE_PERMISSIONS[roleCode].includes(code)) DEFAULT_ROLE_PERMISSIONS[roleCode].push(code);
  }
}

/** THE permission check. Use everywhere — never compare role names directly. */
export function hasPermission(user: Pick<AuthUser, 'permissions'> | null | undefined, code: string): boolean {
  if (!user || !user.permissions) return false;
  return user.permissions.includes(code);
}

export function hasAnyPermission(user: Pick<AuthUser, 'permissions'> | null | undefined, codes: string[]): boolean {
  return codes.some((c) => hasPermission(user, c));
}
