import type { CadScene } from '../cad/types';

export type SceneVisibility = Readonly<{ hidden: readonly string[]; isolated: string | null }>;
export const defaultVisibility: SceneVisibility = { hidden: [], isolated: null };
export type VisibilityAction =
  | { type: 'set-visible'; id: string; visible: boolean }
  | { type: 'isolate'; id: string }
  | { type: 'show-all' };

/** Display state only: never writes a domain document, method input or saved run. */
export function changeVisibility(state: SceneVisibility, action: VisibilityAction): SceneVisibility {
  if (action.type === 'show-all') return defaultVisibility;
  if (action.type === 'isolate') return { hidden: state.hidden, isolated: state.isolated === action.id ? null : action.id };
  const hidden = new Set(state.hidden);
  if (action.visible) hidden.delete(action.id); else hidden.add(action.id);
  return { hidden: [...hidden], isolated: null };
}

export function reconcileVisibility(state: SceneVisibility, ids: readonly string[]): SceneVisibility {
  const known = new Set(ids);
  return { hidden: state.hidden.filter(id => known.has(id)), isolated: state.isolated && known.has(state.isolated) ? state.isolated : null };
}

export function visibleObjects(scene: CadScene, state: SceneVisibility): CadScene['objects'] {
  const isolated = scene.objects.some(object => object.id === state.isolated) ? state.isolated : null;
  const hidden = new Set(state.hidden);
  return scene.objects.filter(object => isolated ? object.id === isolated : !hidden.has(object.id));
}

/** An empty result is a UI state, not a valid native CAD scene. */
export function displayScene(scene: CadScene, state: SceneVisibility): CadScene | null {
  const objects = visibleObjects(scene, state);
  return objects.length ? { ...scene, objects } : null;
}

export const sceneGroups = [
  { kind: 'cable', label: '电缆' }, { kind: 'enclosure', label: '管道与构筑物' },
  { kind: 'backfill', label: '回填' }, { kind: 'soil', label: '土壤层' }, { kind: 'ground', label: '地表' },
] as const;

export function objectMatches(object: CadScene['objects'][number], query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const label = `${object.label || ''} ${object.id} ${sceneGroups.find(group => group.kind === object.kind)?.label || ''}`.toLocaleLowerCase();
  return words.every(word => label.includes(word));
}
