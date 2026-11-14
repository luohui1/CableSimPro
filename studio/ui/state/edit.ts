// Changes to the project's inputs. Every change is one host operation (the same ones the agent proposes);
// the host is asked, the host's answer replaces what is shown. Undo sends the previous values back.
import { create } from 'zustand';
import { reportFailure } from '@/components/notice';
import type { Parts, ProjectView } from '@shared/types';
import { api } from './api';
import { queryClient } from './queries';

type WriteOp = 'cable.set' | 'installation.set' | 'conditions.set' | 'method.set';
interface Step { op: WriteOp; params: Record<string, unknown> }
interface Entry { undo: Step; redo: Step }

interface History {
  past: Record<string, Entry[]>;
  future: Record<string, Entry[]>;
  busy: boolean;
}
export const useHistory = create<History>(() => ({ past: {}, future: {}, busy: false }));

/** The operation that puts one part back to what it was. */
function restore(op: WriteOp, parts: Parts): Step {
  if (op === 'cable.set') return { op, params: { model_id: parts.cable.id } };
  if (op === 'installation.set') return { op, params: { ...parts.installation } };
  if (op === 'conditions.set') return { op, params: { ...parts.conditions } };
  const { ks, kp, eddy } = parts.method.parameters as { ks?: number; kp?: number; eddy?: string };
  return { op, params: { ...(ks !== undefined && { ks }), ...(kp !== undefined && { kp }), ...(eddy !== undefined && { eddy }) } };
}

async function send(project: string, step: Step): Promise<ProjectView> {
  const reply = await api.op<{ view: ProjectView }>(step.op, { project, ...step.params });
  queryClient.setQueryData(['project', project], reply.view);
  return reply.view;
}

async function guarded(work: () => Promise<void>) {
  if (useHistory.getState().busy) return;
  useHistory.setState({ busy: true });
  try {
    await work();
  } catch (error) {
    reportFailure(error);
  } finally {
    useHistory.setState({ busy: false });
  }
}

/** Change inputs of a project through one write operation. */
export const change = (project: string, op: WriteOp, params: Record<string, unknown>) => guarded(async () => {
  const before = queryClient.getQueryData<ProjectView>(['project', project]);
  if (!before) return;
  const after = await send(project, { op, params });
  if (after.inputs_sha256 === before.inputs_sha256) return;
  useHistory.setState(state => ({
    past: { ...state.past, [project]: [...(state.past[project] ?? []).slice(-49), { undo: restore(op, before.parts), redo: { op, params } }] },
    future: { ...state.future, [project]: [] },
  }));
});

export const undo = (project: string) => guarded(async () => {
  const entry = useHistory.getState().past[project]?.at(-1);
  if (!entry) return;
  await send(project, entry.undo);
  useHistory.setState(state => ({
    past: { ...state.past, [project]: state.past[project].slice(0, -1) },
    future: { ...state.future, [project]: [...(state.future[project] ?? []), entry] },
  }));
});

export const redo = (project: string) => guarded(async () => {
  const entry = useHistory.getState().future[project]?.at(-1);
  if (!entry) return;
  await send(project, entry.redo);
  useHistory.setState(state => ({
    past: { ...state.past, [project]: [...(state.past[project] ?? []), entry] },
    future: { ...state.future, [project]: state.future[project].slice(0, -1) },
  }));
});
