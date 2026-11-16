// A file the agent made: the specification sheet (PDF) or the calculation sheet (HTML). Preview in a dialog, or download.
import { useState } from 'react';
import type { CardRef } from '@shared/types';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { FileCard } from '@/kit/chat/cards';
import type { Review } from '@/kit/marks';
import { useOpen } from './open';

/** How the host words where a version stands in review, and the mark for each. */
const REVIEW: Record<string, Review> = { 草稿: 'draft', 待审核: 'submitted', 已审核: 'reviewed', 已发布: 'published' };

export function FileResult({ card }: { card: Extract<CardRef, { kind: 'file' }> }) {
  const open = useOpen();
  const [previewing, setPreviewing] = useState(false);
  // The specification endpoint serves one file as attachment or inline; the calculation sheet is a page, downloaded by flag.
  const preview = card.type === 'pdf' ? `${card.url}?preview=1` : card.url;
  const download = card.type === 'pdf' ? card.url : `${card.url}?download`;
  return <>
    <FileCard title={card.title} kind={card.type === 'pdf' ? '规格书' : '计算书'} format={card.type === 'pdf' ? 'PDF' : 'HTML'}
      review={card.status ? REVIEW[card.status] : undefined} onPreview={() => setPreviewing(true)}
      onDownload={() => { const link = document.createElement('a'); link.href = download; link.download = ''; link.click(); }}
      onOpen={card.href ? () => open(card.href as string) : undefined} />
    <Dialog open={previewing} onOpenChange={setPreviewing}>
      <DialogContent className="flex h-5/6 flex-col gap-3 sm:max-w-5xl">
        <DialogTitle>{card.title}</DialogTitle>
        <iframe title={card.title} src={preview} className="min-h-0 w-full flex-1 rounded-lg border border-line bg-surface" />
      </DialogContent>
    </Dialog>
  </>;
}
