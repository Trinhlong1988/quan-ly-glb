// PHASE IMPORT (#9) — Nhập liệu hàng loạt từ Excel (main). Spec docs/PHASE_IMPORT_SPEC.md.
// 6 entity (D-IMP1): TID · POS nhập kho · Khách hàng · Hộ kinh doanh · Thu · Chi.
//
// Kiến trúc generic (§1): IMPORT_REGISTRY khai báo cột mẫu + resolver FK + toCreateInput + create.
//  • importTemplateColumns(entityKey) → cột mẫu cho FE sinh .xlsx rỗng.
//  • runImport(entityKey, rows) → gác quyền entity 1 lần (D-IMP5, KHÔNG nới quyền), nạp map tên→id
//    1 lần/entity (đọc DB TRỰC TIẾP như tidRefs — KHÔNG qua list service guarded để giữ role cũ),
//    rồi mỗi dòng: map header→field → convert theo kind → tra FK (khớp KHÔNG phân biệt hoa/thường,
//    mơ hồ ≥2 → lỗi dòng) → toCreateInput → GỌI create THẬT (tái dùng mọi validate/nghiệp vụ).
//    Mỗi dòng độc lập 1 giao dịch (create tự mở $transaction) → partial import, 1 dòng lỗi KHÔNG hỏng
//    dòng khác (D-IMP4). Gom {rowIndex, ok, id?, error?, message?} + summary {created, skipped}.
//
// Thu/Chi tách 2 entityKey riêng (cashThu/cashChi) thay vì 1 cột "Loại" — rõ ràng hơn: mỗi mẫu khóa
// đúng kind + đúng danh mục + Chi bắt buộc "Người chi" (I#3). Ghi rõ theo D-IMP1.
import type { Db } from '@glb/database';
import { onlyDigits, parseVndInput } from '@glb/shared';
import { requirePermission } from './guard.js';
import { createTidUnified, type CreateTidUnifiedInput } from './tid-service.js';
import { createPosIntake, type CreatePosIntakeInput } from './pos-supply-service.js';
import { createCustomer, type CreateCustomerInput } from './customer-service.js';
import { createDossier, type DossierInput } from './dossier-service.js';
import { createCashEntry, type CreateCashEntryInput } from './cash-entry-service.js';

export interface MutationResult {
  ok: boolean;
  error?: string;
  message?: string;
  id?: number;
}

/** Kiểu ô mẫu. text=chuỗi · int=số nguyên · money=tiền VND · date=ngày · ref=FK tra tên/mã · enum=ánh xạ cố định. */
export type ColumnKind = 'text' | 'int' | 'money' | 'date' | 'ref' | 'enum';

export interface TemplateColumn {
  /** Nhãn cột = đúng nhãn export của trang (D-IMP3). Header người dùng điền vào. */
  header: string;
  /** Khóa nội bộ trong object đã map (không lộ ra file mẫu). */
  field: string;
  required: boolean;
  kind: ColumnKind;
  /** Tên resolver (kind='ref') — bank/partner/industry/posModel/supplier/intakeStatus/dossierSource/cashCatThu/cashCatChi/fund/user. */
  ref?: string;
  /** Bảng ánh xạ (kind='enum'): khóa đã chuẩn hóa (lowercase, gộp space) → giá trị lưu. */
  enumMap?: Record<string, string>;
  /** Gợi ý hiển thị trong mẫu / preview (tùy chọn). */
  hint?: string;
}

export interface ImportRowResult {
  rowIndex: number; // 1-based (dòng dữ liệu, KHÔNG kể dòng header)
  ok: boolean;
  id?: number;
  error?: string;
  message?: string;
}
export interface ImportRunResult {
  ok: boolean;
  error?: string;
  message?: string;
  results?: ImportRowResult[];
  summary?: { created: number; skipped: number };
}

/** Kết quả XEM TRƯỚC (dry-run) — validate/tra FK NHƯNG KHÔNG tạo bản ghi (D-IMP4). */
export interface ImportDryRunResult {
  ok: boolean;
  error?: string;
  message?: string;
  results?: { rowIndex: number; ok: boolean; error?: string; message?: string }[];
  summary?: { validCount: number; invalidCount: number };
}

/** Trần số dòng/mẻ (FIX 3 — chống DoS/đơ main). Vượt → lỗi rõ TRƯỚC khi resolve/create. */
export const MAX_IMPORT_ROWS = 2000;

/** Cột mẫu rút gọn trả cho FE (không lộ toCreateInput/create). */
export interface TemplateColumnDto {
  header: string;
  required: boolean;
  kind: ColumnKind;
  hint?: string;
}

type RefResolver = (raw: string) => { id?: number; error?: string };
type Resolvers = Record<string, RefResolver>;

interface ImportEntity {
  label: string;
  permission: string;
  templateColumns: TemplateColumn[];
  /** Tên các resolver FK cần nạp trước (đọc DB 1 lần/entity). */
  resolverKeys: string[];
  /** Ghép các field đã map + tra FK thành input cho create THẬT. Trả error nếu ghép sai. */
  toCreateInput: (resolved: Record<string, unknown>, raw: Record<string, unknown>) => { input?: unknown; error?: string };
  create: (input: unknown) => Promise<MutationResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers chuẩn hóa + convert ô theo kind
// ─────────────────────────────────────────────────────────────────────────────
function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function validYmd(y: number, mo: number, d: number): { value?: string; error?: string } {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { error: `Ngày không hợp lệ (${d}/${mo}/${y}).` };
  const dim = new Date(y, mo, 0).getDate();
  if (d > dim) return { error: `Tháng ${mo}/${y} chỉ có ${dim} ngày.` };
  return { value: `${String(y).padStart(4, '0')}-${pad2(mo)}-${pad2(d)}` };
}
/** Chấp nhận yyyy-mm-dd / ISO / dd/mm/yyyy / dd-mm-yyyy → chuẩn 'YYYY-MM-DD'. */
function parseDateCell(s: string): { value?: string; error?: string } {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return validYmd(+m[3], +m[2], +m[1]);
  const dt = new Date(t);
  if (!Number.isNaN(dt.getTime())) return { value: `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}` };
  return { error: `Ngày không hợp lệ ("${t}").` };
}

/** Chuyển 1 ô theo kind. value=undefined khi rỗng & không bắt buộc. */
function convertCell(col: TemplateColumn, raw: unknown, resolvers: Resolvers): { value?: unknown; error?: string } {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (!s) {
    if (col.required) return { error: `Thiếu ${col.header}` };
    return { value: undefined };
  }
  switch (col.kind) {
    case 'text':
      return { value: s };
    case 'int': {
      const digits = onlyDigits(s);
      if (!digits) return { error: `${col.header} phải là số nguyên.` };
      return { value: Number(digits) };
    }
    case 'money': {
      const n = parseVndInput(s);
      if (n === null) return { error: `${col.header} phải là số tiền (VND).` };
      return { value: n };
    }
    case 'date':
      return parseDateCell(s);
    case 'ref': {
      const resolver = col.ref ? resolvers[col.ref] : undefined;
      if (!resolver) return { error: `Không tra được ${col.header} (thiếu bộ tra cứu).` };
      const r = resolver(s);
      if (r.error) return { error: r.error };
      return { value: r.id };
    }
    case 'enum': {
      const v = col.enumMap?.[norm(s)];
      if (v === undefined) return { error: `${col.header} không hợp lệ ("${s}").` };
      return { value: v };
    }
    default:
      return { value: s };
  }
}

/** Dựng resolver FK: khớp KHÔNG phân biệt hoa/thường trên MỌI khóa (mã + tên); ≥2 id khác nhau → mơ hồ. */
function makeRefResolver(label: string, items: { id: number; keys: (string | null | undefined)[] }[]): RefResolver {
  const index = items.map((it) => ({ id: it.id, keys: it.keys.filter((k): k is string => !!k && k.trim() !== '').map(norm) }));
  return (raw: string) => {
    const key = norm(raw);
    if (!key) return { error: `Thiếu ${label}.` };
    const matched = index.filter((it) => it.keys.includes(key));
    const ids = [...new Set(matched.map((m) => m.id))];
    if (ids.length === 0) return { error: `Không tìm thấy ${label} "${raw.trim()}".` };
    if (ids.length > 1) return { error: `${label} "${raw.trim()}" trùng ≥2 bản ghi — ghi rõ mã để phân biệt.` };
    return { id: ids[0] };
  };
}

/** Nạp các resolver FK cần thiết (đọc DB TRỰC TIẾP — không guard thêm quyền, giữ role cũ như tidRefs). */
async function buildResolvers(db: Db, keys: string[]): Promise<Resolvers> {
  const r: Resolvers = {};
  const need = new Set(keys);
  if (need.has('bank') || need.has('bankApp')) {
    const rows = await db.bank.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true } });
    // Khớp RỘNG (Mr.Long 13/7 "có NH mã hợp lệ load được, có NH không"): nhận MÃ (EIB) + TÊN ĐẦY ĐỦ
    // ("Ngân hàng Exim") + TÊN BỎ TIỀN TỐ "Ngân hàng" ("Exim","VP","MB","An Bình") → gõ kiểu nào cũng ra.
    const stripPrefix = (n: string): string => n.replace(/^\s*ngân\s*hàng\s+/i, '').trim();
    const items = rows.map((x) => ({ id: x.id, keys: [x.code, x.name, stripPrefix(x.name)] }));
    if (need.has('bank')) r.bank = makeRefResolver('ngân hàng', items);
    if (need.has('bankApp')) {
      // Cài APP (máy POS): "Máy trắng"/trống/-/không = CHƯA cài app → bankId=0 (createPosIntake coi 0 = máy trắng).
      const base = makeRefResolver('ngân hàng (app)', items);
      r.bankApp = (raw: string) => {
        const k = raw.trim().replace(/\s+/g, ' ').toLowerCase();
        if (!k || k === 'máy trắng' || k === 'may trang' || k === 'trắng' || k === 'trang' || k === '-' || k === 'không' || k === 'khong') return { id: 0 };
        return base(raw);
      };
    }
  }
  if (need.has('partner')) {
    const rows = await db.partner.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true } });
    r.partner = makeRefResolver('đối tác', rows.map((x) => ({ id: x.id, keys: [x.code, x.name] })));
  }
  if (need.has('industry')) {
    const rows = await db.industry.findMany({ where: { deletedAt: null, active: true }, select: { id: true, code: true, name: true } });
    r.industry = makeRefResolver('ngành nghề', rows.map((x) => ({ id: x.id, keys: [x.code, x.name] })));
  }
  if (need.has('posModel')) {
    const rows = await db.posModel.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true } });
    r.posModel = makeRefResolver('chủng loại máy POS', rows.map((x) => ({ id: x.id, keys: [x.code, x.name] })));
  }
  if (need.has('supplier')) {
    const rows = await db.supplier.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true } });
    r.supplier = makeRefResolver('nhà cung cấp', rows.map((x) => ({ id: x.id, keys: [x.code, x.name] })));
  }
  if (need.has('intakeStatus')) {
    const rows = await db.posIntakeStatus.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
    r.intakeStatus = makeRefResolver('trạng thái nhập', rows.map((x) => ({ id: x.id, keys: [x.name] })));
  }
  if (need.has('dossierSource')) {
    const rows = await db.dossierSource.findMany({ where: { deletedAt: null }, select: { id: true, code: true } });
    r.dossierSource = makeRefResolver('nguồn hồ sơ', rows.map((x) => ({ id: x.id, keys: [x.code] })));
  }
  if (need.has('cashCatThu')) {
    const rows = await db.cashCategory.findMany({ where: { deletedAt: null, active: true, kind: 'THU' }, select: { id: true, name: true } });
    r.cashCatThu = makeRefResolver('danh mục thu', rows.map((x) => ({ id: x.id, keys: [x.name] })));
  }
  if (need.has('cashCatChi')) {
    const rows = await db.cashCategory.findMany({ where: { deletedAt: null, active: true, kind: 'CHI' }, select: { id: true, name: true } });
    r.cashCatChi = makeRefResolver('danh mục chi', rows.map((x) => ({ id: x.id, keys: [x.name] })));
  }
  if (need.has('fund')) {
    const rows = await db.fund.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true } });
    r.fund = makeRefResolver('quỹ', rows.map((x) => ({ id: x.id, keys: [x.code, x.name] })));
  }
  if (need.has('user')) {
    const rows = await db.user.findMany({ where: { deletedAt: null, status: { not: 'DELETED' } }, select: { id: true, employeeCode: true, fullName: true, username: true } });
    r.user = makeRefResolver('nhân sự', rows.map((x) => ({ id: x.id, keys: [x.employeeCode, x.fullName, x.username] })));
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bảng ánh xạ enum dùng chung
// ─────────────────────────────────────────────────────────────────────────────
const METHOD_MAP: Record<string, string> = {
  ck: 'CK', 'chuyển khoản': 'CK', 'chuyen khoan': 'CK', 'chuyển khoản (ck)': 'CK',
  cash: 'CASH', 'tiền mặt': 'CASH', 'tien mat': 'CASH', 'tiền mặt (cash)': 'CASH'
};
const MST_MAP: Record<string, string> = {
  'hoạt động': 'ACTIVE', 'hoat dong': 'ACTIVE', active: 'ACTIVE',
  'đóng': 'CLOSED', dong: 'CLOSED', closed: 'CLOSED'
};

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT_REGISTRY — 6 entity
// ─────────────────────────────────────────────────────────────────────────────
export const IMPORT_REGISTRY: Record<string, ImportEntity> = {
  // (1) TID — createTidUnified (chưa gán + chưa giao). Perm CONFIG_TID_MANAGE.
  tid: {
    label: 'TID',
    permission: 'CONFIG_TID_MANAGE',
    resolverKeys: ['partner', 'bank', 'industry'],
    templateColumns: [
      { header: 'Chuỗi TID', field: 'tid', required: true, kind: 'text' },
      { header: 'Chuỗi MID', field: 'mid', required: false, kind: 'text' },
      { header: 'Tên HKD', field: 'hkdName', required: true, kind: 'text' },
      { header: 'Đối tác', field: 'partnerId', required: true, kind: 'ref', ref: 'partner', hint: 'Tên hoặc mã đối tác' },
      { header: 'Ngân hàng', field: 'bankId', required: true, kind: 'ref', ref: 'bank', hint: 'Tên hoặc mã ngân hàng' },
      { header: 'Ngành nghề', field: 'industryId', required: true, kind: 'ref', ref: 'industry', hint: 'Tên hoặc mã ngành (đang dùng)' },
      { header: 'Ghi chú', field: 'note', required: false, kind: 'text' }
    ],
    toCreateInput: (r) => ({
      input: {
        tid: r.tid,
        mid: (r.mid as string | undefined) ?? null,
        hkdName: r.hkdName,
        partnerId: r.partnerId,
        bankId: r.bankId,
        industryId: r.industryId,
        note: (r.note as string | undefined) ?? null
      } as CreateTidUnifiedInput
    }),
    create: (input) => createTidUnified(input as CreateTidUnifiedInput)
  },

  // (2) POS nhập kho — createPosIntake. Perm CONFIG_POS_SUPPLY_MANAGE.
  posIntake: {
    label: 'POS nhập kho',
    permission: 'CONFIG_POS_SUPPLY_MANAGE',
    resolverKeys: ['posModel', 'supplier', 'intakeStatus', 'bankApp'],
    templateColumns: [
      { header: 'Số seri', field: 'serial', required: true, kind: 'text' },
      { header: 'Chủng loại', field: 'posModelId', required: true, kind: 'ref', ref: 'posModel', hint: 'Tên hoặc mã chủng loại' },
      { header: 'Cài APP (ngân hàng)', field: 'bankId', required: false, kind: 'ref', ref: 'bankApp', hint: 'Mã/tên ngân hàng (EIB, Exim, VP…) — để TRỐNG hoặc ghi "Máy trắng" = chưa cài app' },
      { header: 'Nhà cung cấp', field: 'supplierId', required: true, kind: 'ref', ref: 'supplier', hint: 'Tên hoặc mã NCC' },
      { header: 'Trạng thái nhập', field: 'intakeStatusId', required: true, kind: 'ref', ref: 'intakeStatus', hint: 'Tên trạng thái nhập' },
      { header: 'Giá nhập', field: 'importPrice', required: true, kind: 'money' },
      { header: 'Ngày nhập', field: 'importedAt', required: true, kind: 'date', hint: 'yyyy-mm-dd hoặc dd/mm/yyyy' },
      { header: 'Ghi chú', field: 'note', required: false, kind: 'text' }
    ],
    toCreateInput: (r) => ({
      input: {
        serial: r.serial,
        posModelId: r.posModelId,
        supplierId: r.supplierId,
        intakeStatusId: r.intakeStatusId,
        importPrice: r.importPrice,
        importedAt: r.importedAt,
        bankId: (r.bankId as number | undefined) ?? null,
        note: (r.note as string | undefined) ?? null
      } as CreatePosIntakeInput
    }),
    create: (input) => createPosIntake(input as CreatePosIntakeInput)
  },

  // (3) Khách hàng — createCustomer (mã KH## auto). Perm CUSTOMER_CREATE.
  customer: {
    label: 'Khách hàng',
    permission: 'CUSTOMER_CREATE',
    resolverKeys: [],
    templateColumns: [
      { header: 'Biệt danh', field: 'nickname', required: true, kind: 'text', hint: 'Tên dễ gọi (bắt buộc)' },
      { header: 'Tên thật', field: 'fullName', required: true, kind: 'text' },
      { header: 'Số điện thoại', field: 'phone', required: false, kind: 'text' },
      { header: 'Địa chỉ', field: 'address', required: false, kind: 'text' }
    ],
    toCreateInput: (r) => ({
      input: {
        fullName: r.fullName,
        nickname: r.nickname,
        phone: (r.phone as string | undefined) ?? null,
        address: (r.address as string | undefined) ?? null
      } as CreateCustomerInput
    }),
    create: (input) => createCustomer(input as CreateCustomerInput)
  },

  // (4) Hộ kinh doanh — createDossier. Perm CONFIG_DOSSIER_MANAGE.
  dossier: {
    label: 'Hộ kinh doanh',
    permission: 'CONFIG_DOSSIER_MANAGE',
    resolverKeys: ['dossierSource'],
    // FULL trường như FORM app (Mr.Long 14/7): đủ HKD + ĐKKD + chủ hộ + CCCD + địa chỉ + liên hệ → import tự điền.
    templateColumns: [
      { header: 'Nguồn', field: 'sourceId', required: true, kind: 'ref', ref: 'dossierSource', hint: 'Mã nguồn hồ sơ' },
      { header: 'Tên HKD', field: 'hkdName', required: true, kind: 'text' },
      { header: 'Địa chỉ HKD', field: 'hkdAddress', required: false, kind: 'text' },
      { header: 'MST', field: 'taxCode', required: false, kind: 'text' },
      { header: 'Trạng thái MST', field: 'mstStatus', required: false, kind: 'enum', enumMap: MST_MAP, hint: 'Hoạt động / Đóng (mặc định Hoạt động)' },
      { header: 'Ngày cấp ĐKKD', field: 'dkkdIssueDate', required: false, kind: 'date', hint: 'dd/mm/yyyy' },
      { header: 'Nơi cấp ĐKKD', field: 'dkkdIssuePlace', required: false, kind: 'text' },
      { header: 'Chủ hộ', field: 'ownerName', required: true, kind: 'text' },
      { header: 'Giới tính', field: 'gender', required: false, kind: 'text' },
      { header: 'Dân tộc', field: 'ethnicity', required: false, kind: 'text' },
      { header: 'Số CCCD', field: 'cccdNumber', required: false, kind: 'text' },
      { header: 'Ngày cấp CCCD', field: 'cccdIssueDate', required: false, kind: 'date', hint: 'dd/mm/yyyy' },
      { header: 'Nơi cấp CCCD', field: 'cccdIssuePlace', required: false, kind: 'text' },
      { header: 'Ngày hết hạn CCCD', field: 'cccdExpiry', required: false, kind: 'date', hint: 'dd/mm/yyyy' },
      { header: 'Địa chỉ thường trú', field: 'permanentAddress', required: false, kind: 'text' },
      { header: 'Nơi ở hiện tại', field: 'currentAddress', required: false, kind: 'text' },
      { header: 'Email', field: 'email', required: false, kind: 'text' },
      { header: 'Ghi chú', field: 'note', required: false, kind: 'text' }
    ],
    toCreateInput: (r) => {
      const t = (k: string): string | null => (r[k] as string | undefined) ?? null;
      const input: DossierInput = {
        sourceId: r.sourceId as number,
        hkdName: r.hkdName as string,
        ownerName: r.ownerName as string,
        hkdAddress: t('hkdAddress'),
        taxCode: t('taxCode'),
        dkkdIssueDate: t('dkkdIssueDate'),
        dkkdIssuePlace: t('dkkdIssuePlace'),
        gender: t('gender'),
        ethnicity: t('ethnicity'),
        cccdNumber: t('cccdNumber'),
        cccdIssueDate: t('cccdIssueDate'),
        cccdIssuePlace: t('cccdIssuePlace'),
        cccdExpiry: t('cccdExpiry'),
        permanentAddress: t('permanentAddress'),
        currentAddress: t('currentAddress'),
        email: t('email'),
        note: t('note')
      };
      if (r.mstStatus !== undefined) input.mstStatus = r.mstStatus as string; // rỗng → createDossier mặc định ACTIVE
      return { input };
    },
    create: (input) => createDossier(input as DossierInput)
  },

  // (5) Thu — createCashEntry kind THU. Perm CASHENTRY_CREATE.
  cashThu: {
    label: 'Phiếu thu',
    permission: 'CASHENTRY_CREATE',
    resolverKeys: ['cashCatThu', 'fund', 'user'],
    templateColumns: [
      { header: 'Danh mục', field: 'categoryId', required: true, kind: 'ref', ref: 'cashCatThu', hint: 'Tên danh mục thu' },
      { header: 'Quỹ', field: 'fundId', required: true, kind: 'ref', ref: 'fund', hint: 'Tên hoặc mã quỹ' },
      { header: 'Số tiền', field: 'amount', required: true, kind: 'money' },
      { header: 'Hình thức', field: 'method', required: true, kind: 'enum', enumMap: METHOD_MAP, hint: 'Chuyển khoản / Tiền mặt' },
      { header: 'Ngày', field: 'entryDate', required: true, kind: 'date', hint: 'yyyy-mm-dd hoặc dd/mm/yyyy' },
      { header: 'Người nhận', field: 'receiverUserId', required: false, kind: 'ref', ref: 'user', hint: 'Mã/tên nhân sự (tùy chọn)' },
      { header: 'Ghi chú', field: 'note', required: false, kind: 'text' }
    ],
    toCreateInput: (r) => ({
      input: {
        kind: 'THU',
        categoryId: r.categoryId,
        fundId: r.fundId,
        amount: r.amount,
        method: r.method,
        entryDate: r.entryDate,
        receiverUserId: (r.receiverUserId as number | undefined) ?? null,
        note: (r.note as string | undefined) ?? null
      } as CreateCashEntryInput
    }),
    create: (input) => createCashEntry(input as CreateCashEntryInput)
  },

  // (6) Chi — createCashEntry kind CHI (bắt buộc Người chi — I#3). Perm CASHENTRY_CREATE.
  cashChi: {
    label: 'Phiếu chi',
    permission: 'CASHENTRY_CREATE',
    resolverKeys: ['cashCatChi', 'fund', 'user'],
    templateColumns: [
      { header: 'Danh mục', field: 'categoryId', required: true, kind: 'ref', ref: 'cashCatChi', hint: 'Tên danh mục chi' },
      { header: 'Quỹ', field: 'fundId', required: true, kind: 'ref', ref: 'fund', hint: 'Tên hoặc mã quỹ' },
      { header: 'Số tiền', field: 'amount', required: true, kind: 'money' },
      { header: 'Hình thức', field: 'method', required: true, kind: 'enum', enumMap: METHOD_MAP, hint: 'Chuyển khoản / Tiền mặt' },
      { header: 'Ngày', field: 'entryDate', required: true, kind: 'date', hint: 'yyyy-mm-dd hoặc dd/mm/yyyy' },
      { header: 'Người chi', field: 'payerUserId', required: true, kind: 'ref', ref: 'user', hint: 'Mã/tên nhân sự (bắt buộc)' },
      { header: 'Ghi chú', field: 'note', required: false, kind: 'text' }
    ],
    toCreateInput: (r) => ({
      input: {
        kind: 'CHI',
        categoryId: r.categoryId,
        fundId: r.fundId,
        amount: r.amount,
        method: r.method,
        entryDate: r.entryDate,
        payerUserId: r.payerUserId,
        note: (r.note as string | undefined) ?? null
      } as CreateCashEntryInput
    }),
    create: (input) => createCashEntry(input as CreateCashEntryInput)
  }
};

/** Cột mẫu của 1 entity (cho FE sinh .xlsx rỗng). null nếu entityKey sai. */
export function importTemplateColumns(entityKey: string): { ok: boolean; data?: TemplateColumnDto[]; error?: string; message?: string } {
  const entity = IMPORT_REGISTRY[entityKey];
  if (!entity) return { ok: false, error: 'BAD_ENTITY', message: `Loại nhập không hợp lệ: ${entityKey}.` };
  return { ok: true, data: entity.templateColumns.map((c) => ({ header: c.header, required: c.required, kind: c.kind, hint: c.hint })) };
}

/** 1 dòng đã map+validate+tra FK (CHƯA tạo). ok=false → error/message; ok=true → input sẵn sàng create. */
interface PreparedRow {
  rowIndex: number;
  ok: boolean;
  error?: string;
  message?: string;
  input?: unknown;
}

/** Convert+validate+tra FK+toCreateInput 1 dòng — DÙNG CHUNG cho dryRun và run (KHÔNG lệch logic). */
function prepareRow(entity: ImportEntity, resolvers: Resolvers, raw: Record<string, unknown>, rowIndex: number): PreparedRow {
  const resolved: Record<string, unknown> = {};
  const errs: string[] = [];
  for (const col of entity.templateColumns) {
    const c = convertCell(col, raw[col.header], resolvers);
    if (c.error) errs.push(c.error);
    else if (c.value !== undefined) resolved[col.field] = c.value;
  }
  if (errs.length > 0) return { rowIndex, ok: false, error: 'VALIDATION', message: errs.join('; ') };
  const built = entity.toCreateInput(resolved, raw);
  if (built.error || built.input === undefined) return { rowIndex, ok: false, error: 'VALIDATION', message: built.error ?? 'Không dựng được dữ liệu dòng.' };
  return { rowIndex, ok: true, input: built.input };
}

/** Gác chung: kiểm entity + quyền (D-IMP5) + trần số dòng (FIX 3). Trả {db, prepared[]} hoặc lỗi. */
async function gateAndPrepare(entityKey: string, rows: Record<string, unknown>[]): Promise<{ ok: true; entity: ImportEntity; prepared: PreparedRow[] } | { ok: false; error: string; message: string }> {
  const entity = IMPORT_REGISTRY[entityKey];
  if (!entity) return { ok: false, error: 'BAD_ENTITY', message: `Loại nhập không hợp lệ: ${entityKey}.` };
  // D-IMP5: gác đúng quyền CREATE/MANAGE của entity (1 lần) — không nới quyền.
  const g = await requirePermission(entity.permission, { action: `IMPORT_${entityKey}`, targetType: 'Import' });
  if (!g.ok) return { ok: false, error: g.error, message: g.message };
  if (!Array.isArray(rows)) return { ok: false, error: 'VALIDATION', message: 'Dữ liệu nhập không hợp lệ (không phải danh sách dòng).' };
  if (rows.length === 0) return { ok: false, error: 'EMPTY', message: 'File không có dòng dữ liệu nào.' };
  // FIX 3: chặn TRƯỚC khi resolve/create.
  if (rows.length > MAX_IMPORT_ROWS) return { ok: false, error: 'TOO_MANY_ROWS', message: `Vượt giới hạn ${MAX_IMPORT_ROWS} dòng/mẻ — chia nhỏ file.` };
  const resolvers = await buildResolvers(g.db, entity.resolverKeys);
  const prepared = rows.map((raw, i) => prepareRow(entity, resolvers, (raw ?? {}) as Record<string, unknown>, i + 1));
  return { ok: true, entity, prepared };
}

/**
 * XEM TRƯỚC (dry-run, D-IMP4): gác quyền + tra FK + validate TỪNG DÒNG NHƯNG **KHÔNG tạo bản ghi**.
 * Trả kết quả mỗi dòng OK/lỗi + {validCount, invalidCount} để FE hiện bảng xác nhận trước khi nhập thật.
 */
export async function dryRunImport(entityKey: string, rows: Record<string, unknown>[]): Promise<ImportDryRunResult> {
  const g = await gateAndPrepare(entityKey, rows);
  if (!g.ok) return { ok: false, error: g.error, message: g.message };
  let validCount = 0;
  let invalidCount = 0;
  const results = g.prepared.map((p) => {
    if (p.ok) validCount++;
    else invalidCount++;
    return { rowIndex: p.rowIndex, ok: p.ok, error: p.error, message: p.message };
  });
  return { ok: true, results, summary: { validCount, invalidCount } };
}

/**
 * Nhập THẬT cho 1 entity (D-IMP4): gác quyền 1 lần; nạp map tên→id 1 lần; mỗi dòng độc lập qua create
 * THẬT (partial import — dòng lỗi bỏ qua, không hỏng dòng khác). rows = mảng object theo header.
 */
export async function runImport(entityKey: string, rows: Record<string, unknown>[]): Promise<ImportRunResult> {
  const g = await gateAndPrepare(entityKey, rows);
  if (!g.ok) return { ok: false, error: g.error, message: g.message };

  const results: ImportRowResult[] = [];
  let created = 0;
  let skipped = 0;
  for (const p of g.prepared) {
    if (!p.ok) {
      results.push({ rowIndex: p.rowIndex, ok: false, error: p.error, message: p.message });
      skipped++;
      continue;
    }
    let res: MutationResult;
    try {
      res = await g.entity.create(p.input);
    } catch (e) {
      res = { ok: false, error: 'EXCEPTION', message: e instanceof Error ? e.message : 'Lỗi không xác định khi tạo dòng.' };
    }
    if (res.ok) {
      created++;
      results.push({ rowIndex: p.rowIndex, ok: true, id: res.id });
    } else {
      skipped++;
      results.push({ rowIndex: p.rowIndex, ok: false, error: res.error, message: res.message });
    }
  }
  return { ok: true, results, summary: { created, skipped } };
}
