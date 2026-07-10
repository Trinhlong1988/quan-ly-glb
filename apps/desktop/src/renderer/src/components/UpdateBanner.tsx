import { useEffect, useState } from 'react';
import { Download, RefreshCw, CheckCircle2, AlertTriangle, X, Loader2 } from 'lucide-react';
import type { UpdateBootResult } from '../../../preload/index.d';

// G11 — Banner cập nhật tích hợp (điều phối luồng 5 bước Mr.Long chốt).
// - "có bản mới" + [Cập nhật ngay]/[Để sau]  → thanh % khi tải
// - tải xong → modal cảnh báo "lưu công việc" (M5) → cài + tự mở lại
// - sau mở lại: PULL bootResult (H2) → thông báo THÀNH CÔNG (version + ngày) hoặc LỖI + [Cập nhật lại]
// - listener cleanup lúc unmount (M8)

/** Định dạng ISO → "dd/mm/yyyy HH:mm" (chuẩn VN, không toLocaleString). */
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type Phase = 'idle' | 'available' | 'downloading' | 'error';

export function UpdateBanner(): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('idle');
  const [version, setVersion] = useState('');
  const [percent, setPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [downloadedVersion, setDownloadedVersion] = useState<string | null>(null);
  const [boot, setBoot] = useState<UpdateBootResult | null>(null);
  const [bootDismissed, setBootDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    // [H2] PULL kết quả cập nhật lần khởi động này (không nghe push — push rơi trước mount).
    window.api.getUpdateBootResult().then((r) => {
      if (alive && r) setBoot(r);
    });

    // Đăng ký sự kiện realtime — mỗi hàm trả về unsubscribe (M8).
    const offAvail = window.api.onUpdateAvailable((p) => {
      setVersion(p.version);
      setErrorMsg('');
      setPhase('available');
    });
    const offProg = window.api.onDownloadProgress((p) => {
      setPercent(Math.max(0, Math.min(100, Math.round(p.percent))));
      setPhase('downloading');
    });
    const offDone = window.api.onUpdateDownloaded((p) => {
      setDownloadedVersion(p.version);
      setPhase('idle');
    });
    const offErr = window.api.onUpdateError((p) => {
      setErrorMsg(p.message);
      setPhase('error');
    });

    return () => {
      alive = false;
      offAvail();
      offProg();
      offDone();
      offErr();
    };
  }, []);

  const doStart = (): void => {
    setPercent(0);
    setPhase('downloading');
    void window.api.startUpdate();
  };
  const doRetry = (): void => {
    setErrorMsg('');
    setPhase('idle');
    void window.api.checkUpdate();
  };
  const doInstall = (): void => {
    void window.api.installUpdateNow();
  };

  // ── Modal "đã tải xong — cảnh báo lưu công việc" (M5 no-data-loss) ──
  if (downloadedVersion !== null) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-center gap-3 bg-brand px-6 py-4 text-white">
            <Download className="h-6 w-6 shrink-0" />
            <h3 className="text-lg font-bold">Đã tải xong bản cập nhật</h3>
          </div>
          <div className="px-6 py-5">
            <p className="text-[15px] leading-relaxed text-slate-700">
              Bản cập nhật <span className="font-semibold">v{downloadedVersion}</span> đã sẵn sàng. Ứng dụng sẽ
              <span className="font-semibold"> đóng để cài đặt</span> rồi tự mở lại. Vui lòng
              <span className="font-semibold text-danger"> lưu công việc đang làm dở</span> trước khi tiếp tục.
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
            <button
              onClick={() => setDownloadedVersion(null)}
              className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-appbg"
            >
              Để sau
            </button>
            <button
              onClick={doInstall}
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-hover"
            >
              Cài đặt &amp; khởi động lại
            </button>
          </div>
        </div>
      </div>
    );
  }

  const showBoot = boot && !bootDismissed;
  const showFlow = phase !== 'idle';
  if (!showBoot && !showFlow) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-3">
      {/* Kết quả cập nhật lần khởi động (bước 6/7) */}
      {showBoot && boot.kind === 'success' && (
        <div className="pointer-events-auto flex items-start gap-3 rounded-xl border border-success/30 bg-white px-4 py-3 shadow-lg">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-800">Đã cập nhật thành công</p>
            <p className="mt-0.5 text-sm text-slate-600">
              Phiên bản <span className="font-semibold">v{boot.version}</span> — lúc {fmtDateTime(boot.at)}
            </p>
          </div>
          <button onClick={() => setBootDismissed(true)} className="text-slate-400 transition hover:text-slate-600" title="Đóng">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {showBoot && boot.kind === 'failed' && (
        <div className="pointer-events-auto flex items-start gap-3 rounded-xl border border-danger/30 bg-white px-4 py-3 shadow-lg">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-danger" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-800">Cập nhật thất bại</p>
            <p className="mt-0.5 text-sm text-slate-600">
              Chưa cài được bản <span className="font-semibold">v{boot.targetVersion}</span> — vẫn đang chạy v{boot.fromVersion}.
            </p>
            <button
              onClick={() => {
                setBootDismissed(true);
                void window.api.checkUpdate();
              }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-hover"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Cập nhật lại
            </button>
          </div>
          <button onClick={() => setBootDismissed(true)} className="text-slate-400 transition hover:text-slate-600" title="Đóng">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Có bản mới (bước 2) */}
      {phase === 'available' && (
        <div className="pointer-events-auto flex items-start gap-3 rounded-xl border border-brand/30 bg-white px-4 py-3 shadow-lg">
          <Download className="mt-0.5 h-6 w-6 shrink-0 text-brand" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-800">Có bản cập nhật mới</p>
            <p className="mt-0.5 text-sm text-slate-600">
              Hệ thống có bản <span className="font-semibold">v{version}</span>. Cập nhật để nhận tính năng mới nhất.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={doStart}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-hover"
              >
                <Download className="h-3.5 w-3.5" /> Cập nhật ngay
              </button>
              <button
                onClick={() => setPhase('idle')}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-appbg"
              >
                Để sau
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Đang tải — thanh % (bước 3) */}
      {phase === 'downloading' && (
        <div className="pointer-events-auto flex items-start gap-3 rounded-xl border border-brand/30 bg-white px-4 py-3 shadow-lg">
          <Loader2 className="mt-0.5 h-6 w-6 shrink-0 animate-spin text-brand" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-800">Đang tải bản cập nhật… {percent}%</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-appbg">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Lỗi + [Cập nhật lại] (bước 7) */}
      {phase === 'error' && (
        <div className="pointer-events-auto flex items-start gap-3 rounded-xl border border-danger/30 bg-white px-4 py-3 shadow-lg">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-danger" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-800">Cập nhật thất bại</p>
            <p className="mt-0.5 text-sm text-slate-600">{errorMsg}</p>
            <button
              onClick={doRetry}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-hover"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Cập nhật lại
            </button>
          </div>
          <button onClick={() => setPhase('idle')} className="text-slate-400 transition hover:text-slate-600" title="Đóng">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
