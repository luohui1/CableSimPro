import {EngineeringIcon} from '../visual-kit/EngineeringIcon';
import {useEffect} from 'react';
import {Activity,ArrowRight,CheckCircle2,FileText,Layers3,LockKeyhole,ShieldCheck,Thermometer,TriangleAlert,Workflow,X} from 'lucide-react';
import {useStudio} from '../StudioState';
import {fmt} from '../utils';
import {buildAmpacityDiagnostics} from './ampacity-diagnostics';
import './ampacity-diagnosis.css';
import './ampacity-study.css';

function soilSweepTask(current:number){
 const values=[2/3,1,4/3,5/3]
  .map(factor=>Math.min(5,Math.max(.3,Math.round(current*factor*100)/100)))
  .filter((value,index,list)=>list.indexOf(value)===index);
 if(values.length<2)values.push(current<=.3?5:.3);
 values.sort((a,b)=>a-b);
 return `比较土壤热阻率 ${values.map(value=>String(Number(value.toFixed(2)))).join('、')} 下的载流量`;
}

export default function AmpacityDiagnosis({open,onClose,openWorkbench,openAgent}:{open:boolean;onClose:()=>void;openWorkbench:(view?:string)=>void;openAgent:(text?:string)=>void}){
 const s=useStudio(),result=s.current,w=s.w;
 useEffect(()=>{if(!open)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[open,onClose]);
 if(!open||!result||!w)return null;
 const d=buildAmpacityDiagnostics(result);
 const StatusIcon=d.overloaded?TriangleAlert:CheckCircle2;
 const runLabel=s.output?.run_id?`RUN-${s.output.run_id.slice(0,8)}`:'当前会话结果';
 const marginText=d.currentMarginA>=0?`+${fmt(d.currentMarginA)} A`: `${fmt(d.currentMarginA)} A`;
 const temperatureMargin=`${d.temperatureMarginC>=0?'+':''}${fmt(d.temperatureMarginC,1)} °C`;
 const residualText=d.residualK<1e-6?d.residualK.toExponential(2):fmt(d.residualK,6);
 const sweepTask=soilSweepTask(result.input.installation.soil_rho_k_m_w);
 function jump(view:string){onClose();openWorkbench(view)}
 function startSensitivity(){onClose();openAgent(sweepTask)}
 return <div className="ampacity-diagnosis-layer" data-testid="ampacity-diagnosis" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
  <aside className="ampacity-diagnosis" role="dialog" aria-modal="true" aria-labelledby="ampacity-diagnosis-title">
   <header className="diagnosis-header"><div className={`diagnosis-status ${d.overloaded?'warning':'ready'}`}><StatusIcon size={19}/></div><div><span>当前有效结果 / 解释层</span><h2 id="ampacity-diagnosis-title">载流量工况诊断</h2><p>从已求解结果拆解损耗、温升与热阻路径；打开面板不会重新计算。</p></div><button className="diagnosis-close" aria-label="关闭载流量诊断" onClick={onClose}><X size={19}/></button></header>
   <div className="diagnosis-provenance"><span><ShieldCheck size={13}/>{result.model_version}</span><span>rev.{w.revision}</span><span>{runLabel}</span><code>#{d.inputHashShort}</code></div>
   <section className="diagnosis-kpis" aria-label="载流量关键指标">
    <article><small>允许载流量</small><strong>{fmt(result.summary.ampacity_a)} <em>A</em></strong><span>限制相 {d.limitingPhase}</span></article>
    <article className={d.overloaded?'risk':''}><small>运行利用率</small><strong>{fmt(d.utilizationPercent,1)} <em>%</em></strong><span>电流裕量 {marginText}</span></article>
    <article><small>导体最高温度</small><strong>{fmt(d.conductorTemperatureC,1)} <em>°C</em></strong><span>温度裕量 {temperatureMargin}</span></article>
    <article><small>{d.stateLabel}线路损耗</small><strong>{fmt(d.circuitLossKw,2)} <em>kW</em></strong><span>{fmt(result.input.circuit_length_m,0)} m 回路</span></article>
   </section>
   <div className="diagnosis-grid">
    <section className="diagnosis-card" aria-labelledby="loss-budget-title"><header><div><EngineeringIcon name="wave" size={25}/><span><b id="loss-budget-title">损耗预算</b><small>三相每米损耗构成</small></span></div><strong>{d.dominantLoss.label}</strong></header><div className="loss-stack">{d.losses.map(item=><div className="loss-row" key={item.key}><div><span>{item.label}</span><b>{fmt(item.wPerM,3)} W/m</b></div><div className="loss-track"><i style={{width:`${Math.min(100,item.sharePercent)}%`}}/></div><small>{fmt(item.sharePercent,1)}%</small></div>)}</div><footer>主导发热：<b>{d.dominantLoss.label}</b>，占总每米损耗约 {fmt(d.dominantLoss.sharePercent,1)}%。</footer></section>
    <section className="diagnosis-card" aria-labelledby="thermal-path-title"><header><div><EngineeringIcon name="temperature" size={25}/><span><b id="thermal-path-title">温升路径</b><small>{d.limitingPhase} 相 · {d.stateLabel}</small></span></div><strong>{d.thermalDriver}</strong></header><div className="thermal-stack"><div className="thermal-nodes"><span>导体 {fmt(d.conductorTemperatureC,1)} °C</span><ArrowRight size={14}/><span>缆表 {fmt(d.surfaceTemperatureC,1)} °C</span><ArrowRight size={14}/><span>环境 {fmt(d.ambientTemperatureC,1)} °C</span></div><div className="thermal-budget"><div style={{width:`${d.internalRiseShare}%`}}><b>缆体径向</b><span>ΔT {fmt(d.internalRiseC,1)} °C</span></div><div style={{width:`${d.externalRiseShare}%`}}><b>外部土壤</b><span>ΔT {fmt(d.externalRiseC,1)} °C</span></div></div></div><footer>温升分解来自限制相导体、缆表与环境温度，不把解析土壤场图当作有限元结果。</footer></section>
   </div>
   <section className="diagnosis-resistance" aria-labelledby="thermal-resistance-title"><header><div><EngineeringIcon name="layers" size={25}/><span><b id="thermal-resistance-title">热阻链</b><small>缆体 5 层径向热阻 + 限制相土壤矩阵项</small></span></div><strong>ΣR<sub>rad</sub> {fmt(d.radialResistanceTotal,4)} K·m/W</strong></header><div className="resistance-layout"><div className="resistance-layers">{d.radialResistances.map(item=><div className="resistance-row" key={item.label}><div><span>{item.label}</span><b>{fmt(item.kMW,5)} K·m/W</b></div><div className="resistance-track"><i style={{width:`${Math.min(100,item.sharePercent)}%`}}/></div><small>{fmt(item.sharePercent,1)}%</small></div>)}</div><div className="soil-coupling"><article><small>土壤自热系数 · G<sub>ii</sub></small><strong>{fmt(d.soilSelfKMW,4)}</strong><span>K·m/W</span></article><article><small>邻相互热系数和 · ΣG<sub>ij</sub></small><strong>{fmt(d.soilMutualKMW,4)}</strong><span>K·m/W</span></article><article><small>热平衡残差</small><strong>{residualText}</strong><span>K</span></article></div></div><footer>条形仅比较缆体径向层热阻系数；土壤值是半空间互热矩阵系数，不能与层热阻直接相加冒充完整 IEC 60287 热阻链。</footer></section>
   <section className="diagnosis-study" aria-labelledby="sensitivity-title"><div className="diagnosis-study-icon"><EngineeringIcon name="workflow" size={27}/></div><div><span>诊断 → 验证</span><h3 id="sensitivity-title">用独立工况扫描验证土壤敏感性</h3><p>当前土壤热阻率为 {fmt(result.input.installation.soil_rho_k_m_w,2)} K·m/W。把一组邻近工况送入现有参数扫描，检查允许载流量对外部热环境的响应；不会覆盖当前工程结果。</p><code>{sweepTask}</code></div><button aria-label="创建土壤敏感性扫描任务" onClick={startSensitivity}>创建扫描任务 <ArrowRight size={14}/></button></section>
   <section className="diagnosis-evidence" aria-labelledby="evidence-chain-title"><header><div><EngineeringIcon name="book" size={25}/><span><b id="evidence-chain-title">证据链</b><small>结果可追溯到当前工程版本与输入快照</small></span></div><button onClick={()=>jump('documents')}>核对资料 <ArrowRight size={13}/></button></header><dl><div><dt>工程版本</dt><dd>rev.{w.revision} · {runLabel}</dd></div><div><dt>输入指纹</dt><dd><code>{result.input_sha256}</code></dd></div><div><dt>计算模型</dt><dd>{result.model_version}</dd></div><div><dt>R20 来源</dt><dd>{d.r20Basis}</dd></div><div><dt>工程资料</dt><dd>{w.sources.length} 份确认节选 · {result.sources.length} 条方法范围引用</dd></div><div><dt>参数锁</dt><dd><LockKeyhole size={12}/>{w.locks.length} 项</dd></div><div><dt>热平衡残差</dt><dd>{residualText} K</dd></div><div><dt>计算时间</dt><dd>{new Date(result.computed_at).toLocaleString()}</dd></div></dl></section>
   <section className="diagnosis-boundary" aria-labelledby="boundary-title"><header><TriangleAlert size={16}/><div><b id="boundary-title">适用范围与警告</b><small>{result.warnings.length} 条模型边界/工况提示</small></div></header><ul>{result.warnings.slice(0,4).map((warning,index)=><li key={index}>{warning}</li>)}</ul>{result.warnings.length>4&&<p>另有 {result.warnings.length-4} 条提示，完整内容在计算明细中保留。</p>}</section>
   <footer className="diagnosis-actions"><span><ShieldCheck size={14}/>诊断只解释当前有效结果，不修改参数、不替代标准签审。</span><div><button onClick={()=>jump('documents')}>参数依据</button><button className="primary" onClick={()=>jump('history')}>打开计算记录 <ArrowRight size={14}/></button></div></footer>
  </aside>
 </div>;
}
