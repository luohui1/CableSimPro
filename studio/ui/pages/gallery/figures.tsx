// The gallery's drawings are the canvas's own parts fed with the real run: the scene and the cable glyph (ui/canvas), the
// temperature ramp (ui/lib/ramp) and the soil field the method states for this run (mirror line source, ui/canvas/field-model).
import { CableGlyph } from '@/canvas/cable-glyph';
import { levelOnRay, type FieldModel } from '@/canvas/field-model';
import { buildScene } from '@/canvas/scene';
import { rampPosition, readRamp } from '@/lib/ramp';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/state/theme';
import { RUN_CABLE, RUN_DOCUMENT } from './run-document';

const scene = buildScene(RUN_DOCUMENT, [RUN_CABLE], RUN_CABLE.id);

// The soil field of run-9dd64e85 as the method states it (analytical_soil_view: kennelly-image-line-sources, operating):
// one line source at the cable with soil resistivity 1 K·m/W times its total loss at the saved load, over 2π.
const AMBIENT = 25;
const LIMIT = 90;
const RESISTIVITY = 1;
const FIELD = {
  ambient: AMBIENT,
  sources: scene.cables.map(cable => ({ x: cable.x, z: cable.z, k: (RESISTIVITY * RUN_CABLE.losses_w_m.total) / (2 * Math.PI) })),
} as FieldModel;
const LEVELS = [27.5, 30, 32.5, 35, 37.5, 40];
const LINES = [30, 35];


/** The cable as it lies in the soil, to scale, in the warmth of its own field: for a result card. */
export function SectionThumb({ width = 176, height = 132 }: { width?: number; height?: number }) {
  const dark = useTheme(state => state.theme) === 'dark';
  const ramp = readRamp();
  const cable = scene.cables[0];
  const scale = (height * 0.62) / (2 * scene.shape.radius);
  const x = (metres: number) => width / 2 + (metres - cable.x) * scale;
  const y = (metres: number) => height / 2 - (metres - cable.z) * scale;
  const outline = (level: number) => Array.from({ length: 72 }, (_, index) => {
    const point = levelOnRay(FIELD, level, [cable.x, cable.z], (index / 72) * Math.PI * 2, scene.shape.radius, 8);
    return point ? `${x(point[0]).toFixed(1)},${y(point[1]).toFixed(1)}` : null;
  }).filter(Boolean).join(' ');
  return <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" aria-label="敷设断面：三芯电缆直埋，埋深 1.2 m">
    <g opacity={dark ? 0.3 : 1}>
      <rect width={width} height={height} fill={ramp.field(rampPosition(37.5, AMBIENT, LIMIT))} />
      <polygon points={outline(40)} fill={ramp.field(rampPosition(40, AMBIENT, LIMIT))} />
    </g>
    <CableGlyph shape={scene.shape} x={x(cable.x)} y={y(cable.z)} scale={scale} conductor={ramp.css(rampPosition(RUN_CABLE.conductor_c, AMBIENT, LIMIT))} />
  </svg>;
}

/** The cable alone, filling its box: the structure view of a type. `highlight` outlines every ring of one layer (by role). */
export function CableSection({ size = 240, highlight }: { size?: number; highlight?: string }) {
  const scale = (size * 0.46) / scene.shape.radius;
  const rings = highlight ? scene.shape.rings.filter(ring => ring.role === highlight) : [];
  return <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full" role="img" aria-label="YJV22-8.7/15 kV 3×240 结构断面">
    <CableGlyph shape={scene.shape} x={size / 2} y={size / 2} scale={scale} />
    {rings.map(ring => {
      const cx = size / 2 + ring.cx * scale, cy = size / 2 - ring.cz * scale, outer = ring.outer * scale, inner = ring.inner * scale;
      // The ring itself filled in the selection colour, its two edges drawn: it reads apart from the copper screen tape.
      const circle = (r: number) => `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
      return <g key={ring.id}>
        <path d={circle(outer) + (inner > 0 ? ' ' + circle(inner) : '')} fill="var(--copper)" fillOpacity={0.45} fillRule="evenodd" />
        <path d={circle(outer) + (inner > 0 ? ' ' + circle(inner) : '')} fill="none" stroke="var(--copper)" strokeWidth={2} />
      </g>;
    })}
  </svg>;
}

/** The rings of one layer in the drawing: how many there are, for the label beside the selection. */
export const ringsOf = (role: string) => scene.shape.rings.filter(ring => ring.role === role).length;
/** The drawing's rings by place: how many cores, how many rings each, how many shared. */
export const RING_COUNTS = (() => {
  const cores = Map.groupBy(scene.shape.rings.filter(ring => ring.core), ring => ring.core as string);
  const perCore = [...cores.values()][0]?.length ?? 0;
  return { cores: cores.size, perCore, common: scene.shape.rings.filter(ring => !ring.core).length, total: scene.shape.rings.length };
})();

/** The laying from the ground down: the soil coloured by its temperature, isotherms every 5 K, the depth, the cable. */
export function SectionField() {
  const theme = useTheme(state => state.theme);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { width, height } = size;
  return <div ref={host} className="absolute inset-0">
    {width > 0 && <FieldDrawing width={width} height={height} dark={theme === 'dark'} />}
  </div>;
}

function FieldDrawing({ width, height, dark }: { width: number; height: number; dark: boolean }) {
  const ramp = readRamp();
  const cable = scene.cables[0];
  // The overview, one unit per pixel: the ground below the floating tools, the cable at its depth, the field around it.
  const scale = (height - 64) / 1.9;
  const x = (metres: number) => width * 0.46 + (metres - cable.x) * scale;
  const y = (metres: number) => 64 - metres * scale;
  const outline = (level: number) => Array.from({ length: 120 }, (_, index) => {
    const point = levelOnRay(FIELD, level, [cable.x, cable.z], (index / 120) * Math.PI * 2, scene.shape.radius, 8);
    return point ? `${x(point[0]).toFixed(1)},${y(point[1]).toFixed(1)}` : null;
  }).filter(Boolean).join(' ');
  const ground = y(0);
  const left = x(cable.x) - scene.shape.radius * scale;
  const depth = { x: left - 96, top: ground, bottom: y(cable.z) };
  // Each isotherm is named where it crosses a ray to the lower right, clear of the others.
  const label = (level: number) => {
    const point = levelOnRay(FIELD, level, [cable.x, cable.z], -Math.PI / 5, scene.shape.radius, 8);
    return point && <text key={level} x={x(point[0]) + 8} y={y(point[1]) + 16} fontSize="13" fill="var(--text-secondary)">{level} °C</text>;
  };
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block" role="img"
    aria-label="敷设断面：三芯电缆直埋 1.2 m，土壤温度场与等温线">
    {/* The ramp tokens are the same in both themes; on the dark ground the soil is drawn at a third of its strength. */}
    <g opacity={dark ? 0.24 : 1}>
      <rect x={0} y={ground} width={width} height={height - ground} fill={ramp.field(0)} />
      {LEVELS.map(level => <polygon key={level} points={outline(level)} fill={ramp.field(rampPosition(level, AMBIENT, LIMIT))} />)}
    </g>
    {LINES.map(level => <polygon key={`line-${level}`} points={outline(level)} fill="none" stroke="var(--text-secondary)" strokeWidth={0.75} strokeOpacity={0.6} />)}
    {LINES.map(label)}
    <line x1={0} x2={width} y1={ground} y2={ground} stroke="var(--text)" strokeWidth={1.25} />
    {Array.from({ length: Math.ceil(width / 24) + 1 }, (_, index) => <line key={index} x1={index * 24} x2={index * 24 - 8} y1={ground} y2={ground - 8} stroke="var(--text-secondary)" strokeWidth={0.75} />)}
    <text x={x(cable.x) + 48} y={ground + 24} fontSize="13" fill="var(--text-secondary)">地面 · 环境 {AMBIENT} °C</text>
    <g stroke="var(--text-secondary)" strokeWidth={1}>
      <line x1={depth.x} x2={depth.x} y1={depth.top} y2={depth.bottom} />
      <line x1={depth.x - 5} x2={depth.x + 5} y1={depth.top} y2={depth.top} />
      <line x1={depth.x - 5} x2={depth.x + 5} y1={depth.bottom} y2={depth.bottom} />
      <line x1={depth.x + 5} x2={left - 6} y1={depth.bottom} y2={depth.bottom} strokeDasharray="3 3" />
    </g>
    <text x={depth.x - 10} y={(depth.top + depth.bottom) / 2 + 4} fontSize="13" textAnchor="end" fill="var(--text)">1.2 m</text>
    <CableGlyph shape={scene.shape} x={x(cable.x)} y={y(cable.z)} scale={scale} conductor={ramp.css(rampPosition(RUN_CABLE.conductor_c, AMBIENT, LIMIT))} />
  </svg>;
}

export const FIELD_RANGE = { ambient: AMBIENT, limit: LIMIT };

/** The soil colours of the drawing at six even steps from the ambient to the limit, for the legend. */
export const fieldStops = () => {
  const ramp = readRamp();
  return Array.from({ length: 6 }, (_, index) => ramp.field(index / 5));
};
