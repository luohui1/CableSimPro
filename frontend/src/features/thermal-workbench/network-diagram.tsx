import { useId } from 'react';
import type { Network, NetworkState, ResistanceBalance } from './data';
const value = (n: number, digits = 2) => Number(n.toPrecision(digits + 2)).toLocaleString('zh-CN', { maximumFractionDigits: digits + 3 });
export function NetworkDiagram({ network, state, phase, onNode }: { network: Network; state: NetworkState | null; phase: string; onNode: (index: number) => void }) {
  const marker = useId().replaceAll(':', ''), profile = state?.profiles.find(p => p.phase === phase);
  const temperatures = profile?.temperatures;
  return <>
    <svg className="tw-network" viewBox="0 0 400 455" role="group" aria-label={`${phase} 相径向热阻网络，节点温度来自保存工件`}>
      <defs><marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L8 4L0 8Z" /></marker></defs>
      {network.layers.map((layer, i) => {
        const y = 38 + i * 73, temperature = temperatures?.[i];
        const band = temperature === undefined ? 'unknown' : String(Math.max(0, Math.min(5, Math.floor((temperature - network.ambient) / Math.max(1, network.limit - network.ambient) * 5))));
        const r = network.resistances[i], flow = temperatures && r !== undefined ? (temperatures[i] - temperatures[i + 1]) / r : null;
        return <g key={i}>
          {r !== undefined && <g className="tw-network-edge"><path d={`M38 ${y + 16}v10l-6 5 12 6-12 6 12 6-6 5v3`} markerEnd={`url(#${marker})`} /><text x="66" y={y + 37}>R = {value(r, 3)} K·m/W</text>{flow !== null && <text x="66" y={y + 53} className="tw-network-flow">ΔT/R = {value(flow)} W/m</text>}</g>}
          <g role="button" tabIndex={0} aria-label={`${layer.label}，${temperature === undefined ? '未保存温度' : `${value(temperature)} 摄氏度`}`} className={`tw-network-node tw-heat-${band}`} onClick={() => onNode(i)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onNode(i); } }}>
            <rect x="14" y={y - 21} width="378" height="42" fill="currentColor" fillOpacity={0} pointerEvents="all" />
            <circle cx="38" cy={y} r="15" /><text className="tw-node-number" x="38" y={y + 4} textAnchor="middle">{i + 1}</text>
            <text x="66" y={y - 5} className="tw-node-label">{layer.label}</text><text x="66" y={y + 13} className="tw-node-radius">r = {value(layer.radius * 1000)} mm</text>
            <text className="tw-node-temperature" x="377" y={y + 4} textAnchor="end">{temperature === undefined ? '—' : value(temperature, 1)}{temperature !== undefined && ' °C'}</text>
          </g>
        </g>;
      })}
    </svg>
    <p className="tw-note">节点温度为保存值；边上的 ΔT/R 是由保存温差与热阻得到的展示量。此处是稳态径向热路，不代表热容或暂态节点响应。</p>
    <details className="tw-mutual"><summary>相间互热 · 土壤影响矩阵</summary>
      <table><caption>Gᵢⱼ / K·m/W；非独立串联电阻。表面温升关系为 ΔTᵢ = Σ Gᵢⱼ Q′ⱼ。</caption><thead><tr><th scope="col">受热相／热源相</th>{['A', 'B', 'C'].map(p => <th scope="col" key={p}>{p}</th>)}</tr></thead><tbody>{network.mutual.map((row, i) => <tr key={i}><th scope="row">{'ABC'[i]}</th>{row.map((n, j) => <td key={j} className={i === j ? 'tw-self-term' : ''}>{value(n, 3)}</td>)}</tr>)}</tbody></table>
    </details>
  </>;
}
export function BalanceDiagram({ balance }: { balance: ResistanceBalance }) {
  return <div className="tw-balance"><p>额定点 {value(balance.current, 1)} A · 保存热阻分解</p>
    <svg viewBox="0 0 400 370" role="img" aria-label="保存的 IEC 额定点热阻链">
      {balance.values.map((r, i) => <g className="tw-balance-row" key={i}><path d={`M35 ${25 + i * 66}v12l-7 6 14 8-14 8 7 6v12`} /><text x="68" y={47 + i * 66}>{balance.labels[i]}</text><text x="375" y={47 + i * 66} textAnchor="end">{value(r, 3)} K·m/W</text></g>)}
    </svg><p className="tw-note">{balance.notes}</p><p className="tw-note">未保存的中间节点温度、热容和热流不会由前端补算。零值保留为零，不擅自替换成经验参数。</p>
  </div>;
}
