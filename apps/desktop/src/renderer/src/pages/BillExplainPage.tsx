// Bill giải trình (Mr.Long 16/7) — 3 tab: Tạo bill · Theo dõi · Thư viện sản phẩm.
// Tạo bill: chọn HKD (hồ sơ) + TID (chỉ theo dõi, KHÔNG in) + ngành → nhập NHIỀU số tiền trực tiếp (add/xóa dòng)
// hoặc import danh sách số tiền → XÁC NHẬN trước khi sinh → xuất .xlsx → mở file. Người bán = chủ hộ HKD.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Plus, Trash2, Loader2, Download, Upload, FileUp, FolderKanban, FolderOpen, ListChecks, Play, X, Pencil, RefreshCw, FileCog } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission, fmtDate, groupDigits } from '@glb/shared';
import type { ProductDto, BillExplainDto, IndustryDto, DossierDto, ConfigTidDto, BillExplainConfigDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Modal } from '../components/Modal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Field, inputCls } from '../components/Field.js';
import { Button } from '../components/Button.js';
import { SearchSelect } from '../components/SearchSelect.js';
import { TabBar, TabButton } from '../components/Tabs.js';
import { StatBar } from '../components/StatBar.js';
import { useRowSelection, SelectionBar, SelectAllCell, SelectCell } from '../components/Selection.js';
import { parseWorkbook, downloadTemplate } from '../lib/excelImport.js';

/** VND, nhóm 3 số bằng dấu chấm. Nhận number hoặc bigint (số tiền có thể lớn — không ép Number mất chữ số). */
function money(n: number | bigint): string {
  const v = typeof n === 'bigint' ? (n < 0n ? -n : n) : Math.abs(Math.round(n));
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function BillExplainPage({ user }: { user: AuthUser }): JSX.Element {
  const canCreate = hasPermission(user, 'BILLEXPLAIN_CREATE');
  const canManageProduct = hasPermission(user, 'PRODUCT_MANAGE');
  const canDelete = hasPermission(user, 'BILLEXPLAIN_DELETE');
  const [tab, setTab] = useState<'create' | 'track' | 'library'>(canCreate ? 'create' : 'track');
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Bill Giải Trình</h2>
        <p className="text-sm text-slate-500">Sinh hóa đơn giải trình số tiền theo HKD · ngành nghề · thư viện sản phẩm riêng.</p>
      </div>
      <TabBar>
        {canCreate && <TabButton active={tab === 'create'} onClick={() => setTab('create')} icon={<Play className="h-4 w-4" />}>Tạo bill</TabButton>}
        <TabButton active={tab === 'track'} onClick={() => setTab('track')} icon={<ListChecks className="h-4 w-4" />}>Theo dõi</TabButton>
        <TabButton active={tab === 'library'} onClick={() => setTab('library')} icon={<FolderKanban className="h-4 w-4" />}>Thư viện sản phẩm</TabButton>
      </TabBar>
      {tab === 'create' && canCreate && <CreateBillTab />}
      {tab === 'track' && <TrackTab canDelete={canDelete} />}
      {tab === 'library' && <LibraryTab canManage={canManageProduct} />}
    </div>
  );
}

// ═══ TAB 1 — TẠO BILL ═══════════════════════════════════════════════════════════
function CreateBillTab(): JSX.Element {
  const toast = useToast();
  const [dossiers, setDossiers] = useState<DossierDto[]>([]);
  const [tids, setTids] = useState<ConfigTidDto[]>([]);
  const [industries, setIndustries] = useState<IndustryDto[]>([]);
  const [cfg, setCfg] = useState<BillExplainConfigDto | null>(null);

  const [dossierId, setDossierId] = useState('');
  const [tidId, setTidId] = useState('');
  const [industryId, setIndustryId] = useState('');
  const [billDate, setBillDate] = useState(todayISO());
  const [amounts, setAmounts] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ id: number; file: string; totalBills: number; errors?: { index: number; target: number; error: string }[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try { // FE53-05: 1 IPC reject KHÔNG được để unhandled + selector trống câm lặng.
        const [d, t, i, c] = await Promise.all([window.api.dossierList({}), window.api.tidConfigList({}), window.api.industryList({ active: true }), window.api.billExplainConfig()]);
        if (d.ok && d.data) setDossiers(d.data);
        if (t.ok && t.data) setTids(t.data);
        if (i.ok && i.data) setIndustries(i.data);
        if (c.ok && c.data) setCfg(c.data);
      } catch (err) {
        toast.alert(err instanceof Error ? err.message : 'Không tải được dữ liệu cho trang.', 'Lỗi tải');
      }
    })();
  }, [toast]);

  // FE53-04: GỬI chuỗi chữ số RAW (không qua Number ở FE → không mất chữ số); backend parse STRICT.
  const validRawAmounts = useMemo(() => amounts.map((a) => a.replace(/[^\d]/g, '').replace(/^0+/, '')).filter((s) => s !== ''), [amounts]);
  const validAmounts = validRawAmounts; // dùng cho đếm; tổng tính bằng BigInt bên dưới
  const total = validRawAmounts.reduce((s, n) => s + BigInt(n), 0n);
  const dossier = dossiers.find((d) => String(d.id) === dossierId);
  const industry = industries.find((i) => String(i.id) === industryId);

  function setAmountAt(idx: number, v: string): void {
    setAmounts((prev) => prev.map((a, i) => (i === idx ? v.replace(/[^\d]/g, '') : a)));
  }
  function addAmount(): void { setAmounts((prev) => [...prev, '']); }
  function removeAmount(idx: number): void { setAmounts((prev) => (prev.length <= 1 ? [''] : prev.filter((_, i) => i !== idx))); }

  async function onImportAmounts(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const res = await parseWorkbook(file);
    if (!res.ok || !res.rows) { toast.alert(res.error ?? 'Không đọc được file.', 'Lỗi đọc file'); return; }
    // Lấy CỘT SỐ TIỀN: ưu tiên header chứa "tiền"/"số tiền"/"amount"; nếu không có → cột số đầu tiên.
    const nums: string[] = [];
    for (const row of res.rows) {
      const keys = Object.keys(row);
      const moneyKey = keys.find((k) => /tiền|so tien|amount|thành tiền/i.test(k)) ?? keys.find((k) => Number(String(row[k]).replace(/[^\d]/g, '')) > 0);
      if (!moneyKey) continue;
      const n = Number(String(row[moneyKey]).replace(/[^\d]/g, ''));
      if (Number.isFinite(n) && n > 0) nums.push(String(n));
    }
    if (!nums.length) { toast.alert('File không có số tiền hợp lệ.', 'Không có dữ liệu'); return; }
    setAmounts((prev) => { const base = prev.filter((a) => a.trim()); return [...base, ...nums]; });
    toast.success(`Đã nạp ${nums.length} số tiền từ file.`);
  }

  function openConfirm(): void {
    if (!dossierId) { toast.alert('Chọn Hộ Kinh Doanh.', 'Thiếu thông tin'); return; }
    if (!industryId) { toast.alert('Chọn nhóm ngành nghề.', 'Thiếu thông tin'); return; }
    if (!validAmounts.length) { toast.alert('Nhập ít nhất 1 số tiền cần giải trình.', 'Thiếu số tiền'); return; }
    setConfirm(true);
  }
  async function doGenerate(): Promise<void> {
    setConfirm(false);
    setBusy(true);
    setResult(null);
    try {
      const res = await window.api.billExplainGenerate({ dossierId: Number(dossierId), tidId: tidId ? Number(tidId) : null, industryId: Number(industryId), billDate, targets: validRawAmounts });
      if (res.ok && res.file) {
        setResult({ id: res.id!, file: res.file, totalBills: res.totalBills ?? 0, errors: res.errors });
        toast.success(`Đã sinh ${res.totalBills} bill.`);
        const c = await window.api.billExplainConfig();
        if (c.ok && c.data) setCfg(c.data);
      } else {
        toast.alert(res.message ?? 'Sinh bill thất bại.', 'Lỗi sinh bill');
      }
    } catch (err) {
      toast.alert(err instanceof Error ? err.message : 'Lỗi kết nối máy chủ.', 'Lỗi');
    } finally {
      setBusy(false);
    }
  }
  async function openResultFile(): Promise<void> {
    if (!result) return;
    const o = await window.api.billExplainOpenFile(result.id);
    if (!o.ok) toast.alert(o.message ?? 'Không mở được file.', 'Không mở được file');
  }
  async function openResultFolder(): Promise<void> {
    const o = await window.api.billExplainOpenFolder();
    if (!o.ok) toast.alert(o.message ?? 'Không mở được thư mục.', 'Không mở được thư mục');
  }

  const dossierOptions = dossiers.map((d) => ({ value: String(d.id), label: `${d.hkdName}${d.taxCode ? ' · ' + d.taxCode : ''}` }));
  const tidOptions = tids.map((t) => ({ value: String(t.id), label: `${t.tid}${t.hkdName ? ' · ' + t.hkdName : ''}` }));
  const industryOptions = industries.map((i) => ({ value: String(i.id), label: i.name }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 rounded-xl border border-line bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Hộ Kinh Doanh" required><SearchSelect value={dossierId} onChange={setDossierId} options={dossierOptions} placeholder="— Chọn HKD —" /></Field>
          <Field label="Ngành nghề" required><SearchSelect value={industryId} onChange={setIndustryId} options={industryOptions} placeholder="— Chọn ngành —" /></Field>
          <Field label="TID (chỉ để theo dõi, không in lên hóa đơn)"><SearchSelect value={tidId} onChange={setTidId} options={tidOptions} placeholder="— Không gắn TID —" /></Field>
          <Field label="Ngày hóa đơn"><input type="date" className={inputCls} value={billDate} onChange={(e) => setBillDate(e.target.value)} /></Field>
        </div>
        {dossier && (
          <div className="mt-2 rounded-lg bg-appbg px-3 py-2 text-xs text-slate-500">
            Người bán (chủ hộ): <span className="font-medium text-slate-700">{dossier.ownerName || '—'}</span> · Địa chỉ: <span className="text-slate-600">{dossier.hkdAddress || '—'}</span>
          </div>
        )}

        <div className="mt-4 mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-700">Số tiền cần giải trình <span className="text-slate-400">({validAmounts.length} bill)</span></div>
          <div className="flex gap-2">
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1 rounded-md bg-brand/10 px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-brand/20"><FileUp className="h-4 w-4" /> Nhập từ file</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onImportAmounts} />
            <button onClick={addAmount} className="flex items-center gap-1 rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium text-white hover:brightness-110"><Plus className="h-4 w-4" /> Thêm số tiền</button>
          </div>
        </div>
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {amounts.map((a, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="w-7 text-right text-xs text-slate-400">{idx + 1}.</span>
              <input className={inputCls + ' text-right tabular-nums'} inputMode="numeric" value={groupDigits(a)} onChange={(e) => setAmountAt(idx, e.target.value)} placeholder="0" />
              <span className="text-xs text-slate-400">đ</span>
              <button onClick={() => removeAmount(idx)} title="Xóa dòng" className="rounded-md p-1.5 text-danger hover:bg-danger/10"><X className="h-4 w-4" /></button>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
          <div className="text-sm text-slate-600">Tổng: <span className="text-lg font-bold text-brand tabular-nums">{money(total)}</span></div>
          <Button variant="confirm" icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} onClick={openConfirm} disabled={busy}>Sinh bill</Button>
        </div>
      </div>

      {/* Cột phải: template + kết quả */}
      <div className="space-y-4">
        <TemplatePanel cfg={cfg} onChanged={async () => { const c = await window.api.billExplainConfig(); if (c.ok && c.data) setCfg(c.data); }} />
        {result && (
          <div className="rounded-xl border border-success/30 bg-success/5 p-4 shadow-sm">
            <div className="mb-1 text-sm font-semibold text-success">Đã sinh {result.totalBills} bill</div>
            <div className="mb-2 break-all text-xs text-slate-500">{result.file}</div>
            {result.errors && result.errors.length > 0 && (
              <div className="mb-2 rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning">{result.errors.length} số tiền không khớp được tổ hợp SP (bỏ qua).</div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="confirm" icon={<FileText className="h-4 w-4" />} onClick={openResultFile}>Mở file</Button>
              <button onClick={openResultFolder} className="flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200"><FolderOpen className="h-4 w-4" /> Mở thư mục</button>
            </div>
          </div>
        )}
      </div>

      {confirm && (
        <Modal title="Xác nhận sinh bill" onClose={() => setConfirm(false)}>
          <div className="space-y-2 text-sm text-slate-600">
            <div>HKD: <span className="font-medium text-slate-800">{dossier?.hkdName}</span></div>
            <div>Ngành nghề: <span className="font-medium text-slate-800">{industry?.name}</span></div>
            <div>Số bill: <span className="font-medium text-slate-800">{validAmounts.length}</span> · Tổng: <span className="font-bold text-brand">{money(total)}</span></div>
            <div>Ngày HĐ: <span className="font-medium text-slate-800">{fmtDate(billDate)}</span></div>
            <div className="rounded-md bg-appbg px-3 py-2 text-xs text-slate-500">Hệ thống sẽ sinh {validAmounts.length} hóa đơn khớp đúng từng số tiền, xuất file Excel.</div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setConfirm(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-appbg">Hủy</button>
            <Button variant="confirm" onClick={doGenerate}>Xác nhận sinh</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TemplatePanel({ cfg, onChanged }: { cfg: BillExplainConfigDto | null; onChanged: () => void }): JSX.Element {
  const toast = useToast();
  async function importTpl(): Promise<void> {
    const res = await window.api.billExplainImportTemplate();
    if (res.ok) { toast.success('Đã đặt mẫu hóa đơn riêng.'); onChanged(); }
    else if (res.error !== 'CANCELLED') toast.alert(res.message ?? 'Import mẫu thất bại.', 'Lỗi');
  }
  async function exportTpl(): Promise<void> {
    const res = await window.api.billExplainExportTemplate();
    if (res.ok && res.file) toast.success('Đã xuất mẫu: ' + res.file);
    else if (res.error !== 'CANCELLED') toast.alert(res.message ?? 'Xuất mẫu thất bại.', 'Lỗi');
  }
  async function resetTpl(): Promise<void> {
    const res = await window.api.billExplainResetTemplate();
    if (res.ok) { toast.success('Đã về mẫu mặc định.'); onChanged(); }
    else toast.alert(res.message ?? 'Lỗi', 'Lỗi');
  }
  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><FileCog className="h-4 w-4 text-brand" /> Mẫu hóa đơn</div>
      <div className="mb-3 text-xs text-slate-500">Đang dùng: <span className="font-medium text-slate-700">{cfg?.templateIsCustom ? 'Mẫu riêng đã import' : 'Mẫu mặc định'}</span></div>
      <div className="flex flex-wrap gap-2">
        <button onClick={importTpl} className="flex items-center gap-1 rounded-md bg-brand/10 px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-brand/20"><Upload className="h-4 w-4" /> Import mẫu</button>
        <button onClick={exportTpl} className="flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200"><Download className="h-4 w-4" /> Xuất mẫu</button>
        {cfg?.templateIsCustom && <button onClick={resetTpl} className="flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200"><RefreshCw className="h-4 w-4" /> Về mặc định</button>}
      </div>
    </div>
  );
}

// ═══ TAB 2 — THEO DÕI ═══════════════════════════════════════════════════════════
function TrackTab({ canDelete }: { canDelete: boolean }): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<BillExplainDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();

  async function reload(): Promise<void> {
    setLoading(true);
    try {
      const res = await window.api.billExplainList({});
      if (res.ok && res.data) setRows(res.data);
      else if (res.message) toast.alert(res.message);
    } catch (e) {
      toast.alert(e instanceof Error ? e.message : 'Không tải được dữ liệu.', 'Lỗi tải');
    } finally {
      sel.clear();
      setLoading(false);
    }
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  async function openFile(id: number): Promise<void> {
    const o = await window.api.billExplainOpenFile(id);
    if (!o.ok) toast.alert(o.message ?? 'Không mở được file.', 'Không mở được file');
  }
  async function openFolder(): Promise<void> {
    const o = await window.api.billExplainOpenFolder();
    if (!o.ok) toast.alert(o.message ?? 'Không mở được thư mục.', 'Không mở được thư mục');
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.billExplainDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} bill.`);
    else toast.alert(res.message ?? 'Xóa thất bại', 'Xóa thất bại');
    setBulkDel(false); await reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} lần sinh bill</div>
        <div className="flex gap-2">
          <button onClick={openFolder} className="flex items-center gap-1 rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200"><FolderOpen className="h-4 w-4" /> Mở thư mục chứa bill</button>
          <button onClick={() => void reload()} className="flex items-center gap-1 rounded-md bg-brand/10 px-3 py-2 text-sm font-medium text-brand hover:bg-brand/20"><RefreshCw className="h-4 w-4" /> Làm mới</button>
        </div>
      </div>
      <StatBar items={[{ label: 'Tổng lần sinh', value: rows.length, tone: 'bg-brand-tint text-brand' }, { label: 'Tổng bill', value: rows.reduce((s, r) => s + r.billCount, 0), tone: 'bg-emerald-500/10 text-emerald-600' }]} />
      {canDelete && <SelectionBar count={sel.count} entityLabel="bill" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm list-scroll">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-20 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {canDelete && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Ngày</th>
              <th className="px-4 py-3">HKD</th>
              <th className="px-4 py-3">Ngành</th>
              <th className="px-4 py-3">TID</th>
              <th className="px-4 py-3 text-right">Tổng tiền</th>
              <th className="px-4 py-3 text-right">Số bill</th>
              <th className="px-4 py-3">Người tạo</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canDelete ? 10 : 9} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canDelete ? 10 : 9} className="px-4 py-10 text-center text-slate-400"><FileText className="mx-auto mb-2 h-6 w-6" /> Chưa có bill nào được sinh.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(r.id) ? 'bg-brand-tint/40' : '')}>
                {canDelete && <SelectCell id={r.id} sel={sel} />}
                <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">{r.code ?? '#' + r.id}</td>
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(r.billDate)}</td>
                <td className="px-4 py-3 text-slate-700">{r.dossierName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{r.industryName ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{r.tidCode ?? '—'}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-700 tabular-nums whitespace-nowrap">{money(r.totalAmount)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{r.billCount}</td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.createdByName ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openFile(r.id)} title="Mở file" className="rounded-md p-1.5 text-brand hover:bg-brand-tint"><FileText className="h-5 w-5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bulkDel && <ConfirmDialog title="Xóa bill đã chọn" message={`Xóa ${sel.count} lần sinh bill khỏi danh sách theo dõi? (File .xlsx trên ổ đĩa KHÔNG bị xóa.)`} confirmLabel="Xóa" danger requirePassword onConfirm={doBulkDelete} onCancel={() => setBulkDel(false)} />}
    </div>
  );
}

// ═══ TAB 3 — THƯ VIỆN SẢN PHẨM ══════════════════════════════════════════════════
function LibraryTab({ canManage }: { canManage: boolean }): JSX.Element {
  const toast = useToast();
  const [industries, setIndustries] = useState<IndustryDto[]>([]);
  const [fIndustry, setFIndustry] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ProductDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; row?: ProductDto } | null>(null);
  const [bulkDel, setBulkDel] = useState(false);
  const sel = useRowSelection();
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadIndustries(): Promise<void> {
    const res = await window.api.industryList({ active: true });
    if (res.ok && res.data) setIndustries(res.data);
  }
  async function reload(): Promise<void> {
    setLoading(true);
    try {
      const res = await window.api.productList({ industryId: fIndustry ? Number(fIndustry) : undefined, search: search.trim() || undefined });
      if (res.ok && res.data) setRows(res.data);
      else if (res.message) toast.alert(res.message);
    } catch (e) {
      toast.alert(e instanceof Error ? e.message : 'Không tải được danh sách sản phẩm.', 'Lỗi tải');
    } finally {
      sel.clear();
      setLoading(false);
    }
  }
  useEffect(() => { void loadIndustries(); }, []);
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [fIndustry]);

  async function onImport(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!fIndustry) { toast.alert('Chọn nhóm ngành nghề trước khi import.', 'Thiếu ngành'); return; }
    const parsed = await parseWorkbook(file);
    if (!parsed.ok || !parsed.rows) { toast.alert(parsed.error ?? 'Không đọc được file.', 'Lỗi đọc file'); return; }
    const rowsMapped = parsed.rows.map((r) => {
      const keys = Object.keys(r);
      const kName = keys.find((k) => /tên mặt hàng|tên hàng|tên sp|tên sản phẩm|tên/i.test(k));
      const kUnit = keys.find((k) => /đvt|đơn vị/i.test(k));
      const kPrice = keys.find((k) => /đơn giá|giá bán|giá/i.test(k));
      return { name: kName ? String(r[kName]) : '', unit: kUnit ? String(r[kUnit]) : '', price: kPrice ? r[kPrice] : '' };
    });
    try {
      const res = await window.api.productImport(Number(fIndustry), rowsMapped);
      if (res.ok) { toast.success(`Đã import ${res.imported ?? 0} SP (bỏ ${res.skipped ?? 0}).`); await reload(); }
      else toast.alert(res.message ?? 'Import thất bại.', 'Lỗi import');
    } catch (err) {
      toast.alert(err instanceof Error ? err.message : 'Import sản phẩm thất bại.', 'Lỗi import');
    }
  }
  function exportEmpty(): void {
    void downloadTemplate([
      { header: 'STT', required: false, kind: 'int' },
      { header: 'Nhóm', required: false, kind: 'text', hint: 'Tên ngành nghề (tham khảo — import theo ngành đang lọc)' },
      { header: 'Tên mặt hàng', required: true, kind: 'text' },
      { header: 'ĐVT', required: true, kind: 'text' },
      { header: 'Đơn giá', required: true, kind: 'money' }
    ], 'Mẫu nhập sản phẩm');
  }
  async function doBulkDelete(password?: string): Promise<void> {
    const res = await window.api.productDelete([...sel.selected], password ?? '');
    if (res.ok) toast.success(`Đã xóa ${res.deleted ?? sel.count} sản phẩm.`);
    else toast.alert(res.message ?? 'Xóa thất bại', 'Xóa thất bại');
    setBulkDel(false); await reload();
  }

  const industryOptions = industries.map((i) => ({ value: String(i.id), label: i.name }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-slate-500">Nhóm ngành nghề
            <select className={inputCls + ' w-56'} value={fIndustry} onChange={(e) => setFIndustry(e.target.value)}>
              <option value="">— Tất cả ngành —</option>
              {industries.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-xs text-slate-500">Tìm sản phẩm
            <input className={inputCls + ' w-48'} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tên / ĐVT…" onKeyDown={(e) => e.key === 'Enter' && reload()} />
          </label>
          <button onClick={() => void reload()} className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:brightness-110">Lọc</button>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button onClick={exportEmpty} className="flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200"><Download className="h-4 w-4" /> Xuất mẫu rỗng</button>
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1 rounded-md bg-brand/10 px-2.5 py-2 text-xs font-medium text-brand hover:bg-brand/20"><FileUp className="h-4 w-4" /> Import SP</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onImport} />
            <Button variant="confirm" icon={<Plus className="h-4 w-4" />} onClick={() => { if (!industries.length) { toast.alert('Cần có ít nhất 1 ngành nghề (Cấu hình ngành nghề).', 'Thiếu ngành'); return; } setForm({ mode: 'create' }); }}>Thêm sản phẩm</Button>
          </div>
        )}
      </div>
      <StatBar items={[{ label: 'Tổng sản phẩm', value: rows.length, tone: 'bg-brand-tint text-brand' }]} />
      {canManage && <SelectionBar count={sel.count} entityLabel="sản phẩm" onClear={sel.clear} onDelete={() => setBulkDel(true)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm list-scroll">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-20 bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {canManage && <SelectAllCell ids={rows.map((r) => r.id)} sel={sel} />}
              <th className="px-4 py-3">Ngành</th>
              <th className="px-4 py-3">Tên sản phẩm</th>
              <th className="px-4 py-3">ĐVT</th>
              <th className="px-4 py-3 text-right">Đơn giá</th>
              <th className="px-4 py-3">Trạng thái</th>
              {canManage && <th className="px-4 py-3 text-right">Thao tác</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && <tr><td colSpan={canManage ? 7 : 5} className="px-4 py-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={canManage ? 7 : 5} className="px-4 py-10 text-center text-slate-400"><FolderKanban className="mx-auto mb-2 h-6 w-6" /> Chưa có sản phẩm. Thêm hoặc import để dùng khi sinh bill.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className={'hover:bg-appbg/60 ' + (sel.isSelected(r.id) ? 'bg-brand-tint/40' : '')}>
                {canManage && <SelectCell id={r.id} sel={sel} />}
                <td className="px-4 py-3 text-slate-600">{r.industryName ?? '—'}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                <td className="px-4 py-3 text-slate-600">{r.unit}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-700 tabular-nums whitespace-nowrap">{money(r.price)}</td>
                <td className="px-4 py-3">
                  <span className={'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' + (r.status === 'ACTIVE' ? 'bg-success/10 text-success' : 'bg-slate-200 text-slate-500')}>{r.status === 'ACTIVE' ? 'Đang dùng' : 'Ngừng dùng'}</span>
                </td>
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setForm({ mode: 'edit', row: r })} title="Sửa" className="rounded-md p-1.5 text-warning hover:bg-warning/10"><Pencil className="h-4 w-4" /></button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <ProductForm mode={form.mode} row={form.row} industries={industries} defaultIndustryId={fIndustry} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); }} />}
      {bulkDel && <ConfirmDialog title="Xóa sản phẩm đã chọn" message={`Xóa ${sel.count} sản phẩm khỏi thư viện?`} confirmLabel="Xóa" danger requirePassword onConfirm={doBulkDelete} onCancel={() => setBulkDel(false)} />}
    </div>
  );
}

function ProductForm({ mode, row, industries, defaultIndustryId, onClose, onSaved }: { mode: 'create' | 'edit'; row?: ProductDto; industries: IndustryDto[]; defaultIndustryId: string; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [industryId, setIndustryId] = useState(row ? String(row.industryId) : defaultIndustryId || (industries[0] ? String(industries[0].id) : ''));
  const [name, setName] = useState(row?.name ?? '');
  const [unit, setUnit] = useState(row?.unit ?? '');
  const [price, setPrice] = useState(row ? String(row.price) : '');
  const [status, setStatus] = useState(row?.status ?? 'ACTIVE');
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    if (!industryId) { toast.alert('Chọn nhóm ngành nghề.', 'Thiếu ngành'); return; }
    if (!name.trim()) { toast.alert('Nhập tên sản phẩm.', 'Thiếu tên'); return; }
    if (!unit.trim()) { toast.alert('Nhập đơn vị tính.', 'Thiếu ĐVT'); return; }
    const p = Number(price.replace(/[^\d]/g, ''));
    if (!Number.isFinite(p) || p <= 0) { toast.alert('Đơn giá phải là số nguyên dương.', 'Đơn giá sai'); return; }
    setSaving(true);
    try {
      const payload = { industryId: Number(industryId), name: name.trim(), unit: unit.trim(), price: p, status };
      const res = mode === 'create'
        ? await window.api.productCreate(payload)
        : await window.api.productUpdate(row!.id, { ...payload, expectedUpdatedAt: row!.updatedAt });
      if (res.ok) { toast.success(mode === 'create' ? 'Đã thêm sản phẩm.' : 'Đã cập nhật.'); onSaved(); }
      else toast.alert(res.message ?? 'Lưu thất bại.', 'Lỗi');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={mode === 'create' ? 'Thêm sản phẩm' : 'Sửa sản phẩm'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nhóm ngành nghề" required>
          <select className={inputCls} value={industryId} onChange={(e) => setIndustryId(e.target.value)}>
            <option value="">— Chọn ngành —</option>
            {industries.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </Field>
        <Field label="Tên sản phẩm" required><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Vé xe khách…" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Đơn vị tính" required><input className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="vé / kg / cái…" /></Field>
          <Field label="Đơn giá (VND)" required><input className={inputCls + ' text-right tabular-nums'} inputMode="numeric" value={groupDigits(price)} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" /></Field>
        </div>
        <Field label="Trạng thái">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ACTIVE">Đang dùng</option>
            <option value="INACTIVE">Ngừng dùng</option>
          </select>
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-appbg">Hủy</button>
        <Button variant="confirm" onClick={save} disabled={saving} icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>{mode === 'create' ? 'Thêm' : 'Lưu'}</Button>
      </div>
    </Modal>
  );
}
