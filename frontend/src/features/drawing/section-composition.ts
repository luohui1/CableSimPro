import { fitBounds } from './coordinates';
import type { SectionGeometry } from './section-geometry';
import type { DrawingView, PixelSize, Section } from './types';

export interface PlotRect { x: number; y: number; width: number; height: number }
export function fitPlot(bounds: SectionGeometry['bounds'], size: PixelSize, rect: PlotRect, margin = 32): DrawingView {
  const local = fitBounds(bounds, { width: rect.width, height: rect.height }, margin);
  const mpp = local.widthM / rect.width;
  return { x: local.x + (size.width / 2 - rect.x - rect.width / 2) * mpp,
    z: local.z - (size.height / 2 - rect.y - rect.height / 2) * mpp, widthM: mpp * size.width };
}
/** Presentation bounds exclude the unbounded soil; source coordinates remain SI. */
export function cableGroupBounds(section: Section, geometry: SectionGeometry) {
  const points = geometry.cables.map(c => ({ x: c.x, z: c.z, width: c.shape.radiusM * 2, height: c.shape.radiusM * 2 }));
  for (const e of section.enclosures || []) points.push({ x: e.x, z: e.z, width: e.outer_diameter || e.width || 0, height: e.outer_diameter || e.height || 0 });
  if (section.backfill) points.push(section.backfill);
  return points.length ? { left: Math.min(...points.map(p => p.x - p.width / 2)), right: Math.max(...points.map(p => p.x + p.width / 2)),
    bottom: Math.min(...points.map(p => p.z - p.height / 2)), top: Math.max(...points.map(p => p.z + p.height / 2)) } : geometry.bounds;
}
export function sectionComposition(section: Section, geometry: SectionGeometry, size: PixelSize, top = 56) {
  const group = cableGroupBounds(section, geometry), overview = { ...group, top: section.kind === 'ground' ? Math.max(0, group.top) : group.top };
  const whole = fitPlot(overview, size, { x: 0, y: top, width: size.width, height: Math.max(1, size.height - top - 8) });
  const minimum = Math.min(...geometry.cables.map(c => c.shape.radiusM * 2 * size.width / whole.widthM));
  const deep = section.kind === 'ground' && -group.top > Math.max(.2, (group.top - group.bottom) * 2);
  if (size.width < 500 || !geometry.cables.length || !(minimum < 48 || deep)) return { main: whole, group };
  const mainWidth = Math.max(176, size.width * .29);
  const rect = { x: mainWidth + 16, y: top + 8, width: size.width - mainWidth - 28, height: Math.max(1, size.height - top - 24) };
  const main = fitPlot(overview, size, { x: 0, y: top, width: mainWidth, height: Math.max(1, size.height - top - 16) }, 40);
  const plot = { x: rect.x + 12, y: rect.y + 36, width: rect.width - 24, height: Math.max(1, rect.height - 48) };
  const detail = fitPlot(group, size, plot, Math.min(64, plot.height / 4));
  return { main, group, detail: { rect, plot, view: detail, factor: main.widthM / detail.widthM } };
}
