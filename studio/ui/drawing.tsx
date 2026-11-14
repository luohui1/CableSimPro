// Drawings of the workbench: cable cross-section, laying section and the small result graphics.
// Text sits in fixed gutters (dimension left and below, legend right) so it cannot overlap the drawing.
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { compact, fixed, PHASE_NAMES } from '../shared/format.ts';
import { cableShape, fit, heat, sectionShape, type Ring, type Tone } from '../shared/geometry.ts';
import type { CableState, CableType, DomainDocument, Material, SweepPoint } from '../shared/types.ts';

const TONE_FILL: Record<Tone, string> = {
  conductor: '#c8793a', semi: '#454b57', insulation: '#ebe5d3', metal: '#a3abb5', sheath: '#2c3440', fill: '#d6d0c2',
};

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
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
    if (cable) return `${document.circuits.length > 1 ? circuit.label + ' · ' : ''}${PHASE_NAMES[cable.phase] ?? cable.phase}`;
  }
  return id;
}

// ---- Cable cross-section ----

export function CableDrawing({ cable, materials, selected, onSelect }: {
  cable: CableType; materials: Material[]; selected?: string | null; onSelect?: (ring: string | null) => void;
}) {
  const { ref, size } = useSize<HTMLDivElement>();
  let shape;
  try { shape = cableShape(cable, materials); } catch (problem) {
    return <div className="canvas"><div className="canvas-message">{problem instanceof Error ? problem.message : String(problem)}</div></div>;
  }
  const first = cable.cores[0].id;
  const listed = shape.rings.filter(ring => !ring.core || ring.core === first);
  const labelWidth = 218;
  const side = Math.max(60, Math.min(size.width - labelWidth - 48, size.height - 48));
  const scale = side / (2 * shape.radius);
  const cx = Math.max(side / 2 + 24, (size.width - labelWidth) / 2);
  const cy = size.height / 2;
  const step = Math.min(30, (size.height - 40) / Math.max(1, listed.length));
  const top = cy - step * (listed.length - 1) / 2;
  const labelX = Math.min(size.width - labelWidth + 6, cx + side / 2 + 44);
  const disc = (ring: Ring) => <circle key={ring.id} cx={cx + ring.cx * scale} cy={cy - ring.cz * scale} r={ring.outer * scale}
    fill={TONE_FILL[ring.tone]} stroke={selected === ring.id ? 'var(--accent)' : 'rgba(0,0,0,.28)'} strokeWidth={selected === ring.id ? 2.5 : .6}
    className="ring" onClick={event => { event.stopPropagation(); onSelect?.(ring.id); }} />;
  // Outer layers are painted first so each inner disc covers the one behind it.
  const common = shape.rings.filter(ring => !ring.core).reverse();
  const cores = cable.cores.map(core => shape.rings.filter(ring => ring.core === core.id).reverse());
  return <div ref={ref} className="canvas">
    {size.width > 0 && <svg width={size.width} height={size.height} role="img" aria-label="电缆截面，按比例绘制" onClick={() => onSelect?.(null)}>
      {common.map(disc)}{cores.flat().map(disc)}
      {listed.map((ring, index) => {
        // Anchor on the ring's mid radius, fanned over the right side of the drawn core.
        const angle = (-58 + 116 * (listed.length === 1 ? .5 : index / (listed.length - 1))) * Math.PI / 180;
        const radius = ring.inner === 0 && ring.role !== 'conductor' ? ring.outer - ring.size / 2 : (ring.inner + ring.outer) / 2;
        const ax = cx + (ring.cx + radius * Math.cos(angle)) * scale;
        const ay = cy - ring.cz * scale + radius * Math.sin(angle) * scale;
        const y = top + index * step;
        const active = selected === ring.id;
        return <g key={ring.id} className={`callout ${active ? 'is-active' : ''}`} onClick={event => { event.stopPropagation(); onSelect?.(ring.id); }}>
          <path d={`M${ax} ${ay}L${labelX - 14} ${y}H${labelX - 4}`} />
          <circle cx={ax} cy={ay} r="2.2" />
          <text x={labelX} y={y + 5}><tspan className="callout-number">{ring.number}</tspan><tspan dx="8">{ring.name.replace(/^芯 1 · /, '')}</tspan>
            <tspan dx="10" className="callout-value">{ring.role === 'conductor' ? `Ø ${compact(ring.size * 1000)}` : compact(ring.size * 1000)} mm</tspan></text>
        </g>;
      })}
      <text x={cx} y={Math.min(size.height - 10, cy + side / 2 + 24)} textAnchor="middle" className="dimension-text">外径 {compact(shape.radius * 2000, 5)} mm</text>
    </svg>}
  </div>;
}

// ---- Laying section ----

export function SectionDrawing({ document, states, ambient, limiting, selected, onSelect, proposed, facts, focus: initial }: {
  document: DomainDocument; states?: CableState[]; ambient?: number; limiting?: string | null; selected?: string | null;
  onSelect?: (cable: string | null) => void; proposed?: DomainDocument | null; facts?: ReactNode; focus?: 'all' | 'group';
}) {
  const { ref, size } = useSize<HTMLDivElement>();
  const [chosen, setChosen] = useState<'all' | 'group' | null>(initial ?? null);
  let now, next;
  try {
    now = sectionShape(document);
    next = proposed ? sectionShape(proposed) : null;
  } catch (problem) {
    return <div className="canvas"><div className="canvas-message">{problem instanceof Error ? problem.message : String(problem)}</div></div>;
  }
  const section = document.sections[0];
  const shown = next ? [now, next] : [now];
  const whole = { left: Math.min(...shown.map(item => item.bounds.left)), right: Math.max(...shown.map(item => item.bounds.right)), top: 0,
                  bottom: Math.min(...shown.map(item => item.bounds.bottom)) };
  const sections = proposed ? [section, proposed.sections[0]] : [section];
  const groupTop = Math.max(...shown.flatMap(item => item.cables.map(cable => cable.z + cable.radius)),
    ...sections.flatMap(item => (item.enclosures ?? []).map(duct => duct.z + (duct.outer_diameter ?? 0) / 2)),
    ...sections.map(item => item.backfill ? item.backfill.z + item.backfill.height / 2 : -Infinity));
  const legendWidth = 212;
  const width = Math.max(200, size.width - legendWidth);
  const overview = fit(whole, width, size.height, { top: 54, right: 28, bottom: 62, left: 118 });
  // Cables too small to tell apart in the whole section start in the close view of the group.
  const focus = chosen ?? (now.shape.radius * overview.scale < 12 ? 'group' : 'all');
  const pad = Math.max(.05, .28 * Math.max(whole.right - whole.left, groupTop - whole.bottom));
  const view = focus === 'all' ? overview
    : fit({ left: whole.left - pad, right: whole.right + pad, bottom: whole.bottom, top: Math.min(0, groupTop + pad) }, width, size.height,
          { top: 64, right: 24, bottom: 62, left: 24 });
  const byId = new Map((states ?? []).map(state => [state.id, state]));
  const ground = view.y(0);
  const groundShown = ground > 30;
  const conductors = now.shape.rings.filter(ring => ring.role === 'conductor');
  const template = (proposed ?? document).sections[0].layout_template;
  const sorted = [...(next ?? now).cables].sort((a, b) => a.x - b.x || b.z - a.z);
  const pair = sorted.length > 1 ? sorted.slice(0, 2) : null;
  const depthX = view.x(whole.left) - 40;
  const spacingY = Math.min(size.height - 30, view.y(whole.bottom) + 26);
  const before = section.layout_template;
  const tone = (changed: boolean) => next && changed ? 'var(--agent)' : 'var(--text)';
  return <div ref={ref} className="canvas canvas-section">
    {size.width > 0 && <svg width={width} height={size.height} role="img" aria-label="敷设截面，按比例绘制" onClick={() => onSelect?.(null)}>
      <rect x="0" y={Math.max(0, ground)} width={width} height={Math.max(0, size.height - Math.max(0, ground))} className="soil" />
      {groundShown && <><line x1="0" y1={ground} x2={width} y2={ground} className="ground" />
        <text x="14" y={ground - 10} className="dimension-text">地表</text></>}
      {section.backfill && <rect x={view.x(section.backfill.x - section.backfill.width / 2)} y={view.y(section.backfill.z + section.backfill.height / 2)}
        width={section.backfill.width * view.scale} height={section.backfill.height * view.scale} className="backfill" />}
      {(section.enclosures ?? []).map(duct => <circle key={duct.id} cx={view.x(duct.x)} cy={view.y(duct.z)}
        r={((duct.outer_diameter ?? 0) + (duct.inner_diameter ?? 0)) / 4 * view.scale} className="duct"
        strokeWidth={Math.max(1.5, ((duct.outer_diameter ?? 0) - (duct.inner_diameter ?? 0)) / 2 * view.scale)} />)}
      {now.cables.map(cable => {
        const state = byId.get(cable.id);
        const [x, y, r] = [view.x(cable.x), view.y(cable.z), cable.radius * view.scale];
        return <g key={cable.id} className={`cable ${selected === cable.id ? 'is-selected' : ''} ${next ? 'is-faded' : ''}`}
          onClick={event => { event.stopPropagation(); onSelect?.(cable.id); }}>
          <circle cx={x} cy={y} r={r} className="cable-body" />
          {conductors.map(ring => <circle key={ring.id} cx={x + ring.cx * view.scale} cy={y - ring.cz * view.scale} r={ring.outer * view.scale}
            fill={state && ambient !== undefined ? heat(state.conductor_c, ambient, state.limit_c) : TONE_FILL.conductor} />)}
          {limiting === cable.id && <circle cx={x} cy={y} r={r + 5} className="cable-limit" />}
          {selected === cable.id && <circle cx={x} cy={y} r={r + 2.5} className="cable-select" />}
          {r >= 12 && cable.phase.length === 1 && <text x={x} y={y + 5} textAnchor="middle" className="cable-phase">{cable.phase}</text>}
        </g>;
      })}
      {next && <g className="proposed">
        {(proposed!.sections[0].enclosures ?? []).map(duct => <circle key={duct.id} cx={view.x(duct.x)} cy={view.y(duct.z)} r={(duct.outer_diameter ?? 0) / 2 * view.scale} />)}
        {next.cables.map(cable => <circle key={cable.id} cx={view.x(cable.x)} cy={view.y(cable.z)} r={cable.radius * view.scale} />)}
      </g>}
      {template?.depth !== undefined && (focus === 'all' && groundShown
        ? <g className="dimension" style={{ color: tone(template.depth !== before?.depth) }}>
          <path d={`M${depthX} ${ground}V${view.y(-template.depth)}M${depthX - 6} ${ground}h12M${depthX - 6} ${view.y(-template.depth)}h12`} />
          <text x={depthX - 10} y={(ground + view.y(-template.depth)) / 2 - 3} textAnchor="end" className="dimension-text">中心埋深</text>
          <text x={depthX - 10} y={(ground + view.y(-template.depth)) / 2 + 15} textAnchor="end" className="dimension-value">{compact(template.depth)} m</text>
        </g>
        : <g className="dimension" style={{ color: tone(template.depth !== before?.depth) }}>
          <text x="14" y="26" className="dimension-value">中心埋深 {compact(template.depth)} m</text>
          {!groundShown && <text x="14" y="46" className="dimension-text">地表在图的上方</text>}
        </g>)}
      {pair && template?.spacing && <g className="dimension" style={{ color: tone(template.spacing !== before?.spacing) }}>
        <path d={`M${view.x(pair[0].x)} ${spacingY}H${view.x(pair[1].x)}M${view.x(pair[0].x)} ${spacingY - 6}v12M${view.x(pair[1].x)} ${spacingY - 6}v12`} />
        <text x={(view.x(pair[0].x) + view.x(pair[1].x)) / 2} y={spacingY + 21} textAnchor="middle" className="dimension-value">中心距 {compact(template.spacing * 1000, 5)} mm</text>
      </g>}
    </svg>}
    <div className="canvas-tools" style={{ right: legendWidth + 12 }} role="group" aria-label="视图范围">
      <button type="button" aria-pressed={focus === 'all'} onClick={() => setChosen('all')}>全景</button>
      <button type="button" aria-pressed={focus === 'group'} onClick={() => setChosen('group')}>电缆组</button>
    </div>
    <aside className="legend" style={{ width: legendWidth }}>
      {facts}
      <ul>
        {now.cables.map(cable => {
          const state = byId.get(cable.id);
          return <li key={cable.id}>
            <button type="button" className={`legend-row ${selected === cable.id ? 'is-selected' : ''}`} onClick={() => onSelect?.(cable.id)}>
              <span className="swatch" style={{ background: state && ambient !== undefined ? heat(state.conductor_c, ambient, state.limit_c) : TONE_FILL.conductor }} />
              <span className="legend-name">{cableLabel(cable.id, document)}</span>
              <span className="legend-value">{state ? `${fixed(state.conductor_c)} °C` : `深 ${compact(-cable.z, 4)} m`}</span>
              {limiting === cable.id && <span className="legend-flag">先到温限</span>}
            </button>
          </li>;
        })}
      </ul>
      {next && <div className="legend-proposed">虚线为 Agent 提议的布置</div>}
    </aside>
  </div>;
}

// ---- Result graphics ----

/** Conductor temperature on a scale from the ambient to the limit. */
export function TemperatureScale({ value, ambient, limit }: { value: number; ambient: number; limit: number }) {
  const span = Math.max(1, Math.max(limit, value) - ambient) * 1.06;
  const at = (temperature: number) => `${Math.max(0, Math.min(100, (temperature - ambient) / span * 100))}%`;
  return <div className="scale" role="img" aria-label={`导体 ${fixed(value)} °C，温限 ${fixed(limit, 0)} °C`}>
    <div className="scale-track"><div className="scale-fill" style={{ width: at(value), background: heat(value, ambient, limit) }} />
      <div className="scale-limit" style={{ left: at(limit) }} /></div>
    <div className="scale-labels"><span>环境 {fixed(ambient, 0)} °C</span><span className="scale-limit-label" style={{ left: at(limit) }}>温限 {fixed(limit, 0)} °C</span></div>
  </div>;
}

/** Saved load against the permissible current. */
export function LoadBar({ load, ampacity }: { load: number; ampacity: number }) {
  const over = load > ampacity;
  const top = Math.max(load, ampacity) * 1.04;
  return <div className="scale" role="img" aria-label={`负荷 ${fixed(load, 0)} A，允许 ${fixed(ampacity)} A`}>
    <div className="scale-track"><div className={`scale-fill ${over ? 'is-over' : 'is-load'}`} style={{ width: `${load / top * 100}%` }} />
      <div className="scale-limit" style={{ left: `${ampacity / top * 100}%` }} /></div>
    <div className="scale-labels"><span>0 A</span><span className="scale-limit-label" style={{ left: `${ampacity / top * 100}%` }}>允许 {fixed(ampacity)} A</span></div>
  </div>;
}

export function LossBar({ state }: { state: CableState }) {
  const parts = [
    { key: 'conductor', label: '导体', value: state.losses_w_m.conductor, colour: '#c8793a' },
    { key: 'sheath', label: '护套', value: state.losses_w_m.sheath, colour: '#7d8794' },
    ...(state.losses_w_m.armour !== undefined ? [{ key: 'armour', label: '铠装', value: state.losses_w_m.armour, colour: '#4a5563' }] : []),
    { key: 'dielectric', label: '介质', value: state.losses_w_m.dielectric, colour: '#d9c76a' },
  ];
  const total = state.losses_w_m.total;
  return <div className="share">
    <div className="share-bar">{parts.map(part => <div key={part.key} style={{ width: `${part.value / total * 100}%`, background: part.colour }} />)}</div>
    <div className="share-labels">{parts.map(part => <div key={part.key}><span className="swatch" style={{ background: part.colour }} />
      <span>{part.label}</span><strong>{fixed(part.value, 2)} W/m</strong><span>{fixed(part.value / total * 100, 0)}%</span></div>)}</div>
  </div>;
}

/** Heat path of one cable: temperatures at the nodes, thermal resistance and drop on each link. */
export function HeatPath({ state, ambient }: { state: CableState; ambient: number }) {
  const ducted = state.thermal_k_m_w.t4_wall > 0;
  const nodes: { label: string; value: number }[] = [{ label: '导体', value: state.conductor_c }, { label: '金属套', value: state.sheath_c }];
  const links: { label: string; value: number }[] = [{ label: 'T1 绝缘', value: state.thermal_k_m_w.t1 }];
  if (state.thermal_k_m_w.t2 !== undefined && state.armour_c !== undefined && state.armour_c !== null) {
    nodes.push({ label: '铠装', value: state.armour_c });
    links.push({ label: 'T2 内衬', value: state.thermal_k_m_w.t2 });
  }
  nodes.push({ label: '电缆表面', value: state.surface_c });
  links.push({ label: 'T3 外护套', value: state.thermal_k_m_w.t3 });
  if (ducted && state.duct_inner_c !== undefined && state.duct_outer_c !== undefined) {
    nodes.push({ label: '管内壁', value: state.duct_inner_c }, { label: '管外壁', value: state.duct_outer_c });
    links.push({ label: 'T4 管内空气', value: state.thermal_k_m_w.t4_air }, { label: 'T4 管壁', value: state.thermal_k_m_w.t4_wall });
  }
  nodes.push({ label: '环境', value: ambient });
  links.push({ label: 'T4 土壤', value: state.thermal_k_m_w.t4_soil });
  return <div className="path">{nodes.map((node, index) => <div key={node.label} className="path-item">
    {index > 0 && <div className="path-link"><span>{links[index - 1].label}</span><strong>{fixed(links[index - 1].value, 3)} K·m/W</strong>
      <span>降 {fixed(nodes[index - 1].value - node.value)} K</span></div>}
    <div className="path-node" style={{ borderColor: heat(node.value, ambient, state.limit_c) }}><span>{node.label}</span><strong>{fixed(node.value)} °C</strong></div>
  </div>)}</div>;
}

export function SweepChart({ points, label, unit }: { points: SweepPoint[]; label: string; unit: string }) {
  const { ref, size } = useSize<HTMLDivElement>();
  const valid = points.filter(point => typeof point.ampacity_a === 'number');
  if (valid.length < 2) return <div ref={ref} className="chart" />;
  const [left, right, top, bottom] = [70, 24, 40, 48];
  const xs = valid.map(point => point.value), ys = valid.map(point => point.ampacity_a!);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const pad = (Math.max(...ys) - Math.min(...ys)) * .12 || 1;
  const [y0, y1] = [Math.min(...ys) - pad, Math.max(...ys) + pad];
  const px = (value: number) => left + (value - x0) / (x1 - x0 || 1) * (size.width - left - right);
  const py = (value: number) => top + (y1 - value) / (y1 - y0) * (size.height - top - bottom);
  const ticks = [0, .25, .5, .75, 1].map(ratio => y0 + (y1 - y0) * ratio);
  return <div ref={ref} className="chart">
    {size.width > 0 && <svg width={size.width} height={size.height} role="img" aria-label={`允许电流随${label}的变化`}>
      {ticks.map(tick => <g key={tick}><line x1={left} x2={size.width - right} y1={py(tick)} y2={py(tick)} className="chart-grid" />
        <text x={left - 10} y={py(tick) + 5} textAnchor="end" className="dimension-text">{fixed(tick, 0)}</text></g>)}
      <path d={valid.map((point, index) => `${index ? 'L' : 'M'}${px(point.value)} ${py(point.ampacity_a!)}`).join('')} className="chart-line" />
      {valid.map(point => <g key={point.case_id}><circle cx={px(point.value)} cy={py(point.ampacity_a!)} r="4.5" className="chart-dot" />
        <text x={px(point.value)} y={size.height - bottom + 20} textAnchor="middle" className="dimension-text">{compact(point.value)}</text></g>)}
      <text x={(left + size.width - right) / 2} y={size.height - 8} textAnchor="middle" className="dimension-text">{label}（{unit}）</text>
      <text x={left} y={18} className="dimension-text">允许电流（A）</text>
    </svg>}
  </div>;
}
