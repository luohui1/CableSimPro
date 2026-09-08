import {Activity,ArrowRight,CheckCircle2,FileText,Layers3,LockKeyhole,Thermometer,TriangleAlert} from 'lucide-react';
import {useStudio} from '../StudioState';
import {fmt} from '../utils';
import type {WorkMode} from './session';
import './engineering-pulse.css';

type Tone='idle'|'running'|'review'|'ready'|'warning';

/** A compact, shared readout of the same saved engineering state in both modes. */
export default function EngineeringPulse({mode,openWorkbench,openAgent}:{
 mode:WorkMode;
 openWorkbench:(view?:string)=>void;
 openAgent:(text?:string)=>void;
}){
 const s=useStudio(),w=s.w;
 if(!w)return null;
 const scenario=w.scenario,p=s.proposal;
 const dirtyCount=Object.keys(s.inputDrafts).length;
 const expired=!!p?.expired||!!(p?.expires_at&&p.expires_at*1000<Date.now());
 const stale=!!p&&(p.base_revision!==w.revision||expired);
 const pending=!!p?.ready;
 const outputStale=!!s.output&&!s.current&&!s.currentSweep&&!s.outputCurrent;
 const currentMargin=s.current?s.current.summary.ampacity_a-scenario.operating_current_a:null;
 const completedSweep=s.currentSweep?.points.filter(point=>point.ampacity_a!==null&&!point.error).length??0;
 const material=scenario.cable.conductor==='copper'?'Cu':'Al';
 const arrangement=scenario.installation.arrangement==='flat'?'水平直埋':'三角直埋';
 let tone:Tone='idle',headline='准备当前工况计算',detail='模型、敷设与运行输入已保存',action='开始计算';
 let onAction=()=>openAgent('计算载流量');
 let actionDisabled=false;
 if(dirtyCount){
  tone='warning';headline=`${dirtyCount} 项输入待处理`;detail='计算、任务规划与批准均已暂停';action='检查输入';onAction=()=>openWorkbench('cable');
 }else if(s.busy){
  tone='running';headline='工程工具执行中';detail='版本锁、参数校验与任务记录保持生效';action='执行中';actionDisabled=true;
 }else if(pending&&stale){
  tone='warning';headline='提案需要更新';detail=expired?'提案已过有效期，不能继续批准':'工程版本已变化，旧提案不能批准';action='打开任务';onAction=()=>openAgent();
 }else if(pending){
  tone='review';headline='等待工程审查';detail=`${p.changes.length} 项拟议修改尚未写入工程`;action='审查提案';onAction=()=>openAgent();
 }else if(p&&!p.ready){
  tone='warning';headline='需要补充任务条件';detail='尚未生成正式参数变更或计算计划';action='补充任务';onAction=()=>openAgent();
 }else if(s.current){
  const overloaded=currentMargin!==null&&currentMargin<0;
  tone=overloaded?'warning':'ready';headline=overloaded?'运行电流超过允许载流量':'结果可复核';
  detail=`限制相 ${s.current.summary.limiting_phase} · 利用率 ${fmt(s.current.summary.utilization_percent,1)}%`;
  action='复核结果';onAction=()=>openWorkbench('history');
 }else if(s.currentSweep){
  tone='ready';headline='参数扫描可复核';detail=`${completedSweep}/${s.currentSweep.points.length} 个工况完成`;
  action='复核扫描';onAction=()=>openWorkbench('history');
 }else if(outputStale){
  tone='warning';headline='结果已失效';detail='当前输入与最近一次输出不一致';action='重新计算';onAction=()=>openAgent('计算载流量');
 }
 const StateIcon=tone==='ready'?CheckCircle2:tone==='warning'||tone==='review'?TriangleAlert:Activity;
 const resultValue=s.current?`${fmt(s.current.summary.ampacity_a)} A`:s.currentSweep?`${completedSweep} 工况`:outputStale?'待重新计算':'待计算';
 const resultDetail=s.current&&currentMargin!==null?`电流裕量 ${currentMargin>=0?'+':''}${fmt(currentMargin)} A`:s.currentSweep?'独立工况结果':outputStale?'旧输出不作为当前结论':'无当前有效结果';
 return <section className={`engineering-pulse tone-${tone}`} data-testid="engineering-pulse" aria-label="共享工程状态">
  <div className="engineering-pulse-state" aria-live="polite">
   <span className="pulse-state-icon"><StateIcon size={18}/></span>
   <div><span>共享工程状态</span><strong>{headline}</strong><small>{detail}</small></div>
  </div>
  <button type="button" className="engineering-pulse-metric" data-testid="pulse-cable" aria-label="打开电缆结构" onClick={()=>openWorkbench('cable')}>
   <span className="pulse-metric-icon"><Layers3 size={16}/></span><span><small>电缆结构</small><b>{material} {fmt(scenario.cable.area_mm2,0)} mm²</b><em>U₀ {fmt(scenario.cable.u0_kv,1)} kV</em></span>
  </button>
  <button type="button" className="engineering-pulse-metric" data-testid="pulse-installation" aria-label="打开敷设条件" onClick={()=>openWorkbench('installation')}>
   <span className="pulse-metric-icon"><Activity size={16}/></span><span><small>敷设条件</small><b>{arrangement} · {fmt(scenario.installation.depth_m,2)} m</b><em>土壤热阻率 {fmt(scenario.installation.soil_rho_k_m_w,2)}</em></span>
  </button>
  <button type="button" className="engineering-pulse-metric" data-testid="pulse-operating" aria-label="打开运行条件" onClick={()=>openWorkbench('cable')}>
   <span className="pulse-metric-icon"><Thermometer size={16}/></span><span><small>运行条件</small><b>{fmt(scenario.operating_current_a,0)} A</b><em>导体限温 {fmt(scenario.cable.max_temperature_c,0)} °C</em></span>
  </button>
  <button type="button" className="engineering-pulse-metric" data-testid="pulse-evidence" aria-label="打开参数依据" onClick={()=>openWorkbench('documents')}>
   <span className="pulse-metric-icon"><FileText size={16}/></span><span><small>参数依据</small><b>{w.sources.length} 份资料</b><em><LockKeyhole size={11}/>{w.locks.length} 项锁定</em></span>
  </button>
  <button type="button" className="engineering-pulse-metric pulse-result" data-testid="pulse-result" aria-label={s.current||s.currentSweep?'打开当前结果':'创建载流量计算任务'} onClick={()=>s.current||s.currentSweep?openWorkbench('history'):openAgent('计算载流量')}>
   <span className="pulse-metric-icon"><CheckCircle2 size={16}/></span><span><small>当前结果</small><b>{resultValue}</b><em>{resultDetail}</em></span>
  </button>
  <button type="button" className="engineering-pulse-action" disabled={actionDisabled} onClick={onAction} aria-label={action}><span>{action}</span>{!actionDisabled&&<ArrowRight size={15}/>}</button>
  <span className="pulse-mode-tag" aria-hidden="true">{mode==='agent'?'工程流':'工作台'}</span>
 </section>;
}
