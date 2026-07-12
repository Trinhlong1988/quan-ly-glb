// Dashboard — thống kê realtime cho trang chủ (Nhóm B #6, LEAD 9/7).
// Trả KPI tổng + bộ đếm tách theo chiều (TID theo ngân hàng) + chuỗi tăng trưởng 12 tháng.
// Luôn trả dữ liệu (kể cả 0) để UI hiển thị khung + empty-state — "chưa có dữ liệu vẫn show".
import { requirePermission } from './guard.js';

export interface DashboardStats {
  counts: {
    tids: number;
    customers: number;
    posDevices: number;
    dossiers: number;
    users: number;
    banks: number;
    banksActive: number;
    banksInactive: number;
    partners: number;
  };
  tidsByBank: { label: string; count: number }[];
  posByStatus: { label: string; count: number }[];
  monthly: { month: string; tids: number; customers: number }[]; // 12 tháng gần nhất
}

const POS_STATUS_LABEL: Record<string, string> = {
  IN_STOCK: 'Trong kho',
  DEPLOYED: 'Đã triển khai',
  IN_REPAIR: 'Đang sửa',
  DAMAGED: 'Hư hỏng',
  RETIRED: 'Ngừng dùng',
  SOLD: 'Đã bán'
};

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function getStats(): Promise<{ ok: boolean; data?: DashboardStats; error?: string; message?: string }> {
  const g = await requirePermission('DASHBOARD_VIEW', { action: 'DASHBOARD_VIEW' });
  if (!g.ok) return g;
  const db = g.db;
  const alive = { deletedAt: null } as const;

  const [tids, customers, posDevices, dossiers, users, banks, banksActive, banksInactive, partners] = await Promise.all([
    db.tid.count({ where: alive }),
    db.customer.count({ where: alive }),
    db.posDevice.count(),
    db.dossier.count({ where: alive }),
    db.user.count({ where: { deletedAt: null, status: { not: 'DELETED' } } }),
    db.bank.count({ where: alive }),
    db.bank.count({ where: { ...alive, status: 'ACTIVE' } }),
    db.bank.count({ where: { ...alive, status: 'INACTIVE' } }),
    db.partner.count({ where: alive })
  ]);

  // TID theo ngân hàng (bộ đếm tách chiều — "Tổng TID VPBank...").
  const tidRows = await db.tid.findMany({ where: { ...alive, bankId: { not: null } }, select: { bankId: true } });
  const bankIds = [...new Set(tidRows.map((t) => t.bankId).filter((x): x is number => x !== null))];
  const bankList = bankIds.length ? await db.bank.findMany({ where: { id: { in: bankIds } }, select: { id: true, code: true, name: true } }) : [];
  const bankById = new Map(bankList.map((b) => [b.id, b.code || b.name]));
  const bankTally = new Map<string, number>();
  for (const t of tidRows) {
    const label = bankById.get(t.bankId!) ?? 'Khác';
    bankTally.set(label, (bankTally.get(label) ?? 0) + 1);
  }
  const tidsByBank = [...bankTally.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);

  // Máy POS theo trạng thái.
  const posRows = await db.posDevice.findMany({ select: { status: true } });
  const posTally = new Map<string, number>();
  for (const p of posRows) posTally.set(p.status, (posTally.get(p.status) ?? 0) + 1);
  const posByStatus = [...posTally.entries()].map(([s, count]) => ({ label: POS_STATUS_LABEL[s] ?? s, count })).sort((a, b) => b.count - a.count);

  // Tăng trưởng 12 tháng gần nhất (số TID & khách hàng tạo mới theo tháng).
  const [tidDates, custDates] = await Promise.all([
    db.tid.findMany({ where: alive, select: { createdAt: true } }),
    db.customer.findMany({ where: alive, select: { createdAt: true } })
  ]);
  const now = new Date();
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  const tidM = new Map<string, number>();
  const custM = new Map<string, number>();
  for (const t of tidDates) tidM.set(monthKey(t.createdAt), (tidM.get(monthKey(t.createdAt)) ?? 0) + 1);
  for (const c of custDates) custM.set(monthKey(c.createdAt), (custM.get(monthKey(c.createdAt)) ?? 0) + 1);
  const monthly = months.map((m) => ({ month: m, tids: tidM.get(m) ?? 0, customers: custM.get(m) ?? 0 }));

  return { ok: true, data: { counts: { tids, customers, posDevices, dossiers, users, banks, banksActive, banksInactive, partners }, tidsByBank, posByStatus, monthly } };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE H2-core — Lợi nhuận Dashboard (ACCRUAL, §0 Q-A / §5). CHỐNG double-count (I#13):
//   profit(tháng) = Σ Transaction.revenueAmount (POSTED, theo txnDate trong tháng)          ← accrual chênh phí quẹt thẻ
//                 + Σ CashEntry POSTED THU affectsPnl=true (theo entryDate trong tháng)      ← doanh thu bán trực tiếp
//                 − Σ CashEntry POSTED CHI affectsPnl=true (theo entryDate trong tháng)      ← chi phí thật
// KHÔNG cộng CashEntry category DEBT_*/DEPOSIT/ADVANCE/FUND_TRANSFER (affectsPnl=false) —
// thu công nợ đã nằm trong Transaction.revenueAmount (đếm lại = double-count). Ngày local (I#10).
// ─────────────────────────────────────────────────────────────────────────────
export interface MonthProfit {
  month: string; // YYYY-MM
  revenueAccrual: number;
  expense: number;
  profit: number;
}
export interface ProfitStats {
  current: MonthProfit;
  previous: MonthProfit;
}

/** Lợi nhuận accrual của khoảng [start, nextStart) (local). affectsIds = danh mục affectsPnl=true. */
async function computeMonthProfit(db: import('@glb/database').Db, month: string, start: Date, nextStart: Date, affectsIds: number[]): Promise<MonthProfit> {
  const [txAgg, thuAgg, chiAgg] = await Promise.all([
    db.transaction.aggregate({ _sum: { revenueAmount: true }, where: { status: 'POSTED', deletedAt: null, txnDate: { gte: start, lt: nextStart } } }),
    db.cashEntry.aggregate({ _sum: { amount: true }, where: { status: 'POSTED', deletedAt: null, kind: 'THU', categoryId: { in: affectsIds }, entryDate: { gte: start, lt: nextStart } } }),
    db.cashEntry.aggregate({ _sum: { amount: true }, where: { status: 'POSTED', deletedAt: null, kind: 'CHI', categoryId: { in: affectsIds }, entryDate: { gte: start, lt: nextStart } } })
  ]);
  const revenueAccrual = Number(txAgg._sum.revenueAmount ?? 0) + Number(thuAgg._sum.amount ?? 0);
  const expense = Number(chiAgg._sum.amount ?? 0);
  return { month, revenueAccrual, expense, profit: revenueAccrual - expense };
}

/** CASHENTRY_VIEW — lợi nhuận accrual tháng hiện tại + tháng trước (Dashboard KpiCard, §5). */
export async function getMonthlyProfit(): Promise<{ ok: boolean; data?: ProfitStats; error?: string; message?: string }> {
  const g = await requirePermission('CASHENTRY_VIEW', { action: 'CASHENTRY_VIEW' });
  if (!g.ok) return g;
  const db = g.db;
  const affects = await db.cashCategory.findMany({ where: { affectsPnl: true, deletedAt: null }, select: { id: true } });
  const affectsIds = affects.map((c) => c.id);

  const now = new Date();
  const curStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const key = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  const [current, previous] = await Promise.all([
    computeMonthProfit(db, key(curStart), curStart, nextStart, affectsIds),
    computeMonthProfit(db, key(prevStart), prevStart, curStart, affectsIds)
  ]);
  return { ok: true, data: { current, previous } };
}
