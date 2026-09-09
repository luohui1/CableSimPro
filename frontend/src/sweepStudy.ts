import type {Scenario, Sweep} from './types';

export const SWEEP_PARAMETERS = {
 soil_rho_k_m_w: {label: '土壤热阻率', unit: 'K·m/W', slopeUnit: 'A / (K·m/W)'},
 ambient_temperature_c: {label: '环境温度', unit: '°C', slopeUnit: 'A / °C'},
 depth_m: {label: '平均中心埋深', unit: 'm', slopeUnit: 'A / m'},
 spacing_m: {label: '相邻中心间距', unit: 'm', slopeUnit: 'A / m'},
} as const;
export type SweepParameter = keyof typeof SWEEP_PARAMETERS;
export function sweepParameter(value: string): SweepParameter | null {
 return Object.hasOwn(SWEEP_PARAMETERS, value) ? value as SweepParameter : null;
}
export interface StudyRow {
 index: number; value: number; ampacityA: number | null; error: string | null;
 deltaA: number | null; deltaPercent: number | null; headroomA: number | null;
 secant: number | null; previousValue: number | null;
}
export interface SweepStudy {
 parameter: SweepParameter; label: string; unit: string; slopeUnit: string;
 inputValue: number; demandA: number; reference: StudyRow | null;
 referenceIsInput: boolean; rows: StudyRow[]; chartPoints: [number, number | null][];
 succeeded: number; failed: number; belowDemand: number; duplicates: boolean;
 minimumA: number | null; maximumA: number | null;
}
const finite = (value: number): number | null => Number.isFinite(value) ? value : null;

/** Read-only arithmetic on an already eligible run. No solver, interpolation or new input.
 * An absent reference is NOT replaced by the first point or an invented baseline solve.
 * Secants are between adjacent distinct samples, not derivatives or global sensitivities.
 */
export function buildSweepStudy(sweep: Sweep, scenario: Scenario, referenceIndex?: number | null): SweepStudy | null {
 const parameter = sweepParameter(sweep.parameter);
 if (!parameter || !Array.isArray(sweep.points) || sweep.points.length < 2 || sweep.points.length > 12) return null;
 const inputValue = scenario.installation[parameter], demandA = scenario.operating_current_a;
 if (!Number.isFinite(inputValue) || !Number.isFinite(demandA) || demandA < 0 ||
     sweep.points.some(p => !p || !Number.isFinite(p.value))) return null;
 const rows: StudyRow[] = sweep.points.map((point, index) => {
  const suppliedError = typeof point.error === 'string' && point.error.trim() ? point.error : null;
  const ampacityA = !suppliedError && typeof point.ampacity_a === 'number' &&
   Number.isFinite(point.ampacity_a) && point.ampacity_a > 0 ? point.ampacity_a : null;
  return {index, value: point.value, ampacityA,
   error: suppliedError ?? (ampacityA === null ? '该点没有有效载流量，未补值。' : null),
   deltaA: null, deltaPercent: null, headroomA: ampacityA === null ? null : finite(ampacityA - demandA),
   secant: null, previousValue: null};
 });
 const sameInput = rows.filter(r => r.value === inputValue);
 const reference = referenceIndex === undefined ?
  (sameInput.length === 1 && sameInput[0].ampacityA !== null ? sameInput[0] : null) :
  (referenceIndex !== null && Number.isSafeInteger(referenceIndex) ?
   rows.find(r => r.index === referenceIndex && r.ampacityA !== null) ?? null : null);
 if (reference?.ampacityA != null) for (const row of rows) if (row.ampacityA !== null) {
  row.deltaA = finite(row.ampacityA - reference.ampacityA);
  row.deltaPercent = row.deltaA === null ? null : finite(row.deltaA / reference.ampacityA * 100);
 }
 const sorted = [...rows].sort((a, b) => a.value - b.value || a.index - b.index);
 const count = new Map<number, number>();
 rows.forEach(r => count.set(r.value, (count.get(r.value) ?? 0) + 1));
 sorted.forEach((row, i) => {
  const previous = sorted[i - 1];
  if (!previous || row.ampacityA === null || previous.ampacityA === null ||
      count.get(row.value) !== 1 || count.get(previous.value) !== 1) return;
  const dx = row.value - previous.value;
  // Do not divide by a Celsius baseline (which can be zero or negative).
  if (dx > 0 && Number.isFinite(dx)) {
   row.secant = finite((row.ampacityA - previous.ampacityA) / dx);
   if (row.secant !== null) row.previousValue = previous.value;
  }
 });
 const successful = rows.filter(r => r.ampacityA !== null);
 return {parameter, ...SWEEP_PARAMETERS[parameter], inputValue, demandA, reference,
  referenceIsInput: !!reference && reference.value === inputValue,
  rows, chartPoints: sorted.map(r => [r.value, r.ampacityA]),
  succeeded: successful.length, failed: rows.length - successful.length,
  belowDemand: successful.filter(r => r.headroomA !== null && r.headroomA < 0).length,
  duplicates: [...count.values()].some(n => n > 1),
  minimumA: successful.length ? Math.min(...successful.map(r => r.ampacityA!)) : null,
  maximumA: successful.length ? Math.max(...successful.map(r => r.ampacityA!)) : null};
}
export interface SweepEvidence {workspaceId: string; revision: number; runId: string; runInputHash: string}
/** Quote text and neutralize spreadsheet formulas without changing signed numeric values. */
export function csvCell(value: string | number | null): string {
 if (value === null) return '';
 if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
 const text = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? "'" + value : value;
 return '"' + text.replaceAll('"', '""') + '"';
}
export function sweepStudyCSV(study: SweepStudy, evidence: SweepEvidence): string {
 const header = ['workspace_id', 'revision', 'run_id', 'run_input_hash', 'parameter', 'unit',
  'original_input_value', 'reference_value', 'reference_ampacity_a', 'operating_current_a',
  'point_number', 'parameter_value', 'ampacity_a', 'delta_a', 'delta_percent',
  'ampacity_headroom_a', 'secant_a_per_unit', 'secant_unit', 'status', 'error'];
 const lines = study.rows.map(row => [evidence.workspaceId, evidence.revision, evidence.runId,
  evidence.runInputHash, study.parameter, study.unit, study.inputValue, study.reference?.value ?? null,
  study.reference?.ampacityA ?? null, study.demandA, row.index + 1, row.value, row.ampacityA,
  row.deltaA, row.deltaPercent, row.headroomA, row.secant, study.slopeUnit,
  row.ampacityA === null ? 'failed' : 'solved', row.error].map(csvCell).join(','));
 return '\uFEFF' + [header.join(','), ...lines].join('\r\n');
}
