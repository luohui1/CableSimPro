import {forwardRef, useId, type HTMLAttributes, type ReactNode} from 'react';
import {Info, X} from 'lucide-react';
import {Button} from './primitives';

/** Every domain page owns its data; this component owns only page hierarchy. */
export function WorkspaceHeader({title,context,description,actions}:{title:string;context?:string;description?:ReactNode;actions?:ReactNode}) {
 const id=useId();
 return <header className="pc-page-heading"><div className="pc-page-identity">{context&&<span>{context}</span>}<h1>{title}</h1></div><div className="pc-page-actions">{description&&<details className="pc-page-help"><summary aria-label={`${title}说明`}><Info size={16}/><span>范围说明</span></summary><div id={id}>{description}</div></details>}{actions}</div></header>;
}
export function WorkspacePage({title,context,description,actions,children,hidden=false,className=''}:{title:string;context?:string;description?:ReactNode;actions?:ReactNode;children:ReactNode;hidden?:boolean;className?:string}) {
 return <section hidden={hidden} className={`enterprise-page pc-domain-page ${className}`} aria-label={title}><WorkspaceHeader title={title} context={context} description={description} actions={actions}/><ScrollRegion label={`${title}内容`} className="pc-domain-content">{children}</ScrollRegion></section>;
}
/** Native scrolling must be reachable even when the panel contains only text. */
export const ScrollRegion=forwardRef<HTMLDivElement,HTMLAttributes<HTMLDivElement>&{label:string}>(function ScrollRegion({label,className='',children,...props},ref){
 return <div {...props} ref={ref} role="region" aria-label={label} tabIndex={0} className={`pc-scroll-region ${className}`}>{children}</div>;
});
export function SurfaceNotice({title,children,onDismiss,tone='info'}:{title:string;children?:ReactNode;onDismiss?:()=>void;tone?:'info'|'warning'|'danger'}) {
 return <div className={`pc-notice pc-notice--${tone}`} role={tone==='danger'?'alert':'status'}><Info size={16}/><div><b>{title}</b>{children&&<p>{children}</p>}</div>{onDismiss&&<Button variant="quiet" aria-label="关闭提示" onClick={onDismiss}><X size={15}/></Button>}</div>;
}
