// Quản lý tài chính (R22, Mr.Long 11/7): gộp Phiếu thu · Phiếu chi · Quỹ · Báo cáo thu–chi · Cấu hình thu–chi
// vào 1 menu, chia tab (TabBar dùng chung). Mỗi tab render đúng trang cũ — không đổi nghiệp vụ, chỉ gom điều hướng.
import { useState } from 'react';
import { Receipt, PiggyBank, BarChart3, Wallet } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission } from '@glb/shared';
import { TabBar, TabButton } from '../components/Tabs.js';
import { CashEntryPage } from './CashEntryPage.js';
import { FundPage } from './FundPage.js';
import { CashflowReportPage } from './CashflowReportPage.js';
import { CashCategoryConfigPage } from './CashCategoryConfigPage.js';

type Tab = 'thu' | 'chi' | 'fund' | 'report' | 'cfg';

export function FinancePage({ user }: { user: AuthUser }): JSX.Element {
  const canEntry = hasPermission(user, 'CASHENTRY_VIEW');
  const canFund = hasPermission(user, 'FUND_VIEW');
  const canCat = hasPermission(user, 'CASHCAT_VIEW');
  // R35 (Mr.Long 11/7) thứ tự tab: Báo cáo thu–chi → Quỹ → Phiếu thu → Phiếu chi → Cấu hình (cuối).
  const [tab, setTab] = useState<Tab>(canEntry ? 'report' : canFund ? 'fund' : 'cfg');
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Quản lý tài chính</h2>
        <p className="text-sm text-slate-500">Phiếu thu · Phiếu chi · Quỹ · Báo cáo thu–chi · Cấu hình thu–chi.</p>
      </div>
      <TabBar>
        {canEntry && <TabButton active={tab === 'report'} onClick={() => setTab('report')} icon={<BarChart3 className="h-4 w-4" />}>Báo cáo thu–chi</TabButton>}
        {canFund && <TabButton active={tab === 'fund'} onClick={() => setTab('fund')} icon={<PiggyBank className="h-4 w-4" />}>Quỹ</TabButton>}
        {canEntry && <TabButton active={tab === 'thu'} onClick={() => setTab('thu')} icon={<Receipt className="h-4 w-4" />}>Phiếu thu</TabButton>}
        {canEntry && <TabButton active={tab === 'chi'} onClick={() => setTab('chi')} icon={<Receipt className="h-4 w-4" />}>Phiếu chi</TabButton>}
        {canCat && <TabButton active={tab === 'cfg'} onClick={() => setTab('cfg')} icon={<Wallet className="h-4 w-4" />}>Cấu hình thu–chi</TabButton>}
      </TabBar>
      {tab === 'thu' && canEntry && <CashEntryPage user={user} kind="THU" />}
      {tab === 'chi' && canEntry && <CashEntryPage user={user} kind="CHI" />}
      {tab === 'fund' && canFund && <FundPage user={user} />}
      {tab === 'report' && canEntry && <CashflowReportPage user={user} />}
      {tab === 'cfg' && canCat && <CashCategoryConfigPage user={user} />}
    </div>
  );
}
