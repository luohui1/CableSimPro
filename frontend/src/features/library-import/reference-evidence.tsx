import { DataTable } from '@/components/data-table';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { parameterNames, type Conditions, type ReferenceEvidence, type ReferenceMethod, type ReferenceReceipt, type ReferenceRecord, type ReferenceSelection, type ReferenceValue, type SIQuantity } from './reference-api';

const conditionNames: Record<string, string> = {
  material: '材料组成', material_role: '材料用途', reference_temperature_k: '参考温度 / K',
  temperature_basis: '温度口径', current_system: '电流制式', insulation: '绝缘材料',
  cable_construction: '电缆结构', u0_v: '额定相电压 U₀ / V', u_v: '线电压 U / V', um_v: '最高系统电压 Uₘ / V',
  filler: '绝缘填充状态', polyethylene_density: '聚乙烯密度类别', country: '国家', reference_item: '原文参考项目',
  national_reference: '国家参考资料可用性', elevation_basis: '海拔依据', climate: '气候带',
  burial_depth_m: '适用埋深 / m', soil_moisture: '土壤含水状态', weather_pattern: '降水与湿润条件',
  gte: '不小于', gt: '大于', lte: '不大于', lt: '小于', min: '下限', max: '上限', in: '可选范围',
};
const conditionValues: Record<string, string> = {
  copper: '铜', aluminium: '铝', lead_or_lead_alloy: '铅或铅合金', steel: '钢', bronze: '青铜',
  stainless_steel: '不锈钢', conductor: '导体', sheaths_and_armour: '金属套与铠装', insulation: '绝缘',
  connection_tube: '连接管', main_insulation_tube: '主绝缘管', cable_filler: '电缆填充', joint_filler: '接头填充',
  inner_sheath: '内护套', outer_sheath: '外护套', metal_shield: '金属屏蔽', waterproof_sealant: '防水密封',
  pipe: '管壁', cable_well: '电缆井', air_layer: '空气层', soil_layer: '土壤层',
  polyethylene: '聚乙烯', polypropylene: '聚丙烯', silicone_rubber: '硅橡胶', polypropylene_and_air: '聚丙烯与空气',
  insulation_resin: '绝缘树脂', concrete: '混凝土', air: '空气', soil: '土壤', seabed_sand_gravel: '海床砂砾',
  AC: '交流', DC: '直流', maximum_permissible: '最高允许工作温度', filled: '有填料', unfilled: '无填料',
  China: '中国', unavailable: '国家参考资料不可用', sea_level: '海平面',
  tropical: '热带', subtropical: '亚热带', temperate: '温带', very_moist: '很湿', moist: '湿润', dry: '干燥', very_dry: '很干',
  continuous_moisture: '持续湿润', regular_rain: '经常降雨', rare_rain: '很少降雨', little_or_no_rain: '很少或无降雨',
  ground_temperature_summer: '夏季地温', ground_temperature_winter: '冬季地温', ground_min_c: '地温下限', ground_max_c: '地温上限',
  air_temperature_maximum: '最高空气温度', air_temperature_minimum: '最低空气温度', air_min_c: '空气温度下限', air_max_c: '空气温度上限',
  impregnated_paper: '浸渍纸', oil_impregnated_paper: '油浸纸', butyl_rubber: '丁基橡胶',
  solid_non_draining: '不滴流固体绝缘', self_contained_oil_filled: '自容式充油', oil_pressure: '油压',
  external_gas_pressure: '外气压', internal_gas_pressure: '内气压', HD: '高密度', LD: '低密度',
  trefoil: '单芯直埋 · 接触品字', flat: '单芯直埋 · 水平', three_core_buried_single: '三芯直埋 · 单回',
  three_core_buried_horizontal: '三芯直埋 · 三回水平', ducts: '单芯排管', three_core_ducts_horizontal: '三芯排管 · 水平',
  both_ends: '两端接地', single_point: '单点接地', unspecified: '未明确接地方式',
  simultaneous: '共同等负荷', individual: '首回路变负荷', ignored: '明确忽略', exact: '精确形式', simplified: '简化形式',
};
export function conditionName(key: string) { return conditionNames[key] ?? parameterNames[key] ?? key; }
export function referenceReason(value: string): string {
  return value.replace(/\b([a-z][a-z0-9_]*)\s*[:：]/g, (match, key: string) =>
    conditionNames[key] || parameterNames[key] ? `${conditionName(key)}：` : match);
}
export function referenceValue(value: ReferenceValue | undefined): string {
  if (value === null || value === undefined) return '未给出';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return conditionValues[value] ?? value;
  if (Array.isArray(value)) return value.map(referenceValue).join('、');
  return Object.entries(value).map(([key, item]) => `${conditionName(key)} ${referenceValue(item)}`).join('；');
}
export function referenceUnit(unit: string): string {
  return ({ 'kg/m3': 'kg/m³', 'ohm.m': 'Ω·m', 'J/(m3.K)': 'J/(m³·K)', 'K.m/W': 'K·m/W', degC: '°C', 'W/(m.K)': 'W/(m·K)' } as Record<string, string>)[unit] ?? unit;
}
export function quantityText(quantity: SIQuantity | null | undefined): string {
  return quantity ? `${quantity.value} ${referenceUnit(quantity.unit)}` : '没有可用的 SI 换算';
}
export function conditionSummary(conditions: Conditions): string {
  const values = Object.entries(conditions).map(([key, value]) => `${conditionName(key)}：${referenceValue(value)}`);
  return values.join('；') || '本记录未列明额外条件，仍须核对原文限制';
}
export function recordTitle(row: ReferenceRecord): string {
  return row.row_label.startsWith('{') || row.row_label.includes('=') ? conditionSummary(row.conditions) : row.row_label;
}

type FieldKind = { kind: 'number' } | { kind: 'choice'; options: (string | number | boolean)[] } | { kind: 'unsupported' };
function fieldKind(value: ReferenceValue): FieldKind {
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value === 'string' || typeof value === 'boolean') return { kind: 'choice', options: [value] };
  const row = value && !Array.isArray(value) && typeof value === 'object' ? value : null;
  const options = Array.isArray(value) ? value : row?.in;
  if (Array.isArray(options) && options.length && options.every(item => ['string', 'number', 'boolean'].includes(typeof item)))
    return { kind: 'choice', options: options as (string | number | boolean)[] };
  if (row && Object.keys(row).length && Object.entries(row).every(([key, item]) => ['gt', 'gte', 'lt', 'lte', 'min', 'max'].includes(key) && typeof item === 'number')) return { kind: 'number' };
  return { kind: 'unsupported' };
}
export function readConditions(schema: Conditions, inputs: Record<string, string>): Conditions {
  return Object.fromEntries(Object.entries(schema).map(([key, expected]) => {
    const input = inputs[key]?.trim() ?? '', field = fieldKind(expected);
    if (!input) throw new Error(`请明确填写${conditionName(key)}，不能从原文范围自动选值。`);
    if (field.kind === 'number') {
      const value = Number(input);
      if (!Number.isFinite(value)) throw new Error(`${conditionName(key)}必须是有限数值。`);
      return [key, value];
    }
    if (field.kind === 'choice') {
      const value = field.options.find(item => String(item) === input);
      if (value === undefined) throw new Error(`请从原文条件中明确选择${conditionName(key)}。`);
      return [key, value];
    }
    throw new Error(`${conditionName(key)}尚无可用的逐字段输入方式，请保留该参考，不能自动采用。`);
  }));
}
export function conditionsReady(schema: Conditions, values: Record<string, string>): boolean {
  try { readConditions(schema, values); return true; } catch { return false; }
}
export function ConditionFields({ schema, values, onChange, label, disabled = false, fieldNames = {} }: {
  schema: Conditions; values: Record<string, string>; onChange: (next: Record<string, string>) => void; label: string; disabled?: boolean; fieldNames?: Record<string, string>;
}) {
  return <div className="library-import-fields library-import-fields-pair" aria-label={label}>
    {Object.entries(schema).map(([key, expected]) => {
      const field = fieldKind(expected), name = fieldNames[key] ?? conditionName(key), title = `${label} · ${name}`;
      return <div key={key} className="reference-condition">
        {field.kind === 'number' ? <label className="text-field">{name}<Input aria-label={title} type="number" step="any" value={values[key] ?? ''} disabled={disabled} onChange={event => onChange({ ...values, [key]: event.target.value })} /></label>
          : field.kind === 'choice' ? <Select label={title} value={values[key] ?? ''} disabled={disabled}
            options={[{ value: '', label: '请按实际条件选择' }, ...field.options.map(item => ({ value: String(item), label: referenceValue(item) }))]}
            onChange={value => onChange({ ...values, [key]: value })} />
            : <p role="status">{conditionName(key)}：尚无可用的逐字段输入方式，不能采用。</p>}
        <p className="muted">原文条件：{referenceValue(expected)}{field.kind === 'number' && typeof expected === 'object' ? '；请填写实际数值' : ''}</p>
      </div>;
    })}
  </div>;
}

export function ReferenceSource({ record, method, quantity, actualConditions, receipt, selection }: {
  record: ReferenceRecord; method?: ReferenceMethod; quantity?: SIQuantity | null; actualConditions?: Conditions; receipt?: ReferenceReceipt; selection?: ReferenceSelection;
}) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ selection, receipt }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'reference-receipt.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="library-import-stack reference-evidence">
    <dl className="reference-facts">
      <div><dt>原文项目</dt><dd>{recordTitle(record)} · {record.quantity.name}</dd></div>
      <div><dt>原值</dt><dd>{referenceValue(record.value)} {referenceUnit(record.quantity.unit)}</dd></div>
      <div><dt>SI 值</dt><dd>{quantity === undefined ? '核对实际条件后，由服务端给出明确换算' : quantityText(quantity)}</dd></div>
      <div><dt>直接来源</dt><dd>{record.semantic.startsWith('literature') ? '文献摘录' : '标准摘录'} · {record.citation}</dd></div>
      <div><dt>原文页码</dt><dd>正文 {record.printed_page ?? '未标明'} 页 · PDF {record.pdf_page ?? '未标明'} 页</dd></div>
      <div><dt>适用条件</dt><dd>{conditionSummary(record.conditions)}</dd></div>
      {actualConditions && <div><dt>本次明确条件</dt><dd>{conditionSummary(actualConditions)}</dd></div>}
      <div><dt>方法版本</dt><dd>{method ? `${method.name} · ${method.method_version}（发行 ${method.version}）` : record.method_version ?? '未返回方法版本'}</dd></div>
      <div><dt>可信分档</dt><dd>{record.trust?.label ?? '参考'} · 仅用于明确条件下的参考，不代表工程批准</dd></div>
    </dl>
    <div><h3>原文限制</h3>{record.limitations.length ? <ul className="reference-limitations">{record.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>本记录未另列限制；仍需核对来源适用范围。</p>}</div>
    <details className="library-import-details"><summary>来源完整性与技术核对</summary><dl className="reference-facts">
      <div><dt>原文文件</dt><dd>{record.source_file}</dd></div>
      <div><dt>原文字节 SHA-256</dt><dd className="library-import-digest">{record.source_sha256}</dd></div>
      <div><dt>摘录记录 SHA-256</dt><dd className="library-import-digest">{record.record_sha256}</dd></div>
      {receipt && <>
        <div><dt>资料发行摘要</dt><dd className="library-import-digest">{receipt.release_digest}</dd></div>
        <div><dt>数据集 SHA-256</dt><dd className="library-import-digest">{receipt.data_sha256}</dd></div>
        <div><dt>查询请求 SHA-256</dt><dd className="library-import-digest">{receipt.request_sha256}</dd></div>
        <div><dt>方法工件 SHA-256</dt><dd className="library-import-digest">{receipt.artifact_sha256}</dd></div>
      </>}
      {selection && <>
        <div><dt>查询定位</dt><dd>{selection.standard}—{selection.edition} · {selection.locator}</dd></div>
        <div><dt>原表项目</dt><dd>{recordTitle(record)}</dd></div>
        <div><dt>原文物理量</dt><dd>{record.quantity.name} / {referenceUnit(record.quantity.unit)}</dd></div>
      </>}
    </dl>
      {record.verification?.methods?.map((item, index) => <p key={index}>{item.description || item.id}{item.independent === true ? ' · 独立核验' : ''}</p>)}
      {receipt && selection && <><p className="muted">完整记录身份、查询条件和原始回执一同保存在下载文件中。</p><Button onClick={download}>下载该条固定回执</Button></>}
    </details>
  </div>;
}

export function EvidenceTable({ evidence, label = '资料逐项来源', onInspect }: { evidence: ReferenceEvidence[]; label?: string; onInspect?: (item: ReferenceEvidence) => void }) {
  const rows = evidence.map(item => ({ ...item, id: item.parameter }));
  return <DataTable label={label} showGroups={false} groups={[{ id: 'evidence', label, rows }]}
    columns={[
      { id: 'property', label: '参数', wrap: true, render: row => parameterNames[row.parameter] ?? row.parameter },
      { id: 'original', label: '原值', wrap: true, render: row => `${referenceValue(row.receipt.record.value)} ${referenceUnit(row.receipt.record.quantity.unit)}` },
      { id: 'si', label: 'SI 值', wrap: true, render: row => quantityText(row.quantity) },
      { id: 'conditions', label: '明确条件', wrap: true, render: row => conditionSummary(row.selection.conditions) },
      { id: 'source', label: '来源与分档', wrap: true, render: row => <span>{row.receipt.record.citation}<br />参考 · 方法 {row.receipt.method.method_version}</span> },
    ]} rowLabel={row => `${parameterNames[row.parameter] ?? row.parameter}，${quantityText(row.quantity)}`} onActivate={onInspect} onSelect={onInspect} />;
}
