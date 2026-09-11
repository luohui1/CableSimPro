import {useState} from 'react';
import {Activity,BookOpen,Box,CheckCircle2,FileText,FolderOpen,Layers3,Settings2,ShieldCheck,Thermometer,TriangleAlert,Workflow,Zap} from 'lucide-react';

/** Subjects cropped from the user's approved sheets, not replacement mockup art.
 * These are decorative. Never use the field icon as a calculated temperature map.
 */
export const ENGINEERING_ICONS = {
 brand:0,cable:1,copper:2,aluminium:3,shield:4,document:5,book:6,
 temperature:7,wave:8,layers:9,settings:10,ruler:11,folder:12,
 chart:13,check:14,warning:15,field:16,workflow:17,info:18,power:19,
} as const;
export type EngineeringIconName = keyof typeof ENGINEERING_ICONS;
const fallbacks = {
 brand:Box,cable:Box,copper:Layers3,aluminium:Layers3,shield:ShieldCheck,
 document:FileText,book:BookOpen,temperature:Thermometer,wave:Activity,
 layers:Layers3,settings:Settings2,ruler:Box,folder:FolderOpen,chart:Activity,
 check:CheckCircle2,warning:TriangleAlert,field:Activity,workflow:Workflow,
 info:BookOpen,power:Zap,
};
export function EngineeringIcon({name,size=28,label,className=''}:{
 name:EngineeringIconName;size?:number;label?:string;className?:string;
}){
 const [failed,setFailed]=useState(false);
 const Fallback=fallbacks[name];
 const isBrand=name==='brand';
 return <span className={`kit-icon ${className}`} style={{width:size,height:size}}
  data-kit-icon={name} data-asset-state={failed?'fallback':'image'}
  role={label?'img':undefined} aria-label={label} aria-hidden={label?undefined:true}>
  {failed?<Fallback size={size} aria-hidden="true"/>:<img alt="" draggable={false}
   src={`/engineering-kit/${name}.webp`}
   width={isBrand?128:64} height={isBrand?128:64}
   style={{width:size,height:size,left:0,top:0}}
   onError={()=>setFailed(true)}/>}
 </span>;
}

export function BrandLogo(){
 return <span className="kit-brand"><EngineeringIcon name="brand" size={46}/><b>CableSim<span>Pro</span></b></span>;
}
