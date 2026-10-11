import { useQuery } from '@tanstack/react-query';
import { compareRuns } from '@/api/comparison';
import { message, optionalRecord, text } from '@/api/client';
import { significantNumber } from '@/lib/format';
import { displayName, displayNames } from '@/lib/display-names';
import { entityLabel } from '@/lib/domain-fields';
import { DataTable, type Column } from './data-table';
import { Button } from './ui/button';
import { EmptyState, ErrorState, LoadingState } from './states';
import { domainFieldUnits, snapshotFieldLabels } from './study-workbench-config';
import { statusLabel } from '@/lib/status-vocabulary';
import { savedRunLabel } from './study-run-label';
import './run-records-comparison.css';

type Cell = { value: unknown; unit: string; name?: string; display?: string };
type Difference = { id: string; name: string; a?: Cell; b?: Cell };
const records = (v: unknown) => (Array.isArray(v) ? v : []).map(optionalRecord);
const show = (cell?: Cell) => !cell ? '—' : `${typeof cell.value === 'number' ? significantNumber(cell.value, 6) : cell.display ?? String(cell.value ?? '—')}${cell.unit ? ` ${cell.unit}` : ''}`;
const escape = (s: string) => s.replaceAll('~', '~0').replaceAll('/', '~1');
// These are receipts and redundant specification projections, not solver inputs.
const receipts = new Set(['provenance', 'sources', 'input_sources', 'schema_version', 'release_digest', 'digest', 'reference', 'candidate_specification', 'created', 'updated', 'id', 'case_id']);
const fieldLabel = (key: string) => snapshotFieldLabels[key] || displayNames[key] || key.replaceAll('_', ' ').replaceAll('/', ' · ');
function collectLabels(value: unknown, labels = new Map<string, string>()) {
  if (Array.isArray(value)) value.forEach(item => collectLabels(item, labels));
  else if (value && typeof value === 'object') {
    const row = optionalRecord(value);
    if (text(row.id)) labels.set(text(row.id), text(row.label) || displayName(text(row.id)));
    Object.entries(row).filter(([key]) => !receipts.has(key)).forEach(([, item]) => collectLabels(item, labels));
  }
  return labels;
}

/** Compare frozen inputs, including absent fields. Identity-bearing arrays use
 * their saved IDs, so reordering alone does not create a parameter change. */
function flatten(value: unknown, path = '', units: Record<string, string> = {}, out = new Map<string, Cell>(), names: Record<string, string> = {}, scope = '', labels = new Map<string, string>()) {
  if (Array.isArray(value)) value.forEach((item, index) => {
    const row = optionalRecord(item), id = text(row.id) || text(row.case_id) || text(row.role) || String(index);
    const label = text(row.label) || (text(row.case_id) ? displayName(text(row.case_id)) : '') || (text(row.role) ? fieldLabel(text(row.role)) : '') || String(index + 1);
    flatten(item, `${path}/${escape(id)}`, units, out, names, [scope, label].filter(Boolean).join(' · '), labels);
  });
  else if (value && typeof value === 'object') {
    const row = optionalRecord(value);
    if (row.schema_version === 'cablesim.domain/1') labels = collectLabels(row, new Map(labels));
    if ('value' in row && typeof row.unit === 'string') out.set(path, { value: row.value, unit: row.unit, name: scope });
    else Object.entries(row).filter(([key]) => !receipts.has(key)).forEach(([key, v]) => flatten(v, `${path}/${escape(key)}`, units, out, names, [scope, names[`${path}/${escape(key)}`] || fieldLabel(key)].filter(Boolean).join(' · '), labels));
  } else out.set(path, { value, display: typeof value === 'string' ? labels.get(value) || displayNames[value] || value : undefined,
    name: scope, unit: units[path] || (path.includes('/input/') ? domainFieldUnits[path.split('/').at(-1) || ''] || (path.includes('/currents/') ? 'A' : '') : '') });
  return out;
}
function frozenInputs(snapshot: Record<string, unknown>) {
  // Workspace revisions, seals, digests and generated timestamps are provenance,
  // not calculation inputs. All values below are from the two saved snapshots.
  const definition = optionalRecord(snapshot.definition);
  const units = { ...optionalRecord(snapshot.input_units) } as Record<string, string>;
  units['/driver/minimum'] = text(optionalRecord(definition.driver).target_unit);
  units['/driver/candidate_filters/minimum_area_m2'] = units['/driver/candidate_filters/maximum_area_m2'] = 'm²';
  units['/driver/candidate_filters/voltage_v'] = 'V';
  const names: Record<string, string> = {};
  const labels = collectLabels(snapshot.cases);
  const schema = optionalRecord(optionalRecord(snapshot.input_contract).parameter_schema);
  function schemaUnits(value: unknown, raw: unknown, path: string) {
    const node = optionalRecord(raw);
    const definition = text(node.$ref).startsWith('#/$defs/') ? optionalRecord(optionalRecord(schema.$defs)[text(node.$ref).slice(8)]) : {};
    const resolved = { ...definition, ...node };
    const rawUnit = resolved['x-unit'];
    const unit = typeof rawUnit === 'string' ? rawUnit : text(optionalRecord(rawUnit).si);
    if (unit) units[path] = unit;
    if (text(resolved.title)) names[path] = displayName(path.split('/').at(-1) || '', text(resolved.title));
    if (Array.isArray(value)) value.forEach((item, index) => schemaUnits(item, resolved.items, `${path}/${escape(text(optionalRecord(item).id) || String(index))}`));
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(optionalRecord(value))) {
      schemaUnits(item, optionalRecord(resolved.properties)[key] ?? resolved.additionalProperties, `${path}/${escape(key)}`);
    }
  }
  schemaUnits(definition.parameters, schema, '/parameters');
  for (const c of records(snapshot.cases)) schemaUnits(c.parameters, schema, `/cases/${escape(text(c.case_id))}/parameters`);
  return flatten({ method: definition.method, task: definition.task, parameters: definition.parameters,
    driver: definition.driver, cases: snapshot.cases }, '', { ...units }, new Map(), names, '', labels);
}
export function RunRecordsComparison({ workspace, ids }: { workspace: string; ids: string[] }) {
  const query = useQuery({ queryKey: ['run-record-comparison', workspace, ...ids], queryFn: () => compareRuns(workspace, ids), retry: false });
  if (query.isPending) return <LoadingState title="正在对比保存运行" />;
  if (query.error) return <ErrorState title="运行对比失败" description={message(query.error)} action={<Button onClick={() => void query.refetch()}>重新读取</Button>} />;
  const sources = records(query.data?.sources);
  if (sources.length !== 2) return <EmptyState title="缺少两次保存运行" />;
  const [a, b] = sources;
  const quantities = (source: Record<string, unknown>) => new Map(records(source.headlines).map(row => [
    [row.key, row.entity, row.condition, row.case_id].map(String).join('|'), row,
  ]));
  const qa = quantities(a), qb = quantities(b);
  const headlines: Difference[] = [...new Set([...qa.keys(), ...qb.keys()])].map(id => {
    const x = qa.get(id), y = qb.get(id), row = x || y!;
    return { id, name: [text(row.title), text(row.entity), text(row.condition)].filter(Boolean).join(' · '),
      a: x ? { value: x.display_value ?? x.value, unit: text(x.display_unit ?? x.unit) } : undefined,
      b: y ? { value: y.display_value ?? y.value, unit: text(y.display_unit ?? y.unit) } : undefined };
  });
  const fa = frozenInputs(optionalRecord(a.snapshot)), fb = frozenInputs(optionalRecord(b.snapshot));
  const inputs: Difference[] = [...new Set([...fa.keys(), ...fb.keys()])].filter(path => JSON.stringify([fa.get(path)?.value, fa.get(path)?.unit]) !== JSON.stringify([fb.get(path)?.value, fb.get(path)?.unit]))
    .map(id => ({ id, name: fa.get(id)?.name || fb.get(id)?.name || fieldLabel(id.split('/').at(-1) || ''), a: fa.get(id), b: fb.get(id) }));
  const limits = (source: Record<string, unknown>) => records(source.limiting_objects).map((row, i) => ({
    id: `${text(row.case_id)}/${text(row.entity)}/${i}`, name: [displayName(text(row.case_id)), entityLabel(optionalRecord(records(optionalRecord(source.snapshot).cases).find(c => c.case_id === row.case_id)).input, text(row.entity))].filter(Boolean).join(' · '),
    value: [displayName(text(row.limiting_cable)), text(row.reason || row.limiting_reason)].filter(v => v && v !== '—').join(' · ') || '—',
  }));
  const la = new Map(limits(a).map(row => [row.id, row])), lb = new Map(limits(b).map(row => [row.id, row]));
  const limiting: Difference[] = [...new Set([...la.keys(), ...lb.keys()])].map(id => ({ id, name: la.get(id)?.name || lb.get(id)!.name,
    a: la.has(id) ? { value: la.get(id)!.value, unit: '' } : undefined, b: lb.has(id) ? { value: lb.get(id)!.value, unit: '' } : undefined }));
  const columns: Column<Difference>[] = [
    { id: 'name', label: '字段 / 对象', wrap: true, render: row => <span title={row.id}>{row.name}</span> },
    { id: 'a', label: '运行 A', numeric: true, wrap: true, render: row => show(row.a) },
    { id: 'b', label: '运行 B', numeric: true, wrap: true, render: row => show(row.b) },
    { id: 'difference', label: '差值 B − A', numeric: true, wrap: true, render: row => row.a?.unit === row.b?.unit && typeof row.a?.value === 'number' && typeof row.b?.value === 'number'
      ? show({ value: row.b.value - row.a.value, unit: row.a.unit }) : '—' },
  ];
  return <section className="run-comparison" aria-label="两次运行对比">
    <h3>保存运行对比</h3>
    <dl className="reference-list">{sources.map((source, index) => <div key={text(source.run_id)}><dt>运行 {index ? 'B' : 'A'}</dt><dd>{savedRunLabel(source, '运行')} · {statusLabel(text(source.status), '状态未记录')}</dd></div>)}</dl>
    {[['结论量值', headlines], ['限制对象', limiting], ...(inputs.length ? [['输入差异（SI）', inputs]] : [])].map(([label, rows]) => <DataTable key={String(label)} label={String(label)} columns={columns}
      groups={label === '输入差异（SI）' ? [...new Set(inputs.map(row => row.id.startsWith('/cases/') ? row.id.split('/').slice(0, 3).join('/') : '研究配置'))].map(id => ({ id, label: id === '研究配置' ? id : displayName(id.split('/').at(-1) || ''), defaultCollapsed: id !== '研究配置', rows: inputs.filter(row => (row.id.startsWith('/cases/') ? row.id.split('/').slice(0, 3).join('/') : '研究配置') === id) })) : [{ id: String(label), label: String(label), rows: rows as Difference[] }]} rowLabel={row => row.name} />)}
    {!inputs.length && <p role="status">输入相同</p>}
  </section>;
}
