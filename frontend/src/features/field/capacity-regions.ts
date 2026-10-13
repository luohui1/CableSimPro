import { optionalRecord, text } from '@/api/client';
import type { CapacityRegion } from './heat-capacity-form';

/** Material references in the study input, excluding unused catalog entries. */
export function domainCapacityRegions(value: unknown): CapacityRegion[] {
  const domain=optionalRecord(value), used=new Set<string>();
  function visit(node: unknown) {
    if(typeof node==='string')used.add(node);
    else if(Array.isArray(node))node.forEach(visit);
    else if(node && typeof node==='object')Object.values(node).forEach(visit);
  }
  Object.entries(domain).filter(([key])=>key!=='materials').forEach(([,node])=>visit(node));
  return (Array.isArray(domain.materials)?domain.materials:[]).map(optionalRecord)
    .filter(material=>used.has(text(material.id)))
    .map(material=>({id:text(material.id),label:text(material.label),category:text(material.category)}));
}
