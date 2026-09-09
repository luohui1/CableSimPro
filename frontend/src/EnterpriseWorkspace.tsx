import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Activity,ArrowRight,BookOpen,Box,Check,ChevronRight,ClipboardCheck,Copy,FileText,FolderOpen,Layers3,Menu,MessageSquare,Maximize2,Minimize2,PanelRightClose,PanelRightOpen,Play,Plus,Settings2,Undo2,X} from 'lucide-react';
import {StudioProvider,useStudio} from './StudioState';
import {Inspector,GroupedInspector,ResultsPanel} from './StudioPanels';
import {Modal,ModelGenerator,StandardsPanel,TaskJournal} from './EngineeringPanels';
import {LibraryPanel,IntegrationsPanel} from './LibraryDesignPanels';
import {FieldPanel} from './DomainPanels';
import {InlineResults} from './WorkspaceInteraction';
import EngineeringViewport from './engineering-visuals/EngineeringViewport';
import CableModelView from './CableModelView';
import EngineeringCanvas from './EngineeringCanvas';
import InstallationModel from './InstallationModel';
import {EngineeringTask,ProductLibrary,ReviewedSelection} from './EnterprisePanels';
import {api,errorText,fmt} from './utils';
import './enterprise.css';
import {WorkbenchCommandBar,WorkspaceRail,ResultRibbon,AnalysisDrawer} from './professional/WorkbenchExperience';
import CommandPalette from './professional/CommandPalette';
import {WORKBENCH_COMMANDS,commandBlockReason,type WorkbenchCommandId} from './professional/workbenchCommands';
import {Button} from './design-system/primitives';
import {DisclosureSettings} from './design-system/DisclosureGroup';
interface Assessment {revision:number;domain:string;product_reference:null|{name:string;code:string;version:number;aligned:boolean;is_current_reviewed:boolean;lifecycle:string;changed_fields:string[]};findings:{code:string;message:string;target:string}[];scope:string}
type Area='engineering'|'products'|'documents'|'methods'|'settings';
type View='cable'|'installation'|'fields'|'selection'|'history'|'journal';
const views:{id:View;name:string;icon:typeof Box}[]=[{id:'cable',name:'电缆结构',icon:Layers3},{id:'installation',name:'敷设与负荷',icon:Box},{id:'fields',name:'场计算',icon:Activity},{id:'selection',name:'候选选型',icon:ClipboardCheck},{id:'history',name:'计算记录',icon:FileText},{id:'journal',name:'任务与引用',icon:BookOpen}];
export function EnterpriseWorkbench({embedded=false,active=true,onAgent,requestedView,onHome,statusContent}:{embedded?:boolean;active?:boolean;onAgent?:(text:string)=>void;requestedView?:{view:string;serial:number};onHome?:()=>void;statusContent?:ReactNode}){
 const s=useStudio(),w=s.w;
 const [area,setArea]=useState<Area>('engineering'),[view,setView]=useState<View>('cable'),[properties,setProperties]=useState(true),[propertySection,setPropertySection]=useState('cable'),[installationView,setInstallationView]=useState('2d');
 const [focused,setFocused]=useState(false),[commandOpen,setCommandOpen]=useState(false);
 const [canvasRequest,setCanvasRequest]=useState({view:'model' as 'model'|'section'|'temperature'|'curve',serial:0});
 const [inspectedLayer,setInspectedLayer]=useState<number|null>(null),[inspectionSerial,setInspectionSerial]=useState(0);
 const commandOpener=useRef<HTMLElement|null>(null);
 function openCommands(){commandOpener.current=document.activeElement as HTMLElement;setCommandOpen(true)}
 const [taskOpen,setTaskOpen]=useState(false),[taskText,setTaskText]=useState(''),[resultsOpen,setResultsOpen]=useState(false),[generator,setGenerator]=useState(false),[navOpen,setNavOpen]=useState(false),[catalogRevision,setCatalogRevision]=useState(0);
 const [assessment,setAssessment]=useState<Assessment|null>(null),[error,setError]=useState(''),[projectOpen,setProjectOpen]=useState(false),[projects,setProjects]=useState<{id:string;name:string;revision:number}[]>([]),[forkOpen,setForkOpen]=useState(false),[forkName,setForkName]=useState(''),[localBusy,setLocalBusy]=useState(false);
 const changed=Object.keys(s.inputDrafts).length>0,blocked=s.busy||localBusy||changed;
 const taskRef=useRef<HTMLDivElement>(null);
 const previousProposal=useRef(s.proposal?.id);
 useEffect(()=>{if(embedded&&active&&s.proposal?.id&&s.proposal.id!==previousProposal.current)onAgent?.('');previousProposal.current=s.proposal?.id},[s.proposal?.id]);
 useEffect(()=>{if(w){let canceled=false;void api<Assessment>(`/api/enterprise/workspaces/${w.id}/assessment`).then(r=>{if(!canceled)setAssessment(r)}).catch(e=>{if(!canceled)setError(errorText(e))});return()=>{canceled=true}}},[w?.id,w?.revision,catalogRevision]);
 useEffect(()=>{s.select('cable')},[]);
 useEffect(()=>{if(s.proposal?.ready)setTaskOpen(true)},[s.proposal]);
 useEffect(()=>{if((!embedded&&s.current)||s.currentSweep)setResultsOpen(true)},[s.current,s.currentSweep]);
 useEffect(()=>{setTaskOpen(false);setTaskText('');setResultsOpen(false);setAssessment(null);setInspectedLayer(null);setCommandOpen(false)},[w?.id]);
 useEffect(()=>{if(s.tab==='results'){setArea('engineering');setView('history')}},[s.tab]);
 function openTask(text=''){if(embedded&&onAgent){onAgent(text);return}setTaskText(text);setTaskOpen(true);requestAnimationFrame(()=>taskRef.current?.scrollIntoView({block:'nearest'}))}
 function navigate(next:View){setArea('engineering');setView(next);setNavOpen(false);if(next==='cable'){s.select('cable');setPropertySection('cable')}if(next==='installation'){s.select('installation');setPropertySection('installation')}if(next==='history')s.setTab('runs')}
 const isBuried=(w?.design_basis?.environment??'buried')==='buried';
 useEffect(()=>{function key(e:KeyboardEvent){
  if(!active||e.defaultPrevented||e.isComposing||e.keyCode===229)return;
  const target=e.target as HTMLElement;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(embedded){if(commandOpen)setCommandOpen(false);else openCommands()}else openTask();return}
  if(target.closest('[role="dialog"]'))return;
  if(e.key==='Escape'){
   const disclosure=document.querySelector('.ps-workbench details[open]');
   if(disclosure){disclosure.removeAttribute('open');(disclosure.querySelector('summary') as HTMLElement)?.focus();return}
   if(commandOpen)return;
   if(resultsOpen&&embedded){setResultsOpen(false);return}
   setTaskOpen(false);setNavOpen(false);setFocused(false);
  }
  if(['INPUT','TEXTAREA','SELECT'].includes(target.tagName)||target.isContentEditable)return;
  if(e.key==='F9'&&area==='engineering'&&['cable','installation'].includes(view)&&isBuried&&!blocked){e.preventDefault();void s.run()}
 }window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[blocked,area,view,isBuried,s.run,active,embedded,commandOpen,resultsOpen]);
 async function openProjects(){setError('');try{setProjects(await api('/api/workspaces'));setProjectOpen(true)}catch(e){setError(errorText(e))}}
 async function fork(){if(!w||blocked)return;setLocalBusy(true);setError('');try{const r=await api<{id:string}>(`/api/enterprise/workspaces/${w.id}/fork`,{expected_revision:w.revision,name:forkName});await s.load(r.id);setForkOpen(false)}catch(e){setError(errorText(e))}finally{setLocalBusy(false)}}
 function proposalReady(){if(embedded&&onAgent){onAgent('');return}setArea('engineering');setTaskOpen(true);requestAnimationFrame(()=>taskRef.current?.scrollIntoView({block:'nearest'}))}
 useEffect(()=>{if(requestedView){if(['settings','methods','documents','products'].includes(requestedView.view))setArea(requestedView.view as Area);else if(views.some(v=>v.id===requestedView.view))navigate(requestedView.view as View)}},[requestedView?.serial]);
 const commandState={busy:s.busy||localBusy,dirty:changed,buried:isBuried,current:!!s.current,canUndo:!!w?.can_undo};
 function executeCommand(id:WorkbenchCommandId){
  const command=WORKBENCH_COMMANDS.find(c=>c.id===id);
  if(!command)return;
  const reason=commandBlockReason(command,commandState);if(reason){setError(reason);return}
  if(id==='run'){void s.run();return}
  if(id==='report'){void s.report();return}
  if(id==='undo'){void s.history('undo');return}
  if(id==='json'){s.exportJSON();return}
  if(id==='fork'){setForkName(w!.scenario.name+' · 方案副本');setForkOpen(true);return}
  if(id==='projects'){void openProjects();return}
  if(id==='generator'){setGenerator(true);return}
  if(id==='analysis'){setResultsOpen(true);return}
  if(id==='parameters'){setFocused(false);setProperties(true);return}
  if(['model','section','temperature','curve'].includes(id)){navigate('cable');setCanvasRequest(r=>({view:id as typeof r.view,serial:r.serial+1}));return}
  if(['installation','fields','selection','history','journal'].includes(id)){navigate(id as View);return}
  if(['products','documents','methods','settings'].includes(id)){setArea(id as Area);setNavOpen(false);return}
  const drafts:Partial<Record<WorkbenchCommandId,string>>={
   'soil-sweep':'比较土壤热阻率 0.8、1.2、1.6 K·m/W 下的载流量',
   'temperature-sweep':'比较环境温度 -10、25、40 °C 下的载流量',
   'depth-sweep':'比较平均中心埋深 0.4、0.8、1.2 m 下的载流量',
   'spacing-sweep':'比较相邻中心间距 0.08、0.12、0.20 m 下的载流量',
  };
  openTask(drafts[id]??'');
 }
 const commandRef=useRef(executeCommand);commandRef.current=executeCommand;
 function chooseCommand(id:WorkbenchCommandId){setCommandOpen(false);requestAnimationFrame(()=>commandRef.current(id))}
 function inspectLayer(index:number){
  setInspectedLayer(index);setInspectionSerial(v=>v+1);setProperties(true);setFocused(false);
  const section=[1,3,4].includes(index)?'materials':'cable';setPropertySection(section);s.select(section);
 }
 if(!w)return <div className="eng-loading"><span className="brand-symbol">C</span><h1>CableSimPro</h1><p>{s.error||'正在打开工程…'}</p>{s.error&&<button onClick={()=>location.reload()}>重新连接</button>}</div>;
 const name=views.find(v=>v.id===view)!.name,reference=assessment?.product_reference;
 const showProperties=properties&&!focused&&area==='engineering'&&['cable','installation'].includes(view);
 return <div className={`enterprise-shell ${embedded?'dual-embedded ps-workbench':''} ${embedded&&focused&&area==='engineering'&&['cable','installation'].includes(view)?'is-focused':''} ${s.current?'has-current-results':''}`}>
 {embedded&&active&&<WorkbenchCommandBar onHome={onHome??(()=>navigate('cable'))} onAgent={()=>openTask()} onCommand={executeCommand} onSearch={openCommands} statusContent={statusContent}/>}
 {!embedded&&<header className="enterprise-masthead"><a className="enterprise-brand" href="#" onClick={e=>{e.preventDefault();navigate('cable')}}><span>C</span><b>CableSimPro<small>电缆设计与验证</small></b></a><nav aria-label="应用导航">{([['engineering','工程设计'],['products','产品型号'],['documents','企业资料'],['methods','方法与验证']] as const).map(([id,label])=><button key={id} aria-current={area===id?'page':undefined} className={area===id?'active':''} onClick={()=>{setArea(id);setNavOpen(false)}}>{label}</button>)}</nav><div className="enterprise-masthead-end"><span>本机研究版 0.6</span><button aria-label="服务接入设置" onClick={()=>setArea('settings')}><Settings2 size={18}/></button></div></header>}
 {!embedded&&<div className="enterprise-projectbar"><button className="enterprise-mobile-menu" aria-label="显示工程目录" onClick={()=>setNavOpen(!navOpen)}><Menu size={18}/></button><button className="enterprise-project-name" disabled={blocked} onClick={()=>void openProjects()}><FolderOpen size={16}/><b>{w.scenario.name}</b><ChevronRight size={14}/></button><code data-testid="revision">rev.{w.revision}</code><span className="enterprise-saved"><Check size={13}/>本机已保存</span><div className="enterprise-project-actions"><button disabled={blocked||!w.can_undo} aria-label="撤销工程修改" onClick={()=>void s.history('undo')}><Undo2 size={16}/></button><button disabled={blocked} onClick={()=>{setForkName(w.scenario.name+' · 方案副本');setForkOpen(true)}}><Copy size={15}/>另存方案</button><button className={taskOpen?'selected':''} aria-expanded={taskOpen} onClick={()=>taskOpen?setTaskOpen(false):openTask()}><MessageSquare size={16}/>{s.proposal?.ready?'审查变更':'设计任务'}{s.proposal?.ready&&<i className="pending-dot"/>}</button></div></div>}
 {((!embedded&&s.error)||error)&&<div role="alert" className="enterprise-error top-error"><span>{(!embedded&&s.error)||error}</span><button aria-label="关闭操作错误" onClick={()=>{s.dismiss();setError('')}}><X size={16}/></button></div>}
 {changed&&<div role="status" className="enterprise-warning draft-status"><span>有 {Object.keys(s.inputDrafts).length} 项参数未提交。不会使用旧值继续计算或批准变更。</span><button onClick={s.discardInputs}>撤销未提交输入</button></div>}
 <div className="enterprise-body"><aside className={`enterprise-outline ${navOpen?'open':''}`} aria-label="当前工程目录">{embedded?<WorkspaceRail area={area} view={view} onCommand={executeCommand}/>:<>{embedded&&<nav className="embedded-global-nav" aria-label="应用导航">{([['engineering','工程设计'],['products','产品型号'],['documents','企业资料'],['methods','方法验证']] as const).map(([id,label])=><button key={id} aria-current={area===id?'page':undefined} className={area===id?'active':''} onClick={()=>{setArea(id);setNavOpen(false)}}>{label}</button>)}</nav>}<div className="outline-heading">当前计算方案</div><div className="outline-product"><Layers3 size={22}/><b>{reference?.code||'自定义电缆'}</b><span>{reference?`引用产品 v${reference.version}`:'未关联企业型号'}</span><small>{reference?(reference.aligned?'参数与引用一致':'项目修改副本'):'当前结构仅为工程输入'}</small></div><nav>{views.map(v=><button key={v.id} className={area==='engineering'&&view===v.id?'active':''} onClick={()=>navigate(v.id)}><v.icon size={17}/><span>{v.name}</span>{area==='engineering'&&view===v.id&&<i/>}</button>)}</nav><div className="outline-boundary"><b>当前计算域</b><p>{isBuried?'三相平衡 · 单回路直埋':'单根隔离 · 竖向空气'}</p><small>方法与全部输入条件共同决定结果。</small><button onClick={()=>setArea('methods')}>检查设计依据 <ArrowRight size={13}/></button></div><div className="outline-bottom"><span><i/>本机计算服务</span><small>研究模型 · 非最终工程签审</small></div></>}</aside>
 {navOpen&&<button className="enterprise-nav-scrim" aria-label="关闭工程目录" onClick={()=>setNavOpen(false)}/>}
 <main className="enterprise-content">
 <div className="enterprise-page" hidden={area!=='engineering'||!['cable','installation'].includes(view)}>{embedded?<header className="ps-view-heading"><div><span>专业工作台 / {isBuried?'单回路直埋':'竖向电热研究'}</span><h1>{name}</h1></div><div><button className="enterprise-mobile-menu" aria-label="显示工程目录" aria-expanded={navOpen} onClick={()=>setNavOpen(v=>!v)}><Menu size={17}/>工程目录</button><button onClick={()=>openTask()}><MessageSquare size={16}/>{s.proposal?.ready?'审查变更':'设计任务'}</button><button aria-label="参数化建模" title="参数化建模" disabled={blocked} onClick={()=>setGenerator(true)}><Plus size={17}/></button><button aria-pressed={focused} aria-label="专注画布" title="专注画布（Esc 恢复）" onClick={()=>setFocused(v=>!v)}>{focused?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button><button aria-label="显示参数检查栏" aria-expanded={showProperties} onClick={()=>{if(focused){setFocused(false);setProperties(true)}else setProperties(v=>!v)}}>{showProperties?<PanelRightClose size={17}/>:<PanelRightOpen size={17}/>}</button></div></header>:<><header className="enterprise-section-heading"><div><span className="eyebrow">{embedded?'专业工作台':'工程设计'} / {isBuried?'持续载流量':'竖向电热研究'}</span><h1>{name}</h1><p>{view==='cable'?'结构、输入和计算结果在同一方案中关联。':'二维精确编辑与三维空间检查共用敷设参数。'}</p></div><div className="enterprise-page-actions">{embedded&&<><Button disabled={blocked||!w.can_undo} aria-label="撤销工程修改" onClick={()=>void s.history('undo')}><Undo2 size={16}/></Button><Button disabled={blocked} onClick={()=>{setForkName(w.scenario.name+' · 方案副本');setForkOpen(true)}}><Copy size={15}/>另存方案</Button><Button disabled={s.busy||!s.current} onClick={()=>void s.report()}><FileText size={15}/>导出计算书</Button></>}{view==='cable'&&<button disabled={blocked} onClick={()=>setGenerator(true)}><Plus size={16}/>参数化建模</button>}{isBuried&&<button className="primary" disabled={blocked} onClick={()=>void s.run()}><Play size={15}/>{s.busy?'正在计算':'计算载流量'}<small>直埋</small></button>}{!isBuried&&<button className="primary" onClick={()=>navigate('fields')}>配置竖向研究</button>}{embedded&&<Button aria-pressed={focused} aria-label="专注画布" title={focused?'退出专注画布（Esc）':'专注画布：暂时收起目录、参数和结果'} onClick={()=>setFocused(value=>!value)}>{focused?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</Button>}<button aria-label="显示参数检查栏" aria-expanded={showProperties} onClick={()=>{if(focused){setFocused(false);setProperties(true)}else setProperties(!properties)}}>{properties?<PanelRightClose size={17}/>:<PanelRightOpen size={17}/>}</button></div></header>
 <div className="wb-model-utilities">{embedded&&<button className="enterprise-mobile-menu" aria-label="显示工程目录" onClick={()=>setNavOpen(!navOpen)}><Menu size={18}/>工程目录</button>}{embedded&&<><code data-testid="revision">rev.{w.revision}</code><span data-testid="workbench-save-state">{changed?'输入待提交':s.busy?'工程操作进行中':'当前输入已保存'}</span><button onClick={()=>openTask()}><MessageSquare size={15}/>{s.proposal?.ready?'审查变更':'设计任务'}</button></>}<details className="wb-secondary-actions" open={!embedded||undefined}><summary>型号、选型与资料</summary><div className="enterprise-task-options"><button onClick={()=>setArea('products')}><Layers3 size={17}/><span>引用企业型号</span><ArrowRight size={13}/></button><button onClick={()=>navigate('selection')}><ClipboardCheck size={17}/><span>按目标电流选型</span><ArrowRight size={13}/></button><button onClick={()=>setArea('documents')}><FileText size={17}/><span>从资料核对参数</span><ArrowRight size={13}/></button></div></details></div>
</>}
 <div className={`enterprise-model-layout ${showProperties?'with-inspector':''}`}><section className="enterprise-model-column"><div hidden={view!=='cable'} className="enterprise-model-stage">{embedded?<EngineeringViewport progressive request={canvasRequest} onInspectLayer={inspectLayer}/>:<CableModelView cable={w.scenario.cable}/>}</div><div hidden={view!=='installation'} className="enterprise-installation-stage"><div className="enterprise-segmented"><button className={installationView==='2d'?'active':''} onClick={()=>setInstallationView('2d')}>二维精确布置</button><button className={installationView==='3d'?'active':''} onClick={()=>setInstallationView('3d')}>三维空间检查</button></div><div className="enterprise-canvas-holder" hidden={installationView!=='2d'}><EngineeringCanvas/></div><div hidden={installationView!=='3d'}><InstallationModel scenario={w.scenario}/></div></div>
 {!embedded&&<div className="enterprise-model-summary"><span><b>{fmt(w.scenario.cable.area_mm2,0)}</b> mm²</span><span>U₀ <b>{w.scenario.cable.u0_kv}</b> kV</span><span>运行电流 <b>{w.scenario.operating_current_a}</b> A</span><span>导体限温 <b>{w.scenario.cable.max_temperature_c}</b> °C</span></div>}
 {!embedded&&<>{s.current&&<div className="enterprise-result-summary"><div><span>允许载流量</span><b>{fmt(s.current.summary.ampacity_a)} <small>A</small></b></div><div><span>运行最高导体温度</span><b>{fmt(s.current.summary.operating_max_temperature_c,2)} <small>°C</small></b></div><div><span>限制对象</span><b>{s.current.summary.limiting_phase} <small>相</small></b></div><button onClick={()=>openTask('比较土壤热阻率 0.8、1.2、1.6 下的载流量')}>研究改进条件 <ArrowRight size={15}/></button></div>}<InlineResults open={resultsOpen} onOpenChange={setResultsOpen}/></>}</section>
 <aside className="enterprise-inspector" hidden={!showProperties} aria-label="方案参数"><header><div><h2>{embedded&&inspectedLayer!==null?['导体属性','导体屏蔽','绝缘属性','绝缘屏蔽','金属屏蔽','护套属性'][inspectedLayer]:'参数检查'}</h2><span>修改经校验后保存</span></div>{embedded&&<button aria-label="收起参数检查器" onClick={()=>setProperties(false)}><X size={17}/></button>}</header><div className="enterprise-property-tabs">{(view==='cable'?[['cable','结构'],['materials','材料'],['study','运行']]:[['installation','敷设'],['study','运行']]).map(([id,label])=><button key={id} className={propertySection===id?'active':''} onClick={()=>{setPropertySection(id);s.select(id)}}>{label}</button>)}</div>{embedded?<DisclosureSettings.Provider value={{initialOpen:['导体与电压','电气与屏蔽','敷设参数','运行与限制'],focusGroup:inspectedLayer===2||inspectedLayer===5?'绝缘与护套':undefined,focusSerial:inspectionSerial}}><GroupedInspector/></DisclosureSettings.Provider>:<Inspector/>}<details className="enterprise-evidence-check" open={!embedded||undefined}><summary>输入依据检查</summary>{assessment?.findings.map(f=><p key={f.code}>{f.message}</p>)}{reference&&!reference.is_current_reviewed&&<p>引用型号已更新或停用，当前方案保留原版本。</p>}<button onClick={()=>setArea('documents')}>核对资料来源 <ArrowRight size={13}/></button></details></aside>
 </div></div>
 <div className="enterprise-page" hidden={area!=='engineering'||view!=='selection'}><ReviewedSelection onPropose={proposalReady} refreshKey={catalogRevision}/></div>
 <div className="enterprise-page existing-panel" hidden={area!=='engineering'||view!=='fields'}><header className="enterprise-section-heading"><div><span className="eyebrow">{embedded?'专业工作台':'工程设计'} / 专项研究</span><h1>场计算</h1><p>每种方法保留独立适用范围；场图不是标准合格标记。</p></div></header><FieldPanel/></div>
 <div className="enterprise-page existing-panel" hidden={area!=='engineering'||view!=='history'}><header className="enterprise-section-heading"><div><span className="eyebrow">输入快照 / 历史结果</span><h1>计算记录</h1><p>历史记录保留原条件，不自动替换成当前参数。</p></div></header><ResultsPanel/></div>
 <div className="enterprise-page existing-panel" hidden={area!=='engineering'||view!=='journal'}><TaskJournal key={w.id+':'+w.revision}/></div>
 <div className="enterprise-page" hidden={area!=='products'}><ProductLibrary key={w.id} onPropose={proposalReady} onChange={()=>setCatalogRevision(r=>r+1)}/></div>
 <div className="enterprise-page existing-panel" hidden={area!=='documents'}><header className="enterprise-section-heading"><div><span className="eyebrow">原件 / 识别 / 参数核对</span><h1>企业资料</h1><p>OCR 输出先核对，再形成工程输入；不会自动成为批准的产品数据。</p></div></header><LibraryPanel/></div>
 <div className="enterprise-page existing-panel" hidden={area!=='methods'}><header className="enterprise-section-heading"><div><span className="eyebrow">方法范围 / 版本 / 验证</span><h1>方法与验证</h1><p>登记标准题录不代表实现全部公式；明确查看适用范围和未实现条款。</p></div></header><StandardsPanel key={w.id+':'+w.revision}/></div>
 <div className="enterprise-page existing-panel" hidden={area!=='settings'}><header className="enterprise-section-heading"><div><span className="eyebrow">本机设置 / 明确授权</span><h1>服务接入</h1><p>密钥只留在服务端。云端资料与模型效果需使用实际服务另行验证。</p></div></header><IntegrationsPanel/></div>
 <div ref={taskRef}><EngineeringTask key={w.id} open={!embedded&&taskOpen} onClose={()=>setTaskOpen(false)} initialText={taskText}/></div>
 <footer hidden={embedded} className="enterprise-footer"><span>载流量须与型号、工况及计算方法一同引用。</span><button onClick={s.exportJSON} disabled={blocked}>导出工程参数</button><button disabled={blocked} onClick={()=>void s.create()}>新建工程</button></footer>
 </main></div>
 {embedded&&<><AnalysisDrawer open={resultsOpen&&!focused} onClose={()=>setResultsOpen(false)} onCommand={executeCommand}/><div hidden={focused}><ResultRibbon open={resultsOpen} onOpenChange={setResultsOpen}/></div><CommandPalette open={commandOpen&&active} onOpenChange={setCommandOpen} state={commandState} onExecute={chooseCommand} returnFocus={()=>commandOpener.current}/></>}
 <ModelGenerator open={generator} onClose={()=>setGenerator(false)}/>
 <Modal open={projectOpen} onOpenChange={setProjectOpen} title="工程中心" description="打开独立保存的方案；未提交输入必须先处理。"><div className="ps-hub-current"><FolderOpen size={24}/><div><b>{w.scenario.name}</b><p>rev.{w.revision} · {w.scenario.cable.conductor==='copper'?'铜':'铝'} {w.scenario.cable.area_mm2} mm² · {w.runs.length} 次运行</p></div></div><div className="ps-hub-resources">{([ ['products','产品型号'],['documents','企业资料'],['methods','设计依据'],['history','运行记录'] ] as const).map(([id,label])=><button key={id} onClick={()=>{setProjectOpen(false);executeCommand(id)}}>{label}<ArrowRight size={15}/></button>)}</div><h3>已保存工程</h3><div className="eng-project-list">{projects.map(p=><button key={p.id} disabled={blocked} onClick={()=>{void s.load(p.id);setProjectOpen(false)}}><FolderOpen size={18}/><span><b>{p.name}</b><small>rev.{p.revision}</small></span><ArrowRight size={16}/></button>)}</div></Modal>
 <Modal open={forkOpen} onOpenChange={b=>{if(!localBusy)setForkOpen(b)}} title="另存计算方案" description="复制电缆、工况、引用和锁定参数；计算结果不复制。原工程保持不变。"><form className="enterprise-fork-form" onSubmit={e=>{e.preventDefault();void fork()}}><label>方案名称<input aria-label="另存方案名称" required maxLength={100} value={forkName} onChange={e=>setForkName(e.target.value)}/></label><button className="primary" disabled={blocked}>建立独立方案</button></form></Modal>
 </div>;
}
export default function EnterpriseWorkspace(){return <StudioProvider stayInWorkspace><EnterpriseWorkbench/></StudioProvider>}
