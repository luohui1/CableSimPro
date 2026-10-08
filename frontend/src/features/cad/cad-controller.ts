import { motionToken } from '@/components/motion';
import { CadRenderer, tokenColor } from './cad-renderer';
import { clamp, matchingExactModel } from './geometry-contract';
import { checked, createNativeViewer } from './occt-runtime';
import type { CameraPose, CadCamera, CadGeometry, CadMode, CadModel, CadPick, CadSelection,
  CadTiming, CadView, MeasurementMode } from './types';

const defaultPose: CameraPose = { yaw: 0, elevation: Math.atan(1 / Math.sqrt(2)), heading: -Math.PI / 4,
  zoom: 1, panX: 0, panY: 0 };
type NativeSession = Awaited<ReturnType<typeof createNativeViewer>>;
export interface Callbacks {
  onCameraChange: (camera: CadCamera) => void;
  onSelectionChange: (selection: CadSelection) => void;
  onPick: (pick: CadPick | null) => void;
  onError: (error: Error) => void;
  loadExact?: (model: CadModel, signal: AbortSignal) => Promise<CadModel>;
}
interface Drag { x: number; y: number; startX: number; startY: number; moved: boolean; pan: boolean }

export class CadController {
  private alive = true;
  private applying = false;
  private revision = 0;
  private animation = 0;
  private queued: Promise<unknown> = Promise.resolve();
  private pose: CameraPose;
  private renderer: CadRenderer;
  private drag: Drag | null = null;
  private events = new AbortController();
  private exactRequest: AbortController | null = null;
  private resizeObserver: ResizeObserver;
  private themeObserver: MutationObserver;

  constructor(private host: HTMLElement, private canvas: HTMLCanvasElement, private session: NativeSession,
    private callbacks: Callbacks, initialCamera: Partial<CameraPose>) {
    this.pose = { ...defaultPose };
    for (const key of Object.keys(defaultPose) as (keyof CameraPose)[]) {
      if (Number.isFinite(initialCamera[key])) this.pose[key] = initialCamera[key]!;
    }
    this.renderer = new CadRenderer(session.native, host);
    this.resize();
    const background = tokenColor(host, '--panel');
    session.markInitialized();
    checked(session.native.initialize(canvas.id, background[0], background[1], background[2]));
    session.native.outlineColors(...tokenColor(host, '--text'), ...tokenColor(host, '--text-secondary'));
    this.bind();
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.alive || this.applying) return;
      this.resize();
      session.native.resize();
      this.draw();
    });
    this.resizeObserver.observe(host);
    this.themeObserver = new MutationObserver(() => {
      const model = this.renderer.geometry;
      if (!this.alive || !model) return;
      const colors = tokenColor(host, '--panel');
      checked(session.native.initialize(canvas.id, colors[0], colors[1], colors[2]));
      session.native.outlineColors(...tokenColor(host, '--text'), ...tokenColor(host, '--text-secondary'));
      void this.update(model, true).catch(error => callbacks.onError(asError(error)));
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-theme'] });
  }

  private resize(): void {
    const bounds = this.host.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    this.canvas.height = Math.max(1, Math.round(bounds.height * ratio));
  }

  private viewName(): CadView | 'free' {
    const flat = Math.abs(this.pose.elevation) < .001;
    if (Math.abs(this.pose.elevation - Math.PI / 2) < .001) {
      return this.renderer.geometry?.schema === 'cablesim.cad-scene/1' ? 'top' : 'end';
    }
    if (flat) return this.renderer.geometry?.schema === 'cablesim.cad-scene/1'
      ? Math.abs(this.pose.heading + Math.PI / 2) < .001 ? 'end' : 'front'
      : this.pose.heading > 0 ? 'top' : 'front';
    return Math.abs(this.pose.elevation - defaultPose.elevation) < .001
      && Math.abs(this.pose.heading - defaultPose.heading) < .001 ? 'iso' : 'free';
  }

  private draw(): void {
    if (!this.alive || this.applying) return;
    this.pose.elevation = clamp(this.pose.elevation, -.7, Math.PI / 2);
    this.pose.zoom = clamp(this.pose.zoom, .65, 3);
    this.pose.panX = clamp(this.pose.panX, -.28, .28);
    this.pose.panY = clamp(this.pose.panY, -.28, .28);
    this.session.native.camera(this.pose.yaw, this.pose.elevation, this.pose.zoom,
      this.pose.panX, this.pose.panY, this.pose.heading);
    this.callbacks.onCameraChange({ ...this.pose, view: this.viewName(), mode: this.renderer.mode, section: this.renderer.section });
  }

  private stop(): void {
    cancelAnimationFrame(this.animation);
    this.animation = 0;
  }

  private point(event: PointerEvent | MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: Math.round((event.clientX - rect.left) * this.canvas.width / rect.width),
      y: Math.round((event.clientY - rect.top) * this.canvas.height / rect.height) };
  }

  private bind(): void {
    const options = { signal: this.events.signal };
    const native = this.session.native;
    this.canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
    this.canvas.addEventListener('pointerdown', event => {
      if (!this.alive || this.applying || ![0, 1, 2].includes(event.button)) return;
      event.preventDefault();
      this.stop();
      native.setInteracting(true);
      this.canvas.focus();
      this.canvas.setPointerCapture(event.pointerId);
      this.drag = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
        moved: false, pan: event.button !== 0 };
    }, options);
    this.canvas.addEventListener('pointermove', event => this.move(event), options);
    this.canvas.addEventListener('pointerup', event => this.release(event), options);
    this.canvas.addEventListener('pointercancel', () => {
      this.drag = null;
      if (this.alive) native.setInteracting(false);
    }, options);
    this.canvas.addEventListener('pointerleave', () => { if (this.alive && !this.drag && !this.applying) native.hover(-1, -1); }, options);
    this.canvas.addEventListener('wheel', event => this.wheel(event), { ...options, passive: false });
    this.canvas.addEventListener('dblclick', event => {
      if (this.applying) return;
      const point = this.point(event);
      if (!native.hitTest(point.x, point.y)) this.fit();
    }, options);
    this.canvas.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || this.applying) return;
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); this.fit(); }
      if (['+', '=', '-'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); this.zoom(event.key === '-' ? .85 : 1.15);
      }
    }, options);
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      if (this.alive) this.callbacks.onError(new Error('WebGL 画布已丢失；输入工件仍保留，请重载视口。'));
    }, options);
  }

  private move(event: PointerEvent): void {
    if (!this.alive || this.applying) return;
    const point = this.point(event);
    if (!this.drag) { this.session.native.hover(point.x, point.y); return; }
    this.drag.moved ||= Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY) > 3;
    if (this.drag.moved) {
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      const rect = this.canvas.getBoundingClientRect();
      if (this.drag.pan) { this.pose.panX -= dx / rect.width; this.pose.panY += dy / rect.height; }
      else { this.pose.yaw += dx * .008; this.pose.elevation += dy * .005; }
      this.draw();
    }
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
  }

  private release(event: PointerEvent): void {
    if (!this.alive || !this.drag || this.applying) return;
    const pick = !this.drag.moved && !this.drag.pan;
    this.drag = null;
    this.session.native.setInteracting(false);
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (pick) {
      const point = this.point(event);
      const value = checked(this.session.native.pick(point.x, point.y));
      if (value && 'part' in value && typeof value.part === 'number') {
        const selection = this.renderer.selectionForPart(value.part);
        this.callbacks.onSelectionChange(selection);
        if (selection?.kind === 'object') value.object_id = selection.id;
      } else if (!value) this.callbacks.onSelectionChange(null);
      this.callbacks.onPick(value as CadPick | null);
      // The props remain authoritative even when a parent declines the selection request.
      this.renderer.select(this.renderer.selection);
      this.draw();
    }
  }

  private wheel(event: WheelEvent): void {
    if (!this.alive || this.applying) return;
    event.preventDefault();
    this.stop();
    this.session.native.hover(-1, -1);
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - .5;
    const y = .5 - (event.clientY - rect.top) / rect.height;
    const old = this.pose.zoom;
    this.pose.zoom = clamp(old * Math.exp(-clamp(event.deltaY, -200, 200) * .002), .65, 3);
    const ratio = this.pose.zoom / old;
    this.pose.panX = this.pose.panX * ratio + x * (ratio - 1);
    this.pose.panY = this.pose.panY * ratio + y * (ratio - 1);
    this.draw();
  }

  update(geometry: CadGeometry, preserveMeasurement = false): Promise<CadTiming | null> {
    const token = ++this.revision;
    this.exactRequest?.abort();
    const started = performance.now();
    const job = this.queued.catch(() => {}).then(async () => {
      if (!this.alive || token !== this.revision) return null;
      const previous = this.renderer.geometry;
      const first = !previous;
      this.applying = true;
      try {
        if (!preserveMeasurement) this.renderer.measurement = 'part';
        const result = await this.renderer.apply(geometry, () => this.alive && token === this.revision);
        if (!result) {
          if (this.alive && previous) await this.renderer.apply(previous, () => this.alive);
          return null;
        }
        this.session.native.measurePair(this.renderer.measurement === 'point');
        this.applying = false;
        this.session.native.resize();
        this.draw();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        return { phase: first ? 'first-display' : 'update', schema: geometry.schema,
          inputSha256: geometry.input_sha256, envelope: !!geometry.envelope,
          elapsedMs: performance.now() - started, nativeUpdateMs: result.elapsedMs,
          replacedParts: result.replacedParts, reusedParts: result.reusedParts, runtimeCacheHit: this.session.cacheHit } as CadTiming;
      } catch (error) {
        if (this.alive && previous) {
          try { await this.renderer.apply(previous, () => this.alive); }
          catch { this.session.native.clearModel(); }
        }
        throw error;
      } finally { this.applying = false; if (this.alive) this.draw(); }
    });
    this.queued = job;
    return job;
  }

  async selection(mode: MeasurementMode): Promise<boolean> {
    const model = this.renderer.geometry;
    if (!model || !this.alive) return false;
    if (model.schema === 'cablesim.cad-scene/1' && mode !== 'part') throw new Error('敷设场景按领域对象选择。');
    if (mode !== 'part') {
      if (model.envelope) throw new Error('包络预览不提供精确测量，请等待原始几何。');
      if (model.schema === 'cablesim.cad-model/1' && !model.layers.every(layer => layer.brep_text)) {
        if (!this.callbacks.loadExact) throw new Error('精确测量拓扑未接入，请由页面取得原始几何工件。');
        const controller = new AbortController();
        this.exactRequest?.abort();
        this.exactRequest = controller;
        const exact = await this.callbacks.loadExact(model, controller.signal);
        if (!this.alive || controller.signal.aborted || this.renderer.geometry !== model) return false;
        matchingExactModel(model, exact);
        this.renderer.measurement = mode;
        await this.update(exact, true);
      }
    }
    this.renderer.measurement = mode;
    if (mode !== 'part' && this.renderer.geometry) await this.update(this.renderer.geometry, true);
    this.session.native.setSelectionMode(mode);
    this.session.native.measurePair(mode === 'point');
    this.draw();
    return true;
  }

  select(selection: CadSelection): void {
    if (this.applying) this.renderer.selection = selection;
    else this.renderer.select(selection);
    this.draw();
  }
  mode(mode: CadMode): void { this.renderer.mode = mode; this.session.native.setMode(mode); this.draw(); }
  section(value: number): void { this.renderer.section = clamp(value, .05, .95); this.session.native.setSection(this.renderer.section); this.draw(); }
  fit(): void { this.stop(); Object.assign(this.pose, { zoom: 1, panX: 0, panY: 0 }); this.draw(); }
  zoom(factor: number): void { this.stop(); this.pose.zoom *= factor; this.draw(); }
  project(x: number, y: number, z: number) {
    const value = this.session.native.project(x, y, z);
    const bounds = this.canvas.getBoundingClientRect();
    return { x: value.x * bounds.width / this.canvas.width, y: value.y * bounds.height / this.canvas.height };
  }
  info() { return this.alive ? { ...this.session.native.viewportInfo(), input_sha256: this.renderer.geometry?.input_sha256 } : null; }

  view(view: CadView): void {
    this.stop();
    const scene = this.renderer.geometry?.schema === 'cablesim.cad-scene/1';
    const start = { ...this.pose };
    const end = { ...defaultPose,
      elevation: view === (scene ? 'top' : 'end') ? Math.PI / 2 : ['front', 'top', 'end'].includes(view) ? 0 : defaultPose.elevation,
      heading: scene ? view === 'front' ? 0 : ['end', 'top'].includes(view) ? -Math.PI / 2 : defaultPose.heading
        : view === 'top' ? Math.PI / 4 : defaultPose.heading };
    const began = performance.now();
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : motionToken('slow') * 1000;
    const frame = (now: number) => {
      if (!this.alive) return;
      const fraction = duration ? clamp((now - began) / duration, 0, 1) : 1;
      const eased = fraction < .5 ? 4 * fraction ** 3 : 1 - (-2 * fraction + 2) ** 3 / 2;
      for (const key of Object.keys(end) as (keyof CameraPose)[]) this.pose[key] = start[key] + (end[key] - start[key]) * eased;
      this.draw();
      this.animation = fraction < 1 ? requestAnimationFrame(frame) : 0;
    };
    if (!duration) frame(began);
    else this.animation = requestAnimationFrame(frame);
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    this.revision += 1;
    this.stop();
    this.exactRequest?.abort();
    this.events.abort();
    this.resizeObserver.disconnect();
    this.themeObserver.disconnect();
    this.renderer.dispose();
    this.session.dispose();
  }
}

export const asError = (error: unknown) => error instanceof Error ? error : new Error(String(error));
export type ViewportController = Pick<CadController, 'update' | 'select' | 'mode' | 'section' | 'fit' | 'zoom' | 'project' | 'info' | 'view' | 'selection' | 'dispose'> & { capture?: () => Promise<Blob> };

export async function mountController(host: HTMLElement, callbacks: Callbacks, initialCamera: Partial<CameraPose>, current: () => boolean): Promise<ViewportController | null> {
  const canvas = document.createElement('canvas');
  canvas.id = `occt-${crypto.randomUUID()}`;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '电缆 CAD 画布。左键旋转，中键或右键平移，滚轮缩放，F 适应窗口。');
  host.append(canvas);
  let session: NativeSession | null = null;
  try {
    session = await createNativeViewer(canvas);
    if (!current() || !host.isConnected) { session.dispose(); return null; }
    return new CadController(host, canvas, session, callbacks, initialCamera);
  } catch (error) { session?.dispose(); canvas.remove(); throw error; }
}
