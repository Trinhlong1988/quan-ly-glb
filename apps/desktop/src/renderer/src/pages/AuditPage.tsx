import { useEffect, useState } from 'react';
import { Loader2, ScrollText, Search } from 'lucide-react';
import type { AuditRowDto } from '../../../preload/index.d';
import { fmtDate, fmtTime, fmtDateTime } from '@glb/shared';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { inputCls } from '../components/Field.js';

const ACTIONS = [
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'PERMISSION_DENIED',
  'USER_CREATED', 'USER_UPDATED', 'USER_LOCKED', 'USER_UNLOCKED', 'USER_DELETED',
  'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_LOCKED', 'ROLE_UNLOCKED', 'ROLE_DELETED',
  'PASSWORD_CHANGED', 'BACKUP_CREATED', 'RESTORE_EXECUTED', 'SETTING_UPDATED',
  'CUSTOMER_CREATED', 'CUSTOMER_UPDATED', 'CUSTOMER_DELETED',
  'BANK_CREATED', 'BANK_UPDATED', 'BANK_DELETED',
  'CARD_TYPE_CREATED', 'CARD_TYPE_UPDATED', 'CARD_TYPE_DELETED',
  'PARTNER_CREATED', 'PARTNER_UPDATED', 'PARTNER_DELETED',
  'PARTNER_BANK_LINKED', 'PARTNER_BANK_UNLINKED',
  'SUPPLIER_CREATED', 'SUPPLIER_UPDATED', 'SUPPLIER_DELETED',
  'POS_MODEL_CREATED', 'POS_MODEL_UPDATED', 'POS_MODEL_DELETED',
  'INTAKE_STATUS_CREATED', 'INTAKE_STATUS_UPDATED', 'INTAKE_STATUS_DELETED',
  'POS_INTAKE_CREATED', 'POS_INTAKE_UPDATED', 'POS_INTAKE_DELETED',
  'FEE_TYPE_CREATED', 'FEE_TYPE_UPDATED', 'FEE_TYPE_DELETED',
  'FEE_RATE_SET', 'FEE_RATE_DELETED',
  'RCV_ACCT_SOURCE_CREATED', 'RCV_ACCT_SOURCE_UPDATED', 'RCV_ACCT_SOURCE_DELETED',
  'RCV_ACCT_CREATED', 'RCV_ACCT_UPDATED', 'RCV_ACCT_DELETED',
  'DOSSIER_SOURCE_CREATED', 'DOSSIER_SOURCE_UPDATED', 'DOSSIER_SOURCE_DELETED',
  'DOSSIER_CREATED', 'DOSSIER_UPDATED', 'DOSSIER_DELETED'
];

/** Nhãn tiếng Việt cho mã hành động (nhật ký 100% tiếng Việt). */
const ACTION_LABEL: Record<string, string> = {
  LOGIN_SUCCESS: 'Đăng nhập thành công', LOGIN_FAILED: 'Đăng nhập thất bại', PERMISSION_DENIED: 'Từ chối quyền',
  USER_CREATED: 'Tạo nhân sự', USER_UPDATED: 'Sửa nhân sự', USER_LOCKED: 'Khóa nhân sự', USER_UNLOCKED: 'Mở khóa nhân sự', USER_DELETED: 'Xóa nhân sự',
  ROLE_CREATED: 'Tạo vai trò', ROLE_UPDATED: 'Sửa vai trò', ROLE_LOCKED: 'Khóa vai trò', ROLE_UNLOCKED: 'Mở khóa vai trò', ROLE_DELETED: 'Xóa vai trò',
  PASSWORD_CHANGED: 'Đổi mật khẩu', BACKUP_CREATED: 'Tạo bản sao lưu', RESTORE_EXECUTED: 'Phục hồi dữ liệu', SETTING_UPDATED: 'Cập nhật cấu hình',
  CUSTOMER_CREATED: 'Tạo khách hàng', CUSTOMER_UPDATED: 'Sửa khách hàng', CUSTOMER_DELETED: 'Xóa khách hàng',
  BANK_CREATED: 'Tạo ngân hàng', BANK_UPDATED: 'Sửa ngân hàng', BANK_DELETED: 'Xóa ngân hàng',
  CARD_TYPE_CREATED: 'Tạo loại thẻ', CARD_TYPE_UPDATED: 'Sửa loại thẻ', CARD_TYPE_DELETED: 'Xóa loại thẻ',
  PARTNER_CREATED: 'Tạo đối tác', PARTNER_UPDATED: 'Sửa đối tác', PARTNER_DELETED: 'Xóa đối tác',
  PARTNER_BANK_LINKED: 'Liên kết đối tác ↔ ngân hàng', PARTNER_BANK_UNLINKED: 'Hủy liên kết đối tác ↔ ngân hàng',
  SUPPLIER_CREATED: 'Tạo nhà cung cấp', SUPPLIER_UPDATED: 'Sửa nhà cung cấp', SUPPLIER_DELETED: 'Xóa nhà cung cấp',
  POS_MODEL_CREATED: 'Tạo chủng loại POS', POS_MODEL_UPDATED: 'Sửa chủng loại POS', POS_MODEL_DELETED: 'Xóa chủng loại POS',
  INTAKE_STATUS_CREATED: 'Tạo trạng thái nhập máy', INTAKE_STATUS_UPDATED: 'Sửa trạng thái nhập máy', INTAKE_STATUS_DELETED: 'Xóa trạng thái nhập máy',
  POS_INTAKE_CREATED: 'Nhập kho máy POS', POS_INTAKE_UPDATED: 'Sửa máy POS nhập kho', POS_INTAKE_DELETED: 'Xóa máy POS nhập kho',
  FEE_TYPE_CREATED: 'Tạo loại phí', FEE_TYPE_UPDATED: 'Sửa loại phí', FEE_TYPE_DELETED: 'Xóa loại phí',
  FEE_RATE_SET: 'Đặt biểu phí', FEE_RATE_DELETED: 'Xóa biểu phí',
  RCV_ACCT_SOURCE_CREATED: 'Tạo nguồn TK nhận tiền', RCV_ACCT_SOURCE_UPDATED: 'Sửa nguồn TK nhận tiền', RCV_ACCT_SOURCE_DELETED: 'Xóa nguồn TK nhận tiền',
  RCV_ACCT_CREATED: 'Tạo TK nhận tiền', RCV_ACCT_UPDATED: 'Sửa TK nhận tiền', RCV_ACCT_DELETED: 'Xóa TK nhận tiền',
  DOSSIER_SOURCE_CREATED: 'Tạo nguồn hồ sơ', DOSSIER_SOURCE_UPDATED: 'Sửa nguồn hồ sơ', DOSSIER_SOURCE_DELETED: 'Xóa nguồn hồ sơ',
  DOSSIER_CREATED: 'Tạo hồ sơ HKD', DOSSIER_UPDATED: 'Sửa hồ sơ HKD', DOSSIER_DELETED: 'Xóa hồ sơ HKD'
};
const actionLabel = (a: string): string => ACTION_LABEL[a] ?? a;

/** Nhãn tiếng Việt cho loại đối tượng bị tác động. */
const TARGET_LABEL: Record<string, string> = {
  User: 'Nhân sự', Role: 'Vai trò', Customer: 'Khách hàng', PosDevice: 'Máy POS', Tid: 'TID',
  Backup: 'Sao lưu', AppSetting: 'Cấu hình', Bank: 'Ngân hàng', CardType: 'Loại thẻ', Partner: 'Đối tác',
  Supplier: 'Nhà cung cấp', PosModel: 'Chủng loại máy POS', PosIntakeStatus: 'Trạng thái nhập máy', PosIntake: 'Máy POS nhập kho',
  FeeType: 'Loại phí', FeeRate: 'Biểu phí', ReceiveAccountSource: 'Nguồn TK nhận tiền', ReceiveAccount: 'TK nhận tiền',
  DossierSource: 'Nguồn hồ sơ', Dossier: 'Hồ sơ HKD'
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

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Nhật ký hệ thống</h2>
        <p className="text-sm text-slate-500">Chỉ đọc — không thể xóa log từ giao diện (R_AUDIT_001).</p>
      </div>

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
        <button onClick={reload} className="rounded-md border border-line px-3 py-2 text-sm text-slate-600 hover:bg-appbg">
          Lọc
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
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
