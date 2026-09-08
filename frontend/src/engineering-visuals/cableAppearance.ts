import * as THREE from 'three';
import type {Cable} from '../types';
import {layers} from '../utils';

/** Presentation geometry only. Nominal radii, losses and exported engineering
 * geometry remain unchanged. Wire count and lay are not manufacturing data. */
export function cableAppearance(cable:Cable, mode:string, visible:boolean[]) {
 const details=new THREE.Group();
 details.name='显示细节（不参与计算）';
 details.userData={purpose:'illustration-only',not_solver_geometry:true,not_manufacturing_lay:true};
 const ls=layers(cable),r=ls[0].radius_mm/1000;
 const copper=new THREE.MeshStandardMaterial({color:cable.conductor==='copper'?'#bf763e':'#b4bdc4',metalness:.9,roughness:.29});
 const screen=new THREE.MeshStandardMaterial({color:'#be8756',metalness:.82,roughness:.34});
 const wire=r/7.3;
 // Front-face strands are contained in the nominal conductor envelope.
 if(visible[0]) for(let row=-3;row<=3;row++)for(let col=-3;col<=3;col++) {
  const y=col*wire*2+(Math.abs(row)%2)*wire,z=row*wire*Math.sqrt(3);
  if(Math.hypot(y,z)+wire>r)continue;
  const strand=new THREE.Mesh(new THREE.CylinderGeometry(wire*.94,wire*.94,.029,16),copper);
  strand.rotation.z=-Math.PI/2;
  strand.position.set(.18-.0145+.00004,y+(mode==='exploded'?-2.5*.055:0),z);
  details.add(strand);
 }
 // Fine helical relief on the exposed equivalent metallic-screen shell.
 if(visible[4]&&mode!=='assembled') {
  const ro=ls[4].radius_mm/1000,inner=ls[3].radius_mm/1000;
  const relief=Math.min((ro-inner)*.18,.00012),centerRadius=ro-relief;
  const height=mode==='exploded'?1.5*.055:0;
  for(let i=0;i<40;i++){
   const points=[];
   for(let j=0;j<=14;j++){
    const x=-.030+j/14*.042,a=i/40*Math.PI*2+j/14*.9;
    points.push(new THREE.Vector3(x,height+centerRadius*Math.cos(a),centerRadius*Math.sin(a)));
   }
   const mesh=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),18,relief,5,false),screen);
   details.add(mesh);
  }
 }
 return details;
}

/** One disposal pass per geometry/material/texture, including shared resources. */
export function disposeScene(root:THREE.Object3D) {
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
 root.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments){geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m))}});
 materials.forEach(m=>{Object.values(m).forEach(v=>{if(v instanceof THREE.Texture)textures.add(v)});m.dispose()});
 textures.forEach(t=>t.dispose());geometries.forEach(g=>g.dispose());
}
