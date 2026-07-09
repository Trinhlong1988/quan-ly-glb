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
  Trash2
} from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, hasAnyPermission } from '@glb/shared';
import { RolesPage } from './RolesPage.js';
import { StaffPage } from './StaffPage.js';
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
  { key: 'staff', label: 'Quản lý Nhân sự', icon: <Users className="h-[18px] w-[18px]" />, perms: ['USER_READ'] },
  { key: 'roles', label: 'Vai trò & Quyền', icon: <ShieldCheck className="h-[18px] w-[18px]" />, perms: ['ROLE_READ'], indent: true },
  { key: 'customers', label: 'Khách hàng', icon: <UserRound className="h-[18px] w-[18px]" />, perms: ['CUSTOMER_VIEW'] },
  { key: 'pos', label: 'Máy POS', icon: <HardDrive className="h-[18px] w-[18px]" />, perms: ['POS_VIEW'] },
  { key: 'tid', label: 'TID', icon: <CreditCard className="h-[18px] w-[18px]" />, perms: ['TID_VIEW'], badge: 'undeliveredTid' },
  { key: 'bankcfg', label: 'Cấu hình ngân hàng', icon: <Landmark className="h-[18px] w-[18px]" />, perms: ['CONFIG_BANK_VIEW'] },
  { key: 'possupply', label: 'Cấu hình máy POS', icon: <PackagePlus className="h-[18px] w-[18px]" />, perms: ['CONFIG_POS_SUPPLY_VIEW'] },
  { key: 'feecfg', label: 'Cấu hình phí', icon: <Percent className="h-[18px] w-[18px]" />, perms: ['CONFIG_FEE_VIEW'] },
  { key: 'rcvacct', label: 'Tài khoản nhận tiền', icon: <Wallet className="h-[18px] w-[18px]" />, perms: ['CONFIG_RCV_ACCT_VIEW'] },
  { key: 'dossier', label: 'Hồ sơ HKD', icon: <FolderKanban className="h-[18px] w-[18px]" />, perms: ['CONFIG_DOSSIER_VIEW'] },
  { key: 'tidcfg', label: 'Cấu hình TID', icon: <CreditCard className="h-[18px] w-[18px]" />, perms: ['CONFIG_TID_VIEW'] },
  { key: 'audit', label: 'Nhật ký hệ thống', icon: <ScrollText className="h-[18px] w-[18px]" />, perms: ['AUDIT_LOG_VIEW'] },
  { key: 'trash', label: 'Thùng rác', icon: <Trash2 className="h-[18px] w-[18px]" />, perms: ['TRASH_VIEW'] },
  { key: 'settings', label: 'Cài đặt', icon: <Settings className="h-[18px] w-[18px]" />, perms: ['SYSTEM_SETTING_VIEW'] },
  { key: 'backup', label: 'Sao lưu & Phục hồi', icon: <DatabaseBackup className="h-[18px] w-[18px]" />, perms: ['BACKUP_CREATE', 'BACKUP_RESTORE'] }
];

export function Dashboard({ user, onLogout }: { user: AuthUser; onLogout: () => void }): JSX.Element {
  const visible = MENU.filter((m) => !m.perms || hasAnyPermission(user, m.perms));
  const [active, setActive] = useState(visible[0]?.key ?? 'dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [undeliveredCount, setUndeliveredCount] = useState(0);

  useEffect(() => {
    if (!hasPermission(user, 'TID_VIEW')) return;
    window.api.notifyUndeliveredSummary().then((r) => {
      if (r.ok && r.data) setUndeliveredCount(r.data.count);
    });
  }, [user, active]);

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
        <nav className="flex flex-1 flex-col gap-1 px-3 py-3">
          {visible.map((m) => (
            <button
              key={m.key}
              onClick={() => setActive(m.key)}
              className={
                'flex items-center gap-3 rounded-lg py-2.5 text-sm transition ' +
                (m.indent ? 'pl-9 pr-3 ' : 'px-3 ') +
                (m.key === activeItem?.key
                  ? 'bg-brand font-medium text-white shadow'
                  : 'text-sidebar-text hover:bg-white/5 hover:text-white')
              }
            >
              {m.icon}
              <span className="flex-1 text-left">{m.label}</span>
              {m.badge === 'undeliveredTid' && undeliveredCount > 0 && (
                <span className="rounded-full bg-danger px-1.5 text-xs font-semibold text-white">{undeliveredCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="px-3 py-3">
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-text transition hover:bg-danger/20 hover:text-white"
          >
            <LogOut className="h-[18px] w-[18px]" />
            Đăng xuất
          </button>
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
              <div className="absolute right-0 mt-1 w-44 rounded-lg border border-line bg-white py-1 shadow-lg">
                <div className="px-3 py-2 text-xs text-slate-400">@{user.username}</div>
                <button
                  onClick={onLogout}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-appbg"
                >
                  <LogOut className="h-4 w-4" /> Đăng xuất
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          {activeItem?.key === 'dashboard' && <Home user={user} visibleCount={visible.length} />}
          {activeItem?.key === 'customers' && <CustomersPage user={user} />}
          {activeItem?.key === 'pos' && <PosPage user={user} />}
          {activeItem?.key === 'tid' && <TidPage user={user} />}
          {activeItem?.key === 'staff' && <StaffPage user={user} />}
          {activeItem?.key === 'roles' && <RolesPage user={user} />}
          {activeItem?.key === 'audit' && <AuditPage />}
          {activeItem?.key === 'bankcfg' && <BankConfigPage user={user} />}
          {activeItem?.key === 'possupply' && <PosSupplyPage user={user} />}
          {activeItem?.key === 'feecfg' && <FeeConfigPage user={user} />}
          {activeItem?.key === 'rcvacct' && <ReceiveAccountPage user={user} />}
          {activeItem?.key === 'dossier' && <DossierPage user={user} />}
          {activeItem?.key === 'tidcfg' && <TidConfigPage user={user} />}
          {activeItem?.key === 'trash' && <TrashPage user={user} />}
          {activeItem?.key === 'settings' && <SettingsPage user={user} />}
          {activeItem?.key === 'backup' && <BackupPage user={user} />}
        </main>
      </div>
    </div>
  );
}

function Home({ user, visibleCount }: { user: AuthUser; visibleCount: number }): JSX.Element {
  return (
    <div className="rounded-xl border border-line bg-white p-8 shadow-sm">
      <h2 className="text-2xl font-bold text-slate-800">Xin chào {user.fullName} 👋</h2>
      <p className="mt-2 text-sm text-slate-500">
        Bạn đã đăng nhập vào hệ thống Quản Lý GLB với vai trò{' '}
        <span className="font-medium text-brand">{user.roles.join(', ') || 'chưa gán'}</span>.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Vai trò" value={String(user.roles.length)} />
        <StatCard label="Quyền hiệu lực" value={String(user.permissions.length)} />
        <StatCard label="Menu hiển thị" value={String(visibleCount)} />
      </div>

      <p className="mt-8 rounded-lg bg-brand-tint px-4 py-3 text-sm text-brand">
        Giai đoạn G1 — Phase B: Quản lý Vai trò · Nhân sự · Phân quyền · Nhật ký · Backup/Restore. Menu bên trái ẩn
        theo quyền của bạn ({hasPermission(user, 'USER_READ') ? 'có' : 'không'} quyền quản lý nhân sự).
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-appbg px-4 py-3">
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
