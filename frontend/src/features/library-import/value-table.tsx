import { optionalRecord, text } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { displayUnit } from '@/lib/display-names';
import { confidenceText, methodText, sourceText, type ValueSource } from './api';

const CONDITION_FIELDS: Record<string, { label: string; unit: string }> = {
  frequency_hz: { label: '交流频率', unit: 'Hz' },
  ground_temperature_c: { label: '土壤温度', unit: '°C' },
  air_temperature_c: { label: '空气温度', unit: '°C' },
  ambient_temperature_c: { label: '环境温度', unit: '°C' },
  depth_m: { label: '埋深', unit: 'm' },
  soil_thermal_resistivity: { label: '土壤热阻率', unit: 'K·m/W' },
  soil_rho_k_m_w: { label: '土壤热阻率', unit: 'K·m/W' },
  conductor_temperature_c: { label: '导体温度', unit: '°C' },
  short_circuit_duration_s: { label: '短路持续时间', unit: 's' },
  spacing_m: { label: '中心距', unit: 'm' },
};
const CONDITION_NOTES = new Map([
  ['The catalogue states one circuit, thermally isolated from other circuits, rated per the IEC 60287 series with standard IEC 60502-2 dimensions.',
    '目录声明为单回路，与其他回路热隔离；按 IEC 60287 系列确定额定值，结构尺寸采用 IEC 60502-2 标准。'],
]);

function OriginalColumn({ source, field }: { source: unknown; field: string }) {
  const column = optionalRecord(optionalRecord(optionalRecord(optionalRecord(source).catalogue).column_meanings)[field]);
  return <>{text(column.quantity) && <span className="library-import-original-quantity">原列口径：{text(column.quantity)}</span>}
    {text(column.unit) && <span className="muted">原列单位：{text(column.unit)}</span>}</>;
}

function OriginalLink({ source }: { source: unknown }) {
  const address = text(optionalRecord(optionalRecord(source).catalogue).url);
  if (!address) return null;
  let href: string | undefined;
  try { const url = new URL(address); if (['http:', 'https:'].includes(url.protocol)) href = url.href; } catch { /* Preserve invalid source text without creating a link. */ }
  return href ? <a className="library-import-source-url" href={href} title={address} target="_blank" rel="noopener noreferrer">查看来源原件</a> : <span>原件地址：{address}</span>;
}

function OriginalNotes({ values }: { values: ValueSource[] }) {
  const declarations = new Map<string, { standards: string; notes: string[] }>();
  for (const value of values) {
    const source = optionalRecord(optionalRecord(value.source).catalogue);
    const notes = Array.isArray(source.limitations) ? source.limitations.filter((item): item is string => typeof item === 'string') : [];
    const standards = text(source.published_standards_text);
    if (notes.length || standards) declarations.set(JSON.stringify([standards, notes]), { standards, notes });
  }
  if (!declarations.size) return null;
  return <details className="library-import-details library-import-original-notes"><summary>原件声明与限制</summary>
    <div className="library-import-stack">
      <p className="muted">以下说明随来源保存，未自动转为结构或工况输入。</p>
      {[...declarations].map(([key, declaration]) => <div key={key} className="library-import-issues">
        {declaration.standards && <p>原件标准原文：{declaration.standards}</p>}
        {declaration.notes.map((note, index) => <p key={index}>{note}</p>)}
      </div>)}
    </div>
  </details>;
}

function SourceConditions({ source }: { source: unknown }) {
  const conditions = optionalRecord(optionalRecord(source).conditions);
  return <details className="library-import-value-conditions">
    <summary>查看目录适用条件</summary>
    <div className="library-import-issues">
      <p className="muted">原目录共用条件，按相应性能项目使用。未给出的接地、间距及其他条件仍需补充。</p>
      {Object.keys(conditions).length ? Object.entries(conditions).map(([key, value]) => {
        const field = CONDITION_FIELDS[key];
        const displayed = value === null || value === undefined ? '未提供'
          : typeof value === 'string' ? CONDITION_NOTES.get(value) ?? value
            : typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
        return <p key={key}><strong>{field?.label || (key === 'note' ? '原文说明' : `原文条件（${key}）`)}：</strong>{displayed}{field?.unit && typeof value === 'number' ? ` ${field.unit}` : ''}</p>;
      }) : <p>原表未提供可核对的工况；该性能值不能直接用于独立计算。</p>}
    </div>
  </details>;
}

export function ValueTable({ values }: { values: ValueSource[] }) {
  return <div className="library-import-stack">
    {values.some(value => value.usage === 'catalogue_result') && <p className="muted">样本性能值来自厂家目录，供对照；独立计算需完整结构与工况。</p>}
    <OriginalNotes values={values} />
    <DataTable label="逐项来源" showGroups={false} groups={[{ id: 'sources', label: '来源', rows: values.map((value, index) => ({ ...value, id: `${value.key}-${index}` })) }]} rowLabel={row => row.label} columns={[
      { id: 'field', label: '参数', wrap: true, render: row => <div className="library-import-issues"><span>{row.label}</span><OriginalColumn source={row.source} field={row.key} />{row.usage === 'catalogue_result' && <span className="muted">厂家目录值 · 供对照</span>}</div> },
      { id: 'value', label: '数值与单位', render: row => row.value === null ? '缺项' : `${row.display_value ?? row.value} ${displayUnit(row.display_unit || row.unit)}` },
      { id: 'source', label: '来源', wrap: true, render: row => <div className="library-import-issues"><span>{sourceText(row.source)}</span><OriginalLink source={row.source} />{row.usage === 'catalogue_result' && <SourceConditions source={row.source} />}</div> },
      { id: 'confidence', label: '方法版本与可信分档', wrap: true, render: row => <div className="library-import-issues"><span>{methodText(row.method || optionalRecord(row.source).method)}</span><span>{confidenceText(row.confidence)}</span></div> },
    ]} />
  </div>;
}
