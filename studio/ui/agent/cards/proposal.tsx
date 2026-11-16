// A change the agent proposes, as the kit's card: what would change, and the decision. The decision is the person's; this component
// only carries it to the host. A change that was accepted and then not made is not shown as one that took effect.
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { ChatStep, Proposal } from '@shared/types';
import { reportFailure } from '@/components/notice';
import { ProposalCard, RefusalCard, type ProposalPhase } from '@/kit/chat/cards';
import { api } from '@/state/api';

/** The host's title is the operation and, after a dot, what it acts on; an operation with nothing after the dot acts on the step's own target. */
function words(proposal: Proposal, step: ChatStep): { action: string; subject: string } {
  const [action, ...rest] = proposal.title.split(' · ');
  return { action, subject: rest.join(' · ') || step.target || '' };
}

export function ProposalBlock({ proposal, step }: { proposal: Proposal; step: ChatStep }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const decide = useMutation({ mutationFn: (input: { accept: boolean; note?: string }) => api.decide(proposal.id, input.accept, input.note), onError: reportFailure });
  const { action, subject } = words(proposal, step);
  const title = subject ? `${action} · ${subject}` : action;

  // Accepted, and then the host did not make it: the project had moved on, the library had a newer version, or the conversation broke off.
  if (proposal.status === 'accepted' && (step.status === 'failed' || step.status === 'rejected' || step.status === 'interrupted')) {
    const why = step.status === 'interrupted' ? '对话中断了，没有执行' : step.reason ?? '执行时被拒绝';
    return <RefusalCard kind="error" title={title} reason={`已接受，但没有执行：${why}`} />;
  }
  // Accepted and being carried out: still the person's card, not yet a change that took effect.
  const executing = proposal.status === 'accepted' && step.status === 'running';
  const phase: ProposalPhase = executing || proposal.status === 'pending' ? (rejecting ? 'rejecting' : 'pending') : proposal.status;
  return <ProposalCard action={action} subject={subject} phase={phase} busy={decide.isPending || executing}
    changes={proposal.changes.map(change => ({ id: `${change.part}/${change.field}`, label: change.label, before: change.before, after: change.after }))}
    consequence={proposal.issue ? <>改后这组输入算不了：{proposal.issue.message}</> : undefined}
    note={proposal.status === 'rejected' ? proposal.note : note} onNoteChange={setNote}
    onAccept={() => decide.mutate({ accept: true })} onReject={() => setRejecting(true)} onCancelReject={() => setRejecting(false)}
    onConfirmReject={() => decide.mutate({ accept: false, note: note.trim() || undefined })} />;
}
