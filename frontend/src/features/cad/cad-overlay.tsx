import { useRef } from 'react';
import { formatNumber } from '@/lib/format';
import { clamp, selectionIndex } from './geometry-contract';
import type { CadController } from './cad-controller';
import type { CadCamera, CadGeometry, CadPick, CadSelection } from './types';
import { layerNames } from '@/features/drawing/cable-geometry';

type Point = { x: number; y: number };
interface Plane { origin: Point; end: Point; position: Point; corners: Point[] }

function plane(geometry: CadGeometry, section: number, controller: CadController): Plane {
  const length = geometry.length_m * 1000;
  if (geometry.schema === 'cablesim.cad-scene/1') {
    const bounds = geometry.crop_bounds_m;
    const x = (bounds[0] + bounds[3]) * 500;
    const z = (bounds[2] + bounds[5]) * 500;
    return { origin: controller.project(x, 0, z), end: controller.project(x, length, z),
      position: controller.project(x, length * section, z),
      corners: [[bounds[0], bounds[2]], [bounds[3], bounds[2]], [bounds[3], bounds[5]], [bounds[0], bounds[5]]]
        .map(([sx, sz]) => controller.project(sx * 1000, length * section, sz * 1000)) };
  }
  const radius = geometry.outer_diameter_m * 600;
  return { origin: controller.project(0, 0, 0), end: controller.project(0, 0, length),
    position: controller.project(0, 0, length * section),
    corners: [[-radius, -radius], [radius, -radius], [radius, radius], [-radius, radius]]
      .map(([x, y]) => controller.project(x, y, length * section)) };
}

function LayerDimensions({ geometry, selected, camera, controller, height }: {
  geometry: CadGeometry; selected: CadSelection; camera: CadCamera; controller: CadController; height: number;
}) {
  if (geometry.schema !== 'cablesim.cad-model/1' || camera.view !== 'end') return null;
  const layer = geometry.layers[selectionIndex(geometry, selected)];
  if (!layer) return null;
  const outer = layer.outer_radius_m * 1000;
  const inner = layer.inner_radius_m * 1000;
  const cx = (layer.center_m?.x || 0) * 1000, cy = (layer.center_m?.z || 0) * 1000;
  const center = controller.project(cx, cy, 0);
  if (layer.section_profile?.outer.kind === 'sector') return <g className="cad-layer-dimensions" data-cad-layer-dimensions>
    <text x={center.x} y={height - 76} textAnchor="middle">圆弧半径 R {formatNumber(outer, 1)} mm</text>
    <text x={center.x} y={height - 54} textAnchor="middle">夹角 {formatNumber(layer.section_profile.outer.angle! * 180 / Math.PI, 1)}°</text>
  </g>;
  const a = controller.project(cx - outer * Math.cos(camera.yaw), cy + outer * Math.sin(camera.yaw), 0);
  const b = controller.project(cx + outer * Math.cos(camera.yaw), cy - outer * Math.sin(camera.yaw), 0);
  const y = Math.min(height - 64, center.y + Math.abs(a.x - center.x) + 32);
  return <g className="cad-layer-dimensions" data-cad-layer-dimensions>
    <path d={`M${a.x} ${center.y}V${y + 6}M${b.x} ${center.y}V${y + 6}M${a.x} ${y}H${b.x}`} />
    <text x={center.x} y={y + 22} textAnchor="middle">本层外径 Ø {formatNumber(outer * 2, 1)} mm</text>
    <text x={center.x} y={Math.max(24, center.y - Math.abs(a.x - center.x) - 24)} textAnchor="middle">
      内径 Ø {formatNumber(inner * 2, 1)} mm · 厚度 {formatNumber(typeof layer.construction?.thickness === 'number' ? layer.construction.thickness * 1000 : outer - inner, 1)} mm
    </text>
  </g>;
}

export function CadOverlay({ geometry, selected, camera, controller, width, height, points = [] }: {
  geometry: CadGeometry; selected: CadSelection; camera: CadCamera; controller: CadController; width: number; height: number; points?: readonly CadPick[];
}) {
  const drag = useRef<{ x: number; y: number; fraction: number; dx: number; dy: number } | null>(null);
  const cut = camera.mode === 'section' ? plane(geometry, camera.section, controller) : null;
  const draggable = cut && Math.hypot(cut.end.x - cut.origin.x, cut.end.y - cut.origin.y) >= 15;
  const path = cut ? `M${cut.corners.map(point => `${point.x} ${point.y}`).join('L')}Z` : '';
  const projected = points.filter(point => [point.x_mm, point.y_mm, point.z_mm].every(Number.isFinite))
    .map(point => controller.project(point.x_mm!, point.y_mm!, point.z_mm!));
  const selectedLayer = geometry.schema === 'cablesim.cad-model/1' ? geometry.layers[selectionIndex(geometry, selected)] : null;
  return <svg className="cad-overlay" viewBox={`0 0 ${width} ${height}`} aria-label="几何尺寸和剖切面">
    {selectedLayer && <g className="cad-layer-dimensions" data-cad-layer-label><text x="16" y="28">
      {selectedLayer.label || layerNames[selectedLayer.role] || '结构层'}</text></g>}
    {cut && <path className="cad-cut-outline" d={path} />}
    <LayerDimensions geometry={geometry} selected={selected} camera={camera} controller={controller} height={height} />
    {!!projected.length && <g className="cad-point-measurement" data-cad-point-measurement>
      {projected.length === 2 && <path d={`M${projected[0].x} ${projected[0].y}L${projected[1].x} ${projected[1].y}`} />}
      {projected.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="4" />)}
    </g>}
    {draggable && cut && <g className="cad-cut-handle" role="slider" tabIndex={0} aria-label="轴向剖切位置"
      aria-valuemin={5} aria-valuemax={95} aria-valuenow={Math.round(camera.section * 100)}
      transform={`translate(${cut.position.x} ${cut.position.y})`} data-cad-section-handle
      onPointerDown={event => {
        event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, fraction: camera.section,
          dx: cut.end.x - cut.origin.x, dy: cut.end.y - cut.origin.y };
      }} onPointerMove={event => {
        const value = drag.current;
        if (!value) return;
        const offset = ((event.clientX - value.x) * value.dx + (event.clientY - value.y) * value.dy)
          / (value.dx ** 2 + value.dy ** 2);
        controller.section(clamp(value.fraction + 2 * offset, .05, .95));
      }} onPointerUp={event => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          controller.section(camera.section + (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -.05 : .05));
        }
      }}><rect x="-16" y="-16" width="32" height="32" /><path d="M-9 0H9M-4-5-9 0l5 5M4-5 9 0 4 5" /></g>}
  </svg>;
}
