import {createContext, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import type {Result, Scenario, Sweep} from './types';
import {api, canonical, download, errorText} from './utils';
export type Change = {path:string; value:string|number|null};
export type Source = {id:string; title:string; page:number; text_sha256:string; excerpts:{path:string;quote:string;value:number}[]};
export interface Workspace {id:string;revision:number;scenario:Scenario;locks:string[];sources:Source[];can_undo:boolean;can_redo:boolean;updated_at:string;audit:{id:string;revision:number;event:string;details:string;created:string}[];runs:{id:string;revision:number;created:string;input_hash:string}[]}
export interface Output {result:Result|null;sweep:Sweep|null;statement:string;run_id?:string;events:{tool:string;status:string;detail:string}[]}
export interface Proposal {id?:string;ready:boolean;base_revision:number;mode:string;message:string;action:string;changes:{path:string;before:unknown;after:unknown}[];questions:string[];assumptions:string[];scenario:Scenario;source?:Source;events:Output['events']}
export interface Note {id:number;role:'user'|'assistant';text:string}
export interface Studio {
 w:Workspace|null;busy:boolean;error:string;notice:string;output:Output|null;current:Result|null;
 proposal:Proposal|null;notes:Note[];selected:string;select:(s:string)=>void;phase:number;setPhase:(n:number)=>void;
 status:{cloud_configured:boolean;model:string|null};tab:string;setTab:(s:string)=>void;
 edit:(c:Change[],label?:string)=>Promise<void>;lock:(p:string,b:boolean)=>Promise<void>;
 history:(d:'undo'|'redo')=>Promise<void>;run:()=>Promise<void>;plan:(m:string,mode:'local'|'openai',consent:boolean)=>Promise<void>;
 review:(a:'approve'|'reject')=>Promise<void>;extract:(title:string,text:string,page:number)=>Promise<void>;
 load:(id:string)=>Promise<void>;create:(scenario?:Scenario)=>Promise<void>;reload:()=>Promise<void>;
 showRun:(id:string)=>Promise<void>;report:()=>Promise<void>;exportJSON:()=>void;dismiss:()=>void;
}
const Context=createContext<Studio|null>(null);
export const useStudio=()=>useContext(Context)!;
export const valueAt=(s:Scenario,path:string):unknown=>path.split('.').reduce<unknown>((o,k)=>(o as Record<string,unknown>)[k],s);
export function StudioProvider({children}:{children:ReactNode}) {
 const [w,setW]=useState<Workspace|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [output,setOutput]=useState<Output|null>(null),[proposal,setProposal]=useState<Proposal|null>(null),[notes,setNotes]=useState<Note[]>([]);
 const [selected,select]=useState('installation'),[phase,setPhase]=useState(1),[tab,setTab]=useState('installation');
 const [status,setStatus]=useState({cloud_configured:false,model:null as string|null});
 const running=useRef(false),ids=useRef(0),currentW=useRef(w);currentW.current=w;
 const current=output?.result && w && canonical(output.result.input)===canonical(w.scenario)?output.result:null;
 async function task(fn:()=>Promise<void>){if(running.current)return;running.current=true;setBusy(true);setError('');try{await fn()}catch(e){setError(errorText(e))}finally{setBusy(false);running.current=false}}
 function remember(next:Workspace){setW(next);try{localStorage.setItem('cablesim-studio-id',next.id)}catch{/* Server data remains saved if browser storage is unavailable. */}}
 const route=(suffix:string)=>`/api/workspaces/${currentW.current!.id}/${suffix}`;
 const rev=()=>({expected_revision:currentW.current!.revision});
 function add(role:Note['role'],text:string){setNotes(n=>[...n.slice(-49),{id:++ids.current,role,text}])}
 function accept(r:{workspace:Workspace;output:Output|null}){remember(r.workspace);setOutput(r.output);if(r.output)add('assistant',r.output.statement)}
 async function initialize(){await task(async()=>{setStatus(await api('/api/agent/status'));let id:string|null=null;try{id=localStorage.getItem('cablesim-studio-id')}catch{};if(id){try{remember(await api(`/api/workspaces/${id}`));return}catch(e){if(!errorText(e).includes('不存在'))throw e}}remember(await api('/api/workspaces',{}))})}
 useEffect(()=>{void initialize()},[]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(t)},[notice]);
 const methods:Studio={w,busy,error,notice,output,current,proposal,notes,selected,select,phase,setPhase,status,tab,setTab,
 edit:async(changes,label='属性编辑')=>task(async()=>{remember(await api(route('edit'),{...rev(),changes,label}));setNotice('已校验并保存修改')}),
 lock:async(path,locked)=>task(async()=>{remember(await api(route('lock'),{...rev(),path,locked}))}),
 history:async d=>task(async()=>{remember(await api(route(`history/${d}`),rev()))}),
 run:async()=>{const invalid=document.querySelector<HTMLInputElement>('input:invalid');if(invalid){invalid.reportValidity();setError('有未完成或超出范围的数值输入，请先修正。');return}return task(async()=>{accept(await api(route('calculate'),rev()));setTab('results')})},
 plan:async(message,mode,consent)=>task(async()=>{add('user',message);setProposal(null);const p=await api<Proposal>(route('plan'),{...rev(),message,mode,consent});setProposal(p);if(!p.ready)add('assistant',p.questions.join('\n'))}),
 review:async action=>task(async()=>{if(!proposal?.id)return;accept(await api(route(`proposals/${proposal.id}/${action}`),rev()));setProposal(null);if(action==='approve')setTab('results');else add('assistant','已拒绝提案，工程未改变。')}),
 extract:async(title,text,page)=>task(async()=>{setProposal(await api(route('evidence'),{...rev(),title,text,page}));setNotice('资料参数已提取，等待在 Agent 面板中审查。')}),
 load:async id=>task(async()=>{remember(await api(`/api/workspaces/${id}`));setProposal(null);setOutput(null);setNotes([])}),
 create:async scenario=>task(async()=>{remember(await api('/api/workspaces',scenario?{scenario}:{}));setOutput(null);setProposal(null);setNotes([])}),
 reload:async()=>task(async()=>{if(currentW.current)remember(await api(`/api/workspaces/${currentW.current.id}`))}),
 showRun:async id=>task(async()=>{const r=await api<{output:Output;events:Output['events']}>(route(`runs/${id}`));setOutput({...r.output,events:r.events,run_id:id});setTab('results')}),
 report:async()=>task(async()=>{if(!current)return;download('CableSimPro-计算书.html',await api<string>('/api/report',current.input),'text/html;charset=utf-8')}),
 exportJSON:()=>{if(w)download('CableSimPro-工程.json',JSON.stringify(w.scenario,null,2),'application/json')},
 dismiss:()=>setError('')};
 return <Context.Provider value={methods}>{children}</Context.Provider>;
}
