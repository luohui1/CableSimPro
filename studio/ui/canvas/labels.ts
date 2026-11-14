// Label placement on the drawing. Every label claims a rectangle; a later label takes the first
// candidate position that is free. Nothing on the canvas may overlap anything else.

export interface Rect { x: number; y: number; w: number; h: number }
export type Side = 'n' | 's' | 'e' | 'w';

export const hits = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

const inside = (rect: Rect, area: Rect) =>
  rect.x >= area.x && rect.y >= area.y && rect.x + rect.w <= area.x + area.w && rect.y + rect.h <= area.y + area.h;

let context: CanvasRenderingContext2D | null = null;

/** Width of a text run in the interface font. */
export function textWidth(text: string, size = 13, weight = 400): number {
  context ??= document.createElement('canvas').getContext('2d');
  if (!context) return text.length * size * 0.62;
  context.font = `${weight} ${size}px "Noto Sans SC Variable", "Noto Sans SC", sans-serif`;
  return context.measureText(text).width;
}

/** A box beside a round object, on the first side where it is free; null when no side is. */
export function beside(anchor: { x: number; y: number; r: number }, w: number, h: number, order: Side[], taken: Rect[], area: Rect, gap = 9): (Rect & { side: Side }) | null {
  for (const side of order) {
    const rect: Rect = side === 'n' ? { x: anchor.x - w / 2, y: anchor.y - anchor.r - gap - h, w, h }
      : side === 's' ? { x: anchor.x - w / 2, y: anchor.y + anchor.r + gap, w, h }
      : side === 'e' ? { x: anchor.x + anchor.r + gap, y: anchor.y - h / 2, w, h }
      : { x: anchor.x - anchor.r - gap - w, y: anchor.y - h / 2, w, h };
    if (inside(rect, area) && !taken.some(other => hits(rect, other, 4))) return { ...rect, side };
  }
  return null;
}

/** A box centred on a point, if it is free. */
export function centred(x: number, y: number, w: number, h: number, taken: Rect[], area: Rect): Rect | null {
  const rect = { x: x - w / 2, y: y - h / 2, w, h };
  return inside(rect, area) && !taken.some(other => hits(rect, other, 6)) ? rect : null;
}
