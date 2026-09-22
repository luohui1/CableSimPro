import {useRef} from 'react';
import {Box, FileText, X} from 'lucide-react';

/** Tablist contains tabs only. Closing is a separate command, not a nested button. */
export default function DocumentTabs({ids,active,title,dirty,onSelect,onClose}:{
 ids:string[];active:string;title:(id:string)=>string;dirty:boolean;
 onSelect:(id:string)=>void;onClose:(id:string)=>void;
}){
 const refs=useRef(new Map<string,HTMLButtonElement>());
 function move(from:string,key:string){
  const index=ids.indexOf(from);
  const next=key==='Home'?0:key==='End'?ids.length-1:(index+(key==='ArrowRight'?1:-1)+ids.length)%ids.length;
  onSelect(ids[next]);refs.current.get(ids[next])?.focus();
 }
 return <div className="wf-document-strip">
  <div className="wf-documents" role="tablist" aria-label="已打开的工程文档">
   {ids.map(id=><button key={id} ref={node=>{if(node)refs.current.set(id,node);else refs.current.delete(id)}}
    role="tab" id={`wf-tab-${id}`} aria-controls={`wf-panel-${id}`} aria-selected={id===active}
    tabIndex={id===active?0:-1} aria-label={title(id)} className={id===active?'active':''}
    onClick={()=>onSelect(id)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();move(id,e.key)}}}>
    {id==='cable'?<Box size={15}/>:<FileText size={15}/>}<span>{title(id)}</span>
    {id==='cable'&&dirty&&<span className="wf-tab-draft" aria-label="有未保存输入">●</span>}
   </button>)}
  </div>
  {ids.length>1&&<button className="wf-close-document" aria-label={`关闭${title(active)}`} title="关闭当前文档（工程草稿保留）" onClick={()=>{const next=ids.filter(id=>id!==active).at(-1);onClose(active);if(next)requestAnimationFrame(()=>refs.current.get(next)?.focus())}}><X size={14}/></button>}
 </div>;
}
