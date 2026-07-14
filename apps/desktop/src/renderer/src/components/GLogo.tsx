// Logo chữ "G" kiểu Google (Mr.Long 14/7) — vòng cung mở phải + crossbar, NGHIÊNG TRÁI 15°, nét béo đậm.
// 1 màu (mặc định brand xanh). Dùng chung login + sidebar. viewBox 24, tâm (12,12).
export function GLogo({ className = 'h-7 w-7', color = '#1657d0', strokeWidth = 3.8 }: { className?: string; color?: string; strokeWidth?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <g transform="rotate(-15 12 12)">
        <path d="M18.58 14.39 A7 7 0 1 1 18.58 9.61" stroke={color} strokeWidth={strokeWidth} strokeLinecap="butt" />
        <path d="M12 12 H18.7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="butt" />
      </g>
    </svg>
  );
}
