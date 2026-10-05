import { engineeringQuantity, formatNumber } from "./format.ts";
import { displayName, displayUnit } from "./display-names.ts";
type Point = { x: number | null; value: number | null };
/** Descriptive endpoint difference only; gaps/nonmonotonic points prohibit a slope claim. */
export function sweepSummary(
  points: Point[],
  variable: string,
  xUnit: string,
  key: string,
  yUnit: string,
) {
  const valid = points
    .filter(
      (point): point is { x: number; value: number } =>
        point.x !== null &&
        point.value !== null &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.value),
    )
    .sort((a, b) => a.x - b.x);
  if (valid.length < 2) return "尚不足两个有效采样点，无法比较变化";
  const first = valid[0],
    last = valid.at(-1)!;
  const a = engineeringQuantity(key, first.value, yUnit),
    b = engineeringQuantity(key, last.value, yUnit);
  const x = (value: number) => Number(value.toPrecision(6)).toString();
  const base = `${variable} ${x(first.x)}→${x(last.x)} ${displayUnit(xUnit)}，${displayName(key)} ${a.text}→${b.text} ${a.unit}`;
  const deltas = valid
    .slice(1)
    .map((point, index) => point.value - valid[index].value);
  if (
    valid.length !== points.length ||
    last.x <= first.x ||
    valid.some((point, index) => index > 0 && point.x === valid[index - 1].x)
  )
    return base;
  if (
    !deltas.every((value) => value <= 0) &&
    !deltas.every((value) => value >= 0)
  )
    return base + "，中间采样点存在转折";
  const increment = 10 ** Math.floor(Math.log10((last.x - first.x) / 2));
  const change = ((b.value! - a.value!) / (last.x - first.x)) * increment;
  if (change === 0) return base + "，已采样范围内保持不变";
  return (
    base +
    `，区间平均每增加 ${x(increment)} ${displayUnit(xUnit)} 约${change < 0 ? "降" : "增"} ${formatNumber(Math.abs(change), Math.abs(change) >= 10 ? 0 : 1)} ${a.unit}`
  );
}
