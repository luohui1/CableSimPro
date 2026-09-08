import {createContext, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import type {Result, Scenario, Sweep} from './types';
import {api, download, errorText} from './utils';
import {captureOutputSource, selectCurrentOutput, type OutputSource} from './outputEvidence';
import {engineeringCall} from './runtimeClient';
export type Change = {path:string; value:string|number|null};
export type Source = {id:string; title:string; page:number; text_sha256:string; excerpts:{path:string;quote:string;value:number}[]};
export interface Workspace {design_basis?:Record<string,unknown>;id:string;revision:number;scenario:Scenario;locks:string[];sources:Source[];can_undo:boolean;can_redo:boolean;updated_at:string;audit:{id:string;revision:number;event:string;details:string;created:string}[];runs:{id:string;revision:number;created:string;input_hash:string}[]}
export interface Output {result:Result|null;sweep:Sweep|null;statement:string;run_id?:string;events:{tool:string;status:string;detail:string}[]}
export interface Proposal {expired?:boolean;expires_at?:number;design_basis?:Record<string,unknown>;previous_design_basis?:Record<string,unknown>;id?:string;ready:boolean;base_revision:number;mode:string;message:string;action:string;changes:{path:string;before:unknown;after:unknown}[];questions:string[];assumptions:string[];scenario:Scenario;source?:Source;events:Output['events']}
export interface Note {id:number;role:'user'|'assistant';text:string}
export interface Studio {
 initialized:boolean;outputCurrent:boolean;
 inputDrafts:Record<string,string>;setInputDraft:(path:string,text:string|null)=>void;discardInputs:()=>void;
 w:Workspace|null;busy:boolean;error:string;notice:string;output:Output|null;current:Result|null;currentSweep:Sweep|null;
 proposal:Proposal|null;notes:Note[];selected:string;select:(s:string)=>void;phase:number;setPhase:(n:number)=>void;
 status:{cloud_configured:boolean;model:string|null};tab:string;setTab:(s:string)=>void;
 edit:(c:Change[],label?:string)=>Promise<void>;lock:(p:string,b:boolean)=>Promise<void>;
 history:(d:'undo'|'redo')=>Promise<void>;run:()=>Promise<void>;plan:(m:string,mode:'local'|'openai',consent:boolean)=>Promise<void>;
 review:(a:'approve'|'reject')=>Promise<void>;extract:(title:string,text:string,page:number)=>Promise<void>;
 load:(id:string)=>Promise<void>;create:(scenario?:Scenario)=>Promise<void>;reload:()=>Promise<void>;
 adoptProposal:(p:Proposal)=>void;refreshProviders:()=>Promise<void>;
 showRun:(id:string)=>Promise<void>;report:()=>Promise<void>;exportJSON:()=>void;dismiss:()=>void;
}
const Context=createContext<Studio|null>(null);
export const useStudio=()=>useContext(Context)!;
export const valueAt=(s:Scenario,path:string):unknown=>path.split('.').reduce<unknown>((o,k)=>(o as Record<string,unknown>)[k],s);
export function StudioProvider({children,stayInWorkspace=false,deferCreate=false,restoreSession=false,initialWorkspaceId,onWorkspaceChange}:{
 children:ReactNode;stayInWorkspace?:boolean;deferCreate?:boolean;restoreSession?:boolean;
 initialWorkspaceId?:string|null;onWorkspaceChange?:(id:string)=>void;
}) {
 const [initialized,setInitialized]=useState(false);
 const [w,setW]=useState<Workspace|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [outputState,setOutputState]=useState<{output:Output|null;source:OutputSource|null}>({output:null,source:null});
 const outputRef=useRef(outputState);
 const {output,source:outputSource}=outputState;
 const [proposal,setProposal]=useState<Proposal|null>(null),[notes,setNotes]=useState<Note[]>([]);
 const [selected,select]=useState('installation'),[phase,setPhase]=useState(1),[tab,setTab]=useState('installation');
 const [status,setStatus]=useState({cloud_configured:false,model:null as string|null});
 const ids=useRef(0),currentW=useRef(w);currentW.current=w;
 const queue=useRef<Promise<void>>(Promise.resolve()),pending=useRef(0);
 const [inputDrafts,setInputDrafts]=useState<Record<string,string>>({}),draftRef=useRef<Record<string,string>>({});
 function setInputDraft(path:string,text:string|null){const next={...draftRef.current};if(text===null)delete next[path];else next[path]=text;draftRef.current=next;setInputDrafts(next)}
 function discardInputs(){draftRef.current={};setInputDrafts({})}
 function requireCommitted(){if(Object.keys(draftRef.current).length)throw new Error('存在未提交或无效的参数输入，请修正输入或撤销输入后再操作。')}

 function rememberOutput(output:Output|null,source:OutputSource|null){
  const next={output,source};outputRef.current=next;setOutputState(next);
 }
 const {outputCurrent,current,currentSweep}=selectCurrentOutput(w,output,outputSource,Object.keys(inputDrafts).length>0);
 async function task(fn:()=>Promise<void>){pending.current++;setBusy(true);const job=queue.current.then(async()=>{setError('');try{await fn()}catch(e){setError(errorText(e))}finally{pending.current--;setBusy(pending.current>0)}});queue.current=job;return job}
 function remember(next:Workspace){currentW.current=next;setW(next);onWorkspaceChange?.(next.id);try{localStorage.setItem('cablesim-studio-id',next.id)}catch{/* Server data remains saved if browser storage is unavailable. */}}
 const route=(suffix:string)=>`/api/workspaces/${currentW.current!.id}/${suffix}`;
 const rev=()=>({expected_revision:currentW.current!.revision});
 function add(role:Note['role'],text:string){setNotes(n=>[...n.slice(-49),{id:++ids.current,role,text}])}
 function accept(r:{workspace:Workspace;output:Output|null}){remember(r.workspace);rememberOutput(r.output,captureOutputSource(r.workspace,r.output,r.workspace.revision));if(r.output)add('assistant',r.output.statement)}
 async function refreshProviders(){const r=await api<{providers:{agent:{configured:boolean;model:string}}}>('/api/integrations');setStatus({cloud_configured:r.providers.agent.configured,model:r.providers.agent.model||null})}
 async function openWorkspace(id:string){
  if(restoreSession){
   const state=await api<{workspace:Workspace;proposal:Proposal|null;output:Output|null;output_revision:number|null}>(`/api/workspaces/${encodeURIComponent(id)}/session`);
   remember(state.workspace);setProposal(state.proposal);rememberOutput(state.output,captureOutputSource(state.workspace,state.output,state.output_revision));
   setNotes(state.proposal?[{id:++ids.current,role:'user',text:state.proposal.message}]:[]);
  }else{remember(await api(`/api/workspaces/${encodeURIComponent(id)}`));setProposal(null);rememberOutput(null,null);setNotes([])}
 }
 async function initialize(){
  await task(async()=>{
   await refreshProviders();let id=initialWorkspaceId??null;
   if(!id){try{id=localStorage.getItem('cablesim-studio-id')}catch{}}
   if(id){try{await openWorkspace(id);return}catch(e){if(initialWorkspaceId||!errorText(e).includes('不存在'))throw e}}
   if(!deferCreate)remember(await api('/api/workspaces',{}));
  });setInitialized(true);
 }
 useEffect(()=>{void initialize()},[]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(t)},[notice]);
 const methods:Studio={initialized,outputCurrent,inputDrafts,setInputDraft,discardInputs,adoptProposal:p=>{setProposal(p);add('assistant','已生成工程变更；请检查参数差异、设计依据和完整输入后决定是否批准。')},refreshProviders,w,busy,error,notice,output,current,currentSweep,proposal,notes,selected,select,phase,setPhase,status,tab,setTab,
 edit:async(changes,label='属性编辑')=>task(async()=>{remember(await api(route('edit'),{...rev(),changes,label}));changes.forEach(c=>{const d=draftRef.current[c.path];if(d!==undefined&&(d===''?c.value===null:Number(d)===c.value))setInputDraft(c.path,null)});setNotice('已校验并保存修改')}),
 lock:async(path,locked)=>task(async()=>{remember(await api(route('lock'),{...rev(),path,locked}))}),
 history:async d=>task(async()=>{remember(await api(route(`history/${d}`),rev()))}),
 run:async()=>task(async()=>{requireCommitted();accept(await engineeringCall(currentW.current!.id,currentW.current!.revision,'analysis.buried'));if(!stayInWorkspace)setTab('results')}),
 plan:async(message,mode,consent)=>task(async()=>{requireCommitted();add('user',message);setProposal(null);const p=await engineeringCall<Proposal>(currentW.current!.id,currentW.current!.revision,'task.plan',{message,mode,consent});setProposal(p);if(!p.ready)add('assistant',p.questions.join('\n'))}),
 review:async action=>task(async()=>{requireCommitted();if(!proposal?.id)return;accept(await api(route(`proposals/${proposal.id}/${action}`),rev()));setProposal(null);if(action==='approve'){if(!stayInWorkspace)setTab('results')}else add('assistant','已拒绝提案，工程未改变。')}),
 extract:async(title,text,page)=>task(async()=>{setProposal(await api(route('evidence'),{...rev(),title,text,page}));setNotice('资料参数已提取，等待在 Agent 面板中审查。')}),
 load:async id=>task(async()=>{requireCommitted();await openWorkspace(id);discardInputs()}),
 create:async scenario=>task(async()=>{requireCommitted();remember(await api('/api/workspaces',scenario?{scenario}:{}));rememberOutput(null,null);setProposal(null);setNotes([]);discardInputs()}),
 reload:async()=>task(async()=>{if(currentW.current)remember(await api(`/api/workspaces/${currentW.current.id}`))}),
 showRun:async id=>task(async()=>{const r=await api<{output:Output;events:Output['events']}>(route(`runs/${id}`));rememberOutput({...r.output,events:r.events,run_id:id},captureOutputSource(currentW.current!,{...r.output,run_id:id},null));setTab('results')}),
 report:async()=>{
  // Capture the requested evidence before entering the queue. Never silently
  // retarget a report to another workspace/revision while earlier work finishes.
  const expected=currentW.current,selectedOutput=outputRef.current;
  return task(async()=>{
   requireCommitted();
   const latest=currentW.current;
   if(!expected||!latest||latest.id!==expected.id||latest.revision!==expected.revision||
      outputRef.current!==selectedOutput||!selectedOutput.output?.run_id||
      !selectCurrentOutput(latest,selectedOutput.output,selectedOutput.source,false).current)
    throw new Error('所选结果不是当前工程版本的有效运行，请重新计算后再导出计算书。');
   const r=await engineeringCall<{html:string}>(expected.id,expected.revision,'reports.render',{run_id:selectedOutput.output.run_id});
   download('CableSimPro-计算书.html',r.html,'text/html;charset=utf-8');
  });
 },
 exportJSON:()=>{if(w)download('CableSimPro-工程.json',JSON.stringify(w.scenario,null,2),'application/json')},
 dismiss:()=>setError('')};
 return <Context.Provider value={methods}>{children}</Context.Provider>;
}
