import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {cableAppearance,disposeScene} from './visual-assets/cableAppearance';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import type {Cable} from './types';
import {layers,fmt} from './utils';
import {CrossSection} from './Visuals';
import {Box,RotateCcw,Download,Eye,EyeOff} from 'lucide-react';

type ViewMode='cutaway'|'assembled'|'exploded';
export function buildCableGeometry(cable:Cable,mode:ViewMode,visible:boolean[]){
 const group=new THREE.Group();group.name='单芯电缆';
 const ls=layers(cable);const length=.36;
 group.userData={units:'metres',display_length_m:length,not_route_length:true,cable_input:cable,model_purpose:'参数化结构模型；非制造图',mode};
 const colors=[cable.conductor==='aluminium'?'#bac5cf':'#b5763c','#282d30','#e7e5de','#454c50','#b18861','#202c33'];
 ls.forEach((layer,i)=>{
  const outer=layer.radius_mm/1000,inner=i?ls[i-1].radius_mm/1000:0;
  const len=mode==='assembled'?length:length-i*.042;
  const geo=i===0?new THREE.CylinderGeometry(outer,outer,len,64):new THREE.LatheGeometry([
   new THREE.Vector2(inner,-len/2),new THREE.Vector2(outer,-len/2),new THREE.Vector2(outer,len/2),new THREE.Vector2(inner,len/2),new THREE.Vector2(inner,-len/2)],96);
  const mat=new THREE.MeshStandardMaterial({color:colors[i],metalness:i===0||i===4?.7:.04,roughness:i===0?.38:.64,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geo,mat);mesh.name=layer.name;mesh.rotation.z=-Math.PI/2;
  mesh.position.set(-length/2+len/2,mode==='exploded'?(i-2.5)*.055:0,0);mesh.visible=visible[i];
  mesh.userData={inner_radius_m:inner,outer_radius_m:outer,axial_length_m:len};group.add(mesh);
 });return group;
}
/** Fit the engineering envelope rather than a fixed zoom; keep annotation clearance. */
export function fitCableCamera(camera:THREE.OrthographicCamera,object:THREE.Object3D){
 camera.zoom=1;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);object.updateMatrixWorld(true);
 const box=new THREE.Box3().setFromObject(object);if(box.isEmpty())return;
 let extentX=0,extentY=0;
 for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
  const p=new THREE.Vector3(x,y,z).project(camera);extentX=Math.max(extentX,Math.abs(p.x));extentY=Math.max(extentY,Math.abs(p.y));
 }
 camera.zoom=Math.min(16,Math.max(.5,Math.min(.82/Math.max(extentX,1e-6),.64/Math.max(extentY,1e-6))));
 camera.updateProjectionMatrix();
}
export default function CableModelView({cable}:{cable:Cable}){
 const host=useRef<HTMLDivElement>(null),group=useRef<THREE.Group|null>(null),controls=useRef<OrbitControls|null>(null),cam=useRef<THREE.OrthographicCamera|null>(null);
 const [mode,setMode]=useState<ViewMode>('cutaway'),[visible,setVisible]=useState([true,true,true,true,true,true]),[failed,setFailed]=useState(false),[error,setError]=useState(''),[view,setView]=useState('iso'),[viewRevision,setViewRevision]=useState(0);
 const fit=useRef<()=>void>(()=>{});
 const [annotations,setAnnotations]=useState<{x:number;y:number;labelX:number;name:string;value:string}[]>([]);
 const [grid,setGrid]=useState(false),[dimension,setDimension]=useState(true),[ready,setReady]=useState(false);
 const geometryKey=JSON.stringify(cable)+mode+visible.join(',')+grid;
 useEffect(()=>{
  const el=host.current;if(!el)return;let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:false})}catch{setFailed(true);return}
  setFailed(false);renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor('#f4f7fb');renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.domElement.setAttribute('aria-label','参数化电缆三维模型');el.appendChild(renderer.domElement);
  const scene=new THREE.Scene();
  const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;room.dispose();pmrem.dispose();
  const camera=new THREE.OrthographicCamera(-.32,.32,.24,-.24,.001,10);cam.current=camera;
  const ctl=new OrbitControls(camera,renderer.domElement);controls.current=ctl;ctl.minZoom=.5;ctl.maxZoom=16;ctl.enableDamping=false;ctl.target.set(0,0,0);
  camera.position.set(.33,.14,.8);ctl.update();
  scene.add(new THREE.HemisphereLight(0xffffff,0x8394a5,1.7));const key=new THREE.DirectionalLight(0xffffff,2.4);key.position.set(.2,1,.7);scene.add(key);
  const rim=new THREE.DirectionalLight(0xffffff,2);rim.position.set(-.5,.2,-.7);scene.add(rim);
  const cableGroup=buildCableGeometry(cable,mode,visible);group.current=cableGroup;const display=cableGroup.clone(true);if(visible[0])display.children[0].visible=false;scene.add(display);
  scene.add(cableAppearance(cable,mode,visible));
  if(grid){const floor=new THREE.GridHelper(1,20,0xb8c0b8,0xe1e5de);floor.position.y=mode==='exploded'?-.20:-layers(cable)[5].radius_mm/1000-.003;scene.add(floor)}
  const render=()=>{
   renderer.render(scene,camera);
   const width=el.clientWidth,height=el.clientHeight;
   camera.updateMatrixWorld();
   const ls=layers(cable);
   setAnnotations(ls.flatMap((l,i)=>{
    if(!visible[i]||mode==='assembled')return [];
    const point=new THREE.Vector3(.18-i*.042-.020,(mode==='exploded'?(i-2.5)*.055:0)+l.radius_mm/1000,0).project(camera);
    return [{x:(point.x+1)*width/2,y:(1-point.y)*height/2,labelX:width*(.09+(5-i)*.159),name:l.name,value:i===0?`${fmt(cable.area_mm2,0)} mm²`:`${fmt(l.radius_mm-ls[i-1].radius_mm,2)} mm`}];
   }));
  };
  const resize=()=>{const w=Math.max(el.clientWidth,100),h=Math.max(el.clientHeight,100),aspect=w/h;camera.left=-.25*aspect;camera.right=.25*aspect;camera.top=.25;camera.bottom=-.25;camera.updateProjectionMatrix();fit.current();renderer.setSize(w,h);render()};
  const ro=new ResizeObserver(resize);ro.observe(el);ctl.addEventListener('change',render);resize();setReady(true);
  return()=>{ro.disconnect();ctl.dispose();disposeScene(scene);environment.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();group.current=null;cam.current=null;controls.current=null};
 },[geometryKey]);
 useEffect(()=>{const c=cam.current,ctl=controls.current;if(!c||!ctl)return;
  fit.current=()=>{
   c.position.set(...(view==='front'?[.001,0,.6]:view==='end'?[.6,.001,0]:view==='top'?[0,.6,.001]:[.33,.14,.8]) as [number,number,number]);
   c.up.set(0,1,0);ctl.target.set(0,0,0);c.lookAt(ctl.target);
   if(group.current)fitCableCamera(c,group.current);ctl.update();
  };
  fit.current();return()=>{fit.current=()=>{}};
 },[view,geometryKey,viewRevision]);
 async function exportModel(){if(!group.current)return;setError('');try{
  const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');const data=await new GLTFExporter().parseAsync(group.current,{binary:true,onlyVisible:true});
  if(!(data instanceof ArrayBuffer))throw new Error('模型导出格式错误');const u=URL.createObjectURL(new Blob([data],{type:'model/gltf-binary'}));const a=document.createElement('a');a.href=u;a.download='CableSimPro-cable.glb';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);
 }catch(e){setError(e instanceof Error?e.message:'无法导出模型')}}
 return <div className="model-view"><div className="model-toolbar"><div className="segmented">{[['cutaway','轴向剥切'],['assembled','完整结构'],['exploded','分层展开']].map(([id,label])=><button key={id} aria-pressed={mode===id} className={mode===id?'active':''} onClick={()=>setMode(id as ViewMode)}>{label}</button>)}</div><span className="tool-spacer"/><button title="显示或隐藏网格" aria-pressed={grid} onClick={()=>setGrid(!grid)}>网格</button><button title="显示或隐藏尺寸" aria-pressed={dimension} onClick={()=>setDimension(!dimension)}>尺寸</button><button onClick={()=>{setView('iso');setViewRevision(r=>r+1)}} title="恢复轴测视图"><RotateCcw size={15}/></button><button disabled={!ready||failed} onClick={()=>void exportModel()}><Download size={15}/>导出 GLB</button></div>
 <div className="model-render" ref={host} data-testid="cable-model-view" data-renderer={failed?'fallback':ready?'webgl':'loading'}>{failed&&<div className="model-fallback"><p>WebGL 不可用，显示二维截面；三维导出已停用。</p><CrossSection cable={cable}/></div>}
 <div className="model-caption"><Box size={16}/><div><strong>单芯电缆 · 结构模型</strong><span>{cable.conductor==='copper'?'铜':'铝'}导体 / XLPE 绝缘 / 无铠装</span></div></div>
 {dimension&&<svg className="model-callouts" aria-label="结构分层标注" width="100%" height="100%">{annotations.map((a,i)=><g key={a.name}><path d={`M ${a.labelX} 112 L ${a.labelX} 126 L ${a.x} ${a.y}`} fill="none"/><circle cx={a.x} cy={a.y} r="3"/><text x={a.labelX} y="82" textAnchor="middle">{a.name}</text><text x={a.labelX} y="101" className="callout-value" textAnchor="middle">{a.value}</text></g>)}</svg>}
 <div className="orientation">{[['iso','轴测'],['front','正视'],['end','端面'],['top','俯视']].map(([id,label])=><button key={id} className={view===id?'active':''} onClick={()=>setView(id)}>{label}</button>)}</div>
 {dimension&&<div className="model-dimensions"><span>外径 <b>Ø {fmt(layers(cable)[5].radius_mm*2,2)} mm</b></span><span>导体 <b>{fmt(cable.area_mm2,0)} mm²</b></span><span>展示长度 <b>360 mm</b></span></div>}
 </div>{error&&<p role="alert">{error}</p>}<div className="model-footer"><span>左键旋转 · 右键平移 · 滚轮缩放</span><span>外观线股不参与求解 · GLB 导出等效六层几何</span></div>
 <div className="layer-strip">{layers(cable).map((l,i)=><button key={l.name} className={visible[i]?'':'hidden-layer'} aria-pressed={visible[i]} onClick={()=>setVisible(v=>v.map((x,j)=>i===j?!x:x))}>{visible[i]?<Eye size={12}/>:<EyeOff size={12}/>}<span>{l.name}</span><b>{fmt(l.radius_mm*2,2)} mm</b></button>)}</div></div>;
}
