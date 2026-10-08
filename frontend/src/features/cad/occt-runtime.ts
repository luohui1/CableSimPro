import type { CadPick, DisplayMesh, Transform } from './types';

type NativeResult = number | boolean | { error?: string };

export interface NativeViewer {
  initialize(id: string, red: number, green: number, blue: number): NativeResult;
  clearModel(): void;
  outlineColors(...colors: number[]): void;
  camera(yaw: number, elevation: number, zoom: number, panX: number, panY: number, heading: number): void;
  resize(): void;
  project(x: number, y: number, z: number): { x: number; y: number };
  envelopeBrep(inner: number, outer: number, length: number): string | { error: string };
  addPart(brep: string, ...arguments_: (number | boolean)[]): NativeResult;
  replacePart(index: number, brep: string, ...arguments_: (number | boolean)[]): NativeResult;
  addMeshPart(mesh: DisplayMesh, ...arguments_: (number | boolean)[]): NativeResult;
  replaceMeshPart(index: number, mesh: DisplayMesh, ...arguments_: (number | boolean)[]): NativeResult;
  finishUpdate(diameter: number, mode: string, selected: number, selection: string, section: number): void;
  configureScene(bounds: number[], groups: { bounds: number[]; kind: string; priority: number }[]): NativeResult;
  setScenePart(index: number, group: number, transform: Transform, opacity: number, selectable: boolean): NativeResult;
  configureModelPart(index: number, outline: string, peelFraction: number): NativeResult;
  setSelectionMode(mode: string): void;
  setMode(mode: string): void;
  setSection(fraction: number): void;
  selectPart(index: number): void;
  setInteracting(value: boolean): void;
  hover(x: number, y: number): void;
  hitTest(x: number, y: number): boolean;
  pick(x: number, y: number): CadPick | null | { error: string };
  measurePair(enabled: boolean): void;
  viewportInfo(): Record<string, unknown>;
}

interface FactoryOptions {
  canvas: HTMLCanvasElement;
  locateFile: (name: string) => string;
  instantiateWasm: (imports: WebAssembly.Imports,
    receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => object;
  printErr: (message: string) => void;
}
type NativeFactory = (options: FactoryOptions) => Promise<NativeViewer>;

// Vite copies the immutable build assets into the distribution, with content hashes.
const wrapperUrl = new URL('./node_modules/.cache/cablesim-occt/occt-viewer.js', import.meta.url).href;
const wasmUrl = new URL('./node_modules/.cache/cablesim-occt/occt-viewer.wasm', import.meta.url).href;
const compiled = new Map<string, Promise<{ factory: NativeFactory; module: WebAssembly.Module }>>();
let compilations = 0;
let activeInstances = 0;
let createdInstances = 0;
let disposedInstances = 0;

export function runtimeDiagnostics() {
  return { compilations, activeInstances, createdInstances, disposedInstances, compiledEntries: compiled.size };
}

async function compiledRuntime() {
  let pending = compiled.get(wasmUrl);
  const cacheHit = !!pending;
  if (!pending) {
    pending = (async () => {
      const [wrapper, response] = await Promise.all([
        import(/* @vite-ignore */ wrapperUrl) as Promise<{ default: NativeFactory }>,
        fetch(wasmUrl),
      ]);
      if (!response.ok) throw new Error('OCCT WASM 运行文件读取失败；请重试或重新准备本地资产。');
      // Streaming and an immutable URL reuse native browser code caches. No IndexedDB module serialization.
      const module = response.headers.get('content-type')?.includes('application/wasm')
        ? await WebAssembly.compileStreaming(response)
        : await WebAssembly.compile(await response.arrayBuffer());
      if (typeof wrapper.default !== 'function') throw new Error('OCCT JavaScript 运行接口不可用。');
      compilations += 1;
      return { factory: wrapper.default, module };
    })();
    compiled.set(wasmUrl, pending);
    pending.catch(() => { if (compiled.get(wasmUrl) === pending) compiled.delete(wasmUrl); });
  }
  return { ...await pending, cacheHit };
}

/** Start immutable fetch/async WASM compilation before a viewport needs an instance. */
export function prewarmRuntime() { return compiledRuntime().then(() => undefined); }

export function checked<T>(value: T): T {
  if (value && typeof value === 'object' && 'error' in value && value.error) {
    throw new Error(String(value.error));
  }
  return value;
}

export async function createNativeViewer(canvas: HTMLCanvasElement) {
  const { factory, module, cacheHit } = await compiledRuntime();
  let rejectInstantiation: (reason: unknown) => void = () => {};
  const failed = new Promise<never>((_resolve, reject) => { rejectInstantiation = reject; });
  const instance = factory({
    canvas,
    locateFile: name => name.endsWith('.wasm') ? wasmUrl : new URL(name, wrapperUrl).href,
    instantiateWasm(imports, receive) {
      WebAssembly.instantiate(module, imports).then(value => {
        try { receive(value, module); } catch (error) { rejectInstantiation(error); }
      }, rejectInstantiation);
      return {};
    },
    printErr: message => console.error('[OCCT]', message),
  });
  const native = await Promise.race([instance, failed]);
  createdInstances += 1;
  activeInstances += 1;
  let disposed = false;
  let initialized = false;
  return {
    native,
    cacheHit,
    markInitialized() { initialized = true; },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { native.clearModel(); } finally {
        const context = initialized ? canvas.getContext('webgl2') || canvas.getContext('webgl') : null;
        context?.getExtension('WEBGL_lose_context')?.loseContext();
        canvas.remove();
        activeInstances -= 1;
        disposedInstances += 1;
      }
    },
  };
}
