import {useId,type ReactNode} from 'react';
import {ArrowLeft,Search,X} from 'lucide-react';
import {Button} from './primitives';
import './collection-workspace.css';

/** Collection pages share chrome, density and states; domain data stays with the caller. */
export function CollectionWorkspace({title,subtitle,actions,filters,children,onBack}:{title:string;subtitle:string;actions:ReactNode;filters:ReactNode;children:ReactNode;onBack:()=>void}){
 const id=useId();
 return <section className="collection-workspace white-components" aria-labelledby={id}>
  <header className="collection-heading"><div><Button variant="quiet" onClick={onBack} aria-label="返回电缆结构"><ArrowLeft size={17}/></Button><div><span className="collection-eyebrow">ENGINEERING LIBRARY</span><h1 id={id}>{title}</h1><p>{subtitle}</p></div></div><div className="collection-actions">{actions}</div></header>
  <div className="collection-toolbar">{filters}</div>{children}
 </section>;
}
export function CollectionSearch({value,onChange,label}:{value:string;onChange:(s:string)=>void;label:string}){
 return <label className="collection-search"><Search size={16}/><input type="search" aria-label={label} value={value} maxLength={128} placeholder="搜索名称或资产标识" onChange={e=>onChange(e.target.value)}/></label>;
}
export function CollectionEmpty({icon,title,children,action}:{icon:ReactNode;title:string;children:ReactNode;action?:ReactNode}){
 return <div className="collection-empty"><div aria-hidden="true">{icon}</div><h2>{title}</h2><p>{children}</p>{action}</div>;
}
export function DetailHeading({title,meta,onClose}:{title:string;meta:ReactNode;onClose:()=>void}){
 return <header className="collection-detail-heading"><div>{meta}<h2>{title}</h2></div><Button variant="quiet" aria-label="关闭资产详情" onClick={onClose}><X size={17}/></Button></header>;
}
