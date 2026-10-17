import { useEffect, useMemo, useRef, useState } from 'react';
import type { CadScene } from '../cad/types';
import type { SurfaceModel } from '../scene/surface-model';
import { SurfaceViewport } from '../scene/surface-viewport';
import { cadSurface } from '../scene/cad-surface';
import { caseOptions, readWorkbench, type WorkbenchData } from './data';
import { networkSurface } from './network-surface';
import { fieldSurface } from './field-surface';
import { NetworkDiagram, BalanceDiagram } from './network-diagram';
import { HistoryPlayer } from './history-player';
import './workbench.css';

export type VisualSelection = { id: string; title: string; groups: { label: string; items: { label: string; value: string; unit?: string }[] }[] };
type Props = { run?: Record<string, unknown>; onSelect?: (selection: VisualSelection) => void };
const fmt = (n: number | undefined | null, digits = 1) => n == null ? '—' : n.toLocaleString('zh-CN', { maximumFractionDigits: digits });
function Problem({ text }: { text: string }) { return <div className="tw-empty" role="alert"><strong>可视化不可用</strong><p>{text}</p><p>已保存输入和结果不会被修改，也不会用另一工况代替。</p></div>; }
export function StudyVisualWorkbench({ run, onSelect }: Props) {
  if (!run) return <div className="tw-empty"><h2>可视化工作区</h2><p>完成并保存一次计算后，在这里查看空间模型、热阻网络和动态过程。</p><p>此页面只读取运行工件，不生成演示计算结果。</p></div>;
  try { return <RunWorkbench key={String(run.id)} run={run} options={caseOptions(run)} onSelect={onSelect} />; }
  catch (error) { return <Problem text={error instanceof Error ? error.message : '运行工件不可用'} />; }
}
function RunWorkbench({ run, options, onSelect }: { run: Record<string, unknown>; options: ReturnType<typeof caseOptions>; onSelect?: Props['onSelect'] }) {
  const [caseId, setCaseId] = useState(options[0]?.id || '');
  const parsed = useMemo(() => { try { return { data: readWorkbench(run, caseId), error: '' }; } catch (e) { return { data: null, error: e instanceof Error ? e.message : '工件读取失败' }; } }, [run, caseId]);
  return <div className="tw-workbench">
    <header className="tw-heading"><div><span className="tw-eyebrow">工程分析 / 保存工件</span><h2>可视化工作区</h2></div><label>工况<select aria-label="可视化工况" value={caseId} onChange={e => setCaseId(e.target.value)}>{options.map(c => <option key={c.id} value={c.id}>{c.id}{c.status === 'succeeded' ? '' : ' · 尚无成功结果'}</option>)}</select></label></header>
    {parsed.error ? <Problem text={parsed.error} /> : parsed.data && <WorkbenchSession key={JSON.stringify([parsed.data.runId, caseId])} data={parsed.data} onSelect={onSelect} />}
  </div>;
}
function WorkbenchSession({ data, onSelect }: { data: WorkbenchData; onSelect?: Props['onSelect'] }) {
  const network = data.network, [phase, setPhase] = useState('A'), [condition, setCondition] = useState<'operating' | 'rating'>('operating');
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  const [selectedObject, setSelectedObject] = useState<string | null>(network ? 'phase:A' : null), [timeLabels, setTimeLabels] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'structure' | 'field'>(data.cad || network ? 'structure' : 'field');
  const notify = useRef(onSelect); notify.current = onSelect;
  useEffect(() => { notify.current?.({ id: '', title: '未选择对象', groups: [] }); }, [data.runId, data.caseId]);
  const state = network ? condition === 'operating' ? network.operating : network.rating : null;
  const profile = state?.profiles.find(p => p.phase === phase);
  const viewKey = JSON.stringify([data.runId, data.caseId, data.artifacts.map(a => [a.key, a.digest]), 'visual']);
  const surfaces = useMemo(() => {
    let structure: SurfaceModel | null = null, structureError = '';
    try { structure = data.cad ? cadSurface(data.cad as CadScene) : data.network ? networkSurface(data.network, JSON.stringify([data.runId, data.caseId])) : null; }
    catch (e) { structureError = e instanceof Error ? e.message : '保存几何不能显示'; }
    return { structure, structureError, field: data.field ? fieldSurface(data.field, JSON.stringify([data.runId, data.caseId, 'field'])) : null };
  }, [data]);
  const surface = mode === 'field' ? surfaces.field : surfaces.structure;
  function chooseObject(id: string | null) {
    setSelectedNode(null); setSelectedObject(id);
    if (id && /^phase:[ABC]$/.test(id) && network) setPhase(id.slice(-1));
    notify.current?.({ id: id || '', title: id || '未选择对象', groups: id ? [{ label: '保存显示对象', items: [{ label: '工况', value: data.caseId }, { label: '对象标识', value: id }] }] : [] });
  }
  function describeNode(index: number) {
    if (!network) return;
    const temperature = profile?.temperatures[index];
    notify.current?.({ id: `${viewKey}:node:${phase}:${index}`, title: `${phase} 相 · ${network.layers[index].label}`, groups: [{ label: '保存热网络节点', items: [
      { label: '径向位置', value: fmt(network.layers[index].radius * 1000, 4), unit: 'mm' },
      { label: '节点温度', value: fmt(temperature, 4), unit: '°C' },
      { label: '外侧等效热阻', value: fmt(network.resistances[index], 7), unit: 'K·m/W' },
      { label: '运行点', value: condition === 'operating' ? '保存运行点' : '保存额定点' },
    ] }] });
  }
  const refreshNode = useRef(describeNode); refreshNode.current = describeNode;
  useEffect(() => { if (selectedNode !== null) refreshNode.current(selectedNode); }, [selectedNode, phase, condition, network]);
  const hasData = data.network || data.balance || data.history || data.cad || data.field;
  if (!hasData) return <div className="tw-empty"><h3>该工况没有可绘制工件</h3><p>支持保存的热网络、IEC 热阻分解、节点温度场、温度历史与应急允许电流曲线。其他方法仍可在结果页查看。</p></div>;
  return <>
    <div className="tw-context"><span className="tw-proof">已校验的保存工件</span><span>运行 {data.runId.slice(0, 16)} · 工况 {data.caseId}</span>{data.historical && <strong>历史输入 · 不是当前工程结果</strong>}<span>显示操作不触发求解</span></div>
    {network && <div className="tw-metrics"><div><span>稳态电流 · {condition === 'operating' ? '运行点' : '额定点'}</span><strong>{fmt(state?.current)} <small>A</small></strong></div><div><span>{phase} 相稳态导体</span><strong>{fmt(profile?.temperatures[0])} <small>°C</small></strong></div><div><span>{phase} 相稳态外表面</span><strong>{fmt(profile?.temperatures.at(-1))} <small>°C</small></strong></div><div><span>保存导体温限</span><strong>{fmt(network.limit)} <small>°C</small></strong></div></div>}
    <div className="tw-layout">
      <section className="tw-spatial" aria-label="空间模型与温度场">
        <header className="tw-panel-heading"><div><h3>空间视图</h3><p>{mode === 'field' ? '二维保存截面置于三维视口，不沿轴向虚构温度。' : data.cad ? '与工件同源的显示网格，精确测量仍由 CAD 工具承担。' : '同心等效结构；每层半径取自热网络工件，不虚构绞线。'}</p></div><div className="tw-segment" role="group" aria-label="空间视图内容"><button type="button" aria-pressed={mode === 'structure'} disabled={!surfaces.structure && !surfaces.structureError} onClick={() => setMode('structure')}>结构</button><button type="button" aria-pressed={mode === 'field'} disabled={!surfaces.field} onClick={() => setMode('field')}>保存场图</button></div></header>
        {surface ? <SurfaceViewport model={surface} viewKey={`${viewKey}:${mode}`} selected={selectedObject} onSelect={chooseObject} labels={timeLabels}
          caption={mode === 'field' ? '固定场快照 · 节点间线性着色 · 非动态三维场' : data.cad ? '同源显示网格 · 剖切不生成精确 CAD 截面' : '保存等效半径 · 0.6 m 展示长度 · 分层剥切示意'} />
          : <div className="tw-empty"><strong>{mode === 'structure' && surfaces.structureError ? '显示网格不可用' : '该工况未保存此类几何'}</strong><p>{surfaces.structureError || '曲线与热网络仍可独立查看；不从其他运行借用模型。'}</p></div>}
        {mode === 'field' && data.field && <div className="tw-colorbar"><span>{fmt(data.field.minimum)} °C</span><span className="tw-ramp" /><span>{fmt(data.field.maximum)} °C</span><span>本快照色标固定</span></div>}
        {data.history && <p className="tw-note tw-spatial-note">时间轴只更新 ID 匹配对象的数值标注；标注不是空间温度场。保存场图和稳态热路不随回放伪变形。</p>}
      </section>
      <section className="tw-thermal" aria-label="热网络工作区">
        <header className="tw-panel-heading"><div><h3>热网络</h3><p>{network ? '径向导热 + 相间互热' : '保存的额定点等效热阻'}</p></div></header>
        {network ? <>
          <div className="tw-network-controls"><div className="tw-segment" role="group" aria-label="热网络相别">{['A', 'B', 'C'].map(p => <button key={p} type="button" aria-pressed={phase === p} onClick={() => chooseObject(`phase:${p}`)}>{p} 相</button>)}</div><label>状态<select aria-label="热网络运行点" value={condition} onChange={e => setCondition(e.target.value as 'operating' | 'rating')}><option value="operating">运行点</option><option value="rating">额定点</option></select></label></div>
          {!state && <p className="tw-warning" role="status">{network.operatingError} 可主动切换到额定点查看；页面不会自动替换运行点。</p>}
          <NetworkDiagram network={network} state={state} phase={phase} onNode={setSelectedNode} />
        </> : data.balance ? <BalanceDiagram balance={data.balance} /> : <div className="tw-empty"><strong>未保存可绘制的热阻网络</strong><p>温度历史不能唯一确定各层热阻、热容或节点响应，因此不据曲线补造网络。</p></div>}
      </section>
    </div>
    {data.history ? <HistoryPlayer history={data.history} runId={data.runId} caseId={data.caseId} onFrame={setTimeLabels} onEntity={id => { if (surface?.objects.some(o => o.id === id)) chooseObject(id); }} />
      : <section className="tw-history tw-history-empty"><h3>动态过程</h3><p>该运行没有保存时间序列。请在暂态研究中完成计算后查看；稳态结果不会自动变成一段“升温动画”。</p><p className="tw-note">电气电容不等于热容，前端不从电容字段构造 RC 暂态模型。</p></section>}
    <details className="tw-evidence"><summary>方法范围与工件来源 · {data.artifacts.length} 项</summary>
      {data.warnings.length > 0 && <div className="tw-warning">{[...new Set(data.warnings)].map((warning, i) => <p key={i}>{warning}</p>)}</div>}
      <p>工件校验表示来源与格式通过宿主核验，不代表工程审批或标准认证。所有温度、热阻与时间步均来自上述运行的所选工况。</p>
      <dl>{data.artifacts.map(a => <div key={a.key}><dt>{a.key}</dt><dd><code>{a.digest}</code></dd></div>)}</dl>
    </details>
  </>;
}
