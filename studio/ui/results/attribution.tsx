// Why the number is what it is: who limits whom, where the temperature drops, what heats the cable.
import { Badge, Meter, SectionTitle } from '@/components/marks';
import { cn } from '@/lib/cn';
import { rampPosition, type Ramp } from '@/lib/ramp';
import { useView } from '@/state/view';
import { compact, fixed } from '@shared/format';
import type { Rating } from './rating';

const Block = ({ children }: { children: React.ReactNode }) => <section className="border-b border-line px-5 py-5 last:border-b-0">{children}</section>;

export function Attribution({ rating, ramp, name, screenName }: { rating: Rating; ramp: Ramp; name: (cable: string) => string; screenName: string }) {
  return <>
    {rating.states.length > 1 && <Block><LimitingRank rating={rating} ramp={ramp} name={name} /></Block>}
    <Block><HeatPath rating={rating} ramp={ramp} name={name} screenName={screenName} /></Block>
    <Block><Losses rating={rating} screenName={screenName} /></Block>
    {rating.states.length > 1 && <Block><MutualHeat rating={rating} name={name} /></Block>}
  </>;
}

/** Every cable against the same limit. The row is also a way to select the cable on the drawing. */
function LimitingRank({ rating, ramp, name }: { rating: Rating; ramp: Ramp; name: (cable: string) => string }) {
  const selected = useView(state => state.selected);
  const circuits = rating.summary.circuits ?? [];
  const several = circuits.length > 1;
  return <>
    <SectionTitle>谁先到温限</SectionTitle>
    <div className={cn('grid items-center gap-x-3 text-14', several ? 'grid-cols-[auto_minmax(0,1fr)_64px_76px]' : 'grid-cols-[auto_minmax(0,1fr)_64px]')}>
      <span />
      <span className="pb-1.5 text-13 text-ink-2">导体温度</span>
      <span />
      {several && <span className="pb-1.5 text-right text-13 text-ink-2">单独能带</span>}
      {rating.states.map(state => {
        const circuit = circuits.find(item => item.id === state.circuit);
        return <button key={state.id} type="button" onClick={() => useView.getState().select(state.id === selected ? null : state.id)}
          className={cn('col-span-full -mx-2 grid h-9 grid-cols-subgrid items-center rounded-field px-2 text-left transition-colors duration-fast ease-std hover:bg-hover',
            state.id === selected && 'bg-fill')}>
          <span className="flex items-center gap-2 whitespace-nowrap text-ink">
            {name(state.id)}
            {state.id === rating.limiting && <Badge tone="ink">限制</Badge>}
          </span>
          <Meter value={state.conductor_c} min={rating.ambient} max={rating.limit} colour={ramp.css(rampPosition(state.conductor_c, rating.ambient, rating.limit))} />
          <span className="text-right font-strong text-ink">{fixed(state.conductor_c)} °C</span>
          {several && <span className="text-right text-ink">{circuit?.ampacity_a ? `${fixed(circuit.ampacity_a)} A` : '—'}</span>}
        </button>;
      })}
    </div>
  </>;
}

/** The heat path of one cable, from the conductor outward. Each step shows its thermal resistance and its drop. */
function HeatPath({ rating, ramp, name, screenName }: { rating: Rating; ramp: Ramp; name: (cable: string) => string; screenName: string }) {
  const cable = rating.focus;
  const armoured = cable.armour_c !== null && cable.armour_c !== undefined && cable.thermal_k_m_w.t2 !== undefined;
  const nodes = [
    { label: '导体', value: cable.conductor_c },
    { label: screenName, value: cable.sheath_c },
    ...(armoured ? [{ label: '铠装', value: cable.armour_c as number }] : []),
    { label: '电缆表面', value: cable.surface_c },
    { label: '环境', value: rating.ambient },
  ];
  const steps = [
    { label: 'T1 绝缘', resistance: cable.thermal_k_m_w.t1 },
    ...(armoured ? [{ label: 'T2 内衬', resistance: cable.thermal_k_m_w.t2 as number }] : []),
    { label: 'T3 外护套', resistance: cable.thermal_k_m_w.t3 },
    { label: 'T4 土壤', resistance: cable.thermal_k_m_w.t4_soil },
  ];
  const total = Math.max(1e-9, cable.conductor_c - rating.ambient);
  const colour = (value: number) => ramp.css(rampPosition(value, rating.ambient, rating.limit));
  return <>
    <SectionTitle aside={name(cable.id)}>温度降在哪一段</SectionTitle>
    <div className="grid grid-cols-[12px_minmax(0,1fr)_88px_60px] items-center gap-x-3">
      {nodes.map((node, index) => {
        const next = nodes[index + 1];
        const drop = next ? node.value - next.value : 0;
        return <div key={node.label} className="contents">
          <span className="size-3 rounded-full shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text)_30%,transparent)]" style={{ background: colour(node.value) }} />
          <span className="col-span-2 text-14 text-ink">{node.label}</span>
          <span className="text-right text-14 font-strong text-ink">{fixed(node.value)} °C</span>
          {next && <>
            <span className="h-9 w-0.5 justify-self-center rounded-full" style={{ background: `linear-gradient(${colour(node.value)}, ${colour(next.value)})` }} />
            <span className="flex items-baseline gap-2 text-13 text-ink-2">
              <span>{steps[index].label}</span>
              <span>{compact(steps[index].resistance)} K·m/W</span>
            </span>
            <span className="h-1.5 rounded-full bg-fill">
              <span className="block h-full rounded-full bg-ink-2 transition-[width] duration-slow ease-std" style={{ width: `${Math.max(2, (drop / total) * 100)}%` }} />
            </span>
            <span className="text-right text-13 text-ink-2">降 {fixed(drop)} K</span>
          </>}
        </div>;
      })}
    </div>
  </>;
}

function Losses({ rating, screenName }: { rating: Rating; screenName: string }) {
  const losses = rating.focus.losses_w_m;
  const parts = [
    { label: '导体', value: losses.conductor, colour: 'var(--conductor)' },
    { label: screenName, value: losses.sheath, colour: 'var(--material-metal)' },
    ...(losses.armour !== undefined ? [{ label: '铠装', value: losses.armour, colour: 'color-mix(in oklab, var(--material-metal) 55%, var(--material-semi))' }] : []),
    { label: '介质', value: losses.dielectric, colour: 'var(--material-insulation)' },
  ];
  return <>
    <SectionTitle aside={`${fixed(losses.total, 2)} W/m`}>发热从哪里来</SectionTitle>
    <div className="flex h-2.5 gap-px overflow-hidden rounded-full shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text)_14%,transparent)]">
      {parts.map(part => <span key={part.label} className="h-full transition-[width] duration-slow ease-std" style={{ width: `${(part.value / losses.total) * 100}%`, background: part.colour }} />)}
    </div>
    <div className="mt-3 grid grid-cols-[12px_minmax(0,1fr)_auto_52px] items-center gap-x-3 gap-y-1.5 text-14">
      {parts.map(part => <div key={part.label} className="contents">
        <span className="size-3 rounded-[3px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text)_22%,transparent)]" style={{ background: part.colour }} />
        <span className="text-ink">{part.label}</span>
        <span className="text-right text-ink">{fixed(part.value, 2)} W/m</span>
        <span className="text-right text-ink-2">{fixed((part.value / losses.total) * 100, 0)}%</span>
      </div>)}
    </div>
  </>;
}

/** How much of the surface temperature rise comes from the cable itself and from each neighbour. */
function MutualHeat({ rating, name }: { rating: Rating; name: (cable: string) => string }) {
  const cable = rating.focus;
  const parts = rating.contributions?.length
    ? [...rating.contributions].sort((a, b) => Number(b.self) - Number(a.self) || b.temperature_rise_k - a.temperature_rise_k)
      .map(item => ({ label: item.self ? '自身' : name(item.source), value: item.temperature_rise_k }))
    : [{ label: '自身', value: cable.external_rise_k - cable.mutual_rise_k }, { label: '相邻电缆合计', value: cable.mutual_rise_k }];
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const tone = (index: number) => (index === 0 ? 'var(--text)' : index % 2 ? 'var(--text-secondary)' : 'var(--text-weak)');
  return <>
    <SectionTitle aside={`${fixed(total)} K`}>表面温升是谁加的</SectionTitle>
    <div className="flex h-2.5 gap-px overflow-hidden rounded-full">
      {parts.map((part, index) => <span key={part.label} className="h-full transition-[width] duration-slow ease-std" style={{ width: `${(part.value / total) * 100}%`, background: tone(index) }} />)}
    </div>
    <div className="mt-3 grid grid-cols-[12px_minmax(0,1fr)_auto_52px] items-center gap-x-3 gap-y-1.5 text-14">
      {parts.map((part, index) => <div key={part.label} className="contents">
        <span className="size-3 rounded-[3px]" style={{ background: tone(index) }} />
        <span className="text-ink">{part.label}</span>
        <span className="text-right text-ink">{fixed(part.value)} K</span>
        <span className="text-right text-ink-2">{fixed((part.value / total) * 100, 0)}%</span>
      </div>)}
    </div>
  </>;
}
