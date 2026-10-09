import { numeric, optionalRecord, text } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Tooltip } from '@/components/ui/tooltip';
import './field.css';

/** Read-only projection of the reproduction record; no solver or fitted data. */
export function DuctSensitivity({ data, loading, error, historical }: {
  data?: unknown; loading?: boolean; error?: string; historical?: boolean;
}) {
  if (loading) return <LoadingState title="读取排管诊断" />;
  if (error) return <ErrorState title="排管诊断不可用" description={error} />;
  const detail = optionalRecord(data), saved = optionalRecord(detail.sensitivity ?? data);
  const rows: (Record<string, unknown> & { id: string })[] = (Array.isArray(saved.rows) ? saved.rows : []).map(optionalRecord).map((row, index) => ({ ...row, id: text(row.id) || String(index) }));
  if (!rows.length) return <EmptyState title="尚无保存的排管敏感性诊断" />;
  const number = (value: unknown, digits = 3, signed = false) => {
    const n = numeric(value);
    return n === null ? '未得到结果' : `${signed && n > 0 ? '+' : ''}${n.toFixed(n !== 0 && Math.abs(n) < .001 ? 6 : digits)}`;
  };
  return <section className="input-section" aria-label="排管敏感性诊断">
    <h3>排管敏感性诊断{historical || detail.historical ? ' · 历史' : ''}</h3>
    <dl className="field-scope"><div><dt>结论</dt><dd>{saved.classification === 'basis_difference' ? '口径差异' : '尚未归因'} · 影响百分比以原有限元为分母</dd></div></dl>
    <DataTable label="排管敏感性影响" showGroups={false} rowLabel={row => text(row.label)}
      groups={[{ id:'sensitivity',label:'诊断',rows }]} columns={[
        {id:'label',label:'诊断项',wrap:true,render:row => <Tooltip content={text(row.basis) || '与原工况比较；来源随保存证据记录'}><span tabIndex={0}>{text(row.label)}{row.id.startsWith('hdpe-') && numeric(row.hdpe_k_w_m_k) !== null ? ` · k ${number(row.hdpe_k_w_m_k,6)} W/(m·K)` : ''}</span></Tooltip>},
        {id:'ampacity',label:'允许电流 A',numeric:true,render:row => number(row.ampacity_a)},
        {id:'delta',label:'影响 A',numeric:true,render:row => number(row.delta_a,3,true)},
        {id:'relative',label:'影响 %',numeric:true,render:row => number(row.delta_percent,3,true)},
        {id:'nodes',label:'自由度',numeric:true,render:row => numeric(row.nodes)?.toLocaleString() ?? '—'},
        {id:'status',label:'记录',wrap:true,render:row => row.status === 'complete' ? '已保存' : text(optionalRecord(row.failure).message) || '尚无结果'},
      ]} />
  </section>;
}
