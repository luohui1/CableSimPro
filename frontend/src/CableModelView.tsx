import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {cableAppearance,disposeScene} from './visual-assets/cableAppearance';
import {addStudioLighting,CABLE_STUDIO,roundedShell,studioMaterials} from './visual-assets/cableStudio';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import type {Cable} from './types';
import {layers,fmt} from './utils';
import {CrossSection} from './Visuals';
import {Box,RotateCcw,Download,Eye,EyeOff,Move,Scissors,Layers3,Sparkles,Ruler,Rotate3D,Minus,Plus,Maximize,MoreHorizontal,Grid3X3} from 'lucide-react';

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
/** Fit all corners of the display envelope to a perspective portrait at any aspect. */
export function fitCablePortrait(camera:THREE.PerspectiveCamera,object:THREE.Object3D){
 const direction=new THREE.Vector3(.42,.25,1).normalize();camera.position.copy(direction);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);object.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(object);if(bounds.isEmpty())return;
 const rotation=new THREE.Matrix4().extractRotation(camera.matrixWorld).invert();
 const vertical=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));let distance=.2;
 for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
  const p=new THREE.Vector3(x,y,z).applyMatrix4(rotation);
  distance=Math.max(distance,p.z+Math.abs(p.x)/(vertical*camera.aspect*.84),p.z+Math.abs(p.y)/(vertical*.70));
 }
 camera.position.copy(direction.multiplyScalar(distance));camera.lookAt(0,0,0);camera.updateMatrixWorld(true);camera.updateProjectionMatrix();
}
export default function CableModelView({cable,surface='#f4f7fb',studio=false,compactTools=false,onInspectLayer,onSection,onCompare,compare=false}:{cable:Cable;surface?:string;studio?:boolean;compactTools?:boolean;onInspectLayer?:(index:number)=>void;onSection?:()=>void;onCompare?:()=>void;compare?:boolean}){
 const inspectRef=useRef(onInspectLayer);inspectRef.current=onInspectLayer;
 const [selectedLayer,setSelectedLayer]=useState<number|null>(null);
 const [materialPreview,setMaterialPreview]=useState(studio);
 const finishRef=useRef(materialPreview);finishRef.current=materialPreview;
 const studioRig=useRef<ReturnType<typeof addStudioLighting>|null>(null);
 const technicalRig=useRef<THREE.Group|null>(null);
 const rendererRef=useRef<THREE.WebGLRenderer|null>(null);
 const appearanceRoot=useRef<THREE.Group|null>(null),technicalRoot=useRef<THREE.Group|null>(null);
 const host=useRef<HTMLDivElement>(null),group=useRef<THREE.Group|null>(null),controls=useRef<OrbitControls|null>(null),cam=useRef<THREE.OrthographicCamera|null>(null);
 const sceneRef=useRef<THREE.Scene|null>(null),modelRoot=useRef<THREE.Group|null>(null),renderCurrent=useRef<()=>void>(()=>{});
 const [mode,setMode]=useState<ViewMode>('cutaway'),[visible,setVisible]=useState([true,true,true,true,true,true]),[failed,setFailed]=useState(false),[error,setError]=useState(''),[view,setView]=useState('iso'),[viewRevision,setViewRevision]=useState(0);
 const fit=useRef<()=>void>(()=>{});
 const [axes,setAxes]=useState<{name:string;x:number;y:number;z:number;color:string}[]>([]);
 const [annotations,setAnnotations]=useState<{x:number;y:number;labelX:number;labelY:number;name:string;value:string}[]>([]);
 const [grid,setGrid]=useState(false),[dimension,setDimension]=useState(true),[ready,setReady]=useState(false),[builtKey,setBuiltKey]=useState('');
 const geometryKey=JSON.stringify(cable)+mode+visible.join(',')+grid;
 const visualState=useRef({cable,mode,visible});visualState.current={cable,mode,visible};
 // The WebGL context, PMREM environment and controls are expensive on software/high-DPI
 // renderers. Keep them for the component lifetime; parameter edits only replace geometry.
 useEffect(()=>{
  const el=host.current;if(!el)return;let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:compactTools,preserveDrawingBuffer:false})}catch{setFailed(true);return}
  rendererRef.current=renderer;setFailed(false);renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(surface);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=studio?CABLE_STUDIO.exposure:1.05;renderer.shadowMap.enabled=studio;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.domElement.setAttribute('aria-label','参数化电缆三维模型');el.appendChild(renderer.domElement);
  const scene=new THREE.Scene();sceneRef.current=scene;
  const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;room.dispose();pmrem.dispose();
  const camera=new THREE.OrthographicCamera(-.32,.32,.24,-.24,.001,10);cam.current=camera;
  const ctl=new OrbitControls(camera,renderer.domElement);controls.current=ctl;ctl.minZoom=.5;ctl.maxZoom=16;ctl.enableDamping=false;ctl.target.set(0,0,0);
  camera.position.set(.33,.14,.8);ctl.update();
  const oldRig=new THREE.Group();technicalRig.current=oldRig;scene.add(oldRig);oldRig.add(new THREE.HemisphereLight(0xffffff,0x8394a5,1.7));const key=new THREE.DirectionalLight(0xffffff,2.4);key.position.set(.2,1,.7);oldRig.add(key);
  const rim=new THREE.DirectionalLight(0xffffff,2);rim.position.set(-.5,.2,-.7);oldRig.add(rim);
  if(studio)studioRig.current=addStudioLighting(scene,compactTools);
  const render=()=>{
   const polished=studio&&finishRef.current;
   oldRig.visible=!polished;if(studioRig.current)studioRig.current.rig.visible=polished;
   if(appearanceRoot.current)appearanceRoot.current.visible=polished;
   if(technicalRoot.current)technicalRoot.current.visible=!polished;
   renderer.shadowMap.enabled=polished;renderer.setClearColor(polished?CABLE_STUDIO.background:surface,compactTools?0:1);
   renderer.toneMappingExposure=polished?CABLE_STUDIO.exposure:1.05;
   renderer.render(scene,camera);
   const width=el.clientWidth,height=el.clientHeight,{cable:shownCable,mode:shownMode,visible:shownVisible}=visualState.current;
   camera.updateMatrixWorld();const ls=layers(shownCable);
   if(compactTools){const inverse=camera.quaternion.clone().invert();setAxes([
    {name:'X',v:new THREE.Vector3(1,0,0),color:'#dc604c'},
    {name:'Y',v:new THREE.Vector3(0,1,0),color:'#069d74'},
    {name:'Z',v:new THREE.Vector3(0,0,1),color:'#176bea'},
   ].map(({name,v,color})=>{v.applyQuaternion(inverse);return {name,x:44+v.x*29,y:46-v.y*29,z:v.z,color}}).sort((a,b)=>a.z-b.z))}

   setAnnotations(ls.flatMap((l,i)=>{
    if(!shownVisible[i]||shownMode==='assembled'||(compactTools&&![0,2,4,5].includes(i)))return [];
    const anchor=compactTools&&i===5&&shownMode==='cutaway'?new THREE.Vector3(-.09,-l.radius_mm/1800,l.radius_mm/1250):new THREE.Vector3(.18-i*.042-.020,(shownMode==='exploded'?(i-2.5)*.055:0)+l.radius_mm/1000,0);
    const point=anchor.project(camera);
    return [{x:(point.x+1)*width/2,y:(1-point.y)*height/2,labelX:width*(compactTools?({0:.83,2:.65,4:.43,5:.15}[i]??.5):(.09+(5-i)*.159)),labelY:compactTools?height*(i===5?.74:i===0?.36:.25):82,name:l.name,value:i===0?`${fmt(shownCable.area_mm2,0)} mm²`:`${fmt(l.radius_mm-ls[i-1].radius_mm,2)} mm`}];
   }));
  };
  renderCurrent.current=render;
  const resize=()=>{const w=Math.max(el.clientWidth,100),h=Math.max(el.clientHeight,100),aspect=w/h;el.dataset.compact=String(h<380);camera.left=-.25*aspect;camera.right=.25*aspect;camera.top=.25;camera.bottom=-.25;camera.updateProjectionMatrix();fit.current();renderer.setSize(w,h);render()};
  // A stationary click inspects a real visible display mesh. Drags remain OrbitControls gestures.
  const ray=new THREE.Raycaster(),point=new THREE.Vector2();let down:{x:number;y:number}|null=null;
  const pointerDown=(e:PointerEvent)=>{down=e.button===0?{x:e.clientX,y:e.clientY}:null};
  const pointerUp=(e:PointerEvent)=>{
   const start=down;down=null;if(!start||!inspectRef.current||Math.hypot(e.clientX-start.x,e.clientY-start.y)>5||!modelRoot.current)return;
   const rect=renderer.domElement.getBoundingClientRect();if(!rect.width||!rect.height)return;
   point.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(point,camera);
   const hit=ray.intersectObject(modelRoot.current,true).find(h=>{
    if(!Number.isInteger(h.object.userData.cableLayer))return false;
    for(let o:THREE.Object3D|null=h.object;o;o=o.parent)if(!o.visible)return false;
    return true;
   });
   if(hit){const index=hit.object.userData.cableLayer as number;setSelectedLayer(index);inspectRef.current(index)}
  };
  renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pointerUp);
  const ro=new ResizeObserver(resize);ro.observe(el);ctl.addEventListener('change',render);resize();setReady(true);
  return()=>{renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',pointerUp);ro.disconnect();ctl.dispose();disposeScene(scene,...(group.current?[group.current]:[]));studioRig.current?.key.shadow.dispose();studioRig.current=null;technicalRig.current=null;rendererRef.current=null;appearanceRoot.current=null;technicalRoot.current=null;environment.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();group.current=null;modelRoot.current=null;sceneRef.current=null;cam.current=null;controls.current=null;renderCurrent.current=()=>{}};
 },[]);
 useEffect(()=>{
  const scene=sceneRef.current;if(!scene||failed)return;
  let cancelled=false,firstFrame=0,secondFrame=0;
  const rebuild=()=>{
   if(cancelled||sceneRef.current!==scene)return;
   try{
    const cableGroup=buildCableGeometry(cable,mode,visible),nextRoot=new THREE.Group();nextRoot.name='当前电缆显示';
    const display=cableGroup.clone(true);display.children.forEach((mesh,i)=>{mesh.userData={...mesh.userData,cableLayer:i}});if(visible[0]&&display.children[0])display.children[0].visible=false;
    const technical=new THREE.Group();technical.add(display,cableAppearance(cable,mode,visible));nextRoot.add(technical);technicalRoot.current=technical;
    if(studio){
     const materials=studioMaterials(cable.conductor,compactTools),polished=new THREE.Group();polished.name='Material preview (display only)';
     cableGroup.children.forEach((child,i)=>{
      const base=child as THREE.Mesh;const mesh=new THREE.Mesh(i===0?base.geometry:roundedShell(base.userData.inner_radius_m,base.userData.outer_radius_m,base.userData.axial_length_m),materials[i]);
      mesh.name=base.name;mesh.userData.cableLayer=i;mesh.rotation.copy(base.rotation);mesh.position.copy(base.position);mesh.visible=i!==0&&base.visible;mesh.castShadow=true;mesh.receiveShadow=true;polished.add(mesh);
     });
     const detail=cableAppearance(cable,mode,visible,materials);detail.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true}});polished.add(detail);nextRoot.add(polished);appearanceRoot.current=polished;
     if(studioRig.current)studioRig.current.floor.position.y=mode==='exploded'?-.17:-layers(cable)[5].radius_mm/1000-.001;
    }
    nextRoot.traverse(o=>{if(o instanceof THREE.Mesh){if(o.userData.strand_instances)o.userData.cableLayer=0;else if(o.userData.wire_instances)o.userData.cableLayer=4}});
    if(grid){const floor=new THREE.GridHelper(1,20,0xb8c0b8,0xe1e5de);floor.position.y=mode==='exploded'?-.20:-layers(cable)[5].radius_mm/1000-.003;nextRoot.add(floor)}
    const previous=modelRoot.current,previousExport=group.current;if(previous){scene.remove(previous);disposeScene(previous,...(previousExport?[previousExport]:[]))}
    scene.add(nextRoot);modelRoot.current=nextRoot;group.current=cableGroup;fit.current();renderCurrent.current();setBuiltKey(geometryKey);setError('');
   }catch(e){setError(e instanceof Error?`三维模型更新失败：${e.message}`:'三维模型更新失败')}
  };
  // Two frames let the saved revision and stale-result warning paint before a detailed
  // geometry refresh. Export is disabled until this exact input has been rebuilt.
  firstFrame=requestAnimationFrame(()=>{secondFrame=requestAnimationFrame(rebuild)});
  return()=>{cancelled=true;cancelAnimationFrame(firstFrame);cancelAnimationFrame(secondFrame)};
 },[geometryKey,failed]);
 useEffect(()=>{renderCurrent.current()},[materialPreview]);
 useEffect(()=>{const c=cam.current,ctl=controls.current;if(!c||!ctl)return;
  fit.current=()=>{
   c.position.set(...(view==='front'?[.001,0,.6]:view==='end'?[.6,.001,0]:view==='top'?[0,.6,.001]:compactTools?[1.10,.12,.85]:[.33,.14,.8]) as [number,number,number]);
   c.up.set(0,1,0);ctl.target.set(0,0,0);c.lookAt(ctl.target);
   if(group.current){
    fitCableCamera(c,group.current);
    const hero=compactTools&&mode==='cutaway'&&view==='iso'&&(host.current?.clientWidth??0)>720&&(host.current?.clientHeight??0)>360;
    if(studio)c.zoom=Math.min(16,c.zoom*(hero?1.60:1.06));
    c.updateProjectionMatrix();if(hero){c.position.x+=.055;ctl.target.x+=.055;c.lookAt(ctl.target)}
   }ctl.update();
  };
  fit.current();return()=>{fit.current=()=>{}};
 },[view,geometryKey,viewRevision]);
 async function exportModel(){if(!group.current||builtKey!==geometryKey)return;setError('');try{
  const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');const data=await new GLTFExporter().parseAsync(group.current,{binary:true,onlyVisible:true});
  if(!(data instanceof ArrayBuffer))throw new Error('模型导出格式错误');const u=URL.createObjectURL(new Blob([data],{type:'model/gltf-binary'}));const a=document.createElement('a');a.href=u;a.download='CableSimPro-cable.glb';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);
 }catch(e){setError(e instanceof Error?e.message:'无法导出模型')}}
 return <div className={`model-view ${studio?'studio-model':''} ${compactTools?'ps-model-tools':''}`} data-selected-layer={selectedLayer??undefined} data-finish={materialPreview?'material':'technical'}>{compactTools?<div className="ref-tool-island" role="toolbar" aria-label="模型工具">
  <button aria-label="旋转模型" title="旋转模型：拖动画布" onClick={()=>{if(controls.current)controls.current.mouseButtons.LEFT=THREE.MOUSE.ROTATE}}><Rotate3D size={22}/><span>旋转</span></button>
  <button aria-label="轴向剥切" aria-pressed={mode==='cutaway'} onClick={()=>setMode('cutaway')}><Scissors size={22}/><span>剖切</span></button>
  <button aria-label="分层展开" aria-pressed={mode==='exploded'} onClick={()=>setMode('exploded')}><Layers3 size={22}/><span>分层</span></button>
  <button data-setting="finish" aria-label="材质预览" aria-pressed={materialPreview} onClick={()=>setMaterialPreview(v=>!v)}><Sparkles size={22}/><span>材质</span></button>
  <button data-setting="dimensions" aria-label="尺寸" aria-pressed={dimension} onClick={()=>setDimension(v=>!v)}><Ruler size={22}/><span>尺寸</span></button>
  <button aria-label="恢复轴测视图" title="恢复轴测视图" onClick={()=>{setView('iso');setViewRevision(r=>r+1)}}><RotateCcw size={22}/><span>复位</span></button>
 </div>:<div className="model-toolbar"><div className="segmented">{[['cutaway','轴向剥切'],['assembled','完整结构'],['exploded','分层展开']].map(([id,label])=><button key={id} aria-pressed={mode===id} className={mode===id?'active':''} onClick={()=>setMode(id as ViewMode)}>{label}</button>)}</div><span className="tool-spacer"/>{studio&&<button aria-label="材质预览" aria-pressed={materialPreview} onClick={()=>setMaterialPreview(v=>!v)}>材质</button>}<button title="显示或隐藏网格" aria-pressed={grid} onClick={()=>setGrid(!grid)}>网格</button><button title="显示或隐藏尺寸" aria-pressed={dimension} onClick={()=>setDimension(!dimension)}>尺寸</button><button onClick={()=>{setView('iso');setViewRevision(r=>r+1)}} title="恢复轴测视图"><RotateCcw size={15}/></button><button disabled={!ready||failed||builtKey!==geometryKey} onClick={()=>void exportModel()}><Download size={15}/>导出 GLB</button></div>}
 <div className="model-render" ref={host} data-testid="cable-model-view" data-material-preset={studio?CABLE_STUDIO.version:undefined} data-renderer={failed?'fallback':ready&&builtKey===geometryKey?'webgl':'loading'}>{failed&&<div className="model-fallback"><p>WebGL 不可用，显示二维截面；三维导出已停用。</p><CrossSection cable={cable}/></div>}
 {ready&&!failed&&builtKey!==geometryKey&&<span role="status" style={{position:'absolute',bottom:12,left:16,zIndex:3,background:'#ffffff',padding:'6px 10px',color:'#23415d'}}>正在更新三维显示…</span>}
 <div className="model-caption"><Box size={16}/><div><strong>{compactTools?`单芯电缆 · U₀ ${cable.u0_kv} kV`:studio?'单芯电缆 · 工程样件':'单芯电缆 · 结构模型'}</strong><span>{cable.conductor==='copper'?'铜':'铝'}导体 / XLPE 绝缘 / 无铠装</span></div></div>
 {dimension&&<svg className="model-callouts" aria-label="结构分层标注" width="100%" height="100%">{annotations.map(a=><g key={a.name}><path d={`M ${a.labelX} ${a.labelY+32} L ${a.labelX-16} ${a.labelY+32} L ${a.x} ${a.y}`} fill="none"/><circle cx={a.x} cy={a.y} r="3"/><text x={a.labelX} y={a.labelY} textAnchor="start">{a.name}</text><text x={a.labelX} y={a.labelY+19} className="callout-value" textAnchor="start">{a.value}</text></g>)}</svg>}
 {compactTools&&<><svg className="ref-axis-triad" role="img" aria-label="当前三维坐标方向" viewBox="0 0 96 88">{axes.map(a=><g key={a.name}><line x1="44" y1="46" x2={a.x} y2={a.y} stroke={a.color}/><circle cx={a.x} cy={a.y} r="2.5" fill={a.color}/><text x={a.x+(a.x<44?-8:5)} y={a.y+(a.y<46?-5:11)}>{a.name}</text></g>)}</svg><div className="ref-view-selector" aria-label="模型显示方式"><button aria-pressed={true} onClick={()=>{setView('iso');setViewRevision(r=>r+1)}}>3D 视图</button><button aria-label="二维截面" onClick={onSection}>二维截面</button><button aria-label="截面对照" aria-pressed={compare} onClick={onCompare}>截面对照</button></div><div className="ref-zoom-controls"><button aria-label="缩小模型" onClick={()=>{if(cam.current){cam.current.zoom=Math.max(.5,cam.current.zoom/1.15);cam.current.updateProjectionMatrix();renderCurrent.current()}}}><Minus size={17}/></button><span>视图缩放</span><button aria-label="放大模型" onClick={()=>{if(cam.current){cam.current.zoom=Math.min(16,cam.current.zoom*1.15);cam.current.updateProjectionMatrix();renderCurrent.current()}}}><Plus size={17}/></button><button aria-label="适合画布" onClick={()=>{fit.current();renderCurrent.current()}}><Maximize size={18}/></button></div></>}
 <div className="orientation">{[['iso','轴测'],['front','正视'],['end','端面'],['top','俯视']].map(([id,label])=><button key={id} className={view===id?'active':''} onClick={()=>setView(id)}>{label}</button>)}</div>
 {dimension&&<div className="model-dimensions"><span>外径 <b>Ø {fmt(layers(cable)[5].radius_mm*2,2)} mm</b></span><span>导体 <b>{fmt(cable.area_mm2,0)} mm²</b></span><span>展示长度 <b>360 mm</b></span></div>}
 </div>{studio&&<div className="studio-caption"><span><i/>{materialPreview?'材质预览':'简化着色'}</span><span>外观材质为示意 · 尺寸来自工程输入</span></div>}{error&&<p role="alert">{error}</p>}<div className="model-footer"><span>左键旋转 · 右键平移 · 滚轮缩放</span><span>外观线股不参与求解 · GLB 导出等效六层几何</span></div>
 {compactTools?<details className="ps-layer-menu"><summary aria-label="结构层与可见性"><Layers3 size={16}/><span>模型树与导出</span><MoreHorizontal size={17}/></summary><div className="ref-model-more"><button aria-pressed={mode==='assembled'} onClick={()=>setMode('assembled')}>完整结构</button><button disabled={!ready||failed||builtKey!==geometryKey} onClick={()=>void exportModel()}><Download size={16}/>导出 GLB</button><button aria-pressed={grid} onClick={()=>setGrid(v=>!v)}><Grid3X3 size={16}/>网格</button><span>GLB 为等效六层几何；光学外观不进入求解。</span></div><div className="ps-layer-inspect" aria-label="检查结构层">{layers(cable).map((layer,i)=><button key={layer.name} aria-label={`检查${layer.name}参数`} onClick={()=>{setSelectedLayer(i);onInspectLayer?.(i)}}>{layer.name}<span>检查参数 ↗</span></button>)}</div> <div className="layer-strip">{layers(cable).map((l,i)=><button key={l.name} className={visible[i]?'':'hidden-layer'} aria-pressed={visible[i]} onClick={()=>setVisible(v=>v.map((x,j)=>i===j?!x:x))}>{visible[i]?<Eye size={12}/>:<EyeOff size={12}/>}<span>{l.name}</span><b>{fmt(l.radius_mm*2,2)} mm</b></button>)}</div></details>:<> <div className="layer-strip">{layers(cable).map((l,i)=><button key={l.name} className={visible[i]?'':'hidden-layer'} aria-pressed={visible[i]} onClick={()=>setVisible(v=>v.map((x,j)=>i===j?!x:x))}>{visible[i]?<Eye size={12}/>:<EyeOff size={12}/>}<span>{l.name}</span><b>{fmt(l.radius_mm*2,2)} mm</b></button>)}</div></>}</div>;
}
