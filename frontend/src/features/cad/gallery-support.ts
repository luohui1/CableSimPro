import type { ComponentType } from 'react';
import type { CanvasState } from './types';

export interface GalleryEntry { id: string; title: string; Component: ComponentType<{ state: CanvasState }> }
export interface GalleryProbe {
  setState?: (state: CanvasState) => void;
  cad?: { snapshot: () => unknown; replace: (kind: 'envelope' | 'preview' | 'unkeyed-preview' | 'exact' | 'invalid' | 'changed') => void;
    mount: (value: boolean) => void; mismatchExact: (value: boolean) => void; exportImage?: () => Promise<unknown>; project?: (x: number, y: number, z: number) => { x: number; y: number } | null };
  field?: { exportImage: () => Promise<unknown>; snapshot: () => unknown };
  whatIf?: { snapshot: () => unknown; project: (x: number, z: number) => { x: number; y: number } | null };
  cable?: { snapshot: () => unknown; lock: (value: boolean) => void; construction: (value: 'single' | 'three') => void; fail: (value: boolean) => void };
  laying?: { snapshot: () => unknown; lock: (field: string | null) => void; fail: (value: boolean) => void };
}
declare global { interface Window { canvasGallery?: GalleryProbe } }
