import {useId,type ReactNode} from 'react';
import type {AmpacityDiagnostics,LossSlice} from '../dual-mode/ampacity-diagnostics';
import {fmt} from '../utils';
import {EngineeringIcon,type EngineeringIconName} from './EngineeringIcon';
import './kit-components.css';

export function KitMetric({label,value,unit,detail,icon,tone='normal',testId}:{
 label:string;value:number|null;unit:string;detail:ReactNode;icon?:EngineeringIconName;
 tone?:'normal'|'danger'|'muted';testId?:string;
}) {
 return <article className={`kit-instrument kit-instrument-${tone}`} data-testid={testId}>
  {icon&&<EngineeringIcon name={icon} size={32}/>}
  <div><small>{label}</small><strong>{value===null?'—':fmt(value,1)} <em>{unit}</em></strong><p>{detail}</p></div>
 </article>;
}

/** The reference ring supplies a visual style only. Every arc uses solver loss data. */
export function KitLossBudget({losses,total,stateLabel}:{losses:LossSlice[];total:number;stateLabel:string}) {
 const id=useId(),circumference=2*Math.PI*53;
 let offset=0;
 return <div className="kit-loss-budget" data-testid="kit-loss-budget">
  <div className="kit-loss-ring">
   <svg viewBox="0 0 150 150" role="img" aria-labelledby={id}>
    <title id={id}>{stateLabel}损耗预算：{losses.map(x=>`${x.label} ${fmt(x.sharePercent,1)}%`).join('，')}</title>
    <circle className="kit-ring-rim" cx="75" cy="75" r="69"/>
    <circle className="kit-ring-bed" cx="75" cy="75" r="53"/>
    {losses.map(item=>{
     const length=circumference*Math.min(100,Math.max(0,item.sharePercent))/100;
     const start=offset;offset+=length;
     return <circle key={item.key} className={`kit-ring-slice kit-loss-${item.key}`} cx="75" cy="75" r="53"
      fill="none" strokeDasharray={`${length} ${circumference-length}`} strokeDashoffset={-start}
      transform="rotate(-90 75 75)" data-loss-key={item.key} data-share={item.sharePercent}/>;
    })}
   </svg>
   <div className="kit-ring-value" aria-hidden="true"><b>{fmt(total,2)}</b><span>W/m · 三相</span></div>
  </div>
  <table className="kit-loss-table"><caption className="kit-sr-only">{stateLabel}三相每米损耗明细</caption>
   <thead><tr><th scope="col">来源</th><th scope="col">W/m</th><th scope="col">占比</th></tr></thead>
   <tbody>{losses.map(item=><tr key={item.key} data-loss-row={item.key} data-w-m={item.wPerM}>
    <th scope="row"><i className={`kit-loss-key kit-loss-${item.key}`} aria-hidden="true"/>{item.label}</th>
    <td>{fmt(item.wPerM,3)}</td><td>{fmt(item.sharePercent,1)}%</td>
   </tr>)}</tbody>
  </table>
 </div>;
}

export function KitTemperaturePath({diagnosis:d}:{diagnosis:AmpacityDiagnostics}) {
 const id=useId(),rise=d.internalRiseC+d.externalRiseC;
 return <figure className="kit-temperature-path" data-testid="kit-temperature-path" data-state={d.stateMode}>
  <figcaption id={id}>{d.displayPhase} 相 · {d.stateLabel}</figcaption>
  <div className="kit-temperature-nodes">
   {[['导体',d.conductorTemperatureC],['缆表',d.surfaceTemperatureC],['环境',d.ambientTemperatureC]].map(([label,value])=><div key={String(label)}><small>{label}</small><strong>{fmt(Number(value),1)}<em> °C</em></strong></div>)}
  </div>
  <div className="kit-temperature-track" role="img" aria-label={`缆体径向温升 ${fmt(d.internalRiseC,1)} °C，外部土壤温升 ${fmt(d.externalRiseC,1)} °C`}>
   <span className="kit-heat-internal" style={{width:`${d.internalRiseShare}%`}}/>
   <span className="kit-heat-external" style={{width:`${d.externalRiseShare}%`}}/>
  </div>
  <dl className="kit-temperature-values"><div><dt><i className="kit-heat-internal"/>缆体径向 ΔT</dt><dd>{fmt(d.internalRiseC,1)} °C</dd></div><div><dt><i className="kit-heat-external"/>外部土壤 ΔT</dt><dd>{fmt(d.externalRiseC,1)} °C</dd></div></dl>
  {rise===0&&<p>当前状态无可显示温升。</p>}
 </figure>;
}
