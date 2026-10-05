import type { PointerEvent as ReactPointerEvent } from 'react';
import { displayName } from '@/lib/display-names';
import { CableShapes } from './cable-shapes';
import { worldToScreen } from './coordinates';
import type { PlacedCable, SectionGeometry } from './section-geometry';
import type { DrawingView, PixelSize, Section, SectionSelection } from './types';

export type ObjectPointer = (event: ReactPointerEvent<SVGElement>, selection: NonNullable<SectionSelection>, operation?: 'move' | 'width' | 'height') => void;
const matches = (selection: SectionSelection, kind: string, id: string) => selection?.kind === kind && selection.id === id;

export function SectionObjects({ section, geometry, view, size, selected, onSelect, onPointer, editable = false, miniature = false }: {
  section: Section; geometry: SectionGeometry; view: DrawingView; size: PixelSize; selected: SectionSelection;
  onSelect?: (selection: SectionSelection) => void; onPointer?: ObjectPointer; editable?: boolean; miniature?: boolean;
}) {
  const scale = size.width / view.widthM;
  const ground = worldToScreen({ x: 0, z: 0 }, view, size).y;
  const behavior = (kind: NonNullable<SectionSelection>['kind'], id: string) => {
    const selection = { kind, id };
    return { role: onSelect ? 'button' : undefined, tabIndex: onSelect ? 0 : undefined,
      'aria-label': onSelect ? `选择${kind === 'cable' ? '电缆' : kind === 'enclosure' ? '构筑物' : kind === 'soil' ? '土壤层' : '回填区'} ${displayName(id)}` : undefined,
      'aria-pressed': onSelect ? matches(selected, kind, id) : undefined,
      onClick: onSelect ? (event: React.MouseEvent<SVGElement>) => { event.stopPropagation(); onSelect(selection); } : undefined,
      onKeyDown: onSelect ? (event: React.KeyboardEvent<SVGElement>) => {
        if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelect(selection); }
      } : undefined,
      onPointerDown: onPointer ? (event: ReactPointerEvent<SVGElement>) => onPointer(event, selection) : undefined };
  };
  const region = section.backfill;
  const rectangle = (x: number, z: number, width: number, height: number) => {
    const point = worldToScreen({ x: x - width / 2, z: z + height / 2 }, view, size);
    return { x: point.x, y: point.y, width: width * scale, height: height * scale };
  };
  return <g className="drawing-section-objects">
    {(section.soil_layers || []).map(layer => {
      const y = worldToScreen({ x: 0, z: layer.top_z }, view, size).y;
      const bottom = worldToScreen({ x: 0, z: layer.bottom_z }, view, size).y;
      return <g key={layer.id} className="drawing-object" data-section-object={`soil/${layer.id}`} {...behavior('soil', layer.id)}>
        <rect className="drawing-soil-layer" x="0" y={y} width={size.width} height={bottom - y} />
        {!miniature && <text className="drawing-text" x="12" y={Math.max(20, y + 24)}>{layer.label}</text>}
        {matches(selected, 'soil', layer.id) && <path className="drawing-selection" d={`M0 ${bottom}H${size.width}`} />}
        {editable && matches(selected, 'soil', layer.id) && <rect x={size.width / 2 - 8} y={bottom - 6} width="16" height="12"
          className="drawing-resize-handle" aria-label={`拖动土层 ${layer.id} 下边界`} data-soil-handle={layer.id}
          onPointerDown={event => onPointer?.(event, { kind: 'soil', id: layer.id })} />}
      </g>;
    })}
    {section.kind === 'ground' && <g className="drawing-ground" aria-label="地表 z = 0">
      <path d={`M0 ${ground}H${size.width}`} />
      {!miniature && Array.from({ length: Math.ceil(size.width / 28) }, (_, index) => <path key={index} d={`M${index * 28} ${ground}l-10 10`} />)}
      {!miniature && <text className="drawing-text" x={size.width - 16} y={ground - 10} textAnchor="end">地表 ±0.000 m</text>}
    </g>}
    {region && <g className="drawing-object" data-section-object={`backfill/${region.id}`} {...behavior('backfill', region.id)}>
      <rect {...rectangle(region.x, region.z, region.width, region.height)} className={`drawing-region ${matches(selected, 'backfill', region.id) ? 'is-selected' : ''}`} />
      {!miniature && <text className="drawing-text" x={worldToScreen(region, view, size).x} y={worldToScreen({ x: region.x, z: region.z + region.height / 2 }, view, size).y + 22}
        textAnchor="middle">{region.label || '回填区'}</text>}
      {editable && matches(selected, 'backfill', region.id) && <ResizeHandles x={region.x} z={region.z} width={region.width} height={region.height}
        view={view} size={size} selection={{ kind: 'backfill', id: region.id }} onPointer={onPointer} />}
    </g>}
    {(section.enclosures || []).map(enclosure => {
      const point = worldToScreen(enclosure, view, size);
      const selectedHere = matches(selected, 'enclosure', enclosure.id);
      return <g key={enclosure.id} className="drawing-object" data-section-object={`enclosure/${enclosure.id}`} {...behavior('enclosure', enclosure.id)}>
        {enclosure.type === 'duct' ? <>
          <circle className="drawing-duct-outer" cx={point.x} cy={point.y} r={enclosure.outer_diameter! * scale / 2} />
          <circle className="drawing-duct-inner" cx={point.x} cy={point.y} r={enclosure.inner_diameter! * scale / 2} />
          {selectedHere && <circle className="drawing-selection" cx={point.x} cy={point.y} r={enclosure.outer_diameter! * scale / 2 + 3} />}
        </> : <rect {...rectangle(enclosure.x, enclosure.z, enclosure.width!, enclosure.height!)} className={`drawing-region ${selectedHere ? 'is-selected' : ''}`} />}
        {!miniature && <text className="drawing-text" x={point.x} y={point.y - (enclosure.outer_diameter || enclosure.height || 0) * scale / 2 - 8} textAnchor="middle">{displayName(enclosure.id)}</text>}
        {editable && selectedHere && enclosure.type !== 'duct' && <ResizeHandles x={enclosure.x} z={enclosure.z} width={enclosure.width!} height={enclosure.height!}
          view={view} size={size} selection={{ kind: 'enclosure', id: enclosure.id }} onPointer={onPointer} />}
      </g>;
    })}
    {geometry.cables.map(cable => {
      const point = worldToScreen(cable, view, size);
      const radius = cable.shape.radiusM * scale;
      return <g key={cable.id} className="drawing-object" data-section-object={`cable/${cable.id}`} {...behavior('cable', cable.id)}>
        <CableShapes shape={cable.shape} center={cable} view={view} size={size} mini={miniature} />
        {/* Hit target expands interaction only; the drawn geometry stays to scale. */}
        {onSelect && <circle className="drawing-hit-area" cx={point.x} cy={point.y} r={Math.max(radius, 8)} />}
        {matches(selected, 'cable', cable.id) && <circle className="drawing-selection" cx={point.x} cy={point.y} r={radius + 3} />}
        {!miniature && <text className="drawing-text" x={point.x} y={point.y + radius + 20} textAnchor="middle">{cable.label}</text>}
      </g>;
    })}
  </g>;
}

function ResizeHandles({ x, z, width, height, view, size, selection, onPointer }: {
  x: number; z: number; width: number; height: number; view: DrawingView; size: PixelSize;
  selection: NonNullable<SectionSelection>; onPointer?: ObjectPointer;
}) {
  return <>{(['width', 'height'] as const).map(field => {
    const point = worldToScreen({ x: x + (field === 'width' ? width / 2 : 0), z: z + (field === 'height' ? height / 2 : 0) }, view, size);
    return <rect key={field} className="drawing-resize-handle" x={point.x - 5} y={point.y - 5} width="10" height="10"
      data-resize-handle={field} aria-label={`调整${field === 'width' ? '宽度' : '高度'}`}
      onPointerDown={event => onPointer?.(event, selection, field)} />;
  })}</>;
}

export function CableDetail({ cable, view, size }: { cable: PlacedCable; view: DrawingView; size: PixelSize }) {
  const diameter = cable.shape.radiusM * 2 * size.width / view.widthM;
  if (diameter >= 26 || size.width < 460) return null;
  const width = 188, height = 176;
  const inset = { width, height };
  const insetView = { x: 0, z: 0, widthM: cable.shape.radiusM * 2 * 1.55 };
  const point = worldToScreen(cable, view, size);
  const x = size.width - width - 16, y = 16;
  const factor = (width / insetView.widthM) / (size.width / view.widthM);
  return <g className="drawing-detail" aria-label={`电缆 ${cable.id} 局部放大`}>
    <path className="drawing-detail-leader" d={`M${point.x + diameter / 2} ${point.y}h18`} />
    <circle className="drawing-detail-frame" cx={point.x + diameter / 2 + 29} cy={point.y} r="11" />
    <text className="drawing-text" x={point.x + diameter / 2 + 29} y={point.y + 5} textAnchor="middle">A</text>
    <rect className="drawing-detail-frame" x={x} y={y} width={width} height={height} />
    <svg x={x} y={y} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <CableShapes shape={cable.shape} view={insetView} size={inset} />
      <text className="drawing-text" x="12" y="22">详图 A · {factor.toFixed(1)} 倍</text>
    </svg>
  </g>;
}
