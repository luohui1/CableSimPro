import { significantNumber } from "@/lib/format";
import { displayUnit } from "@/lib/display-names";

/**
 * 离散情形的数值对照（验证算例“结果对照图”）：每个情形一行，原文、开源、COMSOL 各一个标记，
 * 共用一根数值轴，右侧写出数值；没有的写“无数据”。不把不同情形连成曲线，也不出现“样本 2.5”这类刻度。
 */
export type ComparisonRow = { id: string; label: string; values: Partial<Record<SeriesKey, number | null>> };
type SeriesKey = "reference" | "open_source" | "comsol";
const SERIES: { key: SeriesKey; label: string }[] = [
  { key: "reference", label: "原文" },
  { key: "open_source", label: "开源" },
  { key: "comsol", label: "COMSOL" },
];
const WIDTH = 400, HEIGHT = 18, PAD = 10;

export function ComparisonDots({ rows, unit }: { rows: ComparisonRow[]; unit: string }) {
  const values = rows.flatMap((row) => SERIES.map(({ key }) => row.values[key])).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  let low = Math.min(...values), high = Math.max(...values);
  const spread = high - low || Math.max(Math.abs(high) * 1e-3, 1e-9);
  low -= spread * 0.1; high += spread * 0.1;
  const x = (value: number) => PAD + (value - low) / (high - low) * (WIDTH - 2 * PAD);
  const shown = displayUnit(unit === "1" ? "" : unit);
  const text = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? significantNumber(value, 5) : "无数据";
  return <figure className="comparison-dots">
    <div className="series-legend" aria-hidden="true">{SERIES.map(({ key, label }) => <span key={key}><svg viewBox="0 0 12 12" className="comparison-key"><Mark kind={key} cx={6} cy={6} /></svg>{label}</span>)}</div>
    <ul>
      {rows.map((row) => <li key={row.id}>
        <span className="comparison-label">{row.label}</span>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="comparison-axis" role="img" aria-label={`${row.label}：${SERIES.map(({ key, label }) => `${label} ${text(row.values[key])}`).join("，")}`}>
          <line x1={PAD} x2={WIDTH - PAD} y1={HEIGHT / 2} y2={HEIGHT / 2} className="chart-grid" />
          {SERIES.map(({ key }) => { const value = row.values[key]; return typeof value === "number" && Number.isFinite(value) ? <Mark key={key} kind={key} cx={x(value)} cy={HEIGHT / 2} /> : null; })}
        </svg>
        <span className="comparison-values">{SERIES.map(({ key, label }) => `${label} ${text(row.values[key])}`).join(" · ")}{shown ? ` ${shown}` : ""}</span>
      </li>)}
    </ul>
    <figcaption className="muted">轴范围 {significantNumber(low, 5)} – {significantNumber(high, 5)}{shown ? ` ${shown}` : ""}；各行共用同一数值轴。</figcaption>
  </figure>;
}

function Mark({ kind, cx, cy }: { kind: SeriesKey; cx: number; cy: number }) {
  if (kind === "comsol") return <rect x={cx - 4} y={cy - 4} width={8} height={8} className="comparison-mark is-comsol" />;
  return <circle cx={cx} cy={cy} r={kind === "reference" ? 5 : 3.5} className={`comparison-mark is-${kind}`} />;
}
