import { formatNumber } from '@/lib/format';
import { displayName } from '@/lib/display-names';
import { worldToScreen } from './coordinates';
import type { PlacedCable, SectionGeometry } from './section-geometry';
import type { DrawingView, PixelSize, Section, SectionSelection } from './types';

export interface SectionDimension {
  selection: NonNullable<SectionSelection>; field: 'depth' | 'spacing' | 'width' | 'height' | 'inner_diameter' | 'outer_diameter' | 'bottom_z';
  label: string; valueM: number; x: number; y: number; neighborId?: string;
  lineX?: number; lineY?: number;
  outside?: boolean;
}

type Box = { left: number; top: number; right: number; bottom: number };
const intersects = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const labelBox = (x: number, y: number): Box => ({ left: x - 84, right: x + 84, top: y - 23, bottom: y + 15 });

/** Screen-space annotation layout; it never changes engineering coordinates. */
function placeLabels(dimensions: SectionDimension[], obstacles: Box[], size: PixelSize) {
  const occupied = [...obstacles];
  return dimensions.map(dimension => {
    const candidates = [{ x: dimension.x, y: dimension.y }];
    for (let step = 1; step <= Math.ceil(size.height / 44); step++) {
      for (const dy of [step * 44, -step * 44]) candidates.push({ x: dimension.x, y: dimension.y + dy });
    }
    for (const x of [100, size.width - 100]) {
      for (let y = 30; y < size.height - 18; y += 44) candidates.push({ x, y });
    }
    const point = candidates.find(point => {
      const box = labelBox(point.x, point.y);
      return box.left >= 8 && box.right <= size.width - 8 && box.top >= 8 && box.bottom <= size.height - 8
        && !occupied.some(other => intersects(box, other));
    });
    // An overcrowded canvas uses the component's external annotation strip.
    const placed = point || { x: Math.max(88, size.width / 2), y: 30 };
    if (point) occupied.push(labelBox(placed.x, placed.y));
    return { ...dimension, ...placed, outside: !point };
  });
}

export function sectionDimensions(section: Section, geometry: SectionGeometry, selected: SectionSelection, view: DrawingView, size: PixelSize, showAll: boolean): SectionDimension[] {
  const dimensions: SectionDimension[] = [];
  const cables = [...geometry.cables].sort((a, b) => a.x - b.x);
  const scale = size.width / view.widthM;
  const obstacles: Box[] = cables.flatMap(cable => {
    const point = worldToScreen(cable, view, size), radius = cable.shape.radiusM * scale;
    return [{ left: point.x - radius - 10, right: point.x + radius + 10, top: point.y - radius - 10, bottom: point.y + radius + 10 },
      { left: point.x - Math.max(30, cable.label.length * 7), right: point.x + Math.max(30, cable.label.length * 7), top: point.y + radius + 4, bottom: point.y + radius + 30 }];
  });
  const right = Math.max(...cables.map(cable => worldToScreen(cable, view, size).x + cable.shape.radiusM * scale));
  const bottom = Math.max(...cables.map(cable => worldToScreen(cable, view, size).y + cable.shape.radiusM * scale + 30));
  const ground = worldToScreen({ x: 0, z: 0 }, view, size).y;
  for (const layer of section.soil_layers || []) {
    const y = Math.max(20, worldToScreen({ x: 0, z: layer.top_z }, view, size).y + 24);
    obstacles.push({ left: 8, right: 16 + layer.label.length * 14, top: y - 18, bottom: y + 6 });
  }
  for (const enclosure of section.enclosures || []) {
    const point = worldToScreen(enclosure, view, size), y = point.y - (enclosure.outer_diameter || enclosure.height || 0) * scale / 2 - 8;
    const half = displayName(enclosure.id).length * 7;
    obstacles.push({ left: point.x - half, right: point.x + half, top: y - 18, bottom: y + 6 });
  }
  if (section.backfill) {
    const region = section.backfill, point = worldToScreen(region, view, size);
    const y = worldToScreen({ x: region.x, z: region.z + region.height / 2 }, view, size).y + 22;
    const half = (region.label || '回填区').length * 7;
    obstacles.push({ left: point.x - half, right: point.x + half, top: y - 18, bottom: y + 6 });
  }
  if (section.kind === 'ground') obstacles.push({ left: size.width - 166, right: size.width - 8, top: ground - 30, bottom: ground - 2 });
  if (selected?.kind === 'cable') {
    const cable = cables.find(cable => cable.id === selected.id);
    if (cable && cable.shape.radiusM * 2 * scale < 26 && size.width >= 460) {
      obstacles.push({ left: size.width - 212, right: size.width - 12, top: 12, bottom: 196 });
      const point = worldToScreen(cable, view, size);
      obstacles.push({ left: point.x, right: point.x + cable.shape.radiusM * scale + 44, top: point.y - 15, bottom: point.y + 15 });
    }
  }
  const appendCable = (cable: PlacedCable) => {
    const selection = { kind: 'cable', id: cable.id } as const;
    const point = worldToScreen(cable, view, size);
    const lineX = Math.min(size.width - 200, right + 44 + dimensions.length * 20);
    dimensions.push({ selection, field: 'depth', label: '中心埋深', valueM: -cable.z,
      lineX, x: lineX + 100, y: (point.y + ground) / 2 });
    obstacles.push({ left: lineX - 6, right: lineX + 6, top: Math.min(point.y, ground), bottom: Math.max(point.y, ground) });
    obstacles.push({ left: Math.min(point.x, lineX), right: Math.max(point.x, lineX), top: point.y - 6, bottom: point.y + 6 });
    const index = cables.indexOf(cable);
    const neighbor = cables[index - 1] || cables[index + 1];
    if (neighbor) {
      const end = worldToScreen(neighbor, view, size);
      if (dimensions.some(item => item.field === 'spacing' && [item.selection.id, item.neighborId].includes(cable.id)
        && [item.selection.id, item.neighborId].includes(neighbor.id))) return;
      const lineY = bottom + 26;
      dimensions.push({ selection, field: 'spacing', label: '水平中心距', valueM: Math.abs(cable.x - neighbor.x),
        neighborId: neighbor.id, x: (point.x + end.x) / 2, y: lineY + 32, lineY });
      obstacles.push({ left: Math.min(point.x, end.x), right: Math.max(point.x, end.x), top: lineY - 6, bottom: lineY + 6 });
      for (const p of [point, end]) obstacles.push({ left: p.x - 6, right: p.x + 6, top: p.y, bottom: lineY });
    }
  };
  for (const cable of cables) if (showAll || selected?.kind === 'cable' && selected.id === cable.id) appendCable(cable);
  const region = selected?.kind === 'backfill' && section.backfill?.id === selected.id ? section.backfill
    : selected?.kind === 'enclosure' ? section.enclosures?.find(item => item.id === selected.id) : null;
  if (region && selected) {
    const point = worldToScreen(region, view, size);
    const fields = 'type' in region && region.type === 'duct' ? ['inner_diameter', 'outer_diameter'] as const : ['width', 'height'] as const;
    fields.forEach((field, index) => dimensions.push({ selection: selected, field, label: { width: '宽度', height: '高度', inner_diameter: '管内径', outer_diameter: '管外径' }[field],
      valueM: (region as unknown as Record<string, number>)[field], x: point.x, y: point.y + 40 + index * 38 }));
  }
  if (selected?.kind === 'soil') {
    const layer = section.soil_layers?.find(item => item.id === selected.id);
    if (layer) dimensions.push({ selection: selected, field: 'bottom_z', label: '下边界深度', valueM: -layer.bottom_z,
      x: 120, y: worldToScreen({ x: 0, z: layer.bottom_z }, view, size).y - 18 });
  }
  return placeLabels(dimensions, obstacles, size);
}

export function SectionDimensions({ dimensions, geometry, view, size, editable, onEdit }: {
  dimensions: readonly SectionDimension[]; geometry: SectionGeometry; view: DrawingView; size: PixelSize;
  editable: boolean; onEdit: (dimension: SectionDimension) => void;
}) {
  return <g className="drawing-dimensions" data-section-dimensions>{dimensions.map(dimension => {
    const cable = dimension.selection.kind === 'cable' ? geometry.cables.find(item => item.id === dimension.selection.id) : null;
    const point = cable ? worldToScreen(cable, view, size) : null;
    const ground = worldToScreen({ x: 0, z: 0 }, view, size).y;
    const neighbor = geometry.cables.find(item => item.id === dimension.neighborId);
    const other = neighbor ? worldToScreen(neighbor, view, size) : null;
    const lineX = dimension.lineX ?? dimension.x, lineY = dimension.lineY ?? dimension.y;
    return <g key={`${dimension.selection.kind}/${dimension.selection.id}/${dimension.field}`}>
      {point && dimension.field === 'depth' && <path d={`M${point.x} ${point.y}H${lineX}V${ground}M${lineX - 5} ${point.y}h10M${lineX - 5} ${ground}h10`} />}
      {point && other && dimension.field === 'spacing' && <path d={`M${point.x} ${point.y}V${lineY}H${other.x}V${other.y}M${point.x} ${lineY - 5}v10M${other.x} ${lineY - 5}v10`} />}
      {!dimension.outside && <g className={`drawing-dimension-chip ${editable ? 'is-editable' : ''}`} role={editable ? 'button' : undefined} tabIndex={editable ? 0 : undefined}
        aria-label={`${editable ? '编辑' : '查看'}${dimension.label}，单位 m`} data-section-dimension={dimension.field}
        onDoubleClick={() => { if (editable) onEdit(dimension); }} onKeyDown={event => {
          if (editable && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onEdit(dimension); }
        }}><rect x={dimension.x - 80} y={dimension.y - 19} width="160" height="30" />
        <text x={dimension.x} y={dimension.y + 1} textAnchor="middle">{dimension.label} {formatNumber(dimension.valueM, 3)} m</text></g>}
    </g>;
  })}</g>;
}

export function editDimension(section: Section, dimension: SectionDimension, valueM: number): { section: Section; fields: string[] } {
  if (!Number.isFinite(valueM) || valueM <= 0) throw new Error(`${dimension.label}：请输入正尺寸，单位 m。`);
  const next = structuredClone(section);
  const { selection, field } = dimension;
  if (selection.kind === 'cable') {
    const item = next.placements.find(placement => placement.cable === selection.id);
    if (!item) throw new Error('所选电缆已不存在。');
    if (field === 'depth') item.z = -valueM;
    else {
      const neighbor = next.placements.find(placement => placement.cable === dimension.neighborId);
      if (!neighbor) throw new Error('间距参照电缆已不存在。');
      item.x = neighbor.x + (item.x >= neighbor.x ? valueM : -valueM);
    }
    return { section: next, fields: [`placements.${item.cable}.${field === 'depth' ? 'z' : 'x'}`] };
  }
  if (selection.kind === 'soil') {
    const layer = next.soil_layers?.find(item => item.id === selection.id);
    if (!layer) throw new Error('所选土壤层已不存在。');
    const old = layer.bottom_z;
    layer.bottom_z = -valueM;
    const fields = [`soil_layers.${layer.id}.bottom_z`];
    for (const other of next.soil_layers || []) if (other.id !== layer.id && Math.abs(other.top_z - old) < 1e-9) {
      other.top_z = -valueM; fields.push(`soil_layers.${other.id}.top_z`);
    }
    return { section: next, fields };
  }
  const item = selection.kind === 'backfill' ? next.backfill : next.enclosures?.find(enclosure => enclosure.id === selection.id);
  if (!item || !['width', 'height', 'inner_diameter', 'outer_diameter'].includes(field)) throw new Error('所选尺寸已不存在。');
  (item as unknown as Record<string, number>)[field] = valueM;
  return { section: next, fields: [`${selection.kind === 'backfill' ? 'backfill' : 'enclosures'}.${selection.id}.${field}`] };
}
