// The curve of a parameter sweep: the allowed current against the one condition that was changed. Two axes, the points the
// method computed joined in order, and the saved load as a dashed line. A point the method refused is not drawn (the table
// beside the curve says why). Drawn with recharts, in the theme's colours.
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compact, fixed } from '@shared/format';

export interface CurvePoint { value: number; ampacity: number | null }

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

const TICK = { fontSize: 13, fill: 'var(--text-secondary)' };
const AXIS = { stroke: 'var(--control-border)' };

export function SweepCurve({ points, xLabel, load, active }: {
  points: CurvePoint[];
  /** The swept condition with its unit: 土壤热阻率 K·m/W. */
  xLabel: string;
  /** The saved load of the project, when the sweep leaves it as it is. */
  load?: number;
  /** The point whose row is selected in the table beside the curve. */
  active?: number;
}) {
  const data = points.map(point => ({ x: point.value, y: point.ampacity }));
  const drawn = data.flatMap(point => (point.y === null ? [] : [{ x: point.x, y: point.y }]));
  if (drawn.length === 0) return null;
  const xs = drawn.map(point => point.x);
  const ys = [...drawn.map(point => point.y), ...(load === undefined ? [] : [load])];
  const spread = Math.max(...ys) - Math.min(...ys) || Math.max(...ys) * 0.1 || 1;
  const [low, high] = [Math.min(...ys) - spread * 0.15, Math.max(...ys) + spread * 0.1];
  const yTicks = niceTicks(low, high);
  const xTicks = niceTicks(Math.min(...xs), Math.max(...xs), 6);
  const reach = (Math.max(...xs) - Math.min(...xs)) * 0.04 || 1;
  const marked = active === undefined ? undefined : points[active];
  // The name of the load sits at the end of the dashed line where the curve is far from it.
  const loadAt = drawn[0].y >= drawn[drawn.length - 1].y ? 'insideBottomLeft' : 'insideBottomRight';
  return <div role="img" aria-label={`${xLabel}变化时的允许电流曲线`} className="absolute inset-0">
    <span className="absolute top-4 left-6 text-sm text-ink">允许电流 A</span>
    <span className="absolute inset-x-0 bottom-4 text-center text-sm text-ink">{xLabel}</span>
    <div className="absolute inset-x-4 top-12 bottom-12">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="x" type="number" domain={[Math.min(...xs) - reach, Math.max(...xs) + reach]} ticks={xTicks} tick={TICK} tickLine={false} axisLine={AXIS}
            tickFormatter={value => compact(value)} />
          <YAxis type="number" domain={[low, high]} ticks={yTicks} tick={TICK} tickLine={false} axisLine={AXIS} width={56} tickFormatter={value => compact(value)} />
          {load !== undefined && <ReferenceLine y={load} stroke="var(--text-secondary)" strokeDasharray="6 4"
            label={{ value: `保存负荷 ${compact(load)} A`, position: loadAt, fill: 'var(--text-secondary)', fontSize: 13 }} />}
          <Tooltip cursor={{ stroke: 'var(--control-border)' }} content={({ active: hovered, payload }) => {
            const point = payload?.[0]?.payload as { x: number; y: number | null } | undefined;
            if (!hovered || !point || point.y === null) return null;
            return <div className="rounded-lg bg-surface px-3 py-2 text-sm text-ink shadow-menu ring-1 ring-line">
              <div className="text-ink-2">{xLabel} {compact(point.x)}</div>
              <div className="font-medium tabular-nums">允许电流 {fixed(point.y)} A</div>
            </div>;
          }} />
          <Line dataKey="y" stroke="var(--text)" strokeWidth={2} dot={{ r: 4, fill: 'var(--text)', stroke: 'var(--text)' }} activeDot={{ r: 6 }} isAnimationActive={false} connectNulls={false} />
          {marked && typeof marked.ampacity === 'number' && <ReferenceDot x={marked.value} y={marked.ampacity} r={9} fill="none" stroke="var(--copper)" strokeWidth={2} ifOverflow="visible" />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  </div>;
}
