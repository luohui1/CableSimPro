import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Box,Check,Home,Settings2,Workflow,X} from 'lucide-react';
import {StudioProvider,useStudio} from '../StudioState';
import {EnterpriseWorkbench} from '../EnterpriseWorkspace';
import ModeSelection from './ModeSelection';
import AgentWorkspace from './AgentWorkspace';
import {navigateMode,readRoute,syncWorkspaceUrl,useModeRoute,type WorkMode} from './session';
import './dual-mode.css';
import './agent-studio.css';

const initialProject=readRoute().project;
function Application(){
 const s=useStudio(),route=useModeRoute();
 const [draft,setDraft]=useState(''),[visited,setVisited]=useState({workbench:false,agent:false});
 const [viewRequest,setViewRequest]=useState({view:'cable',serial:0}),[routeWarning,setRouteWarning]=useState('');
 const attempted=useRef<string|null>(null),creating=useRef(false),sessionId=useRef<string|null>(null);
 const currentProject=useRef(s.w);currentProject.current=s.w;
 const dirty=Object.keys(s.inputDrafts).length>0;
 function choose(mode:WorkMode){s.dismiss();setRouteWarning('');navigateMode(mode,s.w?.id)}
 function openWorkbench(view='cable'){setViewRequest(r=>({view,serial:r.serial+1}));choose('workbench')}
 function openAgent(text=''){if(text)setDraft(text);choose('agent')}
 function home(){s.dismiss();setRouteWarning('');navigateMode(null,s.w?.id)}
 useEffect(()=>{if(route.mode)setVisited(v=>({...v,[route.mode!]:true}))},[route.mode]);
 useEffect(()=>{
  if(!s.initialized)return;
  if(route.project&&route.project!==s.w?.id){
   if(dirty||s.busy){if(dirty){setRouteWarning('未提交输入已保留，请先处理后再打开其他工程。');navigateMode(route.mode,s.w?.id,true)}return}
   if(attempted.current===route.project)return;
   attempted.current=route.project;void s.load(route.project);return;
  }
  if(route.mode&&!s.w&&!route.project&&!s.error&&!s.busy&&!creating.current){creating.current=true;void s.create().finally(()=>{creating.current=false})}
 },[s.initialized,s.w?.id,s.busy,s.error,route.project,route.mode,dirty]);
 useEffect(()=>{if(s.w?.id&&sessionId.current!==s.w.id){sessionId.current=s.w.id;setDraft('')}},[s.w?.id]);
 async function openProject(id:string,mode:WorkMode){if(s.busy||dirty)return;await s.load(id);navigateMode(mode,id)}
 const mismatch=!!route.project&&route.project!==s.w?.id;
 const usable=!!s.w&&!mismatch;
 return <div className={`dual-app ${route.mode?'is-project':'is-home'}`}>
  <header className="dual-header"><button className="dual-brand" onClick={home} aria-label="返回模式选择"><span className="dual-brand-symbol">C</span><b>CableSim<span>Pro</span></b><small>电缆设计与验证</small></button>
   {route.mode&&<nav className="mode-switch" aria-label="工作模式"><button aria-pressed={route.mode==='workbench'} onClick={()=>choose('workbench')}><Box size={17}/>专业工作台</button><button aria-pressed={route.mode==='agent'} onClick={()=>choose('agent')}><Workflow size={17}/>智能工程流</button></nav>}
   <div className="dual-header-end"><span>0.7.2 · 本机预览</span><button onClick={()=>openWorkbench('settings')} title="服务接入设置" aria-label="双模式服务设置"><Settings2 size={19}/></button></div>
  </header>
  {route.mode&&usable&&<div className="dual-context"><button onClick={home}><ArrowLeft size={14}/>工作入口</button><span className="context-divider"/><b>{s.w!.scenario.name}</b><span className="dual-revision" data-testid="session-revision">rev.{s.w!.revision}</span><span className="dual-context-right"><Check size={13}/>共用工程数据</span></div>}
  {(s.error||routeWarning||route.invalidMode)&&<div className="dual-alert" role="alert"><span>{s.error||routeWarning||'无法识别此工作模式，请重新选择。'}</span><button aria-label="关闭双模式提示" onClick={()=>{s.dismiss();setRouteWarning('');if(route.invalidMode)home()}}><X size={16}/></button></div>}
  {dirty&&route.mode==='agent'&&<div className="dual-draft-warning" role="status"><span>有 {Object.keys(s.inputDrafts).length} 项未提交输入，任务规划和批准已暂停。</span><button onClick={()=>openWorkbench()}>返回检查参数</button><button onClick={s.discardInputs}>撤销未提交输入</button></div>}
  {!route.mode&&<ModeSelection choose={choose} openProject={(id,mode)=>void openProject(id,mode)}/>}
  {route.mode&&!usable&&<main className="dual-loading"><Workflow size={32}/><h1>{s.error?'工程未能打开':'正在打开工程'}</h1><p>{s.error?'不会用新建工程替换失效的项目链接。请检查项目或返回选择。':'正在恢复工程版本、提案和计算记录。'}</p><button onClick={home}><Home size={16}/>返回模式选择</button></main>}
  {usable&&<>
   <div hidden={route.mode!=='workbench'} className="dual-mode-surface" data-testid="professional-mode">{visited.workbench&&<EnterpriseWorkbench embedded active={route.mode==='workbench'} onAgent={openAgent} requestedView={viewRequest}/>}</div>
   <div hidden={route.mode!=='agent'} className="dual-mode-surface" data-testid="agent-mode">{visited.agent&&<AgentWorkspace key={s.w!.id} active={route.mode==='agent'} draft={draft} setDraft={setDraft} openWorkbench={openWorkbench}/>}</div>
  </>}
  {route.mode&&usable&&<footer className="dual-status"><span>{s.busy?'正在执行工程操作':'已连接本机工程服务'}</span><span>{s.proposal?.ready?'有待审查提案':s.current?'当前载流量结果有效':'参数与适用范围须核对'}</span><button onClick={()=>route.mode==='workbench'?openAgent():openWorkbench()}>切换到{route.mode==='workbench'?'智能工程流':'专业工作台'}<ArrowRight size={13}/></button></footer>}
 </div>;
}
export default function DualModeApp(){return <StudioProvider stayInWorkspace deferCreate restoreSession initialWorkspaceId={initialProject} onWorkspaceChange={syncWorkspaceUrl}><Application/></StudioProvider>}
