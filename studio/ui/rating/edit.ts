// Changes to the project's inputs. Every change is one host operation (the same ones the agent proposes); the host is
// asked, the host's answer replaces what is shown. Undo sends the previous values back. A change answers with the host's
// message when it did not go through, so a form can say why in its own place.
import { create } from 'zustand';
import { reportFailure } from '@/components/notice';
import type { ProjectView } from '@shared/types';
import { ApiError, api } from '@/state/api';
import { queryClient } from '@/state/queries';

export type WriteOp = 'cable.set' | 'installation.set' | 'conditions.set' | 'method.set';
/** Asks the host for one change; the answer is the host's message when it was refused, otherwise null. */
export type Edit = (op: WriteOp, params: Record<string, unknown>) => Promise<string | null>;

interface Step { op: WriteOp; params: Record<string, unknown> }
/** What a change did: the steps that take it back, and the steps that make it again. */
interface Entry { undo: Step[]; redo: Step[] }

interface History {
  past: Record<string, Entry[]>;
  future: Record<string, Entry[]>;
  busy: boolean;
}
export const useHistory = create<History>(() => ({ past: {}, future: {}, busy: false }));

/** Whether two values are the same: objects by what they hold, not by the order of their keys. */
export const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const [left, right] = [a as Record<string, unknown>, b as Record<string, unknown>];
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].every(key => same(left[key], right[key]));
};

/** The operations that put back what a change changed. */
function restoreSteps(op: WriteOp, params: Record<string, unknown>, before: ProjectView, after: ProjectView): Step[] {
  const { parts } = before;
  if (op === 'cable.set') {
    // A cable with another core count brings the laying of its own and may move the system voltage: put back what moved.
    return [
      { op, params: { model_id: parts.cable.id } },
      ...(same(parts.installation, after.parts.installation) ? [] : [{ op: 'installation.set' as const, params: { ...parts.installation } }]),
      ...(same(parts.conditions, after.parts.conditions) ? [] : [{ op: 'conditions.set' as const, params: { ...parts.conditions } }]),
    ];
  }
  if (op === 'installation.set') return [{ op, params: { ...parts.installation } }];
  if (op === 'conditions.set') return [{ op, params: { ...parts.conditions } }];
  // A parameter the engineer had not set was in force at the value the library declares: that is what comes back.
  const kept = parts.method.parameters as Record<string, unknown>;
  const effective = (before.preview?.parameters ?? kept) as Record<string, unknown>;
  const touched = Object.keys(params).filter(key => key === 'ks' || key === 'kp' || key === 'eddy');
  return [{ op, params: Object.fromEntries(touched.flatMap(key => {
    const value = kept[key] ?? effective[key];
    return value === undefined ? [] : [[key, value]];
  })) }];
}

async function send(project: string, step: Step): Promise<ProjectView> {
  const reply = await api.op<{ view: ProjectView }>(step.op, { project, ...step.params });
  queryClient.setQueryData(['project', project], reply.view);
  return reply.view;
}

/** The host's own words for a failed action. */
export const messageOf = (error: unknown): string => (error instanceof ApiError ? error.issue.message : error instanceof Error ? error.message : '操作没有完成。');

// Changes are made one after another in the order they were asked for: a second Ctrl+Z pressed while the first is on its way
// waits for it and undoes the step before, instead of being dropped.
let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;

/** One change at a time; `quiet` leaves the message to the caller instead of the notice at the foot of the screen. */
function guarded(work: () => Promise<void>, quiet: boolean): Promise<string | null> {
  waiting += 1;
  useHistory.setState({ busy: true });
  const run = queue.then(async () => {
    try {
      await work();
      return null;
    } catch (error) {
      if (!quiet) reportFailure(error);
      return messageOf(error);
    } finally {
      waiting -= 1;
      if (waiting === 0) useHistory.setState({ busy: false });
    }
  });
  queue = run;
  return run;
}

/** Change inputs of a project through one write operation. */
export const change = (project: string, op: WriteOp, params: Record<string, unknown>, quiet = false) => guarded(async () => {
  // What the inputs were is read from the host when this screen has not got it: a change is never dropped silently.
  const before: ProjectView = queryClient.getQueryData<ProjectView>(['project', project]) ?? await queryClient.fetchQuery<ProjectView>({ queryKey: ['project', project], queryFn: () => api.project(project) });
  const after = await send(project, { op, params });
  if (after.inputs_sha256 === before.inputs_sha256) return;
  useHistory.setState(state => ({
    past: { ...state.past, [project]: [...(state.past[project] ?? []).slice(-49), { undo: restoreSteps(op, params, before, after), redo: [{ op, params }] }] },
    future: { ...state.future, [project]: [] },
  }));
}, quiet);

export const undo = (project: string) => guarded(async () => {
  const entry = useHistory.getState().past[project]?.at(-1);
  if (!entry) return;
  for (const step of entry.undo) await send(project, step);
  useHistory.setState(state => ({
    past: { ...state.past, [project]: state.past[project].slice(0, -1) },
    future: { ...state.future, [project]: [...(state.future[project] ?? []), entry] },
  }));
}, false);

export const redo = (project: string) => guarded(async () => {
  const entry = useHistory.getState().future[project]?.at(-1);
  if (!entry) return;
  for (const step of entry.redo) await send(project, step);
  useHistory.setState(state => ({
    past: { ...state.past, [project]: [...(state.past[project] ?? []), entry] },
    future: { ...state.future, [project]: state.future[project].slice(0, -1) },
  }));
}, false);
