import {useEffect,useState} from 'react';
import {ArrowRight,CheckCircle2,ShieldCheck,TriangleAlert} from 'lucide-react';
import {useStudio} from '../StudioState';
import {api} from '../utils';
import {buildEngineeringReadiness,type EngineeringAssessment,type ReadinessItem} from '../engineeringReadiness';
import './engineering-readiness.css';

type LoadState='loading'|'ready'|'error';
const actionLabel:Record<ReadinessItem['target'],string>={cable:'检查工程输入',documents:'核对参数依据',methods:'查看方法边界',products:'检查企业型号'};

/** Review-time synthesis of facts already stored by CableSimPro. No AI-generated compliance claims. */
export default function EngineeringReadinessPanel({openWorkbench}:{openWorkbench:(view?:string)=>void}){
 const s=useStudio(),w=s.w,p=s.proposal;
 const [assessment,setAssessment]=useState<EngineeringAssessment|null>(null),[loadState,setLoadState]=useState<LoadState>('loading');
 useEffect(()=>{
  if(!w||!p?.ready)return;
  let canceled=false;setLoadState('loading');setAssessment(null);
  void api<EngineeringAssessment>(`/api/enterprise/workspaces/${w.id}/assessment`).then(result=>{if(!canceled){setAssessment(result);setLoadState('ready')}}).catch(()=>{if(!canceled){setAssessment(null);setLoadState('error')}});
  return()=>{canceled=true};
 },[w?.id,w?.revision,p?.id,p?.ready]);
 if(!w||!p?.ready)return null;
 const expired=!!p.expired||!!(p.expires_at&&p.expires_at*1000<Date.now());
 const readiness=buildEngineeringReadiness({
  workspaceRevision:w.revision,proposalBaseRevision:p.base_revision,proposalExpired:expired,
  dirtyCount:Object.keys(s.inputDrafts).length,sourceCount:w.sources.length,lockCount:w.locks.length,
  assessment,assessmentPending:loadState==='loading',assessmentFailed:loadState==='error',
 });
 const BadgeIcon=readiness.level==='ready'?CheckCircle2:readiness.level==='blocked'?TriangleAlert:ShieldCheck;
 return <section className={`engineering-readiness level-${readiness.level}`} data-testid="engineering-readiness" aria-label="工程审查门槛" aria-live="polite">
  <header className="readiness-header">
   <span className="readiness-icon"><BadgeIcon size={18}/></span>
   <div><span>批准前工程审查</span><strong>{readiness.title}</strong><small>{readiness.summary}</small></div>
   <b className="readiness-badge">{readiness.level==='blocked'?'暂停执行':readiness.level==='review'?'研究级可执行':'检查完成'}</b>
  </header>
  <div className="readiness-items">{readiness.items.map(item=><button type="button" key={item.id} className={`readiness-item state-${item.state}`} onClick={()=>openWorkbench(item.target)} aria-label={`检查：${item.label}`}>
   <span>{item.state==='pass'?<CheckCircle2 size={15}/>:<TriangleAlert size={15}/>}</span><div><b>{item.label}</b><small>{item.detail}</small></div><ArrowRight size={14}/>
  </button>)}</div>
  <footer><span>当前范围：{readiness.scope}</span><small>此面板只汇总审查事实；批准仍由服务端版本锁、产品绑定、参数校验与工程工具决定。</small></footer>
 </section>;
}
