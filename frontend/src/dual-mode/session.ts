import {useMemo,useSyncExternalStore} from 'react';
export type WorkMode='workbench'|'agent';
const CHANGE='cablesim-route-change';
export function readRoute(search=window.location.search){
 const p=new URLSearchParams(search),raw=p.get('mode');
 return {mode:raw==='workbench'||raw==='agent'?raw as WorkMode:null,project:p.get('project'),invalidMode:!!raw&&raw!=='workbench'&&raw!=='agent'};
}
function subscribe(callback:()=>void){window.addEventListener('popstate',callback);window.addEventListener(CHANGE,callback);return()=>{window.removeEventListener('popstate',callback);window.removeEventListener(CHANGE,callback)}}
export function useModeRoute(){const search=useSyncExternalStore(subscribe,()=>window.location.search,()=> '');return useMemo(()=>readRoute(search),[search])}
function write(url:URL,replace=false){if(url.href===window.location.href)return;window.history[replace?'replaceState':'pushState']({},'',url);window.dispatchEvent(new Event(CHANGE))}
export function navigateMode(mode:WorkMode|null,project?:string|null,replace=false){
 const url=new URL(window.location.href);
 for(const key of ['legacy','classic','enterprise'])url.searchParams.delete(key);
 if(mode)url.searchParams.set('mode',mode);else url.searchParams.delete('mode');
 if(project)url.searchParams.set('project',project);else url.searchParams.delete('project');
 write(url,replace);
 if(mode){try{localStorage.setItem('cablesim-last-mode',mode)}catch{/* Preference is optional; no engineering data are stored here. */}}
}
/** Revisions and mode changes share one server workspace; this never creates one. */
export function syncWorkspaceUrl(id:string){const route=readRoute();if(route.mode||route.project)navigateMode(route.mode,id,true)}
export function previousMode():WorkMode|null{try{const m=localStorage.getItem('cablesim-last-mode');return m==='workbench'||m==='agent'?m:null}catch{return null}}
