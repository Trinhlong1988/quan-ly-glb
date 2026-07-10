import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  ScrollText,
  Settings,
  DatabaseBackup,
  LogOut,
  ChevronDown,
  UserRound,
  HardDrive,
  CreditCard,
  Landmark,
  PackagePlus,
  Percent,
  Wallet,
  FolderKanban,
  Trash2,
  Inbox,
  KeyRound,
  TrendingUp,
  BarChart3,
  Coins,
  Wrench,
  ClipboardCheck,
  Tags,
  Loader2
} from 'lucide-react';
import type { DashboardStats } from '../../../preload/index.d';
import type { AuthUser } from '@glb/shared';
import { hasPermission, hasAnyPermission } from '@glb/shared';
import { MessagesDrawer } from '../components/MessagesDrawer.js';
import { ChangePasswordModal } from '../components/ChangePasswordModal.js';
import { Level2PasswordModal } from '../components/Level2PasswordModal.js';
import { StaffManagementPage } from './StaffManagementPage.js';
import { AuditPage } from './AuditPage.js';
import { BackupPage } from './BackupPage.js';
import { SettingsPage } from './SettingsPage.js';
import { CustomersPage } from './CustomersPage.js';
import { PosPage } from './PosPage.js';
import { TidPage } from './TidPage.js';
import { TrashPage } from './TrashPage.js';
import { BankConfigPage } from './BankConfigPage.js';
import { PosSupplyPage } from './PosSupplyPage.js';
import { FeeConfigPage } from './FeeConfigPage.js';
import { ReceiveAccountPage } from './ReceiveAccountPage.js';
import { DossierPage } from './DossierPage.js';
import { TidConfigPage } from './TidConfigPage.js';
import { IndustryConfigPage } from './IndustryConfigPage.js';
import { CashCategoryConfigPage } from './CashCategoryConfigPage.js';
import { RevenuePage } from './RevenuePage.js';
import { DebtPage } from './DebtPage.js';
import { ApprovalPage } from './ApprovalPage.js';
import { MaintenancePage } from './MaintenancePage.js';
import { UpdateBanner } from '../components/UpdateBanner.js';

interface MenuItem {
  key: string;
  label: string;
  icon: JSX.Element;
  /** Permission(s) required to see the item; undefined = always visible. Any-of semantics. */
  perms?: string[];
  /** Show a live badge (e.g. undelivered TID count). */
  badge?: 'undeliveredTid';
  /** Visually a sub-item of the group above (indented). */
  indent?: boolean;
}

// Thứ tự menu theo IMS_SPEC (LEAD 9/7): Trang chủ → Nhân sự (Vai trò & Quyền là mục con) →
// Khách hàng → Máy POS → TID → Nhật ký → Cài đặt → Backup.
const MENU: MenuItem[] = [
  { key: 'dashboard', label: 'Trang chủ', icon: <LayoutDashboard className="h-[18px] w-[18px]" />, perms: ['DASHBOARD_VIEW'] },
  { key: 'staff', label: 'Quản Lý Nhân Sự', icon: <Users className="h-[18px] w-[18px]" />, perms: ['USER_READ', 'ROLE_READ'] },
  { key: 'customers', label: 'Quản Lý Khách Hàng', icon: <UserRound className="h-[18px] w-[18px]" />, perms: ['CUSTOMER_VIEW'] },
  { key: 'pos', label: 'Quản Lý Máy POS', icon: <HardDrive className="h-[18px] w-[18px]" />, perms: ['POS_VIEW'] },
  { key: 'bankcfg', label: 'Cấu hình ngân hàng', icon: <Landmark className="h-[18px] w-[18px]" />, perms: ['CONFIG_BANK_VIEW'] },
  { key: 'possupply', label: 'Cấu hình máy POS', icon: <PackagePlus className="h-[18px] w-[18px]" />, perms: ['CONFIG_POS_SUPPLY_VIEW'] },
  { key: 'revenue', label: 'Quản Lý Doanh Thu', icon: <TrendingUp className="h-[18px] w-[18px]" />, perms: ['REVENUE_VIEW'] },
  { key: 'debt', label: 'Quản Lý Công Nợ', icon: <Coins className="h-[18px] w-[18px]" />, perms: ['DEBT_VIEW'] },
  { key: 'feecfg', label: 'Cấu hình % phí POS', icon: <Percent className="h-[18px] w-[18px]" />, perms: ['CONFIG_FEE_VIEW'] },
  { key: 'rcvacct', label: 'Quản Lý Tài Khoản Nhận Tiền', icon: <Wallet className="h-[18px] w-[18px]" />, perms: ['CONFIG_RCV_ACCT_VIEW'] },
  { key: 'dossier', label: 'Quản Lý Hồ Sơ HKD', icon: <FolderKanban className="h-[18px] w-[18px]" />, perms: ['CONFIG_DOSSIER_VIEW'] },
  { key: 'tidcfg', label: 'Cấu hình TID', icon: <CreditCard className="h-[18px] w-[18px]" />, perms: ['CONFIG_TID_VIEW'] },
  { key: 'industrycfg', label: 'Cấu hình ngành nghề', icon: <Tags className="h-[18px] w-[18px]" />, perms: ['CONFIG_INDUSTRY_VIEW'] },
  { key: 'cashcatcfg', label: 'Cấu hình thu – chi', icon: <Wallet className="h-[18px] w-[18px]" />, perms: ['CASHCAT_VIEW'] },
  { key: 'tid', label: 'Quản Lý TID', icon: <CreditCard className="h-[18px] w-[18px]" />, perms: ['TID_VIEW'], badge: 'undeliveredTid' },
  { key: 'approval', label: 'Duyệt Hủy Bill', icon: <ClipboardCheck className="h-[18px] w-[18px]" />, perms: ['BILL_CANCEL_APPROVE'] },
  { key: 'audit', label: 'Nhật ký hệ thống', icon: <ScrollText className="h-[18px] w-[18px]" />, perms: ['AUDIT_LOG_VIEW'] },
  { key: 'trash', label: 'Thùng rác', icon: <Trash2 className="h-[18px] w-[18px]" />, perms: ['TRASH_VIEW'] },
  { key: 'settings', label: 'Cài đặt', icon: <Settings className="h-[18px] w-[18px]" />, perms: ['SYSTEM_SETTING_VIEW'] },
  { key: 'backup', label: 'Sao lưu & Phục hồi', icon: <DatabaseBackup className="h-[18px] w-[18px]" />, perms: ['BACKUP_CREATE', 'BACKUP_RESTORE'] },
  { key: 'maintenance', label: 'Bảo Trì Hệ Thống', icon: <Wrench className="h-[18px] w-[18px]" />, perms: ['STORAGE_VIEW'] }
];

export function Dashboard({ user, onLogout }: { user: AuthUser; onLogout: () => void }): JSX.Element {
  const visible = MENU.filter((m) => !m.perms || hasAnyPermission(user, m.perms));
  const [active, setActive] = useState(visible[0]?.key ?? 'dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [undeliveredCount, setUndeliveredCount] = useState(0);
  const [showInbox, setShowInbox] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [showLevel2, setShowLevel2] = useState(false);
  const [unread, setUnread] = useState(0);
  const [storageOver, setStorageOver] = useState<{ pct: number | null; threshold: number } | null>(null);
  const [storageDismissed, setStorageDismissed] = useState(false);
  const [appVersion, setAppVersion] = useState('');

  const canInbox = hasPermission(user, 'MESSAGE_VIEW');
  const canStorage = hasPermission(user, 'STORAGE_VIEW');
  const canSend = hasPermission(user, 'MESSAGE_SEND');
  const canLevel2 = hasPermission(user, 'LEVEL2_MANAGE');

  useEffect(() => {
    if (!hasPermission(user, 'TID_VIEW')) return;
    window.api.notifyUndeliveredSummary().then((r) => {
      if (r.ok && r.data) setUndeliveredCount(r.data.count);
    });
  }, [user, active]);

  // Hòm thư: bộ đếm chưa đọc realtime (Cách A — poll mỗi 10s; nâng WebSocket khi lên VPS).
  useEffect(() => {
    if (!canInbox) return;
    let alive = true;
    const tick = (): void => {
      window.api.messageUnreadCount().then((r) => {
        if (alive && r.ok && typeof r.data === 'number') setUnread(r.data);
      });
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [canInbox]);

  // Cảnh báo bộ nhớ vượt ngưỡng (Storage-Guard): poll mỗi 5 phút → bật dialog xác nhận dọn dẹp.
  useEffect(() => {
    if (!canStorage) return;
    let alive = true;
    const tick = (): void => {
      window.api.storageStatus().then((r) => {
        if (!alive || !r.ok || !r.data) return;
        setStorageOver(r.data.over ? { pct: r.data.diskUsedPct, threshold: r.data.thresholdPct } : null);
      });
    };
    tick();
    const id = setInterval(tick, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, [canStorage]);

  // G11: phiên bản hiện tại (hiển thị ở footer sidebar — chỗ "trực quan" user thấy đã lên bản mới).
  useEffect(() => {
    window.api.getAppVersion().then((v) => setAppVersion(v));
  }, []);

  const activeItem = visible.find((m) => m.key === active) ?? visible[0];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-appbg">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-text">
        <div className="flex h-14 items-center gap-2 px-5 text-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <span className="text-[15px] font-semibold tracking-wide">Quản Lý GLB</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3">
          {visible.map((m) => {
            const isActive = m.key === activeItem?.key;
            return (
              <button
                key={m.key}
                onClick={() => setActive(m.key)}
                className={
                  'group relative flex items-center gap-3 rounded-xl py-2 text-sm transition-all ' +
                  (m.indent ? 'pl-8 pr-2.5 ' : 'px-2.5 ') +
                  (isActive
                    ? 'bg-brand font-semibold text-white shadow-lg shadow-brand/30'
                    : 'font-medium text-sidebar-text hover:bg-white/5 hover:text-white')
                }
              >
                {/* Thanh nhấn bên trái khi đang chọn */}
                {isActive && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-white" />}
                {/* Ô icon nổi bật */}
                <span
                  className={
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all ' +
                    (isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-white/5 text-sidebar-text group-hover:bg-brand/30 group-hover:text-white')
                  }
                >
                  {m.icon}
                </span>
                <span className="flex-1 text-left tracking-wide">{m.label}</span>
                {m.badge === 'undeliveredTid' && undeliveredCount > 0 && (
                  <span className="rounded-full bg-danger px-1.5 text-xs font-semibold text-white shadow">{undeliveredCount}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="px-3 py-3">
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-text transition hover:bg-danger/20 hover:text-white"
          >
            <LogOut className="h-[18px] w-[18px]" />
            Đăng xuất
          </button>
          {/* G11: phiên bản hiện tại */}
          <div className="mt-2 px-3 text-center text-[11px] text-sidebar-text/60">
            {appVersion ? `Phiên bản v${appVersion}` : ''}
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-white px-6">
          <div className="text-sm text-slate-500">
            <span className="text-slate-400">GLB</span>
            <span className="mx-2 text-slate-300">/</span>
            <span className="font-medium text-slate-700">{activeItem?.label}</span>
          </div>
          <div className="flex items-center gap-2">
            {canInbox && (
              <button
                onClick={() => setShowInbox(true)}
                title="Hòm thư nội bộ"
                className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-appbg hover:text-brand"
              >
                <Inbox className="h-[19px] w-[19px]" />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white shadow">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            )}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-appbg"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-tint text-sm font-semibold text-brand">
                {user.fullName.charAt(0).toUpperCase()}
              </div>
              <div className="text-left leading-tight">
                <div className="text-sm font-medium text-slate-700">{user.fullName}</div>
                <div className="text-xs text-slate-400">{user.roles.join(', ') || '—'}</div>
              </div>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-1 w-48 rounded-lg border border-line bg-white py-1 shadow-lg">
                <div className="px-3 py-2 text-xs text-slate-400">@{user.username}</div>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setShowChangePw(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-appbg"
                >
                  <KeyRound className="h-4 w-4 text-slate-400" /> Đổi mật khẩu
                </button>
                {canLevel2 && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setShowLevel2(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-appbg"
                  >
                    <ShieldCheck className="h-4 w-4 text-slate-400" /> Mật khẩu cấp 2
                  </button>
                )}
                <div className="my-1 border-t border-line" />
                <button
                  onClick={onLogout}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-appbg"
                >
                  <LogOut className="h-4 w-4" /> Đăng xuất
                </button>
              </div>
            )}
          </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          {activeItem?.key === 'dashboard' && <Home user={user} visibleCount={visible.length} />}
          {activeItem?.key === 'customers' && <CustomersPage user={user} />}
          {activeItem?.key === 'pos' && <PosPage user={user} />}
          {activeItem?.key === 'tid' && <TidPage user={user} />}
          {activeItem?.key === 'staff' && <StaffManagementPage user={user} />}
          {activeItem?.key === 'audit' && <AuditPage />}
          {activeItem?.key === 'bankcfg' && <BankConfigPage user={user} />}
          {activeItem?.key === 'possupply' && <PosSupplyPage user={user} />}
          {activeItem?.key === 'feecfg' && <FeeConfigPage user={user} />}
          {activeItem?.key === 'rcvacct' && <ReceiveAccountPage user={user} />}
          {activeItem?.key === 'dossier' && <DossierPage user={user} />}
          {activeItem?.key === 'tidcfg' && <TidConfigPage user={user} />}
          {activeItem?.key === 'industrycfg' && <IndustryConfigPage user={user} />}
          {activeItem?.key === 'cashcatcfg' && <CashCategoryConfigPage user={user} />}
          {activeItem?.key === 'revenue' && <RevenuePage user={user} />}
          {activeItem?.key === 'debt' && <DebtPage user={user} />}
          {activeItem?.key === 'approval' && <ApprovalPage user={user} />}
          {activeItem?.key === 'trash' && <TrashPage user={user} />}
          {activeItem?.key === 'settings' && <SettingsPage user={user} />}
          {activeItem?.key === 'backup' && <BackupPage user={user} />}
          {activeItem?.key === 'maintenance' && <MaintenancePage user={user} />}
        </main>
      </div>

      {showInbox && canInbox && (
        <MessagesDrawer
          canSend={canSend}
          onClose={() => setShowInbox(false)}
          onChanged={() => {
            window.api.messageUnreadCount().then((r) => {
              if (r.ok && typeof r.data === 'number') setUnread(r.data);
            });
          }}
        />
      )}
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
      {showLevel2 && <Level2PasswordModal onClose={() => setShowLevel2(false)} />}

      {/* G11: banner cập nhật tích hợp (có bản mới / tải % / thành công / lỗi) */}
      <UpdateBanner />

      {/* Dialog cảnh báo bộ nhớ vượt ngưỡng — yêu cầu dọn dẹp (Storage-Guard) */}
      {storageOver && !storageDismissed && canStorage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10"><HardDrive className="h-6 w-6 text-danger" /></div>
              <div>
                <h3 className="text-base font-semibold text-slate-800">Bộ nhớ sắp đầy</h3>
                <p className="text-xs text-slate-500">Đã dùng {storageOver.pct ?? '—'}% ≥ ngưỡng {storageOver.threshold}%</p>
              </div>
            </div>
            <p className="mb-5 text-sm text-slate-600">Để đảm bảo dữ liệu luôn được lưu và cập nhật, hãy dọn dẹp lịch sử và thùng rác cũ. Hệ thống sẽ tự tạo bản sao lưu an toàn trước khi xóa.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setStorageDismissed(true)} className="rounded-md border border-line px-4 py-2 text-sm text-slate-600 hover:bg-appbg">Để sau</button>
              <button onClick={() => { setActive('maintenance'); setStorageDismissed(true); }} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">Đi tới Bảo trì</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Định dạng số nguyên với dấu chấm phân cách hàng nghìn (chuẩn VN) — không dùng toLocaleString. */
function fmtNum(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function Home({ user }: { user: AuthUser; visibleCount: number }): JSX.Element {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const tick = (): void => {
      window.api.dashboardStats().then((r) => {
        if (alive && r.ok && r.data) setStats(r.data);
        if (alive) setLoading(false);
      });
    };
    tick();
    const id = setInterval(tick, 15000); // realtime nhẹ — poll 15s
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const c = stats?.counts;
  const kpis: { label: string; value: number; icon: JSX.Element; tint: string }[] = [
    { label: 'Tổng TID', value: c?.tids ?? 0, icon: <CreditCard className="h-5 w-5" />, tint: 'bg-brand/10 text-brand' },
    { label: 'Khách hàng', value: c?.customers ?? 0, icon: <UserRound className="h-5 w-5" />, tint: 'bg-emerald-500/10 text-emerald-600' },
    { label: 'Máy POS', value: c?.posDevices ?? 0, icon: <HardDrive className="h-5 w-5" />, tint: 'bg-amber-500/10 text-amber-600' },
    { label: 'Hồ sơ HKD', value: c?.dossiers ?? 0, icon: <FolderKanban className="h-5 w-5" />, tint: 'bg-violet-500/10 text-violet-600' },
    { label: 'Nhân sự', value: c?.users ?? 0, icon: <Users className="h-5 w-5" />, tint: 'bg-sky-500/10 text-sky-600' },
    { label: 'Ngân hàng', value: c?.banks ?? 0, icon: <Landmark className="h-5 w-5" />, tint: 'bg-rose-500/10 text-rose-600' }
  ];

  return (
    <div className="space-y-6">
      {/* Lời chào */}
      <div className="rounded-2xl border border-line bg-gradient-to-r from-brand to-brand-hover p-6 text-white shadow-sm">
        <h2 className="text-2xl font-bold">Xin chào {user.fullName} 👋</h2>
        <p className="mt-1 text-sm text-white/85">
          Tổng quan hệ thống Quản Lý GLB — vai trò{' '}
          <span className="font-semibold">{user.roles.join(', ') || 'chưa gán'}</span>. Dữ liệu cập nhật thời gian thực.
        </p>
      </div>

      {/* KPI realtime */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-line bg-white p-4 shadow-sm transition hover:shadow-md">
            <div className={'mb-3 flex h-10 w-10 items-center justify-center rounded-lg ' + k.tint}>{k.icon}</div>
            <div className="text-2xl font-bold tabular-nums text-slate-800">
              {loading ? <span className="text-slate-300">—</span> : fmtNum(k.value)}
            </div>
            <div className="mt-0.5 text-xs font-medium text-slate-500">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Biểu đồ tăng trưởng */}
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-brand" />
            <h3 className="text-base font-semibold text-slate-800">Tăng trưởng 12 tháng</h3>
            <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-brand" /> TID</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Khách hàng</span>
            </span>
          </div>
          <GrowthChart data={stats?.monthly ?? []} loading={loading} />
        </div>

        {/* Bộ đếm tách chiều */}
        <div className="space-y-6">
          <BreakdownCard title="TID theo ngân hàng" icon={<CreditCard className="h-4 w-4" />} rows={stats?.tidsByBank ?? []} loading={loading} unit="TID" />
          <BreakdownCard title="Máy POS theo trạng thái" icon={<BarChart3 className="h-4 w-4" />} rows={stats?.posByStatus ?? []} loading={loading} unit="máy" />
        </div>
      </div>
    </div>
  );
}

/** Biểu đồ cột nhóm (TID / Khách hàng) 12 tháng — SVG nội tuyến, empty-state khi chưa có dữ liệu. */
function GrowthChart({ data, loading }: { data: DashboardStats['monthly']; loading: boolean }): JSX.Element {
  if (loading) return <div className="flex h-56 items-center justify-center text-slate-300"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const max = Math.max(1, ...data.map((d) => Math.max(d.tids, d.customers)));
  const hasData = data.some((d) => d.tids > 0 || d.customers > 0);
  const H = 180;
  const barW = 8;
  const gap = 6;
  const groupW = barW * 2 + gap;
  const slot = 100 / Math.max(1, data.length);

  return (
    <div className="relative">
      <div className="flex h-56 items-end gap-0" style={{ minHeight: H }}>
        {data.map((d) => {
          const h1 = (d.tids / max) * H;
          const h2 = (d.customers / max) * H;
          const mm = d.month.slice(5);
          return (
            <div key={d.month} className="flex flex-1 flex-col items-center justify-end gap-1" title={`Tháng ${mm}: ${d.tids} TID · ${d.customers} khách`}>
              <div className="flex items-end gap-[3px]" style={{ height: H }}>
                <div className="w-2.5 rounded-t bg-brand transition-all" style={{ height: Math.max(2, h1) }} />
                <div className="w-2.5 rounded-t bg-emerald-500 transition-all" style={{ height: Math.max(2, h2) }} />
              </div>
              <span className="text-[10px] text-slate-400">{mm}</span>
            </div>
          );
        })}
      </div>
      {!hasData && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-400">
          <TrendingUp className="h-8 w-8" />
          <p className="text-sm">Chưa có dữ liệu tăng trưởng để hiển thị.</p>
        </div>
      )}
    </div>
  );
}

/** Bộ đếm tách theo chiều (vd Tổng TID VPBank…) — empty-state riêng. */
function BreakdownCard({
  title,
  icon,
  rows,
  loading,
  unit
}: {
  title: string;
  icon: JSX.Element;
  rows: { label: string; count: number }[];
  loading: boolean;
  unit: string;
}): JSX.Element {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-slate-700">
        <span className="text-brand">{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {loading ? (
        <div className="flex h-20 items-center justify-center text-slate-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Chưa có dữ liệu.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.slice(0, 6).map((r) => (
            <div key={r.label}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium text-slate-600">{r.label}</span>
                <span className="tabular-nums font-semibold text-slate-800">{fmtNum(r.count)} {unit}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-appbg">
                <div className="h-full rounded-full bg-brand" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
