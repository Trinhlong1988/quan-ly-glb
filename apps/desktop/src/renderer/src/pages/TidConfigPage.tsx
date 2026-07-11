import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, CreditCard, Tag, Download, RefreshCw } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, fmtTime, prereqMessage } from '@glb/shared';
import type { TidConfigStatusDto, ConfigTidDto, ConfigTidInput, BankLite, PartnerDto, RcvAccountDto, DossierSourceDto, FeeRateDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Field, inputCls } from '../components/Field.js';
import { FilterBar } from '../components/FilterBar.js';
import { Button } from '../components/Button.js';
import { useRowSelection, SelectionBar, SelectAllCell, SelectCell } from '../components/Selection.js';
import { exportCsv } from '../lib/exportCsv.js';

type Tab = 'tid' | 'status';

function IconBtn({ children, title, variant, onClick }: { children: JSX.Element; title: string; variant?: 'edit' | 'danger'; onClick: () => void }): JSX.Element {
  const tone = variant === 'danger' ? 'text-danger hover:bg-danger/10' : variant === 'edit' ? 'text-warning hover:bg-warning/10' : 'text-slate-400 hover:bg-brand-tint hover:text-brand';
  return <button title={title} onClick={onClick} className={'rounded-md p-1.5 transition ' + tone}>{children}</button>;
}
const fmtPct = (v: number): string => `${Number(v.toFixed(3))}%`;

export function TidConfigPage({ user }: { user: AuthUser }): JSX.Element {
  const [tab, setTab] = useState<Tab>('tid');
  const canManage = hasPermission(user, 'CONFIG_TID_MANAGE');
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Cấu hình TID</h2>
        <p className="text-sm text-slate-500">Cấu hình TID (ngân hàng · đối tác · biểu phí · HKD · tài khoản nhận tiền · nguồn hồ sơ) · Trạng thái TID.</p>
      </div>
      <div className="mb-3 flex items-center gap-1 border-b border-line">
        <button onClick={() => setTab('tid')} className={'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition ' + (tab === 'tid' ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700')}><CreditCard className="h-4 w-4" /> Cấu hình TID</button>
        <button onClick={() => setTab('status')} className={'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition ' + (tab === 'status' ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700')}><Tag className="h-4 w-4" /> Trạng thái TID</button>
      </div>
      {tab === 'tid' && <TidTab canManage={canManage} />}
      {tab === 'status' && <StatusTab canManage={canManage} />}
    </div>
  );
}

// ── §9a TRẠNG THÁI TID ────────────────────────────────────────────────────────
// PHASE K2: export để trang "Quản Lý TID" hợp nhất (TidPage) tái dùng làm tab "Trạng thái TID cấu hình".
export function StatusTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<TidConfigStatusDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: TidConfigStatusDto } | null>(null);
  const [del, setDel] = useState<TidConfigStatusDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.tidStatusList();
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  async function doDelete(s: TidConfigStatusDto, password?: string): Promise<void> {
    const res = await window.api.tidStatusDelete([s.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa trạng thái ${s.name}`);
    else toast.alert(res.message ?? 'Xóa thất bại', 'Xóa thất bại');
    setDel(null); await reload();
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.tidStatusDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} trạng thái`);
    else toast.alert(res.message ?? 'Xóa thất bại', 'Xóa thất bại');
    setBulkDel(false); await reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} trạng thái · <span className="text-slate-400">ví dụ: mới cấp, thu hồi, đổi cho đối tác</span></div>
        <div className="flex gap-2">
          <button onClick={() => void reload()} title="Tải lại dữ liệu mới nhất (giữ nguyên bộ lọc)" className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"><RefreshCw className="h-4 w-4" /> Làm mới</button>
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('trang_thai_tid', ['Tên trạng thái', 'Người sửa gần nhất', 'Ngày', 'Giờ'], rows.map((s) => [s.name, s.updatedByName ?? s.createdByName ?? '', fmtDate(s.updatedAt), fmtTime(s.updatedAt)]))}>Xuất Excel</Button>
          {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ mode: 'create' })}>Thêm trạng thái</Button>}
        </div>
      </div>
      {canManage && <SelectionBar count={sel.count} entityLabel="trạng thái" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Tên trạng thái</th>
              <th className="px-4 py-3">Người sửa gần nhất</th>
              <th className="px-4 py-3">Ngày</th>
              <th className="px-4 py-3">Giờ</th>
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canManage ? 6 : 4} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canManage ? 6 : 4} className="px-4 py-10 text-center text-slate-400"><Tag className="mx-auto mb-2 h-6 w-6" /> Chưa có trạng thái TID.</td></tr>}
            {!loading && rows.map((s) => (
              <tr key={s.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(s.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={s.id} sel={sel} />}
                <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                <td className="px-4 py-3 text-slate-600">{s.updatedByName ?? s.createdByName ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(s.updatedAt)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmtTime(s.updatedAt)}</td>
                {canManage && (
                  <td className="px-4 py-3"><div className="flex justify-end gap-1">
                    <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: s })}><Pencil className="h-4 w-4" /></IconBtn>
                    <IconBtn title="Xóa" variant="danger" onClick={() => setDel(s)}><Trash2 className="h-4 w-4" /></IconBtn>
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <StatusForm mode={form.mode} row={form.row} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa trạng thái TID" message={`Trạng thái "${del.name}" sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều trạng thái" message={`${sel.count} trạng thái đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

function StatusForm({ mode, row, onClose, onSaved }: { mode: 'create' | 'edit'; row?: TidConfigStatusDto; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [name, setName] = useState(row?.name ?? '');
  const [busy, setBusy] = useState(false);
  async function save(): Promise<void> {
    if (!name.trim()) return toast.alert('Tên trạng thái bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const res = mode === 'edit' && row ? await window.api.tidStatusUpdate(row.id, { name: name.trim() }) : await window.api.tidStatusCreate({ name: name.trim() });
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật trạng thái' : `Đã thêm trạng thái ${name}`); onSaved(); }
    else toast.alert(res.message ?? 'Lưu thất bại', 'Không lưu được');
  }
  return (
    <Modal title={mode === 'edit' ? 'Sửa trạng thái TID' : 'Thêm trạng thái TID'} onClose={onClose} width="max-w-md">
      <Field label="Tên trạng thái" required hint="Ví dụ: mới cấp, thu hồi, đổi cho đối tác"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm trạng thái'}</Button>
      </div>
    </Modal>
  );
}

// ── §9 CẤU HÌNH TID ───────────────────────────────────────────────────────────
function TidTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<ConfigTidDto[]>([]);
  const [banks, setBanks] = useState<BankLite[]>([]);
  const [partners, setPartners] = useState<PartnerDto[]>([]);
  const [accounts, setAccounts] = useState<RcvAccountDto[]>([]);
  const [statuses, setStatuses] = useState<TidConfigStatusDto[]>([]);
  const [dsources, setDsources] = useState<DossierSourceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fPartner, setFPartner] = useState('');
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: ConfigTidDto } | null>(null);
  const [del, setDel] = useState<ConfigTidDto | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function loadRefs(): Promise<void> {
    const [b, p, a, s, d] = await Promise.all([window.api.bankLite(), window.api.partnerList({}), window.api.rcvAccountList({}), window.api.tidStatusList(), window.api.dossierSourceList()]);
    if (b.ok && b.data) setBanks(b.data);
    if (p.ok && p.data) setPartners(p.data);
    if (a.ok && a.data) setAccounts(a.data);
    if (s.ok && s.data) setStatuses(s.data);
    if (d.ok && d.data) setDsources(d.data);
  }
  async function reload(): Promise<void> {
    setLoading(true);
    const res = await window.api.tidConfigList({ search: search || undefined, partnerId: fPartner ? Number(fPartner) : undefined });
    if (res.ok && res.data) setRows(res.data);
    else if (res.message) toast.alert(res.message);
    sel.clear();
    setLoading(false);
  }
  useEffect(() => { void loadRefs(); }, []);
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [fPartner]);

  async function doDelete(t: ConfigTidDto, password?: string): Promise<void> {
    const res = await window.api.tidConfigDelete([t.id], password ?? '');
    if (res.ok) toast.success(`Đã xóa TID ${t.tid}`);
    else toast.alert(res.message ?? 'Xóa TID thất bại', 'Xóa thất bại');
    setDel(null); await reload();
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.tidConfigDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} TID`);
    else toast.alert(res.message ?? 'Xóa TID thất bại', 'Xóa thất bại');
    setBulkDel(false); await reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} TID cấu hình</div>
        <div className="flex gap-2">
          <Button variant="confirm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv('cau_hinh_tid', ['TID', 'Tên HKD', 'Ngân hàng', 'Đối tác', 'Ngày cấp', 'Trạng thái', 'Nguồn hồ sơ', 'TK nhận tiền'], rows.map((r) => [r.tid, r.hkdName, r.bankCode, r.partnerName, r.issuedAt ? fmtDate(r.issuedAt) : '', r.configStatusName, r.dossierSourceCode, r.receiveAccountLabel]))}>Xuất Excel</Button>
          {canManage && <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => { const msg = prereqMessage([{ count: banks.length, label: 'Ngân hàng', where: "tab 'Ngân hàng'" }, { count: partners.length, label: 'Đối tác', where: "tab 'Đối tác'" }]); return msg ? toast.alert(msg, 'Thiếu dữ liệu nền') : setForm({ mode: 'create' }); }}>Thêm TID</Button>}
        </div>
      </div>
      <FilterBar search={search} onSearch={setSearch} searchPlaceholder="Tìm TID / tên HKD…"
        selects={[{ key: 'p', placeholder: 'Tất cả đối tác', value: fPartner, options: partners.map((p) => ({ value: String(p.id), label: p.name })), onChange: setFPartner }]}
        onApply={reload} onReset={() => { setSearch(''); setFPartner(''); setTimeout(reload, 0); }} />
      {canManage && <SelectionBar count={sel.count} entityLabel="TID" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">TID</th>
              <th className="px-4 py-3">Tên HKD</th>
              <th className="px-4 py-3">Ngân hàng</th>
              <th className="px-4 py-3">Đối tác</th>
              <th className="px-4 py-3">Ngày cấp</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Nguồn hồ sơ</th>
              <th className="px-4 py-3">Vòng đời</th>
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canManage ? 10 : 8} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canManage ? 10 : 8} className="px-4 py-10 text-center text-slate-400"><CreditCard className="mx-auto mb-2 h-6 w-6" /> Chưa có TID cấu hình.</td></tr>}
            {!loading && rows.map((t) => (
              <tr key={t.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(t.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={t.id} sel={sel} />}
                <td className="px-4 py-3 font-mono text-xs font-medium text-slate-800">{t.tid}</td>
                <td className="px-4 py-3 text-slate-700">{t.hkdName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{t.bankCode ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{t.partnerName ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{t.issuedAt ? fmtDate(t.issuedAt) : '—'}</td>
                <td className="px-4 py-3">{t.configStatusName ? <span className="rounded bg-brand-tint px-1.5 py-0.5 text-xs font-medium text-brand">{t.configStatusName}</span> : <span className="text-xs text-slate-400">—</span>}</td>
                <td className="px-4 py-3 text-slate-600">{t.dossierSourceCode ?? '—'}</td>
                <td className="px-4 py-3"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t.status}</span></td>
                {canManage && (
                  <td className="px-4 py-3"><div className="flex justify-end gap-1">
                    <IconBtn title="Sửa" variant="edit" onClick={() => setForm({ mode: 'edit', row: t })}><Pencil className="h-4 w-4" /></IconBtn>
                    <IconBtn title="Xóa" variant="danger" onClick={() => setDel(t)}><Trash2 className="h-4 w-4" /></IconBtn>
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <TidForm mode={form.mode} row={form.row} banks={banks} partners={partners} accounts={accounts} statuses={statuses} dsources={dsources} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {del && <ConfirmDialog title="Xóa cấu hình TID" message={`TID "${del.tid}" sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel="Xóa" danger requirePassword onCancel={() => setDel(null)} onConfirm={(pwd) => doDelete(del, pwd)} />}
      {bulkDel && <ConfirmDialog title="Xóa nhiều TID" message={`${sel.count} TID đã chọn sẽ vào Thùng rác (có thể phục hồi). Nhập lại mật khẩu để xác nhận.`} confirmLabel={`Xóa ${sel.count} mục`} danger requirePassword onCancel={() => setBulkDel(false)} onConfirm={(pwd) => doBulkDelete(pwd)} />}
    </div>
  );
}

/** Bảng biểu phí dẫn xuất theo (Đối tác × Ngân hàng) — hiện realtime KỲ ĐANG HIỆU LỰC khi chọn đối tác (§9). */
export function FeePreview({ bankId, partnerId }: { bankId: number; partnerId: number }): JSX.Element {
  const [rows, setRows] = useState<FeeRateDto[] | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    // P1.1: chỉ hiển thị KỲ đang hiệu lực hôm nay của từng loại thẻ (bỏ các kỳ lịch sử/tương lai).
    window.api.feeRateList({ partnerId, bankId }).then((r) => { if (live) setRows(r.ok && r.data ? r.data.filter((x) => x.isCurrent) : []); });
    return () => { live = false; };
  }, [bankId, partnerId]);
  if (rows === null) return <div className="rounded-lg border border-line bg-appbg/50 p-3 text-sm text-slate-400"><Loader2 className="inline h-4 w-4 animate-spin" /> Đang tải biểu phí…</div>;
  if (rows.length === 0) return <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-slate-600">Đối tác này chưa có biểu phí hiệu lực cho ngân hàng đã chọn (cấu hình ở mục Cấu hình phí).</div>;
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full text-xs">
        <thead className="bg-[#F8FAFC] text-left text-slate-500"><tr><th className="px-3 py-2">Loại thẻ</th><th className="px-3 py-2 text-right">Phí mua</th><th className="px-3 py-2 text-right">Phí cài máy</th><th className="px-3 py-2 text-right">Phí bán</th></tr></thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-1.5 font-medium text-slate-700">{r.cardTypeCode ?? r.cardTypeName}</td>
              <td className="px-3 py-1.5 text-right font-mono">{fmtPct(r.phiMua)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{fmtPct(r.phiCaiMay)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{fmtPct(r.phiBan)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TidForm({ mode, row, banks, partners, accounts, statuses, dsources, onClose, onSaved }: { mode: 'create' | 'edit'; row?: ConfigTidDto; banks: BankLite[]; partners: PartnerDto[]; accounts: RcvAccountDto[]; statuses: TidConfigStatusDto[]; dsources: DossierSourceDto[]; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [f, setF] = useState({
    tid: row?.tid ?? '',
    bankId: row?.bankId ? String(row.bankId) : '',
    partnerId: row?.partnerId ? String(row.partnerId) : '',
    hkdName: row?.hkdName ?? '',
    receiveAccountId: row?.receiveAccountId ? String(row.receiveAccountId) : '',
    issuedAt: row?.issuedAt ? row.issuedAt.slice(0, 10) : '',
    configStatusId: row?.configStatusId ? String(row.configStatusId) : '',
    dossierSourceId: row?.dossierSourceId ? String(row.dossierSourceId) : '',
    note: row?.note ?? ''
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>): void => setF({ ...f, [k]: e.target.value });

  async function save(): Promise<void> {
    if (!f.tid.trim()) return toast.alert('Chuỗi TID bắt buộc.', 'Thiếu thông tin');
    if (!f.bankId) return toast.alert('Vui lòng chọn ngân hàng.', 'Thiếu thông tin');
    if (!f.partnerId) return toast.alert('Vui lòng chọn đối tác.', 'Thiếu thông tin');
    if (!f.hkdName.trim()) return toast.alert('Tên Hộ Kinh Doanh bắt buộc.', 'Thiếu thông tin');
    setBusy(true);
    const input: ConfigTidInput = {
      tid: f.tid.trim(),
      bankId: Number(f.bankId),
      partnerId: Number(f.partnerId),
      hkdName: f.hkdName.trim(),
      receiveAccountId: f.receiveAccountId ? Number(f.receiveAccountId) : null,
      issuedAt: f.issuedAt || null,
      configStatusId: f.configStatusId ? Number(f.configStatusId) : null,
      dossierSourceId: f.dossierSourceId ? Number(f.dossierSourceId) : null,
      note: f.note || null
    };
    const res = mode === 'edit' && row ? await window.api.tidConfigUpdate(row.id, input) : await window.api.tidConfigCreate(input);
    setBusy(false);
    if (res.ok) { toast.success(mode === 'edit' ? 'Đã cập nhật TID' : `Đã thêm TID ${f.tid}`); onSaved(); }
    else toast.alert(res.message ?? 'Lưu TID thất bại', 'Không lưu được');
  }

  return (
    <Modal title={mode === 'edit' ? `Sửa cấu hình TID ${row?.tid}` : 'Thêm cấu hình TID'} onClose={onClose} width="max-w-2xl">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Ngân hàng" required><select className={inputCls} value={f.bankId} onChange={set('bankId')} autoFocus><option value="">— Chọn ngân hàng —</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></Field>
        <Field label="Đối tác" required hint="Chọn xong hiện biểu phí bên dưới"><select className={inputCls} value={f.partnerId} onChange={set('partnerId')}><option value="">— Chọn đối tác —</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
      </div>
      {f.bankId && f.partnerId && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Biểu phí (mua / cài máy / bán) của đối tác</div>
          <FeePreview bankId={Number(f.bankId)} partnerId={Number(f.partnerId)} />
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <Field label="Chuỗi TID" required><input className={inputCls} value={f.tid} onChange={set('tid')} /></Field>
        <Field label="Tên Hộ Kinh Doanh" required><input className={inputCls} value={f.hkdName} onChange={set('hkdName')} /></Field>
        <Field label="Tài khoản nhận tiền" hint="Từ nguồn TK nhận tiền – ủy quyền"><select className={inputCls} value={f.receiveAccountId} onChange={set('receiveAccountId')}><option value="">— Chọn TK nhận tiền —</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.accountName} · {a.accountNumber}</option>)}</select></Field>
        <Field label="Ngày cấp TID"><input type="date" className={inputCls} value={f.issuedAt} onChange={set('issuedAt')} /></Field>
        <Field label="Trạng thái TID" hint="Từ cấu hình trạng thái (§9a)"><select className={inputCls} value={f.configStatusId} onChange={set('configStatusId')}><option value="">— Chọn trạng thái —</option>{statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Nguồn hồ sơ" hint="Từ nguồn hồ sơ (§10a)"><select className={inputCls} value={f.dossierSourceId} onChange={set('dossierSourceId')}><option value="">— Chọn nguồn hồ sơ —</option>{dsources.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</select></Field>
      </div>
      <div className="mt-4">
        <Field label="Ghi chú"><textarea className={inputCls} rows={2} value={f.note} onChange={set('note')} /></Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="confirm" onClick={save} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'edit' ? 'Lưu thay đổi' : 'Thêm TID'}</Button>
      </div>
    </Modal>
  );
}
