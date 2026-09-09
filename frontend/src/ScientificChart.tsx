import {useEffect,useRef} from 'react';
import * as echarts from 'echarts/core';
import {LineChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,LegendComponent,DataZoomComponent,MarkLineComponent,AriaComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import {download} from './utils';
import {csvCell, SWEEP_PARAMETERS, sweepParameter} from './sweepStudy';
echarts.use([LineChart,GridComponent,TooltipComponent,LegendComponent,DataZoomComponent,MarkLineComponent,AriaComponent,CanvasRenderer]);
export interface Series {name:string;points:[number,number|null][]}
export const engineeringAxisLabel=(value:string)=>{const key=sweepParameter(value);return key?`${SWEEP_PARAMETERS[key].label} / ${SWEEP_PARAMETERS[key].unit}`:value};
export function EngineeringChart({series,xLabel,yLabel,label,threshold}:{series:Series[];xLabel:string;yLabel:string;label:string;threshold?:number}){
 const host=useRef<HTMLDivElement>(null),chart=useRef<echarts.EChartsType|null>(null);
 const displayXLabel=engineeringAxisLabel(xLabel),displayYLabel=engineeringAxisLabel(yLabel);
 useEffect(()=>{
  if(!host.current)return;const c=echarts.init(host.current,undefined,{renderer:'canvas',devicePixelRatio:Math.min(devicePixelRatio,2)});chart.current=c;
  c.setOption({animation:false,color:['#256a57','#b56635','#315783','#646464'],textStyle:{fontFamily:'IBM Plex Sans, Noto Sans CJK SC, sans-serif',color:'#3a3a3a'},
   grid:{left:70,right:32,top:68,bottom:88},tooltip:{trigger:'axis',confine:true},legend:{top:3},
   aria:{enabled:true,label:{description:label}},xAxis:{type:'value',name:displayXLabel,nameLocation:'middle',nameGap:34,splitLine:{show:false}},
   yAxis:{type:'value',name:displayYLabel,nameGap:22,scale:true,splitLine:{lineStyle:{color:'#e8e8e6'}}},
   dataZoom:[{type:'inside',filterMode:'none'},{type:'slider',height:14,bottom:8,showDetail:false}],
   series:series.map((s,i)=>({name:s.name,type:'line',data:s.points,connectNulls:false,smooth:false,showSymbol:s.points.length<30,symbolSize:5,lineStyle:{width:2},
    ...(i===0&&threshold!==undefined?{markLine:{symbol:'none',data:[{yAxis:threshold,name:'温度上限'}],lineStyle:{color:'#ac492f',type:'dashed'},label:{formatter:'温度上限 {c}'}}}:{})}))});
  const ro=new ResizeObserver(()=>c.resize());ro.observe(host.current);return()=>{ro.disconnect();c.dispose();chart.current=null};
 },[series,displayXLabel,displayYLabel,label,threshold]);
 const csv=()=>download(label+'.csv','series,x,y\n'+series.flatMap(s=>s.points.map(p=>[s.name,p[0],p[1]].map(csvCell).join(','))).join('\n'),'text/csv;charset=utf-8');
 return <div className="scientific-chart" data-x-label={displayXLabel} data-y-label={displayYLabel} data-missing-points={series.reduce((n,s)=>n+s.points.filter(p=>p[1]===null).length,0)}><div className="chart-actions"><span>{label}</span><button onClick={()=>chart.current?.dispatchAction({type:'dataZoom',start:0,end:100})}>恢复范围</button><button onClick={csv}>导出数据</button></div><div ref={host} role="img" aria-label={label} style={{width:'100%',height:340}}/>
 <details className="chart-data"><summary>查看曲线数据表</summary><table><thead><tr><th>曲线</th><th>{displayXLabel}</th><th>{displayYLabel}</th></tr></thead><tbody>{series.flatMap(s=>s.points.map((p,i)=><tr key={s.name+i}><td>{s.name}</td><td>{p[0].toPrecision(6)}</td><td>{p[1]===null?'—':p[1].toPrecision(6)}</td></tr>))}</tbody></table></details></div>;
}
