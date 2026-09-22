import {useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {ArrowUpRight, Search, X} from 'lucide-react';
export interface WorkflowCommand {id:string;name:string;keywords?:string;disabled?:boolean;action:()=>void}
/** UI commands reuse the existing host actions. Search never submits or solves. */
export default function CommandSearch({open,onClose,commands}:{open:boolean;onClose:()=>void;commands:WorkflowCommand[]}){
 const [query,setQuery]=useState('');
 const matches=commands.filter(c=>(c.name+' '+(c.keywords??'')).toLowerCase().includes(query.trim().toLowerCase()));
 return <Dialog.Root open={open} onOpenChange={value=>{if(!value){onClose();setQuery('')}}}><Dialog.Portal>
  <Dialog.Overlay className="wf-command-overlay"/>
  <Dialog.Content className="wf-command-dialog" onCloseAutoFocus={e=>{e.preventDefault();document.getElementById('wf-command-trigger')?.focus()}}>
   <header><Dialog.Title>工程命令</Dialog.Title><Dialog.Close asChild><button aria-label="关闭工程命令"><X size={17}/></button></Dialog.Close></header>
   <Dialog.Description>查找当前工作区中的操作；计算仍需在研究文档中核对后执行。</Dialog.Description>
   <label className="wf-command-input"><Search size={18}/><input autoFocus aria-label="搜索工程命令" value={query} placeholder="输入命令或对象名称…" onChange={e=>setQuery(e.target.value)}/><kbd>Esc</kbd></label>
   <div className="wf-command-results">{matches.map(c=><button key={c.id} disabled={c.disabled} onClick={()=>{onClose();setQuery('');c.action()}}><span>{c.name}</span><ArrowUpRight size={15}/></button>)}{!matches.length&&<p>没有匹配命令。</p>}</div>
  </Dialog.Content>
 </Dialog.Portal></Dialog.Root>;
}
