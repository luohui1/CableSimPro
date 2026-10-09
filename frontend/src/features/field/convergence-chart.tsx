import "./field.css";
import { useEffect, useRef, useState } from "react";

/** A plot of sealed observations; no extrapolation or convergence verdict. */
export function ConvergenceChart({ values, label, unit, threshold }: { values: (number | null)[]; label: string; unit: string; threshold?: number }) {
  const host = useRef<HTMLElement>(null), [width, setWidth] = useState(920);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [values.length]);
  const finite = values.flatMap((value, index) => value !== null && Number.isFinite(value) ? [{ value, index }] : []);
  if (finite.length < 2) return null;
  const minimum = Math.min(...finite.map(item => item.value), ...(threshold === undefined ? [] : [0])), maximum = Math.max(...finite.map(item => item.value), ...(threshold === undefined ? [] : [threshold*1.25]));
  const point = (value: number, index: number) => `${72 + index / Math.max(1, values.length - 1) * (width - 100)},${192 - (value - minimum) / (maximum - minimum || 1) * 152}`;
  return <figure ref={host} className="fem-convergence-chart"><figcaption>{label} · {unit}</figcaption>
    <svg viewBox={`0 0 ${width} 232`} role="img" aria-label={label}>
      <path className="fem-chart-axis" d={`M72 32V192H${width - 28}`} />
      {threshold !== undefined && <g className="fem-chart-threshold"><path d={`M${point(threshold,0)}H${width-28}`} /><text x={width-28} y={Number(point(threshold,0).split(',')[1])-8} textAnchor="end">门槛 {threshold} {unit}</text></g>}
      <path className="fem-chart-line" d={finite.map((item,index) => `${index && finite[index-1].index===item.index-1 ? 'L' : 'M'}${point(item.value,item.index)}`).join(" ")} />
      {finite.map(item => { const [x, y] = point(item.value, item.index).split(","); return <g key={item.index}><circle className="fem-chart-dot" cx={x} cy={y} r="3" />{(item.index % Math.ceil(values.length / 8) === 0 || item.index === values.length - 1) && <text x={x} y="218" textAnchor="middle">{item.index + 1}</text>}</g>; })}
      <text x="4" y="40">{maximum.toPrecision(3)}</text><text x="4" y="192">{minimum.toPrecision(3)}</text>
    </svg>
  </figure>;
}
