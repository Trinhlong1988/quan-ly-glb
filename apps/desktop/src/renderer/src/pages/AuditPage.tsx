import { useEffect, useState } from 'react';
import { Loader2, ScrollText, Search, Download, FilterX, RefreshCw } from 'lucide-react';
import type { AuditRowDto } from '../../../preload/index.d';
import { fmtDate, fmtTime, fmtDateTime, type AuditAction } from '@glb/shared';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { Button } from '../components/Button.js';
import { inputCls } from '../components/Field.js';
import { StatBar } from '../components/StatBar.js';
import { exportCsv } from '../lib/exportCsv.js';

/**
 * Nhãn tiếng Việt cho MỌI mã hành động (nhật ký 100% tiếng Việt — R36 Mr.Long 12/7).
 * Kiểu `Record<AuditAction, string>` BẮT BUỘC đủ mọi nhánh union: thêm AuditAction mới mà quên nhãn
 * → typecheck FAIL ngay (chống tái diễn gap "thêm enum quên nhãn UI" khiến log lòi tiếng Anh).
 */
const ACTION_LABEL: Record<AuditAction, string> = {
  LOGIN_SUCCESS: 'Đăng nhập thành công', LOGIN_FAILED: 'Đăng nhập thất bại', PERMISSION_DENIED: 'Từ chối quyền',
  USER_CREATED: 'Tạo nhân sự', USER_UPDATED: 'Sửa nhân sự', USER_LOCKED: 'Khóa nhân sự', USER_UNLOCKED: 'Mở khóa nhân sự', USER_DELETED: 'Xóa nhân sự',
  USER_AUTO_LOCKED: 'Tự khóa nhân sự (sai quá số lần)', PASSWORD_RESET_BY_ADMIN: 'Admin đặt lại mật khẩu',
  LEVEL2_SET: 'Đặt mật khẩu cấp 2', LEVEL2_RESET: 'Đặt lại mật khẩu cấp 2',
  TRASH_PURGED: 'Xóa vĩnh viễn khỏi thùng rác', TRASH_EMPTIED: 'Dọn sạch thùng rác',
  ROLE_CREATED: 'Tạo vai trò', ROLE_UPDATED: 'Sửa vai trò', ROLE_LOCKED: 'Khóa vai trò', ROLE_UNLOCKED: 'Mở khóa vai trò', ROLE_DELETED: 'Xóa vai trò',
  PASSWORD_CHANGED: 'Đổi mật khẩu', BACKUP_CREATED: 'Tạo bản sao lưu', RESTORE_EXECUTED: 'Phục hồi dữ liệu', SETTING_UPDATED: 'Cập nhật cấu hình',
  AUTO_BACKUP: 'Tự động sao lưu', AUTO_BACKUP_FAILED: 'Sao lưu tự động THẤT BẠI', BACKUP_STALE: 'Sao lưu quá hạn (cảnh báo)',
  BACKUP_MIRRORED: 'Nhân bản sao lưu (tầng 2)', BACKUP_MIRROR_FAILED: 'Nhân bản sao lưu THẤT BẠI',
  STORAGE_ALERT: 'Cảnh báo dung lượng', STORAGE_CLEANUP: 'Dọn dẹp dung lượng',
  CUSTOMER_CREATED: 'Tạo khách hàng', CUSTOMER_UPDATED: 'Sửa khách hàng', CUSTOMER_DELETED: 'Xóa khách hàng',
  POS_CREATED: 'Tạo máy POS', POS_UPDATED: 'Sửa máy POS', POS_TRANSITION: 'Chuyển trạng thái máy POS',
  TID_CREATED: 'Tạo TID', TID_UPDATED: 'Sửa TID', TID_ASSIGNED: 'Gắn TID vào máy', TID_REPLACED: 'Thay TID', TID_RECALLED: 'Thu hồi TID', TID_DELIVERED: 'Giao máy cho khách',
  ASSET_EXPORTED: 'Xuất dữ liệu tài sản',
  BANK_CREATED: 'Tạo ngân hàng', BANK_UPDATED: 'Sửa ngân hàng', BANK_DELETED: 'Xóa ngân hàng',
  CARD_TYPE_CREATED: 'Tạo loại thẻ', CARD_TYPE_UPDATED: 'Sửa loại thẻ', CARD_TYPE_DELETED: 'Xóa loại thẻ',
  PARTNER_CREATED: 'Tạo đối tác', PARTNER_UPDATED: 'Sửa đối tác', PARTNER_DELETED: 'Xóa đối tác',
  PARTNER_BANK_LINKED: 'Liên kết đối tác ↔ ngân hàng', PARTNER_BANK_UNLINKED: 'Hủy liên kết đối tác ↔ ngân hàng',
  STATUS_OPTION_CREATED: 'Tạo tùy chọn trạng thái', STATUS_OPTION_UPDATED: 'Sửa tùy chọn trạng thái', STATUS_OPTION_DELETED: 'Xóa tùy chọn trạng thái',
  TID_SELL_FEE_SET: 'Đặt phí bán theo TID',
  TID_CANCEL_REQUESTED: 'Yêu cầu hủy TID', TID_CANCEL_APPROVED: 'Duyệt hủy TID', TID_CANCEL_REJECTED: 'Từ chối hủy TID',
  POS_CANCEL_REQUESTED: 'Yêu cầu hủy máy POS', POS_CANCEL_APPROVED: 'Duyệt hủy máy POS', POS_CANCEL_REJECTED: 'Từ chối hủy máy POS',
  CUSTOMER_CANCEL_REQUESTED: 'Yêu cầu hủy khách hàng', CUSTOMER_CANCEL_APPROVED: 'Duyệt hủy khách hàng', CUSTOMER_CANCEL_REJECTED: 'Từ chối hủy khách hàng',
  USER_CANCEL_REQUESTED: 'Yêu cầu hủy nhân sự', USER_CANCEL_APPROVED: 'Duyệt hủy nhân sự', USER_CANCEL_REJECTED: 'Từ chối hủy nhân sự',
  SUPPLIER_CREATED: 'Tạo nhà cung cấp', SUPPLIER_UPDATED: 'Sửa nhà cung cấp', SUPPLIER_DELETED: 'Xóa nhà cung cấp',
  POS_MODEL_CREATED: 'Tạo chủng loại POS', POS_MODEL_UPDATED: 'Sửa chủng loại POS', POS_MODEL_DELETED: 'Xóa chủng loại POS',
  INTAKE_STATUS_CREATED: 'Tạo trạng thái nhập máy', INTAKE_STATUS_UPDATED: 'Sửa trạng thái nhập máy', INTAKE_STATUS_DELETED: 'Xóa trạng thái nhập máy',
  POS_INTAKE_CREATED: 'Nhập kho máy POS', POS_INTAKE_UPDATED: 'Sửa máy POS nhập kho', POS_INTAKE_DELETED: 'Xóa máy POS nhập kho',
  POS_UNIFY_BACKFILL: 'Hợp nhất dữ liệu POS', TID_UNIFY_DOSSIER_BACKFILL: 'Hợp nhất hồ sơ TID',
  FEE_TYPE_CREATED: 'Tạo loại phí', FEE_TYPE_UPDATED: 'Sửa loại phí', FEE_TYPE_DELETED: 'Xóa loại phí',
  FEE_RATE_SET: 'Đặt biểu phí', FEE_RATE_DELETED: 'Xóa biểu phí',
  RCV_ACCT_SOURCE_CREATED: 'Tạo nguồn TK nhận tiền', RCV_ACCT_SOURCE_UPDATED: 'Sửa nguồn TK nhận tiền', RCV_ACCT_SOURCE_DELETED: 'Xóa nguồn TK nhận tiền',
  RCV_ACCT_CREATED: 'Tạo TK nhận tiền', RCV_ACCT_UPDATED: 'Sửa TK nhận tiền', RCV_ACCT_DELETED: 'Xóa TK nhận tiền',
  DOSSIER_SOURCE_CREATED: 'Tạo nguồn hồ sơ', DOSSIER_SOURCE_UPDATED: 'Sửa nguồn hồ sơ', DOSSIER_SOURCE_DELETED: 'Xóa nguồn hồ sơ',
  DOSSIER_CREATED: 'Tạo hồ sơ HKD', DOSSIER_UPDATED: 'Sửa hồ sơ HKD', DOSSIER_DELETED: 'Xóa hồ sơ HKD',
  TID_CONFIG_STATUS_CREATED: 'Tạo trạng thái TID', TID_CONFIG_STATUS_UPDATED: 'Sửa trạng thái TID', TID_CONFIG_STATUS_DELETED: 'Xóa trạng thái TID',
  TID_CONFIG_CREATED: 'Tạo cấu hình TID', TID_CONFIG_UPDATED: 'Sửa cấu hình TID', TID_CONFIG_DELETED: 'Xóa cấu hình TID',
  INDUSTRY_CREATED: 'Tạo ngành nghề', INDUSTRY_UPDATED: 'Sửa ngành nghề', INDUSTRY_DELETED: 'Xóa ngành nghề', INDUSTRY_PERMS_GRANTED: 'Cấp quyền ngành nghề',
  CASH_CATEGORY_CREATED: 'Tạo danh mục thu/chi', CASH_CATEGORY_UPDATED: 'Sửa danh mục thu/chi', CASH_CATEGORY_DELETED: 'Xóa danh mục thu/chi', CASHCAT_PERMS_GRANTED: 'Cấp quyền danh mục thu/chi',
  FUND_CREATED: 'Tạo quỹ', FUND_UPDATED: 'Sửa quỹ', FUND_DELETED: 'Xóa quỹ',
  CASH_ENTRY_CREATED: 'Tạo phiếu thu/chi', CASH_ENTRY_CANCELLED: 'Hủy phiếu thu/chi', CASH_DEBT_RECEIPT_CREATED: 'Tạo phiếu thu công nợ', CASHFLOW_PERMS_GRANTED: 'Cấp quyền thu/chi',
  DEBT_CLASSIFIED: 'Phân loại chất lượng công nợ', DEBT_WRITTEN_OFF: 'Ghi giảm nợ xấu', DEBT_QUALITY_PERMS_GRANTED: 'Cấp quyền chất lượng công nợ',
  MESSAGE_SENT: 'Gửi tin nhắn',
  TRANSACTION_CREATED: 'Tạo giao dịch', TRANSACTION_UPDATED: 'Sửa giao dịch', TRANSACTION_DELETED: 'Xóa giao dịch', DEBT_SETTLED: 'Tất toán công nợ',
  BILL_CANCEL_REQUESTED: 'Yêu cầu hủy bill', BILL_CANCEL_APPROVED: 'Duyệt hủy bill', BILL_CANCEL_REJECTED: 'Từ chối hủy bill'
};
// Danh sách filter = KHÓA của map (1 nguồn sự thật duy nhất — không còn mảng ACTIONS lệch pha), sắp theo nhãn Việt.
const ACTIONS = (Object.keys(ACTION_LABEL) as AuditAction[]).sort((a, b) => ACTION_LABEL[a].localeCompare(ACTION_LABEL[b], 'vi'));
const actionLabel = (a: string): string => (ACTION_LABEL as Record<string, string>)[a] ?? a;

/** Nhãn tiếng Việt cho MỌI loại đối tượng bị tác động (đồng bộ với targetType thực tế ghi ở main). */
const TARGET_LABEL: Record<string, string> = {
  User: 'Nhân sự', Role: 'Vai trò', Customer: 'Khách hàng', PosDevice: 'Máy POS', Tid: 'TID',
  Backup: 'Sao lưu', AppSetting: 'Cấu hình', Bank: 'Ngân hàng', CardType: 'Loại thẻ', Partner: 'Đối tác',
  Supplier: 'Nhà cung cấp', PosModel: 'Chủng loại máy POS', PosIntakeStatus: 'Trạng thái nhập máy', PosIntake: 'Máy POS nhập kho',
  FeeType: 'Loại phí', FeeRate: 'Biểu phí', ReceiveAccountSource: 'Nguồn TK nhận tiền', ReceiveAccount: 'TK nhận tiền',
  DossierSource: 'Nguồn hồ sơ', Dossier: 'Hồ sơ HKD', TidConfigStatus: 'Trạng thái TID',
  ApprovalRequest: 'Yêu cầu duyệt', Transaction: 'Giao dịch', Fund: 'Quỹ', CashEntry: 'Phiếu thu/chi',
  CashCategory: 'Danh mục thu/chi', Industry: 'Ngành nghề', StatusOption: 'Tùy chọn trạng thái',
  Message: 'Tin nhắn', Import: 'Nhập dữ liệu', System: 'Hệ thống'
};
const targetLabel = (t: string): string => TARGET_LABEL[t] ?? t;

function badge(action: string): string {
  if (action.includes('FAILED') || action.includes('DENIED') || action.includes('DELETED')) return 'bg-danger/10 text-danger';
  if (action.includes('CREATED') || action.includes('SUCCESS')) return 'bg-success/10 text-success';
  if (action.includes('LOCKED')) return 'bg-warning/10 text-warning';
  return 'bg-brand-tint text-brand';
}

export function AuditPage(): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<AuditRowDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<AuditRowDto | null>(null);

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.auditList({ action: action || undefined, search: search || undefined, limit: 300 });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  function resetFilters(): void {
    setAction('');
    setSearch('');
    setTimeout(reload, 0);
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Nhật ký hệ thống</h2>
        <p className="text-sm text-slate-500">Chỉ đọc — không thể xóa log từ giao diện (R_AUDIT_001).</p>
      </div>

      {/* Bộ đếm theo NHÓM hành động — đếm CLIENT từ danh sách đã tải (auditList giới hạn 300 bản
          ghi gần nhất). Tông màu khớp badge từng dòng: tạo=xanh, khóa=vàng, xóa/lỗi=đỏ. */}
      <StatBar
        items={[
          { label: 'Tổng bản ghi', value: rows.length, tone: 'bg-brand-tint text-brand', sub: 'tối đa 300 gần nhất' },
          { label: 'Tạo mới / đăng nhập', value: rows.filter((r) => r.action.includes('CREATED') || r.action.includes('SUCCESS')).length, tone: 'bg-success/10 text-success' },
          { label: 'Khóa', value: rows.filter((r) => r.action.includes('LOCKED')).length, tone: 'bg-warning/10 text-warning' },
          { label: 'Xóa / lỗi / từ chối', value: rows.filter((r) => r.action.includes('DELETED') || r.action.includes('FAILED') || r.action.includes('DENIED')).length, tone: 'bg-danger/10 text-danger' }
        ]}
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && reload()}
            placeholder="Tìm hành động, đối tượng…"
            className={inputCls + ' w-72 pl-8'}
          />
        </div>
        <select className={inputCls} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">Tất cả hành động</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {actionLabel(a)}
            </option>
          ))}
        </select>
        <button onClick={reload} className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-hover">
          Lọc
        </button>
        <button onClick={resetFilters} title="Xóa toàn bộ bộ lọc, đưa về mặc định" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-brand/10 text-brand hover:bg-brand/20">
          <FilterX className="h-4 w-4" /> Xóa lọc
        </button>
        <button onClick={reload} title="Tải lại dữ liệu mới nhất (giữ nguyên bộ lọc)" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-brand/10 text-brand hover:bg-brand/20">
          <RefreshCw className="h-4 w-4" /> Làm mới
        </button>
        <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('nhat_ky', ['Ngày', 'Giờ', 'Người thao tác', 'Hành động', 'Đối tượng'], rows.map((r) => [fmtDate(r.createdAt), fmtTime(r.createdAt), r.actorUsername ?? (r.actorUserId ? `#${r.actorUserId}` : ''), actionLabel(r.action), r.targetType ? targetLabel(r.targetType) + (r.targetId ? ` #${r.targetId}` : '') : '']))}>
          Xuất Excel
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Ngày</th>
              <th className="px-4 py-3">Giờ</th>
              <th className="px-4 py-3">Người thao tác</th>
              <th className="px-4 py-3">Hành động</th>
              <th className="px-4 py-3">Đối tượng</th>
              <th className="px-4 py-3 text-right">Chi tiết</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  <ScrollText className="mx-auto mb-2 h-6 w-6" /> Chưa có nhật ký.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-appbg/60">
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(r.createdAt)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtTime(r.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-600">{r.actorUsername ?? (r.actorUserId ? `#${r.actorUserId}` : '—')}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${badge(r.action)}`}>{actionLabel(r.action)}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.targetType ? targetLabel(r.targetType) : '—'}
                    {r.targetId ? ` #${r.targetId}` : ''}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {(r.beforeJson || r.afterJson) && (
                      <button onClick={() => setDetail(r)} className="text-xs font-medium text-brand hover:underline">
                        Xem
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <Modal title={`Nhật ký #${detail.id} — ${detail.action}`} onClose={() => setDetail(null)} width="max-w-2xl">
          <div className="space-y-3 text-sm">
            <div className="text-xs text-slate-500">
              {fmtDateTime(detail.createdAt)} · {detail.actorUsername ?? '—'} · {detail.deviceInfo ?? ''}
            </div>
            {detail.beforeJson && (
              <div>
                <div className="mb-1 font-medium text-slate-700">Trước khi thay đổi</div>
                <pre className="overflow-auto rounded-lg bg-appbg p-3 text-xs text-slate-600">{pretty(detail.beforeJson)}</pre>
              </div>
            )}
            {detail.afterJson && (
              <div>
                <div className="mb-1 font-medium text-slate-700">Sau khi thay đổi</div>
                <pre className="overflow-auto rounded-lg bg-appbg p-3 text-xs text-slate-600">{pretty(detail.afterJson)}</pre>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
