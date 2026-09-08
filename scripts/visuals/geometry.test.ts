import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildCableGeometry,fitCableCamera} from '../../frontend/src/CableModelView';
import {cableAppearance,disposeScene} from '../../frontend/src/engineering-visuals/cableAppearance';
import type {Cable} from '../../frontend/src/types';
let count=0;
for(const conductor of ['copper','aluminium'] as const)for(const area_mm2 of [50,240,1000])for(const mode of ['assembled','cutaway','exploded'] as const){
 const cable={conductor,area_mm2,fill_factor:.92,conductor_screen_mm:.6,insulation_mm:4.5,insulation_screen_mm:.6,metallic_screen_mm:.35,jacket_mm:2.2} as Cable;
 const base=buildCableGeometry(cable,mode,[true,true,true,true,true,true]);
 const visual=cableAppearance(cable,mode,[true,true,true,true,true,true]);
 assert.equal(((base.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString(),conductor==='aluminium'?'bac5cf':'b5763c');
 assert.equal(base.children.length,6);assert.equal(base.userData.units,'metres');assert.equal(visual.userData.not_solver_geometry,true);
 assert.ok(Math.abs(base.children[0].userData.outer_radius_m-Math.sqrt(area_mm2/(Math.PI*.92))/1000)<1e-12);
 visual.traverse(o=>{if(o instanceof THREE.Mesh){const a=o.geometry.getAttribute('position');for(let i=0;i<a.array.length;i++)assert.ok(Number.isFinite(a.array[i]))}});
 assert.equal(base.children.some(o=>o.userData.not_solver_geometry),false);
 // Portrait and wide canvas must retain the complete model envelope.
 for(const aspect of [1.1,2.9]){
  const camera=new THREE.OrthographicCamera(-.25*aspect,.25*aspect,.25,-.25,.001,10);
  camera.position.set(.33,.14,.8);camera.lookAt(0,0,0);fitCableCamera(camera,base);
  const bounds=new THREE.Box3().setFromObject(base);
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
   const point=new THREE.Vector3(x,y,z).project(camera);
   assert.ok(Math.abs(point.x)<=.821);assert.ok(Math.abs(point.y)<=.641);
  }
 }
 disposeScene(base);disposeScene(visual);count++;
}
console.log(`${count} display-geometry configurations checked; all six-layer engineering envelopes preserved.`);
