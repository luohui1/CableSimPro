import { decodeMesh, primitiveMesh } from './display-mesh';
import { TURBO_GLSL } from '../field/colormap';
import { pixelRay, surfacePoint } from './scene-measurement';
import type { CadScene, CadThermal, SceneObject, Transform } from './types';

const vertex = `#version 300 es
in vec3 point; in vec3 normal; uniform mat4 matrix; out vec3 surface; out float axial;
void main(){gl_Position=matrix*vec4(point,1.);surface=normal;axial=point.y;}`;
const fragment = `#version 300 es
precision highp float; in vec3 surface; in float axial; uniform vec4 tint; uniform float cut; uniform bool picking; out vec4 color;
void main(){if(axial>cut)discard;float light=picking?1.:.72+.28*abs(dot(normalize(surface+vec3(.00001)),normalize(vec3(.4,-.6,.8))));color=vec4(tint.rgb*light,tint.a);}`;
const fieldVertex = `#version 300 es
in vec2 point; in float value; in vec2 local; in vec4 corners; uniform vec2 origin; uniform vec2 dx; uniform vec2 dz; uniform vec2 size; out float temperature; out vec2 uv; flat out vec4 cell;
void main(){vec2 p=origin+point.x*dx+point.y*dz;gl_Position=vec4(p.x/size.x*2.-1.,1.-p.y/size.y*2.,0.,1.);temperature=value;uv=local;cell=corners;}`;
const fieldFragment = `#version 300 es
precision highp float; in float temperature; in vec2 uv; flat in vec4 cell; uniform bool regular; uniform float minimum; uniform float span; uniform bool difference; uniform vec3 negative; uniform vec3 positive; uniform vec3 neutral; out vec4 color;
${TURBO_GLSL}
void main(){float value=regular?mix(mix(cell.x,cell.y,uv.x),mix(cell.w,cell.z,uv.x),uv.y):temperature;float t=clamp((value-minimum)/span,0.,1.);vec3 rgb=difference?mix(neutral,t<.5?negative:positive,abs(t*2.-1.)):turbo(t);color=vec4(rgb,.82);}`;
const opacity = { cable: 1, enclosure: .42, backfill: .18, soil: .08, ground: .1 };
const priority = { ground: -1, soil: 0, backfill: 1, enclosure: 2, cable: 3 };
type Part = { buffer: WebGLBuffer; data: Float32Array; key: string; count: number; object: SceneObject; index: number; color: readonly number[] };
type SceneView = { matrix: Float32Array; width: number; height: number; background: number[]; fallback: number[]; selected?: string; cut: number };
type FieldView = { width: number; height: number; size: number[]; origin: number[]; dx: number[]; dz: number[]; negative: number[]; positive: number[]; neutral: number[] };
const transform = (t: Transform, p: number[]) => [0, 1, 2].map(i => t[i * 4] * p[0] + t[i * 4 + 1] * p[1] + t[i * 4 + 2] * p[2] + t[i * 4 + 3]);
let canvas: OffscreenCanvas, gl: WebGL2RenderingContext, program: WebGLProgram;
let scene: CadScene | undefined, thermal: CadThermal | undefined, view: SceneView | FieldView;
let parts: Part[] = [], fieldBuffers: WebGLBuffer[] = [], framebuffer: WebGLFramebuffer, texture: WebGLTexture, depth: WebGLRenderbuffer;
let targetWidth = 0, targetHeight = 0;

function compile(v: string, f: string) {
  const shaders: WebGLShader[] = [], result = gl.createProgram()!;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, v], [gl.FRAGMENT_SHADER, f]] as const) {
      const shader = gl.createShader(type)!; shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('三维着色器编译失败。'); gl.attachShader(result, shader);
    }
    gl.linkProgram(result); if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error('三维着色器连接失败。'); return result;
  } catch (error) { gl.deleteProgram(result); throw error; }
  finally { for (const shader of shaders) gl.deleteShader(shader); }
}
const uniform = (name: string) => gl.getUniformLocation(program, name);

function target(width: number, height: number) {
  if (width === targetWidth && height === targetHeight) return;
  canvas.width = width; canvas.height = height; targetWidth = width; targetHeight = height;
  if (!scene) return;
  gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('三维对象选择缓冲区不可用。');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function paintScene(picking = false) {
  if (!scene || !view) return;
  const v = view as SceneView; target(v.width, v.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, picking ? framebuffer : null); gl.viewport(0, 0, canvas.width, canvas.height);
  const background = picking ? [0, 0, 0] : v.background; gl.clearColor(background[0], background[1], background[2], 1);
  gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
  if (picking) { gl.disable(gl.BLEND); gl.disable(gl.DITHER); } else { gl.enable(gl.DITHER); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
  gl.useProgram(program); gl.uniformMatrix4fv(uniform('matrix'), false, v.matrix); gl.uniform1i(uniform('picking'), picking ? 1 : 0); gl.uniform1f(uniform('cut'), v.cut);
  const position = gl.getAttribLocation(program, 'point'), normal = gl.getAttribLocation(program, 'normal'); gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(normal);
  const ordered = parts.slice().sort((a, b) => picking ? priority[a.object.kind] - priority[b.object.kind] : opacity[b.object.kind] - opacity[a.object.kind]);
  const displaySoil = scene.objects.find(o => o.kind === 'ground')?.id.replace(/\/ground$/, '/soil'); let lastPriority = -2;
  for (const part of ordered) {
    if (picking && (part.object.kind === 'ground' || part.object.id === displaySoil)) continue;
    const level = priority[part.object.kind]; if (picking && level !== lastPriority) { gl.clear(gl.DEPTH_BUFFER_BIT); lastPriority = level; }
    gl.bindBuffer(gl.ARRAY_BUFFER, part.buffer); gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 24, 12);
    const id = part.index + 1, color = picking ? [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255] : part.color.length ? part.color : v.fallback;
    const alpha = picking ? 1 : part.object.kind === 'cable' ? v.selected && v.selected !== part.object.id ? .62 : 1 : opacity[part.object.kind];
    gl.depthMask(picking || alpha === 1); gl.uniform4f(uniform('tint'), color[0], color[1], color[2], alpha); gl.drawArrays(gl.TRIANGLES, 0, part.count);
  }
  gl.depthMask(true); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function uploadScene(value: CadScene) {
  const next: Part[] = [];
  try {
    for (const [index, object] of value.objects.entries()) for (const part of object.parts) {
      const key = JSON.stringify([part.asset_id, value.assets[part.asset_id].geometry_key, part.transform_mm, value.length_m]);
      const previous = parts.find(p => p.key === key);
      if (previous) { next.push({ ...previous, object, index, color: value.assets[part.asset_id].display_color || [] }); continue; }
      const asset = value.assets[part.asset_id], mesh = asset.display_mesh ? decodeMesh(asset.display_mesh) : primitiveMesh(value.length_m, asset), data: number[] = [];
      for (const prototype of mesh.prototypes) for (const instance of prototype.instances) {
        const positions = prototype.positions!, triangles = prototype.triangles!;
        for (let i = 0; i < triangles.length; i += 3) {
          const p = [0, 1, 2].map(j => { const k = triangles[i + j] * 3; return transform(part.transform_mm, transform(instance, [positions[k], positions[k + 1], positions[k + 2]])); });
          const a = p[1].map((v, j) => v - p[0][j]), b = p[2].map((v, j) => v - p[0][j]);
          const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], length = Math.hypot(...n) || 1;
          for (const point of p) data.push(...point, ...n.map(v => v / length));
        }
      }
      const vertices = new Float32Array(data), buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      next.push({ buffer, data: vertices, key, count: data.length / 6, object, index, color: asset.display_color || [] });
    }
  } catch (error) { for (const part of next) if (!parts.some(p => p.buffer === part.buffer)) gl.deleteBuffer(part.buffer); throw error; }
  for (const part of parts) if (!next.some(p => p.buffer === part.buffer)) gl.deleteBuffer(part.buffer); parts = next; scene = value;
  targetWidth = 0; targetHeight = 0;
}

function uploadField(value: CadThermal) {
  for (const buffer of fieldBuffers) gl.deleteBuffer(buffer); fieldBuffers = []; thermal = value; gl.useProgram(program);
  const attribute = (name: string, data: Float32Array, count: number) => {
    const buffer = gl.createBuffer()!; fieldBuffers.push(buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, count, gl.FLOAT, false, 0, 0);
  };
  if (value.quads?.length) {
    const positions: number[] = [], values: number[] = [], local: number[] = [], corners: number[] = [];
    for (const q of value.quads) for (const i of [0, 1, 2, 0, 2, 3]) {
      positions.push(...value.points[q[i]]); values.push(value.values[q[i]]);
      local.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0); corners.push(...q.map(n => value.values[n]));
    }
    attribute('point', new Float32Array(positions), 2); attribute('value', new Float32Array(values), 1);
    attribute('local', new Float32Array(local), 2); attribute('corners', new Float32Array(corners), 4);
  } else {
    for (const name of ['local', 'corners']) gl.disableVertexAttribArray(gl.getAttribLocation(program, name));
    attribute('point', new Float32Array(value.points.flat()), 2); attribute('value', new Float32Array(value.values), 1);
    const index = gl.createBuffer()!; fieldBuffers.push(index); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(value.triangles.flat()), gl.STATIC_DRAW);
  }
}
function paintField() {
  if (!thermal || !view) return;
  const v = view as FieldView; target(v.width, v.height); gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(program);
  gl.uniform2fv(uniform('origin'), v.origin); gl.uniform2fv(uniform('dx'), v.dx); gl.uniform2fv(uniform('dz'), v.dz); gl.uniform2fv(uniform('size'), v.size);
  gl.uniform1f(uniform('minimum'), thermal.minimum); gl.uniform1f(uniform('span'), Math.max(1e-6, thermal.maximum - thermal.minimum));
  gl.uniform1i(uniform('difference'), thermal.kind === 'difference' ? 1 : 0);
  gl.uniform1i(uniform('regular'), thermal.quads?.length ? 1 : 0);
  gl.uniform3fv(uniform('negative'), v.negative); gl.uniform3fv(uniform('positive'), v.positive); gl.uniform3fv(uniform('neutral'), v.neutral);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  if (thermal.quads?.length) gl.drawArrays(gl.TRIANGLES, 0, thermal.quads.length * 6);
  else gl.drawElements(gl.TRIANGLES, thermal.triangles.length * 3, gl.UNSIGNED_INT, 0);
}
function diagnostics() {
  const extension = gl.getExtension('WEBGL_debug_renderer_info'), pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const colors = new Set<string>(); for (let i = 0; i < pixels.length; i += 64) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
  return { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), colors: colors.size, size: [canvas.width, canvas.height] };
}

self.onmessage = event => {
  const { id, type, payload } = event.data;
  try {
    if (type === 'init') {
      canvas = payload.canvas;
      const context = canvas.getContext('webgl2', { alpha: payload.kind === 'field', antialias: payload.kind !== 'field', preserveDrawingBuffer: true });
      if (!context) throw new Error('三维 WebGL 2 不可用，请切回二维。'); gl = context;
      canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); self.postMessage({ error: '三维图形上下文丢失；请重载视口或切回二维。' }); });
      program = compile(payload.kind === 'field' ? fieldVertex : vertex, payload.kind === 'field' ? fieldFragment : fragment);
      framebuffer = gl.createFramebuffer()!; texture = gl.createTexture()!; depth = gl.createRenderbuffer()!;
    } else if (type === 'scene') { uploadScene(payload.geometry); view = payload.view; paintScene(); }
    else if (type === 'field') { uploadField(payload.thermal); view = payload.view; paintField(); }
    else if (type === 'draw') { view = payload; if (scene) paintScene(); else paintField(); }
    else if (type === 'capture') { if (scene) paintScene(); else paintField(); canvas.convertToBlob({ type: 'image/png' }).then(value => self.postMessage({ id, value })).catch(error => self.postMessage({ id, error: String(error) })); return; }
    else if (type === 'pick') {
      paintScene(true); const pixel = new Uint8Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.readPixels(payload.x, payload.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const object = scene!.objects[pixel[0] + (pixel[1] << 8) + (pixel[2] << 16) - 1];
      let point: readonly number[] | undefined;
      if (object && payload.measure) {
        const v = view as SceneView, ray = pixelRay(v.matrix, payload.x + .5, payload.y + .5, canvas.width, canvas.height);
        const hits = parts.filter(p => p.object.id === object.id).map(p => surfacePoint(p.data, ray.origin, ray.direction, v.cut)).filter(h => !!h).sort((a, b) => a.distance - b.distance);
        point = hits[0]?.point;
      }
      paintScene(); self.postMessage({ id, value: { id: object?.id, point } }); return;
    }
    if (id) { if (type === 'draw' || type === 'field') gl.finish(); self.postMessage({ id, value: type === 'scene' ? diagnostics() : true }); }
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
