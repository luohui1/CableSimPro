// The cable in section, to scale, drawn from the layers of the saved version with the canvas's own glyph. The rings of the
// layer picked or pointed at in the table are filled and outlined in the selection colour. `zoom` magnifies about the centre
// by narrowing the view box, so the drawing needs no style of its own.
import type { CableShape } from '@shared/geometry';
import { CableGlyph } from '@/canvas/cable-glyph';

const SIZE = 240;

/** How many rings the drawing has and where they are: for the status line under it. */
export function ringCounts(shape: CableShape) {
  const cores = Map.groupBy(shape.rings.filter(ring => ring.core), ring => ring.core as string);
  return { cores: cores.size, perCore: [...cores.values()][0]?.length ?? 0, common: shape.rings.filter(ring => !ring.core).length, total: shape.rings.length };
}

/** The rings of one layer in the drawing: more than one when every core has its own. */
export const ringsOf = (shape: CableShape, role: string | null) => (role ? shape.rings.filter(ring => ring.role === role).length : 0);

export function SectionFigure({ shape, label, role, zoom = 1 }: { shape: CableShape; label: string; role: string | null; zoom?: number }) {
  const scale = (SIZE * 0.46) / shape.radius;
  const picked = role ? shape.rings.filter(ring => ring.role === role) : [];
  const half = SIZE / 2 / zoom;
  return <svg viewBox={`${SIZE / 2 - half} ${SIZE / 2 - half} ${2 * half} ${2 * half}`} className="h-full w-full" role="img" aria-label={label}>
    <CableGlyph shape={shape} x={SIZE / 2} y={SIZE / 2} scale={scale} />
    {picked.map(ring => {
      const cx = SIZE / 2 + ring.cx * scale;
      const cy = SIZE / 2 - ring.cz * scale;
      const outer = ring.outer * scale;
      const inner = ring.inner * scale;
      // The ring itself is filled and its two edges drawn, so it reads apart from the copper screen tape.
      const circle = (r: number) => `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
      const path = circle(outer) + (inner > 0 ? ' ' + circle(inner) : '');
      return <g key={ring.id}>
        <path d={path} fill="var(--copper)" fillOpacity={0.45} fillRule="evenodd" />
        <path d={path} fill="none" stroke="var(--copper)" strokeWidth={2} />
      </g>;
    })}
  </svg>;
}
