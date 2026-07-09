import { useEffect, useState } from 'react';
import { Image as ImageIcon, Upload, X, Loader2 } from 'lucide-react';
import { useToast } from '../lib/toast.js';
import { Modal } from './Modal.js';
import { Button } from './Button.js';

/** Ảnh thu nhỏ — click phóng to. Đọc file qua IPC (data URL, sandbox không đọc fs trực tiếp). */
export function Thumb({ relPath, label }: { relPath: string; label: string }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    window.api.readAttachment(relPath).then((r) => { if (r.ok && r.dataUrl) setUrl(r.dataUrl); });
  }, [relPath]);
  const isPdf = relPath.toLowerCase().endsWith('.pdf');
  return (
    <>
      <button type="button" title={label} onClick={() => setOpen(true)} className="flex h-8 w-8 items-center justify-center overflow-hidden rounded border border-line bg-appbg hover:ring-2 hover:ring-brand/30">
        {isPdf || !url ? <ImageIcon className="h-4 w-4 text-slate-400" /> : <img src={url} alt={label} className="h-full w-full object-cover" />}
      </button>
      {open && (
        <Modal title={label} onClose={() => setOpen(false)} width="max-w-2xl">
          {isPdf ? <a className="text-brand underline" href={url ?? '#'} target="_blank" rel="noreferrer">Mở PDF</a> : url ? <img src={url} alt={label} className="mx-auto max-h-[70vh] rounded-lg" /> : <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />}
        </Modal>
      )}
    </>
  );
}

/**
 * Ô đính kèm 1 mặt (chọn ảnh mới / xem ảnh hiện có / gỡ).
 * `current` = path ảnh đang lưu (null nếu chưa/đã gỡ). `srcPath` = path file nguồn vừa chọn (chưa lưu).
 */
export function AttachField({ label, current, srcPath, onPick, onClear }: { label: string; current: string | null; srcPath: string | null; onPick: (p: string) => void; onClear: () => void }): JSX.Element {
  const toast = useToast();
  async function pick(): Promise<void> {
    const r = await window.api.pickImage();
    if (r.ok && r.path) onPick(r.path);
    else if (!r.canceled) toast.alert('Không chọn được ảnh.', 'Lỗi');
  }
  const has = srcPath || current;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="flex items-center gap-2">
        <Button variant="neutral" icon={<Upload className="h-4 w-4" />} onClick={pick}>{has ? 'Đổi ảnh' : 'Chọn ảnh'}</Button>
        {srcPath && <span className="truncate text-xs text-success">✓ ảnh mới đã chọn</span>}
        {!srcPath && current && <Thumb relPath={current} label={label} />}
        {has && <button type="button" title="Gỡ ảnh" onClick={onClear} className="rounded p-1 text-danger hover:bg-danger/10"><X className="h-4 w-4" /></button>}
      </div>
    </div>
  );
}
