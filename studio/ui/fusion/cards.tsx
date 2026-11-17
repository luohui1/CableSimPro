// What a step leaves in the conversation: a saved run as the kit's rating card, any other object as a way to it in the old workbench.
// A card draws what the sidecar read from the run record; it computes nothing and fills nothing the record did not give.
import type { CardRef, ChatStep } from '@shared/types';
import type { SavedRunView } from '@shared/fusion-types';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { CardAction, CardFrame, FileCard, OpenInWorkbench, RatingCard, RefusalCard } from '@/kit/chat/cards';
import { Metric } from '@/kit/metric';
import { TierMark } from '@/kit/marks';
import { useOpen } from './open';
import { ProposalBlock } from './proposal';
import { SavedRatingTable } from './rating-table';

function SavedRun({ view, href }: { view: SavedRunView; href: string }) {
  const open = useOpen();
  const { limiting } = view;
  const title = view.freshness === 'current' ? view.title : `${view.title} · ${view.freshness === 'historical' ? '历史输入' : '时效未确认'}`;
  const basis = [view.basis, view.method].filter(Boolean).join(' · ');
  const actions = <OpenInWorkbench onClick={() => open(href)} />;
  const limitation = view.tier_note && <p className="m-0 text-sm text-ink-2">{view.tier_note}</p>;
  // The temperature gauge needs the limit and the ambient; a record that does not give them is shown without it, not with a guess.
  if (limiting.conductor !== null && limiting.limit !== null && limiting.ambient !== null) {
    return <><RatingCard title={title} tier={view.tier} current={view.current} basis={basis}
      limiting={{ name: limiting.name, conductor: limiting.conductor, limit: limiting.limit, ambient: limiting.ambient, load: limiting.load ?? '—', margin: limiting.margin ?? '—' }}
      actions={actions} />{limitation}</>;
  }
  return <><CardFrame icon="calc/ampacity" title={title} aside={<TierMark tier={view.tier} />} actions={actions} data-card="rating">
    <div className="grid grid-cols-2 items-start gap-6">
      <Metric label="允许电流" value={view.current} unit="A" detail={basis} />
      <div className="flex min-w-0 flex-col">
        <span className="text-sm text-ink-2">先到温限</span>
        <span className="truncate text-h3 text-ink">{limiting.name}</span>
        {limiting.conductor !== null && <span className="text-sm text-ink-2">导体温度 <span className="text-ink tabular-nums">{limiting.conductor} °C</span></span>}
      </div>
    </div>
  </CardFrame>{limitation}</>;
}

/** A button that takes the engineer to something the agent read, in the words the sidecar gave it. */
function OpenResult({ card }: { card: Extract<CardRef, { kind: 'open' }> }) {
  const open = useOpen();
  return <div className="flex"><CardAction icon="action/external" onClick={() => open(card.href)}>在工作台打开 · {card.label}</CardAction></div>;
}

/** Files always come from the platform's saved artifact API, never an arbitrary URL suggested by the model. */
function artifactUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/') ? url.href : undefined;
  } catch { return undefined; }
}

function SavedFile({ card }: { card: Extract<CardRef, { kind: 'saved_file' }> }) {
  const open = useOpen();
  const [previewing, setPreviewing] = useState(false);
  const [file, setFile] = useState<{ url?: string; error?: string }>({});
  const download = artifactUrl(card.download_url);
  const preview = artifactUrl(card.preview_url) || download;
  useEffect(() => {
    if (!previewing || !preview) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setFile({});
    void fetch(preview, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('保存文件暂时无法读取，请在工作台检查交付记录。');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setFile({ url: objectUrl });
    }).catch(error => { if (!controller.signal.aborted) setFile({ error: error instanceof Error ? error.message : '文件未能打开。' }); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [preview, previewing]);
  return <>
    <FileCard title={card.title} kind={card.document_kind} format={card.format === 'pdf' ? 'PDF' : 'HTML'}
      onPreview={preview ? () => setPreviewing(true) : undefined}
      onDownload={download ? () => { const link = document.createElement('a'); link.href = download; link.download = ''; link.click(); } : undefined}
      onOpen={() => open(card.href)} />
    {preview && <Dialog open={previewing} onOpenChange={setPreviewing}>
      <DialogContent className="flex h-5/6 flex-col gap-3 sm:max-w-5xl">
        <DialogTitle>{card.title}</DialogTitle>
        {file.url ? <iframe title={card.title} src={file.url} sandbox="" className="min-h-0 w-full flex-1 rounded-lg border border-line bg-surface" />
          : <p role="status" className="m-0 text-sm text-ink-2">{file.error || '正在打开保存的文件…'}</p>}
      </DialogContent>
    </Dialog>}
  </>;
}

function SavedType({ card }: { card: Extract<CardRef, { kind: 'saved_type' }> }) {
  const open = useOpen();
  return <CardFrame icon="resource/cable-type" title={card.view.title} data-card="type" actions={<OpenInWorkbench onClick={() => open(card.href)} />}>
    <dl className="m-0 grid grid-cols-label gap-x-4 gap-y-3">
      {card.view.fields.map((field, index) => <div className="contents" key={`${index}/${field.label}`}>
        <dt className="text-sm text-ink-2">{field.label}</dt>
        <dd className="m-0 flex min-w-0 flex-col gap-1 text-right text-sm text-ink">
          <span className="tabular-nums">{field.value}{field.unit && <span className="ml-1 text-ink-2">{field.unit}</span>}</span>
          {field.source && <span className="break-words text-left text-sm text-ink-2">{field.source}</span>}
        </dd>
      </div>)}
    </dl>
    {card.view.source && <p className="mb-0 mt-3 break-words text-sm text-ink-2">{card.view.source}</p>}
    {card.view.checks.length > 0 && <ul className="mb-0 mt-3 list-disc space-y-1 pl-4 text-sm text-ink-2">{card.view.checks.map((check, index) => <li key={index}>{check}</li>)}</ul>}
    {!card.view.complete && <p className="mb-0 mt-3 text-sm text-attention">这里只显示已读取的部分字段，完整结构与缺项请在工作台查看。</p>}
  </CardFrame>;
}

export function StepCards({ step }: { step: ChatStep }) {
  const card = step.status === 'done' ? step.card : undefined;
  return <>
    {step.proposal && <ProposalBlock proposal={step.proposal} step={step} />}
    {card?.kind === 'saved_run' && <SavedRun view={card.view} href={card.href} />}
    {card?.kind === 'saved_rating_table' && <SavedRatingTable card={card} />}
    {card?.kind === 'saved_type' && <SavedType card={card} />}
    {card?.kind === 'saved_file' && <SavedFile card={card} />}
    {card?.kind === 'open' && <OpenResult card={card} />}
    {!step.proposal && step.status === 'failed' && step.reason && <RefusalCard kind="refused" title={step.label} reason={step.reason} />}
  </>;
}
