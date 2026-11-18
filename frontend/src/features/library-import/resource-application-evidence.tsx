import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { optionalRecord, text } from '@/api/client';
import { displayLibraryText, sourceText } from './api';
import { referenceUnit, referenceValue } from './reference-evidence';
import { applicationDownload, type ApplicationEvidence, type ApplicationField, type ApplicationChange } from './resource-application-api';

function fieldSource(value: unknown): string {
  const source = optionalRecord(value), reference = text(source.reference);
  if (reference.trim().startsWith('{') || reference.trim().startsWith('[')) {
    try {
      const saved = optionalRecord(JSON.parse(reference));
      return displayLibraryText(text(saved.reference) || text(saved.title) || text(saved.name) || '结构化固定来源，完整原文可逐项下载');
    } catch { return displayLibraryText(reference); }
  }
  return displayLibraryText(sourceText(value));
}
const componentValues: Record<string, string> = {
  design: '设计输入', measurement: '实测输入', manufacturer_limit: '厂家电阻上限（非实测）',
  semiconductor: '半导电材料', metal: '金属', polymer: '聚合物', filler: '填充材料',
  backfill: '回填材料', duct: '管材', fluid: '流体', aluminium_alloy: '铝合金',
  steel_galvanized: '镀锌钢', steel_stainless_nonmagnetic: '非磁性不锈钢', lead: '铅', other: '其他已声明材料',
  segmental: '分割导体', hollow: '空心导体', sectoral: '扇形导体', wires: '金属丝', tape: '绕包带',
  smooth: '光滑结构', corrugated: '皱纹结构', left: '左向绞合', right: '右向绞合',
  helical_overlap: '螺旋搭盖绕包', two_tape_gap: '双带间隙绕包', longitudinal: '纵包',
  dc: '直流', power_frequency_ac: '工频交流', separator: '隔离层', binder: '扎带',
};
export function applicationValue(value: ApplicationField['value'], unit: string | null = '') {
  if (typeof value === 'string' && /^(material|cable_type|core|circuit|cable)\/[A-Za-z0-9_-]+$/.test(value))
    return '固定对象引用（完整身份见原始记录）';
  const label = typeof value === 'string' ? componentValues[value] ?? referenceValue(value) : referenceValue(value);
  return `${displayLibraryText(label)}${value !== null && unit ? ` ${referenceUnit(unit)}` : ''}`;
}
export function ApplicationFields({ fields, label = '部件与模板逐项来源' }: { fields: ApplicationField[]; label?: string }) {
  return <DataTable label={label} showGroups={false} groups={[{ id: 'fields', label, rows: fields.map((field, index) => ({ ...field, id: String(index) })) }]}
    rowLabel={row => `${row.label}，${applicationValue(row.value, row.unit)}`} columns={[
      { id: 'label', label: '保存参数', wrap: true, render: row => row.label },
      { id: 'value', label: '保存值与单位', wrap: true, render: row => applicationValue(row.value, row.unit) },
      { id: 'source', label: '原始出处', wrap: true, render: row => fieldSource(row.source) },
      { id: 'inspect', label: '完整来源', render: row => <Button size="compact" onClick={() => applicationDownload('fixed-field-source.json', row)}>下载此项原始记录</Button> },
    ]} />;
}
export function ApplicationFrozenEvidence({ evidence }: { evidence: ApplicationEvidence }) {
  return <div className="library-import-stack reference-evidence">
    <dl className="reference-facts">
      <div><dt>固定输入来源</dt><dd>{evidence.source.name} · 输入修订 {evidence.source.revision}</dd></div>
      <div><dt>方法版本</dt><dd>{evidence.method.name} · {evidence.method.method_version ?? evidence.method.version}{evidence.method.method_version && evidence.method.method_version !== evidence.method.version ? `（发行 ${evidence.method.version}）` : ''}</dd></div>
      <div><dt>可信分档</dt><dd>{evidence.trust.label} · 不授予工程批准</dd></div>
      {evidence.source.study_revision !== undefined && <div><dt>保存研究版本</dt><dd>研究修订 {evidence.source.study_revision} · 已固定原记录所选运行</dd></div>}
    </dl>
    {evidence.trust.reason && <p>{displayLibraryText(evidence.trust.reason)}</p>}
    <ApplicationFields fields={evidence.fields} />
    {evidence.missing.length > 0 && <section aria-label="固定输入缺项"><h3>已保留的缺项</h3><ul className="reference-limitations">{evidence.missing.map((item, index) => <li key={index}>{displayLibraryText(item)}</li>)}</ul></section>}
    <section aria-label="部件与模板适用限制"><h3>适用限制</h3><ul className="reference-limitations">{evidence.limitations.map((item, index) => <li key={index}>{displayLibraryText(item)}</li>)}</ul></section>
    <details className="library-import-details"><summary>固定来源与完整性核对</summary>
      <dl className="reference-facts">
        <div><dt>源输入 SHA-256</dt><dd className="library-import-digest">{evidence.source.document_sha256}</dd></div>
        {evidence.resource && <div><dt>资料内容 SHA-256</dt><dd className="library-import-digest">{evidence.resource.content_sha256}</dd></div>}
        {evidence.source.input_digest && <div><dt>保存运行输入 SHA-256</dt><dd className="library-import-digest">{evidence.source.input_digest}</dd></div>}
        {evidence.source.output_digest && <div><dt>保存运行输出 SHA-256</dt><dd className="library-import-digest">{evidence.source.output_digest}</dd></div>}
        {evidence.method.release_digest && <div><dt>固定方法发行摘要</dt><dd className="library-import-digest">{evidence.method.release_digest}</dd></div>}
      </dl>
      <p className="muted">完整冻结输入、来源路径、方法身份与摘要均保存在下载中。此处的读取不会查询当前源输入来替换已保存的历史。</p>
      <Button onClick={() => applicationDownload('resource-application-evidence.json', evidence)}>下载完整冻结输入与证据</Button>
    </details>
  </div>;
}
export function ApplicationChanges({ changes }: { changes: ApplicationChange[] }) {
  return <DataTable label="部件采用逐字段变化" showGroups={false} groups={[{ id: 'changes', label: '变化', rows: changes.map((item, index) => ({ ...item, id: String(index) })) }]}
    rowLabel={row => row.label} columns={[
      { id: 'name', label: '参数', wrap: true, render: row => row.label },
      { id: 'before', label: '当前值', wrap: true, render: row => applicationValue(row.before, row.unit) },
      { id: 'after', label: '采用后', wrap: true, render: row => row.after === null ? '清空为未给出；不保留旧值' : `${applicationValue(row.after, row.unit)}${typeof row.after === 'string' && /^(material|cable_type|core|circuit|cable)\//.test(row.after) && row.before !== row.after ? ' · 引用已变化' : ''}` },
      { id: 'source', label: '来源处理', wrap: true, render: row => <span>{row.source_action === 'unchanged' ? '保留目标原出处；下列为来源参考记录：' : '将保存下列固定来源：'}{fieldSource(row.source)}</span> },
      { id: 'download', label: '核对原文', render: row => <Button size="compact" onClick={() => applicationDownload('component-change.json', row)}>下载前后值与出处</Button> },
    ]} />;
}
