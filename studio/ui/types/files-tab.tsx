// 版本与文件: where the version stands in review and who may take the next step, the versions it came through, the
// specification sheets made from it, and the trail of what was done to it. Only a person moves review forward.
import { compact, REVIEW_NAMES } from '@shared/format';
import type { SpecificationReport, SpecView } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from '@/kit/icon';
import { ReviewMark } from '@/kit/marks';
import { PropertyGroup, PropertyList, type Property } from '@/kit/properties';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { useProductSpec, useSpecificationReports } from '@/state/queries';
import { TableGroup } from './table-group';
import { eventLabel, NEXT_STEPS, REVIEW_ACTIONS, shortTime, type ReviewAction } from './model';

type Version = SpecView['versions'][number];

const COLUMNS: Column<Version>[] = [
  { key: 'number', header: '版本', width: 'w-24', cell: version => `第 ${version.number} 版` },
  { key: 'review', header: '审核', width: 'w-28', cell: version => <ReviewMark state={version.review} /> },
  { key: 'note', header: '说明', width: 'w-full max-w-0', cell: version => <span className="block truncate" title={`${version.created_by} · ${shortTime(version.created)}\n${version.note}`}>{version.note || '—'}</span> },
];

function IconLink({ label, href, download, icon }: { label: string; href: string; download: string; icon: string }) {
  return <Tooltip>
    <TooltipTrigger render={<a href={href} download={download} aria-label={label} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })} />}><Icon name={icon} /></TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>;
}

export function FilesTab({ view, latest, frozen, onVersion, onReview, onPreview }: {
  view: SpecView;
  latest: boolean;
  /** The size is still loading: what is shown is the one before, and nothing may be done to it. */
  frozen: boolean;
  onVersion: (version?: number) => void;
  onReview: (action: ReviewAction) => void;
  onPreview: (report: SpecificationReport) => void;
}) {
  const reports = useSpecificationReports(view.spec.id);
  const previousNumber = view.versions.find(item => item.number < view.version.number)?.number;
  const previous = useProductSpec(previousNumber ? view.spec.id : undefined, previousNumber);
  const difference = previous.data ? view.structure.filter(row => previous.data!.structure.find(item => item.key === row.key)?.value !== row.value) : [];
  const version = view.version;
  const stamps: Property[] = ([['提交审核', version.submitted_by, version.submitted], ['审核通过', version.reviewed_by, version.reviewed], ['发布', version.published_by, version.published]] as const)
    .filter(([, by, at]) => by && at).map(([label, by, at]) => ({ label, value: `${by} · ${shortTime(at!)}` }));
  const steps = NEXT_STEPS[version.review];

  return <>
    <PropertyGroup title="审核" aside={<ReviewMark state={version.review} />}>
      {stamps.length > 0 && <PropertyList rows={stamps} />}
      {latest && steps.length > 0 && <div className="flex flex-wrap gap-2">
        {steps.map(action => <Button key={action} variant="outline" size="sm" disabled={frozen} onClick={() => onReview(action)}>{REVIEW_ACTIONS[action]}</Button>)}
      </div>}
      {!latest && <p className="m-0 text-sm text-ink">这是历史版本，审核和修改在最新版上做。</p>}
      {latest && version.review === 'published' && <p className="m-0 text-sm text-ink">已发布。再改结构会出新的草稿版本，这一版保持不变。</p>}
    </PropertyGroup>

    <TableGroup title="版本" aside={<Badge variant="secondary">{view.versions.length} 版</Badge>}>
      <DataTable columns={COLUMNS} rows={view.versions} rowKey={item => item.id} selected={version.id}
        onSelect={frozen ? undefined : item => onVersion(item.number === view.versions[0].number ? undefined : item.number)} />
    </TableGroup>

    {difference.length > 0 && <PropertyGroup title={`与第 ${previousNumber} 版的差异`}>
      <PropertyList rows={difference.map(row => ({ label: row.label, value: `${compact(previous.data!.structure.find(item => item.key === row.key)?.value)} → ${compact(row.value)}`, unit: row.unit }))} />
    </PropertyGroup>}

    <PropertyGroup title="规格书" aside={<Badge variant="secondary">{reports.data?.length ?? 0} 份</Badge>}>
      {reports.error && <p role="alert" className="m-0 text-sm text-error">{reports.error.message}</p>}
      {reports.data?.length === 0 && <p className="m-0 text-sm text-ink">还没有生成过。点页头的“规格书”生成这一版的 PDF。</p>}
      <ItemGroup>
        {reports.data?.map(report => <Item key={report.id} variant="outline" size="sm">
          <ItemMedia variant="icon"><Icon name="object/file" /></ItemMedia>
          <ItemContent>
            <ItemTitle>第 {report.version} 版 · {REVIEW_NAMES[report.review]}</ItemTitle>
            <ItemDescription>{shortTime(report.created)} · {report.by}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="预览规格书" onClick={() => onPreview(report)} />}><Icon name="action/visible" /></TooltipTrigger>
              <TooltipContent side="bottom">预览</TooltipContent>
            </Tooltip>
            <IconLink label="下载 PDF" href={report.url} download={`${view.spec.name}.pdf`} icon="action/arrow-down" />
            <IconLink label="下载来源快照" href={`${report.url}/snapshot`} download={`${view.spec.name}-来源快照.json`} icon="result/snapshot" />
          </ItemActions>
        </Item>)}
      </ItemGroup>
    </PropertyGroup>

    <PropertyGroup title="留痕">
      {view.events.length === 0 && <p className="m-0 text-sm text-ink">这一版还没有操作记录。修改、审核和生成规格书都会记在这里。</p>}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {view.events.map(event => <li key={event.id} className="flex gap-3 text-sm">
          <span className="w-24 shrink-0 text-ink-2 tabular-nums">{shortTime(event.at)}</span>
          <span className="min-w-0 flex-1 text-ink">
            <b className="font-medium">{eventLabel(event.action)}</b> {event.by}
            {Boolean(event.detail.note) && <span className="block text-ink-2">{String(event.detail.note)}</span>}
          </span>
        </li>)}
      </ol>
    </PropertyGroup>
  </>;
}
