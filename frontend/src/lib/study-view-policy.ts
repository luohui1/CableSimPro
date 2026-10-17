export type RunIdentity = Record<string, unknown>;
const sharedViews = new Set(['cable', 'section', 'conditions', 'report']);

export function runModule(run: RunIdentity, primaryModule: string): string | null {
  if (typeof run.id !== 'string' || !run.id) return null;
  if (!run.snapshot || typeof run.snapshot !== 'object' || Array.isArray(run.snapshot)) return null;
  const value = (run.snapshot as { module?: unknown }).module;
  return value === undefined || value === '' ? primaryModule : typeof value === 'string' ? value : null;
}

export function runsForView<T extends RunIdentity>(runs: readonly T[], module: string, primaryModule: string): T[] {
  return runs.filter(run => runModule(run, primaryModule) !== null && (sharedViews.has(module) || runModule(run, primaryModule) === module));
}

export function selectedRunForView<T extends RunIdentity>(runs: readonly T[], module: string, primaryModule: string, requestedId?: string): T | undefined {
  const matching = runsForView(runs, module, primaryModule);
  // Never silently substitute the latest run for an invalid explicit link.
  return requestedId ? matching.find(run => run.id === requestedId) : matching.at(-1);
}

/** Tabs preserve their run. Moving between result modules drops stale URL state. */
export function searchForModule<T extends { run?: string; delivery?: string; dataset?: string; compare?: string; preflight?: boolean; generate?: boolean }>(search: T, from: string, to: string, owner?: string | null): T {
  if (from === to) return search;
  return { ...search, run: sharedViews.has(to) || owner === to ? search.run : '', delivery: '', dataset: '', compare: '', preflight: false, generate: false };
}

export function groupStudyModules(enabled: readonly string[]) {
  const groups = [
    { id: 'model', label: '工程对象', ids: ['cable', 'section', 'conditions'] },
    { id: 'analysis', label: '当前研究', ids: ['ampacity', 'selection', 'thermal-field', 'transient', 'sheath-losses', 'electrothermal', 'hybrid'] },
    { id: 'advanced', label: '进阶研究', ids: ['sweep', 'batch', 'method-compare', 'simulation'] },
    { id: 'delivery', label: '交付', ids: ['report'] },
  ];
  return groups.map(group => ({ ...group, ids: enabled.filter(id => group.ids.includes(id)) })).filter(group => group.ids.length);
}
