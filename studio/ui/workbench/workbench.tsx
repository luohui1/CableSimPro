// The workbench of one project. The section drawing is the protagonist; the premises sit above it,
// the conclusion beside it, the run records below it.
import { useEffect, useState } from 'react';
import { fieldModel } from '@/canvas/field-model';
import { buildScene } from '@/canvas/scene';
import { SectionCanvas } from '@/canvas/section-canvas';
import { readRamp } from '@/lib/ramp';
import { ratingOf } from '@/results/rating';
import { VerdictColumn } from '@/results/verdict-column';
import { useProject, useProjects, useRun } from '@/state/queries';
import { useTheme } from '@/state/theme';
import { useView } from '@/state/view';
import { TEMPERATURE_FIELD } from '@shared/types';
import { PremiseStrip } from './premise-strip';
import { RunRail } from './run-rail';
import { TopBar } from './top-bar';

export function Workbench({ projectId, runId, onOpenProject, onOpenRun }: {
  projectId: string;
  runId: string | undefined;
  onOpenProject: (id: string) => void;
  onOpenRun: (run: string) => void;
}) {
  const projects = useProjects();
  const project = useProject(projectId);
  const view = project.data;
  const runs = view?.runs ?? [];
  const active = runs.find(run => run.id === runId) ?? runs.find(run => run.kind === 'rating') ?? runs[0];
  const loaded = useRun(projectId, active?.id);
  const record = active ? loaded.data : undefined;
  const { mode, selected } = useView();
  const theme = useTheme(state => state.theme);
  const [ramp, setRamp] = useState(readRamp);
  useEffect(() => setRamp(readRamp()), [theme]);
  useEffect(() => useView.getState().select(null), [projectId, active?.id]);

  const rating = ratingOf(record, mode, selected);
  // A record is drawn with the geometry it was computed for, even if the project has changed since.
  const document = (rating ? record?.document : null) ?? view?.preview?.document ?? null;
  const scene = document ? buildScene(document, rating?.states, rating?.limiting) : null;
  const published = Boolean(record?.result.cases[0]?.artifacts[TEMPERATURE_FIELD]);
  const field = rating && mode === 'load' ? fieldModel(record) : null;
  const notice = !rating ? null
    : mode === 'rated' ? (published ? '温度场按保存负荷发布，额定工况下不显示' : null)
    : field ? null : '这种敷设形式不发布土壤温度场';

  return <div className="grid h-full grid-rows-[48px_minmax(0,1fr)]">
    <TopBar projects={projects.data ?? []} project={view?.meta} run={record?.kind === 'rating' ? record.id : undefined} runnable={Boolean(view?.preview)}
      onOpenProject={onOpenProject} onOpenRun={onOpenRun} />
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_432px] gap-2 px-2 pb-2 min-[1700px]:grid-cols-[minmax(0,1fr)_520px]">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-sheet border border-line bg-panel">
        {view && <PremiseStrip view={view} />}
        <div className="relative min-h-0 flex-1">
          {scene
            ? <SectionCanvas scene={scene} field={field} result={Boolean(rating)} notice={notice} />
            : <div className="flex h-full items-center justify-center text-14 text-ink-2">{project.isPending ? '正在读取工程' : view?.issue?.message ?? project.error?.message}</div>}
        </div>
        <RunRail runs={runs} active={active?.id} current={view?.inputs_sha256 ?? ''} onOpen={onOpenRun} />
      </section>
      <aside className="min-h-0 overflow-hidden rounded-sheet border border-line bg-panel">
        <VerdictColumn record={record} rating={rating} scene={scene} document={document} ramp={ramp} selected={selected}
          stale={Boolean(active && view && active.inputs_sha256 !== view.inputs_sha256)} loading={project.isPending || (Boolean(active) && loaded.isPending)} />
      </aside>
    </div>
  </div>;
}
