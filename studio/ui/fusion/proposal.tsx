import { useMutation } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import type { ChatStep, Proposal } from '@shared/types';
import { ProposalCard, RefusalCard, type ProposalPhase } from '@/kit/chat/cards';
import { ChatNotice } from '@/kit/chat/empty';
import { Disclosure } from '@/kit/disclosure';
import { api } from '@/state/api';
import { queryClient } from '@/state/queries';
import { notifyPlatformChanged } from './open';

/** The human decision is sent to the existing platform proposal; the model has no decision tool. */
export function ProposalBlock({ proposal, step }: { proposal: Proposal; step: ChatStep }) {
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string };
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (input: { accept: boolean; note?: string }) => api.decide(proposal.id, input.accept, input.note, sessionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat', sessionId] }),
    onSettled: (_data, _error, input) => { if (input.accept) notifyPlatformChanged(proposal.project_id); },
  });
  const [action, ...rest] = proposal.title.split(' · ');
  const subject = rest.join(' · ') || step.target || '';
  const title = subject ? `${action} · ${subject}` : action;
  if (proposal.status === 'accepted' && ['failed', 'rejected', 'interrupted'].includes(step.status)) {
    const reason = step.reason?.startsWith('已接受') ? step.reason
      : `已接受，但执行未完成：${step.reason || '对话已中断，请在工作台核对保存记录。'}`;
    return <RefusalCard kind="error" title={title} reason={reason} />;
  }
  const executing = proposal.status === 'accepted' && step.status === 'running';
  const phase: ProposalPhase = executing || proposal.status === 'pending' ? (rejecting ? 'rejecting' : 'pending') : proposal.status;
  return <>
    <ProposalCard action={action} subject={subject} phase={phase} busy={decide.isPending || executing || !sessionId} collapseChangesAfter={8}
      changes={proposal.changes.map(change => ({ id: `${change.part}/${change.field}`, label: change.label, before: change.before, after: change.after }))}
      consequence={proposal.checks?.length || proposal.assumptions?.length ? <>
        {proposal.checks?.length ? <ul className="m-0 list-disc space-y-1 pl-4">{proposal.checks.map((check, index) => <li key={index}>{check}</li>)}</ul> : null}
        {proposal.assumptions?.length ? <Disclosure title="方法适用范围与限制" aside={<span className="text-sm text-ink-2">{proposal.assumptions.length} 项</span>} className="-mx-3 mt-2 border-t border-line">
          <ul className="m-0 list-disc space-y-2 pr-4 pb-3 pl-8">{proposal.assumptions.map((limit, index) => <li key={index}>{limit}</li>)}</ul>
        </Disclosure> : null}
      </> : undefined}
      note={proposal.status === 'rejected' ? proposal.note : note} onNoteChange={setNote}
      onAccept={() => decide.mutate({ accept: true })} onReject={() => setRejecting(true)} onCancelReject={() => setRejecting(false)}
      onConfirmReject={() => decide.mutate({ accept: false, note: note.trim() || undefined })} />
    {executing && <p role="status" className="m-0 text-sm text-ink-2">已接受，正在执行；完成后继续处理下一步。</p>}
    {decide.isError && <ChatNotice tone="error">{decide.error.message}</ChatNotice>}
  </>;
}
