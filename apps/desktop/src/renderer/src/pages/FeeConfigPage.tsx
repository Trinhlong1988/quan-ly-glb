import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, Percent, Tag, Save, Download } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTime } from '@glb/shared';
import type { FeeTypeDto, FeeRateDto, PartnerDto, LiteRef, CardTypeDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { isStaleWrite, STALE_TITLE } from '../lib/optlock.js';
import { Modal } from '../components/Modal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';
import { Button } from '../components/Button.js';
import { useRowSelection, SelectionBar, SelectAllCell, SelectCell } from '../components/Selection.js';
import { AuditTrailHeadCells, AuditTrailCells } from '../components/AuditCells.js';
import { exportCsv } from '../lib/exportCsv.js';
import { TabBar, TabButton } from '../components/Tabs.js';

type Tab = 'rate' | 'type';

/** Hiển thị % gọn (tối đa 3 số thập phân, bỏ số 0 thừa). */
function fmtPct(v: number): string {
  const s = v.toFixed(3).replace(/\.?0+$/, '');
  return `${s}%`;
}
/** Chênh lệch: âm = đỏ trong ngoặc, dương = xanh dương (§C5b). */
function CL({ v }: { v: number }): JSX.Element {
  if (v < 0) return <span className="font-medium text-danger">({fmtPct(Math.abs(v))})</span>;
  return <span className="font-medium text-brand">{fmtPct(v)}</span>;
}

function IconBtn({ children, title, variant, onClick }: { children: JSX.Element; title: string; variant?: 'edit' | 'danger'; onClick: () => void }): JSX.Element {
  const tone = variant === 'danger' ? 'text-danger hover:bg-danger/10' : variant === 'edit' ? 'text-warning hover:bg-warning/10' : 'text-slate-400 hover:bg-brand-tint hover:text-brand';
  return <button title={title} onClick={onClick} className={'rounded-md p-1.5 transition ' + tone}>{children}</button>;
}

export function FeeConfigPage({ user }: { user: AuthUser }): JSX.Element {
  const [tab, setTab] = useState<Tab>('rate');
  const canManage = hasPermission(user, 'CONFIG_FEE_MANAGE');
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Phí mua-cài máy-bán</h2>
        <p className="text-sm text-slate-500">Biểu phí % theo Đối tác × Loại thẻ · Danh mục loại phí bán.</p>
      </div>
      <TabBar>
        <TabButton active={tab === 'rate'} onClick={() => setTab('rate')} icon={<Percent className="h-4 w-4" />}>Biểu phí %</TabButton>
        <TabButton active={tab === 'type'} onClick={() => setTab('type')} icon={<Tag className="h-4 w-4" />}>Loại phí</TabButton>
      </TabBar>
      {tab === 'rate' && <RateTab canManage={canManage} />}
      {tab === 'type' && <TypeTab canManage={canManage} />}
    </div>
  );
}

// ── §C5a LOẠI PHÍ ────────────────────────────────────────────────────────────
function TypeTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<FeeTypeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: FeeTypeDto } | null>(null);
  const [del, setDel] = useState<FeeTypeDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.feeTypeList();
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  async function doDelete(t: FeeTypeDto, password?: string): Promise<void> {
    const res = await window.api.feeTypeDelete([t.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa loại phí ${t.name}`);
    else toast.alert(res.message ?? 'Xóa loại phí thất bại', 'Xóa thất bại');
    setDel(null);
    await reload();
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.feeTypeDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} loại phí`);
    else toast.alert(res.message ?? 'Xóa loại phí thất bại', 'Xóa thất bại');
    setBulkDel(false);
    await reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} loại phí · <span className="text-slate-400">ví dụ: Ủy quyền, Tiền chờ, Tiền Nhanh</span></div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('loai_phi', ['Tên loại phí', 'Người tạo', 'Ngày tạo', 'Giờ tạo', 'Người sửa', 'Ngày sửa', 'Giờ sửa'], rows.map((t) => [t.name, t.createdByName ?? '', fmtDate(t.createdAt), fmtTime(t.createdAt), t.updatedByName ?? '', fmtDate(t.updatedAt), fmtTime(t.updatedAt)]))}>Xuất Excel</Button>
          {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>Thêm loại phí</Button>}
        </div>
      </div>
      {canManage && <SelectionBar count={sel.count} entityLabel="loại phí" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Tên loại phí</th>
              <AuditTrailHeadCells />
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canManage ? 9 : 7} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canManage ? 9 : 7} className="px-4 py-10 text-center text-slate-400"><Tag className="mx-auto mb-2 h-6 w-6" /> Chưa có loại phí.</td></tr>}
            {!loading && rows.map((t) => (
              <tr key={t.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(t.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={t.id} sel={sel} />}
                <td className="px-4 py-3 font-medium text-slate-800">{t.name}</td>
                <AuditTrailCells row={t} />
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: t })}><Pencil className="h-4 w-4" /></IconBtn>
                      <IconBtn title="Xóa" variant="danger" onClick={() => setDel(t)}><Trash2 className="h-4 w-4" /></IconBtn>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <TypeForm mode={form.mode} row={form.row} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa loại phí" message={`Loại phí "${del.name}" sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều loại phí" message={`${sel.count} loại phí đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function TypeForm({ mode, row, onClose, onSaved }: { mode: 'create' | 'edit'; row?: FeeTypeDto; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [name, setName] = useState(row?.name ?? '');
  const [busy, setBusy] = useState(false);
  async function save(): Promise<void> {
    if (!name.trim()) return toast.alert('Tên loại phí bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const res = mode === 'edit' && row ? await window.api.feeTypeUpdate(row.id, { name: name.trim(), expectedUpdatedAt: row.updatedAt }) : await window.api.feeTypeCreate({ name: name.trim() });
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật loại phí' : `Đã thêm loại phí ${name}`); onSaved(); }
    else if (isStaleWrite(res)) { toast.alert(res.message ?? 'Bản ghi đã được người khác cập nhật, vui lòng mở lại.', STALE_TITLE); onSaved(); }
    else toast.alert(res.message ?? 'Lưu loại phí thất bại', 'Không lưu được');
  }
  return (
    <Modal title={mode === 'edit' ? 'Sửa loại phí' : 'Thêm loại phí'} onClose={onClose} width="max-w-md" onSubmit={() => void save()}>
      <Field label="Tên loại phí" required hint="Ví dụ: Ủy quyền, Tiền chờ, Tiền Nhanh"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm loại phí'}</Button>
      </div>
    </Modal>
  );
}

// ── §C5b BIỂU PHÍ % (FEE_MODEL) ──────────────────────────────────────────────
// Phí mua + phí cài máy = 1 giá CỐ ĐỊNH (không theo loại phí). Phí BÁN NIÊM YẾT theo TỪNG loại phí.
function RateTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<FeeRateDto[]>([]);
  const [partners, setPartners] = useState<PartnerDto[]>([]);
  const [banks, setBanks] = useState<LiteRef[]>([]);
  const [feeTypes, setFeeTypes] = useState<FeeTypeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [fPartner, setFPartner] = useState('');
  const [fBank, setFBank] = useState('');
  const [setOpen, setSetOpen] = useState<FeeRateDto | 'new' | null>(null);
  const [del, setDel] = useState<FeeRateDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function loadRefs(): Promise<void> {
    const [p, b, f] = await Promise.all([window.api.partnerList({}), window.api.bankLite(), window.api.feeTypeList()]);
    if (p.ok && p.data) setPartners(p.data);
    if (b.ok && b.data) setBanks(b.data);
    if (f.ok && f.data) setFeeTypes(f.data);
  }
  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.feeRateList({ partnerId: fPartner ? Number(fPartner) : undefined, bankId: fBank ? Number(fBank) : undefined });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void loadRefs(); }, []);
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [fPartner, fBank]);

  async function doDelete(fr: FeeRateDto, password?: string): Promise<void> {
    const res = await window.api.feeRateDelete([fr.id], password ?? '');
    if (res.ok) toast.success('Đã xóa biểu phí');
    else toast.alert(res.message ?? 'Xóa biểu phí thất bại', 'Xóa thất bại');
    setDel(null);
    await reload();
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.feeRateDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} biểu phí`);
    else toast.alert(res.message ?? 'Xóa biểu phí thất bại', 'Xóa thất bại');
    setBulkDel(false);
    await reload();
  }

  // Xuất Excel: 1 dòng / (biểu phí × loại phí niêm yết) để bung mảng sellQuotes.
  function exportRows(): void {
    const data: (string | number)[][] = [];
    for (const r of rows) {
      if (r.sellQuotes.length === 0) {
        data.push([r.partnerName ?? '', r.bankCode ?? '', r.cardTypeName ?? '', fmtDate(r.effectiveFrom), r.isCurrent ? 'x' : '', r.phiMua, r.phiCaiMay, r.clNcc, '', '', '']);
      }
      for (const q of r.sellQuotes) {
        data.push([r.partnerName ?? '', r.bankCode ?? '', r.cardTypeName ?? '', fmtDate(r.effectiveFrom), r.isCurrent ? 'x' : '', r.phiMua, r.phiCaiMay, r.clNcc, q.feeTypeName ?? '', q.phiBan, q.clKh]);
      }
    }
    exportCsv('bieu_phi', ['Đối tác', 'Ngân hàng', 'Loại thẻ', 'Hiệu lực từ', 'Đang hiệu lực', 'Phí mua %', 'Phí cài máy %', 'Chênh lệch với Nhà cung cấp %', 'Loại phí', 'Phí bán niêm yết %', 'Chênh lệch với Khách hàng %'], data);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} biểu phí · <span className="text-slate-400">phí mua &amp; cài máy cố định · phí bán niêm yết theo từng loại phí</span></div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={exportRows}>Xuất Excel</Button>
          {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => partners.length ? setSetOpen('new') : toast.alert('Chưa có đối tác — thêm ở tab \'Đối tác\' (Cấu hình ngân hàng) rồi liên kết ngân hàng trước khi đặt phí.', 'Thiếu dữ liệu nền')}>Đặt biểu phí</Button>}
        </div>
      </div>
      <FilterBar
        search="" onSearch={() => undefined} searchPlaceholder=""
        selects={[
          { key: 'p', placeholder: 'Tất cả đối tác', value: fPartner, options: partners.map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` })), onChange: setFPartner },
          { key: 'b', placeholder: 'Tất cả ngân hàng', value: fBank, options: banks.map((b) => ({ value: String(b.id), label: `${b.code} · ${b.name}` })), onChange: setFBank }
        ]}
        onApply={reload} onReset={() => { setFPartner(''); setFBank(''); setTimeout(reload, 0); }}
      />
      {canManage && <SelectionBar count={sel.count} entityLabel="biểu phí" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Đối tác</th>
              <th className="px-4 py-3">Ngân hàng</th>
              <th className="px-4 py-3">Loại thẻ</th>
              <th className="px-4 py-3">Hiệu lực từ</th>
              <th className="px-4 py-3 text-right">Phí mua</th>
              <th className="px-4 py-3 text-right">Phí cài máy</th>
              <th className="px-4 py-3 text-right">Chênh lệch với Nhà cung cấp</th>
              <th className="px-4 py-3">Phí bán niêm yết theo loại phí</th>
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canManage ? 10 : 8} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canManage ? 10 : 8} className="px-4 py-10 text-center text-slate-400"><Percent className="mx-auto mb-2 h-6 w-6" /> Chưa có biểu phí.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(r.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={r.id} sel={sel} />}
                <td className="px-4 py-3"><span className="font-mono text-xs font-semibold whitespace-nowrap text-brand">{r.partnerCode}</span> <span className="text-slate-700">{r.partnerName}</span></td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600">{r.bankCode ?? '—'}</td>
                <td className="px-4 py-3"><span className="font-mono text-xs font-semibold whitespace-nowrap text-brand">{r.cardTypeCode}</span> <span className="text-slate-700">{r.cardTypeName}</span></td>
                <td className="px-4 py-3 text-xs text-slate-600">{fmtDate(r.effectiveFrom)}{r.isCurrent && <span className="ml-2 rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-semibold text-brand">Đang hiệu lực</span>}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap text-slate-800">{fmtPct(r.phiMua)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap text-slate-800">{fmtPct(r.phiCaiMay)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap"><CL v={r.clNcc} /></td>
                <td className="px-4 py-3">
                  {r.sellQuotes.length === 0 ? <span className="text-slate-400">— chưa cấu hình —</span> : (
                    <div className="flex flex-col gap-0.5">
                      {r.sellQuotes.map((q) => (
                        <div key={q.feeTypeId} className="flex items-center gap-2 whitespace-nowrap">
                          <span className="text-slate-600">{q.feeTypeName}:</span>
                          <span className="font-medium text-slate-800">{fmtPct(q.phiBan)}</span>
                          <span className="text-xs text-slate-400">CL KH</span> <CL v={q.clKh} />
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <IconBtn title="Sửa phí" variant="edit" onClick={() => setSetOpen(r)}><Pencil className="h-4 w-4" /></IconBtn>
                      <IconBtn title="Xóa" variant="danger" onClick={() => setDel(r)}><Trash2 className="h-4 w-4" /></IconBtn>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {setOpen && <RateForm existing={setOpen === 'new' ? null : setOpen} partners={partners} banks={banks} feeTypes={feeTypes} onClose={() => setSetOpen(null)} onSaved={() => { setSetOpen(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa biểu phí" message={`Biểu phí ${del.partnerName} · ${del.cardTypeName} sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều biểu phí" message={`${sel.count} biểu phí đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

// FEE_MODEL — form biểu phí: phí mua (1 ô) + phí cài (1 ô) CỐ ĐỊNH + phí bán niêm yết theo TỪNG loại phí active.
function RateForm({ existing, partners, banks, feeTypes, onClose, onSaved }: { existing: FeeRateDto | null; partners: PartnerDto[]; banks: LiteRef[]; feeTypes: FeeTypeDto[]; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const isEdit = existing !== null;
  const [partnerId, setPartnerId] = useState(existing ? String(existing.partnerId) : '');
  const [bankId, setBankId] = useState(existing?.bankId ? String(existing.bankId) : '');
  const [cardTypeId, setCardTypeId] = useState(existing ? String(existing.cardTypeId) : '');
  const [cards, setCards] = useState<CardTypeDto[]>([]);
  const [phiMua, setPhiMua] = useState(existing ? String(existing.phiMua) : '');
  const [phiCaiMay, setPhiCaiMay] = useState(existing ? String(existing.phiCaiMay) : '');
  // Phí bán niêm yết theo TỪNG loại phí (map feeTypeId → chuỗi %). Sửa → nạp giá cũ; loại phí chưa có = rỗng.
  const [quotes, setQuotes] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    const existingByFt = new Map((existing?.sellQuotes ?? []).map((q) => [q.feeTypeId, q.phiBan]));
    for (const f of feeTypes) init[f.id] = existingByFt.has(f.id) ? String(existingByFt.get(f.id)) : '';
    return init;
  });
  const [effectiveFrom, setEffectiveFrom] = useState(existing ? existing.effectiveFrom.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  // Ngân hàng khả dụng = ngân hàng ĐÃ liên kết với đối tác đang chọn (§C5b).
  const partner = partners.find((p) => String(p.id) === partnerId);
  const linkedBankIds = new Set(partner?.bankIds ?? []);
  const availBanks = banks.filter((b) => linkedBankIds.has(b.id));

  useEffect(() => {
    if (!bankId) { setCards([]); return; }
    window.api.cardTypeList({ bankId: Number(bankId) }).then((r) => { if (r.ok && r.data) setCards(r.data); });
  }, [bankId]);

  const clNcc = phiMua !== '' && phiCaiMay !== '' ? Number(phiMua) - Number(phiCaiMay) : null;

  function validPct(s: string): boolean {
    if (s === '') return false;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;
  }

  async function save(): Promise<void> {
    if (!partnerId) return toast.alert('Vui lòng chọn đối tác.', 'Thiếu thông tin');
    if (!bankId) return toast.alert('Vui lòng chọn ngân hàng (liên kết với đối tác).', 'Thiếu thông tin');
    if (!cardTypeId) return toast.alert('Vui lòng chọn loại thẻ.', 'Thiếu thông tin');
    for (const [label, v] of [['Phí mua', phiMua], ['Phí cài máy', phiCaiMay]] as const) {
      if (!validPct(v)) return toast.alert(`${label} không hợp lệ (≥ 0, tối đa 3 số thập phân).`, 'Giá trị không hợp lệ');
    }
    if (Number(phiMua) < Number(phiCaiMay)) return toast.alert('Phí mua phải ≥ phí cài máy (chênh đối tác không được âm).', 'Giá trị không hợp lệ');
    if (feeTypes.length === 0) return toast.alert('Chưa có loại phí bán nào — thêm ở tab "Loại phí" trước khi đặt biểu phí.', 'Thiếu dữ liệu nền');
    const sellQuotes: { feeTypeId: number; phiBan: number }[] = [];
    for (const f of feeTypes) {
      const raw = (quotes[f.id] ?? '').trim();
      if (!validPct(raw)) return toast.alert(`Phí bán niêm yết loại phí "${f.name}" không hợp lệ (≥ 0, tối đa 3 số thập phân).`, 'Giá trị không hợp lệ');
      if (Number(raw) < Number(phiCaiMay)) return toast.alert(`Phí bán niêm yết loại phí "${f.name}" phải ≥ phí cài máy (chênh bán không được âm).`, 'Giá trị không hợp lệ');
      sellQuotes.push({ feeTypeId: f.id, phiBan: Number(raw) });
    }
    if (!effectiveFrom) return toast.alert('Vui lòng chọn ngày hiệu lực.', 'Thiếu thông tin');
    setBusy(true);
    const res = await window.api.feeRateSet({ partnerId: Number(partnerId), cardTypeId: Number(cardTypeId), phiMua: Number(phiMua), phiCaiMay: Number(phiCaiMay), effectiveFrom: new Date(effectiveFrom + 'T00:00:00').toISOString(), sellQuotes });
    setBusy(false);
    if (res.ok) { toast.success('Đã lưu biểu phí'); onSaved(); }
    else toast.alert(res.message ?? 'Lưu biểu phí thất bại', 'Không lưu được');
  }

  return (
    <Modal title={isEdit ? `Sửa biểu phí — ${existing?.partnerName} · ${existing?.cardTypeName}` : 'Đặt biểu phí mới'} onClose={onClose} width="max-w-xl" onSubmit={() => void save()}>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Đối tác" required><select className={inputCls} value={partnerId} disabled={isEdit} onChange={(e) => { setPartnerId(e.target.value); setBankId(''); setCardTypeId(''); }}><option value="">— Chọn đối tác —</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
        <Field label="Ngân hàng" required hint="Ngân hàng đã liên kết đối tác"><select className={inputCls} value={bankId} disabled={isEdit || !partnerId} onChange={(e) => { setBankId(e.target.value); setCardTypeId(''); }}><option value="">— Chọn ngân hàng —</option>{availBanks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></Field>
        <Field label="Loại thẻ" required><select className={inputCls} value={cardTypeId} disabled={isEdit || !bankId} onChange={(e) => setCardTypeId(e.target.value)}><option value="">— Chọn loại thẻ —</option>{cards.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
      </div>
      {/* FIX 2 — hướng dẫn thoát dead-end thay vì kẹt "Vui lòng chọn…" */}
      {!isEdit && partnerId && availBanks.length === 0 && (
        <p className="mt-2 text-xs font-medium text-warning">Đối tác này chưa liên kết ngân hàng nào — vào tab <b>Đối tác</b> › nút <b>Liên kết ngân hàng</b> để thêm, rồi mở lại form này.</p>
      )}
      {!isEdit && bankId && cards.length === 0 && (
        <p className="mt-2 text-xs font-medium text-warning">Ngân hàng đã chọn chưa có loại thẻ nào — thêm ở <b>Cấu hình ngân hàng › Loại thẻ</b> trước, rồi mở lại form này.</p>
      )}
      <div className="mt-4 grid grid-cols-3 gap-4">
        <Field label="Phí mua (%)" required hint="1 giá cố định"><input className={inputCls} inputMode="decimal" value={phiMua} onChange={(e) => setPhiMua(e.target.value)} placeholder="1.02" /></Field>
        <Field label="Phí cài máy (%)" required hint="1 giá cố định"><input className={inputCls} inputMode="decimal" value={phiCaiMay} onChange={(e) => setPhiCaiMay(e.target.value)} placeholder="1.03" /></Field>
        <Field label="Ngày hiệu lực từ" required hint="Kỳ giá áp dụng cho GD có ngày ≥ mốc này"><input type="date" className={inputCls} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></Field>
      </div>
      <div className="mt-4">
        <div className="mb-1 text-sm font-medium text-slate-700">Phí bán niêm yết theo loại phí <span className="text-danger">*</span></div>
        <p className="mb-2 text-xs text-slate-400">Loại phí CHỈ đổi phí bán — mỗi loại phí một % niêm yết. Chênh lệch với Khách hàng = phí bán − phí cài máy.</p>
        {feeTypes.length === 0 ? (
          <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-slate-600">Chưa có loại phí bán nào — thêm ở tab <b>Loại phí</b> trước.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {feeTypes.map((f) => {
              const raw = quotes[f.id] ?? '';
              const clKh = raw !== '' && phiCaiMay !== '' ? Number(raw) - Number(phiCaiMay) : null;
              return (
                <div key={f.id} className="rounded-lg border border-line bg-appbg/40 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">{f.name}</span>
                    <span className="text-xs text-slate-400">CL KH {clKh === null ? '—' : <CL v={clKh} />}</span>
                  </div>
                  <input className={inputCls} inputMode="decimal" value={raw} onChange={(e) => setQuotes((s) => ({ ...s, [f.id]: e.target.value }))} placeholder="1.05" />
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="mt-4 flex gap-6 rounded-lg bg-appbg px-4 py-3 text-sm">
        <div>Chênh lệch với Nhà cung cấp: {clNcc === null ? <span className="text-slate-400">—</span> : <CL v={clNcc} />} <span className="text-xs text-slate-400">(phí mua − phí cài máy)</span></div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}>Lưu biểu phí</Button>
      </div>
    </Modal>
  );
}
