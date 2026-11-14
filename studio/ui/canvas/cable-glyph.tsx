// One cable in section, drawn to scale from its real layers. Materials keep their token colours;
// only the conductor takes the temperature colour when a result is shown.
import type { CableShape, Ring, Tone } from '@shared/geometry';

const FILL: Record<Tone, string> = {
  conductor: 'var(--conductor)',
  semi: 'var(--material-semi)',
  insulation: 'var(--material-insulation)',
  metal: 'var(--material-metal)',
  sheath: 'var(--material-sheath)',
  fill: 'color-mix(in oklab, var(--material-insulation) 72%, var(--material-metal))',
};
const EDGE = 'color-mix(in oklab, var(--text) 38%, transparent)';

export function CableGlyph({ shape, x, y, scale, conductor }: { shape: CableShape; x: number; y: number; scale: number; conductor?: string }) {
  const radius = shape.radius * scale;
  const common = shape.rings.filter(ring => !ring.core);
  const cores = Map.groupBy(shape.rings.filter(ring => ring.core), ring => ring.core as string);
  const colour = (ring: Ring) => ring.role === 'conductor' && conductor ? conductor : FILL[ring.tone];

  // At a few pixels the layers cannot be told apart: outline and conductors only.
  if (radius < 7) {
    return <g>
      <circle cx={x} cy={y} r={radius} fill={FILL.sheath} stroke={EDGE} strokeWidth={0.75} />
      {[...cores.values()].map(rings => <circle key={rings[0].id} cx={x + rings[0].cx * scale} cy={y - rings[0].cz * scale}
        r={Math.max(1.2, rings[0].outer * scale)} fill={colour(rings[0])} />)}
    </g>;
  }

  // Outer layers first, so each disc leaves its own ring visible around the next one.
  const stack = (rings: Ring[]) => {
    const ordered = [...rings].sort((a, b) => b.outer - a.outer);
    return <>
      {ordered.map(ring => <circle key={ring.id} cx={x + ring.cx * scale} cy={y - ring.cz * scale} r={ring.outer * scale} fill={colour(ring)} />)}
      {/* A layer thinner than a pixel would vanish; it is drawn as a line at its real radius. */}
      {ordered.filter(ring => ring.inner > 0 && (ring.outer - ring.inner) * scale < 1.1).map(ring =>
        <circle key={`${ring.id}/line`} cx={x + ring.cx * scale} cy={y - ring.cz * scale} r={((ring.inner + ring.outer) / 2) * scale}
          fill="none" stroke={colour(ring)} strokeWidth={1.1} />)}
    </>;
  };

  return <g>
    {stack(common)}
    {[...cores.values()].map(rings => <g key={rings[0].id}>{stack(rings)}</g>)}
    <circle cx={x} cy={y} r={radius} fill="none" stroke={EDGE} strokeWidth={0.75} />
  </g>;
}
