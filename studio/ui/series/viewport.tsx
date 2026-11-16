// The object view: the selected size drawn to scale from its saved layers, with numbered balloons for its parts,
// the overall diameter dimensioned, zoom and pan, and the plugin-built solid as a second view of the same version.
import { ChevronLeft, ChevronRight, Maximize, Tags } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { compact } from '@shared/format';
import type { CableShape } from '@shared/geometry';
import type { SpecView } from '@shared/types';
import { CableGlyph } from '@/canvas/cable-glyph';
import { partSize, partUnit, partVerdict, type Part } from './model';

const Solid = lazy(() => import('./solid').then(module => ({ default: module.Solid })));
export type ViewMode = 'section' | 'solid';

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

const NICE = [.5, 1, 2, 5, 10, 20, 50, 100];

/** Balloons sit on a circle around the cable, spread over its right side in part order, clear of the view's
 *  title bar above and the diameter dimension below. */
function balloons(parts: Part[], centre: { x: number; y: number }, radius: number, scale: number, height: number) {
  const orbit = radius + 40;
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  const top = Math.max(-75, Math.asin(clamp((60 - centre.y) / orbit)) * 180 / Math.PI);
  const bottom = Math.min(48, Math.asin(clamp((height - 60 - centre.y) / orbit)) * 180 / Math.PI);
  const step = Math.max(26 / orbit * 180 / Math.PI, 7);
  const spread = Math.min(bottom - top, step * Math.max(0, parts.length - 1));
  const middle = Math.max(top + spread / 2, Math.min(bottom - spread / 2, (top + bottom) / 2 - 6));
  // The layers of an off-centre core are thin and close together; their anchors fan out around the core's right
  // side in part order, so each leader leaves from a point of its own.
  const offCentre = parts.filter(part => part.ring.core && Math.hypot(part.ring.cx, part.ring.cz) > 1e-9);
  return parts.map((part, index) => {
    const angle = (parts.length === 1 ? middle : middle - spread / 2 + spread * index / (parts.length - 1)) * Math.PI / 180;
    const balloon = { x: centre.x + orbit * Math.cos(angle), y: centre.y + orbit * Math.sin(angle) };
    const ring = part.ring;
    const ringCentre = { x: centre.x + ring.cx * scale, y: centre.y - ring.cz * scale };
    const fan = offCentre.indexOf(part);
    const towards = fan >= 0 && offCentre.length > 1 ? (-72 + 112 * fan / (offCentre.length - 1)) * Math.PI / 180
      : Math.atan2(balloon.y - ringCentre.y, balloon.x - ringCentre.x);
    // The anchor lies inside the part, on the side facing its balloon: mid-thickness for a layer, half radius for a conductor.
    const reach = (ring.inner > 0 ? (ring.inner + ring.outer) / 2 : part.role === 'filler' ? ring.outer - (ring.outer - ring.inner) * .02 : ring.outer * .55) * scale;
    const filler = part.role === 'filler' ? Math.max(0, ring.outer * scale - Math.max(1.5, ring.size * scale / 2)) : reach;
    const anchor = { x: ringCentre.x + filler * Math.cos(towards), y: ringCentre.y + filler * Math.sin(towards) };
    return { part, balloon, anchor };
  });
}

function Section({ view, shape, parts, selected, onSelect, annotate }: {
  view: SpecView; shape: CableShape; parts: Part[]; selected: string | null; onSelect: (role: string | null) => void; annotate: boolean;
}) {
  const [ref, size] = useSize();
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; camera: typeof camera; moved: boolean } | null>(null);
  useEffect(() => setCamera({ zoom: 1, x: 0, y: 0 }), [view.version.id]);
  const { width, height } = size;
  const wide = width > 560;
  const base = width && height ? Math.min((wide ? width * .52 : width * .62) / (2 * shape.radius), (height - 96) / (2 * shape.radius)) : 0;
  const scale = base * camera.zoom;
  const centre = { x: (wide ? width * .42 : width / 2) + camera.x, y: height / 2 - 8 + camera.y };
  const radius = shape.radius * scale;
  const placed = useMemo(() => (annotate && base ? balloons(parts, centre, radius, scale, height) : []), [annotate, base, parts, centre.x, centre.y, radius, scale, height]);
  const focus = parts.find(part => part.role === selected);
  const barMm = NICE.find(value => value * 1e-3 * scale >= 60) ?? 100;

  const wheel = (event: React.WheelEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * .0015);
    const zoom = Math.min(40, Math.max(.4, camera.zoom * factor));
    const ratio = zoom / camera.zoom;
    const px = event.clientX - rect.left, py = event.clientY - rect.top;
    // Keep the point under the pointer where it is while the scale changes.
    setCamera({ zoom, x: px - (px - centre.x) * ratio - (centre.x - camera.x), y: py - (py - centre.y) * ratio - (centre.y - camera.y) });
  };
  const down = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, camera, moved: false };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent) => {
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > 3) start.moved = true;
    if (start.moved) setCamera({ ...start.camera, x: start.camera.x + dx, y: start.camera.y + dy });
  };
  const up = (event: ReactPointerEvent) => {
    const start = drag.current;
    drag.current = null;
    if (start && !start.moved) {
      // A click picks the innermost part under the pointer, as the drawing paints them.
      const element = document.elementFromPoint(event.clientX, event.clientY) as SVGElement | null;
      onSelect(element?.dataset.role ?? null);
    }
  };

  const hits = [...shape.rings].sort((a, b) => (a.core ? 1 : 0) - (b.core ? 1 : 0) || b.outer - a.outer);
  const veil = focus?.rings ?? [];
  return <div ref={ref} className="ws-section" onWheel={wheel} onPointerDown={down} onPointerMove={move} onPointerUp={up}
    onDoubleClick={() => setCamera({ zoom: 1, x: 0, y: 0 })} data-panning={drag.current?.moved ? '' : undefined}>
    {base > 0 && <svg width={width} height={height} role="img" aria-label={`${view.spec.key} 实际尺寸断面`}>
      <defs>
        <mask id="ws-focus-mask">
          <rect width={width} height={height} fill="white" />
          {veil.map(ring => <g key={ring.id}>
            <circle cx={centre.x + ring.cx * scale} cy={centre.y - ring.cz * scale} r={ring.outer * scale} fill="black" />
            {ring.inner > 0 && <circle cx={centre.x + ring.cx * scale} cy={centre.y - ring.cz * scale} r={ring.inner * scale} fill="white" />}
          </g>)}
        </mask>
      </defs>
      <CableGlyph shape={shape} x={centre.x} y={centre.y} scale={scale} />
      {focus && <rect width={width} height={height} className="ws-veil" mask="url(#ws-focus-mask)" />}
      {focus && veil.map(ring => <g key={ring.id} className="ws-focus-ring">
        <circle cx={centre.x + ring.cx * scale} cy={centre.y - ring.cz * scale} r={ring.outer * scale} />
        {ring.inner > 0 && <circle cx={centre.x + ring.cx * scale} cy={centre.y - ring.cz * scale} r={ring.inner * scale} />}
      </g>)}
      {hits.map(ring => <circle key={ring.id} data-role={ring.role} className="ws-hit" cx={centre.x + ring.cx * scale} cy={centre.y - ring.cz * scale}
        r={ring.outer * scale}><title>{ring.name}</title></circle>)}
      {/* Overall diameter, dimensioned under the drawing */}
      <g className="ws-dimension">
        <path d={`M${centre.x - radius} ${centre.y + 6}V${centre.y + radius + 30} M${centre.x + radius} ${centre.y + 6}V${centre.y + radius + 30}`} className="ws-extension" />
        <path d={`M${centre.x - radius} ${centre.y + radius + 24}H${centre.x + radius}`} markerStart="url(#ws-arrow)" markerEnd="url(#ws-arrow)" />
        <text x={centre.x} y={centre.y + radius + 18} textAnchor="middle">Ø {(shape.radius * 2000).toFixed(1)}</text>
      </g>
      <defs><marker id="ws-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1.5L10 5L0 8.5z" className="ws-arrowhead" /></marker></defs>
      {placed.map(({ part, balloon, anchor }) => {
        const verdict = partVerdict(view, part.role);
        const active = part.role === selected;
        return <g key={part.role} className="ws-balloon" data-active={active ? '' : undefined} data-verdict={verdict ?? undefined}
          onPointerDown={event => event.stopPropagation()} onClick={() => onSelect(active ? null : part.role)}>
          <path d={`M${anchor.x} ${anchor.y}L${balloon.x - 11 * Math.cos(Math.atan2(balloon.y - anchor.y, balloon.x - anchor.x))} ${balloon.y - 11 * Math.sin(Math.atan2(balloon.y - anchor.y, balloon.x - anchor.x))}`} className="ws-leader" />
          <circle cx={anchor.x} cy={anchor.y} r={2.4} className="ws-anchor" />
          <circle cx={balloon.x} cy={balloon.y} r={11} className="ws-balloon-disc" />
          <text x={balloon.x} y={balloon.y + 4.2} textAnchor="middle">{part.number}</text>
          {active && <g className="ws-callout">
            <rect x={balloon.x + 16} y={balloon.y - 12} width={20 + part.name.length * 13 + (partSize(part) + partUnit(part)).length * 7.6} height={24} rx={4} />
            <text x={balloon.x + 25} y={balloon.y + 4.5}>{part.name}<tspan dx="6" className="ws-callout-value">{partSize(part)}{partUnit(part)}</tspan></text>
          </g>}
          <title>{`${part.number} ${part.name} ${partSize(part)}${partUnit(part)}`}</title>
        </g>;
      })}
      {/* Scale bar */}
      <g className="ws-scale" transform={`translate(16 ${height - 22})`}>
        <path d={`M0 0H${barMm * 1e-3 * scale} M0 -4V4 M${barMm * 1e-3 * scale} -4V4`} />
        <text x={barMm * 1e-3 * scale + 8} y={4.5}>{compact(barMm)} mm</text>
      </g>
    </svg>}
  </div>;
}

export function Viewport({ view, shape, parts, selected, onSelect, mode, onMode, previous, next, onStep }: {
  view: SpecView | undefined; shape: CableShape | null; parts: Part[]; selected: string | null; onSelect: (role: string | null) => void;
  mode: ViewMode; onMode: (mode: ViewMode) => void; previous?: string; next?: string; onStep: (direction: -1 | 1) => void;
}) {
  const [annotate, setAnnotate] = useState(true);
  const [fitKey, setFitKey] = useState(0);
  return <section className="ws-viewport" aria-label="对象视图">
    <div className="ws-viewport-bar">
      <div className="ws-viewport-title">{view ? <><b>{view.spec.key}</b><span>{mode === 'section' ? '断面 · 实际比例' : '三维实体 · CadQuery'}</span>
        {view.version.number !== view.versions[0]?.number && <span className="ws-history-flag">第 {view.version.number} 版 · 历史</span>}</> : <span>读取规格…</span>}</div>
      <div className="ws-viewport-tools">
        <div className="ws-segmented" role="radiogroup" aria-label="视图">
          {([['section', '断面'], ['solid', '三维实体']] as const).map(([value, label]) =>
            <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => onMode(value)}>{label}</button>)}
        </div>
        {mode === 'section' && <>
          <button type="button" className="ws-icon-button" aria-pressed={annotate} aria-label="部位标注" title="部位标注" onClick={() => setAnnotate(!annotate)}><Tags size={16} /></button>
          <button type="button" className="ws-icon-button" aria-label="适合窗口" title="适合窗口（双击画面）" onClick={() => setFitKey(fitKey + 1)}><Maximize size={16} /></button>
        </>}
      </div>
    </div>
    <div className="ws-viewport-body">
      {!view || !shape ? <p className="ws-viewport-empty">{view ? '这个规格没有可绘制的结构。' : '正在读取规格…'}</p>
        : mode === 'section' ? <Section key={`${view.version.id}-${fitKey}`} view={view} shape={shape} parts={parts} selected={selected} onSelect={onSelect} annotate={annotate} />
          : <Suspense fallback={<p className="ws-viewport-empty">正在载入三维显示…</p>}><Solid view={view} selected={selected} /></Suspense>}
    </div>
    <div className="ws-stepper" aria-label="切换规格">
      <button type="button" disabled={!previous} onClick={() => onStep(-1)} aria-label={previous ? `上一个规格 ${previous}` : '没有上一个规格'}><ChevronLeft size={16} />{previous && <span>{previous}</span>}</button>
      <b>{view?.spec.key ?? ''}</b>
      <button type="button" disabled={!next} onClick={() => onStep(1)} aria-label={next ? `下一个规格 ${next}` : '没有下一个规格'}>{next && <span>{next}</span>}<ChevronRight size={16} /></button>
    </div>
  </section>;
}
