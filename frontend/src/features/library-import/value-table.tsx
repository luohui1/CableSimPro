import { optionalRecord } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { displayUnit } from '@/lib/display-names';
import { confidenceText, methodText, sourceText, type ValueSource } from './api';

export function ValueTable({ values }: { values: ValueSource[] }) {
  return <div className="library-import-stack">
    {values.some(value => value.usage === 'catalogue_result') && <p className="muted">样本性能值来自厂家目录，供对照；独立计算需完整结构与工况。</p>}
    <DataTable label="逐项来源" showGroups={false} groups={[{ id: 'sources', label: '来源', rows: values.map((value, index) => ({ ...value, id: `${value.key}-${index}` })) }]} rowLabel={row => row.label} columns={[
      { id: 'field', label: '参数', wrap: true, render: row => <div className="library-import-issues"><span>{row.label}</span>{row.usage === 'catalogue_result' && <span className="muted">厂家目录值 · 供对照</span>}</div> },
      { id: 'value', label: '数值与单位', render: row => row.value === null ? '缺项' : `${row.display_value ?? row.value} ${displayUnit(row.display_unit || row.unit)}` },
      { id: 'source', label: '来源', wrap: true, render: row => sourceText(row.source) },
      { id: 'confidence', label: '方法版本与可信分档', wrap: true, render: row => <div className="library-import-issues"><span>{methodText(row.method || optionalRecord(row.source).method)}</span><span>{confidenceText(row.confidence)}</span></div> },
    ]} />
  </div>;
}
