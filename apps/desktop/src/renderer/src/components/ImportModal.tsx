// PHASE IMPORT (#9) — Cụm nút + modal Nhập liệu hàng loạt từ Excel. Tái dùng cho 6 entity qua prop
// `entityKey` + `label`. Luồng AN TOÀN (D-IMP4, FIX 1): Tải mẫu → điền → chọn file → **XEM TRƯỚC
// (dry-run, KHÔNG tạo gì)** → bấm "Nhập N dòng hợp lệ" → mới tạo THẬT → hiện kết quả + báo cáo lỗi.
// Không tạo bản ghi nào trước khi người dùng xác nhận (chống nhân đôi phiếu tài chính khi import lại).
// UI đồng bộ Catppuccin (nút xanh confirm cùng cụm Xuất Excel, hover:brightness-110 chuẩn Button).
import { useRef, useState } from 'react';
import { Upload, FileDown, Loader2, CheckCircle2, XCircle, FileSpreadsheet } from 'lucide-react';
import { Modal } from './Modal.js';
import { Button } from './Button.js';
import { useToast } from '../lib/toast.js';
import { downloadTemplate, parseWorkbook } from '../lib/excelImport.js';
import { exportCsv } from '../lib/exportCsv.js';
import type { ImportRowResult } from '../../../preload/index.d';

interface PreviewRow { rowIndex: number; ok: boolean; error?: string; message?: string }

export function ImportButton({ entityKey, label, onImported }: { entityKey: string; label: string; onImported: () => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  // R45: nút xuất MẪU RỖNG hiện NGAY ở thanh công cụ (không phải mở modal Nhập mới thấy).
  async function handleTemplate(): Promise<void> {
    const res = await window.api.importTemplate(entityKey);
    if (!res.ok || !res.data) return toast.alert(res.message ?? 'Không lấy được mẫu nhập.', 'Lỗi tải mẫu');
    await downloadTemplate(res.data, `Mẫu nhập ${label.toLowerCase()}`);
  }
  return (
    <>
      <Button variant="soft" icon={<FileDown className="h-4 w-4" />} onClick={handleTemplate}>Xuất mẫu (rỗng)</Button>
      <Button variant="confirm" icon={<Upload className="h-4 w-4" />} onClick={() => setOpen(true)}>Nhập Excel</Button>
      {open && <ImportModal entityKey={entityKey} label={label} onClose={() => setOpen(false)} onImported={onImported} />}
    </>
  );
}

function ImportModal({ entityKey, label, onClose, onImported }: { entityKey: string; label: string; onClose: () => void; onImported: () => void }): JSX.Element {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  // Giai đoạn: 'pick' (chưa có file) → 'preview' (dry-run xong, chờ xác nhận) → 'done' (đã nhập thật).
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [preview, setPreview] = useState<{ results: PreviewRow[]; validCount: number; invalidCount: number } | null>(null);
  const [runResults, setRunResults] = useState<ImportRowResult[] | null>(null);
  const [runSummary, setRunSummary] = useState<{ created: number; skipped: number } | null>(null);

  async function handleTemplate(): Promise<void> {
    const res = await window.api.importTemplate(entityKey);
    if (!res.ok || !res.data) return toast.alert(res.message ?? 'Không lấy được mẫu nhập.', 'Lỗi tải mẫu');
    // downloadTemplate tự lưu qua hộp thoại + hỏi "Mở / Không mở" (không cần toast thêm, tránh chồng thông báo).
    await downloadTemplate(res.data, `Mẫu nhập ${label.toLowerCase()}`);
  }

  function resetState(): void {
    setRows(null);
    setPreview(null);
    setRunResults(null);
    setRunSummary(null);
  }

  // Bước 1: chọn file → parse → DRY-RUN (KHÔNG tạo) → hiện bảng xem trước.
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ''; // cho phép chọn lại cùng file
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    resetState();
    const parsed = await parseWorkbook(file);
    if (!parsed.ok || !parsed.rows) {
      setBusy(false);
      return toast.alert(parsed.error ?? 'Không đọc được file.', 'Lỗi đọc Excel');
    }
    const dry = await window.api.importDryRun(entityKey, parsed.rows);
    setBusy(false);
    if (!dry.ok) return toast.alert(dry.message ?? 'Không kiểm tra được file.', 'Không xem trước được');
    setRows(parsed.rows);
    setPreview({ results: dry.results ?? [], validCount: dry.summary?.validCount ?? 0, invalidCount: dry.summary?.invalidCount ?? 0 });
  }

  // Bước 2: người dùng xác nhận → NHẬP THẬT (chỉ khi có ≥1 dòng hợp lệ).
  async function handleConfirm(): Promise<void> {
    if (!rows || !preview || preview.validCount === 0) return;
    setBusy(true);
    const res = await window.api.importRun(entityKey, rows);
    setBusy(false);
    if (!res.ok) return toast.alert(res.message ?? 'Nhập thất bại.', 'Không nhập được');
    setRunResults(res.results ?? []);
    setRunSummary(res.summary ?? { created: 0, skipped: 0 });
    setPreview(null);
    if ((res.summary?.created ?? 0) > 0) {
      toast.success(`Đã nhập ${res.summary?.created} dòng ${label}.`);
      onImported();
    }
  }

  function downloadErrorReport(source: { rowIndex: number; error?: string; message?: string; ok: boolean }[]): void {
    const failed = source.filter((r) => !r.ok);
    if (failed.length === 0) return;
    exportCsv(
      `loi_nhap_${entityKey}`,
      ['Dòng', 'Lỗi', 'Chi tiết'],
      failed.map((r) => [r.rowIndex, r.error ?? '', r.message ?? '']),
      `Báo cáo dòng lỗi — ${label}`
    );
  }

  return (
    <Modal title={`Nhập ${label} từ Excel`} onClose={onClose} width="max-w-2xl">
      <div className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>Bấm <b>Tải mẫu nhập</b> để lấy file Excel đúng cột.</li>
          <li>Điền dữ liệu (mỗi dòng 1 bản ghi). Cột khóa ngoại điền <b>tên hoặc mã</b>. Ô ngày gõ <b>dạng chữ dd/mm/yyyy</b> (tránh lệch định dạng ngày US/VN).</li>
          <li>Bấm <b>Nhập từ Excel</b> → hệ thống <b>kiểm tra trước</b> (chưa tạo gì) → xem lại rồi bấm <b>Nhập N dòng hợp lệ</b> để tạo thật.</li>
        </ol>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="soft" icon={<FileDown className="h-4 w-4" />} onClick={handleTemplate}>Tải mẫu nhập</Button>
          <Button variant="confirm" icon={busy && !preview ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy && !preview && !runResults ? 'Đang kiểm tra…' : 'Nhập từ Excel'}
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
          {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
        </div>

        {/* ── Giai đoạn XEM TRƯỚC (dry-run): chưa tạo gì ── */}
        {preview && (
          <>
            <div className="rounded-lg border border-line bg-appbg/40 p-3">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="font-medium text-slate-600">Xem trước (chưa tạo):</span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-success"><CheckCircle2 className="h-4 w-4" /> Hợp lệ: {preview.validCount}</span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-danger"><XCircle className="h-4 w-4" /> Lỗi: {preview.invalidCount}</span>
                {preview.invalidCount > 0 && (
                  <button onClick={() => downloadErrorReport(preview.results)} className="ml-auto text-xs font-medium text-brand underline hover:brightness-110">Tải báo cáo dòng lỗi</button>
                )}
              </div>
            </div>
            <ResultTable rows={preview.results.map((r) => ({ rowIndex: r.rowIndex, ok: r.ok, detail: r.ok ? 'Hợp lệ' : (r.message ?? r.error ?? 'Lỗi không rõ') }))} />
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="neutral" onClick={onClose}>Hủy</Button>
              <Button variant="confirm" disabled={busy || preview.validCount === 0} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} onClick={handleConfirm}>
                Nhập {preview.validCount} dòng hợp lệ
              </Button>
            </div>
          </>
        )}

        {/* ── Giai đoạn KẾT QUẢ (đã tạo thật) ── */}
        {runResults && runSummary && (
          <>
            <div className="rounded-lg border border-line bg-appbg/40 p-3">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold text-success"><CheckCircle2 className="h-4 w-4" /> Đã tạo: {runSummary.created}</span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-danger"><XCircle className="h-4 w-4" /> Bỏ qua (lỗi): {runSummary.skipped}</span>
                {runSummary.skipped > 0 && (
                  <button onClick={() => downloadErrorReport(runResults)} className="ml-auto text-xs font-medium text-brand underline hover:brightness-110">Tải báo cáo dòng lỗi</button>
                )}
              </div>
            </div>
            <ResultTable rows={runResults.map((r) => ({ rowIndex: r.rowIndex, ok: r.ok, detail: r.ok ? `Đã tạo #${r.id}` : (r.message ?? r.error ?? 'Lỗi không rõ') }))} />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="neutral" onClick={onClose}>Đóng</Button>
            </div>
          </>
        )}

        {!preview && !runResults && (
          <div className="flex justify-end pt-1">
            <Button variant="neutral" onClick={onClose}>Đóng</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResultTable({ rows }: { rows: { rowIndex: number; ok: boolean; detail: string }[] }): JSX.Element {
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[#F8FAFC] text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="w-16 px-3 py-2">Dòng</th>
            <th className="w-24 px-3 py-2">Kết quả</th>
            <th className="px-3 py-2">Chi tiết</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.rowIndex} className={r.ok ? '' : 'bg-danger/5'}>
              <td className="px-3 py-1.5 text-slate-500">{r.rowIndex}</td>
              <td className="px-3 py-1.5">
                {r.ok
                  ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" /> OK</span>
                  : <span className="inline-flex items-center gap-1 text-danger"><XCircle className="h-3.5 w-3.5" /> Lỗi</span>}
              </td>
              <td className="px-3 py-1.5 text-slate-600">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
