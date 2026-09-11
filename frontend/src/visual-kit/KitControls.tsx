import type {ButtonHTMLAttributes,ReactNode} from 'react';
import {EngineeringIcon,type EngineeringIconName} from './EngineeringIcon';

type Tone='silver'|'blue'|'copper'|'success'|'warning'|'danger';
export function KitButton({tone='silver',icon,className='',children,type='button',...props}:
 ButtonHTMLAttributes<HTMLButtonElement>&{tone?:Tone;icon?:EngineeringIconName}){
 return <button {...props} type={type} className={`kit-button kit-${tone} ${className}`}>
  {icon&&<EngineeringIcon name={icon} size={24}/>}<span>{children}</span>
 </button>;
}
export function KitBadge({tone='silver',children}:{tone?:Tone;children:ReactNode}){
 return <span className={`kit-badge kit-${tone}`}>{children}</span>;
}
export function KitStatus({tone='success',children}:{tone?:'success'|'warning'|'danger'|'blue';children:ReactNode}){
 return <span className={`kit-status kit-${tone}`}><i aria-hidden="true"/>{children}</span>;
}
