import {lazy,Suspense,useEffect,useRef,useState,type ReactNode} from 'react';
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
import {WorkbenchCommandBar,WorkspaceRail,ResultRibbon,AnalysisDrawer,WorkbenchStatusBar} from './professional/WorkbenchExperience';
import CommandPalette from './professional/CommandPalette';
import {ModelTree} from './professional/ModelTree';
import ReferenceInspector from './professional/ReferenceInspector';
import StudyPreparation from './professional/StudyPreparation';
import {WORKBENCH_COMMANDS,commandBlockReason,type WorkbenchCommandId} from './professional/workbenchCommands';
import {Button} from './design-system/primitives';
import {DisclosureSettings} from './design-system/DisclosureGroup';
const AssetLibrary=lazy(()=>import('./assets/AssetLibrary'));
interface Assessment {revision:number;domain:string;product_reference:null|{name:string;code:string;version:number;aligned:boolean;is_current_reviewed:boolean;lifecycle:string;changed_fields:string[]};findings:{code:string;message:string;target:string}[];scope:string}
type Area='engineering'|'assets'|'products'|'documents'|'methods'|'settings';
type View='cable'|'installation'|'fields'|'selection'|'history'|'journal';
const views:{id:View;name:string;icon:typeof Box}[]=[{id:'cable',name:'电缆结构',icon:Layers3},{id:'installation',name:'敷设与负荷',icon:Box},{id:'fields',name:'场计算',icon:Activity},{id:'selection',name:'候选选型',icon:ClipboardCheck},{id:'history',name:'计算记录',icon:FileText},{id:'journal',name:'任务与引用',icon:BookOpen}];
export function ReferenceWorkbench({embedded=true,active=true,onAgent,requestedView,onHome,statusContent}:{embedded?:boolean;active?:boolean;onAgent?:(text:string)=>void;requestedView?:{view:string;serial:number};onHome?:()=>void;statusContent?:ReactNode}){
 const s=useStudio(),w=s.w;
 const [area,setArea]=useState<Area>('engineering'),[view,setView]=useState<View>('cable'),[properties,setProperties]=useState(true),[propertySection,setPropertySection]=useState('cable'),[installationView,setInstallationView]=useState('2d');
 const [inspectorTree,setInspectorTree]=useState(false);
 const [studyOpen,setStudyOpen]=useState(false);
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
   if(focused){setFocused(false);return}
   const disclosure=document.querySelector('.ps-workbench details[open]');
   if(disclosure){disclosure.removeAttribute('open');(disclosure.querySelector('summary') as HTMLElement)?.focus();return}
   if(commandOpen)return;
   if(resultsOpen&&embedded){setResultsOpen(false);return}
   setTaskOpen(false);setNavOpen(false);setFocused(false);
  }
  if(['INPUT','TEXTAREA','SELECT'].includes(target.tagName)||target.isContentEditable)return;
  if(e.key==='F9'&&area==='engineering'&&['cable','installation'].includes(view)&&isBuried&&!blocked){e.preventDefault();void s.run()}
 }window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[blocked,area,view,isBuried,s.run,active,embedded,commandOpen,resultsOpen,focused]);
 async function openProjects(){setError('');try{setProjects(await api('/api/workspaces'));setProjectOpen(true)}catch(e){setError(errorText(e))}}
 async function fork(){if(!w||blocked)return;setLocalBusy(true);setError('');try{const r=await api<{id:string}>(`/api/enterprise/workspaces/${w.id}/fork`,{expected_revision:w.revision,name:forkName});await s.load(r.id);setForkOpen(false)}catch(e){setError(errorText(e))}finally{setLocalBusy(false)}}
 function proposalReady(){if(embedded&&onAgent){onAgent('');return}setArea('engineering');setTaskOpen(true);requestAnimationFrame(()=>taskRef.current?.scrollIntoView({block:'nearest'}))}
 useEffect(()=>{if(requestedView){if(['settings','methods','documents','products','assets'].includes(requestedView.view))setArea(requestedView.view as Area);else if(views.some(v=>v.id===requestedView.view))navigate(requestedView.view as View)}},[requestedView?.serial]);
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
  if(id==='study-preflight'){setStudyOpen(true);return}
  if(id==='generator'){setGenerator(true);return}
  if(id==='analysis'){setResultsOpen(true);return}
  if(id==='parameters'){setFocused(false);setProperties(true);return}
  if(['model','section','temperature','curve'].includes(id)){navigate('cable');setCanvasRequest(r=>({view:id as typeof r.view,serial:r.serial+1}));return}
  if(['installation','fields','selection','history','journal'].includes(id)){navigate(id as View);return}
  if(['products','documents','methods','settings','assets'].includes(id)){setArea(id as Area);setNavOpen(false);return}
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
  setInspectorTree(false);setInspectedLayer(index);setInspectionSerial(v=>v+1);setProperties(true);setFocused(false);
  const section=[1,3,4].includes(index)?'materials':'cable';setPropertySection(section);s.select(section);
 }
 if(!w)return <div className="eng-loading"><span className="brand-symbol">C</span><h1>CableSimPro</h1><p>{s.error||'正在打开工程…'}</p>{s.error&&<button onClick={()=>location.reload()}>重新连接</button>}</div>;
 const name=views.find(v=>v.id===view)!.name,reference=assessment?.product_reference;
 const showProperties=properties&&!focused&&area==='engineering'&&['cable','installation'].includes(view);
 return <div className={`enterprise-shell ${embedded?'dual-embedded ps-workbench':''} ${embedded&&focused&&area==='engineering'&&['cable','installation'].includes(view)?'is-focused':''} ${s.current?'has-current-results':''} ${area==='assets'?'has-asset-workspace':''}`}>
 {embedded&&active&&<WorkbenchCommandBar onHome={onHome??(()=>navigate('cable'))} onAgent={()=>openTask()} onCommand={executeCommand} onSearch={openCommands} statusContent={statusContent}/>}
 {((!embedded&&s.error)||error)&&<div role="alert" className="enterprise-error top-error"><span>{(!embedded&&s.error)||error}</span><button aria-label="关闭操作错误" onClick={()=>{s.dismiss();setError('')}}><X size={16}/></button></div>}
 {changed&&<div role="status" className="enterprise-warning draft-status"><span>有 {Object.keys(s.inputDrafts).length} 项参数未提交。不会使用旧值继续计算或批准变更。</span><button onClick={s.discardInputs}>撤销未提交输入</button></div>}
 <div className="enterprise-body"><aside className={`enterprise-outline ${navOpen?'open':''}`} aria-label="当前工程目录"><WorkspaceRail area={area} view={view} onCommand={executeCommand}/></aside>
 {navOpen&&<button className="enterprise-nav-scrim" aria-label="关闭工程目录" onClick={()=>setNavOpen(false)}/>}
 <main className="enterprise-content">
 {area==='assets'&&<div className="asset-workspace-page"><Suspense fallback={<p role="status">正在打开工程资产库…</p>}><AssetLibrary active={active} onBack={()=>navigate('cable')}/></Suspense></div>}
 <div className="enterprise-page" hidden={area!=='engineering'||!['cable','installation'].includes(view)}>
 <div className={`enterprise-model-layout ${showProperties?'with-inspector':''}`}><section className="enterprise-model-column">{embedded&&<header className="ps-view-heading"><div><span>从电缆结构到工况分析，让每一步设计有据可查。</span><h1>{view==='cable'?'专业工作台':name}</h1></div><div><button className="enterprise-mobile-menu" aria-label="显示工程目录" aria-expanded={navOpen} onClick={()=>setNavOpen(v=>!v)}><Menu size={17}/>工程目录</button><button onClick={()=>openTask()}><MessageSquare size={16}/>{s.proposal?.ready?'审查变更':'设计任务'}</button><button aria-label="参数化建模" title="参数化建模" disabled={blocked} onClick={()=>setGenerator(true)}><Plus size={17}/></button><button aria-pressed={focused} aria-label="专注画布" title="专注画布（Esc 恢复）" onClick={()=>setFocused(v=>!v)}>{focused?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button><button aria-label="显示参数检查栏" aria-expanded={showProperties} onClick={()=>{if(focused){setFocused(false);setProperties(true)}else setProperties(v=>!v)}}>{showProperties?<PanelRightClose size={17}/>:<PanelRightOpen size={17}/>}</button></div></header>}<div hidden={view!=='cable'} className="enterprise-model-stage">{embedded?<EngineeringViewport progressive request={canvasRequest} onInspectLayer={inspectLayer} onInstallation={()=>navigate('installation')} onAnalysis={()=>setResultsOpen(true)}/>:<CableModelView cable={w.scenario.cable}/>}</div><div hidden={view!=='installation'} className="enterprise-installation-stage">{embedded&&<nav className="ref-installation-tabs" aria-label="工程工作视图"><button onClick={()=>executeCommand('model')}><Box size={19}/>结构</button><button aria-pressed={true}>敷设</button><button onClick={()=>executeCommand('temperature')}>温度</button><button onClick={()=>executeCommand('curve')}>曲线</button><button onClick={()=>setResultsOpen(true)}>结果</button></nav>}<div className="enterprise-segmented"><button className={installationView==='2d'?'active':''} onClick={()=>setInstallationView('2d')}>二维精确布置</button><button className={installationView==='3d'?'active':''} onClick={()=>setInstallationView('3d')}>三维空间检查</button></div><div className="enterprise-canvas-holder" hidden={installationView!=='2d'}><EngineeringCanvas/></div><div hidden={installationView!=='3d'}><InstallationModel scenario={w.scenario}/></div></div>
 </section>
 <aside className="enterprise-inspector" hidden={!showProperties} aria-label="方案参数"><header>{embedded?<nav className="ref-inspector-tabs" aria-label="检查器视图"><button aria-pressed={!inspectorTree} onClick={()=>setInspectorTree(false)}><Settings2 size={18}/>参数设置</button><button aria-pressed={inspectorTree} onClick={()=>setInspectorTree(true)}><Layers3 size={18}/>模型树</button></nav>:<div><h2>参数检查</h2><span>修改经校验后保存</span></div>}{embedded&&<button aria-label="收起参数检查器" title="收起参数检查器" onClick={()=>setProperties(false)}><X size={17}/></button>}</header>{embedded&&<div className="ref-model-kind"><span>电缆类型</span><span><Box size={17}/>单芯 · 无铠装</span></div>}{embedded&&inspectorTree&&<ModelTree onInspect={inspectLayer}/>}<div hidden={embedded&&inspectorTree} className="ref-parameter-body"><div className="enterprise-property-tabs">{(view==='cable'?[['cable','结构'],['materials','材料'],['study','运行']]:[['installation','敷设'],['study','运行']]).map(([id,label])=><button key={id} className={propertySection===id?'active':''} onClick={()=>{setPropertySection(id);s.select(id)}}>{label}</button>)}</div>{embedded?<DisclosureSettings.Provider value={{initialOpen:['导体与电压'],focusGroup:view==='installation'?'敷设参数':inspectedLayer===2||inspectedLayer===5?'绝缘与护套':[1,3,4].includes(inspectedLayer??-1)?'电气与屏蔽':inspectedLayer===0?'导体与电压':undefined,focusSerial:inspectionSerial}}><ReferenceInspector/></DisclosureSettings.Provider>:<Inspector/>}<details className="enterprise-evidence-check" open={!embedded||undefined}><summary>输入依据检查</summary>{assessment?.findings.map(f=><p key={f.code}>{f.message}</p>)}{reference&&!reference.is_current_reviewed&&<p>引用型号已更新或停用，当前方案保留原版本。</p>}<button onClick={()=>setArea('documents')}>核对资料来源 <ArrowRight size={13}/></button></details></div></aside>
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
 </main></div>
 {embedded&&<><div hidden={focused||area==='assets'}><ResultRibbon open={resultsOpen} onOpenChange={setResultsOpen}/></div><AnalysisDrawer open={resultsOpen&&!focused&&area!=='assets'} onClose={()=>setResultsOpen(false)} onCommand={executeCommand}/><WorkbenchStatusBar onCommand={executeCommand} library={area==='assets'}/><CommandPalette open={commandOpen&&active} onOpenChange={setCommandOpen} state={commandState} onExecute={chooseCommand} returnFocus={()=>commandOpener.current}/></>}
 <StudyPreparation open={studyOpen&&active} onClose={()=>setStudyOpen(false)}/>
 <ModelGenerator open={generator} onClose={()=>setGenerator(false)}/>
 <Modal open={projectOpen} onOpenChange={setProjectOpen} title="工程中心" description="打开独立保存的方案；未提交输入必须先处理。"><div className="ps-hub-current"><FolderOpen size={24}/><div><b>{w.scenario.name}</b><p>rev.{w.revision} · {w.scenario.cable.conductor==='copper'?'铜':'铝'} {w.scenario.cable.area_mm2} mm² · {w.runs.length} 次运行</p></div></div><div className="ps-hub-resources">{([ ['assets','工程资产库'],['products','产品型号'],['documents','企业资料'],['methods','设计依据'],['history','运行记录'] ] as const).map(([id,label])=><button key={id} onClick={()=>{setProjectOpen(false);executeCommand(id)}}>{label}<ArrowRight size={15}/></button>)}</div><h3>已保存工程</h3><div className="eng-project-list">{projects.map(p=><button key={p.id} disabled={blocked} onClick={()=>{void s.load(p.id);setProjectOpen(false)}}><FolderOpen size={18}/><span><b>{p.name}</b><small>rev.{p.revision}</small></span><ArrowRight size={16}/></button>)}</div></Modal>
 <Modal open={forkOpen} onOpenChange={b=>{if(!localBusy)setForkOpen(b)}} title="另存计算方案" description="复制电缆、工况、引用和锁定参数；计算结果不复制。原工程保持不变。"><form className="enterprise-fork-form" onSubmit={e=>{e.preventDefault();void fork()}}><label>方案名称<input aria-label="另存方案名称" required maxLength={100} value={forkName} onChange={e=>setForkName(e.target.value)}/></label><button className="primary" disabled={blocked}>建立独立方案</button></form></Modal>
 </div>;
}
