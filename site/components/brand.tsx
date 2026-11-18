// 电缆截面标记，几何取自 design/brand/mark.svg；颜色随明暗主题变化。
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="5.75" className="stroke-fd-muted-foreground" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3" fill="#C47A3D" />
    </svg>
  );
}
