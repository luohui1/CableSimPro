import { deferredView } from '@/components/deferred-view';
export const CadViewport = deferredView(() => import('./cad-viewport').then(m => ({ default: m.CadViewport })));
export type { CadViewportProps, CadViewportHandle, CadGeometry, CadModel, CadScene, CadSelection,
  CadTiming, CadCamera, CadPick, CanvasState } from './types';
