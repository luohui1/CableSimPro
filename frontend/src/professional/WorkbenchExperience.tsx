import {useEffect,useId,useState,type ReactNode} from 'react';
import {Activity,ArrowRight,BookOpen,Box,ChartNoAxesCombined,ChevronDown,ChevronUp,Copy,FileText,FolderOpen,Layers3,Search,Settings2,ShieldCheck,Workflow,X} from 'lucide-react';
import {useStudio} from '../StudioState';
import {WorkbenchAnalysis,WorkbenchEvidence,WorkbenchMetrics} from './WorkbenchChrome';
import {ResultsPanel} from '../StudioPanels';
import SweepStudyPanel from '../SweepStudyPanel';
import type {WorkbenchCommandId} from './workbenchCommands';

export function WorkbenchCommandBar({onHome,onAgent,onCommand,onSearch,statusContent}:{onHome:()=>void;onAgent:()=>void;onCommand:(id:WorkbenchCommandId)=>void;onSearch:()=>void;statusContent?:ReactNode}){
 const s=useStudio(),dirty=Object.keys(s.inputDrafts).length,busy=s.busy,w=s.w!;
 const blocked=dirty>0||busy;
 const buried=(w.design_basis?.environment??'buried')==='buried';
 const state=dirty?'输入待提交':busy?'工程操作进行中':'当前输入已保存';
 return <header className="ps-commandbar dual-header" aria-label="工程命令栏">
  <button className="ps-brand" onClick={onHome} aria-label="返回模式选择"><span>C</span><b>CableSim<strong>Pro</strong></b></button>
  <button className="wb-project-card ps-project" onClick={()=>onCommand('projects')} aria-label="打开工程中心"><FolderOpen size={17}/><span><b>{w.scenario.name}</b><small>当前工程 · 打开其他方案</small></span><ChevronDown size={14}/></button>
  <span className="ps-revision" data-testid="session-revision"><code data-testid="revision">rev.{w.revision}</code></span>
  <details className="wb-context-disclosure ps-context"><summary><i className={dirty?'is-dirty':busy?'is-busy':''}/><span data-testid="workbench-save-state">{state}</span><ChevronDown size={12}/></summary><div className="ps-context-content"><h2>输入与计算状态</h2>{statusContent}</div></details>
  <button className="ps-search-trigger" onClick={onSearch} aria-label="搜索命令"><Search size={17}/><span>搜索命令</span><kbd>Ctrl K</kbd></button>
  <nav className="mode-switch ps-modes" aria-label="工作模式"><button aria-pressed={true}><Box size={16}/><span>专业工作台</span></button><button aria-pressed={false} onClick={onAgent}><Workflow size={16}/><span>智能工程流</span></button></nav>
  <div className="ps-command-actions"><button className="ps-icon-button" aria-label="另存方案" title="另存方案" disabled={blocked} onClick={()=>onCommand('fork')}><Copy size={16}/></button><button className="ps-primary" aria-label={buried?'计算载流量':'配置竖向研究'} disabled={blocked} onClick={()=>onCommand(buried?'run':'fields')}><span aria-hidden="true">▷</span>{busy?'正在计算':'运行计算'}</button><button className="ps-icon-button" aria-label="双模式服务设置" title="服务接入设置" onClick={()=>onCommand('settings')}><Settings2 size={17}/></button></div>
 </header>;
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
  <details className="ps-resource-menu"><summary aria-label="工程资源"><BookOpen size={20}/><span>资源</span></summary><div><b>工程资源</b>{([['products','产品型号'],['documents','企业资料'],['methods','方法验证'],['journal','任务与引用'],['json','导出工程参数']] as const).map(([id,label])=><button key={id} onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');onCommand(id)}}>{label}<ArrowRight size={13}/></button>)}</div></details>
  <button className="ps-rail-settings" aria-label="服务接入设置" title="服务接入设置" onClick={()=>onCommand('settings')}><Settings2 size={20}/><span>设置</span></button>
 </nav>;
}
export function ResultRibbon({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}){
 const s=useStudio();return <div className="ps-result-ribbon" aria-label="当前结果摘要"><WorkbenchMetrics/><div className="ps-result-actions"><button className="ps-analysis-toggle" aria-expanded={open} aria-controls="workbench-analysis-drawer" onClick={()=>onOpenChange(!open)}>{open?'收起分析':'查看分析'}{open?<ChevronDown size={16}/>:<ChevronUp size={16}/>}</button><button className="ps-report" aria-label="导出计算书" title="导出当前计算书" disabled={s.busy||!s.current} onClick={()=>void s.report()}><FileText size={16}/><span>计算书</span></button></div></div>;
}
export function AnalysisDrawer({open,onClose,onCommand}:{open:boolean;onClose:()=>void;onCommand:(id:WorkbenchCommandId)=>void}){
 const s=useStudio();const [tab,setTab]=useState('overview');const heading=useId();
 useEffect(()=>{if(s.currentSweep)setTab('sweep')},[s.currentSweep]);
 const tabs=[['overview','概览'],['tables','结果表与曲线'],['sweep','扫描研究'],['evidence','运行证据']];
 return <section id="workbench-analysis-drawer" className="ps-analysis-drawer" hidden={!open} aria-labelledby={heading}>
  <header><h2 id={heading}>结果分析</h2><nav aria-label="分析内容">{tabs.map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav><button className="ps-icon-button" aria-label="关闭结果分析" onClick={onClose}><X size={18}/></button></header>
  <div className="ps-analysis-scroll">
   {tab==='overview'&&(s.current?<WorkbenchAnalysis/>:<div className="ps-empty"><Activity size={28}/><h3>{s.currentSweep?'本次为参数扫描':'尚无当前版本的单工况结果'}</h3><p>{s.currentSweep?'打开“扫描研究”查看全部离散工况。':'执行计算后显示实际曲线与结果，不显示设计稿中的示例值。'}</p>{s.currentSweep&&<button onClick={()=>setTab('sweep')}>查看扫描研究</button>}</div>)}
   {tab==='tables'&&<ResultsPanel embedded/>}
   {tab==='sweep'&&(s.currentSweep?<SweepStudyPanel key={s.output?.run_id}/>:<div className="ps-empty"><h3>当前版本尚无参数扫描</h3><p>在命令中心选择土壤、温度、埋深或间距研究，填写明确扫描点，审查后执行。</p><button onClick={()=>onCommand('temperature-sweep')}>准备环境温度研究</button></div>)}
   {tab==='evidence'&&<div className="ps-run-evidence"><ShieldCheck size={24}/><h3>{s.outputCurrent?'当前运行证据':'暂无可用于当前版本的运行证据'}</h3>{s.outputCurrent&&<dl><dt>工程版本</dt><dd>rev.{s.w?.revision}</dd><dt>运行编号</dt><dd>{s.output?.run_id}</dd><dt>运行输入摘要</dt><dd>{s.w?.runs.find(r=>r.id===s.output?.run_id)?.input_hash}</dd>{s.current&&<><dt>模型版本</dt><dd>{s.current.model_version}</dd><dt>计算时间</dt><dd>{s.current.computed_at}</dd></>}</dl>}<p>运行绑定用于追溯，不是认证签名。历史记录不能冒充当前结果。</p><button onClick={()=>onCommand('history')}>查看历史运行</button><WorkbenchEvidence onMethods={()=>onCommand('methods')} onDocuments={()=>onCommand('documents')}/></div>}
  </div>
 </section>;
}
