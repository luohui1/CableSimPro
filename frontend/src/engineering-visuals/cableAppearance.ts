/** Display-only detail. Dimensions and exported engineering solids stay authoritative. */
import * as THREE from 'three';
import type {Cable} from '../types';
import {layers} from '../utils';

export function cableAppearance(cable: Cable, mode: string, visible: boolean[]) {
  const group = new THREE.Group();
  group.name = '显示细节 · 不参与求解';
  group.userData = {display_only: true, not_manufacturing_geometry: true};
  const radii = layers(cable).map(l => l.radius_mm / 1000);
  const copper = cable.conductor === 'copper' ? '#cb8643' : '#b8c4d0';
  const metal = new THREE.MeshStandardMaterial({color: copper, metalness: .78, roughness: .26});
  const conductorY = mode === 'exploded' ? -2.5 * .055 : 0;
  if (visible[0]) {
    // Illustrative strand count, not an inferred manufacturing specification.
    const wire = radii[0] / 7.4;
    const centers: [number, number][] = [];
    for (let row = -3; row <= 3; row++) for (let col = -3; col <= 3; col++) {
      const y = col * wire * 2 + (row % 2) * wire;
      const z = row * wire * Math.sqrt(3);
      if (Math.hypot(y, z) <= radii[0] - wire) centers.push([y, z]);
    }
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(wire * .96, wire * .96, .015, 12), metal, centers.length);
    const transform = new THREE.Object3D();
    centers.forEach(([y,z],i) => {
      transform.position.set(.184, conductorY + y, z);
      transform.rotation.z = -Math.PI / 2;
      transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
    });
    mesh.castShadow = true; group.add(mesh);
  }
  if (visible[4] && mode !== 'assembled') {
    const screen = new THREE.MeshStandardMaterial({color: '#b58a64', metalness: .76, roughness: .32});
    const radius = radii[4] * 1.005, y0 = mode === 'exploded' ? 1.5 * .055 : 0;
    for (let n=0; n<32; n++) {
      const points = Array.from({length: 17}, (_,i) => {
        const x = -.024 + i * .036 / 16, a = n * Math.PI / 16 + i * .018;
        return new THREE.Vector3(x, y0 + Math.cos(a) * radius, Math.sin(a) * radius);
      });
      const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, .00024, 5, false), screen);
      wire.castShadow = true; group.add(wire);
    }
  }
  return group;
}

export function disposeScene(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  scene.traverse(o => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      geometries.add(o.geometry);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => materials.add(m));
    }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
