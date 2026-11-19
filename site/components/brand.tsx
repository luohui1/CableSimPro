import { useId } from 'react';

// 与正式前端 frontend/src/components/brand.tsx 相同的品牌标记和字标：电缆截面 + 信号线，
// 颜色只取 --brand-* 与 --conductor 令牌（见 app/global.css，数值来自 design/tokens.css），随明暗主题切换。
const STRANDS = [0, 60, 120, 180, 240, 300].map((angle) => {
  const r = (angle * Math.PI) / 180;
  return [50 + 11.2 * Math.cos(r), 50 + 11.2 * Math.sin(r)];
});

export function BrandMark({ className }: { className?: string }) {
  const mask = useId();
  return (
    <svg viewBox="0 0 112 100" className={className} role="img" aria-label="CableSimPro">
      <defs>
        <mask id={mask}>
          <rect width="112" height="100" fill="white" />
          <rect x="49" width="2" height="100" fill="black" />
        </mask>
      </defs>
      <g mask={`url(#${mask})`}>
        <path d="M50 2A48 48 0 0 0 50 98V90.5A40.5 40.5 0 0 1 50 9.5Z" fill="var(--brand-ink)" />
        <path d="M50 13.5A36.5 36.5 0 0 0 50 86.5" fill="none" stroke="var(--brand-primary)" strokeWidth="2.2" />
        <path d="M50 3A47 47 0 0 1 50 97" fill="none" stroke="var(--brand-primary)" strokeWidth="2.6" />
        <path d="M50 8A42 42 0 0 1 50 92" fill="none" stroke="var(--brand-signal)" strokeWidth="1.8" opacity=".85" />
        <path d="M50 13A37 37 0 0 1 50 87" fill="none" stroke="var(--brand-signal)" strokeWidth="1.3" opacity=".6" />
      </g>
      <circle cx="50" cy="50" r="27" fill="var(--brand-insulation)" />
      <circle cx="50" cy="50" r="25.6" fill="none" stroke="var(--brand-insulation-edge)" strokeWidth="2" />
      <circle cx="50" cy="50" r="18.5" fill="var(--brand-core)" />
      {[[50, 50], ...STRANDS].map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={i === 0 ? 5.4 : 5.1}
          fill="var(--conductor)"
          stroke="var(--brand-strand-edge)"
          strokeWidth=".9"
        />
      ))}
      <path
        d="M77 50h4l2.2-6 3.2 12 3-9 2 3h11"
        fill="none"
        stroke="var(--brand-signal)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="105" cy="50" r="2.2" fill="var(--brand-primary)" />
    </svg>
  );
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[-0.01em] text-(--brand-ink) ${className ?? ''}`}>
      Cable<span className="text-(--brand-primary)">Sim</span>Pro
    </span>
  );
}
