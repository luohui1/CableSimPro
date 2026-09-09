import {useEffect,useId,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {ArrowUpRight,Command,Search,Star,X} from 'lucide-react';
import {cleanCommandIds,commandBlockReason,searchCommands,type CommandState,type WorkbenchCommandId} from './workbenchCommands';

const STORAGE='cablesim-workbench-command-preferences-v1';
/** Search and preference state only. All actions return to the live workspace owner. */
export default function CommandPalette({open,onOpenChange,state,onExecute,returnFocus}:{open:boolean;onOpenChange:(open:boolean)=>void;state:CommandState;onExecute:(id:WorkbenchCommandId)=>void;returnFocus?:()=>HTMLElement|null}){
 const [query,setQuery]=useState(''),[category,setCategory]=useState('全部'),[active,setActive]=useState(0);
 const [favorites,setFavorites]=useState<WorkbenchCommandId[]>([]),[recent,setRecent]=useState<WorkbenchCommandId[]>([]);
 const input=useRef<HTMLInputElement>(null),opener=useRef<HTMLElement|null>(null),composing=useRef(false),suppressEnter=useRef(false);
 const listId=useId(),selectionId=useId();
 useEffect(()=>{try{const stored=JSON.parse(localStorage.getItem(STORAGE)??'null');setFavorites(cleanCommandIds(stored?.favorites));setRecent(cleanCommandIds(stored?.recent))}catch{/* Preferences never block engineering work. */}},[]);
 useEffect(()=>{if(open){opener.current=document.activeElement as HTMLElement;setQuery('');setCategory('全部');setActive(0);suppressEnter.current=false}},[open]);
 const all=searchCommands(query,['收藏','最近使用'].includes(category)?'全部':category);
 const commands=category==='收藏'?all.filter(c=>favorites.includes(c.id)):category==='最近使用'?recent.flatMap(id=>all.filter(c=>c.id===id)):all;
 const index=Math.min(active,Math.max(0,commands.length-1)),selected=commands[index];
 const reason=selected?commandBlockReason(selected,state):null;
 function save(nextFavorites:WorkbenchCommandId[],nextRecent:WorkbenchCommandId[]){try{localStorage.setItem(STORAGE,JSON.stringify({favorites:nextFavorites,recent:nextRecent}))}catch{}}
 function execute(id:WorkbenchCommandId){const command=commands.find(c=>c.id===id);if(!command||commandBlockReason(command,state))return;
  const next=[id,...recent.filter(r=>r!==id)].slice(0,8);setRecent(next);save(favorites,next);onExecute(id);
 }
 function favorite(){if(!selected)return;const next=favorites.includes(selected.id)?favorites.filter(id=>id!==selected.id):[selected.id,...favorites].slice(0,8);setFavorites(next);save(next,recent)}
 useEffect(()=>{if(open)document.getElementById(`${selectionId}-${index}`)?.scrollIntoView({block:'nearest'})},[index,query,category,open,selectionId]);
 return <Dialog.Root open={open} onOpenChange={onOpenChange}>
  <Dialog.Portal><Dialog.Overlay className="ps-dialog-overlay"/><Dialog.Content className="ps-command-dialog white-components" onOpenAutoFocus={e=>{e.preventDefault();input.current?.focus()}} onCloseAutoFocus={e=>{e.preventDefault();(returnFocus?.()??opener.current)?.focus()}}>
   <Dialog.Title className="ps-sr-only">命令中心</Dialog.Title><Dialog.Description className="ps-sr-only">搜索已实现的工程功能。方向键选择，回车打开，Esc 返回。不可用命令说明原因。</Dialog.Description>
   <div className="ps-command-search"><Search size={21}/><input ref={input} role="combobox" aria-label="搜索工程命令" aria-autocomplete="list" aria-expanded={true} aria-controls={listId} aria-activedescendant={selected?`${selectionId}-${index}`:undefined} placeholder="搜索命令、参数或工程模块…" value={query} onChange={e=>{setQuery(e.target.value);setActive(0)}}
    onCompositionStart={()=>{composing.current=true;suppressEnter.current=true}} onCompositionEnd={()=>{composing.current=false}}
    onKeyDown={e=>{if(composing.current||e.nativeEvent.isComposing||e.nativeEvent.keyCode===229)return;
     if(e.key==='Enter'){e.preventDefault();if(suppressEnter.current){suppressEnter.current=false;return}if(selected)execute(selected.id)}
     else{suppressEnter.current=false;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setActive((index+(e.key==='ArrowDown'?1:-1)+commands.length)%Math.max(1,commands.length))}}
    }} onKeyUp={e=>{if(e.key==='Enter'&&!composing.current)suppressEnter.current=false}}/><kbd>Esc</kbd><Dialog.Close className="ps-icon-button" aria-label="关闭命令中心"><X size={18}/></Dialog.Close></div>
   <div className="ps-command-filters" aria-label="命令分类">{['全部','最近使用','收藏','建模与视图','计算分析','参数研究','工程资源','工程操作'].map(c=><button key={c} aria-pressed={category===c} onClick={()=>{setCategory(c);setActive(0);input.current?.focus()}}>{c}</button>)}</div>
   <div className="ps-command-body"><div id={listId} role="listbox" aria-label="可用工程命令" className="ps-command-list">{commands.length?commands.map((c,i)=>{const blocked=commandBlockReason(c,state);return <div id={`${selectionId}-${i}`} key={c.id} role="option" aria-selected={i===index} aria-disabled={!!blocked} className="ps-command-option" onMouseMove={()=>setActive(i)} onMouseDown={e=>e.preventDefault()} onClick={()=>execute(c.id)}><Command size={17}/><span><b>{c.title}</b><small>{blocked??c.group}</small></span>{favorites.includes(c.id)&&<Star size={13}/>}<kbd>{'shortcut' in c?c.shortcut:'↵'}</kbd></div>}):<p className="ps-empty">没有匹配命令。可以试试“截面”“温度”或“资料”。</p>}</div>
   {selected&&<aside className="ps-command-preview"><span>{selected.group}</span><h2>{selected.title}</h2><p>{selected.hint}</p>{reason&&<p className="ps-command-reason" role="status">{reason}</p>}<button className="ps-favorite" aria-pressed={favorites.includes(selected.id)} onClick={favorite}><Star size={16}/>{favorites.includes(selected.id)?'取消收藏':'收藏命令'}</button><button className="ps-run-command" disabled={!!reason} onClick={()=>execute(selected.id)}>打开功能 <ArrowUpRight size={16}/></button></aside>}</div>
   <footer className="ps-command-footer"><span>↑ ↓ 选择　↵ 打开　Esc 返回</span><span>{commands.length} 项已实现功能</span></footer>
  </Dialog.Content></Dialog.Portal>
 </Dialog.Root>;
}
