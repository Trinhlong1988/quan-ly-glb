// Quản lý doanh thu & công nợ (R25, Mr.Long 11/7): gộp Quản lý Doanh thu + Quản lý Công nợ vào 1 menu, 2 tab.
import { useState } from 'react';
import { TrendingUp, Coins, Banknote } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission } from '@glb/shared';
import { TabBar, TabButton } from '../components/Tabs.js';
import { RevenuePage } from './RevenuePage.js';
import { DebtPage } from './DebtPage.js';
import { DeviceReceivablePage } from './DeviceReceivablePage.js';

export function RevenueDebtPage({ user }: { user: AuthUser }): JSX.Element {
  const canRev = hasPermission(user, 'REVENUE_VIEW');
  const canDebt = hasPermission(user, 'DEBT_VIEW');
  const canDevRcv = hasPermission(user, 'DEVICE_SALE_VIEW'); // Công nợ mua thiết bị (nhóm quyền tiền riêng)
  const [tab, setTab] = useState<'revenue' | 'debt' | 'devrcv'>(canRev ? 'revenue' : canDebt ? 'debt' : 'devrcv');
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Quản Lý Doanh Thu &amp; Công Nợ</h2>
        <p className="text-sm text-slate-500">Doanh thu · Công nợ.</p>
      </div>
      <TabBar>
        {canRev && <TabButton active={tab === 'revenue'} onClick={() => setTab('revenue')} icon={<TrendingUp className="h-4 w-4" />}>Doanh thu</TabButton>}
        {canDebt && <TabButton active={tab === 'debt'} onClick={() => setTab('debt')} icon={<Coins className="h-4 w-4" />}>Công nợ</TabButton>}
        {canDevRcv && <TabButton active={tab === 'devrcv'} onClick={() => setTab('devrcv')} icon={<Banknote className="h-4 w-4" />}>Công nợ mua thiết bị</TabButton>}
      </TabBar>
      {tab === 'revenue' && canRev && <RevenuePage user={user} />}
      {tab === 'debt' && canDebt && <DebtPage user={user} />}
      {tab === 'devrcv' && canDevRcv && <DeviceReceivablePage user={user} />}
    </div>
  );
}
