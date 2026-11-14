// State of the workbench: the open project, its runs, the selection and the agent's work.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentStatus, Issue, LibraryEntry, MethodCard, Proposal, ProjectMeta, ProjectView, RunHeader, RunRecord, Task } from '../shared/types.ts';
import { api, ApiError, subscribe } from './api.ts';

export type Step = 'cable' | 'installation' | 'conditions' | 'method' | 'result' | 'report';
export const STEPS: { id: Step; label: string }[] = [
  { id: 'cable', label: '型号' }, { id: 'installation', label: '敷设' }, { id: 'conditions', label: '工况' },
  { id: 'method', label: '方法' }, { id: 'result', label: '结果' }, { id: 'report', label: '计算书' },
];
export interface Selection { kind: 'cable' | 'ring'; id: string }
export interface Route { project?: string; step: Step; run?: string }
export type DialogName = 'project' | 'library' | 'sweep' | 'selection' | null;
export interface MethodEntry extends Omit<MethodCard, 'validation' | 'tier' | 'standards' | 'scope' | 'assumptions'> {
  id: string; title: string; answers: string[]; inputs: string[]; cost: string; plugin_version: string;
  validation_level: string; validation_cases: string[]; limitations: string[];
}

function readRoute(): Route {
  const [, project, step, run] = location.hash.replace(/^#\/?/, '').split('/');
  return { project: project || undefined, step: STEPS.some(item => item.id === step) ? step as Step : 'cable', run: run || undefined };
}

export function useStudio() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [methods, setMethods] = useState<MethodEntry[]>([]);
  const [view, setView] = useState<ProjectView | null>(null);
  const [records, setRecords] = useState<Record<string, RunRecord>>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [agentOpen, setAgentOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Issue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const projectId = route.project;
  const current = useRef(projectId);
  current.current = projectId;

  const navigate = useCallback((next: Partial<Route>) => {
    const target = { ...readRoute(), ...next };
    if ('step' in next && !('run' in next)) target.run = undefined;
    location.hash = target.project ? `/p/${target.project}/${target.step}${target.run ? '/' + target.run : ''}` : '/';
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const reloadProjects = useCallback(() => api.projects().then(setProjects), []);
  const reloadAgent = useCallback((id: string) => api.agent(id).then(state => {
    if (current.current !== id) return;
    setStatus(state.status); setTasks(state.tasks); setProposals(state.proposals);
  }), []);
  const reloadView = useCallback((id: string) => api.project(id).then(next => { if (current.current === id) setView(next); }), []);

  useEffect(() => {
    Promise.all([api.status().then(reply => setStatus(reply.agent)), reloadProjects(), api.library().then(setLibrary),
      fetch('/api/methods').then(reply => reply.json()).then(setMethods)])
      .catch(problem => setLoadError(problem instanceof Error ? problem.message : String(problem)));
  }, [reloadProjects]);

  useEffect(() => {
    setView(null); setRecords({}); setSelection(null); setTasks([]); setProposals([]); setFailure(null);
    if (!projectId) return;
    reloadView(projectId).catch(problem => setLoadError(problem instanceof ApiError ? problem.message : String(problem)));
    reloadAgent(projectId).catch(() => undefined);
  }, [projectId, reloadView, reloadAgent]);

  useEffect(() => subscribe(event => {
    const id = current.current;
    if (event.type === 'project') {
      void reloadProjects();
      if (event.project_id === id) void reloadView(id);
    } else if (event.type === 'task' && event.task.project_id === id) {
      setTasks(list => [event.task, ...list.filter(task => task.id !== event.task.id)].sort((a, b) => b.created.localeCompare(a.created)));
    } else if (event.type === 'proposal' && event.proposal.project_id === id) {
      setProposals(list => event.proposal.status === 'pending'
        ? [...list.filter(item => item.id !== event.proposal.id), event.proposal]
        : list.filter(item => item.id !== event.proposal.id));
    }
  }), [reloadProjects, reloadView]);

  const runs: RunHeader[] = view?.runs ?? [];
  const runId = route.run && runs.some(run => run.id === route.run) ? route.run : runs[0]?.id;
  const record = runId ? records[runId] : undefined;
  useEffect(() => {
    if (!projectId || !runId || records[runId]) return;
    api.run(projectId, runId).then(loaded => setRecords(all => ({ ...all, [loaded.id]: loaded }))).catch(() => undefined);
  }, [projectId, runId, records]);

  /** The latest check computed from exactly the inputs now on screen. */
  const currentRating = useMemo(() => runs.find(run => run.kind === 'rating' && run.inputs_sha256 === view?.inputs_sha256), [runs, view]);

  const write = useCallback(async (operation: string, patch: Record<string, unknown>) => {
    if (!projectId) return;
    try {
      const result = await api.op<{ view: ProjectView }>(operation, { project: projectId, ...patch });
      setView(result.view);
      setFailure(null);
    } catch (problem) {
      throw new Error(problem instanceof ApiError ? problem.message : String(problem));
    }
  }, [projectId]);

  const run = useCallback(async (operation: 'run.rate' | 'run.sweep' | 'run.select', params: Record<string, unknown> = {}, label = '正在计算') => {
    if (!projectId) return;
    setBusy(label); setFailure(null);
    try {
      const saved = await api.op<RunRecord>(operation, { project: projectId, ...params });
      setRecords(all => ({ ...all, [saved.id]: saved }));
      setSelection(null);
      await reloadView(projectId);
      navigate({ step: 'result', run: saved.id });
    } catch (problem) {
      setFailure(problem instanceof ApiError ? problem.issue : { code: 'ERROR', message: String(problem) });
    } finally {
      setBusy(null);
    }
  }, [projectId, navigate, reloadView]);

  const exportReport = useCallback(async (id: string) => {
    if (!projectId) return;
    setBusy('正在生成计算书');
    try {
      await api.op('report.export', { project: projectId, run: id });
      await reloadView(projectId);
      navigate({ step: 'report', run: id });
    } catch (problem) {
      setFailure(problem instanceof ApiError ? problem.issue : { code: 'ERROR', message: String(problem) });
    } finally {
      setBusy(null);
    }
  }, [projectId, navigate, reloadView]);

  const createProject = useCallback(async (name: string, model: string) => {
    const created = await api.op<ProjectView>('project.create', { name, model_id: model });
    await reloadProjects();
    setDialog(null);
    navigate({ project: created.meta.id, step: 'cable', run: undefined });
  }, [navigate, reloadProjects]);

  /** Open the agent panel with an instruction ready, for help on the selected object. */
  const askAgent = useCallback((instruction: string) => { setDraft(instruction); setAgentOpen(true); }, []);

  return {
    route, navigate, status, projects, library, methods, view, runs, runId, record, currentRating, selection, setSelection, tasks, proposals,
    agentOpen, setAgentOpen, dialog, setDialog, busy, failure, setFailure, loadError, draft, setDraft,
    write, run, exportReport, createProject, askAgent, reloadAgent,
  };
}

export type Studio = ReturnType<typeof useStudio>;
