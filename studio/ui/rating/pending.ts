// What the engineer has changed in the givens and has not applied yet. A change is kept here, next to the project and not in
// it: the project, its drawing and its answer stay as they were until "按新条件计算", which writes the changes through the
// operations the Agent uses too (cable.set, installation.set, conditions.set, method.set) and then runs the check, or puts
// everything back when the host refuses one of them.
import { useState } from 'react';
import type { ProjectView } from '@shared/types';

/** One field of the givens, as the editor and the drawing name it. */
export type Key = 'cable' | 'layout' | 'depth' | 'spacing' | 'inner' | 'outer' | 'width' | 'height' | 'rho'
  | 'bonding' | 'soil' | 'ambient' | 'load' | 'voltage' | 'frequency' | 'ks' | 'kp' | 'eddy';
/** In the units the fields show: depth, backfill size m; spacing, duct size mm; system voltage kV; the loads one per circuit. */
export type Value = number | string | number[] | null;
export type Staged = Partial<Record<Key, Value>>;
export type Base = Record<Key, Value>;

const KEYS: Key[] = ['cable', 'layout', 'depth', 'spacing', 'inner', 'outer', 'width', 'height', 'rho', 'bonding', 'soil', 'ambient', 'load', 'voltage', 'frequency', 'ks', 'kp', 'eddy'];
/** What a laying of its own brings with it: typed for another laying, these no longer apply. */
const OF_LAYING: Key[] = ['spacing', 'inner', 'outer', 'width', 'height', 'rho'];

const round = (value: number) => Number(value.toPrecision(10));

/** Whether two values are the same: numbers to ten digits, so a spacing of 250 mm is not 249.99999999999997. */
export function equal(a: Value | undefined, b: Value | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, at) => equal(value, b[at]));
  if (typeof a === 'number' && typeof b === 'number') return round(a) === round(b);
  return a === b;
}

/** Whether two sets of changes hold the same. */
const sameStaged = (a: Staged, b: Staged): boolean => KEYS.every(key => (key in a) === (key in b) && equal(a[key], b[key]));

/** The project's inputs as the editor's fields hold them: what each field shows when nothing was changed. */
export function baseOf(view: ProjectView): Base {
  const { cable, installation, conditions, method } = view.parts;
  const spacing = installation.spacing_m ?? view.preview?.layout.spacing ?? null;
  // A parameter the engineer has not set is in force at the value the library declares: that is what the field shows.
  const parameters = (view.preview?.parameters ?? method.parameters) as { ks?: number; kp?: number; eddy?: string };
  return {
    cable: cable.id,
    layout: installation.layout,
    depth: installation.depth_m,
    spacing: spacing === null ? null : round(spacing * 1000),
    inner: installation.duct ? round(installation.duct.inner_diameter_m * 1000) : null,
    outer: installation.duct ? round(installation.duct.outer_diameter_m * 1000) : null,
    width: installation.backfill?.width ?? null,
    height: installation.backfill?.height ?? null,
    rho: installation.backfill?.thermal_resistivity ?? null,
    bonding: installation.bonding,
    soil: conditions.soil_thermal_resistivity,
    ambient: conditions.ambient_temperature_c,
    load: conditions.currents_a,
    voltage: conditions.system_voltage_v === null ? null : round(conditions.system_voltage_v / 1000),
    frequency: conditions.frequency_hz,
    ks: parameters.ks ?? null,
    kp: parameters.kp ?? null,
    eddy: parameters.eddy === 'trefoil' ? 'trefoil' : 'ignored',
  };
}

/**
 * A field's number for the drawing: the change waiting for it, and while that is empty or not a number yet (the engineer is
 * typing) what the project has. Null when the project has none either (a laying without spacing).
 */
export function effectiveNumber(staged: Staged, base: Base, key: Key): number | null {
  const [waiting, kept] = [staged[key], base[key]];
  if (typeof waiting === 'number' && Number.isFinite(waiting)) return waiting;
  return typeof kept === 'number' ? kept : null;
}

/** The fields whose value now is not what the project has. */
const changedKeys = (staged: Staged, base: Base): Key[] => KEYS.filter(key => key in staged && !equal(staged[key], base[key]));

function merge(staged: Staged, patch: Staged, base: Base): Staged {
  const next: Staged = { ...staged, ...patch };
  if ('layout' in patch && !equal(patch.layout, base.layout)) for (const key of OF_LAYING) delete next[key];
  // A field typed back to the project's value is no change.
  for (const key of KEYS) if (key in next && equal(next[key], base[key])) delete next[key];
  return next;
}

interface State { staged: Staged; past: Staged[]; future: Staged[]; /** The field changed last: its next change is the same step. */ last: string | null }
const EMPTY: State = { staged: {}, past: [], future: [], last: null };

/** The changes of one screen, with the steps to take them back and make them again. */
export function usePending(base: Base | null) {
  const [state, setState] = useState<State>(EMPTY);
  const changed = base ? changedKeys(state.staged, base) : [];
  return {
    staged: state.staged,
    changed,
    count: changed.length,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    /** Changes some fields; typing in one field, or stepping one dimension, is one step however many changes it takes. */
    stage: (patch: Staged, group: string) => {
      if (!base) return;
      setState(current => {
        const next = merge(current.staged, patch, base);
        if (sameStaged(next, current.staged)) return current;
        const same = group === current.last && current.past.length > 0;
        return { staged: next, past: same ? current.past : [...current.past.slice(-49), current.staged], future: [], last: group };
      });
    },
    undo: () => setState(current => (current.past.length
      ? { staged: current.past[current.past.length - 1], past: current.past.slice(0, -1), future: [...current.future, current.staged], last: null } : current)),
    redo: () => setState(current => (current.future.length
      ? { staged: current.future[current.future.length - 1], past: [...current.past, current.staged], future: current.future.slice(0, -1), last: null } : current)),
    clear: () => setState(EMPTY),
  };
}

// ---- Writing the changes ----

type WriteOp = 'cable.set' | 'installation.set' | 'conditions.set' | 'method.set';
/** One host operation that applies a part of the changes, and the one that puts that part back as it was. */
export interface Write { op: WriteOp; params: Record<string, unknown>; restore: Record<string, unknown> }

/**
 * The host operations that make the project what the editor shows, in the order the host needs them (a new cable first: it may
 * bring a laying of its own), or the first thing in the way: a field left empty or out of range. A number is checked here only
 * for being a number the method can take; whether the method can compute with it is the host's to say.
 */
export function writesOf(view: ProjectView, staged: Staged): { writes: Write[] } | { problem: string } {
  const base = baseOf(view);
  const keys = changedKeys(staged, base);
  const has = (...list: Key[]) => list.some(key => keys.includes(key));
  const value = (key: Key): Value => (key in staged ? (staged[key] as Value) : base[key]);
  const problems: string[] = [];
  const number = (key: Key, label: string, rule: (value: number) => boolean, words: string): number => {
    const given = value(key);
    if (typeof given === 'number' && Number.isFinite(given) && rule(given)) return given;
    problems.push(`${label}${words}`);
    return Number.NaN;
  };
  const positive = (value: number) => value > 0;
  const parts = view.parts;
  const writes: Write[] = [];

  if (keys.includes('cable')) writes.push({ op: 'cable.set', params: { model_id: staged.cable }, restore: { model_id: parts.cable.id } });

  const installation: Record<string, unknown> = {};
  if (keys.includes('layout')) installation.layout = staged.layout;
  if (keys.includes('depth')) installation.depth_m = number('depth', '中心埋深', positive, '要填大于 0 的数');
  if (keys.includes('spacing')) installation.spacing_m = staged.spacing === null ? null : round(number('spacing', '中心距', positive, '要填大于 0 的数') / 1000);
  if (parts.installation.duct && has('inner', 'outer')) {
    const [inner, outer] = [number('inner', '管内径', positive, '要填大于 0 的数'), number('outer', '管外径', positive, '要填大于 0 的数')];
    if (inner >= outer) problems.push('管外径要大于管内径');
    installation.duct = { ...parts.installation.duct, inner_diameter_m: round(inner / 1000), outer_diameter_m: round(outer / 1000) };
  }
  if (parts.installation.backfill && has('width', 'height', 'rho')) {
    installation.backfill = {
      ...parts.installation.backfill,
      ...(keys.includes('width') && { width: number('width', '回填宽度', positive, '要填大于 0 的数') }),
      ...(keys.includes('height') && { height: number('height', '回填高度', positive, '要填大于 0 的数') }),
      ...(keys.includes('rho') && { thermal_resistivity: number('rho', '回填热阻率', positive, '要填大于 0 的数') }),
    };
  }
  if (keys.includes('bonding')) installation.bonding = staged.bonding;
  if (Object.keys(installation).length) writes.push({ op: 'installation.set', params: installation, restore: { ...parts.installation } });

  const conditions: Record<string, unknown> = {};
  if (keys.includes('soil')) conditions.soil_thermal_resistivity = number('soil', '土壤热阻率', positive, '要填大于 0 的数');
  if (keys.includes('ambient')) conditions.ambient_temperature_c = number('ambient', '环境温度', temperature => temperature >= -50 && temperature <= 80, '要在 −50 到 80 °C 之间');
  if (keys.includes('load')) {
    const loads = value('load');
    if (!Array.isArray(loads) || loads.some(load => typeof load !== 'number' || !Number.isFinite(load) || load < 0)) problems.push('负荷电流要填不小于 0 的数');
    else conditions.currents_a = loads;
  }
  if (keys.includes('voltage')) {
    if (staged.voltage === null) conditions.system_voltage_v = null;
    else conditions.system_voltage_v = round(number('voltage', '系统线电压', positive, '要填大于 0 的数，或留空') * 1000);
  }
  if (keys.includes('frequency')) conditions.frequency_hz = number('frequency', '频率', positive, '要填大于 0 的数');
  if (Object.keys(conditions).length) writes.push({ op: 'conditions.set', params: conditions, restore: { ...parts.conditions } });

  const method: Record<string, unknown> = {};
  const between = (n: number) => n > 0 && n <= 1;
  if (keys.includes('ks')) method.ks = number('ks', '集肤效应系数 ks', between, '要在 0 到 1 之间');
  if (keys.includes('kp')) method.kp = number('kp', '邻近效应系数 kp', between, '要在 0 到 1 之间');
  if (keys.includes('eddy')) method.eddy = staged.eddy;
  if (Object.keys(method).length) {
    // What was in force goes back: the engineer's own setting, else the value the library declares.
    const kept = parts.method.parameters as Record<string, unknown>;
    const effective = (view.preview?.parameters ?? kept) as Record<string, unknown>;
    writes.push({ op: 'method.set', params: method, restore: Object.fromEntries(Object.keys(method).flatMap(key => {
      const before = kept[key] ?? effective[key];
      return before === undefined ? [] : [[key, before]];
    })) });
  }

  return problems.length ? { problem: `${[...new Set(problems)].join('；')}。` } : { writes };
}

/** The field each key of the changes belongs to in the line above the drawing. */
export type GivenKey = 'cable' | 'layout' | 'depth' | 'soil' | 'ambient' | 'load' | 'system' | 'sheath' | 'method';
export const GIVEN_OF: Record<Key, GivenKey> = {
  cable: 'cable', layout: 'layout', depth: 'depth', spacing: 'depth', inner: 'depth', outer: 'depth', width: 'depth', height: 'depth', rho: 'depth',
  bonding: 'sheath', soil: 'soil', ambient: 'ambient', load: 'load', voltage: 'system', frequency: 'system', ks: 'method', kp: 'method', eddy: 'method',
};
