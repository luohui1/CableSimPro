// The answer, in the order an engineer asks: how much it can carry, whether the present load is fine,
// how hot the hottest conductor is now. These three do not change with the view below.
import NumberFlow from '@number-flow/react';
import { Icon } from '@/components/icon';
import { Badge, Meter, Seal } from '@/components/marks';
import { Tip } from '@/components/tooltip';
import { cn } from '@/lib/cn';
import { rampPosition, type Ramp } from '@/lib/ramp';
import { compact, fixed } from '@shared/format';
import type { MethodCard } from '@shared/types';
import type { Rating } from './rating';

export function VerdictHead({ rating, card, stale, ramp, name }: { rating: Rating; card: MethodCard | null; stale: boolean; ramp: Ramp; name: (cable: string) => string }) {
  const now = rating.summary.operating?.cables ?? [];
  const hottest = now.length ? now.reduce((a, b) => (b.conductor_c > a.conductor_c ? b : a)) : null;
  const circuits = rating.summary.circuits?.length ?? 1;
  const spare = rating.ampacity - rating.load;
  const fine = spare >= 0;
  return <header className="shrink-0 px-5 pt-4 pb-5">
    <div className="flex h-7 items-center justify-between gap-3">
      <span className="text-13 font-strong text-ink-2">结论</span>
      <div className="flex items-center gap-2">
        {stale && <Badge tone="attention">已过期</Badge>}
        {card && <Tip side="bottom" label={card.tier.meaning}><span><Seal tier={card.tier.tier} label={card.tier.label} /></span></Tip>}
      </div>
    </div>

    <div className="mt-2 text-14 text-ink-2">{circuits > 1 ? `${circuits} 回同时带，每回最多` : '最多能带'}</div>
    <div className="flex items-baseline gap-2">
      <NumberFlow value={rating.ampacity} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} className="text-28 font-strong text-ink" />
      <span className="text-16 text-ink-2">A</span>
    </div>

    <div className={cn('mt-3 flex h-10 items-center gap-2 rounded-field px-3 text-14',
      fine ? 'bg-[color-mix(in_oklab,var(--success)_11%,var(--panel))] text-success' : 'bg-[color-mix(in_oklab,var(--error)_11%,var(--panel))] text-error')}>
      <Icon name={fine ? 'action/check' : 'status/error'} />
      <span className="font-strong">现在的 {compact(rating.load)} A {fine ? '可以带' : '带不了'}</span>
      <span className="ml-auto text-ink">{fine ? `还能加 ${fixed(spare)} A` : `超出 ${fixed(-spare)} A`}</span>
    </div>

    {hottest && <div className="mt-4">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-14">
        <span className="text-ink-2">现在最热的导体{rating.distinct ? `，${name(hottest.id)}` : ''}</span>
        <span className="font-strong text-ink">{fixed(hottest.conductor_c)} °C</span>
      </div>
      <Meter value={hottest.conductor_c} min={rating.ambient} max={rating.limit} colour={ramp.css(rampPosition(hottest.conductor_c, rating.ambient, rating.limit))} />
      <div className="mt-1.5 flex justify-between text-14 text-ink-2">
        <span>上限 {compact(rating.limit)} °C</span>
        <span>还差 {fixed(hottest.margin_k)} K</span>
      </div>
    </div>}
  </header>;
}
