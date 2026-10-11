import { worldToScreen } from './coordinates';
import type { CableShape, DrawingRing } from './cable-geometry';
import type { DrawingView, LayerTarget, PixelSize, WorldPoint } from './types';
import { profilePath } from './cross-section-profile';
import { leaderLayout, layerMillimetres } from './layer-leaders';

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
  const labels = [...coreRings(coreId), ...rings.filter(ring => ring.target.scope === 'common')].sort((a, b) => a.number - b.number);
  const scale = size.width / view.widthM;
  const points = leaderLayout(labels.map(ring => ({ center: worldToScreen({x:ring.centerX,z:ring.centerZ},view,size), radius:(ring.innerM+ring.outerM)/2*scale })), Math.max(...rings.map(ring => worldToScreen({x:ring.centerX+ring.outerM,z:ring.centerZ},view,size).x)), size.width, size.height);
  return <g className="drawing-layer-numbers" aria-label="结构层编号">
    {labels.map((ring, index) => {
      const {anchor, points: route, label:{x,y}} = points[index];
      return <g key={ring.id} role="button" tabIndex={0} aria-label={`选择层号 ${ring.number} ${ring.name}`}
        aria-pressed={selectedId === ring.id} className={selectedId === ring.id ? 'is-selected' : ''}
        data-layer-number={ring.number} data-label-column="right" data-label-core={ring.target.scope === 'core' ? ring.target.coreId : undefined} onClick={() => onSelect(ring.target)} onKeyDown={event => {
          if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelect(ring.target); }
        }}><circle className="drawing-layer-anchor" cx={anchor.x} cy={anchor.y} r="2.5" /><path data-layer-leader d={route.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join('')} />
        <text className="drawing-layer-name" x={x} y={y+4} textAnchor="start">{ring.number} {ring.name.split(' · ').at(-1)} · {ring.target.role==='conductor'?'Ø':'厚'} {layerMillimetres(ring.target.role==='conductor'?ring.outerM*2:ring.outerM-ring.innerM,ring.target.role==='conductor')} mm</text><title>{ring.name}</title></g>;
    })}
    {cores.length > 1 && <text className="drawing-text" data-core-equivalence x="16" y={size.height - 20}>
      {equivalentCores.length ? `${cores.map((id, i) => equivalentCores.includes(id) ? `芯 ${i + 1}` : '').filter(Boolean).join('、')} 同芯 ${cores.indexOf(coreId!) + 1}` : `显示芯 ${cores.indexOf(coreId!) + 1} · 其他芯可点选查看`}
    </text>}
  </g>;
}
