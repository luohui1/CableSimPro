// The curve of a parameter sweep: the allowed current against the one condition that was changed. Plain on purpose: two
// axes, the points the method computed joined in order, and the saved load as a dashed line. A point the method refused is
// not drawn (the table beside the curve says why). The charts of the interface will replace this when they exist.
import { useEffect, useRef, useState } from 'react';
import { compact, fixed } from '@shared/format';

export interface CurvePoint { value: number; ampacity: number | null }

const MARGIN = { top: 24, right: 28, bottom: 52, left: 64 };

/** Round numbers to put on an axis between two values, about `target` of them. */
function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const lead = raw / power;
  const step = (lead < 1.5 ? 1 : lead < 3.5 ? 2 : lead < 7.5 ? 5 : 10) * power;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step - 1e-9) * step; value <= max + step * 1e-9; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

export function SweepCurve({ points, xLabel, load, active, onActive }: {
  points: CurvePoint[];
  /** The swept condition with its unit: 土壤热阻率 K·m/W. */
  xLabel: string;
  /** The saved load of the project, when the sweep leaves it as it is. */
  load?: number;
  /** The point whose row is selected in the table beside the curve. */
  active?: number;
  onActive?: (index: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const drawn = points.flatMap((point, index) => (typeof point.ampacity === 'number' ? [{ index, value: point.value, ampacity: point.ampacity }] : []));
  const { width, height } = size;
  const plot = { width: width - MARGIN.left - MARGIN.right, height: height - MARGIN.top - MARGIN.bottom };
  let body = null;
  if (drawn.length && plot.width > 40 && plot.height > 40) {
    const xs = drawn.map(point => point.value);
    const ys = [...drawn.map(point => point.ampacity), ...(load === undefined ? [] : [load])];
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const spread = Math.max(...ys) - Math.min(...ys) || Math.max(...ys) * 0.1 || 1;
    const [y0, y1] = [Math.min(...ys) - spread * 0.1, Math.max(...ys) + spread * 0.1];
    const px = (value: number) => MARGIN.left + ((value - x0) / (x1 - x0 || 1)) * plot.width;
    const py = (value: number) => MARGIN.top + ((y1 - value) / (y1 - y0)) * plot.height;
    const bottom = MARGIN.top + plot.height;
    body = <>
      {niceTicks(y0, y1).map(tick => <g key={`y${tick}`}>
        <line x1={MARGIN.left} x2={MARGIN.left + plot.width} y1={py(tick)} y2={py(tick)} className="stroke-line" strokeWidth={1} />
        <text x={MARGIN.left - 10} y={py(tick)} textAnchor="end" dominantBaseline="central" fontSize={13} className="fill-ink-2">{compact(tick)}</text>
      </g>)}
      {niceTicks(x0, x1, 6).map(tick => <text key={`x${tick}`} x={px(tick)} y={bottom + 20} textAnchor="middle" fontSize={13} className="fill-ink-2">{compact(tick)}</text>)}
      <path d={`M${MARGIN.left} ${MARGIN.top}V${bottom}H${MARGIN.left + plot.width}`} fill="none" className="stroke-line-strong" strokeWidth={1} />
      <text x={MARGIN.left + plot.width / 2} y={height - 8} textAnchor="middle" fontSize={13} className="fill-ink">{xLabel}</text>
      <text x={MARGIN.left} y={MARGIN.top - 8} fontSize={13} className="fill-ink">允许电流 A</text>
      {load !== undefined && <g>
        <line x1={MARGIN.left} x2={MARGIN.left + plot.width} y1={py(load)} y2={py(load)} className="stroke-ink-2" strokeWidth={1} strokeDasharray="6 4" />
        <text x={MARGIN.left + plot.width - 4} y={py(load) - 8} textAnchor="end" fontSize={13} className="fill-ink-2">保存负荷 {compact(load)} A</text>
      </g>}
      <path d={drawn.map((point, order) => `${order ? 'L' : 'M'}${px(point.value)} ${py(point.ampacity)}`).join('')} fill="none" className="stroke-ink" strokeWidth={2} strokeLinejoin="round" />
      {drawn.map(point => <g key={point.index}>
        {point.index === active && <circle cx={px(point.value)} cy={py(point.ampacity)} r={9} fill="none" className="stroke-copper" strokeWidth={2} />}
        <circle cx={px(point.value)} cy={py(point.ampacity)} r={4} className="fill-ink" onClick={onActive ? () => onActive(point.index) : undefined}>
          <title>{`${xLabel} ${compact(point.value)}：允许电流 ${fixed(point.ampacity)} A`}</title>
        </circle>
      </g>)}
    </>;
  }
  return <div ref={host} className="absolute inset-0">
    <svg width={width} height={height} role="img" aria-label={`${xLabel}变化时的允许电流曲线`} className="block">{body}</svg>
  </div>;
}
