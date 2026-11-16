// The calculation of one project: what is asked and given along the top, the section drawn from the shown run, the answer
// beside it. The screen shows the shown run as it was computed; conditions changed since then are marked on the givens, and
// the copper button says what comes next: run the check, or take the calculation sheet away.
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { fieldModel } from '@/canvas/field-model';
import { buildScene } from '@/canvas/scene';
import { SectionCanvas } from '@/canvas/section-canvas';
import { useView } from '@/canvas/view';
import { reportFailure } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon, Spinner } from '@/kit/icon';
import { PageHeader } from '@/kit/workbench/page';
import { EmptyState } from '@/kit/workbench/premise';
import { api } from '@/state/api';
import { queryClient, useProject, useRun } from '@/state/queries';
import { KIND_NAMES } from '@shared/format';
import type { RunRecord } from '@shared/types';
import { Conclusion, type ConclusionState } from './conclusion';
import { change, messageOf, redo, undo, useHistory, type Edit } from './edit';
import { changedGivens, Premise } from './premise';
import { ratingOf } from './rating';
import { RunsDialog, SelectionDialog, SelectionView, SweepDialog, SweepView } from './studies';

function IconAction({ label, icon, ...props }: { label: string; icon: string } & Omit<ComponentProps<typeof Button>, 'children'>) {
  return <Tooltip>
    <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} {...props} />}><Icon name={icon} /></TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>;
}

export function ProjectScreen({ projectId, runId }: { projectId: string; runId: string | undefined }) {
  const navigate = useNavigate();
  const project = useProject(projectId);
  const view = project.data;
  const runs = view?.runs ?? [];
  // A record opened by its address is shown as it was; otherwise the newest rating, which is the answer so far.
  const opened = runId ? runs.find(run => run.id === runId) : undefined;
  const shown = opened ?? runs.find(run => run.kind === 'rating');
  const loaded = useRun(projectId, shown?.id);
  const record = loaded.data;
  const current = Boolean(view && shown && shown.inputs_sha256 === view.inputs_sha256);
  const stale = Boolean(shown && !current);

  const selected = useView(state => state.selected);
  const history = useHistory();
  const [panel, setPanel] = useState<'runs' | 'sweep' | 'select' | null>(null);
  useEffect(() => useView.getState().select(null), [projectId, shown?.id]);

  const toNow = () => void navigate({ to: '/p/$projectId', params: { projectId }, search: {} });
  const toRun = (run: string) => void navigate({ to: '/p/$projectId', params: { projectId }, search: { run } });
  /** One change of the inputs; whatever record was open gives way to the present conditions. */
  const applyEdit: Edit = async (op, params) => {
    const failure = await change(projectId, op, params, true);
    if (!failure && runId) toNow();
    return failure;
  };
  const edited = (failure: Promise<string | null>) => void failure.then(message => message && reportFailure(new Error(message)));

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (!(event.ctrlKey || event.metaKey) || target.closest('input, textarea, [contenteditable]')) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      void (key === 'y' || event.shiftKey ? redo(projectId) : undo(projectId)).then(() => { if (runId) toNow(); });
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toNow only reads the project and navigates
  }, [projectId, runId]);

  const saved = (record: RunRecord) => {
    queryClient.setQueryData(['run', projectId, record.id], record);
    void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  };
  const rate = useMutation({
    mutationFn: () => api.op<RunRecord>('run.rate', { project: projectId }),
    onSuccess: record => { saved(record); toNow(); },
    onError: reportFailure,
  });
  const sheet = useMutation({
    mutationFn: async (run: string) => {
      // The tab is opened inside the click, so the browser does not treat it as a pop-up.
      const tab = window.open('', '_blank');
      try {
        const exported = await api.op<{ url: string }>('report.export', { project: projectId, run });
        if (tab) tab.location.href = exported.url;
      } catch (error) {
        tab?.close();
        throw error;
      }
    },
    onError: reportFailure,
  });

  // What the drawing and the answer are made of.
  const rating = ratingOf(record, selected);
  const drawsRecord = Boolean(record && (opened || current));
  const recordScene = record?.document ? buildScene(record.document, rating?.states, rating?.distinct ? rating.limiting : undefined) : null;
  const scene = drawsRecord && recordScene ? recordScene : view?.preview ? buildScene(view.preview.document, undefined, undefined) : null;
  const field = drawsRecord && rating ? fieldModel(record) : null;
  // The drawing calls the cable of a three-core circuit 电缆 or 回路 2; the answer names it for what it is: 三芯电缆 · 回路 1.
  const names = (id: string) => {
    const name = recordScene?.cables.find(cable => cable.id === id)?.name ?? id;
    if (record?.document?.cable_types[0]?.construction !== 'three_core') return name;
    return `三芯电缆 · ${circuitOf(id) ?? name}`;
  };
  const circuitOf = (id: string) => record?.document?.circuits.find(circuit => circuit.cables.some(item => item.id === id))?.label;
  // In a table the circuit alone is enough: the table says these are cables.
  const shortNames = (id: string) => (record?.document?.cable_types[0]?.construction === 'three_core' ? circuitOf(id) : undefined) ?? recordScene?.cables.find(cable => cable.id === id)?.name ?? id;
  const screenName = recordScene?.shape.rings.some(ring => ring.role === 'metallic_sheath') ? '金属套' : '金属屏蔽';

  const conclusion: ConclusionState = view?.issue ? { kind: 'issue', message: view.issue.message }
    : !shown ? { kind: 'empty' }
    : !record ? (loaded.error ? { kind: 'failed', message: messageOf(loaded.error) } : { kind: 'loading' })
    : rating ? { kind: 'result', record, rating, stale, names, shortNames, screenName, selected, onSelect: useView.getState().select }
    : { kind: 'failed', message: record.summary?.error?.message ?? record.summary?.operating?.error?.message ?? '运行记录里没有可显示的结果。' };

  const status = drawsRecord && record && rating
    ? <>
      <span>{record.method_card?.method ?? '载流量'} · {record.plugin_id} {record.plugin_version}</span>
      {rating.summary.operating?.iterations !== undefined && <span className="ml-auto">迭代 {rating.summary.operating.iterations} 次收敛</span>}
    </>
    : <span>{record ? '结果是按改动之前的条件算的，图上只画现在的敷设' : '还没有运行记录，图上只画现在的敷设'}</span>;

  const exportable = Boolean(shown && shown.status === 'succeeded');
  const next = current && exportable
    ? <Button disabled={sheet.isPending} onClick={() => shown && sheet.mutate(shown.id)}>{sheet.isPending ? <Spinner /> : <Icon name="result/report" data-icon="inline-start" />}导出计算书</Button>
    : <Button disabled={rate.isPending || !view?.preview} onClick={() => rate.mutate()}>{rate.isPending ? <Spinner /> : <Icon name="run/run" data-icon="inline-start" />}{rate.isPending ? '计算中' : '运行校核'}</Button>;

  const readable = shown && record && (shown.kind === 'sweep' || shown.kind === 'selection') && opened;
  let body;
  if (project.isPending) body = <EmptyState icon="status/pending" title="正在读取工程" description="请稍等。" />;
  else if (project.error || !view) body = <EmptyState icon="status/error" title="打不开这个工程" description={messageOf(project.error)} />;
  else if (readable && record.kind === 'sweep') body = <SweepView record={record} />;
  else if (readable) body = <SelectionView record={record} cable={view.parts.cable.id} adopting={history.busy} onAdopt={model => edited(applyEdit('cable.set', { model_id: model }))} />;
  else if (opened && !record && !loaded.error) body = <EmptyState icon="status/pending" title="正在读取运行记录" description="请稍等。" />;
  else {
    body = <div className="flex min-h-0 flex-1">
      {scene
        ? <SectionCanvas scene={scene} field={field} result={drawsRecord && Boolean(rating)} notice={drawsRecord && rating && !field ? '这种敷设形式不发布土壤温度场' : null} status={status}
          edit={(opened && !current) || !view.preview ? null : { depth: view.parts.installation.depth_m, spacing: view.preview.layout.spacing, commit: fields => edited(applyEdit('installation.set', fields)) }} />
        : <EmptyState icon="status/warning" title="现在的输入画不出断面" description={view.issue?.message ?? '检查上面的已知条件。'} />}
      <Conclusion state={conclusion} />
    </div>;
  }

  return <>
    <PageHeader trail={[{ label: '载流量计算', onClick: () => void navigate({ to: '/workbench' }) }]} title={view?.meta.name ?? '载流量计算'}
      marks={shown
        ? <>
          <Button variant="outline" size="sm" onClick={() => setPanel('runs')}>
            <Icon name="action/history" data-icon="inline-start" />运行记录 {shown.sequence}{shown.kind === 'rating' ? '' : ` · ${KIND_NAMES[shown.kind]}`}<Icon name="action/chevron-down" data-icon="inline-end" />
          </Button>
          {stale && <Badge variant="attention"><Icon name="status/warning" data-icon="inline-start" />条件已改 · 已过期</Badge>}
        </>
        : view && <Badge variant="outline">还没有运行记录</Badge>}
      actions={view && <>
        <IconAction label="撤销上一次改动（Ctrl+Z）" icon="action/undo" disabled={!history.past[projectId]?.length || history.busy} onClick={() => void undo(projectId).then(() => { if (runId) toNow(); })} />
        <IconAction label="重做（Ctrl+Y）" icon="action/redo" disabled={!history.future[projectId]?.length || history.busy} onClick={() => void redo(projectId).then(() => { if (runId) toNow(); })} />
        <Button variant="outline" disabled={!view.preview} onClick={() => setPanel('sweep')}><Icon name="calc/sweep" data-icon="inline-start" />扫一个条件</Button>
        <Button variant="outline" disabled={!view.preview} onClick={() => setPanel('select')}><Icon name="calc/selection" data-icon="inline-start" />选截面</Button>
        {!(current && exportable) && exportable && shown && <Button variant="outline" disabled={sheet.isPending} onClick={() => sheet.mutate(shown.id)}><Icon name="result/report" data-icon="inline-start" />导出计算书</Button>}
      </>}
      primary={view && next} />
    {view && <Premise view={view} asked={rating ? `允许电流 · ${rating.summary.ampacity?.basis_name ?? ''}` : '允许电流'} changed={record ? changedGivens(view.parts, record.inputs) : new Set()} onEdit={applyEdit} />}
    {body}
    {view && panel === 'runs' && <RunsDialog runs={runs} shown={shown?.id} current={view.inputs_sha256} onClose={() => setPanel(null)} onOpen={run => { setPanel(null); toRun(run); }} />}
    {view && panel === 'sweep' && <SweepDialog view={view} onClose={() => setPanel(null)} onDone={record => { saved(record); setPanel(null); toRun(record.id); }} />}
    {view && panel === 'select' && <SelectionDialog view={view} onClose={() => setPanel(null)} onDone={record => { saved(record); setPanel(null); toRun(record.id); }} />}
  </>;
}
