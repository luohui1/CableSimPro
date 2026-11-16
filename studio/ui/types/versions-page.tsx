// 版本与文件: the versions a size has been through and what each one's check said; where the selected version stands in review
// and the one step a person can take from there; the specification sheets made from it, and what was done to it. Only a person
// moves review forward: the buttons are the person's, an Agent's proposal never reaches them.
import { useQueries } from '@tanstack/react-query';
import { compact } from '@shared/format';
import type { LibraryEvent, SpecificationReport, SpecView, VersionHeader } from '@shared/types';
import { ButtonLink, Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Disclosure } from '@/kit/disclosure';
import { Icon } from '@/kit/icon';
import { ReviewMark, VerdictBar } from '@/kit/marks';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { FormNote } from '@/kit/workbench/form';
import { Panel, Split } from '@/kit/workbench/page';
import { ReviewActions, ReviewTrack, type ReviewStamp } from '@/kit/workbench/review';
import { api } from '@/state/api';
import { useProductSpec, useSpecificationReports } from '@/state/queries';
import { eventLabel, fullTime as when, shortTime, type ReviewAction } from './model';

/** The note a person wrote with a step of review, from the trail of the version: the latest one of that step. */
const noteOf = (events: LibraryEvent[], action: string): string | undefined => {
  const latest = events.filter(event => event.action === action && event.detail.note).sort((a, b) => b.id - a.id)[0];
  return latest ? String(latest.detail.note) : undefined;
};

function stampsOf(version: VersionHeader, events: LibraryEvent[]): Partial<Record<'submitted' | 'reviewed' | 'published', ReviewStamp>> {
  const stamp = (at: string | null | undefined, by: string | null | undefined, action: string): ReviewStamp | undefined =>
    at && by ? { at, by, ...(noteOf(events, action) ? { note: noteOf(events, action) } : {}) } : undefined;
  return { submitted: stamp(version.submitted, version.submitted_by, 'submit'), reviewed: stamp(version.reviewed, version.reviewed_by, 'approve'),
    published: stamp(version.published, version.published_by, 'publish') };
}

export function VersionsPage({ view, latest, frozen, onVersion, onReview, onRevise, onPreview, onSheet }: {
  view: SpecView;
  latest: boolean;
  /** The size is still loading: what is shown is the one before, and nothing may be done to it. */
  frozen: boolean;
  onVersion: (version?: number) => void;
  onReview: (action: ReviewAction) => void;
  onRevise: () => void;
  onPreview: (report: SpecificationReport) => void;
  onSheet: () => void;
}) {
  const version = view.version;
  // What each version's check said: the shown one is in hand, the others are read once and kept.
  const others = useQueries({ queries: view.versions.map(item => ({ queryKey: ['library', 'spec', view.spec.id, item.number], enabled: item.number !== version.number,
    queryFn: () => api.op<SpecView>('library.spec.get', { spec: view.spec.id, version: item.number }) })) });
  const checkOf = (number: number): Record<string, number> | null => {
    const spec = number === version.number ? view : others[view.versions.findIndex(item => item.number === number)]?.data;
    const result = spec?.results.check;
    return result?.current && !result.error ? result.summary?.count ?? null : null;
  };
  const columns: Column<VersionHeader>[] = [
    { key: 'number', header: '版本', width: 'w-20', cell: item => <span className="font-medium">第 {item.number} 版</span> },
    { key: 'review', header: '审核', width: 'w-24', cell: item => <ReviewMark state={item.review} /> },
    { key: 'note', header: '说明', cell: item => <span className="whitespace-normal" title={`${item.created_by} · ${shortTime(item.created)}`}>{item.note || '—'}</span> },
    { key: 'check', header: '标准核对', width: 'w-52', cell: item => { const counts = checkOf(item.number); return counts ? <VerdictBar counts={counts} /> : <span className="text-ink-2">未核对</span>; } },
    { key: 'created', header: '建于', width: 'w-36', cell: item => <span className="text-ink-2 tabular-nums">{when(item.created)}</span> },
  ];

  const reports = useSpecificationReports(view.spec.id);
  const files = reports.data?.filter(report => report.version === version.number) ?? [];
  const previousNumber = view.versions.find(item => item.number < version.number)?.number;
  const previous = useProductSpec(previousNumber ? view.spec.id : undefined, previousNumber);
  const difference = previous.data ? view.structure.filter(row => previous.data!.structure.find(item => item.key === row.key)?.value !== row.value) : [];

  return <Split panes={[
    { id: 'versions', size: 60, min: 44, children: <Panel title="版本">
      <DataTable rows={view.versions} rowKey={item => item.id} selected={version.id} columns={columns}
        onSelect={frozen ? undefined : item => onVersion(item.number === view.versions[0].number ? undefined : item.number)} />
    </Panel> },
    { id: 'version', size: 40, min: 30, children: <Panel title={`第 ${version.number} 版`} bodyClassName="flex flex-col gap-6 px-4 py-4"
      tools={latest ? <ReviewActions state={version.review} busy={frozen} onSubmit={() => onReview('submit')} onApprove={() => onReview('approve')}
        onReturn={() => onReview('return')} onPublish={() => onReview('publish')} onRevise={onRevise} /> : undefined}>
      {!latest && <FormNote title="这是历史版本">审核和修改在最新版上做；这里只看它当时的样子和留下的文件。</FormNote>}
      <ReviewTrack state={version.review} created={version.created} stamps={stampsOf(version, view.events)} when={when} />
      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-h3 text-ink">文件</h3>
        {reports.error && <p role="alert" className="m-0 text-sm text-error">{reports.error.message}</p>}
        {!reports.error && !reports.isPending && files.length === 0 && <FormNote title="这一版还没有导出文件">
          <div><Button variant="outline" size="sm" disabled={frozen} onClick={onSheet}><Icon name="object/file" data-icon="inline-start" />导出规格书</Button></div>
        </FormNote>}
        {files.map(report => <Item key={report.id} variant="outline">
          <ItemMedia variant="tile"><Icon name="object/file" /></ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="w-full truncate">{report.title}</ItemTitle>
            <ItemDescription className="flex min-w-0 items-center gap-2"><ReviewMark state={report.review} /><span className="truncate">规格书 · PDF · {when(report.created)} · {report.by}</span></ItemDescription>
          </ItemContent>
          <ItemActions>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="预览规格书" onClick={() => onPreview(report)} />}><Icon name="action/visible" /></TooltipTrigger>
              <TooltipContent side="bottom">预览</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={<ButtonLink variant="ghost" size="icon-sm" href={report.url} download={`${view.spec.name}.pdf`} aria-label="下载规格书" />}><Icon name="action/export" /></TooltipTrigger>
              <TooltipContent side="bottom">下载 PDF</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={<ButtonLink variant="ghost" size="icon-sm" href={`${report.url}/snapshot`} download={`${view.spec.name}-来源快照.json`} aria-label="下载来源快照" />}><Icon name="result/snapshot" /></TooltipTrigger>
              <TooltipContent side="bottom">下载来源快照</TooltipContent>
            </Tooltip>
          </ItemActions>
        </Item>)}
      </section>
      {difference.length > 0 && <Disclosure title={`与第 ${previousNumber} 版的差异`}>
        <ul className="m-0 flex list-none flex-col gap-1 px-4 pb-4 text-sm">
          {difference.map(row => <li key={row.key} className="grid grid-cols-property items-baseline gap-x-3">
            <span className="truncate text-ink-2">{row.label}</span>
            <span className="text-right font-medium text-ink tabular-nums">{compact(previous.data!.structure.find(item => item.key === row.key)?.value)} → {compact(row.value)}</span>
            <span className="text-ink-2">{row.unit}</span>
          </li>)}
        </ul>
      </Disclosure>}
      <Disclosure title={`留痕 ${view.events.length} 条`}>
        {view.events.length === 0 && <p className="m-0 px-4 pb-4 text-sm text-ink">这一版还没有操作记录。修改、审核和生成规格书都会记在这里。</p>}
        <ol className="m-0 flex list-none flex-col gap-3 px-4 pb-4">
          {view.events.map(event => <li key={event.id} className="flex gap-3 text-sm">
            <span className="w-24 shrink-0 text-ink-2 tabular-nums">{shortTime(event.at)}</span>
            <span className="min-w-0 flex-1 text-ink">
              <b className="font-medium">{eventLabel(event.action)}</b> {event.by}
              {Boolean(event.detail.note) && <span className="block text-ink-2">{String(event.detail.note)}</span>}
            </span>
          </li>)}
        </ol>
      </Disclosure>
    </Panel> },
  ]} />;
}
