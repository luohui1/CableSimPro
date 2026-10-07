import { useMemo } from 'react';
import { fitBounds } from './coordinates';
import { sectionGeometry } from './section-geometry';
import { SectionObjects } from './section-objects';
import type { DomainDocument } from './types';
import './drawing.css';

const SIZE = { width: 320, height: 220 };

/** 只读的敷设截面缩略图：与工作台同一套几何与绘制，没有工具条和编辑手势，放在窄栏里看全貌。 */
export function SectionThumbnail({ document, sectionId, label }: { document: DomainDocument; sectionId: string; label: string }) {
  const section = document.sections.find(item => item.id === sectionId) || null;
  const geometry = useMemo(() => {
    if (!section) return null;
    try { return sectionGeometry(document, section); } catch { return null; }
  }, [document, section]);
  if (!section || !geometry) return null;
  // 取景框住电缆与管孔（窄栏里看清排列），而不是整片土壤
  const items = [
    ...geometry.cables.map(cable => ({ x: cable.x, z: cable.z, r: cable.shape.radiusM })),
    ...(section.enclosures || []).map(item => ({ x: item.x, z: item.z, r: (item.outer_diameter ?? Math.max(item.width ?? 0, item.height ?? 0)) / 2 })),
  ];
  const span = items.length ? {
    left: Math.min(...items.map(item => item.x - item.r)), right: Math.max(...items.map(item => item.x + item.r)),
    bottom: Math.min(...items.map(item => item.z - item.r)), top: Math.max(...items.map(item => item.z + item.r)),
  } : geometry.bounds;
  const pad = Math.max(span.right - span.left, span.top - span.bottom) * 0.35;
  const view = fitBounds({ left: span.left - pad, right: span.right + pad, bottom: span.bottom - pad, top: span.top + pad }, SIZE, 16);
  return <svg className="section-thumbnail" viewBox={`0 0 ${SIZE.width} ${SIZE.height}`} role="img" aria-label={label}>
    <SectionObjects section={section} geometry={geometry} view={view} size={SIZE} selected={null} />
  </svg>;
}
