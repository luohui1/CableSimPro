// The GPU layer of the section: soil, grid, temperature field and isotherms.
// Rendered by three's WebGPU renderer (WebGL 2 where WebGPU is not available) with a node shader, so the
// isotherms are computed per pixel and stay sharp at any zoom. Vector drawing and text are a separate SVG layer.
import { abs, attribute, float, fract, fwidth, length, log, max, mix, positionWorld, smoothstep, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
// The isotherm and grid lines are the ink colour at low strength, so they read on every tint of the ramp.
import * as THREE from 'three/webgpu';
import { RAMP_SIZE, type Ramp } from '@/lib/ramp';
import type { Camera, Size } from './camera';
import type { FieldModel } from './field-model';

export interface FieldStyle {
  ramp: Ramp;
  /** Conductor limit in °C: the top of the ramp. */
  limit: number;
  ambient: number;
  /** Isotherm interval in kelvin. */
  step: number;
  isotherms: boolean;
  ink: string;
}

type Scalar = THREE.Node<'float'>;
const EXTENT = 400;

export class FieldLayer {
  /** Set once the renderer is ready. null means no GPU path is available and nothing is drawn here. */
  backend: 'webgpu' | 'webgl2' | null = null;
  readonly ready: Promise<void>;

  #renderer: THREE.WebGPURenderer | null = null;
  #scene = new THREE.Scene();
  #camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  #soil: THREE.Mesh | null = null;
  #field: THREE.Mesh | null = null;
  #ramp: THREE.DataTexture | null = null;
  #grid = uniform(0.1);
  #gridOn = uniform(1);
  #isotherms = uniform(1);
  #frame = 0;
  #disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.ready = (async () => {
      try {
        const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
        await renderer.init();
        if (this.#disposed) { renderer.dispose(); return; }
        renderer.setClearColor(0x000000, 0);
        this.#renderer = renderer;
        this.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
      } catch {
        this.backend = null;
      }
    })();
  }

  /** Soil below the ground line, with the field on it when the run has one. */
  setContent(model: FieldModel | null, style: FieldStyle) {
    if (!this.#renderer) return;
    this.#clear();
    this.#ramp = new THREE.DataTexture(style.ramp.fieldBytes, RAMP_SIZE, 1, THREE.RGBAFormat);
    this.#ramp.colorSpace = THREE.SRGBColorSpace;
    this.#ramp.minFilter = THREE.LinearFilter;
    this.#ramp.magFilter = THREE.LinearFilter;
    this.#ramp.needsUpdate = true;
    this.#isotherms.value = style.isotherms ? 1 : 0;

    const half = new THREE.PlaneGeometry(EXTENT * 2, EXTENT);
    half.translate(0, -EXTENT / 2, 0);
    const soil = new THREE.MeshBasicNodeMaterial();
    soil.colorNode = this.#shade(float(style.ambient), style, false);
    this.#soil = new THREE.Mesh(half, soil);
    this.#soil.renderOrder = 0;
    this.#scene.add(this.#soil);
    if (!model) return this.request();

    const material = new THREE.MeshBasicNodeMaterial();
    let geometry: THREE.BufferGeometry = half;
    if (model.kind === 'analytic') {
      const point = positionWorld.xy;
      let temperature: Scalar = float(model.ambient);
      for (const source of model.sources) {
        const direct = max(length(point.sub(vec2(source.x, source.z))), float(1e-4));
        const mirrored = length(point.sub(vec2(source.x, -source.z)));
        temperature = temperature.add(float(source.k).mul(log(mirrored.div(direct))));
      }
      material.colorNode = this.#shade(temperature, style, true);
    } else {
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(model.mesh.points.flatMap(([x, z]) => [x, z, 0])), 3));
      geometry.setAttribute('temperature', new THREE.BufferAttribute(model.mesh.celsius, 1));
      geometry.setIndex(model.mesh.triangles.flat());
      material.colorNode = this.#shade(attribute('temperature', 'float'), style, true);
    }
    this.#field = new THREE.Mesh(geometry, material);
    this.#field.renderOrder = 1;
    this.#scene.add(this.#field);
    this.request();
  }

  setIsotherms(on: boolean) {
    this.#isotherms.value = on ? 1 : 0;
    this.request();
  }

  setView(camera: Camera, size: Size, step: number) {
    if (!this.#renderer) return;
    const halfWidth = size.width / (2 * camera.scale);
    const halfHeight = size.height / (2 * camera.scale);
    this.#camera.left = camera.cx - halfWidth;
    this.#camera.right = camera.cx + halfWidth;
    this.#camera.top = camera.cz + halfHeight;
    this.#camera.bottom = camera.cz - halfHeight;
    this.#camera.updateProjectionMatrix();
    this.#renderer.setPixelRatio(window.devicePixelRatio);
    this.#renderer.setSize(size.width, size.height, false);
    this.#grid.value = step;
    this.request();
  }

  request() {
    if (this.#frame || !this.#renderer) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      if (!this.#disposed) this.#renderer?.render(this.#scene, this.#camera);
    });
  }

  dispose() {
    this.#disposed = true;
    cancelAnimationFrame(this.#frame);
    this.#clear();
    this.#renderer?.dispose();
    this.#renderer = null;
  }

  #clear() {
    for (const mesh of [this.#soil, this.#field]) {
      if (!mesh) continue;
      this.#scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.#ramp?.dispose();
    this.#soil = null;
    this.#field = null;
    this.#ramp = null;
  }

  /** Colour of a temperature: ramp, then the drawing grid, then isotherm lines at a constant pixel width. */
  #shade(temperature: Scalar, style: FieldStyle, lines: boolean) {
    const ramp = this.#ramp as THREE.DataTexture;
    const position = temperature.sub(style.ambient).div(Math.max(1, style.limit - style.ambient)).clamp(0, 1);
    const base = texture(ramp, vec2(position.mul((RAMP_SIZE - 1) / RAMP_SIZE).add(0.5 / RAMP_SIZE), 0.5)).rgb;
    const ink = new THREE.Color(style.ink);
    const stroke = vec3(ink.r, ink.g, ink.b);

    // Coverage of a line set at multiples of `every`, `halfWidth` pixels to each side.
    const coverage = (value: Scalar, every: Scalar | number, halfWidth: number) => {
      const scaled = value.div(every);
      const distance = abs(fract(scaled.sub(0.5)).sub(0.5)).div(max(fwidth(scaled), float(1e-6)));
      return float(1).sub(smoothstep(halfWidth - 0.5, halfWidth + 0.5, distance));
    };

    const point = positionWorld.xy;
    const fine = max(coverage(point.x, this.#grid, 0.5), coverage(point.y, this.#grid, 0.5)).mul(0.05);
    const coarse = max(coverage(point.x, this.#grid.mul(5), 0.5), coverage(point.y, this.#grid.mul(5), 0.5)).mul(0.09);
    let colour = mix(base, stroke, max(fine, coarse).mul(this.#gridOn));
    if (lines) {
      const minor = coverage(temperature, style.step, 0.5).mul(0.2);
      const major = coverage(temperature, style.step * 2, 0.8).mul(0.5);
      colour = mix(colour, stroke, max(minor, major).mul(this.#isotherms));
    }
    return vec4(colour, 1);
  }
}
