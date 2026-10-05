/** Readable ticks around the observed range; no fitting or resampling. */
export function niceAxis(minimum: number, maximum: number, intervals = 4) {
  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    maximum < minimum
  )
    throw Error("图表范围无效");
  const span = maximum - minimum || Math.max(Math.abs(minimum) * 0.1, 1);
  const power = 10 ** Math.floor(Math.log10(span / intervals));
  const step = [1, 2, 2.5, 4, 5, 10]
    .map((value) => value * power)
    .find((value) => value >= span / intervals)!;
  let low = Math.floor(minimum / step + 1e-10) * step;
  let high = Math.ceil(maximum / step - 1e-10) * step;
  if (low === high) {
    low -= step;
    high += step;
  }
  const precision = Math.min(
    12,
    Math.max(0, -Math.floor(Math.log10(step))) + (step / power === 2.5 ? 1 : 0),
  );
  const ticks = Array.from(
    { length: Math.round((high - low) / step) + 1 },
    (_, index) => Number((low + step * index).toPrecision(14)),
  );
  return { low, high, ticks, precision };
}
export function tickPrecision(values: number[]) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const step =
    sorted.length > 1
      ? Math.min(
          ...sorted.slice(1).map((value, index) => value - sorted[index]),
        )
      : 1;
  return Math.min(12, Math.max(0, 1 - Math.floor(Math.log10(step))));
}
