// What the result views read from a rating record for the shown condition (saved load or rated).
import type { CableState, HeatContribution, RunRecord, Summary } from '@shared/types';
import type { Mode } from '@/state/view';

export interface Rating {
  summary: Summary;
  states: CableState[];
  /** The cable the explanations are about: the selected one, else the limiting one. */
  focus: CableState;
  limiting: string;
  ambient: number;
  limit: number;
  ampacity: number;
  /** Saved load of the limiting circuit. */
  load: number;
  /** Shares of the focus cable's surface rise; only known at the saved load. */
  contributions: HeatContribution[] | null;
}

export function ratingOf(record: RunRecord | undefined, mode: Mode, selected: string | null): Rating | null {
  const summary = record?.kind === 'rating' ? record.summary : undefined;
  if (!summary || summary.status !== 'succeeded' || !summary.ampacity || summary.ambient_c === undefined) return null;
  const states = (mode === 'load' ? summary.operating?.cables : summary.rated?.cables) ?? [];
  const limiting = summary.ampacity.limiting_cable;
  const focus = states.find(state => state.id === selected) ?? states.find(state => state.id === limiting) ?? states[0];
  if (!focus) return null;
  const circuit = summary.circuits?.find(item => item.id === summary.ampacity?.limiting_circuit);
  return {
    summary,
    states,
    focus,
    limiting,
    ambient: summary.ambient_c,
    limit: focus.limit_c,
    ampacity: summary.ampacity.value_a,
    load: circuit?.load_a ?? summary.operating?.cables.find(state => state.id === limiting)?.current_a ?? 0,
    contributions: mode === 'load' ? (summary.heat_contributions?.filter(item => item.target === focus.id) ?? null) : null,
  };
}
