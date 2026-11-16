// What a step leaves in the conversation: a saved run as the kit's rating card, any other object as a way to it in the old workbench.
// A card draws what the sidecar read from the run record; it computes nothing and fills nothing the record did not give.
import type { CardRef, ChatStep } from '@shared/types';
import type { SavedRunView } from '@shared/fusion-types';
import { CardAction, CardFrame, OpenInWorkbench, RatingCard } from '@/kit/chat/cards';
import { Metric } from '@/kit/metric';
import { TierMark } from '@/kit/marks';
import { useOpen } from './open';

function SavedRun({ view, href }: { view: SavedRunView; href: string }) {
  const open = useOpen();
  const { limiting } = view;
  const title = view.freshness === 'current' ? view.title : `${view.title} · 已过期`;
  const basis = [view.basis, view.method].filter(Boolean).join(' · ');
  const actions = <OpenInWorkbench onClick={() => open(href)} />;
  // The temperature gauge needs the limit and the ambient; a record that does not give them is shown without it, not with a guess.
  if (limiting.conductor !== null && limiting.limit !== null && limiting.ambient !== null) {
    return <RatingCard title={title} tier={view.tier} current={view.current} basis={basis}
      limiting={{ name: limiting.name, conductor: limiting.conductor, limit: limiting.limit, ambient: limiting.ambient, load: limiting.load ?? '—', margin: limiting.margin ?? '—' }}
      actions={actions} />;
  }
  return <CardFrame icon="calc/ampacity" title={title} aside={<TierMark tier={view.tier} />} actions={actions} data-card="rating">
    <div className="grid grid-cols-2 items-start gap-6">
      <Metric label="允许电流" value={view.current} unit="A" detail={basis} />
      <div className="flex min-w-0 flex-col">
        <span className="text-sm text-ink-2">先到温限</span>
        <span className="truncate text-h3 text-ink">{limiting.name}</span>
        {limiting.conductor !== null && <span className="text-sm text-ink-2">导体温度 <span className="text-ink tabular-nums">{limiting.conductor} °C</span></span>}
      </div>
    </div>
  </CardFrame>;
}

/** A button that takes the engineer to something the agent read, in the words the sidecar gave it. */
function OpenResult({ card }: { card: Extract<CardRef, { kind: 'open' }> }) {
  const open = useOpen();
  return <div className="flex"><CardAction icon="action/external" onClick={() => open(card.href)}>在工作台打开 · {card.label}</CardAction></div>;
}

export function StepCards({ step }: { step: ChatStep }) {
  const card = step.status === 'done' ? step.card : undefined;
  if (card?.kind === 'saved_run') return <SavedRun view={card.view} href={card.href} />;
  if (card?.kind === 'open') return <OpenResult card={card} />;
  return null;
}
