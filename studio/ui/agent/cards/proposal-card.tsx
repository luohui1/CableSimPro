// A change the agent proposes, before it takes effect: each value as it is and as it would become, in the units the workbench uses.
// Accepting writes it; rejecting tells the agent why not. Nothing is written until a person has decided.
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { Proposal } from '@shared/types';
import { reportFailure } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/state/api';

export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const decide = useMutation({ mutationFn: (input: { accept: boolean; note?: string }) => api.decide(proposal.id, input.accept, input.note), onError: reportFailure });
  const pending = proposal.status === 'pending';
  // A new object has no old value to show; the column would be a row of dashes.
  const hasBefore = proposal.changes.some(change => change.before !== '—');
  return <section aria-label={`待审：${proposal.title}`} className="bg-card overflow-hidden rounded-xl border" data-status={proposal.status}>
    <header className="flex min-h-11 items-center gap-3 border-b px-4 py-2">
      <h3 className="m-0 min-w-0 flex-1 truncate text-sm font-medium">{pending ? '请审阅' : '已审阅'} · {proposal.title}</h3>
      {proposal.preview && <Badge variant="outline">改动后：{proposal.preview.tier.label}</Badge>}
    </header>
    <Table>
      <TableHeader><TableRow><TableHead className="w-40">项目</TableHead>{hasBefore && <TableHead>改前</TableHead>}<TableHead>{hasBefore ? '改后' : '内容'}</TableHead></TableRow></TableHeader>
      <TableBody>{proposal.changes.map(change => <TableRow key={`${change.part}/${change.field}`}>
        <TableCell className="text-muted-foreground">{change.label}</TableCell>
        {hasBefore && <TableCell className="whitespace-normal tabular-nums">{change.before}</TableCell>}
        <TableCell className="font-medium whitespace-normal tabular-nums">{change.after}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
    {proposal.issue && <p role="alert" className="text-destructive m-0 border-t px-4 py-2 text-sm">改后这组输入算不了：{proposal.issue.message}</p>}
    <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
      {pending ? (rejecting
        ? <>
          <Input value={note} onChange={event => setNote(event.target.value)} placeholder="拒绝的原因（可不写）" aria-label="拒绝的原因" className="h-8 max-w-80 flex-1"
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) decide.mutate({ accept: false, note: note.trim() || undefined }); }} autoFocus />
          <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ accept: false, note: note.trim() || undefined })}>确认拒绝</Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>取消</Button>
        </>
        : <>
          <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ accept: true })}>接受</Button>
          <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => setRejecting(true)}>拒绝</Button>
        </>)
        : <span className="text-sm">{proposal.status === 'accepted' ? '已接受，改动已生效' : `已拒绝${proposal.note ? `：${proposal.note}` : ''}，没有改动`}</span>}
    </footer>
  </section>;
}
