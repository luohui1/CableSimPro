// What the conclusion reads from a rating record: the answer, the cable it is about and the numbers under it. Every number
// is the method's own, as saved in the record; nothing here computes one, and nothing here overrules what the method says
// (which cable reaches its limit first, whether the saved load is within the limit).
import type { CableState, HeatContribution, Issue, Parts, RunRecord, Summary } from '@shared/types';

export interface Rating {
  summary: Summary;
  /** Every cable at the saved load; empty when the method has no steady state there (thermal runaway). */
  operating: CableState[];
  /** The same cables at the current the method allows. */
  rated: CableState[];
  /** The cables the numbers under the answer are about: those at the saved load, or at the allowed current when there are none. */
  states: CableState[];
  moment: 'load' | 'rated';
  /** The cable the numbers under the answer are about: the selected one, else the one the method says reaches its limit first. */
  focus: CableState;
  /** The cable the method says reaches its limit first, and its state. */
  limiting: string;
  limitingState: CableState;
  /** The hottest cable at the saved load, as the method names it. */
  hottest: CableState | null;
  withinLimit: boolean | null;
  /** Why there is no steady state at the saved load. */
  operatingError?: Issue;
  ambient: number;
  ampacity: number;
  /** How the allowed current is meant: for one circuit, for each circuit with the others held, or for all circuits together. */
  basis: string;
  /** The saved load of every circuit. */
  loads: number[];
  /**
   * What is left of the allowed current at the saved load, when the allowed current is a circuit's own: the limiting circuit's
   * for one circuit, the smallest of the circuits' for several. None when the allowed current is that of all circuits together.
   */
  margin: number | null;
  /** What the margin is called: 余量, or 最小余量 when it is the smallest of several circuits'. */
  marginName: string;
  /** False when every cable is equally hot at the saved load, so "the hottest" would name one at random. */
  distinct: boolean;
  /** Shares of the focus cable's surface rise; known at the saved load only. */
  contributions: HeatContribution[] | null;
}

/** The conductor temperature limit of the cable a record was computed for, °C. */
export const limitOf = (inputs: Parts): number | null => {
  const limit = inputs.cable.payload.cable_type.rating.max_conductor_temperature.normal;
  return typeof limit === 'number' ? limit - 273.15 : null;
};

/** The method a record was computed with, as the screen names it: the method's name and its version (never the plugin's identifier). */
export const methodOf = (record: RunRecord): string => `${record.method_card?.method ?? '载流量'} ${record.method_version}`;

export function ratingOf(record: RunRecord | undefined, selected: string | null): Rating | null {
  const summary = record?.kind === 'rating' ? record.summary : undefined;
  if (!summary || summary.status !== 'succeeded' || !summary.ampacity || summary.ambient_c === undefined) return null;
  const operating = summary.operating?.cables ?? [];
  const rated = summary.rated?.cables ?? [];
  const states = operating.length ? operating : rated;
  const limiting = summary.ampacity.limiting_cable;
  const limitingState = states.find(state => state.id === limiting) ?? states[0];
  if (!limitingState) return null;
  const focus = states.find(state => state.id === selected) ?? limitingState;
  const circuits = summary.circuits ?? [];
  const circuit = circuits.find(item => item.id === summary.ampacity?.limiting_circuit);
  const temperatures = operating.map(state => state.conductor_c);
  const margins = circuits.flatMap(item => (typeof item.margin_a === 'number' ? [item.margin_a] : []));
  const several = circuits.length > 1 && margins.length > 0;
  const basis = summary.ampacity.basis;
  return {
    summary, operating, rated, states, focus, limiting, limitingState, basis,
    moment: operating.length ? 'load' : 'rated',
    hottest: operating.find(state => state.id === summary.operating?.hottest_cable) ?? null,
    withinLimit: summary.operating?.within_limit ?? null,
    operatingError: summary.operating?.error,
    ambient: summary.ambient_c,
    ampacity: summary.ampacity.value_a,
    loads: circuits.flatMap(item => (typeof item.load_a === 'number' ? [item.load_a] : [])),
    margin: basis === 'common' ? null : several ? Math.min(...margins) : circuit?.margin_a ?? null,
    marginName: several ? '最小余量' : '余量',
    distinct: temperatures.length > 0 && Math.max(...temperatures) - Math.min(...temperatures) > 0.05,
    contributions: operating.length ? summary.heat_contributions?.filter(item => item.target === focus.id) ?? null : null,
  };
}
