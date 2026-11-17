import { useRef, useState } from 'react';
import { message, optionalRecord, text } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { confidenceText, displayLibraryText, libraryPost, methodText } from './api';

interface Metric {
  published: number | null; value: number | null; unit: string;
  difference: number | null; relative_difference: number | null;
  status: 'declared_input' | 'missing' | 'refused' | 'compared'; reason: string; method?: unknown; tier?: unknown;
}
interface ComparisonRow {
  key: string; sheet: string; table: string; area_mm2: number; designation: string;
  metrics: Record<string, Metric>; source: unknown;
}
interface Report {
  sample_id: string; source: unknown; scope: string; assumptions: unknown; rows: ComparisonRow[];
  summary: { specifications: number; ampacity_compared: number; ampacity_refused: number;
    ampacity_mean_absolute_relative_difference: number | null; ampacity_max_absolute_relative_difference: number | null; weight_compared: number };
}
const METRICS = [{ key: 'outer_diameter', label: '外径', unit: 'mm' }, { key: 'weight', label: '重量', unit: 'kg/km' }, { key: 'r20', label: '导体直流电阻', unit: 'Ω/km' }, { key: 'ampacity', label: '载流量', unit: 'A' }];
const STATUS = { declared_input: '输入保真，非独立验证', missing: '缺少独立数据', refused: '方法拒绝', compared: '有独立计算对照' };
const number = (value: number | null, digits = 3) => value === null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: digits, useGrouping: false });
const percent = (value: number | null) => value === null ? '—' : `${number(value * 100, 2)} %`;

export function CatalogueComparison() {
  const [sample, setSample] = useState('people-mv');
  const [metric, setMetric] = useState('ampacity');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  async function compare() {
    const current = ++request.current;
    setBusy(true); setError(''); setReport(null);
    try { const result = await libraryPost<Report>(`/catalogue-comparison/${sample}`, {}); if (current === request.current) setReport(result); }
    catch (cause) { if (current === request.current) setError(message(cause)); }
    finally { if (current === request.current) setBusy(false); }
  }
  const source = optionalRecord(report?.source);
  const url = text(source.url);
  return <section className="library-import-stack" aria-label="公开样本偏差对照">
    <h2>公开样本偏差对照</h2>
    <p className="muted">逐规格保留厂家原表值、计算值、偏差与原因。原表数值被作为计算输入时，只说明输入保真；缺少独立结果和方法拒绝分别列出。</p>
    <div className="library-import-series-toolbar">
      <Select label="公开样本手册" value={sample} disabled={busy} onChange={next => { setSample(next); setReport(null); setError(''); }} options={[{ value: 'people-mv', label: '人民电器集团 · 8.7/15 kV 公开样本' }, { value: 'bahra-mv', label: 'Bahra · 3.6/6 kV 单芯公开样本' }]} />
      <Button variant="primary" loading={busy} onClick={() => void compare()}>计算样本偏差</Button>
    </div>
    {busy && <p role="status">正在按每个公开规格运行已安装的方法并记录拒算原因…</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {report && <>
      <p className="library-import-source">来源：{text(source.title) || '厂家公开手册'}{text(source.location) && `；${text(source.location)}`}{/^https?:\/\//.test(url) && <> · <a className="object-link" href={url} target="_blank" rel="noreferrer">查看公开原文</a></>}</p>
      <p>{report.summary.specifications} 个规格；载流量可对照 {report.summary.ampacity_compared} 个，方法拒绝 {report.summary.ampacity_refused} 个。可对照部分的平均绝对相对偏差 {percent(report.summary.ampacity_mean_absolute_relative_difference)}，最大 {percent(report.summary.ampacity_max_absolute_relative_difference)}。</p>
      <p className="muted">{displayLibraryText(report.scope)} 全部结果均为参考，尚未人工审核。</p>
      <Tabs value={metric} onValueChange={setMetric}>
        <TabsList aria-label="对照指标">{METRICS.map(item => <TabsTrigger key={item.key} value={item.key}>{item.label}</TabsTrigger>)}</TabsList>
        {METRICS.map(item => <TabsContent key={item.key} value={item.key} className="library-import-stack">
          <DataTable label={`${item.label}逐规格对照`} showGroups={false} groups={[{ id: 'comparison', label: item.label, rows: report.rows.map(row => ({ ...row, id: row.key, metric: row.metrics[item.key] })) }]} rowLabel={row => `${row.designation} ${row.area_mm2} mm²`} columns={[
            { id: 'spec', label: '规格', wrap: true, render: row => <div>{displayLibraryText(row.designation.replaceAll('/', ' / '))} · {row.area_mm2} mm²<br /><span className="muted">{row.sheet}</span></div> },
            { id: 'published', label: '样本值', unit: item.unit, numeric: true, render: row => row.metric.published === null ? '原表未给出' : number(row.metric.published, item.key === 'r20' ? 6 : 3) },
            { id: 'computed', label: '计算或回读值', unit: item.unit, numeric: true, render: row => row.metric.value === null ? '未给出结果' : number(row.metric.value, item.key === 'r20' ? 6 : 3) },
            { id: 'difference', label: '偏差', wrap: true, numeric: true, render: row => row.metric.status === 'declared_input' ? '不作独立偏差' : row.metric.difference === null ? '不可对照' : `${number(row.metric.difference, item.key === 'r20' ? 6 : 3)} ${item.unit}（${percent(row.metric.relative_difference)}）` },
            { id: 'status', label: '判定', wrap: true, render: row => STATUS[row.metric.status] },
            { id: 'reason', label: '原因、方法与可信分档', wrap: true, render: row => <div className="library-import-issues"><span>{displayLibraryText(row.metric.reason)}</span>{!!row.metric.method && <span className="muted">{methodText(row.metric.method)}</span>}<span className="muted">本次样本对照：参考</span>{!!row.metric.tier && <span className="muted">方法覆盖分档：{confidenceText(row.metric.tier)}</span>}</div> },
          ]} />
        </TabsContent>)}
      </Tabs>
    </>}
  </section>;
}
