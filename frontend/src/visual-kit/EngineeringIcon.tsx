import {useState} from 'react';
import {Activity,BookOpen,Box,CheckCircle2,Database,FileText,FlaskConical,FolderOpen,Layers3,LockKeyhole,Omega,Pencil,Settings2,ShieldCheck,Thermometer,TriangleAlert,Workflow,XCircle,Zap} from 'lucide-react';

/** Decorative subjects extracted from the approved sheets. Never use the field
 * icon as a calculated temperature map. Native text and units remain selectable. */
export const ENGINEERING_ICONS = {
 brand:0,cable:1,copper:2,aluminium:3,shield:4,document:5,book:6,
 temperature:7,wave:8,layers:9,settings:10,ruler:11,folder:12,
 chart:13,check:14,warning:15,field:16,workflow:17,info:18,power:19,
 locked:20,edit:21,database:22,resistance:23,error:24,lab:25,
} as const;
export type EngineeringIconName = keyof typeof ENGINEERING_ICONS;
const fallbacks = {
 brand:Box,cable:Box,copper:Layers3,aluminium:Layers3,shield:ShieldCheck,
 document:FileText,book:BookOpen,temperature:Thermometer,wave:Activity,
 layers:Layers3,settings:Settings2,ruler:Box,folder:FolderOpen,chart:Activity,
 check:CheckCircle2,warning:TriangleAlert,field:Activity,workflow:Workflow,
 info:BookOpen,power:Zap,locked:LockKeyhole,edit:Pencil,database:Database,
 resistance:Omega,error:XCircle,lab:FlaskConical,
};
export function EngineeringIcon({name,size=28,label,className=''}:{
 name:EngineeringIconName;size?:number;label?:string;className?:string;
}) {
 // Failure belongs to an asset, not this component instance: changing material
 // from copper to aluminium must still attempt to load the aluminium image.
 const [failedName,setFailedName]=useState<EngineeringIconName|null>(null);
 const failed=failedName===name,Fallback=fallbacks[name];
 return <span className={`kit-icon ${className}`} style={{width:size,height:size}}
  data-kit-icon={name} data-asset-state={failed?'fallback':'image'}
  role={label?'img':undefined} aria-label={label} aria-hidden={label?undefined:true}>
  {failed?<Fallback size={size} aria-hidden="true"/>:<img key={name} alt="" draggable={false}
   src={`/engineering-kit/${name}.webp`} width={name==='brand'?128:64} height={name==='brand'?128:64}
   style={{width:size,height:size,left:0,top:0}} onError={()=>setFailedName(name)}/>}
 </span>;
}
export function BrandLogo() {
 return <span className="kit-brand"><EngineeringIcon name="brand" size={46}/><b>CableSim<span>Pro</span></b></span>;
}
