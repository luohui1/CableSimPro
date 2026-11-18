import { DataTable } from '@/components/data-table';
import { Textarea } from '@/components/ui/textarea';
import { confidenceText, methodText, type PublishedGuidance as Guidance, type PublishedGuidanceConditions, type PublishedGuidanceSource } from './api';

const CONDITION_LABELS: Record<string, string> = {
  material: '材料', reference_temperature_c: '参考温度', temperature_c: '适用温度', frequency_hz: '适用频率',
  installation: '敷设', cores: '芯数', area_mm2: '导体截面', depth_m: '埋深', soil_thermal_resistivity: '土壤热阻率',
  air_temperature_c: '空气温度', ground_temperature_c: '土壤温度', circuit_count: '回路数', load_factor: '负荷系数', thermally_isolated: '与其他回路及热源热隔离',
};
const CONDITION_UNITS: Record<string, string> = {
  reference_temperature_c: '°C', temperature_c: '°C', frequency_hz: 'Hz', area_mm2: 'mm²', depth_m: 'm',
  soil_thermal_resistivity: 'K·m/W', air_temperature_c: '°C', ground_temperature_c: '°C',
};
const CONDITION_VALUES: Record<string, string> = { copper: '铜', aluminium: '铝', direct_buried: '直埋' };
const COMPARATORS = { gt: '>', gte: '≥', lt: '<', lte: '≤' };
const referenceText = (value: string) => value.replaceAll('°C·m/W', '摄氏度·米/瓦');
const SOURCE_SECTIONS = new Map([
  ['Current rating assumptions', '载流量基准条件'], ['2. RESISTANCE', '电阻温度换算指南'], ['3. CAPACITANCE', '电容量估算指南'],
  ['Table 3', '表 3'], ['Table 4', '表 4'], ['Table 5', '表 5'],
]);

function Conditions({ value }: { value: PublishedGuidanceConditions }) {
  return <div className="library-import-issues">{Object.entries(value).map(([key, condition]) => {
    const unit = CONDITION_UNITS[key];
    const shown = condition === null ? '未声明' : typeof condition === 'boolean' ? condition ? '是' : '否'
      : typeof condition === 'object' ? Object.entries(condition).map(([bound, limit]) => `${COMPARATORS[bound as keyof typeof COMPARATORS]}${limit}`).join(' 且 ')
        : CONDITION_VALUES[String(condition)] ?? String(condition);
    return <span key={key}>{CONDITION_LABELS[key] ?? key}：{shown}{condition !== null && unit ? ` ${unit}` : ''}</span>;
  })}</div>;
}

function Source({ value }: { value: PublishedGuidanceSource }) {
  let reference = value.reference;
  for (const [original, translated] of SOURCE_SECTIONS) reference = reference.replaceAll(original, translated);
  return <div className="library-import-issues"><span>{reference}</span>
    {typeof value.row === 'number' && typeof value.column === 'number' && <span className="muted">原表第 {value.row} 行 · 第 {value.column} 列</span>}
    {value.unit_basis && <span className="muted">{value.unit_basis}</span>}
  </div>;
}

export function PublishedGuidance({ value }: { value?: Guidance | null }) {
  if (!value) return null;
  const factorCount = value.correction_tables.reduce((count, table) => count + table.factors.length, 0);
  return <section aria-label="厂家公开指南">
    <details className="library-import-details">
      <summary>查看厂家公开指南（只读）</summary>
      <div className="library-import-stack">
        <section className="library-import-stack" aria-label="厂家指南用途与限制">
          <h2>厂家公开指南与离散修正表</h2>
          <p>{value.material_facts.length} 项材料指南值、{factorCount} 项离散修正因子。仅供查阅与来源对照；展开或查看不会填入型号，也不会启动计算。</p>
          <p>{value.source.nature}</p>
          <div className="library-import-issues">{value.limitations.map(item => <p key={item}>{item}</p>)}</div>
          <p>{methodText(value.method)} · 可信分档：{confidenceText(value.confidence)} · 尚未人工审核。</p>
          <p className="library-import-source">资料：{value.source.title} · 版次：{value.source.edition ?? '原件未声明'}{/^https?:\/\//.test(value.source.url) && <> · <a className="object-link" href={value.source.url} target="_blank" rel="noreferrer">打开厂家手册原件</a></>}</p>
        </section>
        <details className="library-import-details" aria-label="厂家指南基准">
          <summary>载流量基准与适用范围</summary>
          <div className="library-import-stack">
            <h2>厂家手册的载流量基准</h2>
            <Source value={value.baseline.source} />
            <Conditions value={value.baseline.conditions} />
            <p>原文负荷系数：{value.baseline.original_values.load_factor.value} {value.baseline.original_values.load_factor.unit}；归一化值：{String(value.baseline.conditions.load_factor)}。</p>
            {value.baseline.limitations.map(item => <p key={item}>{item}</p>)}
          </div>
        </details>
        <details className="library-import-details" aria-label="厂家材料计算指南">
          <summary>材料计算指南 · {value.material_facts.length} 项</summary>
          <div className="library-import-stack">
            <h2>材料计算指南</h2>
            <p>电阻温度系数用于电阻温度换算；相对介电常数用于手册中的电容量估算。未声明的适用温度、频率继续保留缺项，不能直接代入该产品的介质损耗计算。</p>
            <DataTable label="厂家材料指南原值" showGroups={false} groups={[{ id: 'materials', label: '材料指南', rows: value.material_facts }]} rowLabel={row => row.label} columns={[
              { id: 'name', label: '参数', wrap: true, render: row => row.label },
              { id: 'value', label: '原值与单位', numeric: true, render: row => <span>{String(row.value)} {row.unit === '1' ? '无量纲' : row.unit === '1/K' ? 'K⁻¹' : row.unit}</span> },
              { id: 'purpose', label: '用途与条件', wrap: true, render: row => <div className="library-import-issues"><span>{row.usage === 'resistance_temperature_conversion' ? '导体电阻温度换算' : '电容量估算；不能直接代入介质损耗计算'}</span><Conditions value={row.conditions} /></div> },
              { id: 'source', label: '原件位置与单位依据', wrap: true, render: row => <Source value={row.source} /> },
              { id: 'method', label: '方法与可信分档', wrap: true, render: row => <span>{methodText(row.method)} · {confidenceText(row.confidence)}</span> },
            ]} />
          </div>
        </details>
        {value.correction_tables.map(table => <details key={table.id} className="library-import-details" aria-label={table.title}>
          <summary>{table.title} · {table.factors.length} 项</summary>
          <div className="library-import-stack">
            <h2>{table.title}</h2>
            <p>用途：直埋载流量的厂家修正参考。必须同时核对手册基准和每行适用条件；不会自动选取因子或改变计算输入。</p>
            <div className="library-import-issues">{table.limitations.map(item => <p key={item}>{referenceText(item)}</p>)}</div>
            <DataTable label={table.title} showGroups={false} groups={[{ id: table.id, label: table.title, rows: table.factors }]} rowLabel={row => `${table.title} · 原表第 ${row.source.row} 行第 ${row.source.column} 列`} columns={[
              { id: 'conditions', label: '原表适用条件', wrap: true, render: row => <Conditions value={row.conditions} /> },
              { id: 'value', label: '修正参考因子', numeric: true, render: row => <span>{String(row.value)}（无量纲）</span> },
              { id: 'source', label: '原件位置', wrap: true, render: row => <Source value={row.source} /> },
              { id: 'method', label: '方法与可信分档', wrap: true, render: row => <span>{methodText(row.method)} · {confidenceText(row.confidence)}</span> },
            ]} />
          </div>
        </details>)}
        <details className="library-import-details" aria-label="厂家指南原始来源">
          <summary>完整原始指南、文件摘要与页内位置</summary>
          <div className="library-import-stack">
            <p className="library-import-digest">原件 SHA-256：{value.source.sha256}</p>
            <p className="library-import-digest">指南内容 SHA-256：{value.content_sha256}</p>
            <label className="text-field">全部原值、条件、原文及页内坐标（只读，可复制）
              <Textarea className="library-import-raw-declaration" aria-label="厂家公开指南原始 JSON" readOnly rows={12} spellCheck={false} value={JSON.stringify(value, null, 2)} />
            </label>
          </div>
        </details>
      </div>
    </details>
  </section>;
}
