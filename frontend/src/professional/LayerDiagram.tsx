import {useId} from 'react';
import type {Cable} from '../types';
import {layers,fmt} from '../utils';
/** Same live six-layer radii as the solver input, not a generated cable picture. */
export default function LayerDiagram({cable}:{cable:Cable}){
 const id=useId(),ls=layers(cable),outer=ls[5].radius_mm,scale=96/outer;
 const colors=[cable.conductor==='copper'?'#c38b56':'#aab8c9','#344054','#e7edf2','#526070','#b88655','#182535'];
 const wires=[];const strand=ls[0].radius_mm*scale/7.1;
 for(let row=-3;row<=3;row++)for(let col=-3;col<=3;col++){
  const x=col*strand*2+(row%2)*strand,y=row*strand*Math.sqrt(3);
  if(Math.hypot(x,y)<=ls[0].radius_mm*scale-strand)wires.push(<circle key={`${row}:${col}`} cx={126+x} cy={159+y} r={strand*.85} fill={colors[0]} stroke="#80512d" strokeWidth=".6"/>);
 }
 return <section className="wb-section-preview" aria-label="当前电缆分层预览"><header><h2>电缆横截面</h2><span>六层等效结构</span></header><svg viewBox="0 0 420 320" role="img" aria-labelledby={id}><title id={id}>当前输入分层截面，外径 {fmt(outer*2,2)} 毫米</title><path d="M15 159H231 M126 48V274" stroke="#dce5ef" strokeDasharray="3 5"/>{[...ls].reverse().map((l,j)=>{const i=5-j;return <circle key={l.name} cx="126" cy="159" r={l.radius_mm*scale} fill={colors[i]} stroke="#8998a7" strokeWidth=".7"/>})}{wires}{ls.map((l,i)=>{const angle=(-66+i*27)*Math.PI/180;const x=126+Math.cos(angle)*l.radius_mm*scale,y=159+Math.sin(angle)*l.radius_mm*scale,ty=46+i*43;return <g key={l.name}><path d={`M${x} ${y} L250 ${ty} H263`} stroke="#7087a3" fill="none" strokeWidth=".8"/><circle cx={x} cy={y} r="2" fill="#155eef"/><text x="269" y={ty-3} className="wb-layer-label">{l.name}</text><text x="269" y={ty+13} className="wb-layer-value">{i===0?`${fmt(cable.area_mm2,0)} mm²`:`${fmt(l.radius_mm-ls[i-1].radius_mm,2)} mm`}</text></g>})}<text x="126" y="296" textAnchor="middle" className="wb-diameter">Ø {fmt(outer*2,2)} mm</text></svg><p>尺寸随工程更新 · 示意股线不参与求解</p></section>;
}
