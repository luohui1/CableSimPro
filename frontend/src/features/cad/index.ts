import { deferredView } from '@/components/deferred-view';
export function prewarmCad() {
  void import('./cad-viewport');
  void import('./occt-runtime').then(m => m.prewarmRuntime()).catch(() => { /* The viewport reports a retryable failure. */ });
}
export const CadViewport = deferredView(() => import('./cad-viewport').then(m => ({ default: m.CadViewport })));
export type { CadViewportProps, CadViewportHandle, CadGeometry, CadModel, CadScene, CadSelection,
  CadTiming, CadCamera, CadPick, CanvasState } from './types';
