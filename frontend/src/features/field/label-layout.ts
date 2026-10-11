export type Box = { x: number; y: number; w: number; h: number };
export function overlaps(a: Box, b: Box, gap = 6) {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}
/** Deterministic screen-space admission shared by hotspot, object and contour labels. */
export function placeLabel(candidates: Box[], occupied: Box[], width: number, height: number): Box | undefined {
  const candidate = candidates.find(box => box.x >= 6 && box.y >= 6 && box.x + box.w <= width - 6 && box.y + box.h <= height - 6 && !occupied.some(other => overlaps(box, other)));
  if (candidate) occupied.push(candidate);
  return candidate;
}
