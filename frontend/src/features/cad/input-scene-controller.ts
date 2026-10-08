import { tokenColor } from './cad-renderer';
import { clamp, validateGeometry } from './geometry-contract';
import { SceneWorkerClient } from './scene-worker-client';
import type { Callbacks, ViewportController } from './cad-controller';
import type { CadCamera, CadGeometry, CadMode, CadScene, CadSelection, CadTiming, CadView, CameraPose } from './types';

class InputSceneController implements ViewportController {
  private alive = true;
  private revision = 0;
  private scene: CadScene | null = null;
  private displayed = false;
  private selected: CadSelection = null;
  private currentMode: CadMode = 'scene';
  private fraction = .55;
  private pose: CameraPose;
  private namedView: CadCamera['view'] = 'iso';
  private matrix = new Float32Array(16);
  private events = new AbortController();
  private resize: ResizeObserver;
  private theme: MutationObserver;
  private drag: { x: number; y: number; startX: number; startY: number; pan: boolean } | null = null;
  private frame = 0;

  constructor(private host: HTMLElement, private canvas: HTMLCanvasElement, private worker: SceneWorkerClient,
    private callbacks: Callbacks, initial: Partial<CameraPose>) {
    this.pose = { yaw: 0, elevation: Math.atan(1 / Math.sqrt(2)), heading: -Math.PI / 4, zoom: 1, panX: 0, panY: 0, ...initial };
    this.bind(); this.resize = new ResizeObserver(() => this.draw()); this.resize.observe(host);
    this.theme = new MutationObserver(() => this.draw()); this.theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  private bind() {
    const options = { signal: this.events.signal }, canvas = this.canvas;
    canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
    canvas.addEventListener('pointerdown', event => {
      if (![0, 1, 2].includes(event.button)) return;
      event.preventDefault(); canvas.focus(); canvas.setPointerCapture(event.pointerId);
      this.drag = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, pan: event.button !== 0 };
    }, options);
    canvas.addEventListener('pointermove', event => {
      const drag = this.drag; if (!drag) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y; drag.x = event.clientX; drag.y = event.clientY;
      if (drag.pan) { this.pose.panX += dx / this.host.clientWidth; this.pose.panY -= dy / this.host.clientHeight; }
      else { this.pose.heading += dx * .008; this.pose.elevation += dy * .008; this.namedView = 'free'; }
      this.schedule();
    }, options);
    canvas.addEventListener('pointerup', event => {
      const drag = this.drag; this.drag = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (drag && !drag.pan && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) void this.pick(event.clientX, event.clientY);
    }, options);
    canvas.addEventListener('pointercancel', () => { this.drag = null; }, options);
    canvas.addEventListener('wheel', event => { event.preventDefault(); this.pose.zoom *= Math.exp(-clamp(event.deltaY, -200, 200) * .002); this.schedule(); }, { ...options, passive: false });
    canvas.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === 'f') this.fit();
      if (event.key === 'Escape') this.callbacks.onSelectionChange(null);
      if (event.key === '+' || event.key === '=') this.zoom(1.15);
      if (event.key === '-') this.zoom(.85);
    }, options);
  }
  private schedule() { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); }); }
  private projection() {
    const bounds = this.scene!.crop_bounds_m.map(v => v * 1000), center = [0, 1, 2].map(i => (bounds[i] + bounds[i + 3]) / 2);
    this.pose.elevation = clamp(this.pose.elevation, -.7, Math.PI / 2); this.pose.zoom = clamp(this.pose.zoom, .65, 3);
    this.pose.panX = clamp(this.pose.panX, -.4, .4); this.pose.panY = clamp(this.pose.panY, -.4, .4);
    const c = Math.cos(this.pose.heading), s = Math.sin(this.pose.heading), e = Math.sin(this.pose.elevation), f = Math.cos(this.pose.elevation);
    const right = [c, s, 0], up = [-s * e, c * e, f], eye = [s * f, -c * f, e];
    const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
    const corners = Array.from({ length: 8 }, (_, i) => center.map((v, k) => bounds[k + ((i >> k) & 1) * 3] - v));
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    const extent = (basis: number[]) => Math.max(...corners.map(p => Math.abs(dot(basis, p)))) * 2;
    const pixels = .82 * Math.min(w / Math.max(1, extent(right)), h / Math.max(1, extent(up))) * this.pose.zoom;
    const x = right.map(v => v * pixels * 2 / w), y = up.map(v => v * pixels * 2 / h);
    const z = eye.map(v => -v / Math.max(1, Math.hypot(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2])));
    this.matrix = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, center) + this.pose.panX * 2, -dot(y, center) + this.pose.panY * 2, -dot(z, center), 1]);
  }
  private viewData() {
    this.projection(); const dpr = Math.min(2, devicePixelRatio || 1);
    return { matrix: this.matrix, width: Math.max(1, Math.round(this.host.clientWidth * dpr)), height: Math.max(1, Math.round(this.host.clientHeight * dpr)),
      background: tokenColor(this.host, '--panel'), fallback: tokenColor(this.host, '--text-secondary'), selected: this.selected?.id,
      cut: this.currentMode === 'section' ? this.scene!.length_m * this.fraction * 1000 : 1e20 };
  }
  private changed() { this.callbacks.onCameraChange({ ...this.pose, view: this.namedView, mode: this.currentMode, section: this.fraction }); }
  private draw() {
    if (!this.alive || !this.scene) return;
    this.worker.draw(this.viewData()); this.changed();
  }
  private async pick(x: number, y: number) {
    const box = this.canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    try {
      const id = await this.worker.request('pick', { x: Math.floor((x - box.left) * dpr), y: Math.floor((box.bottom - y) * dpr) });
      if (!this.alive) return;
      this.callbacks.onSelectionChange(typeof id === 'string' ? { kind: 'object', id } : null); this.callbacks.onPick(typeof id === 'string' ? { object_id: id } : null);
    } catch (error) { if (this.alive) this.callbacks.onError(error instanceof Error ? error : new Error(String(error))); }
  }
  async update(geometry: CadGeometry): Promise<CadTiming | null> {
    if (geometry.schema !== 'cablesim.cad-scene/1' || geometry.display_source !== 'domain-input') throw new Error('输入场景视口只接受同源显示网格。');
    validateGeometry(geometry); const start = performance.now(), token = ++this.revision, first = !this.displayed; this.scene = geometry;
    const diagnostic = await this.worker.request('scene', { geometry, view: this.viewData() }) as { renderer: string; colors: number; size: number[] };
    if (!this.alive || token !== this.revision) return null;
    this.displayed = true;
    this.canvas.dataset.webglRenderer = diagnostic.renderer; this.canvas.dataset.webglColors = String(diagnostic.colors);
    this.canvas.dataset.webglSize = diagnostic.size.join(','); this.changed();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return { phase: first ? 'first-display' : 'update', schema: geometry.schema, inputSha256: geometry.input_sha256, envelope: true,
      elapsedMs: performance.now() - start, nativeUpdateMs: 0, replacedParts: geometry.objects.reduce((n, o) => n + o.parts.length, 0), reusedParts: 0, runtimeCacheHit: false };
  }
  select(value: CadSelection) { this.selected = value; this.draw(); }
  mode(value: CadMode) { this.currentMode = value; this.draw(); }
  section(value: number) { this.fraction = clamp(value, .05, .95); this.draw(); }
  fit() { Object.assign(this.pose, { zoom: 1, panX: 0, panY: 0 }); this.draw(); }
  zoom(value: number) { this.pose.zoom *= value; this.draw(); }
  project(x: number, y: number, z: number) {
    const m = this.matrix; return { x: (m[0] * x + m[4] * y + m[8] * z + m[12] + 1) * this.host.clientWidth / 2,
      y: (1 - m[1] * x - m[5] * y - m[9] * z - m[13]) * this.host.clientHeight / 2 };
  }
  info() { return this.alive ? { scene: true, scene_objects: this.scene?.objects.length || 0, input_sha256: this.scene?.input_sha256, renderer: 'webgl-input-worker' } : null; }
  async selection(value: string) { if (value !== 'part') throw new Error('输入网格不提供原始拓扑量测。'); return true; }
  view(value: CadView) {
    this.namedView = value; this.pose.elevation = value === 'top' ? Math.PI / 2 : value === 'iso' ? Math.atan(1 / Math.sqrt(2)) : 0;
    this.pose.heading = value === 'end' ? 0 : value === 'front' ? -Math.PI / 2 : -Math.PI / 4; this.draw();
  }
  dispose() {
    if (!this.alive) return; this.alive = false; this.revision++; cancelAnimationFrame(this.frame); this.events.abort(); this.resize.disconnect(); this.theme.disconnect(); this.worker.dispose(); this.canvas.remove();
  }
}

export async function mountInputScene(host: HTMLElement, callbacks: Callbacks, initial: Partial<CameraPose>, current: () => boolean): Promise<ViewportController | null> {
  if (!current()) return null;
  if (!HTMLCanvasElement.prototype.transferControlToOffscreen) throw new Error('当前浏览器缺少后台三维渲染环境，请切回二维。');
  const canvas = document.createElement('canvas'); canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '敷设三维画布。左键旋转，中键或右键平移，滚轮缩放，F 适应窗口。'); host.append(canvas);
  const worker = new SceneWorkerClient(callbacks.onError), offscreen = canvas.transferControlToOffscreen();
  try {
    await worker.request('init', { canvas: offscreen, kind: 'scene' }, [offscreen]);
    if (!current()) { worker.dispose(); canvas.remove(); return null; }
    return new InputSceneController(host, canvas, worker, callbacks, initial);
  } catch (error) { worker.dispose(); canvas.remove(); throw error; }
}
