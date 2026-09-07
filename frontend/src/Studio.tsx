import {DomainWorkspace} from './DomainPanels';
import {useEffect,useRef,useState} from 'react';
import {DockviewReact,themeLight,type DockviewApi,type DockviewReadyEvent} from 'dockview-react';
import {CircuitBoard,Play,Undo2,Redo2,FolderOpen,Plus,Download,Upload,PanelsTopLeft,Sparkles,RefreshCw,FileText,ChevronRight,X,CheckCircle2,ShieldCheck,Activity} from 'lucide-react';
import {StudioProvider,useStudio} from './StudioState';
import {Navigator,Inspector,Viewport,AgentPanel,ResultsPanel} from './StudioPanels';
import {api,errorText} from './utils';
import type {Scenario} from './types';
import 'dockview/dist/styles/dockview.css';
import './studio.css';
import './engineering.css';
const components={tree:Navigator,inspector:Inspector,viewport:Viewport,agent:AgentPanel,results:ResultsPanel};
function Workbench(){
 const s=useStudio(),{w,busy,run,history,create,load,reload,exportJSON,report,current}=s;
 const dock=useRef<DockviewApi|null>(null),input=useRef<HTMLInputElement>(null);
 const [layoutKey,setLayoutKey]=useState(0),[projects,setProjects]=useState<{id:string;name:string;revision:number}[]|null>(null),[dialogError,setDialogError]=useState('');
 const [mobile,setMobile]=useState(window.innerWidth<950),[mobileTab,setMobileTab]=useState('model');
 useEffect(()=>{const resize=()=>setMobile(window.innerWidth<950);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)},[]);
 function onReady(event:DockviewReadyEvent){
  const a=event.api;dock.current=a;
  let restored=false;
  try{const saved=localStorage.getItem('cablesim-layout-v03');if(saved){a.fromJSON(JSON.parse(saved));restored=['tree','inspector','viewport','agent','results'].every(id=>a.getPanel(id));if(!restored)a.clear()}}catch{a.clear()}
  if(!restored){
   a.addPanel({id:'viewport',component:'viewport',title:'模型视图'});
   a.addPanel({id:'tree',component:'tree',title:'工程浏览器',position:{referencePanel:'viewport',direction:'left'},initialWidth:228});
   a.addPanel({id:'inspector',component:'inspector',title:'属性编辑',position:{referencePanel:'tree',direction:'below'},initialHeight:390});
   a.addPanel({id:'agent',component:'agent',title:'工程 Copilot',position:{referencePanel:'viewport',direction:'right'},initialWidth:340});
   a.addPanel({id:'results',component:'results',title:'研究与证据',position:{referencePanel:'viewport',direction:'below'},initialHeight:235});
   a.getPanel('viewport')?.api.setActive();
  }
  a.onDidLayoutChange(()=>{try{localStorage.setItem('cablesim-layout-v03',JSON.stringify(a.toJSON()))}catch{}});
 }
 async function openProjects(){try{setProjects(await api('/api/workspaces'));setDialogError('')}catch(e){setDialogError(errorText(e))}}
 function resetLayout(){localStorage.removeItem('cablesim-layout-v03');setLayoutKey(k=>k+1)}
 async function importFile(file:File){try{if(file.size>120000)throw new Error('工程 JSON 不能超过 120 KB。');const raw=JSON.parse(await file.text());const valid=await api<Scenario>('/api/validate',raw);await create(valid);setDialogError('')}catch(e){setDialogError(errorText(e))}}
 useEffect(()=>{const key=(e:KeyboardEvent)=>{const t=e.target as HTMLElement;if(['INPUT','TEXTAREA','SELECT'].includes(t.tagName)||t.isContentEditable)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(!busy)void history(e.shiftKey?'redo':'undo')}if(e.key==='F9'){e.preventDefault();if(!busy)void run()}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[history,run,busy]);
 if(!w)return <div className="startup"><CircuitBoard size={38}/><h1>CableSimPro</h1><p>{s.error||'正在打开工程工作空间…'}</p>{s.error&&<button onClick={()=>location.reload()}>重新连接</button>}</div>;
 return <div className="studio-shell"><header className="app-header"><div className="brand"><span><CircuitBoard size={23}/></span><b>CableSim<span>Pro</span></b><small>ENGINEERING WORKSPACE</small></div><nav><button className="nav-active" onClick={()=>s.setTab('installation')}>工程</button><button onClick={()=>{s.select('cable');s.setTab('section')}}>建模</button><button onClick={()=>s.setTab('results')}>分析</button><button onClick={()=>s.setTab('library')}>企业资料库</button><button onClick={()=>s.setTab('selection')}>反向选型</button><button onClick={()=>s.setTab('fields')}>场分析</button><button onClick={()=>s.setTab('integrations')}>接入设置</button></nav><div className="header-end"><span className="preview-label">0.4 · ENGINEERING PREVIEW</span><span className="profile">LH</span></div></header>
 <div className="ribbon"><button onClick={()=>void create()} disabled={busy}><Plus size={15}/>新建</button><button onClick={()=>void openProjects()} disabled={busy}><FolderOpen size={15}/>打开工程</button><span className="separator"/><button aria-label="撤销" title="撤销 Ctrl+Z" disabled={busy||!w.can_undo} onClick={()=>void history('undo')}><Undo2 size={16}/></button><button aria-label="重做" title="重做 Ctrl+Shift+Z" disabled={busy||!w.can_redo} onClick={()=>void history('redo')}><Redo2 size={16}/></button><button aria-label="刷新工程" title="同步服务端版本" disabled={busy} onClick={()=>void reload()}><RefreshCw size={14}/></button><span className="separator"/><button onClick={()=>input.current?.click()} disabled={busy}><Upload size={14}/>导入</button><button onClick={exportJSON} disabled={busy}><Download size={14}/>工程 JSON</button><button onClick={()=>void report()} disabled={busy||!current}><FileText size={14}/>计算书</button><span className="tool-spacer"/><button title="切换模型工作区最大化" onClick={()=>{const panel=dock.current?.getPanel('viewport');if(panel)panel.api.isMaximized()?panel.api.exitMaximized():panel.api.maximize()}}>专注工作区</button><button title="恢复默认布局" onClick={resetLayout}><PanelsTopLeft size={15}/><span className="hide-small">重置布局</span></button><button className="primary run-button" disabled={busy} onClick={()=>void run()}><Play size={14} fill="currentColor"/>{busy?'处理中':'执行计算'}<kbd>F9</kbd></button><input ref={input} type="file" accept=".json,application/json" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);e.target.value=''}}/></div>
 <div className="breadcrumb"><FolderOpen size={13}/><span>{w.scenario.name}</span><ChevronRight size={12}/><span>方案 01</span><ChevronRight size={12}/><b>CKT-01</b><span className="tool-spacer"/><span className="save-state"><CheckCircle2 size={12}/>已保存到本机</span><code data-testid="revision">rev.{w.revision}</code></div>
 {(s.error||dialogError)&&<div className="error-banner" role="alert"><ShieldCheck size={15}/><span>{s.error||dialogError}</span><button onClick={()=>{s.dismiss();setDialogError('')}} aria-label="关闭错误"><X size={14}/></button></div>}
 {s.notice&&<div className="toast" role="status"><CheckCircle2 size={14}/>{s.notice}</div>}
 <main className="dock-host">{mobile?<div className="mobile-workbench"><div className="mobile-tabs">{[['model','模型'],['properties','属性'],['agent','Copilot'],['results','结果'],['library','资料库'],['selection','选型'],['fields','场分析'],['integrations','接入']].map(([id,label])=><button key={id} className={id===mobileTab?'active':''} onClick={()=>setMobileTab(id)}>{label}</button>)}</div><div className="mobile-content">{mobileTab==='model'?<Viewport/>:mobileTab==='properties'?<><div className="mobile-property-select">{[['installation','敷设'],['cable','电缆'],['materials','材料'],['study','运行']].map(([id,label])=><button key={id} onClick={()=>s.select(id)}>{label}</button>)}</div><Inspector/></>:mobileTab==='agent'?<AgentPanel/>:['library','selection','fields','integrations'].includes(mobileTab)?<DomainWorkspace mode={mobileTab} onBack={()=>setMobileTab('model')}/>:<ResultsPanel/>}</div></div>:<DockviewReact key={layoutKey} className="dockview-theme-light" theme={themeLight} components={components} onReady={onReady} disableFloatingGroups keyboardNavigation/>}</main>
 <footer className="app-status"><span><i className="live-dot"/>本地计算引擎</span><span>三相稳态 · 单回路直埋</span><span><ShieldCheck size={12}/>非完整 IEC / 非工程认证</span><span className="tool-spacer"/><span><Sparkles size={12}/>{s.status.cloud_configured?'云端 Agent 已配置':'本地命令模式 · 非大模型'}</span><span>SI / mm / m</span></footer>
 {projects&&<div className="modal-overlay"><section className="project-dialog" role="dialog" aria-modal="true" aria-label="打开工程"><header><h3><FolderOpen size={17}/>打开工程</h3><button aria-label="关闭" onClick={()=>setProjects(null)}><X size={17}/></button></header><p>工程修改、审批和历史自动保存在本机 SQLite 中。</p>{projects.map(p=><button className="project-row" key={p.id} disabled={busy} onClick={()=>{void load(p.id);setProjects(null)}}><Activity size={17}/><b>{p.name}</b><span>rev.{p.revision}</span><ChevronRight size={14}/></button>)}</section></div>}
 </div>;
}
export default function Studio(){return <StudioProvider><Workbench/></StudioProvider>}
