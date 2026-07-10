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
  RETIRED: 'Ngừng dùng'
};

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function getStats(): Promise<{ ok: boolean; data?: DashboardStats; error?: string; message?: string }> {
  const g = await requirePermission('DASHBOARD_VIEW', { action: 'DASHBOARD_VIEW' });
  if (!g.ok) return g;
  const db = g.db;
  const alive = { deletedAt: null } as const;

  const [tids, customers, posDevices, dossiers, users, banks, partners] = await Promise.all([
    db.tid.count({ where: alive }),
    db.customer.count({ where: alive }),
    db.posDevice.count(),
    db.dossier.count({ where: alive }),
    db.user.count({ where: { deletedAt: null, status: { not: 'DELETED' } } }),
    db.bank.count({ where: alive }),
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

  return { ok: true, data: { counts: { tids, customers, posDevices, dossiers, users, banks, partners }, tidsByBank, posByStatus, monthly } };
}
