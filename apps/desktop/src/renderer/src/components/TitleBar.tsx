import { useEffect, useState } from 'react';

// Mr.Long 15/7 — thanh tiêu đề tự vẽ với 3 nút tròn kiểu Mac (đỏ=đóng, vàng=thu nhỏ, lục=phóng to).
// Cả thanh là vùng kéo cửa sổ (-webkit-app-region: drag); riêng cụm nút để no-drag để bấm được.
const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

export function TitleBar(): JSX.Element {
  const [max, setMax] = useState(false);
  useEffect(() => {
    window.api.windowIsMaximized().then(setMax).catch(() => undefined);
    return window.api.onWindowMaximized(setMax);
  }, []);

  return (
    <div style={DRAG} className="flex h-8 shrink-0 select-none items-center border-b border-line bg-appbg">
      <div style={NO_DRAG} className="group flex items-center gap-2 pl-3 pr-2">
        <button
          onClick={() => void window.api.windowClose()}
          title="Đóng"
          className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#ff5f57] text-[9px] font-bold leading-none text-black/0 transition hover:brightness-95 group-hover:text-black/55"
        >
          ✕
        </button>
        <button
          onClick={() => void window.api.windowMinimize()}
          title="Thu nhỏ"
          className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#febc2e] text-[11px] font-bold leading-none text-black/0 transition hover:brightness-95 group-hover:text-black/55"
        >
          −
        </button>
        <button
          onClick={() => void window.api.windowToggleMaximize().then(setMax)}
          title={max ? 'Khôi phục' : 'Phóng to'}
          className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#28c840] text-[8px] font-bold leading-none text-black/0 transition hover:brightness-95 group-hover:text-black/55"
        >
          {max ? '–' : '+'}
        </button>
      </div>
      <span className="pointer-events-none flex-1 text-center text-xs font-medium tracking-wide text-slate-400">
        Quản Lý GLB
      </span>
      {/* Khối cân đối để chữ tiêu đề nằm chính giữa (bù bề rộng cụm nút bên trái). */}
      <div className="w-[68px] shrink-0" />
    </div>
  );
}
