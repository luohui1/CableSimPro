import { optionalRecord, text } from '@/api/client';
import { entityLabel, savedDomain } from '@/lib/domain-fields';
import { Conclusion } from './conclusion';
import { isVersionStale } from '@/lib/version-status';

/** Headline selection, display units and titles are the saved plugin contract.
 * Do not infer a different capacity basis or recompute a conclusion here. */
export function SavedRunConclusion({ run }: { run: Record<string, unknown> }) {
  const headlines = (Array.isArray(run.headlines) ? run.headlines : []).map(optionalRecord).filter(row => typeof row.display_value === 'number');
  if (!headlines.length || run.integrity !== 'verified') return null;
  const domain = savedDomain(run), definition = optionalRecord(optionalRecord(run.snapshot).definition);
  const cases = (Array.isArray(optionalRecord(run.output).cases) ? optionalRecord(run.output).cases as unknown[] : []).map(optionalRecord);
  const bases = [...new Set(headlines.map(row => {
    const c = cases.find(c => c.case_id === row.case_id);
    const quantity = (Array.isArray(c?.results) ? c.results : []).map(optionalRecord).find(q => q.key === row.key && q.entity === row.entity && q.case === row.condition);
    return text(optionalRecord(quantity?.rating_basis).display_name);
  }).filter(Boolean))];
  return <Conclusion title="保存运行结论" model={text(definition.title) || entityLabel(domain, text(headlines[0].entity))}
    description={bases.join(' · ')} historical={run.freshness === 'historical' || isVersionStale(run)}
    metrics={headlines.map((row, i) => ({ label: [text(row.title), entityLabel(domain, text(row.entity))].filter(Boolean).join(' · ') || String(i),
      value: row.display_value as number, unit: text(row.display_unit), precision: 2 }))} />;
}
