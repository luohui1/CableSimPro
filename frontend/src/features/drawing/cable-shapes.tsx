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
  const coreRings = (id?: string) => rings.filter(ring => ring.target.scope === 'core' && ring.target.coreId === id);
  // 标注沿同一条射线：从电缆中心穿过一根线芯中心向外。优先选中层所在线芯，否则取最靠右（屏幕上）的线芯。
  const cores = [...new Set(rings.flatMap(ring => ring.target.scope === 'core' ? [ring.target.coreId] : []))];
  const centre = (id: string) => { const p = coreRings(id)[0]?.profile; return p ? { x: p.x, z: p.z } : { x: 0, z: 0 }; };
  const coreId = selected?.target.scope === 'core' ? selected.target.coreId
    : cores.reduce<string | undefined>((best, id) => best === undefined || centre(id).x - 0.3 * centre(id).z > centre(best).x - 0.3 * centre(best).z ? id : best, undefined);
  const c = coreId ? centre(coreId) : { x: 0, z: 0 };
  const direction = Math.hypot(c.x, c.z) > 1e-9 ? Math.atan2(c.z, c.x) : -Math.PI / 6;
  const labels = [...coreRings(coreId), ...rings.filter(ring => ring.target.scope === 'common')].map(ring => {
    const profile = ring.innerProfile ? { ...ring.profile, offset: (ring.profile.offset + ring.innerProfile.offset) / 2,
      radius: (ring.profile.radius + ring.innerProfile.radius) / 2 } : ring.profile;
    return { ring, anchor: worldToScreen(profileSupportPoint(profile, direction), view, size) };
  }).sort((a, b) => a.anchor.y - b.anchor.y);
  // 标签一列放在射线朝向的一侧，顺序与锚点一致，因此引线两两不交叉。
  const right = labels.length ? labels[labels.length - 1].anchor.x >= size.width / 2 || direction > -Math.PI / 2 && direction < Math.PI / 2 : true;
  const top = 28, bottom = size.height - 92;
  const step = Math.min(44, (bottom - top) / Math.max(1, labels.length));
  const first = Math.max(top, Math.min(bottom - step * (labels.length - 1), labels.reduce((sum, item) => sum + item.anchor.y, 0) / Math.max(1, labels.length) - step * (labels.length - 1) / 2));
  const x = right ? size.width - 20 : 20;
  const knee = right ? size.width - 128 : 128;
  return <g className="drawing-layer-numbers" aria-label="结构层编号">
    {labels.map(({ ring, anchor }, index) => {
      const y = first + index * step;
      return <g key={ring.id} role="button" tabIndex={0} aria-label={`选择层号 ${ring.number} ${ring.name}`}
        aria-pressed={selectedId === ring.id} className={selectedId === ring.id ? 'is-selected' : ''}
        data-layer-number={ring.number} data-label-column={right ? 'right' : 'left'} data-label-core={ring.target.scope === 'core' ? ring.target.coreId : undefined} onClick={() => onSelect(ring.target)} onKeyDown={event => {
          if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelect(ring.target); }
        }}><circle className="drawing-layer-anchor" cx={anchor.x} cy={anchor.y} r="2.5" /><path data-layer-leader d={`M${anchor.x} ${anchor.y}L${knee} ${y}H${x}`} />
        <circle cx={x} cy={y} r="12" /><text x={x} y={y + 4} textAnchor="middle">{ring.number}</text>
        <text className="drawing-layer-name" x={x + (right ? -20 : 20)} y={y - 5}
          textAnchor={right ? 'end' : 'start'}>{ring.name.split(' · ').at(-1)}</text><title>{ring.name}</title></g>;
    })}
  </g>;
}
