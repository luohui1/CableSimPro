import {useEffect,useRef} from 'react';
import {ArrowRight,X} from 'lucide-react';
import {useStudio} from '../StudioState';
import {fmt} from '../utils';
import {EngineeringIcon} from '../visual-kit/EngineeringIcon';
import {KitButton,KitStatus} from '../visual-kit/KitControls';
import {KitLossBudget,KitMetric,KitTemperaturePath} from '../visual-kit/KitInstruments';
import {buildAmpacityDiagnostics} from './ampacity-diagnostics';
import './ampacity-diagnosis.css';
import './ampacity-study.css';

function soilSweepTask(current:number) {
 const values=[2/3,1,4/3,5/3]
  .map(factor=>Math.min(5,Math.max(.3,Math.round(current*factor*100)/100)))
  .filter((value,index,list)=>list.indexOf(value)===index);
 if(values.length<2)values.push(current<=.3?5:.3);
 values.sort((a,b)=>a-b);
 return `比较土壤热阻率 ${values.map(value=>String(Number(value.toFixed(2)))).join('、')} 下的载流量`;
}
const signed=(value:number|null,unit:string)=>value===null?'未取得运行稳态解':`${value>=0?'+':''}${fmt(value,1)} ${unit}`;

export default function AmpacityDiagnosis({open,onClose,openWorkbench,openAgent}:{
 open:boolean;onClose:()=>void;openWorkbench:(view?:string)=>void;openAgent:(text?:string)=>void;
}) {
 const s=useStudio(),result=s.current,w=s.w;
 const dialogRef=useRef<HTMLDialogElement>(null);
 const visible=open&&!!result&&!!w;
 useEffect(()=>{
  const dialog=dialogRef.current;
  if(!visible||!dialog)return;
  if(!dialog.open)dialog.showModal();
  return()=>{if(dialog.open)dialog.close()};
 },[visible,w?.id]);
 if(!visible||!result||!w)return null;
 const d=buildAmpacityDiagnostics(result);
 const unavailable=!d.operatingAvailable;
 const run=s.output?.run_id?w.runs.find(row=>row.id===s.output!.run_id):undefined;
 const runLabel=s.output?.run_id?`RUN-${s.output.run_id.slice(0,8)}`:'当前会话结果';
 const residualText=d.residualK<1e-6?d.residualK.toExponential(2):fmt(d.residualK,6);
 const sweepTask=soilSweepTask(result.input.installation.soil_rho_k_m_w);
 function jump(view:string){onClose();openWorkbench(view)}
 return <dialog ref={dialogRef} className="ampacity-diagnosis-layer kit-diagnosis-shell" data-testid="ampacity-diagnosis"
  aria-labelledby="ampacity-diagnosis-title" aria-describedby="kit-diagnosis-description"
  onCancel={event=>{event.preventDefault();onClose()}}
  onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
  <div className="ampacity-diagnosis kit-diagnosis">
   <header className="diagnosis-header">
    <EngineeringIcon name={unavailable?'error':d.overloaded?'warning':'check'} size={40}/>
    <div><span>工程结果 / 只读诊断</span><h2 id="ampacity-diagnosis-title">载流量工况诊断</h2><p id="kit-diagnosis-description">同一计算快照 · 图表由求解数据绘制 · 打开面板不会重新计算</p></div>
    <button autoFocus type="button" className="diagnosis-close" aria-label="关闭载流量诊断" onClick={onClose}><X size={19}/></button>
   </header>
   <div className="diagnosis-provenance"><KitStatus tone={unavailable||d.overloaded?'warning':'blue'}>{unavailable?'运行解不可用':d.overloaded?'超出当前限值':'当前结果可复核'}</KitStatus><span>{result.model_version}</span><span>{runLabel}{run?` · rev.${run.revision}`:''}</span><code>#{d.inputHashShort}</code></div>
   {unavailable&&<div className="kit-operating-warning" role="alert" data-testid="kit-operating-unavailable"><EngineeringIcon name="error" size={27}/><div><b>运行电流未取得稳态解</b><p>{d.operatingError||'运行温度及温度裕量不可用。'} 下方损耗与温升图仅显示允许载流量点，不代表运行工况。</p></div></div>}
   <section className="diagnosis-kpis" aria-label="载流量关键指标">
    <KitMetric label="允许载流量" value={result.summary.ampacity_a} unit="A" icon="power" detail={`限制相 ${d.limitingPhase}`}/>
    <KitMetric label="运行利用率" value={d.utilizationPercent} unit="%" icon="wave" tone={d.overloaded?'danger':'normal'} detail={`电流裕量 ${signed(d.currentMarginA,'A')}`}/>
    <KitMetric label="运行最高导体温度" value={d.operatingMaxTemperatureC} unit="°C" tone={unavailable?'muted':'normal'} detail={d.temperatureMarginC===null?'温度裕量不可用':`温度裕量 ${signed(d.temperatureMarginC,'°C')}`} testId="kit-operating-temperature"/>
    <KitMetric label={`${d.stateLabel}线路损耗`} value={d.circuitLossKw} unit="kW" detail={`${fmt(result.input.circuit_length_m,0)} m 回路`}/>
   </section>
   <div className="diagnosis-grid">
    <section className="diagnosis-card" aria-labelledby="loss-budget-title"><header><div><EngineeringIcon name="chart" size={29}/><span><b id="loss-budget-title">损耗预算</b><small>{d.stateLabel} · 三相每米</small></span></div><strong>{d.lossTotalWm>0?d.dominantLoss.label:'无损耗'}</strong></header>
     <KitLossBudget losses={d.losses} total={d.lossTotalWm} stateLabel={d.stateLabel}/>
     <footer>导体、金属屏蔽与介质损耗分别统计；环图不是参考图片。</footer>
    </section>
    <section className="diagnosis-card" aria-labelledby="thermal-path-title"><header><div><EngineeringIcon name="temperature" size={29}/><span><b id="thermal-path-title">温升路径</b><small>导体 → 缆表 → 环境</small></span></div><strong>{d.thermalDriver}</strong></header>
     <KitTemperaturePath diagnosis={d}/>
     <footer>显示相 {d.displayPhase} 的实算温度分解；不将解析场图称作有限元结果。</footer>
    </section>
   </div>
   <section className="diagnosis-resistance" aria-labelledby="thermal-resistance-title"><header><div><EngineeringIcon name="resistance" size={29}/><span><b id="thermal-resistance-title">热阻链</b><small>5 层径向热阻 · {d.displayPhase} 相土壤矩阵</small></span></div><strong>ΣR<sub>rad</sub> {fmt(d.radialResistanceTotal,4)} K·m/W</strong></header>
    <div className="resistance-layout"><table className="kit-resistance-table"><caption className="kit-sr-only">缆体径向层热阻系数</caption><thead><tr><th scope="col">结构层</th><th scope="col">K·m/W</th><th scope="col">层间占比</th></tr></thead><tbody>{d.radialResistances.map(item=><tr key={item.label}><th scope="row">{item.label}</th><td>{fmt(item.kMW,5)}</td><td><span className="kit-resistance-track" aria-hidden="true"><i style={{width:`${Math.min(100,item.sharePercent)}%`}}/></span><span>{fmt(item.sharePercent,1)}%</span></td></tr>)}</tbody></table>
     <div className="soil-coupling"><article><small>土壤自热系数 · G<sub>ii</sub></small><strong>{fmt(d.soilSelfKMW,4)}</strong><span>K·m/W</span></article><article><small>邻相互热系数和 · ΣG<sub>ij</sub></small><strong>{fmt(d.soilMutualKMW,4)}</strong><span>K·m/W</span></article><article><small>{d.stateLabel}热平衡残差</small><strong>{residualText}</strong><span>K</span></article></div>
    </div><footer>土壤矩阵系数不是实际温升，不能直接与层热阻相加冒充完整 IEC 60287 热阻链。</footer>
   </section>
   <section className="diagnosis-study" aria-labelledby="sensitivity-title"><EngineeringIcon name="workflow" size={34}/><div><span>诊断 → 验证</span><h3 id="sensitivity-title">土壤敏感性研究</h3><p>只预填研究任务，仍需生成计划、人工审查与批准。扫描不修改当前敷设参数。</p><code>{sweepTask}</code></div><KitButton icon="chart" aria-label="创建土壤敏感性扫描任务" onClick={()=>{onClose();openAgent(sweepTask)}}>创建扫描任务 <ArrowRight size={14}/></KitButton></section>
   <details className="kit-evidence" data-testid="kit-evidence"><summary><EngineeringIcon name="database" size={30}/><span><b>证据链</b><small>输入指纹、R20 来源与运行记录</small></span><span>{w.sources.length} 份资料</span></summary><dl>
    <div><dt>当前工程</dt><dd>rev.{w.revision}</dd></div><div><dt>计算记录</dt><dd>{runLabel}{run?` · rev.${run.revision}`:' · 版本信息未提供'}</dd></div>
    <div className="kit-evidence-hash"><dt>输入 SHA-256</dt><dd><code data-testid="kit-input-sha">{result.input_sha256}</code></dd></div>
    <div><dt><EngineeringIcon name="lab" size={21}/>R20 来源</dt><dd>{d.r20Basis}</dd></div><div><dt><EngineeringIcon name="locked" size={22}/>参数锁</dt><dd>{w.locks.length} 项 · 当前工程</dd></div>
    <div><dt>方法引用</dt><dd>{result.sources.length} 条</dd></div><div><dt>计算时间</dt><dd>{new Date(result.computed_at).toLocaleString()}</dd></div>
   </dl></details>
   <details className="kit-boundaries"><summary><EngineeringIcon name="warning" size={26}/><b>适用范围与警告</b><span>{result.warnings.length} 条</span></summary><ul>{result.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>
   <footer className="diagnosis-actions"><span>研究模型 · 结果解释不替代工程签审</span><div><KitButton icon="edit" onClick={()=>jump('documents')}>参数依据</KitButton><KitButton tone="blue" className="primary" icon="document" onClick={()=>jump('history')}>打开计算记录 <ArrowRight size={14}/></KitButton></div></footer>
  </div>
 </dialog>;
}
