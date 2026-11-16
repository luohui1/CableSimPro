// Changes to the project's inputs. Every change is one host operation (the same ones the agent proposes); the host is
// asked, the host's answer replaces what is shown. Undo sends the previous values back. A change answers with the host's
// message when it did not go through, so a form can say why in its own place.
import { create } from 'zustand';
import { reportFailure } from '@/components/notice';
import type { Parts, ProjectView } from '@shared/types';
import { ApiError, api } from '@/state/api';
import { queryClient } from '@/state/queries';

export type WriteOp = 'cable.set' | 'installation.set' | 'conditions.set' | 'method.set';
/** Asks the host for one change; the answer is the host's message when it was refused, otherwise null. */
export type Edit = (op: WriteOp, params: Record<string, unknown>) => Promise<string | null>;

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

/** The host's own words for a failed action. */
export const messageOf = (error: unknown): string => (error instanceof ApiError ? error.issue.message : error instanceof Error ? error.message : '操作没有完成。');

/** One change at a time; `quiet` leaves the message to the caller instead of the notice at the foot of the screen. */
async function guarded(work: () => Promise<void>, quiet: boolean): Promise<string | null> {
  if (useHistory.getState().busy) return '上一项改动还没做完，请稍等。';
  useHistory.setState({ busy: true });
  try {
    await work();
    return null;
  } catch (error) {
    if (!quiet) reportFailure(error);
    return messageOf(error);
  } finally {
    useHistory.setState({ busy: false });
  }
}

/** Change inputs of a project through one write operation. */
export const change = (project: string, op: WriteOp, params: Record<string, unknown>, quiet = false) => guarded(async () => {
  const before = queryClient.getQueryData<ProjectView>(['project', project]);
  if (!before) return;
  const after = await send(project, { op, params });
  if (after.inputs_sha256 === before.inputs_sha256) return;
  useHistory.setState(state => ({
    past: { ...state.past, [project]: [...(state.past[project] ?? []).slice(-49), { undo: restore(op, before.parts), redo: { op, params } }] },
    future: { ...state.future, [project]: [] },
  }));
}, quiet);

export const undo = (project: string) => guarded(async () => {
  const entry = useHistory.getState().past[project]?.at(-1);
  if (!entry) return;
  await send(project, entry.undo);
  useHistory.setState(state => ({
    past: { ...state.past, [project]: state.past[project].slice(0, -1) },
    future: { ...state.future, [project]: [...(state.future[project] ?? []), entry] },
  }));
}, false);

export const redo = (project: string) => guarded(async () => {
  const entry = useHistory.getState().future[project]?.at(-1);
  if (!entry) return;
  await send(project, entry.redo);
  useHistory.setState(state => ({
    past: { ...state.past, [project]: [...(state.past[project] ?? []), entry] },
    future: { ...state.future, [project]: state.future[project].slice(0, -1) },
  }));
}, false);
