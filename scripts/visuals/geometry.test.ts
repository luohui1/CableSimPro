import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildCableGeometry,fitCableCamera,fitCablePortrait} from '../../frontend/src/CableModelView';
import {cableAppearance,disposeScene} from '../../frontend/src/visual-assets/cableAppearance';
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

 // A rotated portrait must also fit narrow evidence panels and wide entry cards.
 const portrait=new THREE.Group();portrait.add(base.clone(true));portrait.rotation.z=-.17;
 for(const aspect of [1.1,1.25,2.9]){
  const camera=new THREE.PerspectiveCamera(32,aspect,.001,10);fitCablePortrait(camera,portrait);
  const bounds=new THREE.Box3().setFromObject(portrait);
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
   const point=new THREE.Vector3(x,y,z).project(camera);assert.ok(Math.abs(point.x)<=.841);assert.ok(Math.abs(point.y)<=.701);
  }
 }
 disposeScene(base);disposeScene(visual);count++;
}
console.log(`${count} display-geometry configurations checked; all six-layer engineering envelopes preserved.`);

// Optical detailing must remain separate from the six engineering envelopes.
import {microSurface,studioMaterials,roundedShell,addStudioLighting,CABLE_STUDIO} from '../../frontend/src/visual-assets/cableStudio';
let optical=0;
for(const kind of ['metal','polymer'] as const){
 const a=microSurface(kind),b=microSurface(kind);
 assert.deepEqual(a.image.data,b.image.data);assert.equal(a.colorSpace,THREE.NoColorSpace);
 assert.equal(a.image.width,CABLE_STUDIO.textureSize);assert.equal(a.image.data.length,64*64*4);
 a.dispose();b.dispose();optical++;
}
for(const conductor of ['copper','aluminium'] as const){
 const mats=studioMaterials(conductor);
 assert.equal(mats.length,6);assert.equal(mats[0].metalness,1);assert.equal(mats[5].metalness,0);
 assert.equal((mats[2] as THREE.MeshPhysicalMaterial).transmission,0);
 assert.ok((mats[5] as THREE.MeshPhysicalMaterial).clearcoat>0);
 assert.ok(mats.every(m=>m.userData.display_only&&!m.userData.measured_material));
 const cable={conductor,area_mm2:240,fill_factor:.92,conductor_screen_mm:.6,insulation_mm:4.5,insulation_screen_mm:.6,metallic_screen_mm:.35,jacket_mm:2.2} as Cable;
 const before=JSON.stringify(cable),base=buildCableGeometry(cable,'cutaway',[true,true,true,true,true,true]);
 const visual=cableAppearance(cable,'cutaway',[true,true,true,true,true,true],mats);
 assert.equal(base.children.length,6);assert.equal(JSON.stringify(cable),before);
 let instances=0,vertices=0;
 visual.traverse(o=>{if(o instanceof THREE.InstancedMesh){instances+=o.count;vertices+=o.geometry.getAttribute('position').count;assert.ok(o.instanceColor)}});
 assert.equal(instances,93);assert.ok(vertices<8000,'bounded optical topology');
 const shells=new THREE.Group();
 for(let i=1;i<6;i++){
  const u=base.children[i].userData,g=roundedShell(u.inner_radius_m,u.outer_radius_m,u.axial_length_m);
  const a=g.getAttribute('position');
  for(let j=0;j<a.count;j++){
   assert.ok(Math.hypot(a.getX(j),a.getZ(j))<=u.outer_radius_m+1e-8);
   assert.ok(Math.hypot(a.getX(j),a.getZ(j))>=u.inner_radius_m-1e-8);
   assert.ok(Math.abs(a.getY(j))<=u.axial_length_m/2+1e-8);
  }
  shells.add(new THREE.Mesh(g,mats[i]));
 }
 // Shared textures referenced by several materials must be disposed only once.
 const textures=new Set<THREE.Texture>();mats.forEach(m=>Object.values(m).forEach(v=>{if(v instanceof THREE.Texture)textures.add(v)}));
 let disposed=0;textures.forEach(t=>t.addEventListener('dispose',()=>disposed++));
 disposeScene(base,visual,shells);assert.equal(disposed,textures.size);optical++;
}
const scene=new THREE.Scene(),rig=addStudioLighting(scene);
assert.equal(scene.children.length,1);assert.equal(rig.key.shadow.mapSize.x,1024);
let shadowLights=0;scene.traverse(o=>{if(o instanceof THREE.Light&&o.castShadow)shadowLights++});assert.equal(shadowLights,1);
assert.equal(rig.floor.userData.exclude_from_export,true);assert.equal(rig.floor.userData.exclude_from_fit,true);
rig.key.shadow.dispose();disposeScene(scene);optical++;
console.log(`${optical} optical contracts checked: deterministic maps, physical presets, radius bounds, resource disposal and one shadow caster. No image-quality or solver certification is implied.`);

// Zoom/responsive display ticks must remain legible and bounded; input remains meters.
import {meterStep,meterTicks,meterLabel,rulerSteps} from '../../frontend/src/visual-assets/engineeringTicks';
for(const scale of [8,15,25,80,200,600,1000]){
 const {major,minor}=rulerSteps(scale);
 assert.ok(major*scale>=56-1e-8);assert.ok(minor*scale>=14-1e-8);
 for(const origin of [-200,190,960]){
  const ticks=meterTicks(origin,scale,32,390,minor);
  assert.ok(ticks.length<=27);
  for(const t of ticks)assert.ok(origin+t*scale>=32-1e-8&&origin+t*scale<=390+1e-8);
 }
}
assert.deepEqual(meterTicks(0,0,0,390,1),[]);
assert.deepEqual(meterTicks(0,1,0,1e9,1),[]);
assert.equal(meterStep(.28),.5);assert.equal(meterLabel(-0,.1),'0.0');
console.log('7 responsive/zoom tick scales checked; ruler spacing >=56px and grid spacing >=14px without changing snapping.');
