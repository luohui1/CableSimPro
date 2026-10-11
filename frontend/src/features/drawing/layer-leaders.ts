import { formatNumber } from '@/lib/format';

export function layerMillimetres(valueM: number, diameter = false) {
  const value= formatNumber(valueM*1000, diameter ? 1 : 2);
  return diameter ? value : value.replace(/(\.\d*?[1-9])0+$|\.0+$/g,'$1');
}

export type Point = { x: number; y: number };
export type LeaderInput = { center: Point; radius: number };
export function leaderLayout(layers: readonly LeaderInput[], outerRight: number, width: number, height: number) {
  const top = 32, bottom = height - 44, step = Math.min(34, (bottom - top) / Math.max(1, layers.length - 1));
  const first = (top + bottom - step * (layers.length - 1)) / 2;
  const knee = Math.max(outerRight + 14, width - 252), textX = Math.max(knee + 24, width - 214);
  return layers.map((layer, i) => {
    const angle = (-50 + 100 * i / Math.max(1, layers.length - 1)) * Math.PI / 180;
    const anchor = { x: layer.center.x + layer.radius * Math.cos(angle), y: layer.center.y + layer.radius * Math.sin(angle) };
    const radius = Math.max(layer.radius + 12, outerRight - layer.center.x + 12);
    const radial = { x: layer.center.x + radius * Math.cos(angle), y: layer.center.y + radius * Math.sin(angle) };
    const y = first + i * step;
    return { anchor, points: [anchor, radial, { x: knee, y: radial.y }, { x: textX - 12, y }, { x: textX, y }], label: { x: textX, y }, angle };
  });
}

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < -1e-7 && side(c, d, a) * side(c, d, b) < -1e-7;
}
