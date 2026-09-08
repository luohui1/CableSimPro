import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Download,RotateCcw} from 'lucide-react';
import type {Scenario} from './types';
import {buildCableGeometry} from './CableModelView';
import {positions} from './geometry';
import {fmt} from './utils';

/** Exact transverse coordinates, explicit representative axial segment. No unsupported trench/duct. */
export function buildBuriedScene(scenario:Scenario){
 const root=new THREE.Group();root.name='单回路均匀土壤直埋';
 root.userData={units:'metres',kind:'installation-preview',domain:'buried',display_length_m:1.2,
  not_route_length:true,axis_convention:'x transverse; y upward (negative burial depth); z longitudinal',
  positions_x_depth_m:positions(scenario.installation),input:scenario,
  disclaimer:'土壤背景仅为显示范围；不是回填分区、沟壁或有限元网格。'};
 positions(scenario.installation).forEach(([x,depth],i)=>{
  const group=buildCableGeometry(scenario.cable,'cutaway',[true,true,true,true,true,true]);
  group.name='相 '+ 'ABC'[i];group.scale.x=1.2/.36;group.rotation.y=-Math.PI/2;group.position.set(x,-depth,0);
  group.userData={...group.userData,phase:'ABC'[i],display_length_m:1.2,position_x_depth_m:[x,depth]};root.add(group);
 });return root;
}
export default function InstallationModel({scenario}:{scenario:Scenario}){
 const host=useRef<HTMLDivElement>(null),model=useRef<THREE.Group|null>(null);
 const [reset,setReset]=useState(0),[ready,setReady]=useState(false),[error,setError]=useState(''),[ground,setGround]=useState(true);
 const key=JSON.stringify(scenario);
 useEffect(()=>{
  const el=host.current;if(!el)return;let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true})}catch{setError('WebGL 不可用，请切换二维敷设。');setReady(false);return}
  setError('');renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor('#f2f4f5');renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.domElement.setAttribute('aria-label','米制直埋敷设三维模型');el.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),root=buildBuriedScene(scenario);model.current=root;scene.add(root);
  const extent=Math.max(.5,scenario.installation.spacing_m*1.8),depth= Math.max(...positions(scenario.installation).map(p=>p[1]));
  const camera=new THREE.PerspectiveCamera(36,1,.005,100);camera.position.set(extent+1.15,.6,1.55);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,-depth*.7,0);controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff,0x83908a,2.5));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(2,4,3);scene.add(light);
  if(ground){const surface=new THREE.Mesh(new THREE.PlaneGeometry(extent*2,1.5),new THREE.MeshStandardMaterial({color:0xd8ded8,transparent:true,opacity:.32,side:THREE.DoubleSide,depthWrite:false}));surface.rotation.x=-Math.PI/2;scene.add(surface);}
  const axes=new THREE.AxesHelper(.18);axes.position.set(-extent,-depth-.16,.72);scene.add(axes);
  const grid=new THREE.GridHelper(Math.max(2,extent*2.5),20,0xa8b5bd,0xd6dfe3);grid.position.y=-depth-.15;scene.add(grid);
  const render=()=>renderer.render(scene,camera);const resize=()=>{const w=Math.max(el.clientWidth,200),h=Math.max(el.clientHeight,200);renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();render()};
  const ro=new ResizeObserver(resize);ro.observe(el);controls.addEventListener('change',render);resize();setReady(true);
  return()=>{ro.disconnect();controls.dispose();scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose())}});renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();model.current=null};
 },[key,reset,ground]);
 async function exportScene(){if(!model.current)return;try{const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');const data=await new GLTFExporter().parseAsync(model.current,{binary:true});if(!(data instanceof ArrayBuffer))throw new Error('场景导出失败');const url=URL.createObjectURL(new Blob([data],{type:'model/gltf-binary'}));const a=document.createElement('a');a.href=url;a.download='CableSimPro-buried-scene.glb';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){setError(e instanceof Error?e.message:'场景导出失败')}}
 return <section className="installation-model"><div className="installation-model-toolbar"><b>单回路 · {scenario.installation.arrangement==='flat'?'水平排列':'等边三角排列'}</b><span/><button onClick={()=>setGround(!ground)} aria-pressed={ground}>地表参考</button><button aria-label="恢复敷设轴测视图" onClick={()=>setReset(r=>r+1)}><RotateCcw size={16}/></button><button disabled={!ready} onClick={()=>void exportScene()}><Download size={16}/>导出敷设 GLB</button></div>
 <div className="installation-model-host" ref={host} data-testid="installation-3d" data-ready={ready}><div className="installation-coordinate-note"><b>真实截面坐标</b>{positions(scenario.installation).map(([x,h],i)=><span key={i}>{'ABC'[i]} 相：x {fmt(x,3)} m · 埋深 {fmt(h,3)} m</span>)}</div></div>{error&&<p className="enterprise-error" role="alert">{error}</p>}<footer>轴向仅显示 1.2 m 代表段，不等于线路长度。地表与网格为参考显示；没有新增回填、沟壁或网格求解。</footer></section>;
}
