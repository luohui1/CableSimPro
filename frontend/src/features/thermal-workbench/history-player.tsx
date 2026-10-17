import { useEffect, useMemo, useRef, useState } from 'react';
import { chartIndices, indexAt, sampleAt, type Curve, type History } from './data';
import { usePlayback } from './use-playback';
const fmt = (n: number, digits = 2) => n.toLocaleString('zh-CN', { maximumFractionDigits: digits });
function extrema(values: readonly number[]): [number, number] { let low = Infinity, high = -Infinity; for (const v of values) { low = Math.min(low, v); high = Math.max(high, v); } return [low, high]; }
function downloadCurve(curve: Curve, runId: string, caseId: string) {
  // Only fixed numeric columns: no spreadsheet formulas or executable metadata.
  const header = curve.unit === 'A' ? 'time_s,permissible_current_a' : 'time_s,maximum_temperature_c';
  const csv = [header, ...curve.times.map((time, i) => `${time},${curve.values[i]}`)].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `history-${runId}-${caseId}-${curve.id}`.replace(/[^\w-]/g, '_').slice(0, 110) + '.csv'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function HistoryPlayer({ history, runId, caseId, onEntity, onFrame }: { history: History; runId: string; caseId: string; onEntity?: (id: string) => void; onFrame?: (labels: Record<string, string>) => void }) {
  const [chosen, setChosen] = useState(history.curves[0].id), [page, setPage] = useState(0);
  const playback = usePlayback(history.times), curve = history.curves.find(c => c.id === chosen) || history.curves[0];
  const frameCallback = useRef(onFrame); frameCallback.current = onFrame;
  useEffect(() => {
    const labels: Record<string, string> = {};
    if (playback.time !== null) for (const c of history.curves) { const sample = sampleAt(c, playback.time); if (sample) labels[c.id] = `${c.id} · ${fmt(sample.value)} ${c.unit}${sample.held ? '（保持）' : ''}`; }
    frameCallback.current?.(labels);
  }, [history, playback.time]);
  const sample = playback.time === null ? null : sampleAt(curve, playback.time);
  const chart = useMemo(() => {
    const [minimum, maximum] = extrema(curve.values), padding = Math.max((maximum - minimum) * .15, curve.unit === '°C' ? 1 : 1e-6), low = minimum - padding, high = maximum + padding;
    const start = history.times[0], end = history.times[history.times.length - 1], duration = end - start;
    const divisor = duration >= 7200 ? 3600 : duration >= 120 ? 60 : 1, unit = divisor === 3600 ? 'h' : divisor === 60 ? 'min' : 's';
    const x = (t: number) => 76 + (t - start) / (duration || 1) * 890, y = (v: number) => 232 - (v - low) / (high - low) * 196;
    const indices = chartIndices(curve.values), path = indices.map((i, j) => `${j ? 'L' : 'M'}${x(curve.times[i])},${y(curve.values[i])}`).join(' ');
    return { minimum, maximum, start, end, divisor, unit, x, y, path, low, high, displayed: indices.length };
  }, [curve, history.times]);
  const cursorX = playback.time === null ? null : chart.x(playback.time), offset = page * 100, pageCount = Math.ceil(curve.times.length / 100);
  return <section className="tw-history" aria-label="动态过程回放">
    <header className="tw-panel-heading"><div><h3>{curve.unit === 'A' ? '应急允许电流 · 持续时长' : '动态过程 · 保存温度历史'}</h3><p>{history.description}</p></div>
      <label>曲线对象<select aria-label="动态曲线对象" value={curve.id} onChange={e => { setChosen(e.target.value); setPage(0); onEntity?.(e.target.value); }}>{history.curves.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}</select></label>
    </header>
    <div className="tw-playback-metrics"><span>{curve.label}<strong data-time-value>{sample ? `${fmt(sample.value)} ${curve.unit}` : '此时刻无保存值'}</strong></span><span>当前游标<strong data-time-cursor>{playback.time === null ? '—' : `${fmt(playback.time)} s`}</strong></span><span>采用的保存时间步<strong>{sample ? `${fmt(sample.time)} s${sample.held ? ' · 保持前值' : ''}` : '—'}</strong></span><span>全程峰值<strong>{fmt(chart.maximum)} {curve.unit}</strong></span></div>
    <svg className="tw-history-chart" viewBox="0 0 1000 276" role="img" aria-label={`${curve.id} ${curve.label}与时间曲线，曲线连线仅作阅读引导`} onPointerDown={event => {
      const rect = event.currentTarget.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * 1000;
      playback.seek(indexAt(history.times, chart.start + Math.max(0, Math.min(1, (x - 76) / 890)) * (chart.end - chart.start)));
    }}>
      {[0, 1, 2, 3, 4].map(i => { const v = chart.low + (chart.high - chart.low) * i / 4, y = chart.y(v); return <g className="tw-chart-grid" key={i}><path d={`M76 ${y}H966`} /><text x="62" y={y + 4} textAnchor="end">{fmt(v, 1)}</text></g>; })}
      {[0, 1, 2, 3, 4].filter(i => chart.end !== chart.start || i === 0).map(i => { const t = chart.start + (chart.end - chart.start) * i / 4; return <g className="tw-chart-grid" key={i}><path d={`M${chart.x(t)} 36V232`} /><text x={chart.x(t)} y="255" textAnchor="middle">{fmt(t / chart.divisor)}</text></g>; })}
      <text className="tw-chart-unit" x="76" y="19">{curve.unit}</text><text className="tw-chart-unit" x="973" y="255">{chart.unit}</text>
      <path className="tw-history-line" d={chart.path} />
      {cursorX !== null && <path className="tw-chart-cursor" d={`M${cursorX} 28V232`} />}
      {sample && <circle className="tw-chart-sample" cx={chart.x(sample.time)} cy={chart.y(sample.value)} r="5" />}
    </svg>
    <div className="tw-playback" role="group" aria-label="时间播放控制">
      <button type="button" aria-label="上一个保存时间步" disabled={playback.index === 0} onClick={() => playback.seek(playback.index - 1)}>上一步</button>
      <button type="button" className="tw-play" disabled={history.times.length < 2 || playback.reduced} aria-pressed={playback.playing} onClick={playback.toggle}>{playback.playing ? '暂停' : playback.index === history.times.length - 1 ? '重播' : '播放'}</button>
      <button type="button" aria-label="下一个保存时间步" disabled={playback.index === history.times.length - 1} onClick={() => playback.seek(playback.index + 1)}>下一步</button>
      <input className="tw-timeline" aria-label="保存时间步" aria-valuetext={`${fmt(playback.time || 0)} 秒，第 ${playback.index + 1} 个保存时刻`} type="range" min="0" max={Math.max(0, history.times.length - 1)} step="1" value={playback.index} onChange={e => playback.seek(Number(e.target.value))} />
      <label>速度<select aria-label="回放速度" value={playback.speed} onChange={e => playback.rate(Number(e.target.value))}>{[1, 60, 600, 3600].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
      <span>{playback.index + 1} / {history.times.length}</span>
    </div>
    <p className="tw-note">{playback.reduced ? '系统已开启减少动画：保留逐步查看与手动拖动。' : '按真实时间间隔回放；切换到后台会暂停，到末尾停止。'} {chart.displayed < curve.times.length ? `图线采用保留极值的 ${chart.displayed} 个显示点；回放、表格与导出使用全部原始时间步。` : '图线连线不产生新的求解值。'}</p>
    <details className="tw-samples"><summary>原始时间步与导出 · {curve.times.length} 点</summary>
      <div className="tw-table-actions"><button type="button" onClick={() => downloadCurve(curve, runId, caseId)}>导出此曲线 CSV</button><button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page + 1} / {pageCount}</span><button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}>下一页</button></div>
      <table><caption>运行 {runId} · 工况 {caseId} · {curve.id}；每页 100 行</caption><thead><tr><th scope="col">保存时刻 / s</th><th scope="col">{curve.label} / {curve.unit}</th></tr></thead><tbody>{curve.times.slice(offset, offset + 100).map((t, i) => <tr key={offset + i}><td>{fmt(t, 6)}</td><td>{fmt(curve.values[offset + i], 6)}</td></tr>)}</tbody></table>
    </details>
  </section>;
}
