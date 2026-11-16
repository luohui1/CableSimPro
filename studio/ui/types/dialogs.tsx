// The three things a person does to a version from its workspace: change the structure (a new draft version), take a step of
// review, and make the specification sheet. Each is a dialog with one primary button; nothing here decides for the person.
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { compact, REVIEW_NAMES } from '@shared/format';
import type { SpecificationReport, SpecView } from '@shared/types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { Icon, Spinner } from '@/kit/icon';
import { PropertyList } from '@/kit/properties';
import { api } from '@/state/api';
import { queryClient } from '@/state/queries';
import { openIssues, REVIEW_ACTIONS, shortTime, type ReviewAction } from './model';

const refresh = () => void queryClient.invalidateQueries({ queryKey: ['library'] });

// ---- 修改结构 ----

function ReviseForm({ view, latest, onRevised }: { view: SpecView; latest: boolean; onRevised: () => void }) {
  const editable = view.structure.filter(item => item.origin === 'table' && item.key !== 'area');
  const refusal = view.derivation.kind === 'bundled' ? '随软件提供的结构没有结构表，不能改尺寸；请导入本厂结构表。'
    : !latest ? '这是历史版本。修改请回到最新版。'
      : editable.length === 0 ? '这一版没有可以修改的结构尺寸。' : null;
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const changes = editable.filter(item => values[item.key] !== undefined && values[item.key] !== '' && Number(values[item.key]) !== item.value);
  const invalid = changes.some(item => !(Number(values[item.key]) > 0));
  const save = useMutation({
    mutationFn: () => api.op('library.revise', { spec: view.spec.id, version: view.version.number, note: note.trim(),
      values: Object.fromEntries(changes.map(item => [item.key, Number(values[item.key])])) }),
    onSuccess: () => { refresh(); onRevised(); },
    onError: cause => setError(cause.message),
  });
  return <form className="grid gap-4" onSubmit={event => { event.preventDefault(); setError(''); save.mutate(); }}>
    <DialogHeader>
      <DialogTitle>修改结构</DialogTitle>
      <DialogDescription>{view.spec.name} · 第 {view.version.number} 版。只能改原表已有的尺寸，保存后出第 {view.version.number + 1} 版草稿，原版本和它的结果保留。</DialogDescription>
    </DialogHeader>
    {refusal ? <p className="m-0 text-sm text-ink">{refusal}</p> : <>
      <div className="max-h-96 overflow-y-auto">
        <PropertyList rows={editable.map(item => ({
          label: item.label,
          value: <Input type="number" min="0" step="any" inputMode="decimal" aria-label={`修改${item.label}`} placeholder={compact(item.value, 6)}
            aria-invalid={values[item.key] !== undefined && values[item.key] !== '' && !(Number(values[item.key]) > 0)}
            value={values[item.key] ?? ''} onChange={event => setValues(current => ({ ...current, [item.key]: event.target.value }))} className="h-8 w-28 text-right tabular-nums" />,
          unit: item.unit,
          source: item.revision ? '已修改过' : undefined,
        }))} />
      </div>
      <Textarea aria-label="修改原因" placeholder="修改原因（必填）" required maxLength={400} value={note} onChange={event => setNote(event.target.value)} />
      {error && <p role="alert" className="m-0 text-sm text-error">{error}</p>}
    </>}
    <DialogFooter>
      {changes.length > 0 && <span className="mr-auto self-center text-sm text-ink-2">已改 {changes.length} 项</span>}
      <DialogClose render={<Button type="button" variant="outline" />}>{refusal ? '关闭' : '取消'}</DialogClose>
      {!refusal && <Button type="submit" disabled={!changes.length || invalid || !note.trim() || save.isPending}>
        {save.isPending ? <Spinner /> : null}保存为第 {view.version.number + 1} 版草稿</Button>}
    </DialogFooter>
  </form>;
}

export function ReviseDialog({ view, latest, open, onOpenChange, onRevised }: {
  view: SpecView; latest: boolean; open: boolean; onOpenChange: (open: boolean) => void; onRevised: () => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-xl">{open && <ReviseForm view={view} latest={latest} onRevised={onRevised} />}</DialogContent>
  </Dialog>;
}

// ---- 审核 ----

function ReviewForm({ view, action, onClose }: { view: SpecView; action: ReviewAction; onClose: () => void }) {
  // Sending a version back is never blocked by what is open; moving it forward asks the person to have seen what is open.
  const issues = action === 'return' ? [] : openIssues(view);
  const [note, setNote] = useState('');
  const [seen, setSeen] = useState(false);
  const [error, setError] = useState('');
  const review = useMutation({
    mutationFn: () => api.op('library.review.batch', { items: [{ spec: view.spec.id, version: view.version.number }], action, note: note.trim() }),
    onSuccess: () => { refresh(); onClose(); },
    onError: cause => setError(cause.message),
  });
  return <form className="grid gap-4" aria-label={`确认${REVIEW_ACTIONS[action]}`} onSubmit={event => { event.preventDefault(); setError(''); review.mutate(); }}>
    <DialogHeader>
      <DialogTitle>{REVIEW_ACTIONS[action]}</DialogTitle>
      <DialogDescription>{view.spec.name} · 第 {view.version.number} 版 · 现在是{REVIEW_NAMES[view.version.review]}。审核只能由人来做，会记入这一版的留痕。</DialogDescription>
    </DialogHeader>
    {issues.length > 0 && <div className="grid gap-3">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {issues.map(issue => <li key={issue} className="flex gap-2 text-sm text-ink">
          <span className="flex h-5 shrink-0 items-center"><Icon name="status/warning" className="text-attention" /></span>{issue}
        </li>)}
      </ul>
      <Toggle variant="outline" pressed={seen} onPressedChange={setSeen} className="h-auto justify-start py-2 text-left whitespace-normal">
        <Icon name="action/check" className={seen ? 'text-success' : 'text-ink-3'} />我已查看以上问题，确认本次审核意见；审核不表示所有标准项均通过。
      </Toggle>
    </div>}
    <Textarea aria-label="审核意见" placeholder="写明核对了什么、依据是什么（必填）" required maxLength={400} value={note} onChange={event => setNote(event.target.value)} />
    {error && <p role="alert" className="m-0 text-sm text-error">{error}</p>}
    <DialogFooter>
      <DialogClose render={<Button type="button" variant="outline" />}>取消</DialogClose>
      <Button type="submit" disabled={!note.trim() || (issues.length > 0 && !seen) || review.isPending}>{review.isPending ? <Spinner /> : null}确认{REVIEW_ACTIONS[action]}</Button>
    </DialogFooter>
  </form>;
}

export function ReviewDialog({ view, action, onClose }: { view: SpecView; action: ReviewAction | null; onClose: () => void }) {
  return <Dialog open={action !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-lg">{action && <ReviewForm view={view} action={action} onClose={onClose} />}</DialogContent>
  </Dialog>;
}

// ---- 规格书 ----

function SheetBody({ view, report, onReport, onClose }: { view: SpecView; report: SpecificationReport | null; onReport: (report: SpecificationReport) => void; onClose: () => void }) {
  const [error, setError] = useState('');
  const make = useMutation({
    mutationFn: () => api.op<SpecificationReport>('library.export', { spec: view.spec.id, version: view.version.number }),
    onSuccess: made => { refresh(); onReport(made); },
    onError: cause => setError(cause.message),
  });
  if (report) {
    return <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>规格书</DialogTitle>
        <DialogDescription>{view.spec.name} · 第 {report.version} 版 · {REVIEW_NAMES[report.review]} · {shortTime(report.created)} · {report.by}</DialogDescription>
      </DialogHeader>
      <iframe title="已生成的规格书 PDF" className="h-128 w-full rounded-field border border-line" src={`${report.url}?preview=1#view=FitH`} />
      <DialogFooter>
        <a href={`${report.url}/snapshot`} download={`${view.spec.name}-来源快照.json`} className={buttonVariants({ variant: 'outline' })}>来源快照</a>
        <a href={report.url} download={`${view.spec.name}.pdf`} className={buttonVariants({ variant: 'outline' })}><Icon name="action/arrow-down" data-icon="inline-start" />下载 PDF</a>
        <DialogClose render={<Button type="button" />}>完成</DialogClose>
      </DialogFooter>
    </div>;
  }
  return <form className="grid gap-4" onSubmit={event => { event.preventDefault(); setError(''); make.mutate(); }}>
    <DialogHeader>
      <DialogTitle>生成规格书</DialogTitle>
      <DialogDescription>
        按第 {view.version.number} 版（{REVIEW_NAMES[view.version.review]}）生成 PDF，同时保存来源快照。文件如实列出缺项、计算条件和来源；没有审核过的版本不会写成保证值。
      </DialogDescription>
    </DialogHeader>
    {error && <p role="alert" className="m-0 text-sm text-error">{error}</p>}
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onClose}>取消</Button>
      <Button type="submit" disabled={make.isPending}>{make.isPending ? <Spinner /> : <Icon name="object/file" data-icon="inline-start" />}{make.isPending ? '正在生成…' : '生成规格书 PDF'}</Button>
    </DialogFooter>
  </form>;
}

export function SheetDialog({ view, open, report, onOpenChange, onReport }: {
  view: SpecView; open: boolean; report: SpecificationReport | null; onOpenChange: (open: boolean) => void; onReport: (report: SpecificationReport) => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={report ? 'max-w-5xl' : 'max-w-lg'}>{open && <SheetBody view={view} report={report} onReport={onReport} onClose={() => onOpenChange(false)} />}</DialogContent>
  </Dialog>;
}
