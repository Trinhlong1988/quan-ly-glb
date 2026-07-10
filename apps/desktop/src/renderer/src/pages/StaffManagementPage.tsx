import { useState } from 'react';
import { Users, ShieldCheck } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission } from '@glb/shared';
import { StaffPage } from './StaffPage.js';
import { RolesPage } from './RolesPage.js';

/**
 * Quản lý Nhân sự — gộp 2 tab con (LEAD 9/7):
 *  • Nhân sự (danh sách nhân sự)
 *  • Vai trò & Quyền (trước đây là menu riêng, nay là tab con).
 * Tab hiển thị theo quyền: USER_READ → tab Nhân sự; ROLE_READ → tab Vai trò & Quyền.
 */
export function StaffManagementPage({ user }: { user: AuthUser }): JSX.Element {
  const canStaff = hasPermission(user, 'USER_READ');
  const canRoles = hasPermission(user, 'ROLE_READ');
  const [tab, setTab] = useState<'staff' | 'roles'>(canStaff ? 'staff' : 'roles');

  const tabCls = (active: boolean): string =>
    'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition ' +
    (active ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700');

  return (
    <div>
      <div className="mb-1">
        <h2 className="text-lg font-semibold text-slate-800">Quản Lý Nhân Sự</h2>
        <p className="text-sm text-slate-500">Nhân sự và phân quyền vai trò trong cùng một khu vực quản lý.</p>
      </div>
      <div className="mb-5 flex gap-1 border-b border-line">
        {canStaff && (
          <button onClick={() => setTab('staff')} className={tabCls(tab === 'staff')}>
            <Users className="h-4 w-4" /> Danh sách nhân sự
          </button>
        )}
        {canRoles && (
          <button onClick={() => setTab('roles')} className={tabCls(tab === 'roles')}>
            <ShieldCheck className="h-4 w-4" /> Vai trò và Quyền
          </button>
        )}
      </div>

      {tab === 'staff' && canStaff && <StaffPage user={user} />}
      {tab === 'roles' && canRoles && <RolesPage user={user} />}
    </div>
  );
}
