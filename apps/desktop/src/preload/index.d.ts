import type { AuthUser, ValidationResult } from '@glb/shared';

export interface LoginOutcome {
  ok: boolean;
  user?: AuthUser;
  mustChangePassword?: boolean;
  error?: string;
  message?: string;
  otherDevice?: string; // R46: tên thiết bị đang đăng nhập (khi SESSION_ACTIVE_ELSEWHERE)
}
export interface OnlineUserDto {
  userId: number;
  username: string;
  fullName: string;
  deviceInfo: string | null;
  since: string;
}
export interface RealtimeTokensDto {
  byDomain: Record<string, number>; // targetType → version (đồng hồ thay đổi realtime)
  pendingCancels: number;
  serverNow: string;
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

// G10.3 Cấu hình máy chủ (client first-run) — DTO cho màn "Cấu hình máy chủ".
export interface ServerConfigDto {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}
export interface ServerConfigInputDto {
  host?: string;
  port?: number | string;
  database?: string;
  user?: string;
  password?: string;
}
export interface ServerConfigStatus {
  ready: boolean;
  needsConfig: boolean;
  serverRole: boolean;
  configured: boolean;
  config: ServerConfigDto;
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
  updatedAt: string;
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
  updatedAt: string;
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
  status: string;
  display: string;
  createdAt: string;
  updatedAt: string;
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
  posModelId: number | null;
  posModelName: string | null;
  supplierId: number | null;
  supplierName: string | null;
  importPrice: number | null;
  importedAt: string | null;
  customerName: string | null;
  agentName: string | null;
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
  tid: string | null;
  fromWarehouseId: number | null;
  warehouseName: string | null;
  deliveryAddress: string | null;
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
  // PHASE K2 — 2 chiều DERIVE (Q-T1) + máy khách (Q-T6) + HKD (Q-T3) + cấu hình hợp nhất (§1).
  deviceAssigned: boolean;
  delivered: boolean;
  customerDeviceSerial: string | null;
  dossierId: number | null;
  // LANE A (#11) — Ngành nghề của TID.
  industryId: number | null;
  industryName: string | null;
  bankId: number | null;
  bankCode: string | null;
  bankName: string | null;
  partnerId: number | null;
  partnerCode: string | null;
  partnerName: string | null;
  hkdName: string | null;
  receiveAccountId: number | null;
  issuedAt: string | null;
  configStatusId: number | null;
  configStatusName: string | null;
  dossierSourceId: number | null;
  dossierSourceCode: string | null;
  note: string | null;
  customerName: string | null;
  agentName: string | null;
  // #14 — "Khách hàng đang giữ": customerName khi đã giao & còn sống (không CLOSED/RECALLED); else null.
  holdingCustomerName: string | null;
}
export interface UndeliveredTidDto extends TidDto {
  agingDays: number;
}
// R30 — phí bán thực tế theo TID × loại thẻ (set khi giao máy; niêm yết để đối chiếu).
export interface TidSellFeeRowDto {
  cardTypeId: number;
  cardTypeCode: string | null;
  cardTypeName: string;
  phiBanNiemYet: number | null; // % niêm yết (FeeRate hiệu lực hôm nay)
  phiCaiMayNiemYet: number | null; // % phí cài máy niêm yết (tham chiếu)
  phiBanThucTe: number | null; // % override, null = dùng niêm yết
}
export interface TidSellFeeListDto {
  tidId: number;
  tid: string;
  bankId: number | null;
  bankCode: string | null;
  partnerId: number | null;
  rows: TidSellFeeRowDto[];
}
export interface SetTidSellFeesInput {
  tidId: number;
  entries: { cardTypeId: number; phiBan: number | null }[];
}
export interface TidRefs {
  dossiers: { id: number; hkdName: string; ownerName: string | null }[];
  partners: { id: number; code: string; name: string }[];
  banks: { id: number; code: string; name: string }[];
  partnerBanks: Record<number, number[]>;
  // LANE A (#11) — ngành nghề active để chọn khi tạo TID.
  industries: { id: number; code: string; name: string }[];
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
  status?: string;
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
  status?: string;
}
export interface UpdateCustomerInput {
  fullName?: string;
  nickname?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  agentId?: number | null;
  note?: string | null;
  status?: string;
  expectedUpdatedAt?: string | null;
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
  fromWarehouseId?: number | null;
}
export interface TidFilter {
  search?: string;
  bank?: string;
  status?: string;
  deviceAssigned?: boolean;
  delivered?: boolean;
  // LANE A (#11) — lọc TID theo ngành nghề.
  industryId?: number;
  fromDate?: string;
  toDate?: string;
  // #14 — "Kỳ giao": lọc theo deliveredAt trong khoảng (ngầm = đã giao).
  deliveredFrom?: string;
  deliveredTo?: string;
  holdingCustomerId?: number;
  dossierSourceId?: number;
}
/** #13 — Xếp hạng doanh số theo TID (mặc định tháng hiện tại nếu from/to trống). */
export interface TidRevenueRankFilter {
  from?: string;
  to?: string;
}
export interface TidRevenueRankRow {
  rank: number;
  tidId: number;
  tid: string;
  hkdName: string | null;
  customerName: string | null;
  industryName: string | null;
  revenue: number;
  active: boolean;
}
/** PHASE K2 (Q-T5) — form Thêm TID hợp nhất (đầy đủ): cho phép chưa gán + chưa giao. */
export interface CreateTidInput {
  tid: string;
  mid?: string | null;
  dossierId?: number | null;
  // LANE A (#11) — ngành nghề BẮT BUỘC khi tạo TID.
  industryId: number;
  hkdName: string;
  partnerId: number;
  bankId: number;
  receiveAccountId?: number | null;
  issuedAt?: string | null;
  configStatusId?: number | null;
  dossierSourceId?: number | null;
  note?: string | null;
  customerDeviceSerial?: string | null;
  assign?: { posSerial: string; customerId: number };
  deliver?: { deliveredAt?: string | null; customerId: number; toAgentId?: number | null };
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
  customerId?: number | null;
  toAgentId?: number | null;
  note?: string | null;
}

export interface ListResult<T> {
  ok: boolean;
  data?: T[];
  error?: string;
  message?: string;
}

// ── G-CFG.1 DTOs (Cấu hình ngân hàng §C1–C4) ──
export interface AuditTrail {
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedBy: number | null;
  updatedByName: string | null;
  updatedAt: string;
}
export interface WarehouseDto extends AuditTrail {
  id: number;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  note: string | null;
  status: string;
}
export interface WarehouseLite {
  id: number;
  code: string;
  name: string;
  address: string | null;
}
export interface WarehouseFilter {
  search?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
}
export interface CreateWarehouseInput {
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  note?: string | null;
  status?: string;
}
export interface UpdateWarehouseInput {
  code?: string;
  name?: string;
  address?: string | null;
  phone?: string | null;
  note?: string | null;
  status?: string;
  expectedUpdatedAt?: string | null;
}
export interface BankDto extends AuditTrail {
  id: number;
  seq: number | null;
  seqCode: string | null;
  name: string;
  code: string;
  status: string;
}
export interface BankLite {
  id: number;
  code: string;
  name: string;
}
export interface BankFilter {
  search?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
}
export interface CreateBankInput {
  name: string;
  code: string;
  status?: string;
}
export interface UpdateBankInput {
  name?: string;
  code?: string;
  status?: string;
  expectedUpdatedAt?: string | null;
}
export interface CardTypeDto extends AuditTrail {
  id: number;
  bankId: number;
  bankName: string | null;
  bankCode: string | null;
  name: string;
  code: string;
}
export interface CardTypeFilter {
  search?: string;
  bankId?: number;
  fromDate?: string;
  toDate?: string;
}
export interface CreateCardTypeInput {
  bankId: number;
  name: string;
  code: string;
}
export interface UpdateCardTypeInput {
  bankId?: number;
  name?: string;
  code?: string;
  expectedUpdatedAt?: string | null;
}
export interface PartnerDto extends AuditTrail {
  id: number;
  name: string;
  code: string;
  status: string; // SIGNED | UNSIGNED | TERMINATED (tra StatusOption entity=PARTNER)
  address: string | null;
  phone: string | null;
  email: string | null;
  contactPerson: string | null;
  bankIds: number[];
}
export interface PartnerFilter {
  search?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
}
export interface CreatePartnerInput {
  name: string;
  code: string;
  status?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  contactPerson?: string | null;
}
export interface UpdatePartnerInput {
  name?: string;
  code?: string;
  status?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  contactPerson?: string | null;
  expectedUpdatedAt?: string | null;
}

/** Danh mục trạng thái tùy biến dùng chung (R14). */
export interface StatusOptionDto {
  id: number;
  entity: string;
  code: string;
  label: string;
  tone: string;
  isBuiltin: boolean;
  sortOrder: number;
  active: boolean;
  updatedAt: string;
}
export interface StatusEntityDto {
  entity: string;
  label: string;
  allowAdd: boolean;
}
export interface CreateStatusOptionInput {
  entity: string;
  label: string;
  tone?: string;
}
export interface UpdateStatusOptionInput {
  label?: string;
  tone?: string;
  sortOrder?: number;
  active?: boolean;
  expectedUpdatedAt?: string | null;
}
export interface PartnerBankMatrixRow {
  partnerId: number;
  partnerCode: string;
  partnerName: string;
  bankIds: number[];
}
export interface PartnerBankMatrix {
  banks: BankLite[];
  rows: PartnerBankMatrixRow[];
}
export interface BulkDeleteOutcome extends MutationOutcome {
  deleted?: number;
}

/** Kết quả thao tác hàng loạt có bỏ qua từng phần (xóa user / duyệt–từ chối hủy bill). */
export interface BulkSkipOutcome extends MutationOutcome {
  /** Số bản ghi xử lý thành công (xóa / duyệt / từ chối). */
  deleted?: number;
  done?: number;
  skipped?: { id: number; reason: string; message?: string }[];
}

/** 1 yêu cầu hủy bill đang chờ duyệt (P1.2). */
export interface CancelRequestDto {
  id: number;
  transactionId: number;
  billCode: string | null;
  amount: number;
  reason: string;
  status: string;
  requestedBy: number;
  requestedByName: string | null;
  requestedAt: string;
  canApprove: boolean;
}

/** R34 — 1 yêu cầu hủy (xóa) TID/POS/Khách/Nhân sự đang chờ duyệt (trung tâm Duyệt Hủy gộp). */
export interface EntityCancelRequestDto {
  id: number;
  entityType: string; // 'Tid' | 'PosDevice' | 'Customer' | 'User'
  entityTypeLabel: string; // 'TID' | 'Máy POS' | 'Khách hàng' | 'Nhân sự'
  entityId: number;
  entityLabel: string | null;
  reason: string;
  status: string;
  requestedBy: number;
  requestedByName: string | null;
  requestedAt: string;
  canApprove: boolean;
}

// ── G-CFG.2 DTOs (Cấu hình cung ứng POS §C6–C8) ──
export interface SupplierDto extends AuditTrail {
  id: number;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  contactPerson: string | null;
}
export interface SupplierFilter {
  search?: string;
  fromDate?: string;
  toDate?: string;
}
export interface CreateSupplierInput {
  name: string;
  code: string;
  address?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
}
export interface UpdateSupplierInput {
  name?: string;
  code?: string;
  address?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
  expectedUpdatedAt?: string | null;
}
export interface PosModelDto extends AuditTrail {
  id: number;
  code: string;
  name: string;
}
export interface PosModelFilter {
  search?: string;
  fromDate?: string;
  toDate?: string;
}
export interface CreatePosModelInput {
  code: string;
  name: string;
}
export interface UpdatePosModelInput {
  code?: string;
  name?: string;
  expectedUpdatedAt?: string | null;
}
export interface IntakeStatusDto extends AuditTrail {
  id: number;
  name: string;
}
export interface CreateIntakeStatusInput {
  name: string;
}
export interface UpdateIntakeStatusInput {
  name?: string;
  expectedUpdatedAt?: string | null;
}
export interface PosIntakeDto extends AuditTrail {
  id: number;
  posModelId: number;
  posModelCode: string | null;
  posModelName: string | null;
  serial: string;
  intakeStatusId: number;
  intakeStatusName: string | null;
  supplierId: number;
  supplierCode: string | null;
  supplierName: string | null;
  importPrice: number;
  importedAt: string;
  note: string | null;
}
export interface PosIntakeFilter {
  search?: string;
  posModelId?: number;
  supplierId?: number;
  intakeStatusId?: number;
  fromDate?: string;
  toDate?: string;
}
export interface CreatePosIntakeInput {
  posModelId: number;
  serial: string;
  intakeStatusId: number;
  supplierId: number;
  importPrice: number;
  importedAt: string;
  note?: string | null;
}
export interface UpdatePosIntakeInput {
  posModelId?: number;
  serial?: string;
  intakeStatusId?: number;
  supplierId?: number;
  importPrice?: number;
  importedAt?: string;
  note?: string | null;
  expectedUpdatedAt?: string | null;
}
export interface LiteRef {
  id: number;
  code: string;
  name: string;
}

// ── G-CFG.3 DTOs (Cấu hình phí §C5) ──
export interface FeeTypeDto extends AuditTrail {
  id: number;
  name: string;
}
export interface CreateFeeTypeInput {
  name: string;
}
export interface UpdateFeeTypeInput {
  name?: string;
  expectedUpdatedAt?: string | null;
}
export interface FeeRateDto extends AuditTrail {
  id: number;
  partnerId: number;
  partnerCode: string | null;
  partnerName: string | null;
  cardTypeId: number;
  cardTypeCode: string | null;
  cardTypeName: string | null;
  bankId: number | null;
  bankCode: string | null;
  bankName: string | null;
  phiMua: number;
  phiCaiMay: number;
  phiBan: number;
  clNcc: number;
  clKh: number;
  effectiveFrom: string;
  isCurrent: boolean;
}
export interface FeeRateFilter {
  partnerId?: number;
  bankId?: number;
  cardTypeId?: number;
}
export interface SetFeeRateInput {
  partnerId: number;
  cardTypeId: number;
  phiMua: number;
  phiCaiMay: number;
  phiBan: number;
  effectiveFrom?: string;
}

// ── G-CFG.4 DTOs (Tài khoản nhận tiền §8) ──
export interface RcvSourceDto extends AuditTrail {
  id: number;
  name: string;
}
export interface CreateRcvSourceInput {
  name: string;
}
export interface UpdateRcvSourceInput {
  name?: string;
  expectedUpdatedAt?: string | null;
}
export interface RcvAccountDto extends AuditTrail {
  id: number;
  sourceId: number;
  sourceName: string | null;
  accountName: string;
  accountNumber: string;
  bankId: number;
  bankCode: string | null;
  bankName: string | null;
  branch: string | null;
  cccdNumber: string | null;
  cccdIssueDate: string | null;
  cccdIssuePlace: string | null;
  cccdExpiry: string | null;
  phone: string | null;
  email: string | null;
  customerId: number | null;
  customerName: string | null;
  cccdFrontPath: string | null;
  cccdFrontName: string | null;
  cccdBackPath: string | null;
  cccdBackName: string | null;
}
export interface RcvAccountFilter {
  search?: string;
  sourceId?: number;
  bankId?: number;
  customerId?: number;
  fromDate?: string;
  toDate?: string;
}
export interface RcvAccountInput {
  sourceId: number;
  accountName: string;
  accountNumber: string;
  bankId: number;
  branch?: string | null;
  cccdNumber?: string | null;
  cccdIssueDate?: string | null;
  cccdIssuePlace?: string | null;
  cccdExpiry?: string | null;
  phone?: string | null;
  email?: string | null;
  customerId?: number | null;
  note?: string | null;
  cccdFrontSrc?: string | null;
  cccdBackSrc?: string | null;
  expectedUpdatedAt?: string | null;
}
// ── G-CFG.5 DTOs (Quản lý Hồ sơ HKD §10) ──
export interface DossierSourceDto extends AuditTrail {
  id: number;
  code: string;
  discountRate: number; // phần trăm (đã /1000)
}
export interface CreateDossierSourceInput {
  code: string;
  discountRate: number;
}
export interface UpdateDossierSourceInput {
  code?: string;
  discountRate?: number;
  expectedUpdatedAt?: string | null;
}
export interface DossierDto extends AuditTrail {
  id: number;
  sourceId: number;
  sourceCode: string | null;
  hkdName: string;
  hkdAddress: string | null;
  taxCode: string | null;
  mstStatus: string; // 'ACTIVE'=Hoạt động / 'CLOSED'=Đóng
  dkkdIssueDate: string | null;
  dkkdIssuePlace: string | null;
  ownerName: string;
  gender: string | null;
  ethnicity: string | null;
  cccdNumber: string | null;
  cccdIssueDate: string | null;
  cccdIssuePlace: string | null;
  cccdExpiry: string | null;
  permanentAddress: string | null;
  currentAddress: string | null;
  email: string | null;
  dkkdFrontPath: string | null;
  dkkdFrontName: string | null;
  dkkdBackPath: string | null;
  dkkdBackName: string | null;
  cccdFrontPath: string | null;
  cccdFrontName: string | null;
  cccdBackPath: string | null;
  cccdBackName: string | null;
  note: string | null;
}
export interface DossierFilter {
  search?: string;
  sourceId?: number;
  mstStatus?: string; // 'ACTIVE'/'CLOSED'; bỏ trống = tất cả
  fromDate?: string;
  toDate?: string;
}
export interface DossierInput {
  sourceId: number;
  hkdName: string;
  hkdAddress?: string | null;
  taxCode?: string | null;
  mstStatus?: string; // 'ACTIVE' (mặc định) / 'CLOSED'
  dkkdIssueDate?: string | null;
  dkkdIssuePlace?: string | null;
  ownerName: string;
  gender?: string | null;
  ethnicity?: string | null;
  cccdNumber?: string | null;
  cccdIssueDate?: string | null;
  cccdIssuePlace?: string | null;
  cccdExpiry?: string | null;
  permanentAddress?: string | null;
  currentAddress?: string | null;
  email?: string | null;
  note?: string | null;
  dkkdFrontSrc?: string | null;
  dkkdBackSrc?: string | null;
  cccdFrontSrc?: string | null;
  cccdBackSrc?: string | null;
  expectedUpdatedAt?: string | null;
}
// ── G-CFG.6 DTOs (Cấu hình TID §9) ──
export interface TidConfigStatusDto extends AuditTrail {
  id: number;
  name: string;
}
export interface CreateTidConfigStatusInput {
  name: string;
}
export interface UpdateTidConfigStatusInput {
  name?: string;
  expectedUpdatedAt?: string | null;
}
export interface ConfigTidDto extends AuditTrail {
  id: number;
  tid: string;
  status: string;
  posSerial: string | null;
  bankId: number | null;
  bankCode: string | null;
  bankName: string | null;
  partnerId: number | null;
  partnerCode: string | null;
  partnerName: string | null;
  hkdName: string | null;
  receiveAccountId: number | null;
  receiveAccountLabel: string | null;
  issuedAt: string | null;
  configStatusId: number | null;
  configStatusName: string | null;
  dossierSourceId: number | null;
  dossierSourceCode: string | null;
  note: string | null;
}
export interface ConfigTidFilter {
  search?: string;
  bankId?: number;
  partnerId?: number;
  configStatusId?: number;
  fromDate?: string;
  toDate?: string;
}
export interface ConfigTidInput {
  tid: string;
  bankId: number;
  partnerId: number;
  hkdName: string;
  receiveAccountId?: number | null;
  issuedAt?: string | null;
  configStatusId?: number | null;
  dossierSourceId?: number | null;
  note?: string | null;
  expectedUpdatedAt?: string | null;
}
// ── G-CFG.7 DTOs (Cấu hình ngành nghề §11 Pha I1) ──
export interface IndustryDto extends AuditTrail {
  id: number;
  code: string;
  name: string;
  active: boolean;
  note: string | null;
}
export interface IndustryFilter {
  search?: string;
  active?: boolean;
  fromDate?: string;
  toDate?: string;
}
export interface CreateIndustryInput {
  name: string;
  active?: boolean;
  note?: string | null;
}
export interface UpdateIndustryInput {
  name?: string;
  active?: boolean;
  note?: string | null;
  expectedUpdatedAt?: string | null;
}
// ── PHASE H1 — Thu–Chi DTOs (danh mục thu/chi §A/§B) ──
export interface CashCategoryDto extends AuditTrail {
  id: number;
  kind: string; // THU | CHI
  name: string;
  unit: string | null;
  periodType: string | null; // NONE | MONTH | DATE_RANGE
  sourceKind: string;
  affectsPnl: boolean;
  isSystem: boolean;
  active: boolean;
}
export interface CashCategoryFilter {
  search?: string;
  kind?: string; // THU | CHI
  active?: boolean;
  sourceKind?: string;
  fromDate?: string;
  toDate?: string;
}
export interface CreateCashCategoryInput {
  kind: string; // THU | CHI
  name: string;
  unit?: string | null;
  periodType?: string | null;
  sourceKind?: string;
  affectsPnl?: boolean;
  active?: boolean;
}
export interface UpdateCashCategoryInput {
  name?: string;
  unit?: string | null;
  periodType?: string | null;
  sourceKind?: string;
  affectsPnl?: boolean;
  active?: boolean;
  expectedUpdatedAt?: string | null;
}
// ── PHASE H2-core — Thu–Chi DTOs (Quỹ + Phiếu thu/chi §J/§D/§E) ──
export interface FundDto extends AuditTrail {
  id: number;
  code: string;
  name: string;
  type: string; // CASH | BANK | EWALLET
  keeperUserId: number | null;
  keeperUserName: string | null;
  openingBalance: number;
  currentBalance: number; // running (KHÔNG lưu cứng) — I#1
  active: boolean;
  note: string | null;
}
export interface FundFilter {
  search?: string;
  active?: boolean;
  type?: string;
}
export interface CreateFundInput {
  name: string;
  type: string;
  keeperUserId?: number | null;
  openingBalance?: number;
  active?: boolean;
  note?: string | null;
}
export interface UpdateFundInput {
  name?: string;
  type?: string;
  keeperUserId?: number | null;
  openingBalance?: number;
  active?: boolean;
  note?: string | null;
  expectedUpdatedAt?: string | null;
}
export interface CashflowUserLite {
  id: number;
  code: string | null;
  name: string;
}
export interface CashEntryDto {
  id: number;
  code: string | null;
  kind: string; // THU | CHI
  categoryId: number;
  categoryName: string | null;
  sourceKind: string | null;
  fundId: number | null; // H2b: null cho bút toán phi tiền mặt (write-off nợ xấu)
  fundCode: string | null;
  fundName: string | null;
  amount: number;
  method: string; // CK | CASH
  entryDate: string;
  customerId: number | null;
  customerName: string | null;
  partnerId: number | null;
  partnerName: string | null;
  payerUserId: number | null;
  payerUserName: string | null;
  receiverUserId: number | null;
  receiverUserName: string | null;
  note: string | null;
  status: string; // DRAFT | POSTED | CANCELLED
  cancelReason: string | null;
  cancelledAt: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
}
export interface CashEntryFilter {
  kind?: string;
  categoryId?: number;
  fundId?: number;
  customerId?: number;
  partnerId?: number;
  status?: string;
  fromDate?: string;
  toDate?: string;
}
export interface CreateCashEntryInput {
  kind: string;
  categoryId: number;
  fundId: number;
  amount: number;
  method: string;
  entryDate: string;
  customerId?: number | null;
  partnerId?: number | null;
  payerUserId?: number | null;
  receiverUserId?: number | null;
  note?: string | null;
}
export interface CashflowSummary {
  count: number;
  totalThu: number;
  totalChi: number;
  net: number;
}
// H2-debt — Thu công nợ (createDebtReceipt): 1 phiếu THU (category DEBT_*) tất toán ≥1 GD.
export interface DebtReceiptLine {
  transactionId: number;
  side: string; // PARTNER | SELL
  amount: number;
}
export interface CreateDebtReceiptInput {
  categoryId: number; // DEBT_CUSTOMER | DEBT_PARTNER
  fundId: number;
  method: string; // CK | CASH
  entryDate: string;
  customerId?: number | null;
  partnerId?: number | null;
  note?: string | null;
  docPath?: string | null;
  docName?: string | null;
  lines: DebtReceiptLine[];
}
// H2-debt — 1 GD còn nợ net (per-side remaining) cho DebtPage + màn Thu công nợ.
export interface DebtOpenTxnDto {
  id: number;
  code: string | null;
  txnDate: string;
  tid: string | null;
  mid: string | null;
  hkdName: string | null;
  customerId: number | null;
  customerName: string | null;
  partnerId: number | null;
  partnerName: string | null;
  revenuePartner: number;
  revenueSell: number;
  remainingPartner: number;
  remainingSell: number;
  settled: boolean;
  debtQuality: string | null; // H2b: GOOD | HARD | BAD | null(chưa phân loại)
}
export interface DebtOpenResult {
  ok: boolean;
  error?: string;
  message?: string;
  data?: DebtOpenTxnDto[];
}
export interface CashEntryListResult {
  ok: boolean;
  error?: string;
  message?: string;
  data?: CashEntryDto[];
  summary?: CashflowSummary;
}
export interface EntryCategoryLite {
  id: number;
  kind: string;
  name: string;
  sourceKind: string;
  affectsPnl: boolean;
}
export interface MonthProfit {
  month: string;
  revenueAccrual: number;
  expense: number;
  profit: number;
}
export interface ProfitStats {
  current: MonthProfit;
  previous: MonthProfit;
}
export interface PickImageResult {
  ok: boolean;
  path?: string;
  canceled?: boolean;
}
export interface ReadAttachmentResult {
  ok: boolean;
  dataUrl?: string;
  error?: string;
  message?: string;
}
export interface LinkOutcome extends MutationOutcome {
  linked?: number;
  unlinked?: number;
}

export interface RoleInput {
  name: string;
  code: string;
  description?: string;
  status?: string;
  permissionCodes: string[];
  expectedUpdatedAt?: string | null;
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
  expectedUpdatedAt?: string | null;
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
  login(username: string, password: string, remember: boolean, force?: boolean): Promise<LoginOutcome>;
  me(): Promise<AuthUser | null>;
  logout(): Promise<{ ok: boolean }>;
  sessionHeartbeat(): Promise<{ ok: boolean; kicked?: boolean; byDevice?: string }>;
  onlineUsers(): Promise<{ ok: boolean; error?: string; message?: string; data?: OnlineUserDto[] }>;
  realtimeTokens(): Promise<{ ok: boolean; error?: string; message?: string; data?: RealtimeTokensDto }>;
  changePassword(currentPassword: string, newPassword: string, confirmPassword?: string): Promise<MutationOutcome>;
  adminResetPassword(userId: number, newPassword: string, actorPassword: string): Promise<MutationOutcome>;
  level2Status(): Promise<{ ok: boolean; hasLevel2?: boolean; error?: string; message?: string }>;
  setLevel2(level1: string, newLevel2: string, confirmLevel2: string): Promise<MutationOutcome>;
  resetLevel2(level1: string, oldLevel2: string, newLevel2: string, confirmLevel2: string): Promise<MutationOutcome>;
  validatePassword(pwd: string): Promise<ValidationResult>;
  getRemembered(): Promise<RememberedCreds | null>;
  saveRemembered(username: string, password: string): Promise<{ ok: boolean }>;
  clearRemembered(): Promise<{ ok: boolean }>;

  // Cấu hình máy chủ (G10.3 — client first-run)
  serverConfigGet(): Promise<ServerConfigStatus>;
  serverConfigTest(input: ServerConfigInputDto): Promise<{ ok: boolean; error?: string }>;
  serverConfigSave(input: ServerConfigInputDto): Promise<{ ok: boolean; error?: string }>;

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

  auditList(query: AuditQuery): Promise<ListResult<AuditRowDto>>;

  backupCreate(note?: string): Promise<MutationOutcome>;
  backupList(): Promise<ListResult<BackupDto>>;
  backupRestore(filePath: string, password: string): Promise<MutationOutcome>;

  settingList(): Promise<ListResult<SettingDto>>;
  settingUpdate(key: string, value: string): Promise<MutationOutcome>;

  // ── G-POS.1 ──
  customerList(filter: CustomerFilter): Promise<ListResult<CustomerDto>>;
  customerCounts(): Promise<{ ok: boolean; data?: { total: number; active: number; locked: number; cancelled: number; unassigned: number; byAgent: { agentId: number; count: number }[] }; error?: string; message?: string }>;
  customerCreate(input: CreateCustomerInput): Promise<MutationOutcome>;
  customerUpdate(id: number, input: UpdateCustomerInput): Promise<MutationOutcome>;
  agentList(): Promise<ListResult<AgentDto>>;

  posList(filter: PosFilter): Promise<ListResult<PosDto>>;
  posTimeline(serial: string): Promise<ListResult<TimelineEventDto>>;
  posCreate(input: CreatePosInput): Promise<MutationOutcome>;
  posDeploy(serial: string, input: TransitionInput): Promise<MutationOutcome>;
  posRecall(serial: string, input: TransitionInput): Promise<MutationOutcome>;
  posTransferAgent(serial: string, input: TransitionInput): Promise<MutationOutcome>;
  posChangeCustomer(serial: string, input: TransitionInput): Promise<MutationOutcome>;
  posReportDamage(serial: string, input: TransitionInput): Promise<MutationOutcome>;
  posSendRepair(serial: string, input: TransitionInput): Promise<MutationOutcome>;
  posReceiveRepaired(serial: string, input: TransitionInput): Promise<MutationOutcome>;
  posRetire(serial: string, password: string, input: TransitionInput): Promise<MutationOutcome>;

  tidList(filter: TidFilter): Promise<ListResult<TidDto>>;
  tidUndelivered(): Promise<ListResult<UndeliveredTidDto>>;
  tidCreate(input: CreateTidInput): Promise<MutationOutcome>;
  tidRefs(): Promise<{ ok: boolean; data?: TidRefs; error?: string; message?: string }>;
  tidTimeline(tid: string): Promise<ListResult<TimelineEventDto>>;
  tidRevenueRanking(filter: TidRevenueRankFilter): Promise<ListResult<TidRevenueRankRow>>;
  tidAssign(tid: string, input: AssignTidInput): Promise<MutationOutcome>;
  tidReplace(tid: string, input: ReplaceTidInput): Promise<MutationOutcome>;
  tidRecall(tid: string, input: RecallTidInput): Promise<MutationOutcome>;
  tidMarkDelivered(tid: string, input: MarkDeliveredInput): Promise<MutationOutcome>;
  tidSellFeeList(tidId: number): Promise<{ ok: boolean; data?: TidSellFeeListDto; error?: string; message?: string }>;
  tidSellFeeSet(input: SetTidSellFeesInput): Promise<MutationOutcome>;

  notifyUndeliveredSummary(): Promise<{ ok: boolean; data?: UndeliveredSummary; error?: string; message?: string }>;
  notifyPushUndelivered(): Promise<{ ok: boolean; stub: true; message?: string; error?: string }>;

  // ── Danh mục Kho (R27) ──
  warehouseList(filter: WarehouseFilter): Promise<ListResult<WarehouseDto>>;
  warehouseLite(): Promise<ListResult<WarehouseLite>>;
  warehouseCreate(input: CreateWarehouseInput): Promise<MutationOutcome>;
  warehouseUpdate(id: number, input: UpdateWarehouseInput): Promise<MutationOutcome>;
  warehouseDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  // ── Cấu hình ngân hàng (G-CFG.1 §C1–C4) ──
  bankList(filter: BankFilter): Promise<ListResult<BankDto>>;
  bankLite(): Promise<ListResult<BankLite>>;
  bankCreate(input: CreateBankInput): Promise<MutationOutcome>;
  bankUpdate(id: number, input: UpdateBankInput): Promise<MutationOutcome>;
  bankDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  cardTypeList(filter: CardTypeFilter): Promise<ListResult<CardTypeDto>>;
  cardTypeCreate(input: CreateCardTypeInput): Promise<MutationOutcome>;
  cardTypeUpdate(id: number, input: UpdateCardTypeInput): Promise<MutationOutcome>;
  cardTypeDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  partnerList(filter: PartnerFilter): Promise<ListResult<PartnerDto>>;
  partnerCreate(input: CreatePartnerInput): Promise<MutationOutcome>;
  partnerUpdate(id: number, input: UpdatePartnerInput): Promise<MutationOutcome>;
  partnerDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;
  partnerBankMatrix(): Promise<{ ok: boolean; data?: PartnerBankMatrix; error?: string; message?: string }>;
  partnerBankSet(partnerId: number, bankIds: number[]): Promise<LinkOutcome>;
  statusOptionList(entity: string, includeInactive?: boolean): Promise<ListResult<StatusOptionDto>>;
  statusOptionListMany(entities: string[]): Promise<{ ok: boolean; data?: Record<string, StatusOptionDto[]>; error?: string; message?: string }>;
  statusOptionEntities(): Promise<ListResult<StatusEntityDto>>;
  statusOptionCreate(input: CreateStatusOptionInput): Promise<MutationOutcome>;
  statusOptionUpdate(id: number, input: UpdateStatusOptionInput): Promise<MutationOutcome>;
  statusOptionDelete(id: number): Promise<MutationOutcome>;

  // ── Cấu hình cung ứng POS (G-CFG.2 §C6–C8) ──
  supplierList(filter: SupplierFilter): Promise<ListResult<SupplierDto>>;
  supplierLite(): Promise<ListResult<LiteRef>>;
  supplierCreate(input: CreateSupplierInput): Promise<MutationOutcome>;
  supplierUpdate(id: number, input: UpdateSupplierInput): Promise<MutationOutcome>;
  supplierDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  posModelList(filter: PosModelFilter): Promise<ListResult<PosModelDto>>;
  posModelLite(): Promise<ListResult<LiteRef>>;
  posModelCreate(input: CreatePosModelInput): Promise<MutationOutcome>;
  posModelUpdate(id: number, input: UpdatePosModelInput): Promise<MutationOutcome>;
  posModelDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  intakeStatusList(): Promise<ListResult<IntakeStatusDto>>;
  intakeStatusCreate(input: CreateIntakeStatusInput): Promise<MutationOutcome>;
  intakeStatusUpdate(id: number, input: UpdateIntakeStatusInput): Promise<MutationOutcome>;
  intakeStatusDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  posIntakeList(filter: PosIntakeFilter): Promise<ListResult<PosIntakeDto>>;
  posIntakeCreate(input: CreatePosIntakeInput): Promise<MutationOutcome>;
  posIntakeUpdate(id: number, input: UpdatePosIntakeInput): Promise<MutationOutcome>;
  posIntakeDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  // ── Cấu hình phí (G-CFG.3 §C5) ──
  feeTypeList(): Promise<ListResult<FeeTypeDto>>;
  feeTypeCreate(input: CreateFeeTypeInput): Promise<MutationOutcome>;
  feeTypeUpdate(id: number, input: UpdateFeeTypeInput): Promise<MutationOutcome>;
  feeTypeDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  feeRateList(filter: FeeRateFilter): Promise<ListResult<FeeRateDto>>;
  feeRateSet(input: SetFeeRateInput): Promise<MutationOutcome>;
  feeRateDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  // ── Tài khoản nhận tiền – ủy quyền (G-CFG.4 §8) ──
  rcvSourceList(): Promise<ListResult<RcvSourceDto>>;
  rcvSourceCreate(input: CreateRcvSourceInput): Promise<MutationOutcome>;
  rcvSourceUpdate(id: number, input: UpdateRcvSourceInput): Promise<MutationOutcome>;
  rcvSourceDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  rcvAccountList(filter: RcvAccountFilter): Promise<ListResult<RcvAccountDto>>;
  rcvAccountCreate(input: RcvAccountInput): Promise<MutationOutcome>;
  rcvAccountUpdate(id: number, input: RcvAccountInput): Promise<MutationOutcome>;
  rcvAccountDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  pickImage(): Promise<PickImageResult>;
  readAttachment(relPath: string): Promise<ReadAttachmentResult>;

  // ── Quản lý Hồ sơ HKD (G-CFG.5 §10) ──
  dossierSourceList(): Promise<ListResult<DossierSourceDto>>;
  dossierSourceCreate(input: CreateDossierSourceInput): Promise<MutationOutcome>;
  dossierSourceUpdate(id: number, input: UpdateDossierSourceInput): Promise<MutationOutcome>;
  dossierSourceDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  dossierList(filter: DossierFilter): Promise<ListResult<DossierDto>>;
  dossierCreate(input: DossierInput): Promise<MutationOutcome>;
  dossierUpdate(id: number, input: DossierInput): Promise<MutationOutcome>;
  dossierDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  // ── Cấu hình TID (G-CFG.6 §9) ──
  tidStatusList(): Promise<ListResult<TidConfigStatusDto>>;
  tidStatusCreate(input: CreateTidConfigStatusInput): Promise<MutationOutcome>;
  tidStatusUpdate(id: number, input: UpdateTidConfigStatusInput): Promise<MutationOutcome>;
  tidStatusDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  tidConfigList(filter: ConfigTidFilter): Promise<ListResult<ConfigTidDto>>;
  tidConfigCreate(input: ConfigTidInput): Promise<MutationOutcome>;
  tidConfigUpdate(id: number, input: ConfigTidInput): Promise<MutationOutcome>;

  // ── Cấu hình ngành nghề (G-CFG.7 §11 Pha I1) ──
  industryList(filter: IndustryFilter): Promise<ListResult<IndustryDto>>;
  industryCreate(input: CreateIndustryInput): Promise<MutationOutcome>;
  industryUpdate(id: number, input: UpdateIndustryInput): Promise<MutationOutcome>;
  industryDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  // ── PHASE H1 — Thu–Chi: danh mục thu/chi (§A/§B) ──
  cashCategoryList(filter: CashCategoryFilter): Promise<ListResult<CashCategoryDto>>;
  cashCategoryCreate(input: CreateCashCategoryInput): Promise<MutationOutcome>;
  cashCategoryUpdate(id: number, input: UpdateCashCategoryInput): Promise<MutationOutcome>;
  cashCategoryDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;

  // ── PHASE H2-core — Thu–Chi: Quỹ + Phiếu thu/chi (§J/§D/§E) ──
  fundList(filter: FundFilter): Promise<ListResult<FundDto>>;
  fundUserLite(): Promise<ListResult<CashflowUserLite>>;
  fundCreate(input: CreateFundInput): Promise<MutationOutcome>;
  fundUpdate(id: number, input: UpdateFundInput): Promise<MutationOutcome>;
  fundDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;
  cashEntryList(filter: CashEntryFilter): Promise<CashEntryListResult>;
  cashEntryReport(filter: CashEntryFilter): Promise<CashEntryListResult>;
  cashEntryCategoryLite(): Promise<ListResult<EntryCategoryLite>>;
  cashEntryCreate(input: CreateCashEntryInput): Promise<MutationOutcome>;
  cashEntryCreateDebtReceipt(input: CreateDebtReceiptInput): Promise<MutationOutcome>;
  cashEntryCancel(id: number, reason: string, password: string): Promise<MutationOutcome>;

  // ── XUẤT EXCEL chuẩn nhà (.xlsx) → lưu qua hộp thoại HĐH + mở file (R38/R39) ──
  reportExport(p: ReportExportInput): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string; message?: string }>;
  openFilePath(path: string): Promise<{ ok: boolean; message?: string }>;

  // ── PHASE IMPORT (#9) — Nhập liệu hàng loạt từ Excel ──
  importTemplate(entityKey: string): Promise<{ ok: boolean; data?: ImportTemplateColumn[]; error?: string; message?: string }>;
  importDryRun(entityKey: string, rows: Record<string, unknown>[]): Promise<ImportDryRunResult>;
  importRun(entityKey: string, rows: Record<string, unknown>[]): Promise<ImportRunResult>;

  // Thùng rác (E4)
  trashList(): Promise<{ ok: boolean; data?: TrashRow[]; error?: string; message?: string }>;
  trashRestore(entityType: string, id: number): Promise<MutationOutcome>;
  trashLinkSummary(entityType: string, id: number): Promise<{ ok: boolean; data?: TrashLinkRef[]; error?: string; message?: string }>;
  trashPurge(entityType: string, id: number, password: string): Promise<MutationOutcome>;
  trashEmptyAll(level2Password: string): Promise<{ ok: boolean; purged?: number; error?: string; message?: string }>;

  // Dashboard (Nhóm B — KPI realtime + tăng trưởng)
  dashboardStats(): Promise<{ ok: boolean; data?: DashboardStats; error?: string; message?: string }>;
  dashboardProfit(): Promise<{ ok: boolean; data?: ProfitStats; error?: string; message?: string }>;

  // Hòm thư nội bộ + thông báo bảo mật (Nhóm A #2 / Nhóm C #7)
  messageInbox(): Promise<{ ok: boolean; data?: MessageDto[]; error?: string; message?: string }>;
  messageUnreadCount(): Promise<{ ok: boolean; data?: number; error?: string; message?: string }>;
  messageMarkRead(id: number): Promise<MutationOutcome>;
  messageMarkAllRead(): Promise<MutationOutcome>;
  messageSend(input: { recipientId: number; subject: string; body: string }): Promise<MutationOutcome>;

  // Doanh thu & Công nợ (Nhóm B)
  transactionList(filter: TransactionFilter): Promise<ListTransactionsResult>;
  transactionCreate(input: CreateTransactionInput): Promise<MutationOutcome>;
  transactionUpdate(id: number, input: UpdateTransactionInput): Promise<MutationOutcome>;
  transactionDelete(ids: number[], password: string): Promise<BulkDeleteOutcome>;
  // FIX 2 — transactionSettle đã GỠ (H5): handler 'transaction:settle' không còn; settled chỉ đổi qua phiếu Thu công nợ.
  debtSummary(filter: TransactionFilter): Promise<{ ok: boolean; data?: DebtSummary; error?: string; message?: string }>;
  debtOpenTransactions(filter: TransactionFilter): Promise<DebtOpenResult>;
  // H2b — phân loại chất lượng công nợ + ghi giảm nợ xấu
  debtByQuality(filter: TransactionFilter): Promise<{ ok: boolean; data?: DebtByQualityResult; error?: string; message?: string }>;
  debtClassify(transactionId: number, quality: string, reason?: string): Promise<MutationOutcome>;
  debtQualityHistory(transactionId: number): Promise<{ ok: boolean; data?: DebtQualityLogDto[]; error?: string; message?: string }>;
  debtWriteOff(transactionId: number, actorPassword: string): Promise<MutationOutcome>;

  // ── P1.2 Approval Engine (hủy bill có duyệt) ──
  cancelRequest(transactionId: number, reason: string): Promise<MutationOutcome>;
  cancelRequestList(status?: string): Promise<ListResult<CancelRequestDto>>;
  cancelApprove(requestId: number, note?: string): Promise<MutationOutcome>;
  cancelReject(requestId: number, note: string): Promise<MutationOutcome>;
  cancelApproveBulk(requestIds: number[], note?: string): Promise<BulkSkipOutcome>;
  cancelRejectBulk(requestIds: number[], note: string): Promise<BulkSkipOutcome>;

  // ── R34 Duyệt hủy (xóa qua duyệt) TID/POS/Khách/Nhân sự ──
  entityCancelRequest(entityType: string, entityId: number, reason: string): Promise<MutationOutcome>;
  entityCancelList(status?: string, entityType?: string): Promise<ListResult<EntityCancelRequestDto>>;
  entityCancelApprove(entityType: string, requestId: number, password: string, note?: string): Promise<MutationOutcome>;
  entityCancelReject(entityType: string, requestId: number, note: string): Promise<MutationOutcome>;

  // Bảo trì & Bộ nhớ (Nhóm E — Storage-Guard)
  storageStatus(): Promise<{ ok: boolean; data?: StorageStatus; error?: string; message?: string }>;
  storageCleanup(opts: { clearHistory?: boolean; purgeTrash?: boolean; password: string }): Promise<{ ok: boolean; error?: string; message?: string; backupFile?: string; auditDeleted?: number; trashDeleted?: number }>;
  storageUpdateConfig(cfg: StorageConfigInput): Promise<{ ok: boolean; error?: string; message?: string }>;

  // Bảo trì: quét sức khỏe toàn hệ thống + lịch sử bảo trì
  healthScan(opts: { autoFix?: boolean }): Promise<{ ok: boolean; error?: string; message?: string; data?: ScanResult }>;
  healthRuns(limit?: number): Promise<{ ok: boolean; error?: string; message?: string; data?: MaintenanceRunDto[] }>;
  healthRun(id: number): Promise<{ ok: boolean; error?: string; message?: string; data?: MaintenanceRunDto }>;

  // ── G11 Cập nhật phần mềm tích hợp (electron-updater) ──
  getAppVersion(): Promise<string>;
  checkUpdate(): Promise<void>;
  startUpdate(): Promise<void>;
  installUpdateNow(): Promise<void>;
  /** [H2] Kết quả cập nhật lúc khởi động — PULL lúc mount (null nếu không có / đã tiêu thụ). */
  getUpdateBootResult(): Promise<UpdateBootResult | null>;
  /** Đăng ký sự kiện realtime; trả hàm hủy đăng ký để gọi lúc unmount ([M8]). */
  onUpdateAvailable(cb: (p: { version: string }) => void): () => void;
  onDownloadProgress(cb: (p: { percent: number }) => void): () => void;
  onUpdateDownloaded(cb: (p: { version: string }) => void): () => void;
  onUpdateError(cb: (p: { message: string }) => void): () => void;
}

// ── G11 DTO — kết quả cập nhật lúc khởi động (đọc từ marker userData/update-result.json) ──
export type UpdateBootResult =
  | { kind: 'success'; version: string; at: string }
  | { kind: 'failed'; fromVersion: string; targetVersion: string };

export type HealthSeverity = 'ERROR' | 'WARN' | 'INFO';
export interface HealthFinding {
  code: string;
  severity: HealthSeverity;
  title: string;
  count: number;
  detail: string;
  suggestion: string;
  autoFixable: boolean;
  sampleIds?: number[];
}
export interface ScanResult {
  runId: number;
  status: 'OK' | 'WARN' | 'ERROR';
  checksTotal: number;
  issuesFound: number;
  errorCount: number;
  warnCount: number;
  autoFixed: number;
  durationMs: number;
  findings: HealthFinding[];
}
export interface MaintenanceRunDto {
  id: number;
  kind: string;
  status: string;
  checksTotal: number;
  issuesFound: number;
  errorCount: number;
  warnCount: number;
  autoFixed: number;
  vacuumed: boolean;
  auditDeleted: number;
  trashDeleted: number;
  durationMs: number;
  triggeredByName: string | null;
  startedAt: string;
  finishedAt: string | null;
  findings?: HealthFinding[];
}

export interface StorageConfigInput {
  thresholdPct?: number;
  auditRetentionDays?: number;
  trashRetentionDays?: number;
  backupIntervalHours?: number;
  maintenanceDayOfWeek?: number;
  maintenanceHour?: number;
  maintenanceEnabled?: boolean;
  autoPurgeWeekly?: boolean;
}

export interface StorageStatus {
  dbBytes: number;
  dbPath: string;
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
  diskUsedPct: number | null;
  thresholdPct: number;
  over: boolean;
  lastBackupAt: string | null;
  lastAlertAt: string | null;
  lastMaintenanceAt: string | null;
  backupIntervalHours: number;
  maintenanceEnabled: boolean;
  maintenanceDayOfWeek: number;
  maintenanceHour: number;
  autoPurgeWeekly: boolean;
  cleanable: {
    auditOld: number;
    trashOld: number;
    auditRetentionDays: number;
    trashRetentionDays: number;
  };
}

export interface TransactionDto {
  id: number;
  code: string | null;
  tidId: number;
  tid: string | null;
  mid: string | null;
  hkdName: string | null;
  bankId: number | null;
  bankName: string | null;
  partnerId: number | null;
  partnerName: string | null;
  customerId: number | null;
  customerName: string | null;
  cardTypeId: number | null;
  cardTypeName: string | null;
  amount: number;
  partnerMarginPct: number;
  sellMarginPct: number;
  revenuePartner: number;
  revenueSell: number;
  revenueAmount: number;
  settled: boolean;
  settledAt: string | null;
  status: string; // P1.2: POSTED | CANCEL_PENDING | CANCELLED
  txnDate: string;
  note: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
}

export interface TransactionFilter {
  tidId?: number;
  mid?: string;
  hkdName?: string;
  partnerId?: number;
  bankId?: number;
  customerId?: number;
  cardTypeId?: number;
  dateFrom?: string;
  dateTo?: string;
  settled?: boolean;
  page?: number;
  pageSize?: number;
}

export interface RevenueSummary {
  count: number;
  totalAmount: number;
  totalRevenuePartner: number;
  totalRevenueSell: number;
  totalRevenue: number;
}

export interface DebtSummary {
  count: number;
  debtPartner: number;
  debtSell: number;
  debtTotal: number;
}

// H2b — phân loại chất lượng công nợ (Dễ/Khó/Không thu hồi) + lịch sử đổi.
export interface DebtQualityStat {
  count: number;
  debtPartner: number;
  debtSell: number;
  debtTotal: number;
}
export interface DebtByQualityResult {
  GOOD: DebtQualityStat;
  HARD: DebtQualityStat;
  BAD: DebtQualityStat;
  UNCLASSIFIED: DebtQualityStat;
}
export interface DebtQualityLogDto {
  id: number;
  fromQuality: string | null;
  toQuality: string;
  reason: string | null;
  actorUserId: number;
  actorName: string | null;
  createdAt: string;
}

export interface ListTransactionsResult {
  ok: boolean;
  error?: string;
  message?: string;
  data?: TransactionDto[];
  total?: number;
  page?: number;
  pageSize?: number;
  summary?: RevenueSummary;
}

export interface CreateTransactionInput {
  tidId: number;
  cardTypeId: number;
  amount: number;
  txnDate: string;
  customerId?: number | null;
  note?: string;
}

export interface UpdateTransactionInput {
  cardTypeId?: number;
  amount?: number;
  txnDate?: string;
  customerId?: number | null;
  note?: string;
}

export interface DashboardStats {
  counts: { tids: number; customers: number; posDevices: number; dossiers: number; users: number; banks: number; banksActive: number; banksInactive: number; partners: number };
  tidsByBank: { label: string; count: number }[];
  posByStatus: { label: string; count: number }[];
  monthly: { month: string; tids: number; customers: number }[];
}

export interface MessageDto {
  id: number;
  kind: string;
  category: string | null;
  subject: string;
  body: string;
  senderId: number | null;
  senderName: string | null;
  recipientId: number;
  readAt: string | null;
  createdAt: string;
}

export interface TrashRow {
  entityType: string;
  entityLabel: string;
  id: number;
  code: string | null;
  label: string;
  deletedAt: string;
  deletedBy: number | null;
  deletedByName: string | null;
}

export interface TrashLinkRef {
  label: string;
  count: number;
}

// ── XUẤT EXCEL chuẩn nhà (R38/R39) ──
export interface ReportExportInput {
  kind?: 'report' | 'template';
  fileBase: string; // tên gốc tiếng Việt, ví dụ "Danh sách ngân hàng"
  fileName: string; // tên file gợi ý đầy đủ, ví dụ "Danh sách ngân hàng 11.7.2026.xlsx"
  title: string; // tiêu đề bảng (sẽ IN HOA)
  headers: string[];
  rows?: (string | number | null | undefined)[][];
  summary?: string;
  hints?: { header: string; required?: boolean; hint?: string }[];
}

// ── PHASE IMPORT (#9) — Nhập liệu hàng loạt từ Excel ──
export type ImportColumnKind = 'text' | 'int' | 'money' | 'date' | 'ref' | 'enum';
export interface ImportTemplateColumn {
  header: string;
  required: boolean;
  kind: ImportColumnKind;
  hint?: string;
}
export interface ImportRowResult {
  rowIndex: number;
  ok: boolean;
  id?: number;
  error?: string;
  message?: string;
}
export interface ImportRunResult {
  ok: boolean;
  error?: string;
  message?: string;
  results?: ImportRowResult[];
  summary?: { created: number; skipped: number };
}
export interface ImportDryRunResult {
  ok: boolean;
  error?: string;
  message?: string;
  results?: { rowIndex: number; ok: boolean; error?: string; message?: string }[];
  summary?: { validCount: number; invalidCount: number };
}

declare global {
  interface Window {
    api: GlbApi;
  }
}
