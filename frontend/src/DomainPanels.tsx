import {ArrowRight} from 'lucide-react';
import {useStudio} from './StudioState';
import {IntegrationsPanel,LibraryPanel,SelectionPanel} from './LibraryDesignPanels';
import {FieldPanel} from './CableFieldPanel';
export {IntegrationsPanel,LibraryPanel,SelectionPanel,FieldPanel};

// Keep the field renderer independent from provider/document/catalog UI.
export function DomainWorkspace({mode,onBack}:{mode:string;onBack?:()=>void}) {
 const {setTab}=useStudio();
 const titles:Record<string,string>={library:'企业资料库',selection:'型号库与反向选型',fields:'电缆专项场分析',integrations:'OCR / Agent 接入'};
 return <section className="domain-workspace"><header className="domain-header"><div><span className="domain-kicker">CABLE ENGINEERING / {mode.toUpperCase()}</span><h2>{titles[mode]}</h2></div><button onClick={()=>onBack?onBack():setTab('installation')}>返回敷设视图 <ArrowRight size={14}/></button></header><div className="domain-body">{mode==='integrations'?<IntegrationsPanel/>:mode==='library'?<LibraryPanel/>:mode==='selection'?<SelectionPanel/>:<FieldPanel/>}</div></section>;
}
