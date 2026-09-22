import {useId} from 'react';
import type {Result,Scenario} from '../types';
import {fmt} from '../utils';
import {objects,layerKeys,type ObjectKey} from './fields';

export interface GeometryLayer {uid:string;role:string;inner_radius_m:number;outer_radius_m:number}
/** Presentation only; radii come from the saved backend geometry recipe. */
export function CableSection({layers,selection,onSelect,zoom=100,dimensions=true,conductor='copper'}:{
 layers:GeometryLayer[];selection:ObjectKey;onSelect:(s:ObjectKey)=>void;zoom?:number;dimensions?:boolean;conductor?:'copper'|'aluminium';
}){
 const id=useId().replaceAll(':',''),outer=layers.at(-1)!.outer_radius_m;
 const index=layerKeys.indexOf(selection),selected=layers[index];
 const radius=165*zoom/100,centerX=320,centerY=254;
 const wireFill=conductor==='copper'?'#c39264':'#b6bfc6';
 return <svg className="wf-section" viewBox="0 0 640 530" role="img" aria-label="已保存工程的等比例电缆截面" data-diameter-mm={(outer*2000).toFixed(6)}>
  <defs><pattern id={`wire-${id}`} width="12" height="10.4" patternUnits="userSpaceOnUse"><rect width="12" height="10.4" fill={conductor==='copper'?'#926947':'#828e96'}/><circle cx="6" cy="5.2" r="4.9" fill={wireFill} stroke={conductor==='copper'?'#ecccb0':'#dbe0e4'} strokeWidth=".55"/></pattern></defs>
  <g className="wf-centerlines"><path d={`M${centerX-radius-30} ${centerY}H${centerX+radius+30}M${centerX} ${centerY-radius-30}V${centerY+radius+30}`}/></g>
  {[...layers].reverse().map(layer=>{const i=layers.indexOf(layer),key=layerKeys[i];return <circle key={layer.uid} data-layer={key} cx={centerX} cy={centerY} r={layer.outer_radius_m/outer*radius} className={`wf-layer wf-layer-${i}`} style={i===0?{fill:`url(#wire-${id})`}:undefined} onClick={()=>onSelect(key)}/>})}
  {selected&&<circle cx={centerX} cy={centerY} r={selected.outer_radius_m/outer*radius} fill="none" stroke="var(--wf-blue)" strokeWidth="2.2" pointerEvents="none"/>}
  {dimensions&&<g className="wf-dimension" pointerEvents="none"><path d={`M${centerX-radius} ${centerY+radius+16}v26M${centerX+radius} ${centerY+radius+16}v26M${centerX-radius} ${centerY+radius+33}h${radius*2}`}/><path d={`M${centerX-radius+6} ${centerY+radius+30}l-6 3 6 3M${centerX+radius-6} ${centerY+radius+30}l6 3-6 3`}/><text x={centerX} y={centerY+radius+57} textAnchor="middle">Ø {fmt(outer*2000,3)} mm</text></g>}
  {selected&&dimensions&&zoom<=110&&<g className="wf-section-label" pointerEvents="none"><path d={`M${centerX+selected.outer_radius_m/outer*radius*.707} ${centerY-selected.outer_radius_m/outer*radius*.707}L505 82H588`}/><text x="505" y="60">{String(index+1).padStart(2,'0')} / {objects[selection].name}</text><text x="505" y="77" className="wf-label-value">{index===0?`Ø ${fmt(selected.outer_radius_m*2000,3)} mm`:`t = ${fmt((selected.outer_radius_m-selected.inner_radius_m)*1000,3)} mm`}</text></g>}
 </svg>;
}

/** Dimensioned layout, not a soil-temperature plot or a new geometry solver. */
export function InstallationDiagram({scenario:s,diameterMm}:{scenario:Scenario;diameterMm?:number}){
 const a=s.installation,spacing=a.spacing_m,offset=spacing/(2*Math.sqrt(3));
 const centers=a.arrangement==='flat'?[[-spacing,a.depth_m],[0,a.depth_m],[spacing,a.depth_m]]:[[-spacing/2,a.depth_m+offset],[0,a.depth_m-2*offset],[spacing/2,a.depth_m+offset]];
 const domainWidth=Math.max(spacing*4,a.depth_m*1.5),domainHeight=Math.max(...centers.map(p=>p[1]))*1.25;
 const scale=Math.min(520/domainWidth,200/domainHeight),x=(v:number)=>300+v*scale,y=(v:number)=>40+v*scale;
 const r=Math.max(2,(diameterMm??0)/2000*scale);
 return <figure className="wf-installation-figure"><svg viewBox="0 0 600 300" role="img" aria-label="当前已保存敷设方案示意">
  <path d="M36 40H564" className="wf-ground"/><text x="40" y="27">地表</text><text x="560" y="27" textAnchor="end">{a.arrangement==='flat'?'平行排列':'三角形排列'}</text>
  {centers.map(([cx,cy],i)=><g key={i}><circle cx={x(cx)} cy={y(cy)} r={r} className="wf-cable-location"/><text x={x(cx)} y={y(cy)-r-9} textAnchor="middle">{'ABC'[i]}</text></g>)}
  <path d={`M75 40V${y(a.depth_m)}H${x(centers[0][0])-r-10}`} className="wf-dimension-line"/><text x="80" y={(40+y(a.depth_m))/2}>h̄ = {a.depth_m} m</text>
  <text x="300" y="270" textAnchor="middle">相邻中心间距 {spacing} m · 截面布置（非温度场）</text>
 </svg><figcaption>尺寸与布置读取已保存工程。很小的缆径以最小标记显示，不作为制造图。</figcaption></figure>;
}

/** Uses only the curve returned by the saved run; no fabricated samples. */
export function SavedCurve({result:r}:{result:Result}){
 const points=r.curve.filter(p=>Number.isFinite(p.current_a)&&Number.isFinite(p.temperature_c));
 if(points.length<2||!points.some(p=>p.current_a>0))return <p className="wf-muted">该运行没有可绘制的电流—温度曲线。</p>;
 const maxX=Math.max(...points.map(p=>p.current_a)),minY=Math.floor(Math.min(...points.map(p=>p.temperature_c))/20)*20,maxY=Math.ceil(Math.max(r.input.cable.max_temperature_c,...points.map(p=>p.temperature_c))/20)*20;
 const x=(v:number)=>62+v/maxX*558,y=(v:number)=>248-(v-minY)/Math.max(maxY-minY,1)*206;
 return <figure className="wf-curve"><header><h2>电流—导体温度</h2><span>保存运行的离散计算点</span></header><svg viewBox="0 0 650 298" role="img" aria-label="保存运行的电流与导体温度曲线">
  {[0,1,2,3,4].map(i=><g key={i}><path className="wf-chart-grid" d={`M62 ${42+i*206/4}H620`}/><text x="49" y={46+i*206/4} textAnchor="end">{Math.round(maxY-i*(maxY-minY)/4)}</text><text x={62+i*558/4} y="270" textAnchor="middle">{Math.round(i*maxX/4)}</text></g>)}
  <path className="wf-chart-limit" d={`M62 ${y(r.input.cable.max_temperature_c)}H620`}/><text x="617" y={y(r.input.cable.max_temperature_c)-8} textAnchor="end">限值 {r.input.cable.max_temperature_c} °C</text>
  <path className="wf-chart-line" d={points.map((p,i)=>`${i?'L':'M'}${x(p.current_a)} ${y(p.temperature_c)}`).join(' ')}/>
  <text x="28" y="24">°C</text><text x="620" y="290" textAnchor="end">电流 / A</text>
 </svg></figure>;
}
