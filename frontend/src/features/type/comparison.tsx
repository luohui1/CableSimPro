import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { message, numeric, optionalRecord, text } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { SourceBadge } from '@/components/source-badge';
import { StatusMark } from '@/components/status-mark';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { CableSection } from '@/features/drawing/cable-section';
import { layerNames } from '@/features/drawing/cable-geometry';
import { engineeringQuantity, formatNumber } from '@/lib/format';
import { useTypeWorkspace } from './provider';
import { typePath, useTypeNavigation } from './navigation';
import { useTypeInspector } from './inspector';
import { branchType, lifecycleAction, typeComparison, type ComparisonMetric } from './version-api';
import { EvidenceDigest } from './evidence-digest';
import { cleanLabel } from './labels';
import { resultValue } from './standard-check';

const labels: Record<string, string> = { outer_diameter: '外径', mass: '单位长度用料', copper_mass: '导体铜用料', standards: '标准核对通过' };
const methods: Record<string, string> = { 'cablesim.cable-geometry': '结构与用料推导', 'cablesim.standard-check': '标准核对', 'cablesim.iec60287': 'IEC 60287 载流量', 'cablesim.type-electrical': '电气与短路计算' };
function conditionItems(source: Record<string, unknown>) {
  const condition = optionalRecord(source.condition || source.conditions), fields: Record<string, [string, string]> = {
    depth_m: ['中心埋深', 'm'], soil_rho_k_m_w: ['土壤热阻率', 'K·m/W'], ambient_temperature_c: ['环境温度', '°C'],
    actual_spacing_m: ['实际中心距', 'm'], duration_s: ['持续时间', 's'], initial_temperature_k: ['初始温度', 'K'], final_temperature_k: ['最终温度', 'K'],
  };
  return Object.entries(fields).flatMap(([key, [label, unit]]) => numeric(condition[key]) === null ? [] : [{ label, value: engineeringQuantity(key, numeric(condition[key]), unit).complete }]);
}
function leafValues(value: unknown, prefix = ''): Record<string, string> {
  if (value === null || typeof value !== 'object') return { [prefix]: value === null ? '—' : String(value) };
  return Object.assign({}, ...Object.entries(value).flatMap(([key, value]) => key === 'provenance' ? [] : [leafValues(value, prefix + '/' + key)]));
}
function parameterLabel(document: ReturnType<typeof useTypeWorkspace>['document'], path: string) {
  const parts=path.split('/').slice(1),field=parts.at(-1) || '',core=parts.indexOf('cores');
  let parent: unknown=document;
  for(const part of parts.slice(0,-1))parent=parent && typeof parent==='object' ? (parent as Record<string,unknown>)[part] : undefined;
  const role=text(optionalRecord(parent).role) || (parts.includes('conductor')?'conductor':''),prefix=core>=0?'芯 '+(Number(parts[core+1])+1)+' · ':'';
  const names: Record<string,string>={thickness:'厚度',diameter:'直径',nominal_area:'标称截面',area:'有效截面',material:'材料',density:'材料密度',u0:'额定相电压',u:'额定线电压',label:'名称',name:'名称'};
  return prefix+(role?(layerNames[role] || '结构层')+' · ':'')+(names[field] || '输入参数');
}
function parameterDisplay(document: ReturnType<typeof useTypeWorkspace>['document'], path: string, value?: string) {
  if(value===undefined)return '—';
  const field=path.split('/').at(-1),number=Number(value);
  if(field==='material')return document?.materials.find(item=>item.id===value)?.label || '未绑定材料';
  if(['thickness','diameter'].includes(field || '')&&Number.isFinite(number))return formatNumber(number*1000,3)+' mm';
  if(['area','nominal_area'].includes(field || '')&&Number.isFinite(number))return formatNumber(number*1e6,2)+' mm²';
  if(['u','u0'].includes(field || '')&&Number.isFinite(number))return formatNumber(number/1000,2)+' kV';
  return value;
}
export function TypeComparison({ tab }: { tab: string }) {
  const state = useTypeWorkspace(), { location, navigate } = useTypeNavigation(), inspector = useTypeInspector();
  const queries = useQueryClient();
  const query = useQuery({ queryKey: ['type-comparison', state.workspace!.id], queryFn: ({ signal }) => typeComparison(state.workspace!.id, signal) });
  const [chosen, setChosen] = useState<string[] | null>(null), [selected, setSelected] = useState(''), [open, setOpen] = useState(false), [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), request = useRef<string>('');
  const [candidate, setCandidate] = useState(''), [adopting, setAdopting] = useState(false), [ack, setAck] = useState(false);
  const items = query.data?.items || [], variants = items.filter(item => (chosen || items.slice(0, 4).map(item => item.workspace)).includes(item.workspace));
  const keys = [...new Set(variants.flatMap(item => Object.keys(item.values)))];
  const history = state.dirty || variants.some(item => Object.values(item.values).some(value => value.state === 'historical'));
  const candidates = items.filter(item => !item.is_baseline && item.status === 'draft');
  const target = candidates.find(item => item.workspace === candidate) || candidates.find(item => item.workspace === state.workspace!.id) || candidates[0];
  const adopted = items.find(item => item.status === 'version_draft');
  const canBranch = !state.dirty && !location.revision && !location.run;
  async function adopt() {
    if (!target || !ack || pending.current || !canBranch) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await lifecycleAction(target.workspace, 'adopt', { expected_revision: target.revision, request_id: request.current });
      await Promise.all(['type-comparison', 'type-specification', 'type-workspace', 'type-list', 'object-relations'].map(key => queries.invalidateQueries({queryKey:[key]})));
      setAdopting(false);
    } catch (failure) { setError(message(failure)); } finally { pending.current = false; setBusy(false); }
  }
  const bodyState = query.isPending ? 'loading' : query.error ? 'error' : items.length < 2 ? 'empty' : history || state.readOnly ? 'historical' : 'success';
  async function branch() {
    if (pending.current || !name.trim() || !canBranch) return;
    pending.current = true; setBusy(true); setError(''); request.current ||= crypto.randomUUID();
    try { const wid = await branchType(state.workspace!.id, { expected_revision: state.workspace!.revision, request_id: request.current, name: name.trim() }); setOpen(false); navigate(typePath(wid, 'structure', 'section', location.theme)); }
    catch (failure) { setError(message(failure)); } finally { pending.current = false; setBusy(false); }
  }
  function inspect(key: string, metric: ComparisonMetric | undefined, workspace: string) {
    setSelected(key); const source = optionalRecord(metric?.source), method = optionalRecord(source.method);
    const conditions = conditionItems(source);
    inspector.show(labels[key] || text(metric?.title) || '保存指标', [
      { label: '保存指标', items: [{ label: '原始数值', value: numeric(metric?.value) === null ? '—' : String(metric!.value), unit: text(metric?.unit) }, { label: '状态', value: metric?.state === 'historical' ? '历史结果' : metric?.state === 'current' ? '当前结果' : '缺项' }, ...(text(metric?.reason) ? [{ label: '原因', value: text(metric?.reason) }] : [])] },
      ...(conditions.length ? [{ label: '保存条件', items: conditions }] : []),
      { label: '来源与运行', items: [{ label: '方法', value: (methods[text(method.plugin_id)] || '计算方法') + ' ' + text(method.version) }, { label: '运行', value: <EvidenceDigest value={source.run_id} /> }, { label: '输入摘要', value: <EvidenceDigest value={source.input_digest} /> }, { label: '输出摘要', value: <EvidenceDigest value={source.output_digest} /> }, { label: '方案', value: <Button variant="ghost" size="compact" onClick={() => navigate(typePath(workspace, 'structure', 'table', location.theme))}>打开保存结构</Button> }] },
    ]);
  }
  const documents = variants.map(item => leafValues(item.document)), paths = [...new Set(documents.flatMap(item => Object.keys(item)))].filter(path => new Set(documents.map(item => item[path] ?? '—')).size > 1);
  return <div className="type-page" data-type-page="comparison-results" data-type-state={bodyState}>
    <div className="type-result-toolbar"><Button variant={target ? 'secondary' : 'primary'} size="compact" disabled={!canBranch || busy} onClick={() => { request.current = ''; setOpen(true); setName(''); setError(''); }}>建立方案</Button>
      {!!candidates.length && <><Select label="采纳方案" value={target?.workspace || ''} options={candidates.map(item => ({value:item.workspace,label:cleanLabel(item.name)}))} disabled={busy} onChange={setCandidate} /><Button variant="primary" size="compact" disabled={!canBranch || busy} onClick={() => { request.current = crypto.randomUUID(); setAck(false); setError(''); setAdopting(true); }}>采纳为新版本草稿</Button></>}
      {adopted && <><StatusMark kind="draft" label="新版本草稿" /><Button size="compact" onClick={() => navigate(typePath(adopted.workspace, 'specification', 'content', location.theme))}>打开新草稿规格书</Button></>}
      {items.map(item => <label key={item.workspace}><input type="checkbox" aria-label={'对比 ' + item.name} checked={variants.includes(item)} disabled={!variants.includes(item) && variants.length >= 4} onChange={event => setChosen(event.target.checked ? [...variants.map(item => item.workspace), item.workspace] : variants.filter(value => value.workspace !== item.workspace).map(item => item.workspace))} /> <span title={'输入修订 ' + item.revision}>{cleanLabel(item.name)}</span></label>)}</div>
    {error && !open && !adopting && <p role="alert" className="field-error">{error}</p>}
    {query.isPending ? <LoadingState title="正在读取型号方案与保存证据" /> : query.error ? <ErrorState title="方案对比不可用" description={message(query.error)} action={<Button onClick={() => void query.refetch()}>重新读取</Button>} /> : items.length < 2 ? <EmptyState title="尚无可比较的方案" description="基于当前已保存型号建立独立方案。" /> : !variants.length ? <EmptyState title="请选择对比方案" description="最多同时比较四个已保存方案。" /> : <>
      {history && <StaleBanner description="标为历史的指标保留原运行条件；各方案来源可逐项核对。" />}
      <div className={tab==='geometry'?'type-comparison-geometry':'type-comparison-tables'}>
      {tab === 'geometry' ? <div className="type-comparison-sections">{variants.map(item => <section key={item.workspace}><h2><span title={'输入修订 ' + item.revision}>{cleanLabel(item.name)}</span></h2><CableSection cableType={item.document.cable_types[0]} materials={item.document.materials} editable={false} label={item.name + '保存截面'} /></section>)}</div> : <DataTable label={tab === 'parameters' ? '方案参数差异' : '方案结果矩阵'} rowLabel={row => row.label} selectedId={selected} showGroups={false} groups={[{ id: 'matrix', label: '方案', rows: (tab === 'parameters' ? paths : keys).map(id => ({ id, label: tab === 'parameters' ? parameterLabel(variants[0]?.document,id) : labels[id] || text(variants.find(item => item.values[id])?.values[id]?.title) || id })) }]} columns={[{ id: 'metric', label: tab === 'parameters' ? '输入字段' : '指标', wrap: true, render: row => <span title={tab==='parameters'?row.id:undefined}>{row.label}</span> }, ...variants.map((item, index) => ({ id: item.workspace, label: cleanLabel(item.name), wrap: true, render: (row: { id: string }) => {
        if (tab === 'parameters') return parameterDisplay(item.document,row.id,documents[index][row.id]);
        const metric = item.values[row.id], presentation = engineeringQuantity(row.id === 'outer_diameter' ? 'diameter' : row.id, metric?.value, text(metric?.unit));
        const display = row.id === 'outer_diameter' ? formatNumber(numeric(metric?.value) === null ? null : metric!.value! * 1000, 1) + ' mm' : row.id === 'mass' || row.id === 'copper_mass' ? formatNumber(metric?.value, 0) + ' kg/km' : presentation.text + ' ' + presentation.unit;
        const method = optionalRecord(optionalRecord(metric?.source).method);
        return <div className="type-metric-cell"><button onClick={() => inspect(row.id, metric, item.workspace)} aria-label={item.name + ' ' + (labels[row.id] || text(metric?.title) || '保存指标')}><span title={presentation.complete}>{metric ? row.id === 'standards' ? formatNumber(metric.value, 0) + '/' + String(metric.total) : display : '—'}</span><StatusMark kind={metric?.state === 'historical' ? 'historical' : metric?.state === 'current' ? 'success' : 'unknown'} label={metric?.state === 'historical' ? '历史' : metric?.state === 'current' ? '已保存' : '缺项'} /></button>{!!metric?.source && <SourceBadge kind="calculation" detail={(methods[text(method.plugin_id)] || '保存的计算结果') + ' · ' + text(method.version)} />}</div>;
      } }))]} />}
      {tab === 'matrix' && <DataTable label="全部适用要求对比" rowLabel={row => row.label} showGroups={false} groups={[{id:'requirements',label:'要求',rows:(query.data?.requirements || []).map(row => ({...row,label:row.title || '保存要求'}))}]} columns={[
        {id:'requirement',label:'要求与条款',wrap:true,render:row => <span>{row.label}<br /><span className="muted">{row.standard} · {row.clause}</span></span>},
        ...variants.map(item => ({id:item.workspace,label:cleanLabel(item.name),wrap:true,render:(row:{id:string}) => {
          const result=item.requirements[row.id], historical=result?.state==='historical' || state.dirty;
          const label=result?.state==='unrun' || !result ? '未运行' : historical ? '历史' : ({passed:'满足',failed:'不满足',fail:'不满足',missing:'缺项',uncovered:'未覆盖'}[result.verdict || ''] || '无法判断');
          const targetTab=result?.verdict==='missing' ? ['structure','table'] : ['standard-check','results'];
          return <div className="type-metric-cell"><StatusMark kind={label==='满足'?'satisfied':label==='不满足'?'unsatisfied':historical?'historical':'unknown'} label={label} />
            {numeric(result?.actual)!==null && <span title={String(result?.actual)}>{resultValue(result?.actual,{id:row.id,title:(query.data?.requirements || []).find(item=>item.id===row.id)?.title,unit:result?.unit})}</span>}
            {numeric(result?.margin)!==null && <span title={String(result?.margin)}>余量 {resultValue(result?.margin,{id:row.id,title:(query.data?.requirements || []).find(item=>item.id===row.id)?.title,unit:result?.unit})}</span>}
            {result?.reason && <span>{result.reason}</span>}<Button variant="ghost" size="compact" onClick={() => navigate(typePath(item.workspace, targetTab[0], targetTab[1], location.theme))}>{result?.verdict==='missing'?'补结构数据':'打开标准核对'}</Button></div>;
        }}))
      ]} />}
      </div>
    </>}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }} title="建立独立型号方案" description="从当前已保存版本分支；计算结果不会转成新方案的当前结果。" actions={<Button variant="primary" disabled={!name.trim()} loading={busy} onClick={() => void branch()}>建立方案</Button>}><label className="type-form-label">方案名称<input value={name} maxLength={80} onChange={event => { setName(event.target.value); request.current = ''; }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void branch(); } }} /></label>{error && <p className="field-error" role="alert">{error}</p>}</Dialog>
    <Dialog open={adopting} onOpenChange={value => {if(!busy)setAdopting(value);}} title="采纳为新版本草稿" description={`${cleanLabel(target?.name || '')}；输入与保存结果保持对应，缺项和未覆盖项随草稿保留。`} actions={<Button variant="primary" disabled={!ack} loading={busy} onClick={() => void adopt()}>确认采纳</Button>}><label><input type="checkbox" checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)} /> 已核对方案、全部要求与保存结果；采纳不代表批准或发布</label>{error && <p role="alert" className="field-error">{error}</p>}</Dialog>
  </div>;
}
