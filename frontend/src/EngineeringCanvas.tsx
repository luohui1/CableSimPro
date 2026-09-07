import {useEffect,useRef,useState} from 'react';
import {Stage,Layer,Rect,Line,Text,Circle,Group,Arrow} from 'react-konva';
import {MousePointer2,Hand,Maximize,ZoomIn,ZoomOut,LockKeyhole} from 'lucide-react';
import {useStudio} from './StudioState';
import {fmt,layers} from './utils';
import {positions} from './geometry';
export default function EngineeringCanvas(){
 const {w,busy,edit,phase,setPhase,select}=useStudio();
 const host=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:600,height:430}),[zoom,setZoom]=useState(1),[pan,setPan]=useState(false),[offset,setOffset]=useState({x:0,y:0});
 useEffect(()=>{const el=host.current;if(!el)return;const ro=new ResizeObserver(()=>setSize({width:Math.max(200,el.clientWidth),height:Math.max(180,el.clientHeight)}));ro.observe(el);return()=>ro.disconnect()},[]);
 if(!w)return null;
 const e=w.scenario.installation,ls=layers(w.scenario.cable),ps=positions(e),width=size.width,height=size.height;
 const base=Math.min((width-140)/Math.max(1.2,e.spacing_m*3+0.3),(height-150)/Math.max(1.2,...ps.map(p=>p[1]+0.22)));
 const scale=base*zoom,origin={x:width/2+offset.x,y:76+offset.y};
 const X=(x:number)=>origin.x+x*scale,Y=(h:number)=>origin.y+h*scale;
 const spacingLocked=w.locks.includes('installation.spacing_m'),depthLocked=w.locks.includes('installation.depth_m');
 const grid=[];
 for(let i=-40;i<=40;i++){const v=i/10;if(X(v)>32&&X(v)<width)grid.push(<Line key={'x'+i} points={[X(v),30,X(v),height-24]} stroke={i%5===0?'#d5dee5':'#e9eef2'} strokeWidth={1}/>);if(Y(v)>30&&Y(v)<height-24)grid.push(<Line key={'y'+i} points={[32,Y(v),width,Y(v)]} stroke={i%5===0?'#d5dee5':'#e9eef2'} strokeWidth={1}/>)}
 function drag(index:number,x:number,y:number){
  const h=(y-origin.y)/scale,xx=(x-origin.x)/scale,s=e.spacing_m;
  let spacing=s,depth=e.depth_m;
  if(e.arrangement==='flat'){depth=h;if(index!==1)spacing=Math.abs(xx)}
  else if(index===0){depth=h+s/Math.sqrt(3)}
  else {spacing=2*Math.abs(xx);depth=h-spacing/(2*Math.sqrt(3))}
  const changes=[];
  if(!depthLocked)changes.push({path:'installation.depth_m',value:Math.round(depth*100)/100});
  if(!spacingLocked&&!(e.arrangement==='trefoil'&&index===0)&&!(e.arrangement==='flat'&&index===1))changes.push({path:'installation.spacing_m',value:Math.round(spacing*100)/100});
  if(changes.length)void edit(changes,'画布拖动 · 10 mm 吸附');
 }
 return <div className="canvas-panel"><div className="canvas-toolbar"><button className={!pan?'chosen':''} onClick={()=>setPan(false)} title="选择与编辑"><MousePointer2 size={15}/></button><button className={pan?'chosen':''} onClick={()=>setPan(true)} title="平移画布"><Hand size={15}/></button><span className="separator"/><button title="放大" onClick={()=>setZoom(z=>Math.min(3,z*1.2))}><ZoomIn size={15}/></button><button title="缩小" onClick={()=>setZoom(z=>Math.max(.5,z/1.2))}><ZoomOut size={15}/></button><button title="适应视图" onClick={()=>{setZoom(1);setOffset({x:0,y:0})}}><Maximize size={15}/></button><span className="canvas-tool-label">XY · 敷设截面</span><span className="tool-spacer"/><span className="snap-tag">吸附 10 mm</span></div>
 <div className="canvas-host" ref={host} data-testid="engineering-canvas" data-scale={scale} data-origin-x={origin.x} data-origin-y={origin.y}>
 <Stage width={width} height={height} onWheel={ev=>{ev.evt.preventDefault();setZoom(z=>Math.max(.5,Math.min(3,z*(ev.evt.deltaY<0?1.08:.92))))}}>
 <Layer><Rect width={width} height={height} fill="#f7f9fb"/>{grid}
 <Rect x={32} y={Y(0)} width={width-32} height={Math.max(0,height-Y(0))} fill="#e7eee9" opacity={.4}/>
 <Line points={[32,Y(0),width,Y(0)]} stroke="#7b9c87" strokeWidth={2}/><Text x={52} y={Y(0)-24} text={`恒温地表  θa = ${fmt(e.ambient_temperature_c)} °C`} fontSize={11} fill="#65816f"/>
 <Text x={width-232} y={height-60} text={`均匀土壤\nρth = ${fmt(e.soil_rho_k_m_w,2)} K·m/W`} lineHeight={1.7} fontSize={12} fill="#7d8a85"/>
 <Rect width={32} height={height} fill="#eef2f5"/><Rect width={width} height={28} fill="#eef2f5"/>
 {Array.from({length:41},(_,i)=>(i-20)/10).map((v,i)=><Group key={i}>{X(v)>40&&X(v)<width&&<><Line points={[X(v),20,X(v),28]} stroke="#8798a9"/><Text x={X(v)-16} y={5} width={32} align="center" text={v.toFixed(1)} fontSize={9} fill="#70849a"/></>}{Y(v)>45&&Y(v)<height-20&&<><Line points={[23,Y(v),32,Y(v)]} stroke="#8798a9"/><Text x={2} y={Y(v)-5} text={v.toFixed(1)} fontSize={9} fill="#70849a"/></>}</Group>)}
 <Text x={8} y={8} text="m" fontSize={10} fill="#687d93"/>
 <Arrow points={[X(-Math.max(e.spacing_m+.14,.32)),Y(0)+4,X(-Math.max(e.spacing_m+.14,.32)),Y(e.depth_m)-4]} pointerAtBeginning pointerLength={5} pointerWidth={4} stroke="#7a8ca2" fill="#7a8ca2" strokeWidth={1}/>
 <Text x={X(-Math.max(e.spacing_m+.14,.32))-74} y={Y(e.depth_m/2)-7} text={`${fmt(e.depth_m,2)} m`} fontSize={12} fill="#576e88"/>
 {ps.map(([x,h],i)=><Group key={i} x={X(x)} y={Y(h)} draggable={!busy&&!pan&&!(depthLocked&&spacingLocked)} onClick={()=>{setPhase(i);select('installation')}} onTap={()=>{setPhase(i);select('installation')}} onDragStart={()=>setPhase(i)} onDragEnd={ev=>{const target=ev.target;const px=target.x(),py=target.y();target.position({x:X(x),y:Y(h)});drag(i,px,py)}}>
 <Circle radius={Math.max(14,ls[5].radius_mm/1000*scale+7)} fill={phase===i?'#e0ecff':'#f0f3f6'} stroke={phase===i?'#4d81cf':'#d4dce3'} strokeWidth={phase===i?1.5:1} dash={phase===i?[3,3]:undefined}/>
 {[...ls].reverse().map(l=><Circle key={l.name} radius={l.radius_mm/1000*scale} fill={l.color} listening={false}/>)}
 <Text x={-20} y={-42} width={40} text={'ABC'[i]} align="center" fontStyle="bold" fontSize={12} fill={phase===i?'#3466af':'#546579'}/>
 </Group>)}
 {e.arrangement==='flat'&&<><Line points={[X(0),Y(e.depth_m)+52,X(0),Y(e.depth_m)+78,X(e.spacing_m),Y(e.depth_m)+78,X(e.spacing_m),Y(e.depth_m)+52]} stroke="#9faec0" strokeWidth={1}/><Text x={X(e.spacing_m/2)-50} y={Y(e.depth_m)+82} width={100} align="center" text={`${fmt(e.spacing_m*1000,0)} mm`} fontSize={10} fill="#526e8a"/></>}
 {pan&&<Rect x={32} y={28} width={width-32} height={height-28} fill="rgba(0,0,0,0.001)" draggable onDragEnd={ev=>{setOffset(o=>({x:o.x+ev.target.x()-32,y:o.y+ev.target.y()-28}));ev.target.position({x:32,y:28})}}/>}
 {width>560&&<Group x={width-252} y={100}><Rect width={222} height={144} fill="#fffffff5" stroke="#dce5ed" cornerRadius={4}/><Text x={14} y={14} text="回路局部放大 · 结构示意" fontSize={10} fill="#718ba5"/>{[0,1,2].map(i=><Group key={i} x={45+i*66} y={80}><Circle radius={23} fill="#edf3fb" stroke={phase===i?'#6799dc':'#d5e1ee'} dash={[3,3]}/>{[...ls].reverse().map(l=><Circle key={l.name} radius={l.radius_mm/ls[5].radius_mm*19} fill={l.color}/>)}<Text x={-20} y={31} width={40} text={'ABC'[i]} fontSize={11} align="center" fill="#627e9a"/></Group>)}<Text x={14} y={124} text="此框非敷设位置图 · 尺寸以主画布为准" fontSize={8} fill="#95a5b6"/></Group>}
 <Text x={48} y={height-22} text={`1 回路 / 3 × 单芯 · ${e.arrangement==='flat'?'水平排列':'等边三角排列'} · 尺度一致`} fontSize={10} fill="#73859a"/>
 </Layer></Stage>
 <div className="canvas-caption"><span className="live-dot"/> CKT-01 <b>{w.scenario.cable.area_mm2} mm²</b><small>外径 {fmt(ls[5].radius_mm*2,2)} mm</small></div>
 </div><div className="canvas-hint"><LockKeyhole size={12}/><span>拖动外相调整间距与埋深；中相 / 顶相调整埋深。仅支持规则排列，不是任意多回路 CAD。</span></div></div>;
}
