import * as THREE from 'three';

/** Optical display presets, not measured material properties or solver inputs. */
export const CABLE_STUDIO = {
 version: 'studio-1', shadowSize: 1024, textureSize: 64,
 exposure: .92, background: '#edf1f5',
} as const;

/** Deterministic scalar microtexture. No network, image decoder or random seed drift.
 * RGB carries linear data; roughness uses G, bump uses R. NoColorSpace is deliberate.
 */
export function microSurface(kind: 'metal' | 'polymer'): THREE.DataTexture {
 const n = CABLE_STUDIO.textureSize, data = new Uint8Array(n * n * 4);
 let seed = kind === 'metal' ? 179 : 421;
 for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const noise = (seed >>> 24) / 255;
  const grain = kind === 'metal' ? .86 + .09 * Math.sin(y * 2.5) + .05 * noise : .7 + .3 * noise;
  const i = (y * n + x) * 4, value = Math.round(grain * 255);
  data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
 }
 const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
 texture.name = `display-only-${kind}-microstructure`;
 texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
 texture.repeat.set(kind === 'metal' ? 3 : 8, kind === 'metal' ? 12 : 3);
 texture.magFilter = texture.minFilter = THREE.LinearFilter;
 texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true;
 return texture;
}

/** Owned by one display group. Dispose with that group, never reuse in GLB export. */
export function studioMaterials(conductor: string, reference = false): THREE.MeshStandardMaterial[] {
 const metal = microSurface('metal'), polymer = microSurface('polymer');
 const copper = new THREE.MeshStandardMaterial({color: conductor === 'copper' ? '#c47c46' : '#bcc7d2', metalness: 1, roughness: .25, roughnessMap: metal, envMapIntensity: 1.2});
 const semiconductor = () => new THREE.MeshStandardMaterial({color: '#25272a', metalness: 0, roughness: .7, roughnessMap: polymer, bumpMap: polymer, bumpScale: .000014, envMapIntensity: .55, side: THREE.DoubleSide});
 const insulation = new THREE.MeshPhysicalMaterial({color: '#efece0', metalness: 0, roughness: .4, ior: 1.46, clearcoat: .12, clearcoatRoughness: .42, envMapIntensity: .7, side: THREE.DoubleSide});
 const screen = new THREE.MeshStandardMaterial({color: '#be8456', metalness: 1, roughness: .3, roughnessMap: metal, envMapIntensity: 1.1, side: THREE.DoubleSide});
 const jacket = new THREE.MeshPhysicalMaterial({color: '#101720', metalness: 0, roughness: .48, roughnessMap: polymer, bumpMap: polymer, bumpScale: .000022, ior: 1.48, clearcoat: .22, clearcoatRoughness: .36, envMapIntensity: .65, side: THREE.DoubleSide});
 const materials = [copper, semiconductor(), insulation, semiconductor(), screen, jacket];
 if(reference){
  // Studio macro photography: do not turn micrometre relief into visible corrugations.
  copper.color.set(conductor==='copper'?'#cf8552':'#c3cdd6');copper.roughness=.24;
  for(const i of [1,3]){materials[i].roughness=.72;materials[i].bumpScale=.000003;materials[i].envMapIntensity=.35;}
  jacket.color.set('#151b22');jacket.roughness=.39;jacket.bumpScale=.000004;jacket.clearcoat=.3;jacket.clearcoatRoughness=.27;
  insulation.roughness=.34;insulation.clearcoat=.18;screen.roughness=.32;
 }
 materials.forEach((m, i) => {m.name = `optical-preset-${i}`; m.userData = {display_only: true, measured_material: false};});
 return materials;
}

/** Small edge roll-off lives inside the same radius/length envelope; display only. */
export function roundedShell(inner: number, outer: number, length: number): THREE.LatheGeometry {
 const b = Math.min((outer - inner) * .18, .00035), h = length / 2;
 return new THREE.LatheGeometry([
  new THREE.Vector2(inner, -h + b), new THREE.Vector2(inner + b, -h),
  new THREE.Vector2(outer - b, -h), new THREE.Vector2(outer, -h + b),
  new THREE.Vector2(outer, h - b), new THREE.Vector2(outer - b, h),
  new THREE.Vector2(inner + b, h), new THREE.Vector2(inner, h - b),
  new THREE.Vector2(inner, -h + b),
 ], 96);
}

/** One shadow-casting source, not post-processing AO or a simulated thermal field. */
export function addStudioLighting(scene: THREE.Scene, reference = false) {
 const rig = new THREE.Group(); rig.name = 'Display studio lighting';
 rig.add(new THREE.HemisphereLight('#ffffff', '#67758a', .75));
 const key = new THREE.DirectionalLight('#fff3e5', 3.0); key.position.set(-.22, .6, .4);
 key.castShadow = true; key.shadow.mapSize.setScalar(CABLE_STUDIO.shadowSize);
 Object.assign(key.shadow.camera, {left: -.38, right: .38, top: .32, bottom: -.32, near: .05, far: 2});
 key.shadow.bias = -.00008; key.shadow.normalBias = .00018;
 const fill = new THREE.DirectionalLight('#dce8ff', .75); fill.position.set(.35, .12, .65);
 const rim = new THREE.DirectionalLight('#ffffff', 2.6); rim.position.set(-.1, .38, -.6);
 const floor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShadowMaterial({color: '#283c54', opacity: .19}));
 floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'Display shadow catcher';
 floor.userData = {display_only: true, exclude_from_fit: true, exclude_from_export: true};
 if(reference){key.position.set(-.12,.9,.24);fill.intensity=1.1;floor.material.opacity=.11;}
 rig.add(key, fill, rim, floor); scene.add(rig);
 return {rig, floor, key};
}
