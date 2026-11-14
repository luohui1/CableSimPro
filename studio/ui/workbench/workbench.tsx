// The workbench of one project. The section drawing is the protagonist; the premises sit above it,
// the conclusion beside it, the run records below it.
//
// What is shown is the result for the project's present inputs: a kept record if there is one, otherwise a
// draft the host computes right after each change. A record opened from the rail is shown as it was.
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { fieldModel } from '@/canvas/field-model';
import { buildScene } from '@/canvas/scene';
import { SectionCanvas } from '@/canvas/section-canvas';
import { reportFailure } from '@/components/notice';
import { readRamp } from '@/lib/ramp';
import { questionOf } from '@/results/question';
import { ratingOf } from '@/results/rating';
import { VerdictColumn } from '@/results/verdict-column';
import { api, ApiError } from '@/state/api';
import { change, redo, undo, useHistory } from '@/state/edit';
import { queryClient, useDraft, useProject, useProjects, useRun } from '@/state/queries';
import { useTheme } from '@/state/theme';
import { useView } from '@/state/view';
import { fixed } from '@shared/format';
import { TEMPERATURE_FIELD, type RunRecord } from '@shared/types';
import { PremiseStrip, type Edit } from './premise-strip';
import { RunRail } from './run-rail';
import { TopBar, type Step } from './top-bar';

export function Workbench({ projectId, runId, onOpenProject, onOpenRun }: {
  projectId: string;
  runId: string | undefined;
  onOpenProject: (id: string) => void;
  /** Open a run record, or with no id the result for the present inputs. */
  onOpenRun: (run?: string) => void;
}) {
  const projects = useProjects();
  const project = useProject(projectId);
  const view = project.data;
  const runs = view?.runs ?? [];
  const opened = runId ? runs.find(run => run.id === runId) : undefined;
  const kept = view ? runs.find(run => run.kind === 'rating' && run.inputs_sha256 === view.inputs_sha256) : undefined;
  const shown = opened ?? kept;
  const loaded = useRun(projectId, shown?.id);
  const draft = useDraft(projectId, view?.inputs_sha256, Boolean(view?.preview) && !shown);
  const computing = !shown && draft.isFetching;
  const drafted = !shown && Boolean(draft.data) && !draft.isPlaceholderData && !draft.isFetching;
  const record = shown ? loaded.data : draft.data;

  const { mode, selected } = useView();
  const theme = useTheme(state => state.theme);
  const history = useHistory();
  const [ramp, setRamp] = useState(readRamp);
  useEffect(() => setRamp(readRamp()), [theme]);
  useEffect(() => useView.getState().select(null), [projectId, shown?.id]);

  const rating = ratingOf(record, mode, selected);
  // While a new draft is being computed the old numbers stay (dimmed) but are not drawn on the new geometry.
  const settled = Boolean(rating) && !computing;
  const stale = Boolean(opened && view && opened.inputs_sha256 !== view.inputs_sha256);
  const document = (settled ? record?.document : null) ?? view?.preview?.document ?? null;
  const scene = document ? buildScene(document, settled ? rating?.states : undefined, settled && rating?.distinct ? rating.limiting : undefined) : null;
  const published = Boolean(record?.result.cases[0]?.artifacts[TEMPERATURE_FIELD]);
  const field = settled && mode === 'load' ? fieldModel(record) : null;
  const notice = !settled ? null
    : mode === 'rated' ? (published ? '温度场按现在的负荷发布，带满时不显示' : null)
    : field ? null : '这种敷设形式不发布土壤温度场';

  const edit: Edit = (op, params) => {
    void change(projectId, op, params);
    if (runId) onOpenRun();
  };
  const keep = useMutation({
    mutationFn: () => api.op<RunRecord>('draft.keep', { project: projectId }),
    onSuccess: async saved => {
      queryClient.setQueryData(['run', projectId, saved.id], saved);
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: reportFailure,
  });

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (!(event.ctrlKey || event.metaKey) || target.closest('input, textarea, [contenteditable]')) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      void (key === 'y' || event.shiftKey ? redo(projectId) : undo(projectId));
      if (runId) onOpenRun();
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [projectId, runId, onOpenRun]);

  // The copper button is always the next step.
  const next: Step = stale ? { kind: 'action', label: '看现在的结果', icon: 'action/refresh', onClick: () => onOpenRun() }
    : drafted && rating ? { kind: 'action', label: '存为记录', icon: 'action/save', busy: keep.isPending, onClick: () => keep.mutate() }
    : shown && rating ? { kind: 'sheet' }
    : { kind: 'action', label: computing ? '计算中' : '运行校核', icon: 'run/run', busy: computing, disabled: true, onClick: () => undefined };
  const failure = !shown && draft.error ? (draft.error instanceof ApiError ? draft.error.issue.message : draft.error.message) : null;

  return <div className="grid h-full grid-rows-[48px_minmax(0,1fr)]">
    <TopBar projects={projects.data ?? []} project={view?.meta} sheetRun={shown && record?.kind === 'rating' && record.id !== 'draft' ? record.id : undefined} next={next}
      canUndo={Boolean(history.past[projectId]?.length)} canRedo={Boolean(history.future[projectId]?.length)}
      onUndo={() => { void undo(projectId); if (runId) onOpenRun(); }} onRedo={() => { void redo(projectId); if (runId) onOpenRun(); }}
      onOpenProject={onOpenProject} />
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_432px] gap-2 px-2 pb-2 min-[1700px]:grid-cols-[minmax(0,1fr)_520px]">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-sheet border border-line bg-panel">
        {/* The screen reads like a worked problem: what is asked, what is given, then the drawing; the answer is on the right. */}
        <div className="grid h-11 shrink-0 grid-cols-[52px_minmax(0,1fr)] items-center border-b border-line">
          <span className="text-center text-13 font-strong text-ink-2">求</span>
          <h1 className="m-0 truncate pr-4 text-16 font-strong text-ink">{questionOf(view, shown ? record : undefined)}</h1>
        </div>
        {view && <PremiseStrip view={view} onEdit={edit} />}
        <div className="relative min-h-0 flex-1">
          {scene
            ? <SectionCanvas scene={scene} field={field} result={settled} notice={notice}
              edit={stale || !view?.preview ? null : {
                depth: view.parts.installation.depth_m,
                spacing: view.preview.layout.spacing,
                commit: fields => edit('installation.set', fields),
              }} />
            : <div className="flex h-full items-center justify-center px-8 text-center text-14 text-ink-2">{project.isPending ? '正在读取工程' : view?.issue?.message ?? project.error?.message}</div>}
        </div>
        <RunRail runs={runs} active={shown?.id} current={view?.inputs_sha256 ?? ''} onOpen={onOpenRun}
          draft={!shown && (drafted || computing) ? { label: computing ? '计算中' : rating ? `${fixed(rating.ampacity)} A` : '没有结果', computing } : null} />
      </section>
      <aside className="min-h-0 overflow-hidden rounded-sheet border border-line bg-panel">
        <VerdictColumn record={record} rating={rating} scene={scene} document={document} ramp={ramp} selected={selected}
          stale={stale} draft={drafted} computing={computing} failure={failure}
          loading={project.isPending || (Boolean(shown) && loaded.isPending) || (!shown && !record && draft.isPending && Boolean(view?.preview))} />
      </aside>
    </div>
  </div>;
}
