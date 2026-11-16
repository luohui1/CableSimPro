// A file the agent made: the specification sheet (PDF) or the calculation sheet (HTML). Preview in a dialog, or download.
import { DownloadIcon, EyeIcon, FileTextIcon } from 'lucide-react';
import type { CardRef } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { OpenInWorkbench } from './frame';

export function FileCard({ card }: { card: Extract<CardRef, { kind: 'file' }> }) {
  // The specification endpoint serves one file as attachment or inline; the calculation sheet is a page, downloaded by flag.
  const preview = card.type === 'pdf' ? `${card.url}?preview=1` : card.url;
  const download = card.type === 'pdf' ? card.url : `${card.url}?download`;
  return <section className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
    <FileTextIcon className="text-muted-foreground size-5 shrink-0" aria-hidden />
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-sm font-medium">{card.title}</span>
      <span className="text-muted-foreground text-sm">{card.type === 'pdf' ? '规格书（PDF）' : '计算书'}</span>
    </div>
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}><EyeIcon data-icon="inline-start" />预览</DialogTrigger>
      <DialogContent className="flex h-[88vh] flex-col gap-3 sm:max-w-5xl">
        <DialogTitle>{card.title}</DialogTitle>
        <iframe title={card.title} src={preview} className="bg-background min-h-0 w-full flex-1 rounded-lg border" />
      </DialogContent>
    </Dialog>
    <Button variant="outline" size="sm" render={<a href={download} download />}><DownloadIcon data-icon="inline-start" />下载</Button>
    {card.href && <OpenInWorkbench href={card.href} />}
  </section>;
}
