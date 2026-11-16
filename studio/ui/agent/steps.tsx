// The tool calls of one stretch of the agent's work, between its sentences: one line that opens into the timeline, then what they left,
// the proposals and the cards. The host sends each step whole as the tool call's result, so one component draws them all.
import { useAuiState } from '@assistant-ui/react';
import type { ChatStep, StepStatus } from '@shared/types';
import { StepTrace, type Step, type StepState } from '@/kit/chat/steps';
import { StepCards } from './cards';

const STATE: Record<StepStatus, StepState> = { running: 'running', waiting_review: 'waiting', done: 'done', failed: 'failed', rejected: 'rejected', interrupted: 'interrupted' };

const toStep = (step: ChatStep): Step => ({
  // A change that was accepted and not made says why on its own card; the line above it would only say it again.
  id: step.id, label: step.label, target: step.target, state: STATE[step.status], notes: step.notes, reason: step.proposal?.status === 'accepted' ? undefined : step.reason,
  seconds: step.duration_ms === undefined ? undefined : step.duration_ms / 1000,
});

/** The steps whose button to the workbench only repeats a way there the answer already offered: a change that was made offers its object,
 *  a result card carries its own button, and the agent opening that same object right after offers it again. */
function repeatedOpens(parts: readonly unknown[]): Set<string> {
  const offered = new Set<string>();
  const repeated = new Set<string>();
  for (const part of parts) {
    const step = (part as { result?: ChatStep }).result;
    if (step?.type !== 'step' || step.status !== 'done' || !step.card || !('href' in step.card) || !step.card.href) continue;
    if (step.card.kind === 'open' && offered.has(step.card.href)) repeated.add(step.id);
    else offered.add(step.card.href);
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
