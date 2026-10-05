import type { DrawingView, PixelSize, ScreenPoint, WorldPoint } from './types';

export const snapCoordinate = (value: number, enabled: boolean, stepM: number) => {
  if (!Number.isFinite(value) || !Number.isFinite(stepM) || stepM <= 0) throw new Error('捕捉坐标和步长必须为有限有效值。');
  return enabled ? Math.round(value / stepM) * stepM : value;
};

export function worldToScreen(point: WorldPoint, view: DrawingView, size: PixelSize): ScreenPoint {
  const scale = size.width / view.widthM;
  return { x: size.width / 2 + (point.x - view.x) * scale, y: size.height / 2 - (point.z - view.z) * scale };
}

export function screenToWorld(point: ScreenPoint, view: DrawingView, size: PixelSize): WorldPoint {
  const scale = size.width / view.widthM;
  return { x: view.x + (point.x - size.width / 2) / scale, z: view.z - (point.y - size.height / 2) / scale };
}

export function zoomView(view: DrawingView, factor: number, pointer: ScreenPoint, size: PixelSize): DrawingView {
  const anchor = screenToWorld(pointer, view, size);
  const widthM = Math.max(.02, Math.min(100, view.widthM * factor));
  const next = { ...view, widthM };
  const after = screenToWorld(pointer, next, size);
  return { ...next, x: view.x + anchor.x - after.x, z: view.z + anchor.z - after.z };
}

export function fitBounds(bounds: { left: number; right: number; bottom: number; top: number }, size: PixelSize): DrawingView {
  const width = Math.max(bounds.right - bounds.left, (bounds.top - bounds.bottom) * size.width / Math.max(1, size.height), .02);
  return { x: (bounds.left + bounds.right) / 2, z: (bounds.top + bounds.bottom) / 2, widthM: width * 1.32 };
}
