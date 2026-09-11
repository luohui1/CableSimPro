import {useEffect,useRef,useState} from 'react';
export type PlateKind='cable'|'installation'|'documents';
const descriptions:Record<PlateKind,string>={cable:'单芯电缆剥切结构的原创三维示意',installation:'三根单芯电缆与土壤显示范围的原创剖切示意',documents:'企业资料与电缆参数核对的原创示意'};
/** Static explanatory art never stands in for an interactive model or a solved field. */
export function EngineeringPlate({kind,className='',priority=false}:{kind:PlateKind;className?:string;priority?:boolean}){
 const [failed,setFailed]=useState(false),imageRef=useRef<HTMLImageElement|null>(null);
 useEffect(()=>setFailed(false),[kind]);
 // WebKit may paint a broken image for an aborted request without dispatching React's
 // delegated error event. Inspect the native image state as a second, browser-neutral path.
 useEffect(()=>{
  if(failed)return;
  let stopped=false,timer=0;
  const inspect=()=>{
   const image=imageRef.current;
   if(stopped||!image)return;
   if(image.complete){if(image.naturalWidth===0)setFailed(true);return}
   timer=window.setTimeout(inspect,250);
  };
  timer=window.setTimeout(inspect,0);
  return()=>{stopped=true;window.clearTimeout(timer)};
 },[kind,failed]);
 return <div className={`engineering-plate ${className}`} data-plate={kind}>
  {!failed?<img key={kind} ref={imageRef} src={`/engineering/${kind}.png`} alt={descriptions[kind]} width={1200} height={760} loading={priority?'eager':'lazy'} decoding="async" onError={()=>setFailed(true)}/>:<div className="plate-unavailable" role="img" aria-label={descriptions[kind]+'，图像未能加载'}>工程示意图未能加载<br/><small>参数编辑与计算不受影响</small></div>}
 </div>;
}
export function EngineeringGuide({kind,title,children}:{kind:PlateKind;title:string;children:React.ReactNode}){
 return <aside className="engineering-guide"><EngineeringPlate kind={kind}/><div><b>{title}</b><p>{children}</p><small>结构示意 · 不代表当前计算结果</small></div></aside>;
}
