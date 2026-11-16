// The cable in section, to scale, drawn from the layers of the saved version with the canvas's own glyph. A layer picked in
// the table is outlined in the selection colour.
import type { CableShape } from '@shared/geometry';
import { CableGlyph } from '@/canvas/cable-glyph';

const SIZE = 240;

export function SectionFigure({ shape, label, role }: { shape: CableShape; label: string; role: string | null }) {
  const scale = (SIZE * 0.46) / shape.radius;
  const picked = role ? shape.rings.filter(ring => ring.role === role) : [];
  return <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full" role="img" aria-label={label}>
    <CableGlyph shape={shape} x={SIZE / 2} y={SIZE / 2} scale={scale} />
    {picked.map(ring => {
      const x = SIZE / 2 + ring.cx * scale;
      const y = SIZE / 2 - ring.cz * scale;
      return <g key={ring.id} fill="none" stroke="var(--copper)" strokeWidth={1.5}>
        {ring.inner > 0 && <circle cx={x} cy={y} r={ring.inner * scale} />}
        <circle cx={x} cy={y} r={ring.outer * scale} />
      </g>;
    })}
  </svg>;
}
