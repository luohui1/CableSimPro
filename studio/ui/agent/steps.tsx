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

export function StepGroup({ indices }: { indices: readonly number[] }) {
  const parts = useAuiState(state => state.message.parts);
  const steps = indices.flatMap(index => {
    const result = (parts[index] as { result?: ChatStep } | undefined)?.result;
    return result?.type === 'step' ? [result] : [];
  });
  if (!steps.length) return null;
  return <>
    <StepTrace steps={steps.map(toStep)} />
    {steps.map(step => <StepCards key={step.id} step={step} />)}
  </>;
}
