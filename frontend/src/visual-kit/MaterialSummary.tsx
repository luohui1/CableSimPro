import type {Scenario} from '../types';
import {fmt} from '../utils';
import {EngineeringIcon} from './EngineeringIcon';
import {KitBadge} from './KitControls';

/** Labels/values come only from the saved scenario; reference-sheet numbers are never used. */
export function MaterialSummary({scenario}:{scenario:Scenario}){
 const cable=scenario.cable,copper=cable.conductor==='copper';
 return <section className="kit-materials" aria-label="当前电缆材料摘要">
  <div className="kit-material"><EngineeringIcon name={copper?'copper':'aluminium'} size={37}/>
   <span><small>导体材料</small><b>{copper?'铜 Copper':'铝 Aluminium'}</b></span>
   <KitBadge tone={copper?'copper':'silver'}>{copper?'Cu':'Al'}</KitBadge></div>
  <div className="kit-material"><EngineeringIcon name="layers" size={33}/>
   <span><small>XLPE 绝缘</small><b>{fmt(cable.insulation_mm,1)} <em>mm</em></b></span>
   <small>ρ {fmt(cable.insulation_rho_k_m_w,2)} K·m/W</small></div>
  <div className="kit-material"><EngineeringIcon name="shield" size={34}/>
   <span><small>外护套</small><b>{fmt(cable.jacket_mm,1)} <em>mm</em></b></span>
   <small>ρ {fmt(cable.jacket_rho_k_m_w,2)} K·m/W</small></div>
 </section>;
}
