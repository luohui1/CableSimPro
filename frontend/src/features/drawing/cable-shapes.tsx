import { worldToScreen } from './coordinates';
import type { CableShape, DrawingRing } from './cable-geometry';
import type { DrawingView, LayerTarget, PixelSize, WorldPoint } from './types';
import { profilePath, profileSupportPoint } from './cross-section-profile';

export function CableShapes({ shape, center = { x: 0, z: 0 }, view, size, selectedId, onSelect, mini = false, colors }: {
  shape: CableShape; center?: WorldPoint; view: DrawingView; size: PixelSize;
  selectedId?: string; onSelect?: (target: LayerTarget) => void; mini?: boolean;
  colors?: Readonly<Record<string, string>>;
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
        fill={colors?.[ring.id]} fillRule="evenodd" className={`${colors?.[ring.id] ? 'drawing-thermal-conductor' : `drawing-material-${ring.materialRole}`} drawing-ring ${selected ? 'is-selected' : ''} ${selectedId && !selected ? 'is-dimmed' : ''}`}
        data-layer-id={ring.id} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
        aria-label={onSelect ? `选择 ${ring.number} ${ring.name}` : undefined} aria-pressed={onSelect ? selected : undefined}
        onClick={onSelect ? event => { event.stopPropagation(); onSelect(ring.target); } : undefined}
        onKeyDown={onSelect ? event => {
          if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelect(ring.target); }
        } : undefined}><title>{ring.number} {ring.name}</title></path>;
    })}
  </g>;
}

export function LayerNumbers({ rings, view, size, selectedId, onSelect, equivalentCores = [] }: {
  rings: readonly DrawingRing[]; view: DrawingView; size: PixelSize; selectedId?: string; onSelect: (target: LayerTarget) => void;
  equivalentCores?: readonly string[];
}) {
  const selected = rings.find(ring => ring.id === selectedId);
  const coreRings = (id?: string) => rings.filter(ring => ring.target.scope === 'core' && ring.target.coreId === id);
  const cores = [...new Set(rings.flatMap(ring => ring.target.scope === 'core' ? [ring.target.coreId] : []))];
  const coreId = selected?.target.scope === 'core' ? selected.target.coreId : cores[0];
  const coreX = coreRings(coreId)[0]?.profile.x || 0;
  // Lower support points preserve inner-to-outer order, including a top trefoil core.
  const direction = -Math.PI / 2;
  const labels = [...coreRings(coreId), ...rings.filter(ring => ring.target.scope === 'common')].map(ring => {
    const profile = ring.innerProfile ? { ...ring.profile, offset: (ring.profile.offset + ring.innerProfile.offset) / 2,
      radius: (ring.profile.radius + ring.innerProfile.radius) / 2 } : ring.profile;
    const point = ring.target.scope === 'common' && profile.kind === 'circle'
      ? { x: coreX, z: profile.z - Math.sqrt((profile.radius + profile.offset) ** 2 - (coreX - profile.x) ** 2) }
      : profileSupportPoint(profile, direction);
    return { ring, anchor: worldToScreen(point, view, size) };
  }).sort((a, b) => a.ring.number - b.ring.number);
  const top = 72, bottom = Math.max(top, size.height - 64);
  const capacity = Math.max(1, Math.floor((bottom - top) / 34) + 1);
  const columns = labels.length > capacity ? 2 : 1;
  const rows = Math.ceil(labels.length / columns), step = Math.min(40, (bottom - top) / Math.max(1, rows - 1));
  return <g className="drawing-layer-numbers" aria-label="结构层编号">
    {labels.map(({ ring, anchor }, index) => {
      const column = Math.floor(index / rows), right = columns === 1 || column === 1;
      const x = right ? size.width - 20 : 20, knee = right ? size.width - 168 : 168;
      const y = top + index % rows * step;
      return <g key={ring.id} role="button" tabIndex={0} aria-label={`选择层号 ${ring.number} ${ring.name}`}
        aria-pressed={selectedId === ring.id} className={selectedId === ring.id ? 'is-selected' : ''}
        data-layer-number={ring.number} data-label-column={right ? 'right' : 'left'} data-label-core={ring.target.scope === 'core' ? ring.target.coreId : undefined} onClick={() => onSelect(ring.target)} onKeyDown={event => {
          if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelect(ring.target); }
        }}><circle className="drawing-layer-anchor" cx={anchor.x} cy={anchor.y} r="2.5" /><path data-layer-leader d={`M${anchor.x} ${anchor.y}L${knee} ${y}H${x}`} />
        <circle cx={x} cy={y} r="12" /><text x={x} y={y + 4} textAnchor="middle">{ring.number}</text>
        <text className="drawing-layer-name" x={x + (right ? -20 : 20)} y={y - 5}
          textAnchor={right ? 'end' : 'start'}>{ring.name.split(' · ').at(-1)}</text><title>{ring.name}</title></g>;
    })}
    {cores.length > 1 && <text className="drawing-text" data-core-equivalence x="16" y={size.height - 20}>
      {equivalentCores.length ? `${cores.map((id, i) => equivalentCores.includes(id) ? `芯 ${i + 1}` : '').filter(Boolean).join('、')} 同芯 ${cores.indexOf(coreId!) + 1}` : `显示芯 ${cores.indexOf(coreId!) + 1} · 其他芯可点选查看`}
    </text>}
  </g>;
}
