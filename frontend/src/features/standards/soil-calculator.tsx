import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError, message } from '@/api/client';
import { basisQuery, type BasisRecord, type Pin } from './client';
import { valueLabel } from './format';

const fields: [string, string][] = [
  ['dry_bulk_density_kg_m3', '土壤干容重 / kg/m³'],
  ['particle_density_kg_m3', '颗粒密度 / kg/m³'],
  ['solid_specific_heat_capacity_j_kg_k', '固相质量比热 / J/(kg·K)'],
  ['water_volumetric_heat_capacity_j_m3_k', '水相体积热容 / J/(m³·K)'],
  ['air_volumetric_heat_capacity_j_m3_k', '气相体积热容 / J/(m³·K)'],
  ['water_volume_fraction', '体积含水率 / m³/m³'],
];
type Calculation = { output: { value: number; unit: string }; citation: string; input_sha256: string };

export function SoilCalculator({ pin, record }: { pin: Pin; record: BasisRecord }) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false), [previous, setPrevious] = useState<Calculation | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const visibleFields = fields.filter(([key]) => record.conditions.soil_capacity_method === 'three_phase' || key !== 'air_volumetric_heat_capacity_j_m3_k');
  const calculation = useMutation({ retry: false, mutationFn: async () => {
    const formula_inputs = Object.fromEntries(visibleFields.map(([key]) => [key, Number(inputs[key])]));
    controller.current?.abort(); controller.current = new AbortController();
    const answer = await basisQuery(pin, { schema_version: 'cablesim.standards-query/1', operation: 'evaluate',
      standard: record.standard, edition: record.edition, locator: record.table || record.clause,
      quantity: record.quantity.key, record_id: record.id, conditions: record.conditions,
      formula_inputs: { ...formula_inputs, phase_assumption: confirmed ? 'single_temperature_no_phase_change' : '' } }, controller.current.signal);
    const result = answer.calculation as Calculation | undefined;
    if (!result || !Number.isFinite(result.output?.value) || result.output.unit !== record.quantity.unit || answer.records[0]?.record_sha256 !== record.record_sha256) {
      throw new ApiError(502, '热容计算未返回匹配的依据，请重新读取。');
    }
    return result;
  } });
  const visibleError = calculation.error instanceof DOMException && calculation.error.name === 'AbortError' ? null : calculation.error;
  const errorKey = visibleError instanceof ApiError ? String((visibleError.detail as Record<string, unknown>)?.path || '').split('/').pop() : '';
  useEffect(() => {
    if (!errorKey) return;
    const frame = requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>(`[name="${errorKey}"]`)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [errorKey, visibleError]);
  function changed() { if (calculation.data) setPrevious(calculation.data); calculation.reset(); }
  const result = calculation.data || previous;
  return <details className="basis-soil-calculator"><summary>代入现场参数</summary>
    <form ref={form} className="basis-search" aria-label="现场土壤热容计算"
      data-state={calculation.isPending ? 'loading' : visibleError ? 'error' : calculation.data ? 'success' : previous ? 'historical' : 'empty'}
      onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'z') event.stopPropagation();
        if (event.key === 'Escape') { event.stopPropagation(); controller.current?.abort(); calculation.reset(); form.current!.closest('details')!.open = false; }
      }}
      onSubmit={event => { event.preventDefault(); if (!calculation.isPending) calculation.mutate(); }}>
      {visibleFields.map(([key, label]) => <label className="text-field" key={key}>{label}<input name={key} type="number" inputMode="decimal" step="any" min="0" required aria-invalid={errorKey === key || undefined}
        disabled={calculation.isPending} value={inputs[key] || ''} onChange={event => { changed(); setInputs({ ...inputs, [key]: event.target.value }); }} /></label>)}
      <label><input name="phase_assumption" type="checkbox" required checked={confirmed} disabled={calculation.isPending}
        onChange={event => { changed(); setConfirmed(event.target.checked); }} />确认各相同温，无冻结或相变</label>
      <Button type="submit" loading={calculation.isPending} disabled={calculation.isPending}>计算参考热容</Button>
      {visibleError && <p className="field-error" role="alert">{message(visibleError)}</p>}
      {result && <div className="basis-result" role="status"><strong>{calculation.data ? '参考热容' : '历史结果（参数已更改）'}：{valueLabel(result.output.value)} {result.output.unit}</strong>
        <p>{result.citation}</p><details><summary>输入摘要</summary><p>{result.input_sha256}</p></details></div>}
    </form>
  </details>;
}
