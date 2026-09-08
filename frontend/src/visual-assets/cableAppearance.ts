import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Cable} from '../types';
import {layers} from '../utils';

/** Display-only strands. Neither strand count nor lay is manufacturing input.
 * All centerlines fit the nominal envelope. Never pass this group to a solver/exporter. */
export function cableAppearance(cable:Cable,mode:string,visible:boolean[]){
 const group=new THREE.Group();group.name='显示细节（不参与计算）';
 group.userData={purpose:'illustration-only',not_solver_geometry:true,not_manufacturing_lay:true};
 const radii=layers(cable).map(l=>l.radius_mm/1000),r=radii[0];
 if(visible[0]){
  const wire=r/7.3,parts:THREE.BufferGeometry[]=[];
  const yOffset=mode==='exploded'?-2.5*.055:0;
  for(let ring=0;ring<=3;ring++)for(let n=0;n<(ring===0?1:6*ring);n++){
   const count=ring===0?1:6*ring;
   const points=Array.from({length:65},(_,j)=>{
    const x=-.18+j*.36/64,a=n/count*2*Math.PI+(ring?x/.17*2*Math.PI:0);
    return new THREE.Vector3(x,yOffset+2*wire*ring*Math.cos(a),2*wire*ring*Math.sin(a));
   });
   parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),64,wire*.96,10,false));
   for(const end of [0,64]){const cap=new THREE.CircleGeometry(wire*.96,10);cap.rotateY(end===64?Math.PI/2:-Math.PI/2);cap.translate(points[end].x,points[end].y,points[end].z);parts.push(cap)}
  }
  const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());
  if(geometry){const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:cable.conductor==='copper'?'#c4864e':'#bdc8d2',metalness:.84,roughness:.29}));mesh.name='导体线股显示';group.add(mesh)}
 }
 if(visible[4]&&mode!=='assembled'){
  const ro=radii[4],inner=radii[3],relief=Math.min((ro-inner)*.45,.00018),y0=mode==='exploded'?1.5*.055:0;
  const parts:THREE.BufferGeometry[]=[];
  for(let n=0;n<56;n++){
   const points=Array.from({length:21},(_,j)=>{
    const x=-.030+j*.042/20,a=n/56*Math.PI*2+j/20*.85;
    return new THREE.Vector3(x,y0+(ro-relief*.35)*Math.cos(a),(ro-relief*.35)*Math.sin(a));
   });
   parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),20,relief,6,false));
  }
  const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());
  if(geometry){const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:'#b87944',metalness:.87,roughness:.3}));mesh.name='金属屏蔽线显示';group.add(mesh)}
 }
 return group;
}
export function disposeScene(root:THREE.Object3D){
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
 root.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments){geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m))}});
 materials.forEach(m=>{Object.values(m).forEach(v=>{if(v instanceof THREE.Texture)textures.add(v)});m.dispose()});
 textures.forEach(t=>t.dispose());geometries.forEach(g=>g.dispose());
}
