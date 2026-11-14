// The conclusion: one number, how far it can be trusted, and how close the saved load is to it.
import NumberFlow from '@number-flow/react';
import { Badge, Facts, Meter, Seal } from '@/components/marks';
import { Segmented } from '@/components/segmented';
import { rampPosition, type Ramp } from '@/lib/ramp';
import { useView } from '@/state/view';
import { compact, fixed } from '@shared/format';
import type { MethodCard } from '@shared/types';
import type { Rating } from './rating';

export function VerdictHead({ rating, card, stale, ramp, name }: { rating: Rating; card: MethodCard | null; stale: boolean; ramp: Ramp; name: (cable: string) => string }) {
  const mode = useView(state => state.mode);
  const hottest = rating.states.reduce((a, b) => (b.conductor_c > a.conductor_c ? b : a));
  const current = mode === 'load' ? rating.load : rating.ampacity;
  return <header className="shrink-0 px-5 pt-5 pb-4">
    <div className="flex items-center justify-between gap-3">
      <span className="text-13 text-ink-2">允许电流</span>
      <div className="flex items-center gap-2">
        {stale && <Badge tone="attention">已过期</Badge>}
        {card && <Seal tier={card.tier.tier} label={card.tier.label} />}
      </div>
    </div>
    <div className="mt-1 flex items-baseline gap-2">
      <NumberFlow value={rating.ampacity} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} className="text-28 font-strong text-ink" />
      <span className="text-16 text-ink-2">A</span>
    </div>
    <Facts className="mt-3" rows={[
      { label: '口径', value: rating.summary.ampacity?.basis_name },
      { label: '先到温限', value: name(rating.limiting) },
    ]} />

    <Segmented className="mt-4" stretch label="显示哪个工况" value={mode} onChange={useView.getState().setMode} options={[
      { value: 'load', label: `保存负荷 ${compact(rating.load)} A` },
      { value: 'rated', label: `额定 ${fixed(rating.ampacity)} A` },
    ]} />

    <div className="mt-4 grid gap-3">
      <Gauge label={`最热导体，温限 ${compact(rating.limit)} °C`} value={`${fixed(hottest.conductor_c)} °C`} margin={`余量 ${fixed(hottest.margin_k)} K`}
        amount={hottest.conductor_c} min={rating.ambient} max={rating.limit} colour={ramp.css(rampPosition(hottest.conductor_c, rating.ambient, rating.limit))} />
      <Gauge label={`电流，允许 ${fixed(rating.ampacity)} A`} value={`${fixed(current)} A`} margin={`余量 ${fixed(rating.ampacity - current)} A`}
        amount={current} min={0} max={rating.ampacity} />
    </div>
  </header>;
}

function Gauge({ label, value, margin, amount, min, max, colour }: { label: string; value: string; margin: string; amount: number; min: number; max: number; colour?: string }) {
  return <div>
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <span className="text-13 text-ink-2">{label}</span>
      <span className="flex items-baseline gap-3 text-14">
        <span className="text-ink-2">{margin}</span>
        <span className="font-strong text-ink">{value}</span>
      </span>
    </div>
    <Meter value={amount} min={min} max={max} colour={colour} />
  </div>;
}
