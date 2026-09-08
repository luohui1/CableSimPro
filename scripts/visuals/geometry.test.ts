import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildCableGeometry} from '../../frontend/src/CableModelView';
import {cableAppearance,disposeScene} from '../../frontend/src/visual-assets/cableAppearance';
import type {Cable} from '../../frontend/src/types';
let count=0;
for(const conductor of ['copper','aluminium'] as const)for(const area_mm2 of [50,240,1000])for(const mode of ['assembled','cutaway','exploded'] as const){
 const cable={conductor,area_mm2,fill_factor:.92,conductor_screen_mm:.6,insulation_mm:4.5,insulation_screen_mm:.6,metallic_screen_mm:.35,jacket_mm:2.2} as Cable;
 const base=buildCableGeometry(cable,mode,[true,true,true,true,true,true]);
 const visual=cableAppearance(cable,mode,[true,true,true,true,true,true]);
 assert.equal(base.children.length,6);assert.equal(base.userData.units,'metres');assert.equal(visual.userData.not_solver_geometry,true);
 assert.ok(Math.abs(base.children[0].userData.outer_radius_m-Math.sqrt(area_mm2/(Math.PI*.92))/1000)<1e-12);
 visual.traverse(o=>{if(o instanceof THREE.Mesh){const a=o.geometry.getAttribute('position');for(let i=0;i<a.array.length;i++)assert.ok(Number.isFinite(a.array[i]))}});
 assert.equal(base.children.some(o=>o.userData.not_solver_geometry),false);
 disposeScene(base);disposeScene(visual);count++;
}
console.log(`${count} display-geometry configurations checked; all six-layer engineering envelopes preserved.`);
