import {FileText,LockKeyhole} from 'lucide-react';
import {labelFor} from '../StudioPanels';

export interface ArchivedTask {id:string;capability:string;base_revision:number;status:string;input_snapshot:unknown;output:unknown}
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const number=(value:unknown,unit='')=>typeof value==='number'&&Number.isFinite(value)?`${new Intl.NumberFormat('zh-CN',{maximumSignificantDigits:15}).format(value)} ${unit}`.trim():'—';
const text=(value:unknown)=>value===null?'按模型估算':typeof value==='number'?number(value):typeof value==='string'?value:'—';

/** Immutable task output is evidence, never an actionable pending proposal. */
export default function TaskRecordView({task,label}:{task:ArchivedTask;label:string}){
 const snapshot=record(task.input_snapshot),scenario=record(snapshot.scenario),cable=record(scenario.cable),environment=record(scenario.installation);
 const envelope=record(task.output),result=record(envelope.result),calculation=record(record(result.output).result),summary=record(calculation.summary);
 const changes=Array.isArray(result.changes)?result.changes.map(record):[];
 const message=record(snapshot.arguments).message;
 return <article className="cs-archive" data-testid="archived-task-summary">
  <div className="cs-record-meta"><b>{label}</b><span>输入版本 {task.base_revision}</span><span>{task.status==='succeeded'?'执行完成':task.status==='failed'?'执行失败':'执行中'}</span></div>
  {typeof message==='string'&&<div className="cs-archive-request"><FileText size={17}/><p>{message}</p></div>}
  <section><h3>当次工程输入</h3><dl className="cs-archive-input"><div><dt>电缆截面积</dt><dd>{number(cable.area_mm2,'mm²')}</dd></div><div><dt>运行电流</dt><dd>{number(scenario.operating_current_a,'A')}</dd></div><div><dt>平均埋深</dt><dd>{number(environment.depth_m,'m')}</dd></div><div><dt>土壤热阻率</dt><dd>{number(environment.soil_rho_k_m_w,'K·m/W')}</dd></div></dl></section>
  {changes.length>0&&<section><h3>当次提出的参数差异</h3><p className="cs-archive-note">这是规划时的候选快照，不代表提案已批准；该记录不能重新应用。</p><table className="cs-diff-table"><thead><tr><th>参数</th><th>原值</th><th>拟用值</th></tr></thead><tbody>{changes.map((c,i)=><tr key={i}><td>{labelFor(String(c.path??''))}</td><td className="cs-before">{text(c.before)}</td><td className="cs-after">{text(c.after)}</td></tr>)}</tbody></table></section>}
  {typeof summary.ampacity_a==='number'&&<section><h3>原始计算摘要</h3><dl className="cs-archive-input"><div><dt>允许载流量</dt><dd>{number(summary.ampacity_a,'A')}</dd></div><div><dt>最高导体温度</dt><dd>{number(summary.operating_max_temperature_c,'°C')}</dd></div></dl></section>}
  {task.status==='failed'&&<p className="cs-warning">{typeof envelope.detail==='string'?envelope.detail:'工程工具未完成。请检查原始输出中的错误信息。'}</p>}
  {typeof envelope.input_sha256==='string'&&<p className="cs-archive-hash"><LockKeyhole size={13}/>输入校验值 <code>{envelope.input_sha256}</code></p>}
  <details className="cs-tool-details"><summary>查看完整结构化输出</summary><pre>{JSON.stringify(task.output,null,2)}</pre></details>
  <details className="cs-tool-details"><summary>查看完整输入快照</summary><pre>{JSON.stringify(task.input_snapshot,null,2)}</pre></details>
 </article>;
}
