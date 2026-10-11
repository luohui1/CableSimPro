import { useEffect, useRef, useState } from 'react';
import { CommandAction } from './command-slot';
import { useQuery } from '@tanstack/react-query';
import { ApiError, array, message, numeric, optionalRecord, record, text } from '@/api/client';
import { inputContracts, exactContract } from '@/api/input-contracts';
import { DataTable } from '@/components/data-table';
import { SourceBadge } from '@/components/source-badge';
import { StatusMark, type StatusKind } from '@/components/status-mark';
import { InlineEmpty, ErrorState, LoadingState, StaleBanner } from '@/components/states';
import { Button } from '@/components/ui/button';
import { engineeringQuantity, formatNumber } from '@/lib/format';
import { chooseEvidence, currentEvidence, methodLabel, useTypeEvidence } from './evidence';
import { useTypeWorkspace } from './provider';
import { useTypeInspector } from './inspector';
import { typePath, useTypeNavigation } from './navigation';
import { TypeRunControl, methodForArtifact } from './run-control';
import { deferredView } from '@/components/deferred-view';
const ShortCircuitCurve = deferredView(() => import('./short-circuit-curve').then(m => ({ default: m.ShortCircuitCurve })));
import { EvidenceDigest } from './evidence-digest';
import { TypeMethodFields } from './method-fields';
import { typeStudies } from './rating-api';
import { commitMethod, parameterValue, type MethodDraft, type MethodDefinition } from './method-draft';
import { identicalCoreRows, issuePresentation } from './result-presentation';
import { formulaInput, resultCitation, ResultTrace } from './result-detail';
import { SavedFormula } from './saved-formula';

export type AnalysisRow = Record<string, unknown> & { id: string; title: string };
const statuses: Record<string, { kind: StatusKind; label: string }> = { available: { kind: 'success', label: '已计算' }, missing: { kind: 'unknown', label: '待补数据' }, uncovered: { kind: 'unknown', label: '未覆盖' }, not_applicable: { kind: 'inapplicable', label: '范围拒绝' } };
const basis: Record<string, string> = { derived: '推导值', design: '设计值', measurement: '实测值', manufacturer_limit: '厂家声明上限', unknown: '未明确' };
const units: Record<string, [number, string]> = { A: [.001, 'kA'], 'A/m': [1000, 'A/km'], 'W/m': [1000, 'W/km'] };
export function analysisValue(row: Record<string, unknown>, full = false) {
  const value = numeric(row.value); if (value === null) return '—';
  const custom = units[text(row.unit)], display = engineeringQuantity(text(row.id), value, text(row.unit));
  if (custom) return (full ? String(value * custom[0]) : formatNumber(value * custom[0], row.unit === 'A' ? 1 : 3)) + ' ' + custom[1];
  return full ? display.complete : display.text + (display.unit === '—' ? '' : ' ' + display.unit);
}
function savedValue(value: unknown) { return value === undefined || value === null ? '未提供' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
export function TypeAnalysis({ module, tab }: { module: 'electrical' | 'short-circuit'; tab: string }) {
  const state = useTypeWorkspace(), evidence = useTypeEvidence(), navigation = useTypeNavigation(), inspector = useTypeInspector();
  const [selected, setSelected] = useState(''), [running, setRunning] = useState(false);
  const [curveOpen, setCurveOpen] = useState(false);
  const [trial, setTrial] = useState<Record<string,unknown> | null>(null), [trialError, setTrialError] = useState(''), [trying, setTrying] = useState(false);
  const trialRequest = useRef<AbortController | null>(null);
  useEffect(()=>()=>trialRequest.current?.abort(),[]);
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
  const current = !!saved && currentEvidence(saved.run, state.workspace?.revision, state.inputDirty || !!state.methodDrafts[module]) && (state.readOnly || !!study && study.id === saved.study.id && study.revision === optionalRecord(saved.run.snapshot).study_revision);
  const configuration = state.readOnly ? savedDefinition : study?.definition || savedDefinition;
  const parameters = optionalRecord(state.methodDrafts[module]?.definition.parameters || configuration.parameters);
  const values = { cable_type_id:state.document!.cable_types[0]?.id, ...parameters, ...(module === 'electrical' ? { frequency_hz:parameters.frequency_hz ?? 50,
    sources:{...optionalRecord(parameters.sources),...(!parameters.frequency_hz&&!optionalRecord(parameters.sources).frequency_hz?{frequency_hz:'50 Hz 为明示工程试算初值；须核对实际电源频率，未经批准。'}:{})} } : {}) };
  let contractError = '';
  if (!contracts.isPending && !installed.isPending) { try { if (contracts.error || installed.error) throw contracts.error || installed.error; exactContract(contracts.data!, installed.data!); } catch (failure) { contractError = message(failure); } }
  async function definition() {
    if (!study) throw new ApiError(409, '请先保存方法条件');
    const method = await methodForArtifact('x-cablesim.type-' + module);
    return { ...study.definition, method };
  }
  async function preview() {
    if (trying || !study || state.inputDirty || state.readOnly) return;
    const request = new AbortController(); trialRequest.current?.abort(); trialRequest.current=request; setTrying(true); setTrial(null); setTrialError('');
    try { const parameters=commitMethod(draft()).parameters;
      const response=await fetch(`/api/workspaces/${state.workspace!.id}/studies/${study.id}/preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_revision:state.workspace!.revision,expected_study_revision:study.revision,parameters}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])});
      const payload=await response.json();if(!response.ok)throw new ApiError(response.status,text(optionalRecord(payload.detail).message)||text(payload.detail)||'试算未完成');const result=record(payload);
      if (!result || result.persisted || result.engineering_approval) throw new Error('试算未返回有效临时结果');
      const first=optionalRecord(array(result.cases)[0]),item=optionalRecord(first.artifacts)['x-cablesim.type-'+module];
      if (!item) throw new Error(text(optionalRecord(first.error).message)||'当前参数未取得结果，请核对缺项与方法范围');
      setTrial(record(item));
    } catch(failure) { if (!request.signal.aborted) setTrialError(message(failure)); } finally { if(trialRequest.current===request&&!request.signal.aborted)setTrying(false); }
  }
  function draft(): MethodDraft { if (!installed.data) throw new ApiError(409, '方法仍在读取'); return state.methodDrafts[module] || { module, revision: state.workspace!.revision, study, fields: {}, definition: { ...configuration, title: text(configuration.title) || state.document!.name + ' · ' + name, input_source: 'domain', method: installed.data, parameters: structuredClone(values) } as MethodDefinition }; }
  function change(path: string, value: unknown) {
    trialRequest.current?.abort();setTrying(false);setTrial(null);setTrialError('');
    state.setMethodDraft(module, current => { const next = current || draft(),parameters=parameterValue(next.definition.parameters || {}, path, value);if(/^\/[a-z_]+$/.test(path)&&!['cable_type_id','circuit_id','sources'].includes(path.slice(1)))parameters.sources={...optionalRecord(parameters.sources),[path.slice(1)]:'工程师在方法参数中填写；未经批准'};return { ...next, definition: { ...next.definition, parameters, input_sources: { ...next.definition.input_sources, ['/parameters' + path]: { kind: 'user', reference: '工程师按匹配的参数契约填写', reviewed: false } } } }; });
  }
  function layerFor(row:AnalysisRow) {
    const target=optionalRecord(row.target),role=text(target.role),cable=state.document!.cable_types[0];
    if(!role)return '';
    const core=cable.cores.find(core=>core.id===target.core_id);
    return (target.scope==='core'&&core?.layers.some(layer=>layer.role===role)?text(target.core_id):cable.common_layers.some(layer=>layer.role===role)?'common':target.scope==='core'?text(target.core_id):'common')+'/'+role;
  }
  function select(row: AnalysisRow) {
    setSelected(row.id); const layer = layerFor(row);
    inspector.show(row.title, [
      { label: '计算结果', items: [{ label: '数值', value: analysisValue(row), source: 'calculation', sourceDetail: methodLabel(saved!.run) }, { label: '性质', value: basis[text(row.basis)] || '未声明' }, { label: '状态', value: statuses[text(row.status)].label }, { label: '原因', value: text(row.reason) || '—' }] },
      { label: '条款与依据', items: [{ label: '出处', value: resultCitation(row), stacked: true }, ...(text(row.formula) ? [{ label: '公式', value: <SavedFormula value={text(row.formula)} />, stacked: true }] : row.id.endsWith(':r20') ? [{ label: '数据依据', value: text(row.data_origin) || basis[text(row.basis)] || '待明确输入性质' }] : []), ...(text(optionalRecord(row.reference_table).table) ? [{ label: '标准限值参照', value: text(optionalRecord(row.reference_table).standard) + ' · ' + text(optionalRecord(row.reference_table).table) + ' · 正文 4–5 / PDF 7–8' }] : []), ...Object.entries(optionalRecord(row.formula_inputs)).map(([key, value]) => ({ ...formulaInput(key, value), source: 'calculation' as const }))] },
      { label: '来源与运行', items: [{ label: '输入来源', value: text(optionalRecord(row.input_source).reference) || '见保存的方法条件' }, { label: '方法', value: methodLabel(saved!.run) }, ...(layer ? [{ label: '结构对象', value: <Button variant="ghost" size="compact" onClick={() => navigation.navigate(typePath(state.workspace!.id, 'structure', 'table', navigation.location.theme) + '&layer=' + encodeURIComponent(layer))}>定位结构对象</Button> }] : [])] },
    ], <ResultTrace items={[{label:'完整显示精度',value:analysisValue(row,true)},{label:'原始 SI 数值',value:savedValue(row.value)+' '+text(row.unit)},{label:'公式原始参数',value:JSON.stringify(row.formula_inputs || {})},{label:'原文摘要',value:<EvidenceDigest value={row.source_digest} />},{label:'输入摘要',value:<EvidenceDigest value={saved!.artifact.input_sha256} />},{label:'运行',value:<EvidenceDigest value={saved!.run.id} />}]} />);
  }
  const bodyState = running || evidence.isPending ? 'loading' : error || evidence.error ? 'error' : !saved ? 'empty' : current ? 'success' : 'historical';
  const displayedRows:(AnalysisRow&{members:AnalysisRow[]})[]=module==='short-circuit'?identicalCoreRows(rows,state.document?.cable_types[0]?.cores.map(core=>core.id)||[]):rows.map(row=>({...row,members:[row]}));
  return <div className="type-page" data-type-page={module + '-results'} data-type-state={bodyState}>
    {tab==='parameters'&&!state.readOnly&&<div className="type-result-toolbar"><Button size="compact" variant="primary" loading={trying} disabled={!study||state.inputDirty||state.busy||!!contractError} onClick={()=>void preview()}>试算</Button><Button size="compact" loading={state.busy} disabled={(!state.methodDrafts[module]&&!!study)||trying||!!contractError||!installed.data} onClick={()=>{if(!state.methodDrafts[module])state.setMethodDraft(module,()=>draft());void state.save();}}>保存方法条件</Button>{!study&&<span className="muted">填写参数并保存条件后试算</span>}{state.inputDirty&&<span className="muted">请先保存结构修改</span>}</div>}
    {tab !== 'parameters' && <CommandAction><TypeRunControl channel={module} label={'计算' + name} definition={definition} onBusy={setRunning} unavailable={!study ? '请先在方法参数页填写并保存条件' : undefined} /></CommandAction>}
    {bodyState === 'loading' ? <LoadingState title={'正在读取或计算' + name} /> : bodyState === 'error' ? <ErrorState title={name + '不可用'} description={error || message(evidence.error)} action={<Button onClick={() => void evidence.refetch()}>重新读取</Button>} /> : tab === 'parameters' ? <>
      {!!contractError ? <ErrorState title="方法参数契约不可用" description={contractError} action={<Button onClick={() => void Promise.all([contracts.refetch(), installed.refetch()])}>重新读取方法</Button>} /> : installed.data && contracts.data ? <><p className="type-meta">{state.readOnly ? '固定运行的方法条件' : '当前方法条件'}</p><TypeMethodFields schema={exactContract(contracts.data!, installed.data).parameter_schema} document={state.document!} namespace={module} values={state.readOnly ? parameters : values} readOnly={state.readOnly || state.busy || trying} sources={state.readOnly ? optionalRecord(savedDefinition.input_sources) as Record<string,{kind?:string}> : state.methodDrafts[module]?.definition.input_sources || study?.definition.input_sources} fields={state.methodDrafts[module]?.fields} onChange={change} onDraftChange={(field, key) => {if(state.readOnly)return;state.setMethodDraft(module, current => { const next = current || draft(), fields = { ...next.fields }; if (field) fields[key] = field; else delete fields[key]; const baseline = next.study?.definition.parameters || { cable_type_id: state.document!.cable_types[0]?.id }; return !Object.keys(fields).length && JSON.stringify(next.definition.parameters) === JSON.stringify(baseline) && JSON.stringify(next.definition.input_sources) === JSON.stringify(next.study?.definition.input_sources) ? null : { ...next, fields }; });}} /></> : <LoadingState title="正在读取方法契约" />}
    </> : !saved ? <InlineEmpty title={study ? '尚无' + name + '结果；按当前方法条件运行。' : '尚无' + name + '结果；先填写方法参数。'} action={!study && !state.readOnly ? <Button onClick={() => navigation.navigate(typePath(state.workspace!.id, module, 'parameters', navigation.location.theme))}>在方法页填写参数</Button> : undefined} /> : <>
      {!current && <StaleBanner description="输入或方法已变化，以下为原运行保存的结果。" />}
      <div className="type-result-summary" title={methodLabel(saved.run) + '；统计来自保存的结果行'}><strong>{rows.filter(row => row.status === 'available').length} 项已计算</strong><span>{rows.filter(row => row.status === 'missing').length} 项待补数据</span><span>{rows.filter(row => row.status === 'uncovered' || row.status === 'not_applicable').length} 项未覆盖或拒绝</span></div>
      {module==='electrical'&&<p className="type-meta">交叉互联与护套损耗：转到研究工作台，按实际敷设与接地工况计算。</p>}
      <DataTable label={name} selectedId={selected} onSelect={select} rowLabel={row => row.title} showGroups={false} groups={[{ id: 'results', label: '结果', rows:displayedRows }]} columns={[{ id: 'title', label: '参数 / 组件', render: row => <>{row.title}{row.members.length>1&&<details><summary>分芯明细</summary>{row.members.map(item=><p key={item.id}>{item.title} · {analysisValue(item)}</p>)}</details>}</> }, { id: 'value', label: '数值', numeric: true, render: row => analysisValue(row) }, { id: 'basis', label: '性质', render: row => basis[text(row.basis)] || '未声明' }, { id: 'status', label: '状态', render: row => <StatusMark {...statuses[text(row.status)]} /> }, {id:'reason',label:'缺项 / 未覆盖原因',wrap:true,render:row => row.status==='available' ? '—' : (()=>{const issue=issuePresentation(row,module,state.document!.cable_types[0].id);if(issue.layer)issue.layer=layerFor(row);return <span><strong>{issue.label}</strong> · {issue.reason}<Button variant="ghost" size="compact" onClick={()=>navigation.navigate(typePath(state.workspace!.id,issue.module,issue.tab,navigation.location.theme)+(issue.layer?'&layer='+encodeURIComponent(issue.layer):'')+(issue.field?'&field='+encodeURIComponent(issue.field):''))}>{issue.action}</Button></span>;})()}, { id: 'source', label: '依据', render: row => <SourceBadge kind="standard" detail={[text(row.standard), text(row.clause), numeric(row.printed_page) === null ? '本库暂未收录 · 下一轮' : '正文 ' + numeric(row.printed_page)].join(' · ')} /> }]} />
      {module === 'short-circuit' && <details className="type-curve-disclosure" open={curveOpen} onToggle={event=>setCurveOpen(event.currentTarget.open)}><summary>电流—持续时间曲线</summary>{curveOpen && <ShortCircuitCurve artifact={saved.artifact} rows={rows} onSelect={select} onConfigure={()=>navigation.navigate(typePath(state.workspace!.id,module,'parameters',navigation.location.theme)+'&field='+encodeURIComponent('/duration_s'))} />}</details>}
    </>}
    {tab==='parameters'&&trialError&&<p role="alert" className="type-notice is-error">{trialError}</p>}
    {tab==='parameters'&&trial&&<section aria-label="试算结果" className="type-trial-results"><p className="type-meta">试算 · 未保存 · 不作为发布依据</p><DataTable label="试算结果" showGroups={false} rowLabel={row=>text(row.title)} groups={[{id:'preview',label:'试算',rows:array(trial.rows).map((value,index)=>({...optionalRecord(value),id:String(index)} as Record<string,unknown>&{id:string}))}]} columns={[{id:'title',label:'参数',render:row=>text(row.title)},{id:'value',label:'数值',numeric:true,render:row=>analysisValue(row)},{id:'status',label:'状态',render:row=><StatusMark {...(statuses[text(row.status)]||statuses.missing)} />},{id:'reason',label:'缺项与范围',wrap:true,render:row=>text(row.reason)||'—'}]} /></section>}
  </div>;
}
