import { displayName } from '@/lib/display-names';
import { worldToScreen } from './coordinates';
import type { SectionGeometry } from './section-geometry';
import type { PlotRect } from './section-composition';
import type { DomainDocument, DrawingView, PixelSize, ResultAnnotation, Section } from './types';

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
export function annotationValue(value: ResultAnnotation) { return 'label' in value ? { text: value.label, limiting: value.limiting } : { text: value.text, limiting: value.emphasis }; }
export function SectionLabels({ document, section, geometry, view, size, rect, annotations }: {
  document: DomainDocument; section: Section; geometry: SectionGeometry; view: DrawingView; size: PixelSize; rect: PlotRect;
  annotations?: Readonly<Record<string, ResultAnnotation>>;
}) {
  const scale = size.width / view.widthM;
  const objects = [...geometry.cables.map(c => ({ ...worldToScreen(c, view, size), radius: c.shape.radiusM * scale })),
    ...(section.enclosures || []).map(e => ({ ...worldToScreen(e, view, size), radius: (e.outer_diameter || e.height || 0) * scale / 2 }))];
  const occupied: Box[] = objects.map(p => ({ x: p.x - p.radius - 3, y: p.y - p.radius - 3, width: p.radius * 2 + 6, height: p.radius * 2 + 6 }));
  const names = geometry.cables.map(c => { const index = document.circuits.findIndex(v => v.cables.some(i => i.id === c.id));
    return { id: c.id, text: `回路 ${index + 1} · ${c.label}`, point: worldToScreen(c, view, size), radius: c.shape.radiusM * scale, above: false, phase: c.phase }; });
  const results = geometry.cables.flatMap(c => annotations?.[c.id] ? [{ ...annotationValue(annotations[c.id]), id: `${c.id}/result`, point: worldToScreen(c, view, size), radius: c.shape.radiusM * scale, above: true, phase: '' }] : []);
  // Reserve readable positions for temperatures before names consume the available space.
  const items = [...results.sort((a, b) => Number(b.limiting === true) - Number(a.limiting === true)), ...names,
    ...(section.enclosures || []).map(e => ({ id: e.id, text: displayName(e.id), point: worldToScreen(e, view, size), radius: (e.outer_diameter || e.height || 0) * scale / 2, above: true, phase: '' }))];
  return <g className="drawing-section-labels" aria-label="对象及结果标注">{items.map(item => {
    const width = [...item.text].reduce((sum, c) => sum + (/[^\x00-\xff]/.test(c) ? 13 : 7.5), 0) + 20;
    const height = 22, candidates: Box[] = [];
    for (const dy of [item.above ? -1 : 1, item.above ? 1 : -1]) for (const level of [0, 1, 2, 3]) for (const shift of [0, -width / 2, width / 2, -width, width])
      candidates.push({ x: item.point.x - width / 2 + shift, y: item.point.y + dy * (item.radius + 16 + level * 26) - 11, width, height });
    const fallback: Box[] = [];
    for (let y = rect.y + 4; y + height <= rect.y + rect.height - 4; y += 26)
      for (let x = rect.x + 4; x + width <= rect.x + rect.width - 4; x += 16) fallback.push({ x, y, width, height });
    const distance = (b: Box) => (b.x + width / 2 - item.point.x) ** 2 + (b.y + height / 2 - item.point.y) ** 2;
    candidates.push(...fallback.sort((a, b) => distance(a) - distance(b)));
    const box = candidates.find(b => b.x >= rect.x + 4 && b.x + width <= rect.x + rect.width - 4 && b.y >= rect.y + 4 && b.y + height <= rect.y + rect.height - 4 && !occupied.some(other => intersects(b, other)));
    if (!box) return <title key={item.id}>{item.text}</title>;
    occupied.push(box);
    const x = box.x + width / 2, y = box.y + height / 2, limiting = 'limiting' in item && item.limiting === true;
    const angle = Math.atan2(y - item.point.y, x - item.point.x), ax = item.point.x + Math.cos(angle) * item.radius, ay = item.point.y + Math.sin(angle) * item.radius;
    return <g key={item.id} className={`drawing-object-label ${limiting ? 'is-limiting' : ''}`} data-object-label={item.id} data-result-label={'limiting' in item ? item.id : undefined}>
      <path d={`M${ax} ${ay}L${x} ${y}`} /><rect x={box.x} y={box.y} width={width} height={height} />
      {limiting && <circle className="drawing-limit-mark" cx={box.x + 6} cy={y} r="2.5" />}
      {['A', 'B', 'C'].includes(item.phase) && <circle className={`drawing-phase-${item.phase.toLowerCase()}`} cx={box.x + 6} cy={y} r="3" />}
      <text x={x} y={y} dominantBaseline="central" textAnchor="middle">{item.text}</text><title>{item.text}</title>
    </g>;
  })}</g>;
}
