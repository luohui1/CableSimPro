import {ScrollRegion} from '../design-system/WorkspacePage';
import type {AnalysisMode} from './analysisLayout';
import {useEffect,useId,useState,type ReactNode} from 'react';
import {Activity,ArrowRight,BookOpen,Box,ChartNoAxesCombined,ChevronDown,ChevronUp,Copy,FileText,FolderOpen,Layers3,Search,Settings2,ShieldCheck,Workflow,X,Play,CircleHelp,ChevronRight,MoreHorizontal,Maximize2,PanelBottom} from 'lucide-react';
import {useStudio} from '../StudioState';
import {WorkbenchAnalysis,WorkbenchEvidence,WorkbenchMetrics} from './WorkbenchChrome';
import {ResultsPanel} from '../StudioPanels';
import SweepStudyPanel from '../SweepStudyPanel';
import type {WorkbenchCommandId} from './workbenchCommands';

export function WorkbenchCommandBar({onHome,onAgent,onCommand,onSearch,statusContent}:{onHome:()=>void;onAgent:()=>void;onCommand:(id:WorkbenchCommandId)=>void;onSearch:()=>void;statusContent?:ReactNode}){
 const s=useStudio(),dirty=Object.keys(s.inputDrafts).length,busy=s.busy,w=s.w!;
 const state=dirty?'输入待提交':busy?'工程操作进行中':'当前输入已保存';
 const buried=(w.design_basis?.environment??'buried')==='buried';
 return <header className="ps-commandbar dual-header" aria-label="工程命令栏">
  <button className="ps-brand" onClick={onHome} aria-label="返回模式选择"><span>C</span><b>CableSim<strong>Pro</strong></b></button>
  <button className="ps-project" onClick={()=>onCommand('projects')} aria-label="打开工程中心"><FolderOpen size={16}/><b>{w.scenario.name}</b><ChevronDown size={13}/></button>
  <details className="ps-context"><summary><i className={dirty?'is-dirty':busy?'is-busy':''}/><span data-testid="workbench-save-state">{state}</span><span className="ps-revision" data-testid="session-revision"><code data-testid="revision">rev.{w.revision}</code></span><ChevronDown size={12}/></summary><div className="ps-context-content"><h2>输入与计算状态</h2>{statusContent}</div></details>
  <button className="ps-search-trigger" onClick={onSearch} aria-label="搜索命令"><Search size={16}/><span>搜索命令</span><kbd>Ctrl+K</kbd></button>
  <nav className="mode-switch ps-modes" aria-label="工作模式"><button aria-pressed={true}><Box size={16}/><span>专业工作台</span></button><button aria-pressed={false} onClick={onAgent}><Workflow size={16}/><span>智能工程流</span></button></nav>
  <button className="ps-primary pc-run" aria-label={buried?'计算载流量':'配置竖向研究'} disabled={busy||dirty>0} onClick={()=>onCommand(buried?'run':'fields')}><Play size={15}/><span>{busy?'正在处理':buried?'运行计算':'竖向研究'}</span></button>
  <details className="pc-command-more"><summary aria-label="更多工程操作"><MoreHorizontal size={19}/></summary><div>{([['fork','另存方案'],['report','生成计算书'],['study-preflight','研究准备'],['methods','方法与适用范围'],['settings','服务接入设置']] as const).map(([id,label])=><button key={id} onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');onCommand(id)}}>{label}<ArrowRight size={14}/></button>)}</div></details>
 </header>;
}
/** Status is distinct from the sole primary compute action in the command bar. */
export function WorkbenchStatusBar({onCommand,library=false}:{onCommand:(id:WorkbenchCommandId)=>void;library?:boolean}){
 const s=useStudio(),w=s.w!;const dirty=Object.keys(s.inputDrafts).length>0;
 return <footer className="ref-status-footer" aria-label="工程运行状态"><div className="ref-status-context"><span>{library?'本机资产库 · 不改动当前工况':`${w.scenario.cable.conductor==='copper'?'Cu':'Al'} ${w.scenario.cable.area_mm2} mm² · 单芯电缆`}</span><span>{library?'定义与结果独立保存':`环境 ${w.scenario.installation.ambient_temperature_c} °C`}</span><button onClick={()=>onCommand('methods')}>方法与适用范围</button></div><div className="ref-runtime-actions"><span className={dirty?'ref-state-warning':''}><i/>{dirty?'有未提交输入':s.busy?'工程操作进行中':s.current?'当前结果有效':'本机工程服务'}</span><kbd>F9 计算</kbd></div></footer>;
}
const railItems=[
 {id:'model',match:'cable',label:'结构',name:'电缆结构',Icon:Layers3},
 {id:'installation',match:'installation',label:'敷设',name:'敷设与负荷',Icon:Box},
 {id:'fields',match:'fields',label:'场研究',name:'场计算',Icon:Activity},
 {id:'selection',match:'selection',label:'选型',name:'候选选型',Icon:ChartNoAxesCombined},
 {id:'history',match:'history',label:'记录',name:'计算记录',Icon:FileText},
] as const;
export function WorkspaceRail({area,view,onCommand}:{area:string;view:string;onCommand:(id:WorkbenchCommandId)=>void}){
 return <nav className="wb-navigation ps-rail" aria-label="应用导航"><button aria-label="打开工程中心" title="工程中心" onClick={()=>onCommand('projects')}><FolderOpen size={21}/><span>工程</span></button>
  <div className="ps-rail-main">{railItems.map(({id,match,label,name,Icon})=><button key={id} aria-label={name} title={name} aria-current={area==='engineering'&&view===match?'page':undefined} onClick={()=>onCommand(id)}><Icon size={21}/><span>{label}</span></button>)}</div>
  <button aria-label="工程资产库" title="工程资产库" aria-current={area==='assets'?'page':undefined} onClick={()=>onCommand('assets')}><Layers3 size={20}/><span>资产</span></button>
  <details className="ps-resource-menu"><summary aria-label="工程资源"><BookOpen size={20}/><span>资源</span></summary><div><b>工程资源</b>{([['assets','工程资产库'],['products','产品型号'],['documents','企业资料'],['methods','方法验证'],['journal','任务与引用'],['json','导出工程参数']] as const).map(([id,label])=><button key={id} onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');onCommand(id)}}>{label}<ArrowRight size={13}/></button>)}</div></details>
  <button className="ps-rail-settings" aria-label="服务接入设置" title="服务接入设置" onClick={()=>onCommand('settings')}><Settings2 size={20}/><span>设置</span></button>
 </nav>;
}
export function ResultRibbon({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}){
 const s=useStudio();return <section className="ps-result-ribbon" aria-label="当前结果摘要"><div className="ref-result-title"><h2>计算结果概览</h2><p>{s.current?'当前模型与工况的计算结果':s.currentSweep?'当前为离散参数研究':s.output?'输入已变化，需重新计算':'执行计算后显示真实结果'}</p></div><WorkbenchMetrics/><div className="ps-result-actions"><button className="ps-analysis-toggle" aria-expanded={open} aria-controls="workbench-analysis-drawer" onClick={()=>onOpenChange(!open)}>{open?'收起分析':'查看分析'}{open?<ChevronDown size={17}/>:<ArrowRight size={17}/>}</button><button className="ps-report" aria-label="导出计算书" title="导出当前计算书" disabled={s.busy||!s.current} onClick={()=>void s.report()}><FileText size={17}/><span>下载计算书</span></button></div></section>;
}
export function AnalysisDrawer({open,onClose,onCommand,mode='split',onModeChange}:{open:boolean;onClose:()=>void;onCommand:(id:WorkbenchCommandId)=>void;mode?:AnalysisMode;onModeChange?:(mode:AnalysisMode)=>void}){
 const s=useStudio();const [tab,setTab]=useState('overview');const heading=useId();
 useEffect(()=>{if(s.currentSweep)setTab('sweep')},[s.currentSweep]);
 const tabs=[['overview','概览'],['tables','结果表与曲线'],['sweep','扫描研究'],['evidence','运行证据']];
 return <section id="workbench-analysis-drawer" className="ps-analysis-drawer" data-mode={mode} hidden={!open} aria-labelledby={heading}>
  <header><h2 id={heading}>结果分析</h2><nav aria-label="分析内容">{tabs.map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav><button className="ps-icon-button" aria-label={mode==='full'?'切换分屏分析':'展开完整分析'} title={mode==='full'?'切换分屏（较矮屏幕保持完整分析）':'完整分析工作区'} onClick={()=>onModeChange?.(mode==='full'?'split':'full')}>{mode==='full'?<PanelBottom size={17}/>:<Maximize2 size={17}/>}</button><button className="ps-icon-button" aria-label="关闭结果分析" onClick={onClose}><X size={18}/></button></header>
  <ScrollRegion label="结果分析内容" className="ps-analysis-scroll">
   {tab==='overview'&&(s.current?<WorkbenchAnalysis/>:<div className="ps-empty"><Activity size={28}/><h3>{s.currentSweep?'本次为参数扫描':'尚无当前版本的单工况结果'}</h3><p>{s.currentSweep?'打开“扫描研究”查看全部离散工况。':'执行计算后显示实际曲线与结果，不显示设计稿中的示例值。'}</p>{s.currentSweep&&<button onClick={()=>setTab('sweep')}>查看扫描研究</button>}</div>)}
   {tab==='tables'&&<ResultsPanel embedded/>}
   {tab==='sweep'&&(s.currentSweep?<SweepStudyPanel key={s.output?.run_id}/>:<div className="ps-empty"><h3>当前版本尚无参数扫描</h3><p>在命令中心选择土壤、温度、埋深或间距研究，填写明确扫描点，审查后执行。</p><button onClick={()=>onCommand('temperature-sweep')}>准备环境温度研究</button></div>)}
   {tab==='evidence'&&<div className="ps-run-evidence"><ShieldCheck size={24}/><h3>{s.outputCurrent?'当前运行证据':'暂无可用于当前版本的运行证据'}</h3>{s.outputCurrent&&<dl><dt>工程版本</dt><dd>rev.{s.w?.revision}</dd><dt>运行编号</dt><dd>{s.output?.run_id}</dd><dt>运行输入摘要</dt><dd>{s.w?.runs.find(r=>r.id===s.output?.run_id)?.input_hash}</dd>{s.current&&<><dt>模型版本</dt><dd>{s.current.model_version}</dd><dt>计算时间</dt><dd>{s.current.computed_at}</dd></>}</dl>}<p>运行绑定用于追溯，不是认证签名。历史记录不能冒充当前结果。</p><button onClick={()=>onCommand('history')}>查看历史运行</button><WorkbenchEvidence onMethods={()=>onCommand('methods')} onDocuments={()=>onCommand('documents')}/></div>}
  </ScrollRegion>
 </section>;
}
