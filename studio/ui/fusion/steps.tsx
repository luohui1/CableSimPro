// The tool calls of one stretch of the agent's work, between its sentences: one line that opens into the timeline, then the card of what
// they read. The sidecar sends each step whole as the tool call's result, so one component draws them all.
import { useAuiState } from '@assistant-ui/react';
import type { ChatStep, StepStatus } from '@shared/types';
import { StepTrace, type Step, type StepState } from '@/kit/chat/steps';
import { StepCards } from './cards';
import { repeatedOpens } from './repeated-opens';

const STATE: Record<StepStatus, StepState> = { running: 'running', waiting_review: 'waiting', done: 'done', failed: 'failed', rejected: 'rejected', interrupted: 'interrupted' };

export function toStep(step: ChatStep): Step {
  // StepCards/ProposalBlock already keep the full diagnostic in their refusal card. Passing it to StepTrace would repeat it in
  // both the task summary and its expanded line. Preserve the original step for the card and keep the timeline's state and label.
  const hasFailureCard = step.proposal
    ? step.proposal.status === 'accepted' && ['failed', 'rejected', 'interrupted'].includes(step.status)
    : step.status === 'failed' && Boolean(step.reason);
  return {
    id: step.id, label: step.label, target: step.target, state: STATE[step.status], notes: step.notes,
    reason: hasFailureCard ? undefined : step.reason,
    seconds: step.duration_ms === undefined ? undefined : step.duration_ms / 1000,
  };
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
    <StepTrace steps={steps.map(toStep)} defaultOpen={steps.some(step => step.status === 'running' || step.status === 'waiting_review')} />
    {steps.map(step => <StepCards key={step.id} step={repeated.has(step.id) ? { ...step, card: undefined } : step} />)}
  </>;
}
