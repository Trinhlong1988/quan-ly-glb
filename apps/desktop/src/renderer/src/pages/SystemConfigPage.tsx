// Quản lý cấu hình hệ thống (R23, Mr.Long 11/7): gộp Nhật ký hệ thống · Cài đặt · Sao lưu & Phục hồi ·
// Bảo trì hệ thống · Thùng rác (đặt CUỐI) vào 1 menu, chia tab (TabBar dùng chung). Không đổi nghiệp vụ.
import { useState } from 'react';
import { ScrollText, Settings, DatabaseBackup, Wrench, Trash2 } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission } from '@glb/shared';
import { TabBar, TabButton } from '../components/Tabs.js';
import { AuditPage } from './AuditPage.js';
import { SettingsPage } from './SettingsPage.js';
import { BackupPage } from './BackupPage.js';
import { MaintenancePage } from './MaintenancePage.js';
import { TrashPage } from './TrashPage.js';

type Tab = 'audit' | 'settings' | 'backup' | 'maintenance' | 'trash';

export function SystemConfigPage({ user }: { user: AuthUser }): JSX.Element {
  const canAudit = hasPermission(user, 'AUDIT_LOG_VIEW');
  const canSetting = hasPermission(user, 'SYSTEM_SETTING_VIEW');
  const canBackup = hasPermission(user, 'BACKUP_CREATE') || hasPermission(user, 'BACKUP_RESTORE');
  const canMaint = hasPermission(user, 'STORAGE_VIEW');
  const canTrash = hasPermission(user, 'TRASH_VIEW');
  const first: Tab = canAudit ? 'audit' : canSetting ? 'settings' : canBackup ? 'backup' : canMaint ? 'maintenance' : 'trash';
  const [tab, setTab] = useState<Tab>(first);
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Quản lý cấu hình hệ thống</h2>
        <p className="text-sm text-slate-500">Nhật ký hệ thống · Cài đặt · Sao lưu &amp; Phục hồi · Bảo trì hệ thống · Thùng rác.</p>
      </div>
      <TabBar>
        {canAudit && <TabButton active={tab === 'audit'} onClick={() => setTab('audit')} icon={<ScrollText className="h-4 w-4" />}>Nhật ký hệ thống</TabButton>}
        {canSetting && <TabButton active={tab === 'settings'} onClick={() => setTab('settings')} icon={<Settings className="h-4 w-4" />}>Cài đặt</TabButton>}
        {canBackup && <TabButton active={tab === 'backup'} onClick={() => setTab('backup')} icon={<DatabaseBackup className="h-4 w-4" />}>Sao lưu &amp; Phục hồi</TabButton>}
        {canMaint && <TabButton active={tab === 'maintenance'} onClick={() => setTab('maintenance')} icon={<Wrench className="h-4 w-4" />}>Bảo trì hệ thống</TabButton>}
        {canTrash && <TabButton active={tab === 'trash'} onClick={() => setTab('trash')} icon={<Trash2 className="h-4 w-4" />}>Thùng rác</TabButton>}
      </TabBar>
      {tab === 'audit' && canAudit && <AuditPage />}
      {tab === 'settings' && canSetting && <SettingsPage user={user} />}
      {tab === 'backup' && canBackup && <BackupPage user={user} />}
      {tab === 'maintenance' && canMaint && <MaintenancePage user={user} />}
      {tab === 'trash' && canTrash && <TrashPage user={user} />}
    </div>
  );
}
