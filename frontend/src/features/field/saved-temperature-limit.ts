import { numeric, optionalRecord, text } from '@/api/client';

const records = (value: unknown) => Array.isArray(value) ? value.map(optionalRecord) : [];

/** Display-only comparison of verified conductor quantities with their saved normal limits. */
export function savedConductorLimit(run: Record<string, unknown>, caseId: string) {
  const snapshot = optionalRecord(run.snapshot), method = optionalRecord(optionalRecord(snapshot.definition).method);
  if (run.integrity !== 'verified' || method.plugin_id !== 'cablesim.simulation' || method.capability !== 'iec-thermal-field') return undefined;
  const original = records(snapshot.cases).find(row => row.case_id === caseId);
  const input = optionalRecord(original?.input), limits = new Map<string, number>();
  if (input.schema_version !== 'cablesim.domain/1') return undefined;
  for (const circuit of records(input.circuits)) {
    const type = records(input.cable_types).find(row => row.id === circuit.cable_type);
    const limit = numeric(optionalRecord(optionalRecord(type?.rating).max_conductor_temperature).normal);
    if (limit === null || limit <= 0) return undefined;
    for (const cable of records(circuit.cables)) {
      const id = text(cable.id);
      if (!id || limits.has(id)) return undefined;
      limits.set(id, limit);
    }
  }
  const result = records(optionalRecord(run.output).cases).find(row => row.case_id === caseId && row.status === 'succeeded');
  const rows = records(result?.results).filter(row => row.key === 'conductor_temperature' && row.case === 'operating');
  if (!limits.size || rows.length !== limits.size || new Set(rows.map(row => row.entity)).size !== limits.size || rows.some(row => row.status !== 'available' || row.unit !== 'K' || numeric(row.value) === null || !limits.has(text(row.entity)))) return undefined;
  const maximum = Math.max(...rows.map(row => Number(row.value))), excess = Math.max(...rows.map(row => Number(row.value) - limits.get(text(row.entity))!));
  const shared = new Set(limits.values());
  return { maximum_c: maximum - 273.15, within: excess <= 0, excess_k: Math.max(0, excess), shared_limit_c: shared.size === 1 ? [...shared][0] - 273.15 : null };
}
