// The live section: the protagonist of the workbench. True scale, no broken axis.
// Three layers share one camera: the GPU layer (soil, grid, field, isotherms), the SVG layer
// (cables, dimensions, isotherm values) and the HTML layer (cable labels, tools, legend, inset).
import { animate } from 'motion';
import { useEffect, useRef, useState } from 'react';
import { ToolButton, ToolGroup, ToolToggle } from '@/components/button';
import { Icon } from '@/components/icon';
import { NumberField } from '@/components/number-field';
import { Segmented } from '@/components/segmented';
import { cn } from '@/lib/cn';
import { rampPosition, readRamp } from '@/lib/ramp';
import { useTheme } from '@/state/theme';
import { useView, type Lens } from '@/state/view';
import { compact, fixed } from '@shared/format';
import { CableGlyph } from './cable-glyph';
import { frame, gridStep, mixCamera, toScreen, toWorld, zoomAt, type Camera, type Inset, type Size } from './camera';
import { FieldLayer } from './field-layer';
import { levelOnRay, type FieldModel } from './field-model';
import { beside, centred, textWidth, type Rect, type Side } from './labels';
import { Legend, Minimap } from './overlays';
import { lensBox, type Scene, type SceneCable } from './scene';

const INSET: Record<Lens, Inset> = {
  cluster: { top: 84, right: 48, bottom: 104, left: 48 },
  overview: { top: 36, right: 28, bottom: 36, left: 28 },
};
const STEP_K = 5;
const CHIP_HEIGHT = 26;
const RAY_ANGLES = [34, 146, -34, -146, 90, -90, 62, 118].map(degrees => (degrees * Math.PI) / 180);

interface Chip extends Rect { id: string; name: string; value: string | null; limiting: boolean }
interface IsoLabel extends Rect { level: number }
interface Span { x0: number; x1: number; y: number; from0: number; from1: number; label: string; rect: Rect }
interface Depth { x: number; top: number; bottom: number; broken: boolean; refX: number; label: string; rect: Rect }

/** Everything that depends on the camera: screen positions and a collision-free place for every label. */
function compose(scene: Scene, field: FieldModel | null, camera: Camera, size: Size, options: { dimensions: boolean; isotherms: boolean; result: boolean; capsules: boolean; reserved: Rect[] }) {
  // A dimension that can be changed is a capsule (a button); one that cannot is plain text.
  const pad = options.capsules ? 26 : 8;
  const tall = options.capsules ? 24 : 20;
  const point = (x: number, z: number) => toScreen(camera, size, x, z);
  const cables = scene.cables.map(cable => {
    const [sx, sy] = point(cable.x, cable.z);
    return { ...cable, sx, sy, r: cable.radius * camera.scale };
  });
  const area: Rect = { x: 8, y: 8, w: size.width - 16, h: size.height - 16 };
  const taken: Rect[] = [...options.reserved, ...cables.map(cable => ({ x: cable.sx - cable.r, y: cable.sy - cable.r, w: cable.r * 2, h: cable.r * 2 }))];
  const groundY = point(0, 0)[1];

  // Dimensions of the laying template.
  let span: Span | null = null;
  let depth: Depth | null = null;
  if (options.dimensions) {
    const pair = spacingPair(scene);
    if (pair) {
      const [a, b] = pair.map(item => cables.find(cable => cable.id === item.id) as (typeof cables)[number]);
      const y = Math.max(a.sy + a.r, b.sy + b.r) + 22;
      const label = `${compact(scene.spacing as number * 1000)} mm`;
      const width = textWidth(label) + pad;
      const rect = { x: (a.sx + b.sx) / 2 - width / 2, y: y + 7, w: width, h: tall };
      span = { x0: a.sx, x1: b.sx, y, from0: a.sy + a.r + 4, from1: b.sy + b.r + 4, label, rect };
      taken.push(rect, { x: a.sx - 4, y: a.sy + a.r, w: b.sx - a.sx + 8, h: y - a.sy - a.r + 4 });
    }
    if (scene.depth !== null) {
      const x = point(scene.group.left, 0)[0] - 34;
      const bottom = point(0, -scene.depth)[1];
      const broken = groundY < 56;
      const top = broken ? 64 : groundY;
      const label = `中心埋深 ${compact(scene.depth)} m`;
      const width = textWidth(label) + pad;
      const rect = { x: x - 10 - width, y: (top + bottom) / 2 - tall / 2, w: width, h: tall };
      if (bottom - top > 40 && rect.x > 8) {
        depth = { x, top, bottom, broken, refX: point(scene.group.left, 0)[0] - 5, label, rect };
        taken.push(rect, { x: x - 5, y: top, w: 10, h: bottom - top });
      }
    }
  }

  // Cable labels: the limiting cable first, so it always gets its best place.
  const centreX = (scene.group.left + scene.group.right) / 2;
  const centreZ = (scene.group.top + scene.group.bottom) / 2;
  const row = scene.cables.every(cable => Math.abs(cable.z - scene.cables[0].z) < 1e-6);
  const chips: Chip[] = [];
  const leaders: { id: string; x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const cable of [...cables].sort((a, b) => Number(b.limiting) - Number(a.limiting))) {
    const value = options.result && cable.state ? `${fixed(cable.state.conductor_c)} °C` : null;
    const width = Math.ceil(18 + textWidth(cable.name) + (value ? 8 + textWidth(value, 13, 600) : 0) + (cable.limiting && value ? 8 + textWidth('最热', 13, 600) : 0));
    const dx = cable.x - centreX;
    const dz = cable.z - centreZ;
    const order: Side[] = row || (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) ? ['n', 's', 'e', 'w']
      : Math.abs(dz) >= Math.abs(dx) * 0.9 ? (dz > 0 ? ['n', 'e', 'w', 's'] : ['s', 'e', 'w', 'n'])
      : dx > 0 ? ['e', 'n', 's', 'w'] : ['w', 'n', 's', 'e'];
    // Beside the cable if there is room; otherwise one or two rows further out, tied to the cable by a leader.
    let rect: (Rect & { side: Side }) | null = null;
    let lead = false;
    for (const gap of [9, 17 + CHIP_HEIGHT, 25 + CHIP_HEIGHT * 2]) {
      rect = beside({ x: cable.sx, y: cable.sy, r: cable.r }, width, CHIP_HEIGHT, order, taken, area, gap);
      lead = gap > 9;
      if (rect) break;
    }
    if (!rect) continue;
    taken.push(rect);
    chips.push({ ...rect, id: cable.id, name: cable.name, value, limiting: cable.limiting && Boolean(value) });
    if (lead) {
      const [x, y] = rect.side === 'n' ? [rect.x + rect.w / 2, rect.y + rect.h] : rect.side === 's' ? [rect.x + rect.w / 2, rect.y]
        : rect.side === 'e' ? [rect.x, rect.y + rect.h / 2] : [rect.x + rect.w, rect.y + rect.h / 2];
      const length = Math.hypot(x - cable.sx, y - cable.sy);
      leaders.push({ id: cable.id, x1: cable.sx + ((x - cable.sx) / length) * (cable.r + 3), y1: cable.sy + ((y - cable.sy) / length) * (cable.r + 3), x2: x, y2: y });
    }
  }

  // Isotherm values: on rays from the group for the outer lines, from each cable for the lines around it. Majors first.
  const labels: IsoLabel[] = [];
  if (options.isotherms && field?.kind === 'analytic') {
    const reach = Math.hypot(scene.group.right - scene.group.left, scene.group.top - scene.group.bottom) / 2 + 0.004;
    const origins: { at: [number, number]; from: number }[] = [
      { at: [centreX, centreZ], from: reach },
      ...scene.cables.map(cable => ({ at: [cable.x, cable.z] as [number, number], from: cable.radius + 0.004 })),
    ];
    const levels: number[] = [];
    for (let level = Math.ceil((field.ambient + 2.5) / STEP_K) * STEP_K; level < field.hottest; level += STEP_K) levels.push(level);
    for (const level of [...levels.filter(value => value % (STEP_K * 2) === 0), ...levels.filter(value => value % (STEP_K * 2) !== 0)]) {
      const width = textWidth(`${level} °C`) + 14;
      search: for (const origin of origins) {
        for (const angle of RAY_ANGLES) {
          const at = levelOnRay(field, level, origin.at, angle, origin.from, 8);
          if (!at || at[1] > -0.03) continue;
          const [sx, sy] = point(at[0], at[1]);
          const rect = centred(sx, sy, width, 22, taken, area);
          if (!rect) continue;
          taken.push(rect);
          labels.push({ ...rect, level });
          break search;
        }
      }
    }
  }
  return { cables, groundY, span, depth, chips, leaders, labels };
}

/** True when the main view already shows the whole section, so the inset would repeat it. */
function showsAll(scene: Scene, camera: Camera, size: Size) {
  const whole = lensBox(scene, 'overview');
  const [left, top] = toWorld(camera, size, 0, 0);
  const [right, bottom] = toWorld(camera, size, size.width, size.height);
  return left <= whole.left && right >= whole.right && bottom <= whole.bottom && top >= 0;
}

function spacingPair(scene: Scene): [SceneCable, SceneCable] | null {
  if (!scene.spacing) return null;
  const sorted = [...scene.cables].sort((a, b) => a.z - b.z || a.x - b.x);
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const [a, b] = [sorted[i], sorted[j]];
      if (Math.abs(a.z - b.z) < 1e-4 && Math.abs(Math.abs(a.x - b.x) - scene.spacing) < 5e-4) return a.x < b.x ? [a, b] : [b, a];
    }
  }
  return null;
}

/** Changing the laying on the drawing. Positions follow the laying template, so what changes is its depth and spacing. */
export interface SectionEdit {
  depth: number;
  /** The spacing in force (set or the template's default), when the template has one. */
  spacing: number | null;
  commit: (fields: { depth_m?: number; spacing_m?: number }) => void;
}
interface Ghost { axis: 'depth' | 'spacing'; depth: number; spacing: number | null; x: number; y: number }

const DEPTH_SNAP = 0.01;
const SPACING_SNAP = 0.005;
const snap = (value: number, step: number) => Math.round(value / step) * step;

export function SectionCanvas({ scene, field, result, notice, edit }: {
  scene: Scene;
  /** The soil field of the shown run, or null when there is none for this condition. */
  field: FieldModel | null;
  /** Whether cable temperatures of a result are shown. */
  result: boolean;
  notice: string | null;
  /** Null when what is shown cannot be changed (an earlier record). */
  edit: SectionEdit | null;
}) {
  const [editing, setEditing] = useState<'depth' | 'spacing' | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const shallowest = scene.shape.radius + 0.02;
  const tightest = scene.shape.radius * 2;
  const host = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLCanvasElement>(null);
  const layer = useRef<FieldLayer | null>(null);
  const live = useRef<Camera | null>(null);
  const motion = useRef<{ stop: () => void } | null>(null);
  const framed = useRef('');
  const moved = useRef(false);
  const press = useRef<{ x: number; y: number; camera: Camera; dragged: boolean; cable: string | null; axis?: 'depth' | 'spacing' } | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera | null>(null);
  const [gpu, setGpu] = useState<'pending' | 'webgpu' | 'webgl2' | 'none'>('pending');
  const theme = useTheme(state => state.theme);
  const { lens, layers, selected, hovered } = useView();
  const { setLens, toggleLayer, select, hover, setCursor } = useView.getState();
  const [ramp, setRamp] = useState(readRamp);

  const apply = (next: Camera) => {
    live.current = next;
    setCamera(next);
  };
  const glide = (to: Camera) => {
    motion.current?.stop();
    const from = live.current;
    if (!from) return apply(to);
    motion.current = animate(0, 1, { duration: 0.32, ease: [0.2, 0, 0, 1], onUpdate: t => apply(mixCamera(from, to, t)) });
  };
  const home = (which: Lens) => frame(lensBox(scene, which), size, INSET[which]);
  const limits = () => ({ min: home('overview').scale * 0.5, max: 9000 });

  useEffect(() => setRamp(readRamp()), [theme]);

  useEffect(() => {
    const element = host.current as HTMLDivElement;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A new lens or a new geometry glides to its frame; a resize keeps what the engineer was looking at.
  useEffect(() => {
    if (!size.width || !size.height) return;
    const key = `${lens}/${scene.key}`;
    const to = frame(lensBox(scene, lens), size, INSET[lens]);
    if (framed.current !== key) {
      framed.current = key;
      moved.current = false;
      glide(to);
    } else if (!moved.current) {
      motion.current?.stop();
      apply(to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the camera follows lens, geometry and size only
  }, [lens, scene.key, size.width, size.height]);

  useEffect(() => {
    const created = new FieldLayer(surface.current as HTMLCanvasElement);
    layer.current = created;
    let alive = true;
    void created.ready.then(() => { if (alive) setGpu(created.backend ?? 'none'); });
    return () => {
      alive = false;
      created.dispose();
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    if (gpu === 'pending' || gpu === 'none') return;
    const style = getComputedStyle(document.documentElement);
    layer.current?.setContent(layers.field ? field : null, {
      ramp, limit: scene.limit, ambient: scene.ambient, step: STEP_K, isotherms: layers.isotherms,
      ink: style.getPropertyValue('--text').trim(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the isotherm switch has its own effect
  }, [gpu, field, layers.field, ramp, scene.limit, scene.ambient]);

  useEffect(() => layer.current?.setIsotherms(layers.isotherms), [layers.isotherms, gpu]);

  useEffect(() => {
    if (camera && size.width && gpu !== 'pending') layer.current?.setView(camera, size, gridStep(camera.scale));
  }, [camera, size, gpu, field, layers.field, ramp]);

  // The wheel must not scroll the page, so it cannot be a passive listener.
  useEffect(() => {
    const element = host.current as HTMLDivElement;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!live.current) return;
      const bounds = element.getBoundingClientRect();
      motion.current?.stop();
      moved.current = true;
      apply(zoomAt(live.current, size, event.clientX - bounds.left, event.clientY - bounds.top, Math.exp(-event.deltaY * 0.0016), limits()));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- limits depend on size and geometry
  }, [size.width, size.height, scene.key]);

  const local = (event: { clientX: number; clientY: number }) => {
    const bounds = (host.current as HTMLDivElement).getBoundingClientRect();
    return [event.clientX - bounds.left, event.clientY - bounds.top] as const;
  };
  const cableAt = (sx: number, sy: number) => {
    if (!live.current) return null;
    const [x, z] = toWorld(live.current, size, sx, sy);
    const pad = 4 / live.current.scale;
    return scene.cables.find(cable => Math.hypot(cable.x - x, cable.z - z) <= cable.radius + pad)?.id ?? null;
  };

  const inset = Boolean(camera && size.width && !showsAll(scene, camera, size));
  // Whether the soil shows its temperature: a field exists for this condition, its layer is on, and a GPU path runs.
  const shaded = Boolean(field) && layers.field && gpu !== 'none';
  const view = camera && size.width ? compose(scene, layers.field ? field : null, camera, size, {
    dimensions: layers.dimensions, isotherms: layers.isotherms && layers.field && gpu !== 'none', result, capsules: Boolean(edit),
    reserved: [
      { x: 0, y: 0, w: 132, h: 60 },
      { x: size.width - 236, y: 0, w: 236, h: shaded && layers.isotherms ? 116 : 84 },
      { x: 0, y: size.height - 60, w: 300, h: 60 },
      ...(inset ? [{ x: size.width - 192, y: size.height - 128, w: 192, h: 128 }] : []),
      ...(notice ? [{ x: size.width / 2 - 190, y: 0, w: 380, h: 56 }] : []),
    ],
  }) : null;
  const paper = ramp.field(0);
  const ruleColour = 'var(--text-secondary)';

  // Dragging a cable moves the whole laying: up and down changes the depth, sideways changes the spacing.
  // The drawing shows where the cables would go; the host places them when the pointer is released.
  const drag = (held: NonNullable<typeof press.current>, x: number, y: number) => {
    if (!edit || !held.cable) return;
    held.axis ??= Math.abs(x - held.x) > Math.abs(y - held.y) ? 'spacing' : 'depth';
    if (held.axis === 'depth') {
      setGhost({ axis: 'depth', depth: Math.max(shallowest, snap(edit.depth + (y - held.y) / held.camera.scale, DEPTH_SNAP)), spacing: edit.spacing, x, y });
      return;
    }
    const target = scene.cables.find(cable => cable.id === held.cable);
    const centre = scene.cables.reduce((sum, cable) => sum + cable.x, 0) / scene.cables.length;
    const lever = target && edit.spacing ? (target.x - centre) / edit.spacing : 0;
    // A cable on the centre line does not set the spacing.
    if (!edit.spacing || Math.abs(lever) < 0.25) return;
    setGhost({ axis: 'spacing', depth: edit.depth, spacing: Math.max(tightest, snap(edit.spacing + (x - held.x) / held.camera.scale / lever, SPACING_SNAP)), x, y });
  };
  const ghosts = ghost && edit && camera ? (() => {
    const centreX = scene.cables.reduce((sum, cable) => sum + cable.x, 0) / scene.cables.length;
    const centreZ = scene.cables.reduce((sum, cable) => sum + cable.z, 0) / scene.cables.length;
    const ratio = ghost.spacing && edit.spacing ? ghost.spacing / edit.spacing : 1;
    return scene.cables.map(cable => ({
      id: cable.id,
      at: toScreen(camera, size, centreX + (cable.x - centreX) * ratio, centreZ + (cable.z - centreZ) * ratio - (ghost.depth - edit.depth)),
      r: cable.radius * camera.scale,
    }));
  })() : null;

  return <div ref={host} data-gpu={gpu} tabIndex={0}
    className={cn('absolute inset-0 touch-none overflow-hidden outline-none select-none active:cursor-grabbing', edit && hovered ? 'cursor-move' : 'cursor-grab')}
    onKeyDown={event => {
      if (!edit || !selected || event.target !== event.currentTarget) return;
      const stride = event.shiftKey ? 5 : 1;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        edit.commit({ depth_m: Math.max(shallowest, snap(edit.depth + (event.key === 'ArrowDown' ? 1 : -1) * DEPTH_SNAP * stride, DEPTH_SNAP)) });
      } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && edit.spacing) {
        event.preventDefault();
        edit.commit({ spacing_m: Math.max(tightest, snap(edit.spacing + (event.key === 'ArrowRight' ? 1 : -1) * SPACING_SNAP * stride, SPACING_SNAP)) });
      }
    }}
    onPointerDown={event => {
      if (event.button !== 0 || !live.current) return;
      const [x, y] = local(event);
      press.current = { x, y, camera: live.current, dragged: false, cable: edit ? cableAt(x, y) : null };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const [x, y] = local(event);
      if (live.current) setCursor(toWorld(live.current, size, x, y));
      const held = press.current;
      if (!held) return hover(cableAt(x, y));
      if (!held.dragged && Math.hypot(x - held.x, y - held.y) < 4) return;
      held.dragged = true;
      if (held.cable) return drag(held, x, y);
      moved.current = true;
      motion.current?.stop();
      apply({ ...held.camera, cx: held.camera.cx - (x - held.x) / held.camera.scale, cz: held.camera.cz + (y - held.y) / held.camera.scale });
    }}
    onPointerUp={event => {
      const held = press.current;
      press.current = null;
      if (held && !held.dragged) return select(cableAt(...local(event)));
      if (ghost && edit) {
        if (ghost.axis === 'depth' && Math.abs(ghost.depth - edit.depth) > 1e-9) edit.commit({ depth_m: ghost.depth });
        if (ghost.axis === 'spacing' && ghost.spacing && Math.abs(ghost.spacing - (edit.spacing ?? 0)) > 1e-9) edit.commit({ spacing_m: ghost.spacing });
      }
      setGhost(null);
    }}
    onPointerLeave={() => { setCursor(null); hover(null); }}>

    <canvas ref={surface} className="absolute inset-0 size-full" />

    {view && camera && <svg width={size.width} height={size.height} className="absolute inset-0" role="img" aria-label="敷设断面">
      <defs>
        <pattern id="ground-hatch" width={8} height={8} patternUnits="userSpaceOnUse">
          <path d="M0 8 8 0" stroke="var(--text-weak)" strokeWidth={1} />
        </pattern>
      </defs>
      {gpu === 'none' && <rect x={0} y={Math.max(0, view.groundY)} width={size.width} height={size.height} fill={paper} />}

      {view.groundY > -12 && view.groundY < size.height + 12 && <g>
        <rect x={0} y={view.groundY} width={size.width} height={7} fill="url(#ground-hatch)" />
        <line x1={0} x2={size.width} y1={view.groundY} y2={view.groundY} stroke="var(--text)" strokeWidth={1.25} />
        {view.groundY > 44 && <text x={16} y={view.groundY - 9} fontSize={13} fill="var(--text-secondary)">地表 ±0.000</text>}
      </g>}

      {scene.backfill && (() => {
        const [x, y] = toScreen(camera, size, scene.backfill.x - scene.backfill.width / 2, scene.backfill.z + scene.backfill.height / 2);
        return <rect x={x} y={y} width={scene.backfill.width * camera.scale} height={scene.backfill.height * camera.scale}
          fill="color-mix(in oklab, var(--panel) 34%, transparent)" stroke="var(--text-secondary)" strokeWidth={1} strokeDasharray="6 4" />;
      })()}

      {scene.ducts.map(duct => {
        const [x, y] = toScreen(camera, size, duct.x, duct.z);
        return <g key={duct.id}>
          <circle cx={x} cy={y} r={((duct.outer_diameter ?? 0) / 2) * camera.scale} fill="color-mix(in oklab, var(--material-metal) 60%, var(--panel))"
            stroke="color-mix(in oklab, var(--text) 38%, transparent)" strokeWidth={0.75} />
          <circle cx={x} cy={y} r={((duct.inner_diameter ?? 0) / 2) * camera.scale} fill="var(--panel)" />
        </g>;
      })}

      {view.span && <g stroke={ruleColour} strokeWidth={1} fill="none">
        <path d={`M${view.span.x0} ${view.span.from0}V${view.span.y + 5}M${view.span.x1} ${view.span.from1}V${view.span.y + 5}M${view.span.x0} ${view.span.y}H${view.span.x1}`} />
        <path d={`M${view.span.x0 - 4} ${view.span.y + 4}l8 -8M${view.span.x1 - 4} ${view.span.y + 4}l8 -8`} strokeWidth={1.5} />
        {!edit && <text x={view.span.rect.x + view.span.rect.w / 2} y={view.span.rect.y + 10} textAnchor="middle" dominantBaseline="central" fontSize={13}
          fill="var(--text)" stroke="none">{view.span.label}</text>}
      </g>}

      {view.depth && <g stroke={ruleColour} strokeWidth={1} fill="none">
        <path d={`M${view.depth.x} ${view.depth.top + (view.depth.broken ? 14 : 0)}V${view.depth.bottom}M${view.depth.x - 5} ${view.depth.bottom}H${view.depth.refX}`} />
        {view.depth.broken
          ? <path d={`M${view.depth.x} ${view.depth.top - 8}v6l-5 3 10 4 -5 3v6`} />
          : <path d={`M${view.depth.x - 4} ${view.depth.top + 4}l8 -8`} strokeWidth={1.5} />}
        <path d={`M${view.depth.x - 4} ${view.depth.bottom + 4}l8 -8`} strokeWidth={1.5} />
        {!edit && <text x={view.depth.rect.x + view.depth.rect.w / 2} y={view.depth.rect.y + 10} textAnchor="middle" dominantBaseline="central" fontSize={13}
          fill="var(--text)" stroke="none">{view.depth.label}</text>}
      </g>}

      {ghosts?.map(item => <circle key={item.id} cx={item.at[0]} cy={item.at[1]} r={item.r} fill="color-mix(in oklab, var(--panel) 45%, transparent)"
        stroke="var(--text)" strokeWidth={1.5} strokeDasharray="6 4" />)}

      {view.cables.map(cable => <g key={cable.id} data-cable={cable.id}>
        <g style={{ filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / .3))' }}>
          <CableGlyph shape={scene.shape} x={cable.sx} y={cable.sy} scale={camera.scale}
            conductor={result && cable.state ? ramp.css(rampPosition(cable.state.conductor_c, scene.ambient, scene.limit)) : undefined} />
        </g>
        {cable.limiting && result && <circle cx={cable.sx} cy={cable.sy} r={cable.r + 3.5} fill="none" stroke="var(--text)" strokeWidth={1.5} />}
        {(cable.id === selected || cable.id === hovered) && <circle cx={cable.sx} cy={cable.sy} r={cable.r + 7} fill="none"
          stroke={cable.id === selected ? 'var(--text)' : 'var(--text-weak)'} strokeWidth={cable.id === selected ? 2 : 1.25} strokeDasharray={cable.id === selected ? undefined : '4 3'} />}
      </g>)}

      {view.leaders.map(leader => <line key={leader.id} x1={leader.x1} y1={leader.y1} x2={leader.x2} y2={leader.y2} stroke={ruleColour} strokeWidth={1} />)}

      {view.labels.map(label => <g key={label.level}>
        <rect x={label.x} y={label.y} width={label.w} height={label.h} rx={6} fill="var(--panel)" fillOpacity={0.9} />
        <text x={label.x + label.w / 2} y={label.y + label.h / 2 + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={13} fill="var(--text)">
          {label.level} °C
        </text>
      </g>)}
    </svg>}

    {view?.chips.map(chip => <div key={chip.id} data-chip={chip.id}
      className={cn('pointer-events-none absolute top-0 left-0 flex items-center gap-2 rounded-field px-[9px] text-13 whitespace-nowrap',
        chip.limiting ? 'bg-ink text-panel' : 'border border-line bg-panel text-ink shadow-lift')}
      style={{ translate: `${Math.round(chip.x)}px ${Math.round(chip.y)}px`, width: chip.w, height: chip.h }}>
      <span className={chip.limiting ? 'opacity-80' : 'text-ink-2'}>{chip.name}</span>
      {chip.value && <span className="font-strong">{chip.value}</span>}
      {chip.limiting && <span className="font-strong">最热</span>}
    </div>)}

    {/* Dimensions that can be changed: a capsule opens a number field in its place. */}
    {edit && view && ([['depth', view.depth, edit.depth, 'm', 1, shallowest] as const, ['spacing', view.span, edit.spacing, 'mm', 1000, tightest] as const]).map(([which, dimension, value, unit, scale, least]) =>
      dimension && value !== null && <div key={which} className="absolute top-0 left-0" onPointerDown={event => event.stopPropagation()}
        style={{ translate: `${Math.round(Math.min(dimension.rect.x, size.width - 176))}px ${Math.round(dimension.rect.y)}px` }}>
        {editing === which
          ? <NumberField autoFocus value={Number((value * scale).toFixed(4))} unit={unit} min={least * scale} step={which === 'depth' ? 0.05 : 5} digits={which === 'depth' ? 3 : 1}
            className="rounded-field shadow-lift" onLeave={() => setEditing(null)}
            onCommit={next => { if (next !== null) edit.commit(which === 'depth' ? { depth_m: next } : { spacing_m: next / 1000 }); }} />
          : <button type="button" data-dimension={which} onClick={() => setEditing(which)} style={{ width: dimension.rect.w, height: dimension.rect.h }}
            className="flex cursor-text items-center justify-center rounded-full border border-control bg-panel text-13 whitespace-nowrap text-ink shadow-lift transition-colors duration-fast ease-std hover:border-ink">
            {dimension.label}
          </button>}
      </div>)}

    {ghost && <div className="pointer-events-none absolute top-0 left-0 flex h-7 items-center rounded-field bg-ink px-2.5 text-13 font-strong whitespace-nowrap text-panel"
      style={{ translate: `${Math.round(ghost.x + 16)}px ${Math.round(ghost.y - 36)}px` }}>
      {ghost.axis === 'depth' ? `中心埋深 ${compact(ghost.depth)} m` : `中心距 ${compact((ghost.spacing ?? 0) * 1000)} mm`}
    </div>}

    <div data-overlays className="pointer-events-none absolute inset-0 *:pointer-events-auto *:absolute" onPointerDown={event => event.stopPropagation()}>
      <ToolGroup className="top-3 left-3 cursor-default">
        <ToolToggle icon="result/field" label="温度场" pressed={layers.field} onChange={() => toggleLayer('field')} />
        <ToolToggle icon="result/radial" label="等温线" pressed={layers.isotherms} onChange={() => toggleLayer('isotherms')} />
        <ToolToggle icon="tool/dimension" label="尺寸" pressed={layers.dimensions} onChange={() => toggleLayer('dimensions')} />
      </ToolGroup>

      {notice && <div className="top-3 left-1/2 flex h-8 -translate-x-1/2 cursor-default items-center gap-2 rounded-full border border-line bg-panel px-3 text-13 text-ink-2 shadow-lift">
        <Icon name="status/info" className="size-4" />{gpu === 'none' ? '这台设备不能用 GPU 绘图，温度场没有显示' : notice}
      </div>}

      <div className="top-3 right-3 cursor-default">
        <Legend ramp={ramp} ambient={scene.ambient} limit={scene.limit} soil={shaded} lines={shaded && layers.isotherms ? STEP_K : null} />
      </div>

      <div className="bottom-3 left-3 flex cursor-default items-center gap-2">
        <div className="rounded-card border border-line bg-panel p-1 shadow-lift">
          <Segmented label="视图" value={lens} onChange={setLens} options={[{ value: 'cluster', label: '电缆簇' }, { value: 'overview', label: '全景' }]} />
        </div>
        <ToolGroup>
          <ToolButton icon="tool/zoom-out" label="缩小" onClick={() => live.current && glide(zoomAt(live.current, size, size.width / 2, size.height / 2, 1 / 1.5, limits()))} />
          <ToolButton icon="tool/fit" label="回到这个视图的全貌" onClick={() => { moved.current = false; glide(home(lens)); }} />
          <ToolButton icon="tool/zoom-in" label="放大" onClick={() => live.current && glide(zoomAt(live.current, size, size.width / 2, size.height / 2, 1.5, limits()))} />
        </ToolGroup>
      </div>

      {camera && inset && <div className="right-3 bottom-3 cursor-default"><Minimap scene={scene} camera={camera} size={size} paper={paper} /></div>}
    </div>
  </div>;
}
