import {useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import PluginCenter from './PluginCenter';
import {useStudio} from '../StudioState';

export default function ProjectPluginDialog({onClose}:{onClose:()=>void}){
 const s=useStudio(),opener=useRef(document.activeElement as HTMLElement),[busy,setBusy]=useState(false);
 return <Dialog.Root open onOpenChange={v=>{if(!v&&!busy)onClose()}}><Dialog.Portal><Dialog.Overlay className="project-plugin-overlay"/>
  <Dialog.Content className="project-plugin-dialog" onCloseAutoFocus={e=>{e.preventDefault();opener.current?.focus()}} onKeyDown={e=>{if(e.key==='F9'||(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();e.stopPropagation()}}}>
   <Dialog.Title className="plugin-sr-only">当前工程插件中心</Dialog.Title><Dialog.Description className="plugin-sr-only">使用同一工程快照管理插件，关闭后返回原工作台。</Dialog.Description>
   <PluginCenter onBack={onClose} onBusyChange={setBusy} context={s.w?{id:s.w.id,name:s.w.scenario.name,revision:s.w.revision,blocked:s.busy||Object.keys(s.inputDrafts).length>0}:undefined}/>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
