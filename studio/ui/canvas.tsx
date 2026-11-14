// The laying-section canvas. Drawn to scale in metres (x right, z up, ground at z = 0).
// The visual language follows the CableSimPro drawing code: hairline grid, hatched ground line,
// cables in their material colours, a framed detail of the cable group, dimension chips that are
// edited in place. Dragging a cable changes the template's depth or spacing, never a single cable.
import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { compact, fixed, PHASE_NAMES } from '../shared/format.ts';
import { type Bounds, heat, type Placed, sectionShape, type Tone } from '../shared/geometry.ts';
import type { CableState, DomainDocument, Section, TemperatureField } from '../shared/types.ts';
import { IconButton, NumberField } from './components.tsx';

interface View { x: number; z: number; widthM: number }
interface Size { width: number; height: number }
interface Rect { x: number; y: number; width: number; height: number }
type DimensionKey = 'depth_m' | 'spacing_m';
const SNAP = .005;
const LINEAR_SPACING = new Set(['trefoil', 'flat', 'backfill', 'ducts_2x3', 'ducts_3x3', 'duct_bank', 'three_core_buried_horizontal',
  'three_core_ducts_horizontal', 'three_core_ducts_2x3', 'three_core_ducts_3x3']);

const toScreen = (point: { x: number; z: number }, view: View, size: Size) => {
  const scale = size.width / view.widthM;
  return { x: size.width / 2 + (point.x - view.x) * scale, y: size.height / 2 - (point.z - view.z) * scale };
};
const toWorld = (point: { x: number; y: number }, view: View, size: Size) => {
  const mpp = view.widthM / size.width;
  return { x: view.x + (point.x - size.width / 2) * mpp, z: view.z - (point.y - size.height / 2) * mpp };
};
function fitRect(bounds: Bounds, size: Size, rect: Rect, margin: number): View {
  const mpp = Math.max(Math.max(bounds.right - bounds.left, .01) / Math.max(1, rect.width - 2 * margin),
    Math.max(bounds.top - bounds.bottom, .01) / Math.max(1, rect.height - 2 * margin));
  return { widthM: mpp * size.width, x: (bounds.left + bounds.right) / 2 - (rect.x + rect.width / 2 - size.width / 2) * mpp,
           z: (bounds.top + bounds.bottom) / 2 + (rect.y + rect.height / 2 - size.height / 2) * mpp };
}
function zoomAt(view: View, factor: number, anchor: { x: number; y: number }, size: Size): View {
  const fixedPoint = toWorld(anchor, view, size);
  const widthM = Math.min(80, Math.max(.04, view.widthM * factor));
  const k = widthM / view.widthM;
  return { widthM, x: fixedPoint.x + (view.x - fixedPoint.x) * k, z: fixedPoint.z + (view.z - fixedPoint.z) * k };
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

export function cableLabel(id: string, document: DomainDocument): string {
  for (const circuit of document.circuits) {
    const cable = circuit.cables.find(item => item.id === id);
    if (circuit.id === id) return circuit.label;
    // A three-core cable is its circuit's only cable, so the circuit name identifies it.
    if (cable && cable.phase === 'L1L2L3' && document.circuits.length > 1) return circuit.label;
    if (cable) return `${document.circuits.length > 1 ? circuit.label + ' ' : ''}${PHASE_NAMES[cable.phase] ?? cable.phase}`;
  }
  return id;
}

/** Iso-temperature segments of the published field, every 5 K, in section coordinates. */
function isotherms(field: TemperatureField): { level: number; path: [number, number, number, number][] }[] {
  const { points, triangles } = field.mesh;
  const values = field.temperature_k;
  const [low, high] = [Math.min(...values), Math.max(...values)];
  const levels: { level: number; path: [number, number, number, number][] }[] = [];
  for (let celsius = Math.ceil((low - 273.15 + 1) / 5) * 5; celsius + 273.15 < high; celsius += 5) {
    const level = celsius + 273.15;
    const path: [number, number, number, number][] = [];
    for (const [a, b, c] of triangles) {
      const crossing: [number, number][] = [];
      for (const [i, j] of [[a, b], [b, c], [c, a]]) {
        const [u, v] = [values[i], values[j]];
        if ((u < level) !== (v < level)) {
          const t = (level - u) / (v - u);
          crossing.push([points[i][0] + (points[j][0] - points[i][0]) * t, points[i][1] + (points[j][1] - points[i][1]) * t]);
        }
      }
      if (crossing.length === 2) path.push([crossing[0][0], crossing[0][1], crossing[1][0], crossing[1][1]]);
    }
    if (path.length) levels.push({ level: celsius, path });
  }
  return levels;
}

export interface CanvasEdit { depth: number; spacing: number | null; touching: number; kind: string; onChange: (key: DimensionKey, value: number) => Promise<void> }

export function SectionCanvas({ document, states, ambient, limiting, field, fieldNote, selected, onSelect, proposed, edit }: {
  document: DomainDocument; states?: CableState[]; ambient?: number; limiting?: string | null; field?: TemperatureField | null; fieldNote?: string;
  selected?: string | null; onSelect?: (cable: string | null) => void; proposed?: DomainDocument | null; edit?: CanvasEdit;
}) {
  const { ref, size } = useSize<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const paint = useRef<HTMLCanvasElement>(null);
  const [free, setFree] = useState<View | null>(null);
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [dimensions, setDimensions] = useState(true);
  const [showField, setShowField] = useState(true);
  const [cursor, setCursor] = useState<{ x: number; z: number } | null>(null);
  const [editing, setEditing] = useState<{ key: DimensionKey; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ key: DimensionKey; value: number } | null>(null);
  const [problem, setProblem] = useState('');
  const gesture = useRef<{ kind: 'cable' | 'pan'; id?: string; start: { x: number; y: number }; world: { x: number; z: number }; view: View; moved: boolean; axis?: 'x' | 'z' } | null>(null);

  const shape = useMemo(() => { try { return { now: sectionShape(document), next: proposed ? sectionShape(proposed) : null, error: '' }; }
    catch (error) { return { now: null, next: null, error: error instanceof Error ? error.message : String(error) }; } }, [document, proposed]);
  const contours = useMemo(() => field ? isotherms(field) : [], [field]);
  const section: Section = document.sections[0];
  const template = section.layout_template;
  const depth = drag?.key === 'depth_m' ? drag.value : template?.depth ?? 0;
  const spacing = drag?.key === 'spacing_m' ? drag.value : template?.spacing ?? null;
  const baseDepth = template?.depth ?? 0;
  const ratio = drag?.key === 'spacing_m' && template?.spacing ? drag.value / template.spacing : 1;
  // While a dimension is dragged, every object follows the template: scaled about its centre, moved with the depth.
  const place = (point: { x: number; z: number }) => ({ x: point.x * ratio, z: -depth + (point.z + baseDepth) * ratio });
  const cables: Placed[] = (shape.now?.cables ?? []).map(cable => ({ ...cable, ...place(cable) }));
  const ducts = (section.enclosures ?? []).map(duct => ({ ...duct, ...place(duct) }));
  const backfill = section.backfill ? { ...section.backfill, z: section.backfill.z - (depth - baseDepth) } : null;
  const outer = (id: string, radius: number) => { const duct = ducts.find(item => item.contains.includes(id)); return duct?.outer_diameter ? duct.outer_diameter / 2 : radius; };

  const group: Bounds = useMemo(() => {
    const bounds: Bounds = { left: Infinity, right: -Infinity, top: -Infinity, bottom: Infinity };
    const include = (x: number, z: number, halfWidth: number, halfHeight: number) => {
      bounds.left = Math.min(bounds.left, x - halfWidth); bounds.right = Math.max(bounds.right, x + halfWidth);
      bounds.top = Math.max(bounds.top, z + halfHeight); bounds.bottom = Math.min(bounds.bottom, z - halfHeight);
    };
    for (const cable of shape.now?.cables ?? []) include(cable.x, cable.z, cable.radius, cable.radius);
    for (const cable of shape.next?.cables ?? []) include(cable.x, cable.z, cable.radius, cable.radius);
    for (const duct of [...(section.enclosures ?? []), ...(proposed?.sections[0].enclosures ?? [])]) include(duct.x, duct.z, (duct.outer_diameter ?? 0) / 2, (duct.outer_diameter ?? 0) / 2);
    for (const region of [section.backfill, proposed?.sections[0].backfill]) if (region) include(region.x, region.z, region.width / 2, region.height / 2);
    return Number.isFinite(bounds.left) ? bounds : { left: -.5, right: .5, top: -.5, bottom: -1 };
  }, [shape, section, proposed]);

  // Composition: the whole section from the ground down; when the cables would be too small to read,
  // the group is drawn again, enlarged, in a framed detail beside a narrow overview.
  const composition = useMemo(() => {
    const stage = { x: 0, y: 0, width: size.width, height: Math.max(1, size.height - 58) };
    const whole = { ...group, top: Math.max(0, group.top) };
    const full = fitRect(whole, size, stage, 64);
    const radius = shape.now?.shape.radius ?? .02;
    const deep = -group.top > Math.max(.2, (group.top - group.bottom) * 2);
    if (size.width < 560 || !(2 * radius * size.width / full.widthM < 48 || deep)) return { main: full, detail: null };
    const mainWidth = Math.max(196, Math.min(260, size.width * .27));
    const rect = { x: mainWidth + 8, y: 14, width: size.width - mainWidth - 22, height: stage.height - 22 };
    const plot = { x: rect.x + 14, y: rect.y + 46, width: rect.width - 28, height: rect.height - 46 - 60 };
    const main = fitRect(whole, size, { x: 0, y: 14, width: mainWidth, height: stage.height - 22 }, 46);
    const view = fitRect(group, size, plot, Math.min(54, plot.height / 5));
    return { main, detail: { rect, plot, view, factor: main.widthM / view.widthM } };
  }, [group, size, shape.now]);
  const detail = free ? null : composition.detail;
  const main = free ?? composition.main;
  const objectView = detail?.view ?? main;
  const byId = new Map((states ?? []).map(state => [state.id, state]));
  const editable = !!edit && !proposed;
  const spacingEditable = editable && spacing !== null && LINEAR_SPACING.has(edit!.kind) && (shape.now?.cables.length ?? 0) > 1;

  // Temperature field: the plugin's published mesh, flat-shaded per triangle, clipped to the view it belongs to.
  useEffect(() => {
    const canvas = paint.current;
    if (!canvas || !size.width) return;
    const ratioPx = window.devicePixelRatio || 1;
    canvas.width = size.width * ratioPx; canvas.height = size.height * ratioPx;
    const context = canvas.getContext('2d')!;
    context.setTransform(ratioPx, 0, 0, ratioPx, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    if (!field || !showField || ambient === undefined || drag) return;
    const limit = states?.[0]?.limit_c ?? 90;
    const clip = detail?.plot ?? { x: 0, y: 0, width: size.width, height: size.height };
    context.save(); context.beginPath(); context.rect(clip.x, clip.y, clip.width, clip.height); context.clip();
    const screen = field.mesh.points.map(([x, z]) => toScreen({ x, z }, objectView, size));
    for (const [a, b, c] of field.mesh.triangles) {
      const mean = (field.temperature_k[a] + field.temperature_k[b] + field.temperature_k[c]) / 3 - 273.15;
      context.fillStyle = context.strokeStyle = heat(mean, ambient, limit);
      context.beginPath(); context.moveTo(screen[a].x, screen[a].y); context.lineTo(screen[b].x, screen[b].y); context.lineTo(screen[c].x, screen[c].y); context.closePath();
      context.fill(); context.stroke();
    }
    context.restore();
  }, [field, showField, ambient, states, objectView.x, objectView.z, objectView.widthM, size.width, size.height, detail?.plot.x, detail?.plot.width, drag]);

  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      setFree(view => zoomAt(view ?? composition.detail?.view ?? composition.main, event.deltaY > 0 ? 1.12 : 1 / 1.12, { x: event.clientX - box.left, y: event.clientY - box.top }, size));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [composition, size]);

  if (shape.error || !shape.now) return <div className="canvas"><div className="canvas-message">{shape.error}</div></div>;
  const local = (event: { clientX: number; clientY: number }) => { const box = svg.current!.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top }; };

  function pointerDown(event: ReactPointerEvent<SVGElement>, id?: string) {
    if (event.button === 2) return;
    const point = local(event);
    const panning = tool === 'pan' || event.button === 1 || !id;
    if (panning && (tool === 'pan' || event.button === 1)) {
      gesture.current = { kind: 'pan', start: point, world: toWorld(point, objectView, size), view: free ?? objectView, moved: false };
    } else if (id) {
      event.stopPropagation();
      gesture.current = { kind: 'cable', id, start: point, world: toWorld(point, objectView, size), view: objectView, moved: false };
    } else return;
    svg.current!.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const point = local(event);
    setCursor(toWorld(point, objectView, size));
    const active = gesture.current;
    if (!active) return;
    const [dx, dy] = [point.x - active.start.x, point.y - active.start.y];
    if (!active.moved && Math.hypot(dx, dy) < 5) return;
    active.moved = true;
    const mpp = active.view.widthM / size.width;
    if (active.kind === 'pan') { setFree({ ...active.view, x: active.view.x - dx * mpp, z: active.view.z + dy * mpp }); return; }
    if (!editable) return;
    const cable = shape.now!.cables.find(item => item.id === active.id)!;
    active.axis ??= spacingEditable && Math.abs(dx) > Math.abs(dy) && Math.abs(cable.x) > 1e-6 ? 'x' : 'z';
    if (active.axis === 'x') {
      const next = Math.max(edit!.touching, template!.spacing! * (cable.x + dx * mpp) / cable.x);
      setDrag({ key: 'spacing_m', value: Math.round(next / SNAP) * SNAP < edit!.touching ? edit!.touching : Math.round(next / SNAP) * SNAP });
    } else {
      const cover = group.top + baseDepth;                      // top of the group relative to its centre
      const next = Math.max(cover + SNAP, baseDepth + dy * mpp);
      setDrag({ key: 'depth_m', value: Math.round(next / SNAP) * SNAP });
    }
  }
  async function pointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const active = gesture.current;
    gesture.current = null;
    if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
    if (!active) return;
    if (active.kind === 'cable' && !active.moved) { onSelect?.(active.id!); return; }
    if (drag) {
      const pending = drag;
      try { setProblem(''); await edit!.onChange(pending.key, pending.value); } catch (error) { setProblem(error instanceof Error ? error.message : String(error)); } finally { setDrag(null); }
    }
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('input')) return;
    const key = event.key.toLowerCase();
    if (key === 'escape') { setEditing(null); onSelect?.(null); }
    if (key === 'f') setFree(null);
    if (key === 'v') setTool('select');
    if (key === 'h') setTool('pan');
    if (key === '+' || key === '=') setFree(zoomAt(free ?? objectView, 1 / 1.2, { x: size.width / 2, y: size.height / 2 }, size));
    if (key === '-') setFree(zoomAt(free ?? objectView, 1.2, { x: size.width / 2, y: size.height / 2 }, size));
  }

  const grid = (view: View, clip?: Rect) => {
    const step = 10 ** Math.floor(Math.log10(view.widthM / 8));
    const area = clip ?? { x: 0, y: 0, width: size.width, height: size.height };
    const [a, b] = [toWorld({ x: area.x, y: area.y + area.height }, view, size), toWorld({ x: area.x + area.width, y: area.y }, view, size)];
    const lines: string[] = [];
    for (let x = Math.ceil(a.x / step) * step; x <= b.x && lines.length < 120; x += step) lines.push(`M${toScreen({ x, z: 0 }, view, size).x} ${area.y}v${area.height}`);
    for (let z = Math.ceil(a.z / step) * step; z <= b.z && lines.length < 240; z += step) lines.push(`M${area.x} ${toScreen({ x: 0, z }, view, size).y}h${area.width}`);
    return <path className="drawing-grid" d={lines.join('')} />;
  };
  const ground = (view: View, width: number, label: boolean) => {
    const y = toScreen({ x: 0, z: 0 }, view, size).y;
    if (y < -20 || y > size.height) return null;
    return <g className="drawing-ground">
      <path d={`M0 ${y}H${width}`} />
      <path className="drawing-hatch" d={Array.from({ length: Math.ceil(width / 14) }, (_, index) => `M${index * 14 + 10} ${y}l-8 8`).join('')} />
      {label && <text className="drawing-text" x="12" y={y - 9}>地表 ±0.000 m</text>}
    </g>;
  };
  const rings = shape.now.shape.rings;
  const conductorIds = new Set(rings.filter(ring => ring.role === 'conductor').map(ring => ring.id));
  const tones: Record<Tone, string> = { conductor: 'conductor', semi: 'semi', insulation: 'insulation', metal: 'metal', sheath: 'sheath', fill: 'fill' };
  const ordered = [...rings.filter(ring => !ring.core).reverse(), ...rings.filter(ring => ring.core).reverse()];
  const objects = (view: View, mini: boolean) => {
    const scale = size.width / view.widthM;
    return <g>
      {backfill && (() => { const corner = toScreen({ x: backfill.x - backfill.width / 2, z: backfill.z + backfill.height / 2 }, view, size);
        return <g><rect className="drawing-region" x={corner.x} y={corner.y} width={backfill.width * scale} height={backfill.height * scale} />
          {!mini && <text className="drawing-text" x={corner.x + 10} y={corner.y + 20}>回填区</text>}</g>; })()}
      {ducts.map(duct => { const point = toScreen(duct, view, size);
        return <g key={duct.id}><circle className="drawing-duct-outer" cx={point.x} cy={point.y} r={(duct.outer_diameter ?? 0) * scale / 2} />
          <circle className="drawing-duct-inner" cx={point.x} cy={point.y} r={(duct.inner_diameter ?? 0) * scale / 2} /></g>; })}
      {cables.map(cable => {
        const point = toScreen(cable, view, size);
        const radius = cable.radius * scale;
        const state = byId.get(cable.id);
        const hot = state && ambient !== undefined ? heat(state.conductor_c, ambient, state.limit_c) : undefined;
        const drawn = mini || radius < 9 ? ordered.filter(ring => conductorIds.has(ring.id) || ring === ordered[0]) : ordered;
        return <g key={cable.id} className={`drawing-object ${proposed ? 'is-faded' : ''}`} data-cable={mini ? undefined : cable.id}
          onPointerDown={mini ? undefined : event => pointerDown(event, cable.id)}>
          {drawn.map(ring => <circle key={ring.id} cx={point.x + ring.cx * scale} cy={point.y - ring.cz * scale} r={Math.max(.6, ring.outer * scale)}
            className={`drawing-ring drawing-material-${tones[ring.tone]}`} style={hot && conductorIds.has(ring.id) ? { fill: hot } : undefined} />)}
          {!mini && <circle className="drawing-hit-area" cx={point.x} cy={point.y} r={Math.max(radius, 10)} />}
          {!mini && limiting === cable.id && <circle className="drawing-limit" cx={point.x} cy={point.y} r={outer(cable.id, cable.radius) * scale + 6} />}
          {!mini && selected === cable.id && <circle className="drawing-selection" cx={point.x} cy={point.y} r={outer(cable.id, cable.radius) * scale + 3} />}
        </g>;
      })}
    </g>;
  };
  const labels = (view: View) => {
    const scale = size.width / view.widthM;
    return <g className="drawing-labels">{cables.map(cable => {
      const point = toScreen(cable, view, size);
      const radius = outer(cable.id, cable.radius) * scale;
      const below = cables.some(other => other !== cable && Math.abs(other.x - cable.x) < cable.radius * 1.4 && other.z < cable.z - cable.radius);
      const stacked = cables.some(other => other !== cable && Math.abs(other.x - cable.x) < cable.radius * 1.4 && other.z > cable.z + cable.radius);
      const above = below && !stacked;
      const state = byId.get(cable.id);
      const name = document.circuits.length > 1 && cable.phase.length === 1 ? `R${document.circuits.findIndex(circuit => circuit.id === cable.circuit) + 1} ${cable.phase}`
        : cable.phase.length === 1 ? cable.phase : cableLabel(cable.id, document);
      const y = above ? point.y - radius - (state ? 28 : 10) : point.y + radius + 19;
      return <g key={cable.id} className={limiting === cable.id ? 'is-limiting' : ''}>
        <text className="drawing-text" x={point.x} y={y} textAnchor="middle">{name}</text>
        {state && <text className="drawing-text drawing-value" x={point.x} y={y + 17} textAnchor="middle">{fixed(state.conductor_c)} °C</text>}
      </g>;
    })}</g>;
  };
  const chip = (key: DimensionKey, label: string, value: string, x: number, y: number, canEdit: boolean, agent: boolean) =>
    <g className={`drawing-chip ${canEdit ? 'is-editable' : ''} ${agent ? 'is-agent' : ''}`} role={canEdit ? 'button' : undefined} tabIndex={canEdit ? 0 : undefined}
      aria-label={`${canEdit ? '编辑' : ''}${label} ${value}`} onPointerDown={event => event.stopPropagation()}
      onDoubleClick={() => { if (canEdit) setEditing({ key, x, y }); }} onClick={() => { if (canEdit) setEditing({ key, x, y }); }}
      onKeyDown={event => { if (canEdit && event.key === 'Enter') { event.stopPropagation(); setEditing({ key, x, y }); } }}>
      <text className="drawing-chip-label" x={x} y={y - 19} textAnchor="middle">{label}</text>
      <rect x={x - 43} y={y - 13} width="86" height="26" rx="13" />
      <text className="drawing-chip-value" x={x} y={y + 5} textAnchor="middle">{value}</text>
    </g>;
  const nextTemplate = proposed?.sections[0].layout_template;
  const depthShown = nextTemplate?.depth ?? depth;
  const spacingShown = nextTemplate ? nextTemplate.spacing ?? null : spacing;
  const depthView = main;
  const groundY = toScreen({ x: 0, z: 0 }, depthView, size).y;
  const depthY = toScreen({ x: 0, z: -depthShown }, depthView, size).y;
  const depthX = Math.max(30, toScreen({ x: group.left, z: 0 }, depthView, size).x - 26);
  const pair = cables.length > 1 ? [...cables].sort((a, b) => a.z - b.z || a.x - b.x).slice(0, 2).sort((a, b) => a.x - b.x) : null;
  const spacingY = pair ? Math.min((detail ? detail.rect.y + detail.rect.height : size.height - 58) - 30,
    toScreen({ x: 0, z: Math.min(...cables.map(cable => cable.z - outer(cable.id, cable.radius))) }, objectView, size).y + (states ? 58 : 40)) : 0;
  const selectedCable = cables.find(cable => cable.id === selected);
  const limit = states?.[0]?.limit_c ?? 90;

  return <div className="canvas" tabIndex={0} onKeyDown={keyDown} data-tool={tool}>
    <div ref={ref} className="canvas-stage">
      <canvas ref={paint} className="canvas-field" style={{ width: size.width, height: size.height }} />
      {size.width > 0 && <svg ref={svg} className="canvas-svg" width={size.width} height={size.height} role="img" aria-label="敷设截面，按比例绘制，单位 m"
        onPointerDown={event => { if (tool === 'pan' || event.button === 1) pointerDown(event); }} onPointerMove={pointerMove} onPointerUp={pointerUp}
        onPointerLeave={() => setCursor(null)} onClick={event => { if (event.target === event.currentTarget) onSelect?.(null); }} onDoubleClick={event => { if (event.target === event.currentTarget) setFree(null); }}>
        {!detail && !(field && showField) && grid(main)}
        {ground(main, detail ? detail.rect.x - 8 : size.width, true)}
        {objects(main, !!detail)}
        {detail && <>
          <g className="drawing-detail-source">{(() => {
            const centre = toScreen({ x: (group.left + group.right) / 2, z: (group.top + group.bottom) / 2 - (depth - baseDepth) }, main, size);
            const scale = size.width / main.widthM;
            const [rx, ry] = [Math.max(13, (group.right - group.left) * scale / Math.SQRT2 + 5), Math.max(13, (group.top - group.bottom) * scale / Math.SQRT2 + 5)];
            return <><ellipse className="drawing-leader" cx={centre.x} cy={centre.y} rx={rx} ry={ry} />
              <path className="drawing-leader" d={`M${centre.x + rx} ${centre.y}L${detail.rect.x} ${Math.min(detail.rect.y + detail.rect.height - 40, Math.max(detail.rect.y + 40, centre.y))}`} />
              <text className="drawing-text" x={centre.x} y={centre.y - ry - 7} textAnchor="middle">A</text></>;
          })()}</g>
          <rect className="drawing-detail-frame" x={detail.rect.x} y={detail.rect.y} width={detail.rect.width} height={detail.rect.height} rx="12" />
          <text className="drawing-text drawing-detail-title" x={detail.rect.x + 16} y={detail.rect.y + 27}>详图 A　放大 {fixed(detail.factor, 1)} 倍</text>
          <svg x={detail.plot.x} y={detail.plot.y} width={detail.plot.width} height={detail.plot.height} viewBox={`${detail.plot.x} ${detail.plot.y} ${detail.plot.width} ${detail.plot.height}`}>
            {!(field && showField) && grid(detail.view, detail.plot)}
            {field && showField && contours.map(level => <path key={level.level} className="drawing-isotherm"
              d={level.path.map(([x1, z1, x2, z2]) => { const [p, q] = [toScreen({ x: x1, z: z1 }, detail.view, size), toScreen({ x: x2, z: z2 }, detail.view, size)]; return `M${p.x} ${p.y}L${q.x} ${q.y}`; }).join('')} />)}
            {ground(detail.view, size.width, false)}
            {objects(detail.view, false)}
            {proposed && shape.next && <g className="drawing-proposed">
              {(proposed.sections[0].enclosures ?? []).map(duct => { const point = toScreen(duct, detail.view, size); return <circle key={duct.id} cx={point.x} cy={point.y} r={(duct.outer_diameter ?? 0) / 2 * size.width / detail.view.widthM} />; })}
              {shape.next.cables.map(cable => { const point = toScreen(cable, detail.view, size); return <circle key={cable.id} cx={point.x} cy={point.y} r={cable.radius * size.width / detail.view.widthM} />; })}
            </g>}
            {labels(detail.view)}
          </svg>
        </>}
        {!detail && field && showField && contours.map(level => <path key={level.level} className="drawing-isotherm"
          d={level.path.map(([x1, z1, x2, z2]) => { const [p, q] = [toScreen({ x: x1, z: z1 }, main, size), toScreen({ x: x2, z: z2 }, main, size)]; return `M${p.x} ${p.y}L${q.x} ${q.y}`; }).join('')} />)}
        {!detail && proposed && shape.next && <g className="drawing-proposed">
          {(proposed.sections[0].enclosures ?? []).map(duct => { const point = toScreen(duct, main, size); return <circle key={duct.id} cx={point.x} cy={point.y} r={(duct.outer_diameter ?? 0) / 2 * size.width / main.widthM} />; })}
          {shape.next.cables.map(cable => { const point = toScreen(cable, main, size); return <circle key={cable.id} cx={point.x} cy={point.y} r={cable.radius * size.width / main.widthM} />; })}
        </g>}
        {!detail && labels(main)}
        {dimensions && template?.depth !== undefined && groundY > -10 && <g className={`drawing-dimension ${nextTemplate && nextTemplate.depth !== template.depth ? 'is-agent' : ''}`}>
          <path d={`M${depthX} ${groundY}V${depthY}M${depthX - 6} ${groundY}h12M${depthX - 6} ${depthY}h12M${depthX} ${depthY}H${toScreen({ x: group.left, z: 0 }, depthView, size).x - 4}`} />
          {chip('depth_m', '中心埋深', `${compact(depthShown, 5)} m`, Math.max(52, depthX), (groundY + depthY) / 2 + 8, editable, !!nextTemplate && nextTemplate.depth !== template.depth)}
        </g>}
        {dimensions && pair && spacingShown !== null && <g className={`drawing-dimension ${nextTemplate && nextTemplate.spacing !== template?.spacing ? 'is-agent' : ''}`}>
          {(() => { const [a, b] = [toScreen(pair[0], objectView, size), toScreen(pair[1], objectView, size)];
            return <><path d={`M${a.x} ${spacingY - 24}H${b.x}M${a.x} ${spacingY - 30}v12M${b.x} ${spacingY - 30}v12`} />
              {chip('spacing_m', '中心距', `${compact(spacingShown * 1000, 5)} mm`, (a.x + b.x) / 2, spacingY + 12, spacingEditable, !!nextTemplate && nextTemplate.spacing !== template?.spacing)}</>; })()}
        </g>}
      </svg>}
      {editing && edit && <div className="canvas-editor" style={{ left: Math.max(8, Math.min(size.width - 232, editing.x - 110)), top: Math.max(8, Math.min(size.height - 140, editing.y + 18)) }}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setEditing(null); } }}>
        {editing.key === 'depth_m'
          ? <NumberField autoFocus label="中心埋深" unit="m" value={edit.depth} min={0} onCommit={async value => { await edit.onChange('depth_m', value!); setEditing(null); }} />
          : <NumberField autoFocus label="中心距" unit="mm" scale={1000} value={edit.spacing} min={0} onCommit={async value => { await edit.onChange('spacing_m', value!); setEditing(null); }} />}
      </div>}
      {drag && <div className="canvas-readout">{drag.key === 'depth_m' ? `中心埋深 ${compact(drag.value, 5)} m` : `中心距 ${compact(drag.value * 1000, 5)} mm`}</div>}
      {problem && <div className="canvas-problem" role="alert">{problem}</div>}
      {states && ambient !== undefined && <div className="canvas-legend">
        <strong>{field && showField ? '土壤与导体温度' : '导体温度'}</strong>
        <div className="ramp" />
        <div className="ramp-ends"><span>环境 {fixed(ambient, 0)} °C</span><span>温限 {fixed(limit, 0)} °C</span></div>
        {!field && fieldNote && <p>{fieldNote}</p>}
      </div>}
      {free && <button type="button" className="canvas-overview" aria-label="全图：点击回到整体视图" onClick={() => setFree(null)}>
        <span>全图</span>
        {(() => { const box = { width: 160, height: 88 }; const view = fitRect({ ...group, top: Math.max(0, group.top) }, box, { x: 0, y: 0, ...box }, 12);
          const [a, b] = [toScreen(toWorld({ x: 0, y: 0 }, free, size), view, box), toScreen(toWorld({ x: size.width, y: size.height }, free, size), view, box)];
          return <svg width={box.width} height={box.height}><path className="drawing-ground" d={`M0 ${toScreen({ x: 0, z: 0 }, view, box).y}H${box.width}`} />
            {cables.map(cable => { const point = toScreen(cable, view, box); return <circle key={cable.id} className="drawing-material-conductor" cx={point.x} cy={point.y} r={Math.max(2, cable.radius * box.width / view.widthM)} />; })}
            <rect className="drawing-window" x={a.x} y={a.y} width={Math.max(4, b.x - a.x)} height={Math.max(4, b.y - a.y)} /></svg>; })()}
      </button>}
      <div className="canvas-tools" role="toolbar" aria-label="截面工具">
        <IconButton icon="tool/select" label="选择 V" pressed={tool === 'select'} onClick={() => setTool('select')} />
        <IconButton icon="tool/pan" label="平移 H" pressed={tool === 'pan'} onClick={() => setTool('pan')} />
        <span className="canvas-tools-rule" />
        <IconButton icon="tool/zoom-out" label="缩小 −" onClick={() => setFree(zoomAt(free ?? objectView, 1.25, { x: size.width / 2, y: size.height / 2 }, size))} />
        <IconButton icon="tool/fit" label="适配 F" onClick={() => setFree(null)} />
        <IconButton icon="tool/zoom-in" label="放大 +" onClick={() => setFree(zoomAt(free ?? objectView, .8, { x: size.width / 2, y: size.height / 2 }, size))} />
        <span className="canvas-tools-rule" />
        <IconButton icon="tool/dimension" label="尺寸标注" pressed={dimensions} onClick={() => setDimensions(value => !value)} />
        {field && <IconButton icon="calc/thermal-field" label="土壤温度场" pressed={showField} onClick={() => setShowField(value => !value)} />}
      </div>
    </div>
    <footer className="canvas-status">
      <span>{section.label}</span>
      <span className="canvas-coordinates">{cursor ? `x ${fixed(cursor.x, 3)}　z ${fixed(cursor.z, 3)} m` : 'x —　z — m'}</span>
      {editable && <span>拖动电缆改埋深或间距，捕捉 {SNAP * 1000} mm；点尺寸可直接输入</span>}
      <span className="canvas-status-end">{selectedCable ? `${cableLabel(selectedCable.id, document)}　x ${fixed(selectedCable.x * 1000, 0)} mm　深 ${fixed(-selectedCable.z, 3)} m` : '未选中对象'}</span>
    </footer>
  </div>;
}

export function Legend({ children }: { children: ReactNode }) {
  return <div className="canvas-legend">{children}</div>;
}
