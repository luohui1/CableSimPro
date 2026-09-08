import {useEffect,useRef,useState} from 'react';
import {Activity,ArrowLeft,ArrowRight,BookOpen,Box,Check,ChevronRight,ClipboardList,FileText,FolderOpen,Layers3,Menu,MessageSquare,PanelRightClose,PanelRightOpen,Play,Plus,Redo2,Settings2,Undo2,Upload,X} from 'lucide-react';
import {StudioProvider,useStudio} from './StudioState';
import {Inspector,ResultsPanel} from './StudioPanels';
import {AssistantDock,InlineResults} from './WorkspaceInteraction';
import {FieldPanel,IntegrationsPanel,LibraryPanel,SelectionPanel} from './DomainPanels';
import {Modal,ModelGenerator,StandardsPanel,TaskJournal} from './EngineeringPanels';
import EngineeringCanvas from './EngineeringCanvas';
import CableModelView from './CableModelView';
import {CrossSection} from './Visuals';
import {api,errorText} from './utils';
import type {Scenario} from './types';
import './studio.css';
import './engineering.css';
import './readability.css';
import './design-v041.css';
import './engineering-workspace.css';
import './workspace-interaction.css';

type Display={density:'comfortable'|'compact';fonts:'system'|'online'};
function readDisplay():Display {try{return {...{density:'comfortable',fonts:'system'},...JSON.parse(localStorage.getItem('csp-display-v05')??'{}')}}catch{return {density:'comfortable',fonts:'system'}}}
const pages=[
 {group:'设计',items:[{id:'model',name:'电缆结构',description:'同心层结构与参数化模型',icon:Layers3},{id:'installation',name:'敷设布置',description:'单回路直埋 · 几何与边界条件',icon:Box},{id:'fields',name:'计算分析',description:'热场、电场、磁场及竖向电热',icon:Activity},{id:'selection',name:'电缆选型',description:'按负荷、边界条件与型号参数筛选',icon:ClipboardList}]},
 {group:'工程资料',items:[{id:'standards',name:'设计依据',description:'标准版本、适用范围与工程假设',icon:BookOpen},{id:'library',name:'企业资料',description:'原件、识别文字与参数引用',icon:FolderOpen},{id:'results',name:'计算结果',description:'载流量、温度、损耗与计算书',icon:FileText},{id:'trace',name:'任务记录',description:'输入版本、执行状态与参数来源',icon:ClipboardList}]}
];
const pageId=(tab:string)=>['section','3d','model'].includes(tab)?'model':['results','curve','details','runs','history','sources'].includes(tab)?'results':tab;
function Workspace(){
 const s=useStudio(),{w,busy}=s;
 const [assistant,setAssistant]=useState(false),[properties,setProperties]=useState(window.innerWidth>=760),[navOpen,setNavOpen]=useState(false),[generator,setGenerator]=useState(false),[projectOpen,setProjectOpen]=useState(false),[settingsOpen,setSettingsOpen]=useState(false),[modelView,setModelView]=useState<'3d'|'2d'>('3d');
 const [projectList,setProjectList]=useState<{id:string;name:string;revision:number}[]>([]),[error,setError]=useState(''),[display,setDisplay]=useState<Display>(readDisplay);
 const [section,setSection]=useState('cable');
 const [showResults,setShowResults]=useState(false);
 useEffect(()=>{if(s.output?.run_id)setShowResults(true)},[s.output?.run_id]);
 useEffect(()=>{setAssistant(false);setShowResults(false)},[w?.id]);
 const input=useRef<HTMLInputElement>(null);
 const active=pageId(s.tab),info=pages.flatMap(g=>g.items).find(p=>p.id===active)??{name:'服务接入',description:'配置文字识别与语言模型服务'};
 const showProperties=properties&&['model','installation'].includes(active);
 const domain=w?.design_basis?.environment;
 const canRun=['model','installation','results'].includes(active)&&(!domain||domain==='buried');
 useEffect(()=>{s.setTab('model');s.select('cable')},[]);
 useEffect(()=>{if(s.proposal)setAssistant(true)},[s.proposal]);
 useEffect(()=>{document.documentElement.dataset.density=display.density;try{localStorage.setItem('csp-display-v05',JSON.stringify(display))}catch{}
  // Online typeface delivery is strictly opt-in: no font binaries are bundled or copied.
  const id='csp-optional-fonts';document.getElementById(id)?.remove();
  if(display.fonts==='online'){const link=document.createElement('link');link.id=id;link.rel='stylesheet';link.referrerPolicy='no-referrer';link.href='https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;600&display=swap';document.head.appendChild(link)}
  return()=>document.getElementById(id)?.remove();
 },[display]);
 useEffect(()=>{const handler=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();document.querySelector<HTMLTextAreaElement>('.task-dock textarea')?.focus();return}const el=e.target as HTMLElement;if(['INPUT','SELECT','TEXTAREA'].includes(el.tagName)||el.isContentEditable)return;
  if(e.key==='F9'){e.preventDefault();if(canRun&&!busy)void s.run()}
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();if(!busy)void s.history(e.shiftKey?'redo':'undo')}
 };window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[busy,canRun,s.run,s.history]);
 function navigate(id:string){s.setTab(id);setNavOpen(false);if(id==='model'){s.select('cable');setSection('cable')}if(id==='installation'){s.select('installation');setSection('installation')}}
 async function openProjects(){setError('');setProjectOpen(true);try{setProjectList(await api('/api/workspaces'))}catch(e){setError(errorText(e))}}
 async function importProject(file:File){setError('');try{if(file.size>120000)throw new Error('工程文件不得超过 120 KB。');const scenario=await api<Scenario>('/api/validate',JSON.parse(await file.text()));await s.create(scenario)}catch(e){setError(errorText(e))}}
 if(!w)return <div className="eng-loading"><span className="brand-symbol">C</span><h1>CableSimPro</h1><p>{s.error||'正在读取工程…'}</p>{s.error&&<button onClick={()=>location.reload()}>重新连接</button>}</div>;
 return <div className="eng-app">
 <aside className={`eng-sidebar ${navOpen?'nav-open':''}`} aria-label="工程导航"><a className="eng-brand" href="#" onClick={e=>{e.preventDefault();navigate('model')}}><span className="brand-symbol">C</span><span>CableSimPro<small>电缆工程设计</small></span></a>
 <button className="eng-project" onClick={()=>void openProjects()}><FolderOpen size={17}/><span><strong>{w.scenario.name}</strong><small>本机工程 · 版本 {w.revision}</small></span><ChevronRight size={14}/></button>
 <nav>{pages.map(group=><section key={group.group}><h2>{group.group}</h2>{group.items.map(item=><button key={item.id} className={active===item.id?'active':''} aria-current={active===item.id?'page':undefined} onClick={()=>navigate(item.id)}><item.icon size={17}/><span>{item.name}</span>{active===item.id&&<i/>}</button>)}</section>)}</nav>
 <div className="eng-sidebar-bottom"><button className={active==='integrations'?'active':''} onClick={()=>navigate('integrations')}><Settings2 size={17}/>服务接入</button><button onClick={()=>setSettingsOpen(true)}><Settings2 size={17}/>显示设置</button><p><span className="online-dot"/>本机计算服务<small>研究版 0.5.1 · 未经外部工程认证</small></p></div></aside>
 {navOpen&&<button className="nav-scrim" aria-label="关闭导航" onClick={()=>setNavOpen(false)}/>}
 <div className="eng-workarea"><header className="eng-project-header"><button className="mobile-nav-button" aria-label="打开导航" onClick={()=>setNavOpen(true)}><Menu size={20}/></button><div className="eng-breadcrumb"><span>工程</span><ChevronRight size={13}/><b>{w.scenario.name}</b><span className="eng-revision" data-testid="revision">rev.{w.revision}</span></div><div className="eng-header-actions"><button aria-label="撤销修改" title="撤销修改" disabled={busy||!w.can_undo} onClick={()=>void s.history('undo')}><Undo2 size={17}/></button><button aria-label="重做修改" title="重做修改" disabled={busy||!w.can_redo} onClick={()=>void s.history('redo')}><Redo2 size={17}/></button><span className="eng-saved"><Check size={13}/>本机已保存</span><button className={assistant?'assistant-trigger active':'assistant-trigger'} aria-expanded={assistant} onClick={()=>{setAssistant(!assistant);document.querySelector<HTMLTextAreaElement>('.task-dock textarea')?.focus()}}><MessageSquare size={17}/>工程助手</button></div></header>
 <header className="eng-page-header"><div><div className="eng-page-caption">{active==='integrations'?'应用设置':pages.find(g=>g.items.some(p=>p.id===active))?.group}</div><h1>{info.name}</h1><p>{info.description}</p></div><div className="eng-page-actions">{active==='model'&&<button className="primary" onClick={()=>setGenerator(true)} disabled={busy||!!Object.keys(s.inputDrafts).length}><Plus size={16}/>生成电缆模型</button>}{canRun&&<button className="primary" disabled={busy} onClick={()=>void s.run()}><Play size={15}/>{busy?'计算中…':'计算载流量'}<small>直埋</small></button>}{active==='results'&&<button disabled={!s.current||busy} onClick={()=>void s.report()}>导出计算书</button>}{['model','installation'].includes(active)&&<button aria-label="显示或隐藏属性" aria-expanded={properties} onClick={()=>setProperties(!properties)}>{properties?<PanelRightClose size={17}/>:<PanelRightOpen size={17}/>}属性</button>}</div></header>
 {(s.error||error)&&<div className="eng-error-banner" role="alert"><span>{s.error||error}</span><button aria-label="关闭错误" onClick={()=>{s.dismiss();setError('')}}><X size={16}/></button></div>}
 {!!Object.keys(s.inputDrafts).length&&<div className="draft-banner" role="status"><span>有 {Object.keys(s.inputDrafts).length} 项输入未提交。计算和变更审批使用已保存参数，请先修正或撤销输入。</span><button onClick={s.discardInputs}>撤销未提交输入</button></div>}
 <div className="eng-body"><main className={`eng-main ${showProperties?'has-properties':''}`} id="engineering-content"><div className={`eng-page-content ${['model','installation'].includes(active)?'same-workspace':''}`}><div className="workspace-view">
 {active==='model'?<section className="model-page"><div className="model-page-tabs"><div className="segmented-control"><button className={modelView==='3d'?'active':''} onClick={()=>setModelView('3d')}>三维结构</button><button className={modelView==='2d'?'active':''} onClick={()=>setModelView('2d')}>截面尺寸</button></div><span>单芯 · 无铠装 · 参数化同心层</span></div>{modelView==='3d'?<CableModelView cable={w.scenario.cable}/>:<div className="eng-cross-section"><CrossSection cable={w.scenario.cable}/><p>尺寸单位：mm。圆形等效截面；不用于绞线制造放样。</p></div>}<div className="model-page-foot"><b>{w.scenario.cable.name}</b><span>导体 {w.scenario.cable.area_mm2} mm²</span><span>U₀ {w.scenario.cable.u0_kv} kV</span><span>温度限值 {w.scenario.cable.max_temperature_c} °C</span></div></section>
 :active==='installation'?<div className="eng-installation"><EngineeringCanvas/><div className="boundary-summary"><b>当前计算域</b><span>三相平衡 / 单回路 / 均匀土壤直埋</span><span>未建模排管、回填分区与土壤干燥</span></div></div>
 :active==='fields'?<FieldPanel/>:active==='selection'?<SelectionPanel/>:active==='library'?<LibraryPanel/>:active==='standards'?<StandardsPanel key={w.id+':'+w.revision}/>:active==='trace'?<TaskJournal/>:active==='integrations'?<IntegrationsPanel/>:<ResultsPanel/>}
 </div>{['model','installation'].includes(active)&&<InlineResults open={showResults} onOpenChange={setShowResults}/>}</div>{showProperties&&<aside className="eng-properties" aria-label="工程属性"><header><h2>参数</h2><span>校验后自动保存</span></header><div className="property-sections">{(active==='model'?[['cable','结构尺寸'],['materials','材料参数'],['study','运行条件']]:[['installation','敷设条件'],['study','运行条件']]).map(([id,label])=><button key={id} className={section===id?'active':''} onClick={()=>{setSection(id);s.select(id)}}>{label}</button>)}</div><Inspector/></aside>}</main>
 </div><AssistantDock key={w.id} expanded={assistant} onExpandedChange={setAssistant} pageTitle={info.name}/><footer className="eng-footbar"><span>单位：mm / m / A / °C</span><span>计算方法与适用范围见“设计依据”</span><button onClick={s.exportJSON}>导出工程</button><button onClick={()=>input.current?.click()} disabled={busy}>导入工程</button><button onClick={()=>void s.create()} disabled={busy}>新建工程</button></footer>
 </div>
 <input type="file" ref={input} hidden accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)void importProject(f);e.target.value=''}}/>
 <ModelGenerator open={generator} onClose={()=>setGenerator(false)}/>
 <Modal open={projectOpen} onOpenChange={setProjectOpen} title="打开工程" description="选择保存在本机的工程；现有工程不会被覆盖。"><div className="eng-project-list">{projectList.map(p=><button key={p.id} disabled={busy} onClick={()=>{void s.load(p.id);setProjectOpen(false)}}><FolderOpen size={19}/><span><b>{p.name}</b><small>版本 {p.revision}</small></span><ArrowRight size={16}/></button>)}</div></Modal>
 <Modal open={settingsOpen} onOpenChange={setSettingsOpen} title="显示设置" description="字体与界面密度仅影响显示，不改变工程计算参数。"><div className="display-settings"><h2>界面密度</h2><div className="segmented-control"><button className={display.density==='comfortable'?'active':''} onClick={()=>setDisplay({...display,density:'comfortable'})}>舒适</button><button className={display.density==='compact'?'active':''} onClick={()=>setDisplay({...display,density:'compact'})}>紧凑</button></div><h2>工程字体</h2><p>正文优先 IBM Plex Sans／思源黑体，数值优先 IBM Plex Mono。未安装时使用系统字体，不影响离线启动。</p><label className="font-consent"><input type="checkbox" checked={display.fonts==='online'} onChange={e=>setDisplay({...display,fonts:e.target.checked?'online':'system'})}/>允许从 Google Fonts 在线加载 IBM Plex 与 Noto Sans SC</label><p className="eng-note">默认关闭。开启会向 Google 字体服务发送网络请求，需联网；载入失败自动回退。运行包不附字体文件。</p><div className="font-sample"><h3>电缆结构与载流量</h3><p>设计输入与计算结果分层显示。</p><code>240 mm²　437.28 A　90.0 °C</code></div></div></Modal>
 </div>;
}
export default function EngineeringWorkspace(){return <StudioProvider stayInWorkspace><Workspace/></StudioProvider>}
