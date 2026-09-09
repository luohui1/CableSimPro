import {Activity,ArrowRight,BookOpen,Box,ClipboardCheck,FileText,FolderOpen,Layers3,Settings2,ShieldCheck,Thermometer,Zap} from 'lucide-react';
import type {ReactNode} from 'react';
import {useStudio} from '../StudioState';
import {fmt} from '../utils';
import {EngineeringChart} from '../ScientificChart';
import {Badge,Button,MetricTile,Panel} from '../design-system/primitives';

export function WorkbenchBanner(){return <div className="wb-brand-scene"><div><b>连接工程 · 让设计更清晰</b><span>FROM STRUCTURE TO EVIDENCE</span></div><img src="/engineering/white-workbench/mountain-detail.webp" alt="" aria-hidden="true" width="348" height="134" onError={e=>{e.currentTarget.hidden=true}}/></div>}
export function WorkbenchContext({children}:{children:ReactNode}){
 const s=useStudio();
 const dirty=Object.keys(s.inputDrafts).length;
 const stale=!!s.output&&!s.current&&!s.currentSweep&&!s.outputCurrent;
 return <details className="wb-context-disclosure"><summary><span><ShieldCheck size={14}/>输入与计算状态</span><Badge tone={dirty||stale?'warning':s.current?'success':'neutral'}>{dirty?`${dirty} 项输入未提交`:s.proposal?.ready?'有待审查提案':s.busy?'工程工具执行中':s.current?'结果可复核':s.currentSweep?'扫描结果可复核':stale?'结果已失效':'尚未计算'}</Badge><span className="wb-context-hint">展开依据与状态</span></summary>{children}</details>;
}
const navItems=[
 {key:'engineering:cable',label:'电缆结构',section:'专业工作台',Icon:Layers3},
 {key:'engineering:installation',label:'敷设与负荷',Icon:Box},
 {key:'engineering:fields',label:'场计算',Icon:Activity},
 {key:'engineering:selection',label:'候选选型',Icon:ClipboardCheck},
 {key:'products',label:'产品型号',section:'工程数据',Icon:Layers3},
 {key:'documents',label:'企业资料',Icon:FileText},
 {key:'methods',label:'方法验证',Icon:BookOpen},
 {key:'engineering:history',label:'计算记录',section:'结果与追溯',Icon:FileText},
 {key:'engineering:journal',label:'任务与引用',Icon:BookOpen},
];
export function WorkbenchNavigation({area,view,blocked,onNavigate,onProjects}:{area:string;view:string;blocked:boolean;onNavigate:(key:string)=>void;onProjects:()=>void}){
 const s=useStudio(),w=s.w!;
 return <><button className="wb-project-card" onClick={onProjects} disabled={blocked}><FolderOpen size={21}/><span><b>{w.scenario.name}</b><small>当前工程 · 打开其他方案</small></span></button><nav className="wb-navigation" aria-label="应用导航">{navItems.map(({key,label,section,Icon})=><div key={key}>{section&&<span className="wb-nav-section">{section}</span>}<button aria-current={key===(area==='engineering'?`${area}:${view}`:area)?'page':undefined} onClick={()=>onNavigate(key)}><Icon size={17}/><span>{label}</span></button></div>)}</nav><div className="wb-rail-bottom"><div className="wb-sidebar-scene"><span>从结构到结果<br/>每一步，都有依据</span><img src="/engineering/white-workbench/mountain-detail.webp" alt="" aria-hidden="true" width="348" height="134" onError={e=>{e.currentTarget.hidden=true}}/></div><button className="wb-settings-link" onClick={()=>onNavigate('settings')}><Settings2 size={16}/>服务接入设置<ArrowRight size={14}/></button><small>本机研究模型 · 非最终工程签审</small></div></>;
}
export function WorkbenchMetrics(){
 const s=useStudio(),r=s.current,w=s.w!;
 const loss=r?.summary.circuit_loss_kw??null,temp=r?.summary.operating_max_temperature_c??null,margin=r?.summary.thermal_margin_c??null;
 // These four tiles use current-run output, never design mockup example values.
 return <section className={`wb-results-overview ${r?'enterprise-result-summary':''}`} aria-label="计算结果概览" data-testid="workbench-metrics"><div className="wb-results-heading"><h2>计算结果与分析</h2><Badge tone={r?'info':'neutral'}>{r?'当前版本 · 研究结果':s.currentSweep?'扫描结果见下方':s.output?'输入已变化 · 需重新计算':'待运行计算'}</Badge></div><div className="wb-metric-grid">
  <MetricTile label="允许载流量" value={fmt(r?.summary.ampacity_a)} unit="A" icon={<Zap size={21}/>} detail={r?`限制相 ${r.summary.limiting_phase}`:'由当前工况求解'}/>
  <MetricTile label="最高导体温度" value={fmt(temp)} unit="°C" icon={<Thermometer size={21}/>} detail={r?`运行电流 ${fmt(w.scenario.operating_current_a,0)} A`:'尚无有效运行结果'}/>
  <MetricTile label="导体温度余量" value={fmt(margin)} unit="K" icon={<ShieldCheck size={21}/>} tone={margin!==null&&margin<0?'danger':'neutral'} detail={`限温 ${w.scenario.cable.max_temperature_c} °C − 运行温度`}/>
  <MetricTile label="线路总损耗" value={fmt(loss,2)} unit="kW" icon={<Activity size={21}/>} detail={`三相合计 · 线路 ${fmt(w.scenario.circuit_length_m,0)} m`}/>
 </div>{r?.operating_error&&<p className="wb-operating-error" role="status">当前运行电流无有效运行解，温度、余量与损耗留空；载流量额定值独立保留。</p>}</section>;
}
export function WorkbenchEvidence({onMethods,onDocuments}:{onMethods:()=>void;onDocuments:()=>void}){
 const s=useStudio();return <details className="wb-evidence"><summary><BookOpen size={16}/><b>计算依据与说明</b><span>{s.w!.sources.length} 份已确认节选 · 研究模型</span></summary><div><p>当前电缆尺寸来自工程参数；结构外观不是制造图。直埋结果采用既有热网络与三相互热模型，不等同于完整 IEC 60287 或有限元认证。</p><p>厂家 R20、材料物性与损耗系数应按实际资料核对；缺少依据不自动替换成“符合要求”。</p><Button onClick={onMethods}>检查设计依据</Button><Button onClick={onDocuments}>核对资料来源</Button></div></details>;
}

export function WorkbenchAnalysis(){
 const s=useStudio(),r=s.current;
 if(!r)return null;
 const phase=Math.max(0,Math.min(2,s.phase));
 const profile=r.operating?.radial_profiles[phase];
 const rows=[['允许载流量',fmt(r.summary.ampacity_a),'A'],['运行最高温度',fmt(r.summary.operating_max_temperature_c),'°C'],['导体温度余量',fmt(r.summary.thermal_margin_c),'K'],['线路三相总损耗',fmt(r.summary.circuit_loss_kw,2),'kW']];
 return <section className="wb-analysis-grid" aria-label="运行结果分析"><Panel title={`径向温度 · ${'ABC'[phase]} 相`} className="wb-radial-panel">{profile?<EngineeringChart label="当前运行径向温度曲线" xLabel="半径 / mm" yLabel="温度 / °C" height={200} series={[{name:'运行温度',points:profile.points.map(p=>[p.radius_mm,p.temperature_c])}]} threshold={r.input.cable.max_temperature_c}/>:<p className="wb-unavailable">当前运行工况无有效温度解，未绘制示例曲线。</p>}</Panel><Panel title="关键结果数据"><table className="wb-result-table"><thead><tr><th>项目</th><th>数值</th><th>单位</th></tr></thead><tbody>{rows.map(([name,value,unit])=><tr key={name}><th scope="row">{name}</th><td>{value}</td><td>{unit}</td></tr>)}</tbody></table><p className="wb-trace-note">{r.model_version}<br/>输入摘要 {r.input_sha256.slice(0,12)}… · rev.{s.w!.revision}</p></Panel></section>;
}
