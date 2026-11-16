// The plugin-built solid shown with three.js: published display meshes only, never a locally invented shape.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CadPrototype, ProductCad } from '@shared/cad';

function unpack(text: string, kind: 'positions' | 'triangles') {
  const bytes = Uint8Array.from(atob(text), char => char.charCodeAt(0));
  if (!bytes.length || bytes.length % 4) throw new Error('CAD 显示网格缓冲区无效。');
  return kind === 'positions' ? new Float32Array(bytes.buffer) : new Uint32Array(bytes.buffer);
}
function meshGeometry(prototype: CadPrototype) {
  const positions = unpack(prototype.positions_f32, 'positions');
  const indices = unpack(prototype.triangles_u32, 'triangles');
  if (positions.length % 3 || indices.length % 3 || !positions.every(Number.isFinite) || !indices.every(index => index < positions.length / 3)) throw new Error('CAD 显示网格索引或坐标无效。');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}
const MATERIAL_COLORS: Record<string, string> = { conductor: '#c7884b', conductor_screen: '#3b4651', insulation: '#eee8db', insulation_screen: '#3b4651', metallic_screen: '#b5784f', filler: '#d0d6d2', binder: '#9aaba7', bedding: '#7e929b', armour: '#8797a6', oversheath: '#243548' };

export function CadViewport({ data, cutaway, selected, background = '#e8edf3' }: { data: ProductCad; cutaway: boolean; selected: string; background?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!container.current) return;
    const element = container.current;
    let renderer: THREE.WebGLRenderer | undefined;
    let observer: ResizeObserver | undefined;
    let controls: OrbitControls | undefined;
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    try {
      if (data.model.schema !== 'cablesim.cad-model/1' || data.model.axis !== '+Z' || !data.model.layers.length) throw new Error('几何工件版本或坐标轴不受支持。');
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setClearColor(background);
      renderer.localClippingEnabled = true;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      element.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight('#ffffff', '#8a99ab', 2.5));
      const light = new THREE.DirectionalLight('#ffffff', 3); light.position.set(250, 250, 400); scene.add(light);
      const object = new THREE.Group(); scene.add(object);
      const visibleBounds = new THREE.Box3();
      const length = data.model.length_m * 1000;
      for (const layer of data.model.layers) {
        const mesh = layer.display_mesh;
        if (mesh?.schema !== 'cablesim.display-mesh/1' || mesh.unit !== 'mm' || mesh.byte_order !== 'little') throw new Error('此层未提供可用的 OCCT 显示网格；未生成替代形状。');
        const fraction = cutaway ? layer.peel_fraction ?? 1 : 1;
        const material = new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS[layer.role] ?? '#8a9bb0', roughness: layer.role === 'conductor' || layer.role === 'armour' ? .38 : .72,
          metalness: ['conductor', 'metallic_screen', 'armour'].includes(layer.role) ? .4 : 0,
          transparent: Boolean(selected && layer.role !== selected), opacity: selected && layer.role !== selected ? .16 : 1,
          side: THREE.DoubleSide, clippingPlanes: cutaway ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), length * fraction)] : [] });
        materials.push(material);
        for (const prototype of mesh.prototypes) {
          const geometry = meshGeometry(prototype); geometries.push(geometry);
          for (const transform of prototype.instances) {
            if (transform.length !== 12 || !transform.every(Number.isFinite)) throw new Error('CAD 实例变换无效。');
            const body = new THREE.Mesh(geometry, material);
            // Plugin transforms are a row-major 3x4 affine matrix in mm.
            body.applyMatrix4(new THREE.Matrix4().set(transform[0], transform[1], transform[2], transform[3], transform[4], transform[5], transform[6], transform[7], transform[8], transform[9], transform[10], transform[11], 0, 0, 0, 1));
            object.add(body);
            const bodyBounds = new THREE.Box3().setFromObject(body);
            bodyBounds.max.z = Math.min(bodyBounds.max.z, length * fraction);
            if (!bodyBounds.isEmpty()) visibleBounds.union(bodyBounds);
          }
        }
      }
      const bounds = visibleBounds;
      const centre = bounds.getCenter(new THREE.Vector3());
      const span = bounds.getSize(new THREE.Vector3()).length();
      if (!Number.isFinite(span) || span <= 0) throw new Error('CAD 实体范围无效。');
      const camera = new THREE.PerspectiveCamera(35, 1, span / 1000, span * 20);
      camera.position.copy(centre).add(new THREE.Vector3(span * .9, span * .55, span * 1.2));
      camera.lookAt(centre);
      controls = new OrbitControls(camera, renderer.domElement); controls.target.copy(centre); controls.enableDamping = false;
      const draw = () => renderer?.render(scene, camera);
      controls.addEventListener('change', draw);
      const resize = () => {
        if (!renderer || !controls) return;
        const width = element.clientWidth, height = element.clientHeight;
        renderer.setSize(width, height); camera.aspect = width / Math.max(1, height);
        // Fit all visible bounding-box corners to both dimensions after a resize.
        const direction = camera.position.clone().sub(centre).normalize();
        const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
        const up = new THREE.Vector3().crossVectors(direction, right).normalize();
        const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const horizontal = vertical * camera.aspect;
        let distance = 0;
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(centre);
          distance = Math.max(distance, corner.dot(direction) + Math.max(Math.abs(corner.dot(right)) / horizontal, Math.abs(corner.dot(up)) / vertical));
        }
        camera.position.copy(centre).addScaledVector(direction, distance * 1.16);
        controls.target.copy(centre); controls.update(); camera.updateProjectionMatrix(); draw();
      };
      observer = new ResizeObserver(resize); observer.observe(element); resize(); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    return () => { observer?.disconnect(); controls?.dispose(); geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); renderer?.dispose(); renderer?.domElement.remove(); };
  }, [data, cutaway, selected, background]);
  return <><div className="cad-viewport" ref={container} role="img" aria-label="CadQuery 生成的电缆 CAD 实体" />{error && <p role="alert" className="cad-viewport-error">三维显示不可用：{error}仍可下载原始 STEP 文件。</p>}</>;
}

export function download(text: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

