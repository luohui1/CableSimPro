/** A private display worker; no solver or engineering calculation runs here. */
export class SceneWorkerClient {
  private worker = new Worker(new URL('./input-scene-worker.ts', import.meta.url), { type: 'module' });
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();
  private alive = true;
  constructor(onError: (error: Error) => void) {
    this.worker.onmessage = event => {
      const { id, value, error } = event.data, pending = this.pending.get(id);
      if (pending) { window.clearTimeout(pending.timer); this.pending.delete(id); if (error) pending.reject(new Error(error)); else pending.resolve(value); }
      else if (error) onError(new Error(error));
    };
    this.worker.onerror = event => {
      const error = new Error(event.message || '三维显示 worker 不可用。');
      for (const pending of this.pending.values()) { window.clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); onError(error);
    };
  }
  request(type: string, payload: unknown, transfer: Transferable[] = []) {
    if (!this.alive) return Promise.reject(new Error('三维视口已关闭。'));
    const id = ++this.sequence;
    return new Promise<unknown>((resolve, reject) => {
      const timer = window.setTimeout(() => { this.pending.delete(id); reject(new Error('三维显示 worker 超时，请重载视口或切回二维。')); }, 3000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ id, type, payload }, transfer); } catch (error) { window.clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  draw(payload: unknown) { if (this.alive) this.worker.postMessage({ type: 'draw', payload }); }
  dispose() {
    if (!this.alive) return; this.alive = false; this.worker.terminate();
    for (const pending of this.pending.values()) { window.clearTimeout(pending.timer); pending.reject(new Error('三维视口已关闭。')); } this.pending.clear();
  }
}
