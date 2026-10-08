import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { message, numeric, optionalRecord, text } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { SourceBadge } from '@/components/source-badge';
import { StatusMark } from '@/components/status-mark';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { CableSection } from '@/features/drawing/cable-section';
import { engineeringQuantity, formatNumber } from '@/lib/format';
import { useTypeWorkspace } from './provider';
import { typePath, useTypeNavigation } from './navigation';
import { useTypeInspector } from './inspector';
import { branchType, typeComparison, type ComparisonMetric } from './version-api';
import { EvidenceDigest } from './evidence-digest';
import { cleanLabel } from './labels';

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
export function TypeComparison({ tab }: { tab: string }) {
  const state = useTypeWorkspace(), { location, navigate } = useTypeNavigation(), inspector = useTypeInspector();
  const query = useQuery({ queryKey: ['type-comparison', state.workspace!.id], queryFn: ({ signal }) => typeComparison(state.workspace!.id, signal) });
  const [chosen, setChosen] = useState<string[] | null>(null), [selected, setSelected] = useState(''), [open, setOpen] = useState(false), [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), request = useRef<string>('');
  const items = query.data?.items || [], variants = items.filter(item => (chosen || items.slice(0, 4).map(item => item.workspace)).includes(item.workspace));
  const keys = [...new Set(variants.flatMap(item => Object.keys(item.values)))];
  const history = variants.some(item => Object.values(item.values).some(value => value.state === 'historical'));
  const bodyState = query.isPending ? 'loading' : query.error ? 'error' : items.length < 2 ? 'empty' : history || state.readOnly ? 'historical' : 'success';
  async function branch() {
    if (pending.current || !name.trim() || state.dirty || state.readOnly) return;
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
    <div className="type-result-toolbar"><Button variant="primary" size="compact" disabled={state.dirty || state.readOnly} onClick={() => { request.current = ''; setOpen(true); setName(''); setError(''); }}>建立方案</Button>{items.map(item => <label key={item.workspace}><input type="checkbox" aria-label={'对比 ' + item.name} checked={variants.includes(item)} disabled={!variants.includes(item) && variants.length >= 4} onChange={event => setChosen(event.target.checked ? [...variants.map(item => item.workspace), item.workspace] : variants.filter(value => value.workspace !== item.workspace).map(item => item.workspace))} /> <span title={'输入修订 ' + item.revision}>{cleanLabel(item.name)}</span></label>)}</div>
    {query.isPending ? <LoadingState title="正在读取型号方案与保存证据" /> : query.error ? <ErrorState title="方案对比不可用" description={message(query.error)} action={<Button onClick={() => void query.refetch()}>重新读取</Button>} /> : items.length < 2 ? <EmptyState title="尚无可比较的方案" description="基于当前已保存型号建立独立方案。" /> : !variants.length ? <EmptyState title="请选择对比方案" description="最多同时比较四个已保存方案。" /> : <>
      {history && <StaleBanner description="标为历史的指标保留原运行条件；各方案来源可逐项核对。" />}
      {tab === 'geometry' ? <div className="type-comparison-sections">{variants.map(item => <section key={item.workspace}><h2><span title={'输入修订 ' + item.revision}>{cleanLabel(item.name)}</span></h2><CableSection cableType={item.document.cable_types[0]} materials={item.document.materials} editable={false} label={item.name + '保存截面'} /></section>)}</div> : <DataTable label={tab === 'parameters' ? '方案参数差异' : '方案结果矩阵'} rowLabel={row => row.label} selectedId={selected} showGroups={false} groups={[{ id: 'matrix', label: '方案', rows: (tab === 'parameters' ? paths : keys).map(id => ({ id, label: tab === 'parameters' ? id : labels[id] || text(variants.find(item => item.values[id])?.values[id]?.title) || id })) }]} columns={[{ id: 'metric', label: tab === 'parameters' ? '输入字段 / SI' : '指标', wrap: true, render: row => row.label }, ...variants.map((item, index) => ({ id: item.workspace, label: cleanLabel(item.name), wrap: true, render: (row: { id: string }) => {
        if (tab === 'parameters') return documents[index][row.id] ?? '—';
        const metric = item.values[row.id], presentation = engineeringQuantity(row.id === 'outer_diameter' ? 'diameter' : row.id, metric?.value, text(metric?.unit));
        const display = row.id === 'outer_diameter' ? formatNumber(numeric(metric?.value) === null ? null : metric!.value! * 1000, 1) + ' mm' : row.id === 'mass' || row.id === 'copper_mass' ? formatNumber(metric?.value, 0) + ' kg/km' : presentation.text + ' ' + presentation.unit;
        const method = optionalRecord(optionalRecord(metric?.source).method);
        return <div className="type-metric-cell"><button onClick={() => inspect(row.id, metric, item.workspace)} aria-label={item.name + ' ' + (labels[row.id] || text(metric?.title) || '保存指标')}><span title={presentation.complete}>{metric ? row.id === 'standards' ? formatNumber(metric.value, 0) + '/' + String(metric.total) : display : '—'}</span><StatusMark kind={metric?.state === 'historical' ? 'historical' : metric?.state === 'current' ? 'success' : 'unknown'} label={metric?.state === 'historical' ? '历史' : metric?.state === 'current' ? '已保存' : '缺项'} /></button>{!!metric?.source && <SourceBadge kind="calculation" detail={(methods[text(method.plugin_id)] || '保存的计算结果') + ' · ' + text(method.version)} />}</div>;
      } }))]} />}
    </>}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }} title="建立独立型号方案" description="从当前已保存版本分支；计算结果不会转成新方案的当前结果。" actions={<Button variant="primary" disabled={!name.trim()} loading={busy} onClick={() => void branch()}>建立方案</Button>}><label className="type-form-label">方案名称<input value={name} maxLength={80} onChange={event => { setName(event.target.value); request.current = ''; }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void branch(); } }} /></label>{error && <p className="field-error" role="alert">{error}</p>}</Dialog>
  </div>;
}
