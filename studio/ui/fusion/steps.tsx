// The tool calls of one stretch of the agent's work, between its sentences: one line that opens into the timeline, then the card of what
// they read. The sidecar sends each step whole as the tool call's result, so one component draws them all.
import { useAuiState } from '@assistant-ui/react';
import type { ChatStep, StepStatus } from '@shared/types';
import { StepTrace, type Step, type StepState } from '@/kit/chat/steps';
import { StepCards } from './cards';

const STATE: Record<StepStatus, StepState> = { running: 'running', waiting_review: 'waiting', done: 'done', failed: 'failed', rejected: 'rejected', interrupted: 'interrupted' };

const toStep = (step: ChatStep): Step => ({
  id: step.id, label: step.label, target: step.target, state: STATE[step.status], notes: step.notes, reason: step.reason,
  seconds: step.duration_ms === undefined ? undefined : step.duration_ms / 1000,
});

/** The steps whose way to the workbench only repeats one the answer already gives: the same address twice, or a plain link to a study
 *  whose own run card (with its own button) is there. */
function repeatedOpens(parts: readonly unknown[]): Set<string> {
  const object = (href: string) => href.split('?')[0];
  const cards = parts.flatMap(part => {
    const step = (part as { result?: ChatStep }).result;
    const card = step?.type === 'step' && step.status === 'done' ? step.card : undefined;
    const href = card && 'href' in card ? card.href : undefined;
    return step && card && href ? [{ id: step.id, kind: card.kind, href }] : [];
  });
  const withRunCard = new Set(cards.filter(item => item.kind === 'saved_run').map(item => object(item.href)));
  const offered = new Set<string>();
  const repeated = new Set<string>();
  for (const item of cards) {
    if (item.kind === 'open' && withRunCard.has(object(item.href))) repeated.add(item.id);
    else if (offered.has(item.href)) repeated.add(item.id);
    else offered.add(item.href);
  }
  return repeated;
}

export function StepGroup({ indices }: { indices: readonly number[] }) {
  const parts = useAuiState(state => state.message.parts);
  const steps = indices.flatMap(index => {
    const result = (parts[index] as { result?: ChatStep } | undefined)?.result;
    return result?.type === 'step' ? [result] : [];
  });
  if (!steps.length) return null;
  const repeated = repeatedOpens(parts);
  return <>
    <StepTrace steps={steps.map(toStep)} defaultOpen={steps.some(step => step.status === 'running')} />
    {steps.map(step => <StepCards key={step.id} step={repeated.has(step.id) ? { ...step, card: undefined } : step} />)}
  </>;
}
