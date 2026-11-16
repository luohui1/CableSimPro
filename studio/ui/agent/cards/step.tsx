// One thing the agent did, as it appears between its sentences: a row with the operation's name and what it acts on, closed until
// opened for the facts; under it, the proposal that waits for a decision, or the card of what came out.
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { CheckIcon, ChevronRightIcon, CircleSlashIcon, ClockIcon, Loader2Icon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CardRef, ChatStep, StepStatus } from '@shared/types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { CheckCard } from './check-card';
import { FileCard } from './file-card';
import { OpenInWorkbench } from './frame';
import { ModelCard } from './model-card';
import { ProposalCard } from './proposal-card';
import { RunCard } from './run-card';

const MARK: Record<StepStatus, { icon: ReactNode; text: string; tone: string }> = {
  running: { icon: <Loader2Icon className="animate-spin" />, text: '进行中', tone: 'text-muted-foreground' },
  waiting_review: { icon: <ClockIcon />, text: '等你审阅', tone: 'text-attention' },
  done: { icon: <CheckIcon />, text: '', tone: 'text-success' },
  failed: { icon: <XIcon />, text: '没有完成', tone: 'text-destructive' },
  rejected: { icon: <XIcon />, text: '已拒绝', tone: 'text-destructive' },
  interrupted: { icon: <CircleSlashIcon />, text: '已中断', tone: 'text-muted-foreground' },
};

const seconds = (ms: number | undefined) => (ms !== undefined && ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} 秒` : '');

function StepRow({ step }: { step: ChatStep }) {
  const mark = MARK[step.status];
  const facts = [...(step.notes ?? []), ...(step.reason ? [step.reason] : [])];
  const head = <>
    <span className={cn('flex size-4 shrink-0 items-center justify-center [&_svg]:size-4', mark.tone)} aria-hidden>{mark.icon}</span>
    <span className="shrink-0 font-medium">{step.label}</span>
    {step.target && <span className="text-muted-foreground min-w-0 truncate">{step.target}</span>}
    <span className={cn('ms-auto shrink-0 ps-3', mark.tone === 'text-success' ? 'text-muted-foreground' : mark.tone)}>{mark.text || seconds(step.duration_ms)}</span>
  </>;
  if (!facts.length) return <div className="flex h-8 items-center gap-2 text-sm" role="status" aria-label={`${step.label}：${mark.text || '完成'}`}>{head}</div>;
  return <Collapsible>
    <CollapsibleTrigger className="group hover:bg-muted flex h-8 w-full items-center gap-2 rounded-lg text-start text-sm transition-colors">
      {head}
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0 transition-transform group-data-panel-open:rotate-90" aria-hidden />
    </CollapsibleTrigger>
    <CollapsibleContent>
      <ul className="text-muted-foreground m-0 mt-1 flex list-none flex-col gap-1 ps-6 pb-1 text-sm">{facts.map(fact => <li key={fact}>{fact}</li>)}</ul>
    </CollapsibleContent>
  </Collapsible>;
}

function ResultCard({ card, step }: { card: CardRef; step: ChatStep }) {
  switch (card.kind) {
    case 'run': return <RunCard card={card} />;
    case 'check': return <CheckCard card={card} />;
    case 'file': return <FileCard card={card} />;
    case 'model3d': return <ModelCard card={card} subject={step.target} />;
    case 'open': return <div><OpenInWorkbench href={card.href} label={`在工作台打开 · ${card.label}`} /></div>;
  }
}

/** The renderer for every tool call in the thread: the host sends the whole step, so there is one component for all of them. */
export const StepPart: ToolCallMessagePartComponent = ({ result }) => {
  const step = result as ChatStep | undefined;
  if (!step || step.type !== 'step') return null;
  // A button that opens something needs no row saying it was made.
  if (step.card?.kind === 'open' && step.status === 'done') return <ResultCard card={step.card} step={step} />;
  return <div className="flex flex-col gap-2" data-step={step.tool} data-status={step.status}>
    <StepRow step={step} />
    {step.proposal && <ProposalCard proposal={step.proposal} outcome={step.status} reason={step.reason} />}
    {step.card && step.status === 'done' && <ResultCard card={step.card} step={step} />}
  </div>;
};
