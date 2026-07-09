import { useEffect, useState } from 'react';
import { Loader2, ScrollText, Search } from 'lucide-react';
import type { AuditRowDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { inputCls } from '../components/Field.js';

const ACTIONS = [
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'PERMISSION_DENIED',
  'USER_CREATED', 'USER_UPDATED', 'USER_LOCKED', 'USER_UNLOCKED', 'USER_DELETED',
  'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_LOCKED', 'ROLE_UNLOCKED', 'ROLE_DELETED',
  'PASSWORD_CHANGED', 'BACKUP_CREATED', 'RESTORE_EXECUTED', 'SETTING_UPDATED',
  'CUSTOMER_CREATED', 'CUSTOMER_UPDATED', 'CUSTOMER_DELETED'
];

/** Nhãn tiếng Việt cho mã hành động (nhật ký 100% tiếng Việt). */
const ACTION_LABEL: Record<string, string> = {
  LOGIN_SUCCESS: 'Đăng nhập thành công', LOGIN_FAILED: 'Đăng nhập thất bại', PERMISSION_DENIED: 'Từ chối quyền',
  USER_CREATED: 'Tạo nhân sự', USER_UPDATED: 'Sửa nhân sự', USER_LOCKED: 'Khóa nhân sự', USER_UNLOCKED: 'Mở khóa nhân sự', USER_DELETED: 'Xóa nhân sự',
  ROLE_CREATED: 'Tạo vai trò', ROLE_UPDATED: 'Sửa vai trò', ROLE_LOCKED: 'Khóa vai trò', ROLE_UNLOCKED: 'Mở khóa vai trò', ROLE_DELETED: 'Xóa vai trò',
  PASSWORD_CHANGED: 'Đổi mật khẩu', BACKUP_CREATED: 'Tạo bản sao lưu', RESTORE_EXECUTED: 'Phục hồi dữ liệu', SETTING_UPDATED: 'Cập nhật cấu hình',
  CUSTOMER_CREATED: 'Tạo khách hàng', CUSTOMER_UPDATED: 'Sửa khách hàng', CUSTOMER_DELETED: 'Xóa khách hàng'
};
const actionLabel = (a: string): string => ACTION_LABEL[a] ?? a;

/** Nhãn tiếng Việt cho loại đối tượng bị tác động. */
const TARGET_LABEL: Record<string, string> = {
  User: 'Nhân sự', Role: 'Vai trò', Customer: 'Khách hàng', PosDevice: 'Máy POS', Tid: 'TID',
  Backup: 'Sao lưu', AppSetting: 'Cấu hình', Bank: 'Ngân hàng', CardType: 'Loại thẻ', Partner: 'Đối tác'
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
    else if (res.message) toast.error(res.message);
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
              <th className="px-4 py-3">Thời gian</th>
              <th className="px-4 py-3">Người thao tác</th>
              <th className="px-4 py-3">Hành động</th>
              <th className="px-4 py-3">Đối tượng</th>
              <th className="px-4 py-3 text-right">Chi tiết</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  <ScrollText className="mx-auto mb-2 h-6 w-6" /> Chưa có nhật ký.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-appbg/60">
                  <td className="px-4 py-3 text-xs text-slate-500">{new Date(r.createdAt).toLocaleString('vi-VN')}</td>
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
              {new Date(detail.createdAt).toLocaleString('vi-VN')} · {detail.actorUsername ?? '—'} · {detail.deviceInfo ?? ''}
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
