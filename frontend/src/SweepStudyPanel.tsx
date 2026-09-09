import {useMemo, useState} from 'react';
import {useStudio} from './StudioState';
import {EngineeringChart} from './ScientificChart';
import {buildSweepStudy, sweepStudyCSV} from './sweepStudy';
import {download, fmt} from './utils';
import './sweep-study.css';

/** Only the shared provider's currentSweep may enter this panel. History is not promoted. */
export default function SweepStudyPanel() {
 const s = useStudio();
 const [view, setView] = useState<'table' | 'curve'>('table');
 const [referenceIndex, setReferenceIndex] = useState<number | null | undefined>(undefined);
 const study = useMemo(() => s.w && s.currentSweep ?
  buildSweepStudy(s.currentSweep, s.w.scenario, referenceIndex) : null,
  [s.w?.scenario, s.currentSweep, referenceIndex]);
 const series = useMemo(() => [{name: '参数扫描曲线', points: study?.chartPoints ?? []}], [study]);
 if (!s.w || !s.currentSweep || !s.outputCurrent) return null;
 if (!study) return <p role="status">扫描记录不完整或参数未注册，未生成比较结论。</p>;
 const run = s.w.runs.find(r => r.id === s.output?.run_id);
 const evidence = run && {workspaceId: s.w.id, revision: s.w.revision, runId: run.id, runInputHash: run.input_hash};
 const canExport = !s.busy && !!evidence;
 function exportCSV() {
  if (canExport && evidence && study) download('CableSimPro-扫描研究.csv', sweepStudyCSV(study, evidence), 'text/csv;charset=utf-8');
 }
 function exportJSON() {
  if (canExport && evidence && study && s.w) download('CableSimPro-扫描证据.json', JSON.stringify({
   schema_version: 1, purpose: 'discrete-sweep-comparison-not-engineering-certification',
   evidence, scenario: s.w.scenario, design_basis: s.w.design_basis ?? null,
   sweep: s.currentSweep, comparison: study,
   limits: '单参数离散点研究；不含交互作用、全局排序、插值或新增求解。运行摘要是保存记录的绑定，不是认证签名。',
  }, null, 2), 'application/json');
 }
 return <section className="sweep-study" aria-label="扫描研究结果" data-testid="sweep-study">
  <header className="sweep-heading"><div><small>单参数研究 · {study.rows.length} 个工况</small><h3>{study.label}与载流量</h3></div><span>rev.{s.w.revision} · RUN-{run?.id.slice(0, 8)}</span></header>
  <div className="sweep-metrics">
   <div><span>已求解 / 请求工况</span><b>{study.succeeded} / {study.rows.length}</b></div>
   <div><span>已求解点载流量范围</span><b>{study.minimumA === null ? '暂无有效值' : `${fmt(study.minimumA)}–${fmt(study.maximumA)} A`}</b></div>
   <div><span>低于运行电流的已求解点</span><b>{study.belowDemand} <small>点 / {fmt(study.demandA)} A</small></b></div>
  </div>
  <div className="sweep-reference"><label>比较基准<select aria-label="扫描比较基准" value={referenceIndex === undefined ? 'input' : referenceIndex === null ? 'none' : String(referenceIndex)} onChange={e => setReferenceIndex(e.target.value === 'input' ? undefined : e.target.value === 'none' ? null : Number(e.target.value))}>
   <option value="input">原工况：{study.inputValue} {study.unit}（须已扫描）</option><option value="none">不设比较基准</option>
   {study.rows.filter(r => r.ampacityA !== null).map(r => <option key={r.index} value={r.index}>扫描点 {r.index + 1}：{r.value} {study.unit}</option>)}
  </select></label><div className="sweep-export"><button disabled={!canExport} onClick={exportCSV}>导出扫描 CSV</button><button disabled={!canExport} onClick={exportJSON}>导出扫描证据</button></div></div>
  <p className="sweep-note" data-testid="sweep-reference-note">{study.reference ? `比较基准为 ${study.reference.value} ${study.unit} / ${fmt(study.reference.ampacityA)} A；${study.referenceIsInput ? '与原工况参数一致。' : '这是人工选定的扫描点，不是原工况。'}` : referenceIndex === undefined ? `原工况 ${study.inputValue} ${study.unit} 未获得唯一有效扫描点；相对变化留空，不自动补算。` : '没有有效比较基准；相对变化留空。'}</p>
  {study.failed > 0 && <p className="sweep-warning" role="status">{study.failed} 个工况无有效结果，不能据已求解点宣称全部满足要求。失败点不补零、不跨点连线。</p>}
  {study.duplicates && <p className="sweep-note">存在重复参数值：保留原始记录，涉及重复值的区间变化率留空。</p>}
  <nav className="sweep-tabs" aria-label="扫描结果视图"><button aria-pressed={view === 'table'} onClick={() => setView('table')}>结果表</button><button aria-pressed={view === 'curve'} onClick={() => setView('curve')}>特性曲线</button></nav>
  {view === 'curve' && <EngineeringChart label="参数扫描曲线" xLabel={study.parameter} yLabel="允许载流量 / A" series={series}/>}
  <div className="sweep-table-scroll" role="region" aria-label="扫描工况数据表" tabIndex={0}><table className="sweep-table"><caption>按请求顺序保留全部工况；区间变化率按参数值升序、仅比较相邻有效且不重复的点。</caption><thead><tr><th>{study.label} / {study.unit}</th><th>载流量 / A</th><th>相对基准 / %</th><th>电流余量 / A</th><th>区间变化率<br/>{study.slopeUnit}</th><th>求解状态</th></tr></thead><tbody>
   {study.rows.map(row => <tr key={row.index} data-point-index={row.index} data-status={row.ampacityA === null ? 'failed' : 'solved'}>
    <td>{fmt(row.value, 3)}{row.value === study.inputValue && <small> 原工况</small>}</td><td>{fmt(row.ampacityA)}</td><td>{fmt(row.deltaPercent, 2)}</td><td className={row.headroomA !== null && row.headroomA < 0 ? 'sweep-negative' : ''}>{fmt(row.headroomA)}</td><td title={row.previousValue === null ? '无可比较的相邻有效点' : `${row.previousValue} → ${row.value} ${study.unit}`}>{fmt(row.secant, 2)}</td><td>{row.error ?? '已求解'}</td>
   </tr>)}
  </tbody></table></div>
  <details className="sweep-method"><summary>比较方法与适用边界</summary><p>电流余量 = 该点允许载流量 − 当前运行电流；不是导体温度裕量，也不含额外设计储备。相对变化 = (该点载流量 − 比较基准载流量) / 比较基准载流量 × 100%。</p><p>区间变化率 = 相邻点载流量差 / 参数值差，是离散区间平均变化，不是解析导数。温度以 A / °C 表示，不计算摄氏温度百分比。不同单位的变化率不能直接排名。</p><p>仅描述已扫描范围，不能推断多参数交互、全局最优或完整标准符合性。切换基准、视图和导出不会修改参数、调用 AI 或重新求解。</p><code>运行输入摘要：{run?.input_hash ?? '不可用'}</code></details>
 </section>;
}
