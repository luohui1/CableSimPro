import { useState } from 'react';
import { CommandAction } from './command-slot';
import { useQuery } from '@tanstack/react-query';
import { ApiError, array, message, numeric, optionalRecord, record, text } from '@/api/client';
import { inputContracts, exactContract } from '@/api/input-contracts';
import { DataTable } from '@/components/data-table';
import { SourceBadge } from '@/components/source-badge';
import { StatusMark, type StatusKind } from '@/components/status-mark';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '@/components/states';
import { Button } from '@/components/ui/button';
import { engineeringQuantity, formatNumber } from '@/lib/format';
import { displayName } from '@/lib/display-names';
import { chooseEvidence, currentEvidence, methodLabel, useTypeEvidence } from './evidence';
import { useTypeWorkspace } from './provider';
import { useTypeInspector } from './inspector';
import { typePath, useTypeNavigation } from './navigation';
import { TypeRunControl, methodForArtifact } from './run-control';
import { deferredView } from '@/components/deferred-view';
const ShortCircuitCurve = deferredView(() => import('./short-circuit-curve').then(m => ({ default: m.ShortCircuitCurve })));
import { EvidenceDigest } from './evidence-digest';
import { MethodParameterFields } from '@/components/method-parameter-fields';
import { typeStudies } from './rating-api';
import { parameterValue, type MethodDraft, type MethodDefinition } from './method-draft';

export type AnalysisRow = Record<string, unknown> & { id: string; title: string };
const statuses: Record<string, { kind: StatusKind; label: string }> = { available: { kind: 'success', label: '已计算' }, missing: { kind: 'unknown', label: '待补数据' }, uncovered: { kind: 'unknown', label: '未覆盖' }, not_applicable: { kind: 'inapplicable', label: '范围拒绝' } };
const basis: Record<string, string> = { derived: '推导值', design: '设计值', measurement: '实测值', manufacturer_limit: '厂家声明上限', unknown: '未明确' };
const units: Record<string, [number, string]> = { A: [.001, 'kA'], 'A/m': [1000, 'A/km'], 'W/m': [1000, 'W/km'] };
export function analysisValue(row: Record<string, unknown>, full = false) {
  const value = numeric(row.value); if (value === null) return '—';
  const custom = units[text(row.unit)], display = engineeringQuantity(text(row.id), value, text(row.unit));
  if (custom) return (full ? String(value * custom[0]) : formatNumber(value * custom[0], 3)) + ' ' + custom[1];
  return full ? display.complete : display.text + (display.unit === '—' ? '' : ' ' + display.unit);
}
function savedValue(value: unknown) { return value === undefined || value === null ? '未提供' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
function formulaValue(value: string) {
  return value.split(/([A-Za-zθ]+_[A-Za-z0-9]+)/g).map((part, index) => {
    const subscript = /^([A-Za-zθ]+)_([A-Za-z0-9]+)$/.exec(part);
    return subscript ? <span key={index}>{subscript[1]}<sub>{subscript[2]}</sub></span> : part;
  });
}
export function TypeAnalysis({ module, tab }: { module: 'electrical' | 'short-circuit'; tab: string }) {
  const state = useTypeWorkspace(), evidence = useTypeEvidence(), navigation = useTypeNavigation(), inspector = useTypeInspector();
  const [selected, setSelected] = useState(''), [running, setRunning] = useState(false);
  const name = module === 'electrical' ? '电气参数' : '短路容量';
  const contracts = useQuery({ queryKey: ['input-contracts'], queryFn: ({ signal }) => inputContracts(signal) });
  const installed = useQuery({ queryKey: ['type-method', module], queryFn: ({ signal }) => methodForArtifact('x-cablesim.type-' + module, signal) });
  const studies = useQuery({ queryKey: ['type-studies', state.workspace?.id], queryFn: ({ signal }) => typeStudies(state.workspace!.id, signal), enabled: !!state.workspace });
  let saved: ReturnType<typeof chooseEvidence> = null, rows: AnalysisRow[] = [], error = '';
  try {
    const entries = evidence.data?.filter(item => optionalRecord(optionalRecord(item.study.definition).method).capability === module);
    saved = chooseEvidence(entries, 'cablesim.type-analysis/1', navigation.location.run, navigation.location.revision);
    if (saved) {
      if (saved.artifact.capability !== module) throw new ApiError(502, '工件计算能力与当前模块不一致');
      rows = array(saved.artifact.rows, '计算结果').map(value => { const row = record(value, '计算结果'); if (!text(row.id) || !text(row.title) || !statuses[text(row.status)] || row.status === 'available' && numeric(row.value) === null) throw new ApiError(502, '计算结果缺少身份、状态或有限数值'); return { ...row, id: text(row.id), title: text(row.title) }; });
      const ids = new Set(rows.map(row => row.id)); if (ids.size !== rows.length) throw new ApiError(502, '计算结果身份重复');
      const counts = record(saved.artifact.counts, '结果统计');
      if (Object.entries(counts).some(([key, count]) => !statuses[key] || numeric(count) !== rows.filter(row => row.status === key).length)) throw new ApiError(502, '结果统计与保存行不一致');
    }
  } catch (failure) { error = message(failure); }
  const savedDefinition = optionalRecord(optionalRecord(saved?.run.snapshot).definition);
  const study = studies.data?.filter(study => study.definition.method.capability === module).sort((a, b) => b.created.localeCompare(a.created))[0];
  const current = !!saved && currentEvidence(saved.run, state.workspace?.revision, state.dirty) && (state.readOnly || !!study && study.id === saved.study.id && study.revision === optionalRecord(saved.run.snapshot).study_revision);
  const configuration = state.readOnly ? savedDefinition : study?.definition || savedDefinition;
  const parameters = state.methodDrafts[module]?.definition.parameters || optionalRecord(configuration.parameters);
  const values = Object.keys(parameters).length ? parameters : { cable_type_id: state.document!.cable_types[0]?.id };
  let contractError = '';
  if (!contracts.isPending && !installed.isPending) { try { if (contracts.error || installed.error) throw contracts.error || installed.error; exactContract(contracts.data!, installed.data!); } catch (failure) { contractError = message(failure); } }
  async function definition() {
    if (!study) throw new ApiError(409, '请先保存方法条件');
    const method = await methodForArtifact('x-cablesim.type-' + module);
    return { ...study.definition, method };
  }
  function draft(): MethodDraft { if (!installed.data) throw new ApiError(409, '方法仍在读取'); return state.methodDrafts[module] || { module, revision: state.workspace!.revision, study, fields: {}, definition: { ...configuration, title: text(configuration.title) || state.document!.name + ' · ' + name, input_source: 'domain', method: installed.data, parameters: structuredClone(values) } as MethodDefinition }; }
  function change(path: string, value: unknown) {
    state.setMethodDraft(module, current => { const next = current || draft(); return { ...next, definition: { ...next.definition, parameters: parameterValue(next.definition.parameters || {}, path, value), input_sources: { ...next.definition.input_sources, ['/parameters' + path]: { kind: 'user', reference: '工程师按匹配的参数契约填写', reviewed: false } } } }; });
  }
  function select(row: AnalysisRow) {
    setSelected(row.id); const target = optionalRecord(row.target), layer = text(target.role) ? (target.scope === 'core' ? text(target.core_id) : 'common') + '/' + text(target.role) : '';
    inspector.show(row.title, [
      { label: '计算结果', items: [{ label: '完整显示精度', value: analysisValue(row, true), source: 'calculation', sourceDetail: methodLabel(saved!.run) }, { label: '原始 SI 数值', value: savedValue(row.value), unit: text(row.unit) }, { label: '性质', value: basis[text(row.basis)] || '未声明' }, { label: '状态', value: statuses[text(row.status)].label }, { label: '原因', value: text(row.reason) || '—' }] },
      { label: '条款与依据', items: [{ label: '标准', value: text(row.standard) || '未提供' }, { label: '条款', value: text(row.clause) || '未提供' }, { label: '正文页码', value: numeric(row.printed_page) ?? '未核验' }, { label: 'PDF 页码', value: numeric(row.pdf_page) ?? '未核验' }, ...(text(row.formula) ? [{ label: '公式', value: formulaValue(text(row.formula)) }] : row.id.endsWith(':r20') ? [{ label: '数据依据', value: text(row.data_origin) || basis[text(row.basis)] || '待明确输入性质' }] : []), ...(text(optionalRecord(row.reference_table).table) ? [{ label: '标准限值参照', value: text(optionalRecord(row.reference_table).standard) + ' · ' + text(optionalRecord(row.reference_table).table) + ' · 正文 4–5 / PDF 7–8' }] : []), ...Object.entries(optionalRecord(row.formula_inputs)).map(([label, value]) => ({ label: displayName(label), value: savedValue(value), source: 'calculation' as const }))] },
      { label: '来源与运行', items: [{ label: '输入来源', value: text(optionalRecord(row.input_source).reference) || '见保存的方法条件' }, { label: '原文摘要', value: <EvidenceDigest value={row.source_digest} /> }, { label: '输入摘要', value: <EvidenceDigest value={saved!.artifact.input_sha256} /> }, { label: '方法', value: methodLabel(saved!.run) }, { label: '运行', value: <EvidenceDigest value={saved!.run.id} /> }, ...(layer ? [{ label: '结构对象', value: <Button variant="ghost" size="compact" onClick={() => navigation.navigate(typePath(state.workspace!.id, 'structure', 'table', navigation.location.theme) + '&layer=' + encodeURIComponent(layer))}>定位结构对象</Button> }] : [])] },
    ]);
  }
  const bodyState = running || evidence.isPending ? 'loading' : error || evidence.error ? 'error' : !saved ? 'empty' : current ? 'success' : 'historical';
  return <div className="type-page" data-type-page={module + '-results'} data-type-state={bodyState}>
    {tab !== 'parameters' && <CommandAction><TypeRunControl channel={module} label={'计算' + name} definition={definition} onBusy={setRunning} unavailable={!study ? '请先在右侧方法页填写并保存条件' : undefined} /></CommandAction>}
    {bodyState === 'loading' ? <LoadingState title={'正在读取或计算' + name} /> : bodyState === 'error' ? <ErrorState title={name + '不可用'} description={error || message(evidence.error)} action={<Button onClick={() => void evidence.refetch()}>重新读取</Button>} /> : tab === 'parameters' ? <>
      {state.readOnly ? <><p className="type-meta">固定运行的方法条件 · {saved ? methodLabel(saved.run) : '未保存运行'}</p><DataTable label="固定方法条件（SI）" showGroups={false} rowLabel={row => row.id} groups={[{ id: 'parameters', label: '条件', rows: Object.entries(parameters).map(([id, value]) => ({ id, value })) }]} columns={[{ id: 'name', label: '参数 / SI', render: row => row.id }, { id: 'value', label: '保存值', wrap: true, render: row => savedValue(row.value) }]} /></> : !!contractError ? <ErrorState title="方法参数契约不可用" description={contractError} /> : installed.data ? <MethodParameterFields method={installed.data} namespace={module} values={values} readOnly={state.busy} sources={state.methodDrafts[module]?.definition.input_sources || study?.definition.input_sources} draftFields={state.methodDrafts[module]?.fields} onChange={change} onDraftChange={(field, key) => state.setMethodDraft(module, current => { const next = current || draft(), fields = { ...next.fields }; if (field) fields[key] = field; else delete fields[key]; const baseline = next.study?.definition.parameters || { cable_type_id: state.document!.cable_types[0]?.id }; return !Object.keys(fields).length && JSON.stringify(next.definition.parameters) === JSON.stringify(baseline) && JSON.stringify(next.definition.input_sources) === JSON.stringify(next.study?.definition.input_sources) ? null : { ...next, fields }; })} /> : <LoadingState title="正在读取方法契约" />}
    </> : !saved ? <EmptyState title={'尚无' + name + '结果'} description={study ? '按保存的方法条件运行后，结果与依据显示在这里。' : '先在右侧方法页填写并保存条件，再运行计算。'} action={!study && !state.readOnly ? <Button onClick={() => navigation.navigate(typePath(state.workspace!.id, module, 'parameters', navigation.location.theme))}>在方法页填写参数</Button> : undefined} /> : <>
      {!current && <StaleBanner description="输入或方法已变化，以下为原运行保存的结果。" />}
      <div className="type-result-summary" title={methodLabel(saved.run) + '；统计来自保存的结果行'}><strong>{rows.filter(row => row.status === 'available').length} 项已计算</strong><span>{rows.filter(row => row.status === 'missing').length} 项待补数据</span><span>{rows.filter(row => row.status === 'uncovered' || row.status === 'not_applicable').length} 项未覆盖或拒绝</span></div>
      <DataTable label={name} selectedId={selected} onSelect={select} rowLabel={row => row.title} showGroups={false} groups={[{ id: 'results', label: '结果', rows }]} columns={[{ id: 'title', label: '参数 / 组件', render: row => row.title }, { id: 'value', label: '数值', numeric: true, render: row => <span title={analysisValue(row, true)}>{analysisValue(row)}</span> }, { id: 'basis', label: '性质', render: row => basis[text(row.basis)] || '未声明' }, { id: 'status', label: '状态', render: row => <StatusMark {...statuses[text(row.status)]} /> }, { id: 'source', label: '依据', render: row => <SourceBadge kind="standard" detail={[text(row.standard), text(row.clause), numeric(row.printed_page) === null ? '页码未核验' : '正文 ' + numeric(row.printed_page)].join(' · ')} /> }]} />
      {module === 'short-circuit' && <ShortCircuitCurve artifact={saved.artifact} rows={rows} onSelect={select} />}
    </>}
  </div>;
}
