// Logo chữ "G" đậm (Mr.Long 14-15/7) — chữ G RÕ RÀNG, nghiêng trái ~12°, 1 màu (mặc định brand xanh).
// Dùng chung login + sidebar; ĐỒNG NHẤT với icon.ico + ảnh bộ cài (gen-brand-assets.mjs dùng cùng chữ G).
// (strokeWidth giữ lại cho tương thích caller cũ — không còn dùng vì đã chuyển từ nét vẽ sang glyph chữ.)
export function GLogo({ className = 'h-7 w-7', color = '#1657d0' }: { className?: string; color?: string; strokeWidth?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="'Be Vietnam Pro', Arial, sans-serif"
        fontWeight={700}
        fontSize="19"
        fill={color}
        transform="rotate(-12 12 12)"
      >
        G
      </text>
    </svg>
  );
}
