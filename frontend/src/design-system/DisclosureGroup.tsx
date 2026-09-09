import {useId, useState, type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';

/** View state only. Keep fields mounted so collapsing never discards a draft or lock. */
export function DisclosureGroup({title, count, draftCount = 0, lockedCount = 0, children}: {
 title: string; count: number; draftCount?: number; lockedCount?: number; children: ReactNode;
}) {
 const [expanded, setExpanded] = useState(true);
 const id = useId();
 return <section className="wb-property-group" aria-labelledby={`${id}-title`}>
  <h3><button type="button" id={`${id}-title`} aria-label={title} aria-expanded={expanded}
   aria-controls={`${id}-fields`} onClick={() => setExpanded(value => !value)}>
   <span>{title}</span><span className="wb-group-count" aria-hidden="true">{count}</span>
   {draftCount > 0 && <span className="wb-group-draft">{draftCount} 项未提交</span>}
   <ChevronDown size={15} aria-hidden="true"/>
  </button></h3>
  <div id={`${id}-fields`} hidden={!expanded}>{children}</div>
  {!expanded && lockedCount > 0 && <p className="wb-group-note">{lockedCount} 项参数已锁定</p>}
 </section>;
}
