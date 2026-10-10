import { useEffect, useRef, useState } from "react";
import { engineeringQuantity, formatNumber } from "@/lib/format";
import { niceAxis, tickPrecision } from "@/lib/chart-axis";
import { displayText, displayUnit } from "@/lib/display-names";
import { EmptyState } from "./states";
export type ChartSeries = {
  id: string;
  label: string;
  points: { x: number; y: number | null; label?: string }[];
};
export function SeriesChart({
  series,
  xLabel,
  yLabel,
  quantity,
  unit,
  controls = false,
}: {
  series: ChartSeries[];
  xLabel: string;
  yLabel: string;
  quantity: string;
  unit: string;
  controls?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(900);
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    if (!host.current) return;
    const resize = new ResizeObserver((entries) =>
      setWidth(Math.max(320, entries[0].contentRect.width)),
    );
    resize.observe(host.current);
    return () => resize.disconnect();
  }, []);
  const all = series.flatMap((series) =>
    series.points
      .filter(
        (point) =>
          Number.isFinite(point.x) &&
          point.y !== null &&
          Number.isFinite(point.y),
      )
      .map((point) => ({
        ...point,
        y: engineeringQuantity(quantity, point.y, unit).value!,
      })),
  );
  if (!all.length)
    return <EmptyState title="尚无可绘制的保存数据" description="" />;
  const xmin = Math.min(...all.map((p) => p.x)),
    xmax = Math.max(...all.map((p) => p.x)),
    ymin = Math.min(...all.map((p) => p.y)),
    ymax = Math.max(...all.map((p) => p.y));
  const axis = niceAxis(ymin, ymax),
    { low, high } = axis;
  // 数据点不多（如网格收敛的几级网格）时，每个点都标出自己的横坐标；点多时取首、中、尾
  const distinctX = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b);
  const xTicks = distinctX.length <= 8 ? distinctX : [...new Set([xmin, xmin + (xmax - xmin) / 2, xmax])];
  const xPrecision = tickPrecision(xTicks);
  const left = 88,
    right = width - 24,
    top = 32,
    bottom = 270;
  const X = (value: number) =>
      left +
      (xmax === xmin ? 0.5 : (value - xmin) / (xmax - xmin)) * (right - left),
    Y = (value: number) =>
      bottom - ((value - low) / (high - low)) * (bottom - top);
  return (
    <div className="series-chart" ref={host}>
      <div className="series-legend">
        {series.map((item, index) => (
          <span key={item.id}>
            <svg width="28" height="12" aria-hidden="true">
              <line
                className={`series-line series-${index % 3}`}
                x1="0"
                x2="28"
                y1="6"
                y2="6"
              />
            </svg>
            {/* 没有任何有效点的系列在图例里写明“无数据”，不留一个勾着却看不到的选项 */}
            {!item.points.some((point) => point.y !== null && Number.isFinite(point.y) && Number.isFinite(point.x))
              ? <span className="muted">{item.label}（无数据）</span>
              : controls ? <label><input type="checkbox" checked={!hidden.includes(item.id)} onChange={() => setHidden(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])} /> {item.label}</label> : item.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} 320`}
        role="img"
        aria-label={yLabel + "；横轴 " + xLabel}
      >
        <title>{yLabel}，只连接保存样本，缺失值留空</title>
        {axis.ticks.map((value, index) => {
          return (
            <g key={index}>
              <line
                className="chart-grid"
                x1={left}
                x2={right}
                y1={Y(value)}
                y2={Y(value)}
              />
              <text x={left - 12} y={Y(value) + 4} textAnchor="end">
                {formatNumber(value, axis.precision)}
              </text>
            </g>
          );
        })}
        <text x={left} y="18">
          {displayText(yLabel)} / {engineeringQuantity(quantity, 0, unit).unit}
        </text>
        {series.map((item, index) => {
          let previous: { x: number; y: number } | null = null;
          return (
            <g key={item.id} className={`series-${index % 3}`} data-series={item.id} visibility={controls && hidden.includes(item.id) ? 'hidden' : undefined}>
              {item.points.map((point, sample) => {
                if (point.y === null || !Number.isFinite(point.y)) {
                  previous = null;
                  return null;
                }
                const current = {
                    x: X(point.x),
                    y: Y(engineeringQuantity(quantity, point.y, unit).value!),
                  },
                  segment = previous;
                previous = current;
                return (
                  <g key={sample}>
                    {segment && (
                      <line
                        className="series-line"
                        x1={segment.x}
                        x2={current.x}
                        y1={segment.y}
                        y2={current.y}
                      />
                    )}
                    <circle
                      className="series-point"
                      cx={current.x}
                      cy={current.y}
                      r="4"
                    >
                      <title>
                        {item.label} · {point.label || point.x} ·{" "}
                        {engineeringQuantity(quantity, point.y, unit).original}
                      </title>
                    </circle>
                  </g>
                );
              })}
            </g>
          );
        })}
        {xTicks.map((value) => (
          <text key={value} x={X(value)} y="292" textAnchor="middle">
            {formatNumber(value, xPrecision)}
          </text>
        ))}
        <text x={(left + right) / 2} y="314" textAnchor="middle">
          {displayUnit(displayText(xLabel))}
        </text>
      </svg>
    </div>
  );
}
