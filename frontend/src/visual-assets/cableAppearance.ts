import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Cable} from '../types';
import {layers} from '../utils';

/** Display-only strands. Neither strand count nor lay is manufacturing input.
 * All centerlines fit the nominal envelope. Never pass this group to a solver/exporter. */
export function cableAppearance(cable:Cable,mode:string,visible:boolean[],materials?:THREE.MeshStandardMaterial[]){
 const group=new THREE.Group();group.name='显示细节（不参与计算）';
 group.userData={purpose:'illustration-only',not_solver_geometry:true,not_manufacturing_lay:true};
 const radii=layers(cable).map(l=>l.radius_mm/1000),r=radii[0];
 if(visible[0]){
  const wire=r/7.3,yOffset=mode==='exploded'?-2.5*.055:0;
  const material=materials?.[0]??new THREE.MeshStandardMaterial({color:cable.conductor==='copper'?'#c4864e':'#bdc8d2',metalness:.84,roughness:.29});
  for(let ring=0;ring<=3;ring++){
   const count=ring===0?1:6*ring;
   const points=Array.from({length:65},(_,j)=>{
    const x=-.18+j*.36/64,a=(ring?x/.17*2*Math.PI:0);
    return new THREE.Vector3(x,2*wire*ring*Math.cos(a),2*wire*ring*Math.sin(a));
   });
   const tube=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),64,wire*.96,10,false);
   const start=new THREE.CircleGeometry(wire*.96,10);start.rotateY(-Math.PI/2);start.translate(points[0].x,points[0].y,points[0].z);
   const end=new THREE.CircleGeometry(wire*.96,10);end.rotateY(Math.PI/2);end.translate(points[64].x,points[64].y,points[64].z);
   const geometry=mergeGeometries([tube,start,end]);tube.dispose();start.dispose();end.dispose();
   if(!geometry)continue;
   const mesh=new THREE.InstancedMesh(geometry,material,count),matrix=new THREE.Matrix4();
   for(let n=0;n<count;n++){matrix.makeRotationX(n/count*2*Math.PI);mesh.setMatrixAt(n,matrix);if(materials)mesh.setColorAt(n,new THREE.Color().setScalar(.88+(n%5)*.025))}
   mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false;mesh.position.y=yOffset;
   mesh.name=`导体线股显示 · 第 ${ring} 圈`;mesh.userData={display_only:true,strand_instances:count};group.add(mesh);
  }
 }
 if(visible[4]&&mode!=='assembled'){
  const ro=radii[4],inner=radii[3],relief=Math.min((ro-inner)*.45,.00018),y0=mode==='exploded'?1.5*.055:0;
  const points=Array.from({length:21},(_,j)=>{
   const x=-.030+j*.042/20,a=j/20*.85;
   return new THREE.Vector3(x,(ro-relief)*Math.cos(a),(ro-relief)*Math.sin(a));
  });
  const geometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),20,relief,6,false);
  const material=materials?.[4]??new THREE.MeshStandardMaterial({color:'#b87944',metalness:.87,roughness:.3});
  const mesh=new THREE.InstancedMesh(geometry,material,56),matrix=new THREE.Matrix4();
  for(let n=0;n<56;n++){matrix.makeRotationX(n/56*Math.PI*2);mesh.setMatrixAt(n,matrix);if(materials)mesh.setColorAt(n,new THREE.Color().setScalar(.88+(n%5)*.025))}
  mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false;mesh.position.y=y0;
  mesh.name='金属屏蔽线显示';mesh.userData={display_only:true,wire_instances:56};group.add(mesh);
 }
 return group;
}
export function disposeScene(...roots:THREE.Object3D[]){
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
 roots.forEach(root=>root.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments){if(o instanceof THREE.InstancedMesh)o.dispose();geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m))}}));
 materials.forEach(m=>{Object.values(m).forEach(v=>{if(v instanceof THREE.Texture)textures.add(v)});m.dispose()});
 textures.forEach(t=>t.dispose());geometries.forEach(g=>g.dispose());
}
