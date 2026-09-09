import {useId, type ButtonHTMLAttributes, type ReactNode} from 'react';
export type Tone='neutral'|'info'|'success'|'warning'|'danger';
/** Native semantics and keyboard behavior; no independent engineering state. */
export function Button({variant='secondary',className='',type='button',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'quiet'}){
 return <button {...props} type={type} className={`wb-button wb-button--${variant} ${className}`}/>;
}
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:Tone}){
 return <span className={`wb-badge wb-tone-${tone}`}>{children}</span>;
}
export function MetricTile({label,value,unit,detail,icon,tone='neutral'}:{label:string;value:string;unit?:string;detail:string;icon:ReactNode;tone?:Tone}){
 return <div className={`wb-metric wb-tone-${tone}`}><span className="wb-metric-icon" aria-hidden="true">{icon}</span><div><span className="wb-metric-label">{label}</span><strong>{value}<small>{unit}</small></strong><span className="wb-metric-detail">{detail}</span></div></div>;
}
export function Panel({title,actions,children,className=''}:{title:string;actions?:ReactNode;children:ReactNode;className?:string}){
 const id=useId();return <section className={`wb-panel ${className}`} aria-labelledby={id}><header className="wb-panel-heading"><h2 id={id}>{title}</h2>{actions}</header>{children}</section>;
}
