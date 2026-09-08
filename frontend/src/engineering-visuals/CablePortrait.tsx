import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildCableGeometry,fitCablePortrait} from '../CableModelView';
import {cableAppearance,disposeScene} from './cableAppearance';
import {layers,fmt} from '../utils';
import type {Cable,Scenario} from '../types';
import {positions} from '../geometry';

/** One same-domain visual asset shared by entry, task evidence and change previews. */
export default function CablePortrait({cable,interactive=false}:{cable:Cable;interactive?:boolean}) {
 const host=useRef<HTMLDivElement>(null),[state,setState]=useState('loading');
 useEffect(()=>{
  const el=host.current;if(!el)return;
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true})}catch{setState('fallback');return}
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor('#f3f5f5',0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
  renderer.domElement.setAttribute('aria-label','电缆剥切结构预览');el.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,1,.001,10);
  const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;room.dispose();pmrem.dispose();
  const asset=new THREE.Group();const model=buildCableGeometry(cable,'cutaway',[true,true,true,true,true,true]);model.children[0].visible=false;asset.add(model);
  asset.add(cableAppearance(cable,'cutaway',[true,true,true,true,true,true]));asset.rotation.z=-.17;
  asset.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true}});scene.add(asset);
  scene.add(new THREE.HemisphereLight(0xffffff,0x81919a,1.5));
  const key=new THREE.DirectionalLight(0xfff5e7,2.3);key.position.set(.3,.8,.7);scene.add(key);
  const fill=new THREE.DirectionalLight(0xffffff,2.7);fill.position.set(-.5,.1,-.3);scene.add(fill);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.enablePan=false;controls.enableZoom=interactive;controls.enabled=interactive;
  controls.minDistance=.2;controls.maxDistance=1.5;controls.target.set(0,0,0);
  const render=()=>renderer.render(scene,camera);
  let lastAspect=0;
  const resize=()=>{
   const w=el.clientWidth,h=el.clientHeight;if(w<2||h<2)return;
   renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();
   if(Math.abs(lastAspect-camera.aspect)>.05){
    fitCablePortrait(camera,asset);controls.update();lastAspect=camera.aspect;
   }render();
  };
  const observer=new ResizeObserver(resize);observer.observe(el);controls.addEventListener('change',render);resize();setState('ready');
  const lost=(e:Event)=>{e.preventDefault();setState('fallback')};renderer.domElement.addEventListener('webglcontextlost',lost);
  return()=>{observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('webglcontextlost',lost);disposeScene(scene);environment.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove()};
 },[JSON.stringify(cable),interactive]);
 return <div className="cable-portrait" ref={host} data-testid="cable-portrait" data-renderer={state} data-area={cable.area_mm2}>
  {state==='fallback'&&<div className="portrait-fallback" role="img" aria-label="电缆分层截面替代图">{[...layers(cable)].reverse().map(l=><span key={l.name} style={{width:`${l.radius_mm/layers(cable)[5].radius_mm*170}px`,height:`${l.radius_mm/layers(cable)[5].radius_mm*170}px`,background:l.color}}/>)}<b>二维截面 · WebGL 不可用</b></div>}
  <div className="portrait-axis"><span>X</span><span>Y</span><span>Z</span></div>
 </div>;
}

/** Equal-scale installation drawing generated from the saved scenario, never a field solution. */
export function InstallationSketch({scenario}:{scenario:Scenario}) {
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const el=canvas.current;if(!el)return;const ctx=el.getContext('2d');if(!ctx)return;
  const w=640,h=300;el.width=w*2;el.height=h*2;ctx.scale(2,2);
  const ps=positions(scenario.installation),r=layers(scenario.cable)[5].radius_mm/1000;
  const sc=Math.min(230/(Math.max(...ps.map(p=>p[1]))+.14),430/(2*scenario.installation.spacing_m+.2));
  const x=(v:number)=>w/2+v*sc,y=(v:number)=>36+v*sc;
  ctx.fillStyle='#f5f7f5';ctx.fillRect(0,0,w,h);ctx.fillStyle='#e7ece6';ctx.fillRect(0,36,w,h-36);
  ctx.strokeStyle='#c4cec2';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,36);ctx.lineTo(w,36);ctx.stroke();
  ctx.fillStyle='#5f7165';ctx.font='12px system-ui';ctx.fillText('地表',18,26);
  for(let a=15;a<w;a+=24)for(let b=60;b<h;b+=22){ctx.fillStyle='#c6d0c3';ctx.fillRect(a+(b%3)*5,b,2,2)}
  ps.forEach(([px,py],i)=>{
   ctx.beginPath();ctx.arc(x(px),y(py),r*sc,0,2*Math.PI);ctx.fillStyle='#30393a';ctx.fill();
   ctx.beginPath();ctx.arc(x(px),y(py),r*sc*.46,0,2*Math.PI);ctx.fillStyle='#c69457';ctx.fill();
   ctx.fillStyle='#34413f';ctx.textAlign='center';ctx.fillText('ABC'[i],x(px),y(py)+r*sc+21);
  });
  ctx.strokeStyle='#77867d';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(70,36);ctx.lineTo(70,y(scenario.installation.depth_m));ctx.lineTo(x(0),y(scenario.installation.depth_m));ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#34413f';ctx.textAlign='left';ctx.fillText(`${fmt(scenario.installation.depth_m,2)} m`,15,y(scenario.installation.depth_m/2));
 },[JSON.stringify(scenario)]);
 return <figure className="installation-sketch"><canvas ref={canvas} aria-label="当前直埋敷设截面示意"/><figcaption>中心距 {fmt(scenario.installation.spacing_m*1000,0)} mm · 等比例截面，非温度场</figcaption></figure>;
}
