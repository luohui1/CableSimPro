// The cable cross-section and the small result graphics. Colours are the material and
// temperature roles of design/tokens.css; text sits beside the drawing, never on it.
import { useEffect, useRef, useState } from 'react';
import { compact, fixed } from '../shared/format.ts';
import { cableShape, heat, type Ring } from '../shared/geometry.ts';
import type { CableState, CableType, Material, SweepPoint } from '../shared/types.ts';

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

/** The cable drawn to scale with numbered leaders to each layer. */
export function CableDrawing({ cable, materials, selected, onSelect, compactView = false }: {
  cable: CableType; materials: Material[]; selected?: string | null; onSelect?: (ring: string | null) => void; compactView?: boolean;
}) {
  const { ref, size } = useSize<HTMLDivElement>();
  let shape;
  try { shape = cableShape(cable, materials); } catch (problem) {
    return <div className="canvas"><div className="canvas-message">{problem instanceof Error ? problem.message : String(problem)}</div></div>;
  }
  const first = cable.cores[0].id;
  const listed = compactView ? [] : shape.rings.filter(ring => !ring.core || ring.core === first);
  const labelWidth = compactView ? 0 : 236;
  const side = Math.max(40, Math.min(size.width - labelWidth - (compactView ? 16 : 72), size.height - (compactView ? 16 : 96)));
  const scale = side / (2 * shape.radius);
  const cx = compactView ? size.width / 2 : Math.max(side / 2 + 36, (size.width - labelWidth) / 2);
  const cy = compactView ? size.height / 2 : (size.height - 36) / 2;
  const step = Math.min(34, (size.height - 60) / Math.max(1, listed.length));
  const top = cy - step * (listed.length - 1) / 2;
  const labelX = Math.min(size.width - labelWidth + 24, cx + side / 2 + 64);
  const disc = (ring: Ring) => <circle key={ring.id} cx={cx + ring.cx * scale} cy={cy - ring.cz * scale} r={ring.outer * scale}
    className={`drawing-ring drawing-material-${ring.tone} ${selected === ring.id ? 'is-selected' : ''}`}
    onClick={event => { event.stopPropagation(); onSelect?.(ring.id); }} />;
  // Outer layers are painted first so each inner disc covers the one behind it.
  const common = shape.rings.filter(ring => !ring.core).reverse();
  const cores = cable.cores.flatMap(core => shape.rings.filter(ring => ring.core === core.id).reverse());
  const below = cy + side / 2 + 26;
  return <div ref={ref} className={`canvas-stage cable-stage ${compactView ? 'is-compact' : ''}`}>
    {size.width > 0 && <svg className="canvas-svg" width={size.width} height={size.height} role="img" aria-label="电缆截面，按比例绘制" onClick={() => onSelect?.(null)}>
      {common.map(disc)}{cores.map(disc)}
      {!compactView && <g className="drawing-dimension">
        <path d={`M${cx - side / 2} ${below}H${cx + side / 2}M${cx - side / 2} ${below - 6}v12M${cx + side / 2} ${below - 6}v12`} />
        <text className="drawing-text drawing-value" x={cx} y={below + 20} textAnchor="middle">外径 Ø {compact(shape.radius * 2000, 5)} mm</text>
      </g>}
      {listed.map((ring, index) => {
        // Anchor on the layer's mid radius, fanned over the right side of the drawn core.
        const angle = (-52 + 104 * (listed.length === 1 ? .5 : index / (listed.length - 1))) * Math.PI / 180;
        const radius = ring.inner === 0 && ring.role !== 'conductor' ? ring.outer - ring.size / 2 : (ring.inner + ring.outer) / 2;
        const ax = cx + (ring.cx + radius * Math.cos(angle)) * scale;
        const ay = cy - ring.cz * scale + radius * Math.sin(angle) * scale;
        const y = top + index * step;
        return <g key={ring.id} className={`drawing-callout ${selected === ring.id ? 'is-selected' : ''}`} role="button" tabIndex={0}
          aria-label={`${ring.name}，${compact(ring.size * 1000)} mm`} onClick={event => { event.stopPropagation(); onSelect?.(ring.id); }}
          onKeyDown={event => { if (event.key === 'Enter') onSelect?.(ring.id); }}>
          <path d={`M${ax} ${ay}L${labelX - 30} ${y}H${labelX - 12}`} />
          <circle className="drawing-callout-anchor" cx={ax} cy={ay} r="2.4" />
          <circle className="drawing-callout-bubble" cx={labelX} cy={y} r="11" />
          <text className="drawing-callout-number" x={labelX} y={y + 4.5} textAnchor="middle">{ring.number}</text>
          <text className="drawing-callout-name" x={labelX + 22} y={y + 5}>{ring.name.replace(/^芯 1 · /, '')}</text>
          <text className="drawing-callout-size" x={labelX + 208} y={y + 5} textAnchor="end">{ring.role === 'conductor' ? `Ø ${compact(ring.size * 1000)}` : compact(ring.size * 1000)} mm</text>
        </g>;
      })}
    </svg>}
  </div>;
}

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
    { key: 'conductor', label: '导体', value: state.losses_w_m.conductor, colour: 'var(--conductor)' },
    { key: 'sheath', label: '金属套', value: state.losses_w_m.sheath, colour: 'var(--material-metal)' },
    ...(state.losses_w_m.armour !== undefined ? [{ key: 'armour', label: '铠装', value: state.losses_w_m.armour, colour: 'var(--cad-sheath)' }] : []),
    { key: 'dielectric', label: '介质', value: state.losses_w_m.dielectric, colour: 'var(--temperature-2)' },
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
    <div className="path-node"><i style={{ background: heat(node.value, ambient, state.limit_c) }} /><span>{node.label}</span><strong>{fixed(node.value)} °C</strong></div>
  </div>)}</div>;
}

export function SweepChart({ points, label, unit }: { points: SweepPoint[]; label: string; unit: string }) {
  const { ref, size } = useSize<HTMLDivElement>();
  const valid = points.filter(point => typeof point.ampacity_a === 'number');
  if (valid.length < 2) return <div ref={ref} className="chart" />;
  const [left, right, top, bottom] = [72, 28, 40, 50];
  const xs = valid.map(point => point.value), ys = valid.map(point => point.ampacity_a!);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const pad = (Math.max(...ys) - Math.min(...ys)) * .12 || 1;
  const [y0, y1] = [Math.min(...ys) - pad, Math.max(...ys) + pad];
  const px = (value: number) => left + (value - x0) / (x1 - x0 || 1) * (size.width - left - right);
  const py = (value: number) => top + (y1 - value) / (y1 - y0) * (size.height - top - bottom);
  const ticks = [0, .25, .5, .75, 1].map(ratio => y0 + (y1 - y0) * ratio);
  const line = valid.map((point, index) => `${index ? 'L' : 'M'}${px(point.value)} ${py(point.ampacity_a!)}`).join('');
  return <div ref={ref} className="chart">
    {size.width > 0 && <svg width={size.width} height={size.height} role="img" aria-label={`允许电流随${label}的变化`}>
      {ticks.map(tick => <g key={tick}><line x1={left} x2={size.width - right} y1={py(tick)} y2={py(tick)} className="chart-grid" />
        <text x={left - 10} y={py(tick) + 5} textAnchor="end" className="chart-text">{fixed(tick, 0)}</text></g>)}
      <path d={`${line}L${px(x1)} ${size.height - bottom}L${px(x0)} ${size.height - bottom}Z`} className="chart-area" />
      <path d={line} className="chart-line" />
      {valid.map(point => <g key={point.case_id}><circle cx={px(point.value)} cy={py(point.ampacity_a!)} r="4.5" className="chart-dot" />
        <text x={px(point.value)} y={size.height - bottom + 20} textAnchor="middle" className="chart-text">{compact(point.value)}</text></g>)}
      <text x={(left + size.width - right) / 2} y={size.height - 8} textAnchor="middle" className="chart-text">{label}（{unit}）</text>
      <text x={left} y={18} className="chart-text">允许电流（A）</text>
    </svg>}
  </div>;
}
