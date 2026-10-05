import { worldToScreen } from './coordinates';
import type { CableShape, DrawingRing } from './cable-geometry';
import type { DrawingView, LayerTarget, PixelSize, WorldPoint } from './types';
import { profilePath, profileSupportPoint } from './cross-section-profile';

export function CableShapes({ shape, center = { x: 0, z: 0 }, view, size, selectedId, onSelect, mini = false }: {
  shape: CableShape; center?: WorldPoint; view: DrawingView; size: PixelSize;
  selectedId?: string; onSelect?: (target: LayerTarget) => void; mini?: boolean;
}) {
  const scale = size.width / view.widthM;
  return <g className={`drawing-cable-shapes ${mini ? 'is-miniature' : ''}`}>
    {shape.rings.map(ring => {
      const project = (point: WorldPoint) => worldToScreen({ x: center.x + point.x, z: center.z + point.z }, view, size);
      const contour = profilePath(ring.profile, project, scale)
        + (ring.innerProfile ? profilePath(ring.innerProfile, project, scale) : '')
        + ring.holes.map(hole => profilePath(hole, project, scale)).join('');
      const selected = selectedId === ring.id;
      return <path key={ring.id} d={contour} data-profile-kind={ring.profile.kind}
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
  const selected = rings.find(ring => ring.id === selectedId);
  const core = selected?.target.scope === 'core' ? selected.target.coreId : rings.find(ring => ring.target.scope === 'core')?.target;
  const coreId = typeof core === 'string' ? core : core?.scope === 'core' ? core.coreId : undefined;
  const columns = [rings.filter(ring => ring.target.scope === 'core' && ring.target.coreId === coreId),
    rings.filter(ring => ring.target.scope === 'common')];
  return <g className="drawing-layer-numbers" aria-label="结构层编号">
    {columns.flatMap((labels, side) => labels.map((ring, index) => {
      const right = side === 1;
      const profile = ring.innerProfile ? { ...ring.profile, offset: (ring.profile.offset + ring.innerProfile.offset) / 2,
        radius: (ring.profile.radius + ring.innerProfile.radius) / 2 } : ring.profile;
      const anchor = worldToScreen(profileSupportPoint(profile, right ? 0 : Math.PI), view, size);
      const above = anchor.y >= (size.height - 80) / 2;
      const room = above ? anchor.y - 26 : size.height - 86 - anchor.y;
      const step = Math.min(30, room / Math.max(1, labels.length));
      const x = right ? size.width - 20 : 20;
      // Inner layers travel farther; preserve their order on one side of the
      // shared support ray. This fan has no pairwise leader intersections.
      const y = anchor.y + (above ? -1 : 1) * (labels.length - index) * step;
      const knee = right ? size.width - 112 : 112;
      return <g key={ring.id} role="button" tabIndex={0} aria-label={`选择层号 ${ring.number} ${ring.name}`}
        aria-pressed={selectedId === ring.id} className={selectedId === ring.id ? 'is-selected' : ''}
        data-layer-number={ring.number} data-label-column={right ? 'right' : 'left'} data-label-core={ring.target.scope === 'core' ? ring.target.coreId : undefined} onClick={() => onSelect(ring.target)} onKeyDown={event => {
          if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelect(ring.target); }
        }}><path data-layer-leader d={`M${anchor.x} ${anchor.y}L${knee} ${y}H${x}`} />
        <circle cx={x} cy={y} r="12" /><text x={x} y={y + 4} textAnchor="middle">{ring.number}</text>
        <text className="drawing-layer-name" x={x + (right ? -20 : 20)} y={y - 5}
          textAnchor={right ? 'end' : 'start'}>{ring.name.split(' · ').at(-1)}</text><title>{ring.name}</title></g>;
    }))}
  </g>;
}
