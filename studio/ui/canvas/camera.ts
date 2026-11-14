// The section is drawn to true scale: one camera scale for both axes, z upward, ground at z = 0.

export interface Camera { cx: number; cz: number; /** Pixels per metre. */ scale: number }
export interface Size { width: number; height: number }
/** A region of the section in metres; top is above bottom. */
export interface Box { left: number; right: number; top: number; bottom: number }
export interface Inset { top: number; right: number; bottom: number; left: number }

export const toScreen = (camera: Camera, size: Size, x: number, z: number): [number, number] =>
  [size.width / 2 + (x - camera.cx) * camera.scale, size.height / 2 - (z - camera.cz) * camera.scale];

export const toWorld = (camera: Camera, size: Size, sx: number, sy: number): [number, number] =>
  [camera.cx + (sx - size.width / 2) / camera.scale, camera.cz - (sy - size.height / 2) / camera.scale];

/** The camera that shows a box inside the canvas, leaving the inset free for tools and labels. */
export function frame(box: Box, size: Size, inset: Inset): Camera {
  const width = Math.max(1, size.width - inset.left - inset.right);
  const height = Math.max(1, size.height - inset.top - inset.bottom);
  const scale = Math.min(width / (box.right - box.left), height / (box.top - box.bottom));
  const centreX = inset.left + width / 2;
  const centreY = inset.top + height / 2;
  return {
    scale,
    cx: (box.left + box.right) / 2 - (centreX - size.width / 2) / scale,
    cz: (box.top + box.bottom) / 2 + (centreY - size.height / 2) / scale,
  };
}

/** Zoom that keeps the point under the pointer where it is. */
export function zoomAt(camera: Camera, size: Size, sx: number, sy: number, factor: number, limits: { min: number; max: number }): Camera {
  const scale = Math.max(limits.min, Math.min(limits.max, camera.scale * factor));
  const [x, z] = toWorld(camera, size, sx, sy);
  return { scale, cx: x - (sx - size.width / 2) / scale, cz: z + (sy - size.height / 2) / scale };
}

/** Between two cameras; the scale moves geometrically so that a zoom feels even. */
export const mixCamera = (from: Camera, to: Camera, t: number): Camera => ({
  cx: from.cx + (to.cx - from.cx) * t,
  cz: from.cz + (to.cz - from.cz) * t,
  scale: Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * t),
});

/** A round grid step, in metres, that is about `pixels` wide on screen. */
export function gridStep(scale: number, pixels = 48): number {
  const raw = pixels / scale;
  const power = 10 ** Math.floor(Math.log10(raw));
  const lead = raw / power;
  return (lead < 1.5 ? 1 : lead < 3.5 ? 2 : lead < 7.5 ? 5 : 10) * power;
}
