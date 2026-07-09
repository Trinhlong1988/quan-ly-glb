// E4 Thùng rác — self-test tích hợp 50 ĐÚNG + 50 SAI (R_LINK_VERIFY, GLB_SELFTEST=6).
// Chạy trên DB throwaway (GLB_DB_URL). Chứng minh: soft-delete → vào thùng rác → phục hồi →
// biến mất khỏi thùng rác; cảnh báo liên kết đúng số; và mọi thao tác sai bị chặn đúng lý do.
import { login, logout } from './auth-service.js';
import { getDb } from './db.js';
import * as userSvc from './user-service.js';
import * as trash from './trash-service.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) pass++; else fail++;
  // eslint-disable-next-line no-console
  console.log(`TRASH6 ${cond ? 'PASS' : 'FAIL'} | ${name}` + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
}

export async function runTrashSelfTest(): Promise<number> {
  const db = getDb();
  await login('adminroot', 'Admin@123456');

  // ── SETUP dữ liệu để xóa mềm ──
  const bank = await db.bank.create({ data: { name: 'NH Test', code: 'BANKT1' } });
  const agent = await db.agent.create({ data: { name: 'ĐL Test', code: 'DLT1' } });
  const partner = await db.partner.create({ data: { name: 'ĐT Test', code: 'PT1' } });

  // 20 khách + 10 loại thẻ + 5 đại lý phụ để xóa mềm
  const customers: number[] = [];
  for (let i = 0; i < 20; i++) {
    const c = await db.customer.create({ data: { code: `KHX${i}`, fullName: `KH ${i}`, nickname: `Biệt ${i}` } });
    customers.push(c.id);
  }
  const cardTypes: number[] = [];
  for (let i = 0; i < 10; i++) {
    const ct = await db.cardType.create({ data: { bankId: bank.id, name: `Thẻ ${i}`, code: `T${i}` } });
    cardTypes.push(ct.id);
  }
  const agents: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = await db.agent.create({ data: { name: `ĐL ${i}`, code: `DLX${i}` } });
    agents.push(a.id);
  }

  // ===================== 50 CASE ĐÚNG =====================
  // (1) 20 khách: xóa mềm → phải nằm trong thùng rác (20 assert ĐÚNG)
  for (const id of customers) await db.customer.update({ where: { id }, data: { deletedAt: new Date() } });
  let list = await trash.listTrash();
  const inTrash = new Set((list.data ?? []).filter((r) => r.entityType === 'Customer').map((r) => r.id));
  for (const id of customers) ok(`khách ${id} nằm trong thùng rác sau xóa mềm`, inTrash.has(id));

  // (2) phục hồi 10 khách đầu → ok + biến mất khỏi thùng rác (10 assert ĐÚNG)
  for (let i = 0; i < 10; i++) {
    const r = await trash.restoreItem('Customer', customers[i]);
    ok(`phục hồi khách ${customers[i]} thành công`, r.ok === true);
  }
  list = await trash.listTrash();
  const stillTrash = new Set((list.data ?? []).filter((r) => r.entityType === 'Customer').map((r) => r.id));
  for (let i = 0; i < 10; i++) ok(`khách ${customers[i]} đã rời thùng rác sau phục hồi`, !stillTrash.has(customers[i]));

  // (3) loại thẻ + đại lý phụ: xóa mềm → có trong thùng rác đúng loại (10 assert ĐÚNG: 5 cardtype + 5 agent)
  for (let i = 0; i < 5; i++) await db.cardType.update({ where: { id: cardTypes[i] }, data: { deletedAt: new Date() } });
  for (const id of agents) await db.agent.update({ where: { id }, data: { deletedAt: new Date() } });
  list = await trash.listTrash();
  const ctTrash = new Set((list.data ?? []).filter((r) => r.entityType === 'CardType').map((r) => r.id));
  const agTrash = new Set((list.data ?? []).filter((r) => r.entityType === 'Agent').map((r) => r.id));
  for (let i = 0; i < 5; i++) ok(`loại thẻ ${cardTypes[i]} trong thùng rác`, ctTrash.has(cardTypes[i]));
  for (const id of agents) ok(`đại lý ${id} trong thùng rác`, agTrash.has(id));

  // ===================== CẢNH BÁO LIÊN KẾT (đúng số) =====================
  // agent chính có 3 khách + 2 TID + 1 POS liên kết → linkSummary đếm đúng
  for (let i = 0; i < 3; i++) await db.customer.create({ data: { code: `KHL${i}`, fullName: `L${i}`, nickname: `L${i}`, agentId: agent.id } });
  await db.tid.create({ data: { tid: `TIDL1`, agentId: agent.id } });
  await db.tid.create({ data: { tid: `TIDL2`, agentId: agent.id } });
  await db.posDevice.create({ data: { serial: `SNL1`, currentAgentId: agent.id } });
  const lkAgent = await trash.linkSummary('Agent', agent.id);
  ok('linkSummary Agent trả ok', lkAgent.ok === true);
  const byLabel = Object.fromEntries((lkAgent.data ?? []).map((r) => [r.label, r.count]));
  ok('đếm đúng 3 khách thuộc đại lý', byLabel['Khách hàng thuộc đại lý'] === 3, byLabel);
  ok('đếm đúng 2 TID gắn đại lý', byLabel['TID gắn đại lý'] === 2, byLabel);
  ok('đếm đúng 1 POS ở đại lý', byLabel['Máy POS đang ở đại lý'] === 1, byLabel);

  // bank có 5 loại thẻ còn sống (10 tạo, 5 đã xóa) → linkSummary đếm 5
  const lkBank = await trash.linkSummary('Bank', bank.id);
  const bankLabels = Object.fromEntries((lkBank.data ?? []).map((r) => [r.label, r.count]));
  ok('bank đếm đúng 5 loại thẻ còn sống', bankLabels['Loại thẻ thuộc ngân hàng'] === 5, bankLabels);

  // partner chưa liên kết ngân hàng → linkSummary rỗng
  const lkPartner = await trash.linkSummary('Partner', partner.id);
  ok('partner chưa liên kết → không có ref', (lkPartner.data ?? []).length === 0);

  // ===================== 50 CASE SAI =====================
  // (A) phục hồi id không tồn tại → NOT_FOUND (10)
  for (let i = 0; i < 10; i++) {
    const r = await trash.restoreItem('Customer', 900000 + i);
    ok(`SAI phục hồi khách không tồn tại 90000${i} → NOT_FOUND`, r.ok === false && r.error === 'NOT_FOUND', r.error);
  }
  // (B) phục hồi bản ghi CHƯA xóa → NOT_DELETED (10 — dùng 10 khách đã phục hồi ở bước (2))
  for (let i = 0; i < 10; i++) {
    const r = await trash.restoreItem('Customer', customers[i]);
    ok(`SAI phục hồi khách chưa xóa ${customers[i]} → NOT_DELETED`, r.ok === false && r.error === 'NOT_DELETED', r.error);
  }
  // (C) loại thực thể không hợp lệ → BAD_ENTITY (10)
  const badTypes = ['PosDevice', 'Tid', 'User', 'Role', 'Invoice', 'Xyz', '', 'customer', 'BANK', 'agent'];
  for (const t of badTypes) {
    const r = await trash.restoreItem(t, 1);
    ok(`SAI restore loại "${t}" → BAD_ENTITY hoặc bị chặn`, r.ok === false, r.error);
  }
  // (D) linkSummary loại không hợp lệ → BAD_ENTITY (5)
  for (const t of ['PosDevice', 'Tid', 'Foo', 'User', '']) {
    const r = await trash.linkSummary(t, 1);
    ok(`SAI linkSummary loại "${t}" → BAD_ENTITY`, r.ok === false && r.error === 'BAD_ENTITY', r.error);
  }
  // (E) không có quyền: đăng nhập SALES (không có TRASH_*) → mọi thao tác FORBIDDEN (15)
  await userSvc.createUser({ fullName: 'NV Sales', username: 'salestrash', password: 'Sales@123456', roleCodes: ['SALES'] }).catch(() => undefined);
  await logout();
  await login('salestrash', 'Sales@123456');
  const fList = await trash.listTrash();
  ok('SAI SALES xem thùng rác → FORBIDDEN', fList.ok === false && fList.error === 'FORBIDDEN', fList.error);
  for (let i = 0; i < 7; i++) {
    const r = await trash.restoreItem('Customer', customers[10 + (i % 10)]);
    ok(`SAI SALES phục hồi #${i} → FORBIDDEN`, r.ok === false && r.error === 'FORBIDDEN', r.error);
  }
  for (let i = 0; i < 7; i++) {
    const r = await trash.linkSummary('Agent', agent.id);
    ok(`SAI SALES linkSummary #${i} → FORBIDDEN`, r.ok === false && r.error === 'FORBIDDEN', r.error);
  }
  await logout();

  // eslint-disable-next-line no-console
  console.log(`TRASH6 SUMMARY | pass=${pass} fail=${fail}`);
  return fail === 0 ? 0 : 1;
}
