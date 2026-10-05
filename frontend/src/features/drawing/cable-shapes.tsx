import { worldToScreen } from './coordinates';
import type { CableShape, DrawingRing } from './cable-geometry';
import type { DrawingView, LayerTarget, PixelSize, WorldPoint } from './types';

export function annulusPath(x: number, y: number, outer: number, inner: number): string {
  const circle = (radius: number) => `M${x + radius} ${y}A${radius} ${radius} 0 1 0 ${x - radius} ${y}A${radius} ${radius} 0 1 0 ${x + radius} ${y}Z`;
  return circle(outer) + (inner > 0 ? circle(inner) : '');
}

export function CableShapes({ shape, center = { x: 0, z: 0 }, view, size, selectedId, onSelect, mini = false }: {
  shape: CableShape; center?: WorldPoint; view: DrawingView; size: PixelSize;
  selectedId?: string; onSelect?: (target: LayerTarget) => void; mini?: boolean;
}) {
  const scale = size.width / view.widthM;
  return <g className={`drawing-cable-shapes ${mini ? 'is-miniature' : ''}`}>
    {shape.rings.map(ring => {
      const point = worldToScreen({ x: center.x + ring.centerX, z: center.z + ring.centerZ }, view, size);
      const selected = selectedId === ring.id;
      return <path key={ring.id} d={annulusPath(point.x, point.y, ring.outerM * scale, ring.innerM * scale)}
        fillRule="evenodd" className={`drawing-material-${ring.materialRole} drawing-ring ${selected ? 'is-selected' : ''} ${selectedId && !selected ? 'is-dimmed' : ''}`}
        data-layer-id={ring.id} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
        aria-label={onSelect ? `选择 ${ring.number} ${ring.name}` : undefined} aria-pressed={onSelect ? selected : undefined}
        onClick={onSelect ? event => { event.stopPropagation(); onSelect(ring.target); } : undefined}
        onKeyDown={onSelect ? event => {
          if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelect(ring.target); }
        } : undefined}><title>{ring.number} {ring.name}</title></path>;
    })}
  </g>;
}

export function LayerNumbers({ rings, view, size, selectedId, onSelect }: {
  rings: readonly DrawingRing[]; view: DrawingView; size: PixelSize; selectedId?: string; onSelect: (target: LayerTarget) => void;
}) {
  const rows = Math.ceil(rings.length / 2);
  const step = Math.min(30, (size.height - 88) / Math.max(1, rows));
  const startY = size.height / 2 - (rows - 1) * step / 2;
  return <g className="drawing-layer-numbers" aria-label="结构层编号">
    {rings.map((ring, index) => {
      const right = index % 2 === 0;
      const angle = right ? -.42 : Math.PI + .42;
      const radius = (ring.innerM + ring.outerM) / 2;
      const anchor = worldToScreen({ x: ring.centerX + Math.cos(angle) * radius,
        z: ring.centerZ + Math.sin(angle) * radius }, view, size);
      const x = right ? size.width - 36 : 36;
      const y = startY + Math.floor(index / 2) * step;
      return <g key={ring.id} role="button" tabIndex={0} aria-label={`选择层号 ${ring.number} ${ring.name}`}
        aria-pressed={selectedId === ring.id} className={selectedId === ring.id ? 'is-selected' : ''}
        data-layer-number={ring.number} onClick={() => onSelect(ring.target)} onKeyDown={event => {
          if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelect(ring.target); }
        }}><path d={`M${anchor.x} ${anchor.y}L${x + (right ? -22 : 22)} ${y}H${x}`} />
        <circle cx={x} cy={y} r="12" /><text x={x} y={y + 4} textAnchor="middle">{ring.number}</text></g>;
    })}
  </g>;
}
