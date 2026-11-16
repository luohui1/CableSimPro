// What the conclusion reads from a rating record: the answer, the cable it is about and the numbers under it. Every number
// is the method's own, as saved in the record; nothing here computes one.
import type { CableState, HeatContribution, RunRecord, Summary } from '@shared/types';

export interface Rating {
  summary: Summary;
  /** Every cable at the saved load. */
  states: CableState[];
  /** The same cables at the current the method allows, when it states them. */
  rated: CableState[];
  /** The cable the numbers under the answer are about: the selected one, else the limiting one. */
  focus: CableState;
  limiting: string;
  /** The limiting cable at the saved load. */
  limitingState: CableState;
  ambient: number;
  ampacity: number;
  /** Saved load of the limiting circuit and what is left of the allowed current, as the method states them. */
  load: number;
  margin: number | null;
  /** False when every cable is equally hot, so no single cable is the one that reaches the limit first. */
  distinct: boolean;
  /** Shares of the focus cable's surface rise; known at the saved load only. */
  contributions: HeatContribution[] | null;
}

export function ratingOf(record: RunRecord | undefined, selected: string | null): Rating | null {
  const summary = record?.kind === 'rating' ? record.summary : undefined;
  if (!summary || summary.status !== 'succeeded' || !summary.ampacity || summary.ambient_c === undefined) return null;
  const states = summary.operating?.cables ?? [];
  const limiting = summary.ampacity.limiting_cable;
  const limitingState = states.find(state => state.id === limiting) ?? states[0];
  const focus = states.find(state => state.id === selected) ?? limitingState;
  if (!focus) return null;
  const circuit = summary.circuits?.find(item => item.id === summary.ampacity?.limiting_circuit);
  const temperatures = states.map(state => state.conductor_c);
  return {
    summary, states, focus, limiting, limitingState,
    rated: summary.rated?.cables ?? [],
    ambient: summary.ambient_c,
    ampacity: summary.ampacity.value_a,
    load: circuit?.load_a ?? limitingState.current_a,
    margin: circuit?.margin_a ?? null,
    distinct: Math.max(...temperatures) - Math.min(...temperatures) > 0.05,
    contributions: summary.heat_contributions?.filter(item => item.target === focus.id) ?? null,
  };
}
