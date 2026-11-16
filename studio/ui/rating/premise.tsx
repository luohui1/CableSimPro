// What is given, in one line above the drawing: the cable, the laying and the conditions, as the shown run was computed from
// them. Each given opens the editor at the side; a given with a change that is not applied yet, or that is not what the shown
// result was computed from, carries a dot. The givens that seldom change stand in the line on the widest screens and are folded
// into one button on the others.
import { Given, GivenMore, PremiseStrip } from '@/kit/workbench/premise';
import { BONDING_NAMES, compact } from '@shared/format';
import type { LayoutOption, Parts, ProjectView, RunRecord } from '@shared/types';
import { GIVEN_OF, type GivenKey, type Key } from './pending';

/** The method's parameters as they were in force: the ones the engineer set, and the library's declared values for the rest. */
const inForce = (resolved: Record<string, unknown> | null | undefined, kept: Record<string, unknown>) => {
  const source = resolved ?? kept;
  return { ks: source.ks, kp: source.kp, eddy: source.eddy };
};

/** The givens whose value now is not the one the shown record was computed from. */
export function changedGivens(view: ProjectView, record: RunRecord | undefined): Set<GivenKey> {
  const changed = new Set<GivenKey>();
  if (!record) return changed;
  const [now, then] = [view.parts, record.inputs];
  const differ = (key: GivenKey, a: unknown, b: unknown) => { if (!same(a, b)) changed.add(key); };
  differ('cable', [now.cable.id, now.cable.content_sha256], [then.cable.id, then.cable.content_sha256]);
  differ('layout', now.installation.layout, then.installation.layout);
  differ('depth', [now.installation.depth_m, now.installation.spacing_m, now.installation.duct, now.installation.backfill],
    [then.installation.depth_m, then.installation.spacing_m, then.installation.duct, then.installation.backfill]);
  differ('soil', now.conditions.soil_thermal_resistivity, then.conditions.soil_thermal_resistivity);
  differ('ambient', now.conditions.ambient_temperature_c, then.conditions.ambient_temperature_c);
  differ('load', now.conditions.currents_a, then.conditions.currents_a);
  differ('system', [now.conditions.system_voltage_v, now.conditions.frequency_hz], [then.conditions.system_voltage_v, then.conditions.frequency_hz]);
  differ('sheath', now.installation.bonding, then.installation.bonding);
  const [forceNow, forceThen] = [inForce(view.preview?.parameters, now.method.parameters), inForce(record.parameters, then.method.parameters)];
  differ('method', [now.method.method, forceNow.ks, forceNow.kp, forceNow.eddy], [then.method.method, forceThen.ks, forceThen.kp, forceThen.eddy]);
  return changed;
}

/** Whether two values are the same: objects by what they hold, not by the order of their keys. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const [left, right] = [a as Record<string, unknown>, b as Record<string, unknown>];
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].every(key => same(left[key], right[key]));
}

/** The givens that have a change waiting in the editor. */
export const givensOf = (keys: readonly Key[]): Set<GivenKey> => new Set(keys.map(key => GIVEN_OF[key]));

/** What a study replaces in the line: the swept given stands for its range, the load for the target current. */
export interface Study {
  /** The given that stands for a range, and how it reads. */
  swept?: { key: GivenKey; value: string };
  /** A selection asks about a target current: it takes the load's place. */
  target?: number;
  /** A selection runs the whole series: the cable reads as the series. */
  cable?: string;
}

export function Premise({ parts, layouts, circuits, asked, marked, active, study, onOpen }: {
  /** The inputs the shown run was computed from; the project's own when no run is shown. */
  parts: Parts;
  layouts: LayoutOption[];
  circuits: number;
  asked: string;
  marked: ReadonlySet<GivenKey>;
  /** The given whose field is being edited. */
  active: GivenKey | null;
  study?: Study;
  onOpen: (key: GivenKey) => void;
}) {
  const { cable, installation, conditions, method } = parts;
  const currents = conditions.currents_a;
  const alike = currents.every(value => value === currents[0]);
  const text: Record<GivenKey, string> = {
    cable: cable.name,
    layout: layouts.find(option => option.kind === installation.layout)?.label ?? installation.layout,
    depth: `${compact(installation.depth_m)} m`,
    soil: `${compact(conditions.soil_thermal_resistivity)} K·m/W`,
    ambient: `${compact(conditions.ambient_temperature_c)} °C`,
    load: alike ? `${compact(currents[0])} A${circuits > 1 ? ` × ${circuits} 回` : ''}` : `${currents.map(value => compact(value)).join(' / ')} A`,
    system: `${conditions.system_voltage_v === null ? '' : `${compact(conditions.system_voltage_v / 1000)} kV · `}${compact(conditions.frequency_hz)} Hz`,
    sheath: BONDING_NAMES[installation.bonding],
    method: method.method === 'iec60287.steady' ? 'IEC 60287 稳态' : method.method,
  };
  if (study?.cable) text.cable = study.cable;
  if (study?.target !== undefined) text.load = `${compact(study.target)} A`;
  if (study?.swept) text[study.swept.key] = study.swept.value;

  const given = (key: GivenKey, label: string) => {
    const value = text[key];
    const changed = marked.has(key);
    return <Given key={key} label={label} value={value} changed={changed} active={active === key} aria-label={`${label} ${value}${changed ? '，已改' : ''}`} onClick={() => onOpen(key)} />;
  };
  return <PremiseStrip asked={asked}>
    {given('cable', '型号')}
    {given('layout', '敷设')}
    {given('depth', '埋深')}
    {given('soil', '土壤热阻率')}
    {study?.target === undefined ? given('load', '负荷') : given('load', '目标电流')}
    <GivenMore count={4}>
      {given('ambient', '环境')}
      {given('system', '系统')}
      {given('sheath', '护套')}
      {given('method', '方法')}
    </GivenMore>
  </PremiseStrip>;
}
