import { useRef, useState } from 'react';
import { message, optionalRecord, text } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { catalogueComparison, confidenceText, displayLibraryText, methodText, type CatalogueComparisonReport, type ReferenceAssumption } from './api';
import { LibraryDialog } from './dialog';

const METRICS = [{ key: 'outer_diameter', label: '外径', unit: 'mm' }, { key: 'weight', label: '重量', unit: 'kg/km' }, { key: 'r20', label: '导体直流电阻', unit: 'Ω/km' }, { key: 'ampacity', label: '载流量', unit: 'A' }];
const STATUS = { declared_input: '输入保真，非独立验证', missing: '缺少独立数据', refused: '拒绝计算', compared: '有独立计算对照' };
const number = (value: number | null, digits = 3) => value === null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: digits, useGrouping: false });
const percent = (value: number | null) => value === null ? '—' : `${number(value * 100, 2)} %`;
const SOURCE_SECTIONS: Record<string, string> = { 'construction table': '结构表', 'technical information': '技术信息', 'rating assumptions': '载流量计算假设' };
const REFERENCE_EXPLANATIONS = new Map([
  ['not in the catalogue; assumed for this comparison', '目录未列；本次研究参考对照所作假设。'],
  ["IEC 60287-1-1:2023 Table 3, unfilled XLPE up to 18 kV; standard reference values, not the manufacturer's", 'IEC 60287-1-1:2023 表 3，18 kV 及以下的未填充型 XLPE；标准参考值，不是厂家给定值。'],
  ['IEC 60287-1-1:2023 Table 1', 'IEC 60287-1-1:2023 表 1'],
]);
function sourceLocation(value: string) {
  return value.replace(/(construction table|technical information|rating assumptions): printed p\. (\d+) \/ PDF p\. (\d+)/g,
    (_match, section: string, printedPage: string, pdfPage: string) => `${SOURCE_SECTIONS[section]}：印刷第 ${printedPage} 页 / PDF 第 ${pdfPage} 页`);
}

function AssumptionValue({ assumption }: { assumption: ReferenceAssumption }) {
  if (typeof assumption.value === 'number') return <span>{String(assumption.value)}</span>;
  if (assumption.value === null) return <span>未提供</span>;
  return <Textarea aria-label={`${assumption.label}原始值`} readOnly rows={1} spellCheck={false}
    value={typeof assumption.value === 'string' ? assumption.value : JSON.stringify(assumption.value, null, 2)} />;
}

export function CatalogueComparison() {
  const [sample, setSample] = useState('people-mv');
  const [metric, setMetric] = useState('ampacity');
  const [mode, setMode] = useState('manufacturer');
  const [report, setReport] = useState<CatalogueComparisonReport | null>(null);
  const [busy, setBusy] = useState<'manufacturer' | 'reference' | null>(null);
  const [error, setError] = useState('');
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [scenarioConfirmed, setScenarioConfirmed] = useState(false);
  const request = useRef(0);
  async function compare(reference = false) {
    if (reference && (!report || !scenarioConfirmed)) return;
    const current = ++request.current;
    setBusy(reference ? 'reference' : 'manufacturer'); setError('');
    if (!reference) { setReport(null); setMode('manufacturer'); setScenarioConfirmed(false); }
    try {
      const result = await catalogueComparison(sample, reference);
      if (current === request.current) {
        setReport(result);
        if (reference) { setMode('reference'); setScenarioOpen(false); }
      }
    } catch (cause) { if (current === request.current) setError(message(cause)); }
    finally { if (current === request.current) setBusy(null); }
  }
  const source = optionalRecord(report?.source);
  const url = text(source.url);
  const isReference = mode === 'reference' && !!report?.reference_calculation;
  const shown = isReference ? report!.reference_calculation! : report;
  const originals = new Map(report?.rows.map(row => [row.key, row]));
  return <section className="library-import-stack" aria-label="公开样本偏差对照">
    <h2>公开样本偏差对照</h2>
    <p className="muted">逐规格保留厂家原表值、独立结果、偏差与缺项原因。厂家未公布的工况与构造不补入假设；研究参考情景须另行查看、人工确认后运行。</p>
    <div className="library-import-series-toolbar">
      <Select label="公开样本手册" value={sample} disabled={!!busy} onChange={next => { setSample(next); setReport(null); setError(''); setMode('manufacturer'); setScenarioConfirmed(false); setScenarioOpen(false); }} options={[{ value: 'people-mv', label: '人民电器集团 · 8.7/15 kV 公开样本' }, { value: 'bahra-mv', label: 'Bahra · 3.6/6 kV 单芯公开样本' }]} />
      <Button variant="primary" loading={busy === 'manufacturer'} disabled={!!busy} onClick={() => void compare()}>核对厂家样本</Button>
    </div>
    {busy && <p role="status">{busy === 'reference' ? '正在按已确认的研究假设运行参考情景，厂家缺项仍然保留…' : '正在检查厂家公开数据与所需条件…'}</p>}
    {error && !scenarioOpen && <p className="field-error" role="alert">{error}</p>}
    {report && shown && <>
      <p className="library-import-source" aria-label="厂家样本来源">来源：{text(source.title) || '厂家公开手册'}{text(source.location) && `；${sourceLocation(text(source.location))}`}{/^https?:\/\//.test(url) && <> · <a className="object-link" href={url} target="_blank" rel="noreferrer">查看公开原文</a></>}</p>
      <p aria-label="厂家独立核验总览">厂家独立核验：{report.summary.specifications} 个规格；载流量可对照 {report.summary.ampacity_compared} 个，拒算 {report.summary.ampacity_refused} 个；四项独立核验全部通过 {report.summary.four_metric_passed} 个。</p>
      <p className="muted">{displayLibraryText(report.scope)}</p>
      <div className="library-import-series-actions">
        <Button disabled={!!busy} onClick={() => { setScenarioConfirmed(false); setScenarioOpen(true); }}>查看研究参考情景</Button>
      </div>
      {report.reference_calculation && <div className="library-import-series-actions" role="group" aria-label="对照数据范围">
        <Button variant={mode === 'manufacturer' ? 'secondary' : 'ghost'} aria-pressed={mode === 'manufacturer'} onClick={() => setMode('manufacturer')}>厂家数据与缺项</Button>
        <Button variant={mode === 'reference' ? 'secondary' : 'ghost'} aria-pressed={mode === 'reference'} onClick={() => setMode('reference')}>研究参考情景结果</Button>
      </div>}
      {isReference && <div className="library-import-stack" aria-label="研究参考情景说明">
        <h2>研究参考情景结果</h2>
        <p>研究假设经本次确认后执行，不是厂家工况，也不计入厂家独立核验通过数。厂家缺项与拒算原因继续逐规格保留。</p>
        <p>{shown.summary.specifications} 个规格；参考情景得到载流量 {shown.summary.ampacity_compared} 个，方法拒绝 {shown.summary.ampacity_refused} 个。与样本值的参考差异：平均绝对相对差异 {percent(shown.summary.ampacity_mean_absolute_relative_difference)}，最大 {percent(shown.summary.ampacity_max_absolute_relative_difference)}。</p>
        <p className="muted">{displayLibraryText(shown.scope)} {methodText(report.reference_calculation!.method)}；可信分档：参考，尚未人工审核结果。</p>
      </div>}
      <Tabs value={metric} onValueChange={setMetric}>
        <TabsList aria-label="对照指标">{METRICS.map(item => <TabsTrigger key={item.key} value={item.key}>{item.label}</TabsTrigger>)}</TabsList>
        {METRICS.map(item => <TabsContent key={item.key} value={item.key} className="library-import-stack">
          <DataTable label={`${isReference ? '研究情景' : ''}${item.label}逐规格对照`} showGroups={false} groups={[{ id: 'comparison', label: item.label, rows: shown.rows.map(row => ({ ...row, id: row.key, metric: row.metrics[item.key], manufacturer: originals.get(row.key)!.metrics[item.key] })) }]} rowLabel={row => `${row.designation} ${row.area_mm2} mm²`} columns={[
            { id: 'spec', label: '规格', wrap: true, render: row => <div>{displayLibraryText(row.designation.replaceAll('/', ' / '))} · {row.area_mm2} mm²<br /><span className="muted">{row.sheet}</span></div> },
            { id: 'published', label: '厂家样本值', unit: item.unit, numeric: true, render: row => row.metric.published === null ? '原表未给出' : number(row.metric.published, item.key === 'r20' ? 6 : 3) },
            { id: 'computed', label: isReference ? '研究情景结果或回读' : '独立结果或输入回读', unit: item.unit, numeric: true, render: row => row.metric.value === null ? '未给出结果' : number(row.metric.value, item.key === 'r20' ? 6 : 3) },
            { id: 'difference', label: isReference ? '与样本值的参考差异' : '偏差', wrap: true, numeric: true, render: row => row.metric.status === 'declared_input' ? '不作独立偏差' : row.metric.difference === null ? '不可对照' : `${number(row.metric.difference, item.key === 'r20' ? 6 : 3)} ${item.unit}（${percent(row.metric.relative_difference)}）` },
            { id: 'status', label: '判定', wrap: true, render: row => isReference && row.metric.status === 'compared' ? '研究参考值，非厂家核验' : STATUS[row.metric.status] },
            { id: 'reason', label: '原因、方法与可信分档', wrap: true, render: row => <div className="library-import-issues">
              <span>{displayLibraryText(row.metric.reason)}</span>
              {row.metric.missing_fields?.map(field => <span key={field.field}>{field.label}：{displayLibraryText(field.reason)}</span>)}
              {!!row.metric.method && <span className="muted">{methodText(row.metric.method)}</span>}
              {isReference && <span>厂家核验仍为{STATUS[row.manufacturer.status]}：{displayLibraryText(row.manufacturer.reason)}</span>}
              <span className="muted">{isReference ? '本次研究情景：参考' : '厂家公开资料核验：参考，未人工审核'}</span>
              {!!row.metric.tier && <span className="muted">方法覆盖分档：{confidenceText(row.metric.tier)}</span>}
            </div> },
          ]} />
        </TabsContent>)}
      </Tabs>
      <LibraryDialog open={scenarioOpen} onOpenChange={open => { if (!busy) setScenarioOpen(open); }} busy={!!busy} title="研究参考情景与完整假设" initialFocus="preserve"
        description="以下是研究用声明，包含厂家未提供的信息。确认仅允许执行本次参考情景，不会补齐厂家资料或批准核验结果。"
        actions={<Button variant="primary" disabled={!scenarioConfirmed || !!busy} loading={busy === 'reference'} onClick={() => void compare(true)}>确认研究假设并计算</Button>}>
        <div className="library-import-stack">
          <p>{displayLibraryText(report.reference_scenario.scope)}</p>
          <p>{methodText(report.reference_scenario.method)}；可信分档：参考；厂家数据：否。</p>
          <DataTable label="研究参考情景完整假设" showGroups={false} groups={[{ id: 'assumptions', label: '完整假设', rows: report.reference_scenario.assumptions.map(assumption => ({ ...assumption, id: assumption.key })) }]} rowLabel={row => row.label} columns={[
            { id: 'parameter', label: '研究假设或参数', wrap: true, render: row => row.label },
            { id: 'value', label: '原始值', wrap: true, render: row => <AssumptionValue assumption={row} /> },
            { id: 'unit', label: '单位', wrap: true, render: row => row.unit ?? '不适用' },
            { id: 'source', label: '原始出处与版本', wrap: true, render: row => <div className="library-import-issues"><span>{REFERENCE_EXPLANATIONS.get(row.source.reference) ?? row.source.reference}</span><span>版本：{row.source.version}</span>{row.source.file_sha256 && <span className="library-import-digest">资料 SHA-256：{row.source.file_sha256}</span>}<span className="muted">研究参考声明，非厂家数据</span></div> },
          ]} />
          <details className="library-import-details">
            <summary>展开完整原始声明</summary>
            <label className="text-field">完整原始声明（只读，可复制）
              <Textarea className="library-import-raw-declaration" aria-label="完整原始研究声明 JSON" readOnly rows={12} spellCheck={false} value={JSON.stringify(report.reference_scenario.raw_assumptions, null, 2)} />
            </label>
          </details>
          <label className="library-import-confirm"><Checkbox aria-label="确认研究参考假设" checked={scenarioConfirmed} disabled={!!busy} onCheckedChange={checked => setScenarioConfirmed(checked === true)} /><span>我已查看全部假设、原值及出处，确认它们是研究参考条件；所得数值与差异不得作为厂家真实工况的独立核验。</span></label>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      </LibraryDialog>
    </>}
  </section>;
}
