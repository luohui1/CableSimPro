// The cards the Agent's work leaves in the conversation. Every card is one flat surface (no card inside a card): a header
// line with the object's name and its trust mark, the result, and the actions that take it further. Numbers come in as
// props already formatted from the run; a card never computes or invents one.
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ComponentProps, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { Disclosure } from '../disclosure';
import { Icon } from '../icon';
import { LimitMeter, Metric } from '../metric';
import { ReviewMark, TierMark, VERDICT, type Review, type Tier, type Verdict } from '../marks';

// ---- The frame every card shares ----

export function CardFrame({ icon, title, aside, children, actions, className, ...props }: {
  icon: string;
  title: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
} & Omit<ComponentProps<'section'>, 'title'>) {
  return <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface', className)} {...props}>
    <header className="flex min-h-12 items-center gap-2 px-4 pt-3">
      <Icon name={icon} className="text-ink-2" />
      <h3 className="m-0 min-w-0 flex-1 truncate text-h3 text-ink">{title}</h3>
      {aside}
    </header>
    {children && <div className="min-w-0 px-4 pt-3 pb-4">{children}</div>}
    {actions && <footer className="flex flex-wrap items-center justify-end gap-1 border-t border-line px-2 py-2">{actions}</footer>}
  </section>;
}

/** A card whose content is still being read from the host: its frame and title, the body as a grey block. */
export function CardLoading({ icon, title, height = 'h-24' }: { icon: string; title: string; height?: 'h-24' | 'h-40' | 'h-72' }) {
  return <CardFrame icon={icon} title={title} aria-busy="true"><Skeleton className={cn('w-full rounded-lg', height)} /></CardFrame>;
}

/** A quiet action in a card's footer: 计算书, 在工作台打开, 下载 STEP. */
export function CardAction({ icon, children, ...props }: { icon: string; children: ReactNode } & ComponentProps<typeof Button>) {
  return <Button variant="ghost" size="sm" {...props}><Icon name={icon} data-icon="inline-start" />{children}</Button>;
}

export const OpenInWorkbench = (props: Omit<ComponentProps<typeof Button>, 'children'>) =>
  <CardAction icon="action/external" {...props}>在工作台打开</CardAction>;

// ---- 载流量结果卡 ----

export interface RatingCardProps {
  /** The cable and the laying: YJV22-8.7/15 kV 3×240 · 三芯直埋. */
  title: string;
  tier: Tier;
  /** The allowed current, formatted: 458.7. */
  current: string;
  /** What the current means: 单回路能力. */
  basis: string;
  limiting: {
    /** The cable that reaches its limit first: 三芯电缆 · 回路 1. */
    name: string;
    /** Conductor temperature at the saved load, its limit and the ambient, in °C. */
    conductor: number;
    limit: number;
    ambient: number;
    /** The saved load and the margin to the allowed current, formatted with units. */
    load: string;
    margin: string;
  };
  /** The section drawn to scale (the canvas's own drawing). */
  figure?: ReactNode;
  actions?: ReactNode;
}

export function RatingCard({ title, tier, current, basis, limiting, figure, actions }: RatingCardProps) {
  return <CardFrame icon="calc/ampacity" title={title} aside={<TierMark tier={tier} />} actions={actions} data-card="rating">
    <div className="flex items-stretch gap-6">
      {figure && <div className="flex w-44 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-subtle">{figure}</div>}
      <div className="grid min-w-0 flex-1 grid-cols-2 items-start gap-6 py-1">
        <Metric label="允许电流" value={current} unit="A" detail={basis} />
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm text-ink-2">先到温限</span>
            <span className="truncate text-h3 text-ink">{limiting.name}</span>
          </div>
          <LimitMeter label="导体温度" value={limiting.conductor} limit={limiting.limit} from={limiting.ambient} unit="°C"
            caption={<>保存负荷 <span className="text-ink tabular-nums">{limiting.load}</span>，余量 <span className="text-ink tabular-nums">{limiting.margin}</span></>} />
        </div>
      </div>
    </div>
  </CardFrame>;
}

// ---- 标准核对结果卡 ----

export interface CheckFailure {
  /** The requirement: 绝缘标称厚度. */
  title: string;
  /** Where it fails: 芯 1、芯 2、芯 3. */
  scope?: string;
  /** The value found and what the standard asks, formatted: 4 mm / ≥ 4.5 mm. */
  actual: string;
  required: string;
  /** The clause: GB/T 12706.2—2020 表 7. */
  clause: string;
}

export function CheckCard({ title, counts, failures, more = 0, unchecked = 0, actions }: {
  title: string;
  counts: Partial<Record<Verdict, number>>;
  failures: CheckFailure[];
  /** Failures not listed on the card. */
  more?: number;
  /** Sizes of the series with no check result yet. */
  unchecked?: number;
  actions?: ReactNode;
}) {
  const shown: Verdict[] = ['passed', 'failed', 'missing'];
  return <CardFrame icon="module/standard-check" title={title} actions={actions} data-card="check">
    <div className="flex flex-col gap-4">
      <dl className="m-0 grid grid-cols-3 gap-4">
        {shown.map(verdict => <div key={verdict} className="flex flex-col gap-1" data-verdict={verdict}>
          <dt className="flex items-center gap-1 text-sm text-ink-2"><Icon name={VERDICT[verdict].icon} className={VERDICT[verdict].tone} />{VERDICT[verdict].label}</dt>
          <dd className={cn('m-0 text-metric-sm tabular-nums', verdict === 'failed' && (counts.failed ?? 0) > 0 ? 'text-error' : 'text-ink')}>{counts[verdict] ?? 0}</dd>
        </div>)}
      </dl>
      {unchecked > 0 && <p className="m-0 flex items-center gap-2 rounded-lg bg-attention-fill px-3 py-2 text-sm text-ink"><Icon name={VERDICT.missing.icon} className="text-attention" />{unchecked} 个规格还没有核对结果，先计算再核对。</p>}
      {failures.length > 0
        ? <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-lg border border-line p-0">
          {failures.map((item, index) => <li key={index} className="flex min-w-0 items-center gap-3 px-3 py-2">
            <Icon name={VERDICT.failed.icon} className="text-error" />
            <span className="min-w-0 flex-1 truncate text-sm">
              <span className="font-medium text-ink">{item.title}</span>
              {item.scope && <span className="ml-2 text-ink-2">{item.scope}</span>}
            </span>
            <span className="text-sm whitespace-nowrap text-ink tabular-nums">{item.actual}<span className="mx-1 text-ink-2">要求</span>{item.required}</span>
            <Badge variant="outline">{item.clause}</Badge>
          </li>)}
          {more > 0 && <li className="px-3 py-2 text-sm text-ink-2">另有 {more} 项不通过，在工作台逐项查看</li>}
        </ul>
        : unchecked === 0 && <p className="m-0 flex items-center gap-2 text-sm text-ink"><Icon name={VERDICT.passed.icon} className="text-success" />没有不通过的项。缺项是缺实测值或依据，补齐后再核对。</p>}
    </div>
  </CardFrame>;
}

// ---- 待审卡 ----

export interface Change {
  /** A stable key: the host's part/field. The label is used when there is none. */
  id?: string;
  label: string;
  /** Absent (or the host's '—') for a new object: then the card lists what will be created. */
  before?: string;
  after: string;
}

export type ProposalPhase = 'pending' | 'rejecting' | 'accepted' | 'rejected';

export function ProposalCard({ action, subject, changes, phase, consequence, note, onNoteChange, onAccept, onReject, onConfirmReject, onCancelReject, busy, collapseChangesAfter }: {
  /** The operation: 修改结构, 新建工程. */
  action: string;
  /** What it acts on: YJV22-8.7/15 kV 3×240 · 第 1 版. */
  subject: string;
  changes: Change[];
  phase: ProposalPhase;
  /** What the change would cause, from the host's preview: a check that would fail, a tier that would change. */
  consequence?: ReactNode;
  note?: string;
  onNoteChange?: (note: string) => void;
  onAccept?: () => void;
  onReject?: () => void;
  onConfirmReject?: () => void;
  onCancelReject?: () => void;
  busy?: boolean;
  /** Optional compact review for large proposals. Every change stays in the disclosure; decision buttons stay outside it. */
  collapseChangesAfter?: number;
}) {
  const long = collapseChangesAfter !== undefined && changes.length > collapseChangesAfter;
  const changeList = <ChangeList changes={changes} wrap={long} />;
  const list = long && (phase === 'pending' || phase === 'rejecting')
    ? <Disclosure title="完整改动" aside={<span className="text-sm text-ink-2">共 {changes.length} 项</span>} className="-mx-4">
      <div className="px-4 pb-3">{changeList}</div>
    </Disclosure>
    : changeList;
  const effects = consequence && <div className="flex items-start gap-2 rounded-lg bg-attention-fill px-3 py-2 text-sm text-ink"><Icon name="status/warning" className="mt-1 text-attention" /><div className="min-w-0 flex-1">{consequence}</div></div>;
  if (phase === 'accepted' || phase === 'rejected') {
    const accepted = phase === 'accepted';
    return <Collapsible className="rounded-card border border-line bg-surface" data-card="proposal" data-phase={phase}>
      <CollapsibleTrigger className="group flex min-h-12 w-full items-center gap-2 rounded-card px-4 text-left outline-none hover:bg-subtle focus-visible:ring-3 focus-visible:ring-ring">
        <Icon name={accepted ? 'agent/approve' : 'agent/reject'} className={accepted ? 'text-success' : 'text-error'} />
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium text-ink">{accepted ? '已接受' : '已拒绝'} · {action}</span>
          <span className="ml-2 text-ink-2">{subject}</span>
        </span>
        <span className="text-sm whitespace-nowrap text-ink-2">{accepted ? `${changes.length} 项已生效` : note ? `原因：${note}` : '没有改动'}</span>
        <Icon name="action/chevron-right" className="text-ink-2 transition-transform duration-std group-data-panel-open:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-height data-ending-style:h-0 data-starting-style:h-0">
        <div className="flex flex-col gap-3 border-t border-line px-4 py-3">{list}{effects}</div>
      </CollapsibleContent>
    </Collapsible>;
  }
  return <section className="flex min-w-0 flex-col overflow-hidden rounded-card border border-agent bg-surface" data-card="proposal" data-phase={phase}>
    <header className="flex min-h-12 items-center gap-2 px-4 pt-3">
      <Badge variant="agent"><Icon name="agent/proposal" data-icon="inline-start" />待你审阅</Badge>
      <h3 className="m-0 min-w-0 flex-1 truncate text-h3 text-ink">{action}<span className="ml-2 font-normal text-ink-2">{subject}</span></h3>
    </header>
    <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
      {list}
      {effects}
    </div>
    <footer className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
      {phase === 'pending'
        ? <>
          <Button onClick={onAccept} disabled={busy}><Icon name="agent/approve" data-icon="inline-start" />接受</Button>
          <Button variant="outline" onClick={onReject} disabled={busy}>拒绝</Button>
        </>
        : <>
          <Input value={note ?? ''} onChange={event => onNoteChange?.(event.target.value)} placeholder="拒绝的原因，Agent 会照此调整（可不写）"
            aria-label="拒绝的原因" className="h-9 max-w-sm flex-1" />
          <Button variant="outline" onClick={onConfirmReject} disabled={busy}>确认拒绝</Button>
          <Button variant="ghost" onClick={onCancelReject}>取消</Button>
        </>}
    </footer>
  </section>;
}

function ChangeList({ changes, wrap = false }: { changes: Change[]; wrap?: boolean }) {
  const edits = changes.some(change => change.before !== undefined && change.before !== '—');
  return <dl data-proposal-changes className={cn('m-0 grid items-baseline gap-x-3 gap-y-2', edits ? 'grid-cols-change' : 'grid-cols-label')}>
    {changes.map((change, index) => <div key={change.id ?? `${index}/${change.label}`} className="contents">
      <dt className={cn('min-w-0 text-sm text-ink-2', wrap ? 'break-words whitespace-normal' : 'truncate')}>{change.label}</dt>
      {edits && <dd className={cn('m-0 text-sm text-ink-2 tabular-nums line-through decoration-ink-3', wrap && 'min-w-0 break-words whitespace-normal')}>{change.before ?? '—'}</dd>}
      {edits && <dd className="m-0 flex items-center self-center text-ink-3" aria-hidden="true"><Icon name="action/arrow-right" /></dd>}
      <dd className={cn('m-0 min-w-0 text-sm font-medium text-ink tabular-nums', wrap && 'break-words whitespace-normal')}>{change.after}</dd>
    </div>)}
  </dl>;
}

// ---- 文件卡 ----

export function FileCard({ title, kind, format, review, onPreview, onDownload, onOpen }: {
  /** YJV22-8.7/15 kV 3×240 · 第 1 版 */
  title: string;
  /** 规格书 or 计算书. */
  kind: string;
  format: 'PDF' | 'HTML';
  review?: Review;
  onPreview?: () => void;
  onDownload?: () => void;
  onOpen?: () => void;
}) {
  return <Item variant="outline" className="bg-surface" data-card="file">
    <ItemMedia variant="tile"><Icon name={kind === '计算书' ? 'result/report' : 'object/file'} /></ItemMedia>
    <ItemContent>
      <ItemTitle>{title}</ItemTitle>
      <ItemDescription className="flex items-center gap-2">{kind}<span aria-hidden="true">·</span>{format}{review && <ReviewMark state={review} className="ml-1" />}</ItemDescription>
    </ItemContent>
    <ItemActions>
      {onOpen && <Button variant="ghost" size="sm" onClick={onOpen}><Icon name="action/external" data-icon="inline-start" />在工作台打开</Button>}
      <Button variant="outline" size="sm" onClick={onPreview}><Icon name="action/visible" data-icon="inline-start" />预览</Button>
      <Button variant="ghost" size="icon-sm" aria-label="下载" onClick={onDownload}><Icon name="action/import" /></Button>
    </ItemActions>
  </Item>;
}

// ---- 三维模型卡 ----

export function ModelCard({ title, state, viewport, error, facts, view = 'cutaway', onViewChange, actions }: {
  title: string;
  state: 'loading' | 'ready' | 'failed';
  /** The workbench's own 3D viewport (CadViewport), sized by the card. */
  viewport?: ReactNode;
  error?: string;
  /** Short facts under the view: 外径 82 mm, 19 层. */
  facts?: { label: string; value: string }[];
  view?: 'cutaway' | 'solid';
  onViewChange?: (view: 'cutaway' | 'solid') => void;
  actions?: ReactNode;
}) {
  return <CardFrame icon="tool/view-3d" title={title} actions={state === 'ready' ? actions : undefined} data-card="model3d" data-state={state}
    aside={facts && state === 'ready' && <span className="flex items-center gap-2">{facts.map(fact => <Badge key={fact.label} variant="secondary">{fact.label} {fact.value}</Badge>)}</span>}>
    {state === 'loading' && <div className="flex h-72 flex-col items-center justify-center gap-3 rounded-lg bg-subtle"><Skeleton className="size-24 rounded-full bg-line" /><span className="text-sm text-ink-2">正在生成三维实体</span></div>}
    {state === 'failed' && <div className="flex h-40 items-center gap-3 rounded-lg bg-error-fill px-4 text-sm text-ink"><Icon name="status/error" className="text-error" />三维实体没有生成：{error}</div>}
    {state === 'ready' && <div className="relative h-72 overflow-hidden rounded-lg border border-line bg-subtle cad-fill">
      {viewport}
      <ToggleGroup value={[view]} onValueChange={next => next[0] && onViewChange?.(next[0] as 'cutaway' | 'solid')} size="sm"
        className="absolute top-3 left-3 rounded-lg border border-line bg-surface p-1 shadow-menu" aria-label="显示方式">
        <ToggleGroupItem value="cutaway">分层剖开</ToggleGroupItem>
        <ToggleGroupItem value="solid">完整实体</ToggleGroupItem>
      </ToggleGroup>
    </div>}
  </CardFrame>;
}

// ---- 拒算或出错卡 ----

export function RefusalCard({ kind, title, reason, missing, actions }: {
  /** refused: the method or the data says no (缺数据、超出适用范围); error: something broke. */
  kind: 'refused' | 'error';
  /** What was asked: 载流量 · YJV22-8.7/15 kV 3×50. */
  title: string;
  /** The reason as the method gave it. */
  reason: string;
  /** What is missing or out of range, and what to do about it. */
  missing?: { label: string; detail: string }[];
  actions?: ReactNode;
}) {
  return <CardFrame icon={kind === 'refused' ? 'status/warning' : 'status/error'} title={title} actions={actions} data-card="refusal" data-kind={kind}
    aside={<Badge variant={kind === 'refused' ? 'attention' : 'error'}>{kind === 'refused' ? '没有算' : '出错'}</Badge>}>
    <Alert variant={kind === 'error' ? 'destructive' : 'default'}>
      <Icon name={kind === 'refused' ? 'status/warning' : 'status/error'} />
      <AlertTitle className="font-normal">{reason}</AlertTitle>
      {missing && missing.length > 0 && <AlertDescription>
        <dl className="m-0 grid grid-cols-label gap-x-3 gap-y-2">
          {missing.map(item => <div key={item.label} className="contents">
            <dt className="text-sm font-medium text-ink">{item.label}</dt>
            <dd className="m-0 text-sm text-ink-2">{item.detail}</dd>
          </div>)}
        </dl>
      </AlertDescription>}
    </Alert>
  </CardFrame>;
}
