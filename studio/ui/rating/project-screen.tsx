// The calculation of one project: the run records under the header, what is asked and given along the top, the section drawn
// from the shown run, the answer beside it. The screen shows a run as it was computed. Changes to the givens are made at the
// side and kept there; nothing is written to the project until "按新条件计算", which writes them, runs the check and shows
// the new record. The copper button says what comes next: the check, the sheet, or applying the changes.
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { fieldModel } from '@/canvas/field-model';
import { buildScene } from '@/canvas/scene';
import { SectionCanvas, type SectionEdit } from '@/canvas/section-canvas';
import { useView } from '@/canvas/view';
import { reportFailure } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Icon, Spinner } from '@/kit/icon';
import { Dot } from '@/kit/marks';
import { PageHeader } from '@/kit/workbench/page';
import { EmptyState } from '@/kit/workbench/premise';
import { RunRail, type RunItem } from '@/kit/workbench/runs';
import { api } from '@/state/api';
import { queryClient, useLibrary, useProject, useRun } from '@/state/queries';
import { compact } from '@shared/format';
import type { ProjectView, RunRecord } from '@shared/types';
import { Conclusion, type ConclusionState } from './conclusion';
import { LeaveGuard } from './leave-guard';
import { messageOf } from './messages';
import { baseOf, effectiveNumber, usePending, writesOf, type GivenKey } from './pending';
import { changedGivens, givensOf, Premise, type Study } from './premise';
import { methodOf, ratingOf } from './rating';
import { SelectionDialog, SelectionScreen } from './selection';
import { GivensEditor } from './side-editor';
import { SweepDialog, SweepScreen } from './sweep';

/** The given a swept condition stands for in the line above the drawing. */
const SWEPT: Record<string, GivenKey> = { soil_thermal_resistivity: 'soil', ambient_temperature_c: 'ambient', depth_m: 'depth', spacing_m: 'layout', current_a: 'load' };

export function ProjectScreen({ projectId, runId }: { projectId: string; runId: string | undefined }) {
  const navigate = useNavigate();
  const project = useProject(projectId);
  const library = useLibrary();
  const view = project.data;
  const runs = view?.runs ?? [];
  // A record opened by its address is shown as it was. Otherwise the answer so far: the rating of the conditions as they are,
  // and when there is none the newest rating, which is then out of date.
  const opened = runId ? runs.find(run => run.id === runId) : undefined;
  const ofNow = view ? runs.find(run => run.kind === 'rating' && run.inputs_sha256 === view.inputs_sha256) : undefined;
  const succeededNow = view ? runs.find(run => run.kind === 'rating' && run.status === 'succeeded' && run.inputs_sha256 === view.inputs_sha256) : undefined;
  const shown = opened ?? ofNow ?? runs.find(run => run.kind === 'rating');
  const loaded = useRun(projectId, shown?.id);
  const record = loaded.data;
  const current = Boolean(view && shown && shown.inputs_sha256 === view.inputs_sha256);
  const stale = Boolean(shown && !current);
  /** The address names a record this project does not have. */
  const unknown = Boolean(runId && view && !opened);
  /** A sweep or a selection that was opened: it has a screen of its own instead of the drawing. */
  const study = opened && opened.kind !== 'rating' ? record : undefined;

  const selected = useView(state => state.selected);
  const base = view ? baseOf(view) : null;
  const pending = usePending(base);
  const [editing, setEditing] = useState(false);
  const [asks, setAsks] = useState<{ key: GivenKey; at: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [panel, setPanel] = useState<'sweep' | 'select' | null>(null);
  useEffect(() => useView.getState().select(null), [projectId, shown?.id]);

  const toNow = () => void navigate({ to: '/p/$projectId', params: { projectId }, search: {} });
  const toRun = (run: string) => void navigate({ to: '/p/$projectId', params: { projectId }, search: { run } });
  // The givens can be changed where the drawing is the project's own: the present conditions, or a rating that stands for them.
  const editable = Boolean(view) && (!opened || (opened.kind === 'rating' && current));
  const showEditor = editing && editable;
  /** Opens the editor at a given's field; from a record that is not the present state, first back to the present state. */
  const openEditor = (key: GivenKey | null) => {
    if (!view) return;
    if (!editable) toNow();
    // Asked for by a given: its field takes the focus. Asked for by the mark in the header: nothing is asked for.
    setAsks(was => (key ? { key, at: (was?.at ?? 0) + 1 } : null));
    setEditing(true);
  };

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      // A form that is open, or a field being typed in, keeps the keys.
      if (!(event.ctrlKey || event.metaKey) || target.closest('input, textarea, [contenteditable]') || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const again = key === 'y' || event.shiftKey;
      if (!(again ? pending.canRedo : pending.canUndo)) return;
      event.preventDefault();
      if (again) pending.redo();
      else pending.undo();
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- undo and redo only read the changes through their own updates
  }, [pending.canUndo, pending.canRedo]);

  /** A record just made: kept for reading, and the project read again, so that nothing is decided on the list from before it. */
  const saved = async (made: RunRecord) => {
    queryClient.setQueryData(['run', projectId, made.id], made);
    await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  };
  const rate = useMutation({
    mutationFn: () => api.op<RunRecord>('run.rate', { project: projectId }),
    onSuccess: async made => { await saved(made); toNow(); },
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

  /**
   * Writes the changes of the editor to the project and runs the check. All or nothing: when the host refuses one of the
   * writes, the ones before it are taken back, the changes stay in the editor, and the host's words say why.
   */
  const apply = async () => {
    if (!view || applying) return;
    const plan = writesOf(view, pending.staged);
    if ('problem' in plan) return setProblem(plan.problem);
    setProblem(null);
    setApplying(true);
    const done: typeof plan.writes = [];
    try {
      for (const write of plan.writes) {
        const reply = await api.op<{ view: ProjectView }>(write.op, { project: projectId, ...write.params });
        queryClient.setQueryData(['project', projectId], reply.view);
        done.push(write);
      }
    } catch (failure) {
      let undone = true;
      for (const write of done.reverse()) {
        try {
          const reply = await api.op<{ view: ProjectView }>(write.op, { project: projectId, ...write.restore });
          queryClient.setQueryData(['project', projectId], reply.view);
        } catch {
          undone = false;
        }
      }
      // What was refused is said in the host's words; when taking back what was written failed too, that is said as well.
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setProblem(undone ? `没有应用，工程还是原来的条件：${messageOf(failure)}` : `没有应用，而且前面写进工程的没能全部撤回，请核对已知条件：${messageOf(failure)}`);
      setApplying(false);
      return;
    }
    // The project has the new conditions, and the check follows. The editor stays open, working, until the new record is there.
    try {
      const made = await api.op<RunRecord>('run.rate', { project: projectId });
      await saved(made);
      pending.clear();
      setEditing(false);
      toNow();
    } catch (failure) {
      // The conditions are the new ones all the same: nothing is left waiting, and the check can be run again.
      reportFailure(failure);
      pending.clear();
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    } finally {
      setApplying(false);
    }
  };
  /** The size a selection chose goes into the editor as a change; applying it is the engineer's step. */
  const adopt = (model: string) => {
    pending.stage({ cable: model }, 'cable');
    openEditor('cable');
  };

  // What the drawing and the answer are made of. Temperatures are drawn only when the method has a steady state at the saved
  // load; a cable is marked hottest only when the cables differ.
  const rating = ratingOf(study ? undefined : record, selected);
  const drawsRecord = Boolean(record && (opened || current));
  const drawsResult = drawsRecord && rating?.moment === 'load';
  const recordScene = record?.document ? buildScene(record.document, rating?.operating, rating?.distinct ? rating.hottest?.id : undefined) : null;
  const scene = drawsRecord && recordScene ? recordScene : view?.preview ? buildScene(view.preview.document, undefined, undefined) : null;
  const field = drawsResult ? fieldModel(record) : null;
  // The drawing calls the cable of a three-core circuit 电缆 or 回路 2; the answer names it for what it is: 三芯电缆 · 回路 1.
  const circuitOf = (id: string) => record?.document?.circuits.find(circuit => circuit.cables.some(item => item.id === id))?.label;
  const names = (id: string) => {
    const name = recordScene?.cables.find(cable => cable.id === id)?.name ?? id;
    if (record?.document?.cable_types[0]?.construction !== 'three_core') return name;
    return `三芯电缆 · ${circuitOf(id) ?? name}`;
  };
  // In a table the circuit alone is enough: the table says these are cables.
  const shortNames = (id: string) => (record?.document?.cable_types[0]?.construction === 'three_core' ? circuitOf(id) : undefined) ?? recordScene?.cables.find(cable => cable.id === id)?.name ?? id;
  const screenName = recordScene?.shape.rings.some(ring => ring.role === 'metallic_sheath') ? '金属套' : '金属屏蔽';

  // Inputs the method cannot take stop the answer of the present conditions; a record that was opened is still its own answer.
  const conclusion: ConclusionState = view?.issue && !opened ? { kind: 'issue', message: view.issue.message }
    : !shown ? { kind: 'empty', others: runs.length > 0 }
    : !record ? (loaded.error ? { kind: 'failed', message: messageOf(loaded.error) } : { kind: 'loading' })
    : rating ? { kind: 'result', record, rating, stale, names, shortNames, screenName, selected, onSelect: useView.getState().select }
    : { kind: 'failed', message: record.summary?.error?.message ?? record.summary?.operating?.error?.message ?? '运行记录里没有可显示的结果。' };

  // The canvas's status line: the method and how it ended, or what the drawing is not showing; and the changes not applied yet.
  const waiting = pending.count > 0
    ? <span className="flex items-center gap-2 text-ink"><Dot tone="attention" />条件改了 {pending.count} 项{shown ? `，画面仍是运行记录 #${shown.sequence}` : ''}</span> : null;
  let status: ReactNode;
  if (drawsResult && record && rating) {
    status = waiting
      ? <>{waiting}<span className="ml-auto">{methodOf(record)}</span></>
      : <><span>{methodOf(record)}</span>{rating.summary.operating?.iterations !== undefined && <span className="ml-auto">迭代 {rating.summary.operating.iterations} 次收敛</span>}</>;
  } else {
    let words: string;
    if (!shown) words = runs.length > 0 ? '还没有校核，图上只画现在的敷设' : '还没有运行记录，图上只画现在的敷设';
    else if (!record) words = loaded.error ? '读不出这条运行记录' : '正在读取运行记录';
    else if (!drawsRecord) words = '结果是按改动之前的条件算的，图上只画现在的敷设';
    else words = rating ? '保存负荷下没有稳态解，图上没有温度' : '这条记录没有结果，图上只画它的敷设';
    status = <>{waiting}<span>{words}</span></>;
  }

  // Changing the laying on the drawing is changing the givens: the dimension shows the new value, the drawing waits.
  const depthNow = base ? effectiveNumber(pending.staged, base, 'depth') : null;
  const spacingNow = base && base.spacing !== null && !pending.changed.includes('layout') ? effectiveNumber(pending.staged, base, 'spacing') : null;
  const canvasEdit: SectionEdit | null = editable && view?.preview && base && depthNow !== null ? {
    depth: depthNow,
    spacing: spacingNow === null ? null : spacingNow / 1000,
    changed: { depth: pending.changed.includes('depth'), spacing: pending.changed.includes('spacing') },
    commit: fields => pending.stage(fields.depth_m !== undefined ? { depth: fields.depth_m } : { spacing: Number(((fields.spacing_m ?? 0) * 1000).toPrecision(10)) }, fields.depth_m !== undefined ? 'depth' : 'spacing'),
  } : null;

  // The next step: the sheet of a result that is shown as it stands; otherwise the check itself. While the editor is open it
  // steps back, and the editor's own button is the one copper button of the screen.
  const exportable = Boolean(shown && shown.status === 'succeeded');
  const weight = showEditor ? 'outline' : 'default';
  const next = exportable && (current || opened)
    ? <Button variant={weight} disabled={sheet.isPending} onClick={() => shown && sheet.mutate(shown.id)}>
      {sheet.isPending ? <Spinner /> : <Icon name="result/report" data-icon="inline-start" />}导出计算书
    </Button>
    : <Button variant={weight} disabled={rate.isPending || applying || !view?.preview || pending.count > 0} onClick={() => rate.mutate()}>
      {rate.isPending ? <Spinner /> : <Icon name="run/run" data-icon="inline-start" />}{rate.isPending ? '计算中' : '运行校核'}
    </Button>;

  const items: RunItem[] = view ? runs.map(run => ({ id: run.id, sequence: run.sequence, title: run.title, by: run.by, stale: run.inputs_sha256 !== view.inputs_sha256, status: run.status })) : [];

  // The line above the drawing says what the shown record asked and was given; a study stands for a range or a target.
  let asked = rating ? `允许电流 · ${rating.summary.ampacity?.basis_name ?? ''}` : '允许电流';
  let line: Study | undefined;
  if (study?.kind === 'sweep' && study.sweep) {
    const { sweep } = study;
    const values = sweep.points.map(point => point.value);
    const range = `${compact(Math.min(...values))}–${compact(Math.max(...values))} ${sweep.unit} · ${values.length} 点`;
    const layout = view?.layouts.find(option => option.kind === study.inputs.installation.layout)?.label ?? study.inputs.installation.layout;
    asked = `允许电流随${sweep.label}的变化`;
    const key = SWEPT[sweep.variable];
    line = { swept: { key, value: key === 'layout' ? `${layout} · 中心距 ${range}` : range } };
  } else if (study?.kind === 'selection' && study.selection) {
    asked = `满足 ${compact(study.selection.target_current_a)} A 的最小截面`;
    line = { target: study.selection.target_current_a, cable: `${study.inputs.cable.family} · ${study.selection.candidates.length} 个规格` };
  }
  const premiseParts = (study ?? (drawsRecord ? record : undefined))?.inputs ?? view?.parts;
  const circuits = (drawsRecord && record?.document?.circuits.length) || view?.preview?.circuit_count || view?.parts.conditions.currents_a.length || 1;
  // A given is marked when a change waits for it, or when it is not what the answer on the screen was computed from.
  const marked = new Set<GivenKey>([...givensOf(pending.changed), ...(view && record && !drawsRecord && !study ? changedGivens(view, record) : [])]);

  let body;
  if (project.isPending) body = <EmptyState icon="status/pending" title="正在读取工程" description="请稍等。" />;
  else if (project.error || !view) body = <EmptyState icon="status/error" title="打不开这个工程" description={messageOf(project.error)} />;
  else if (unknown) {
    body = <EmptyState icon="status/warning" title="没有这条运行记录" description="地址里的记录不在这个工程里。从页头下的运行记录选一条，或回到现在。"
      action={<Button variant="outline" onClick={toNow}>回到现在</Button>} />;
  } else if (study?.kind === 'sweep') body = <div className="flex min-h-0 flex-1"><SweepScreen record={study} /></div>;
  else if (study) {
    body = <div className="flex min-h-0 flex-1">
      <SelectionScreen record={study} cable={view.parts.cable.id} reviewOf={model => library.data?.find(entry => entry.id === model)?.review} onAdopt={adopt} />
    </div>;
  } else if (opened && !record && !loaded.error) body = <EmptyState icon="status/pending" title="正在读取运行记录" description="请稍等。" />;
  else {
    body = <div className="flex min-h-0 flex-1">
      {scene
        ? <SectionCanvas scene={scene} field={field} result={drawsResult} notice={drawsResult && !field ? '这种敷设形式不发布土壤温度场' : null} status={status} edit={canvasEdit} />
        : <EmptyState icon="status/warning" title="现在的输入画不出断面" description={view.issue?.message ?? '检查上面的已知条件。'} />}
      {showEditor && base
        ? <GivensEditor view={view} base={base} staged={pending.staged} changed={pending.changed} stage={pending.stage} focus={asks} problem={problem} applying={applying}
          canUndo={pending.canUndo} canRedo={pending.canRedo} onUndo={pending.undo} onRedo={pending.redo}
          onDiscard={() => { pending.clear(); setProblem(null); setEditing(false); }} onApply={() => void apply()} onClose={() => setEditing(false)} />
        : <Conclusion state={conclusion} />}
    </div>;
  }

  return <>
    <PageHeader trail={[{ label: '载流量计算', onClick: () => void navigate({ to: '/workbench' }) }]} title={view?.meta.name ?? '载流量计算'}
      marks={view && pending.count > 0 && !showEditor
        ? <Button variant="outline" size="sm" onClick={() => openEditor(null)}><Dot tone="attention" />改了 {pending.count} 项，还没应用</Button> : undefined}
      actions={view && <>
        {opened && succeededNow && opened.id !== succeededNow.id && <Button variant="outline" onClick={toNow}><Icon name="action/arrow-left" data-icon="inline-start" />回到现在的结果</Button>}
        <Button variant="outline" disabled={!view.preview} onClick={() => setPanel('sweep')}><Icon name="calc/sweep" data-icon="inline-start" />扫一个条件</Button>
        <Button variant="outline" disabled={!view.preview} onClick={() => setPanel('select')}><Icon name="calc/selection" data-icon="inline-start" />按电流选型</Button>
      </>}
      primary={view && next} />
    {items.length > 0 && <RunRail runs={items} active={shown?.id} onOpen={toRun} />}
    {view && premiseParts && <Premise parts={premiseParts} layouts={view.layouts} circuits={circuits} asked={asked} marked={marked} active={showEditor ? asks?.key ?? null : null}
      study={line} onOpen={openEditor} />}
    {body}
    {view && panel === 'sweep' && <SweepDialog view={view} onClose={() => setPanel(null)} onDone={async made => { await saved(made); setPanel(null); toRun(made.id); }} />}
    {view && panel === 'select' && <SelectionDialog view={view} onClose={() => setPanel(null)} onDone={async made => { await saved(made); setPanel(null); toRun(made.id); }} />}
    <LeaveGuard count={pending.count} />
  </>;
}
