import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Paper, Skeleton } from '@mantine/core';
import { BarChart } from '@mantine/charts';
import { compact, REVIEW_NAMES, ROLE_NAMES, STATE_NAMES } from '@shared/format';
import { cableShape } from '@shared/geometry';
import { dateTime, RESULT_NAMES, resultIssue, resultValue, VERDICT_NAMES } from '@shared/products';
import { RESULT_KINDS, type CheckRow, type ProductResult, type ProjectView, type RatingCondition, type RatingRow, type SpecificationReport, type SpecView, type ValueRow } from '@shared/types';
import { CableGlyph } from '@/canvas/cable-glyph';
import { api } from '@/state/api';
import { queryClient, useLibraryJob, useProductSpec, useSpecificationReports } from '@/state/queries';
import { Button, Checkbox, DocumentDialog, Input, ProductIcon as Icon, SelectField, TabPanel, Tabs, TextArea, ToolButton } from './product-controls';
import { ROLE_FIELDS, StructureExplorer } from './product-structure';
import { OriginBadge, ReviewBadge } from './product-status';
import { reportFailure } from './notice';

const HEAD = 'border-b border-line px-2 py-2 text-left font-strong';
const CELL = 'border-b border-line px-2 py-2 align-top';
const EVENTS: Record<string, string> = { revised: '修改结构', submit: '提交审核', approve: '审核通过', publish: '发布', return: '退回修改', exported: '导出规格书' };
const VERDICT_ORDER: Record<string, number> = { failed: 0, missing: 1, uncovered: 2, passed: 3 };
const ProductCadView = lazy(() => import('./product-cad').then(module => ({ default: module.ProductCadView })));

function Method({ result }: { result: ProductResult }) {
  return <details className="mt-3 text-13 text-ink-2"><summary className="w-fit cursor-pointer">计算条件与方法身份</summary>
    {result.method && <p className="break-all">{result.method.plugin_id} · {result.method.plugin_version} / 方法 {result.method.method_version}<br />封签 {result.method.manifest_sha256}<br />输入 {result.method.request_sha256}</p>}
    {result.created && <p>{dateTime(result.created)} · {result.by}</p>}
    {result.conditions && !Array.isArray(result.conditions) && <dl className="grid gap-2">
      {Object.entries(result.conditions.values).map(([key, value]) => <div key={key}>
        <dt>{({ temperature_k: '导体温度 K', frequency_hz: '频率 Hz', phase_voltage_v: '相电压 V', duration_s: '短路持续时间 s', initial_temperature_k: '短路前温度 K', final_temperature_k: '短路允许温度 K', spacing_m: '线芯中心距 m', r20_length_basis: '电阻长度口径', arrangement: '排列', core_lay_factor: '成缆系数' } as Record<string, string>)[key] ?? key}：{String(value)}</dt>
        <dd className="m-0 mt-1">{result.conditions && !Array.isArray(result.conditions) ? result.conditions.sources[key] : ''}</dd>
      </div>)}
    </dl>}
  </details>;
}

function Values({ result, title }: { result: ProductResult | undefined; title: string }) {
  const issue = resultIssue(result);
  return <section className="grid gap-3"><h3 className="m-0 text-16 font-strong">{title}<span className="ml-3 text-13 font-normal text-ink-2">参考计算</span></h3>
    {issue ? <p className="m-0 text-14">{issue}</p> : <>
      <table className="w-full border-collapse text-13"><thead><tr><th className={HEAD}>参数</th><th className={HEAD}>结果</th><th className={HEAD}>单位</th></tr></thead><tbody>
        {(result!.rows as ValueRow[]).map(row => { const shown = resultValue(row); return <tr key={row.id}><td className={CELL}>{row.title ?? row.label ?? row.id}{row.reason && <span className="mt-1 block text-ink-2">{row.reason}</span>}</td><td className={`${CELL} text-right`}>{shown.value}</td><td className={CELL}>{shown.unit}</td></tr>; })}
      </tbody></table><Method result={result!} />
    </>}
  </section>;
}

function Revision({ view, selected, onSelect }: { view: SpecView; selected: string; onSelect: (role: string) => void }) {
  const key = `studio.structure.${view.version.id}`;
  const [draft, setDraft] = useState<{ values: Record<string, string>; note: string }>(() => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? { values: {}, note: '' }; } catch { return { values: {}, note: '' }; } });
  const [editing, setEditing] = useState(Object.keys(draft.values).length > 0);
  const [error, setError] = useState('');
  const changes = view.structure.filter(row => draft.values[row.key] !== undefined && Number(draft.values[row.key]) !== row.value);
  useEffect(() => { if (changes.length || draft.note) localStorage.setItem(key, JSON.stringify(draft)); else localStorage.removeItem(key); }, [key, draft, changes.length]);
  const mutation = useMutation({ mutationFn: () => api.op('library.revise', { spec: view.spec.id, version: view.version.number,
    values: Object.fromEntries(changes.map(row => [row.key, Number(draft.values[row.key])])), note: draft.note }),
    onSuccess: () => { localStorage.removeItem(key); setDraft({ values: {}, note: '' }); setEditing(false); void queryClient.invalidateQueries({ queryKey: ['library'] }); },
    onError: error => setError(error.message) });
  const latest = view.versions[0].number === view.version.number;
  const canEdit = latest && view.derivation.kind !== 'bundled';
  const visible = view.structure.filter(row => !selected || ROLE_FIELDS[selected]?.includes(row.key));
  return <div className="grid gap-4">
    <StructureExplorer view={view} selected={selected} onSelect={onSelect} />
    <Paper withBorder p="sm"><div className="flex flex-wrap items-center gap-2"><span className="text-13 font-strong">尺寸来源</span>{(['table', 'series', 'standard'] as const).map(origin => { const count = view.structure.filter(row => row.origin === origin).length; return count ? <Badge key={origin} variant="light" color={origin === 'table' ? 'blue' : origin === 'series' ? 'orange' : 'teal'}>{({ table: '原始结构表', series: '系列声明', standard: '标准取值' })[origin]} {count} 项</Badge> : null; })}</div></Paper>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="m-0 text-14 font-strong">{selected ? ROLE_NAMES[selected] ?? selected : '全部结构参数'} <span className="text-ink-2 font-normal">{visible.length} 项</span></h3>
      {canEdit && <Button size="compact" onClick={() => setEditing(!editing)}>{editing ? '收起修改' : '修改结构'}</Button>}</div>
    {selected && !visible.length && <p className="m-0 text-13 text-ink-2">此层由结构模型推导，没有可单独修改的原表尺寸。<button type="button" className="text-copper underline" onClick={() => onSelect('')}>查看全部结构</button></p>}
    {!latest && <p className="m-0 text-13 text-attention">正在查看历史版本；修改请返回最新版本。</p>}
    {!view.structure.length && <p className="m-0 text-14">{view.derivation.note}</p>}
    <table className="w-full border-collapse text-13"><thead><tr><th className={HEAD}>结构项</th><th className={HEAD}>数值 / 单位</th><th className={HEAD}>来源</th></tr></thead><tbody>
      {visible.map(row => <tr key={row.key}><td className={CELL}>{row.label}</td><td className={CELL}>
        {editing && canEdit && row.origin === 'table' && row.key !== 'area' ? <Input aria-label={`修改${row.label}`} type="number" min="0.000001" step="any" className="w-24 text-right"
          value={draft.values[row.key] ?? row.value} onChange={event => { setError(''); setDraft({ ...draft, values: { ...draft.values, [row.key]: event.target.value } }); }} /> : compact(row.value, 6)} <span>{row.unit}</span>
        </td><td className={CELL}><span>{row.revision ? '工程师修改' : ({ table: '结构表', series: '系列声明', standard: '标准规定' })[row.origin]}</span>{(row.basis || row.revision) && <details className="mt-1"><summary className="cursor-pointer text-ink-2">依据</summary>{row.revision && <p className="break-words">上版值 {compact(row.revision.previous)} {row.unit}；{row.revision.by} · {dateTime(row.revision.at)}；{row.revision.note}</p>}<p className="break-words">{row.revision ? '原始依据：' : ''}{row.basis ?? ({ table: '原结构表', series: '系列声明', standard: '标准规定' })[row.origin]}</p></details>}</td></tr>)}
    </tbody></table>
    {view.closure && <details className="text-13 text-ink-2"><summary className="cursor-pointer">外径闭合与结构推导依据</summary><p>表列 {compact(view.closure.declared_mm)} mm，已列结构 {compact(view.closure.listed_mm)} mm；余量 {compact(view.closure.residual_mm)} mm，容差 {compact(view.closure.tolerance_mm)} mm。{view.derivation.note}</p></details>}
    {editing && canEdit && <form className="grid gap-3 border-t border-line pt-4" onSubmit={event => { event.preventDefault(); setError(''); mutation.mutate(); }}>
      <p className="m-0 text-14 font-strong">保存为第 {view.version.number + 1} 版草稿</p>
      {changes.map(row => <p key={row.key} className="m-0 text-13">{row.label}：{compact(row.value)} → {draft.values[row.key]} {row.unit}</p>)}
      <p className="m-0 text-13 text-ink-2">新版本需要重新核对结构、电气参数、短路容量与载流量；原版本和已导出文件保留。修改草稿自动保存在本机。</p>
      <label className="grid gap-1 text-13">修改原因<TextArea aria-label="修改原因" required maxLength={400} className="min-h-20 w-full" value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} /></label>
      {error && <p role="alert" className="m-0 text-14 text-error">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" busy={mutation.isPending} disabled={!changes.length || changes.some(row => !(Number(draft.values[row.key]) > 0))}>保存新版本</Button>
        <Button onClick={() => { setDraft({ values: {}, note: '' }); setEditing(false); setError(''); }}>放弃本次修改</Button></div>
    </form>}
  </div>;
}

function Checks({ view, onLocate }: { view: SpecView; onLocate: (role: string) => void }) {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const result = view.results.check;
  const issue = resultIssue(result);
  if (issue) return <p className="m-0 text-14">{issue}</p>;
  const rows = result!.rows as CheckRow[];
  const counts = result!.summary?.count ?? {};
  return <div className="grid gap-4">
    <div className="check-distribution" aria-hidden="true">{['passed', 'failed', 'missing', 'uncovered'].map(verdict => counts[verdict] ? <span key={verdict} data-verdict={verdict} style={{ flex: counts[verdict] }} /> : null)}</div>
    <p className="m-0 text-14">通过 {counts.passed ?? 0} · 不通过 {counts.failed ?? 0} · 缺项 {counts.missing ?? 0} · 未覆盖 {counts.uncovered ?? 0}</p>
    <p className="m-0 text-13 text-ink-2">缺实测值和未覆盖项不计为通过。审核状态与标准核对结论分别记录。</p>
    <Checkbox checked={onlyIssues} onChange={setOnlyIssues}>仅看需处理项</Checkbox>
    {[...rows].sort((a, b) => (VERDICT_ORDER[a.verdict] ?? 2) - (VERDICT_ORDER[b.verdict] ?? 2)).filter(row => !onlyIssues || row.verdict !== 'passed').map(row => <section key={row.id} data-verdict={row.verdict} className="spec-check-row grid gap-2">
      <div className="flex items-start justify-between gap-3 text-14"><strong>{row.title}{row.target.core_id && <span className="ml-2 text-13 font-normal">{row.target.core_id}</span>}</strong><span className={row.verdict === 'failed' ? 'inline-flex shrink-0 items-center gap-1 text-error' : row.verdict === 'passed' ? 'shrink-0 text-success' : 'shrink-0 text-attention'}>{row.verdict === 'failed' && <Icon name="action/close" className="size-3" />}{VERDICT_NAMES[row.verdict] ?? row.verdict}</span></div>
      <p className="m-0 text-13">要求 {row.comparison ?? ''} {compact(row.limit, 6)} {row.unit} · 实际 {compact(row.actual, 6)} {row.unit}</p>
      {row.actual != null && row.limit != null && row.actual >= 0 && row.limit > 0 && <div className="check-comparison" aria-hidden="true"><span style={{ width: `${row.actual / (Math.max(row.actual, row.limit) * 1.15) * 100}%` }} /><i style={{ left: `${row.limit / (Math.max(row.actual, row.limit) * 1.15) * 100}%` }} /></div>}
      {row.actual != null && row.limit != null && row.actual >= 0 && row.limit > 0 && <span className="text-13 text-ink-2">色条：实际值 · 竖线：标准限值</span>}
      {row.reason && <p className="m-0 text-13 text-ink-2">{row.reason}</p>}
      <div className="flex flex-wrap items-start justify-between gap-2"><details className="text-13 text-ink-2"><summary className="cursor-pointer">标准条款与页码</summary><p>{row.standard} · {row.clause} · PDF 第 {row.pdf_page ?? '未注明'} 页{row.printed_page ? ` / 印刷第 ${row.printed_page} 页` : ''}</p></details>
        {ROLE_FIELDS[row.target.role]?.some(key => view.structure.some(field => field.key === key)) && row.verdict !== 'passed' && <Button size="compact" variant="ghost" icon="action/arrow-right" onClick={() => onLocate(row.target.role)}>查看{ROLE_NAMES[row.target.role]}尺寸</Button>}</div>
    </section>)}
    <Method result={result!} />
  </div>;
}

function Ratings({ result }: { result: ProductResult | undefined }) {
  const issue = resultIssue(result);
  if (issue) return <p className="m-0 text-14">{issue}</p>;
  const conditions = result!.conditions as RatingCondition[];
  const chart = (result!.rows as RatingRow[]).filter(row => row.ampacity_a != null).map(row => ({ condition: `${row.layout_label ?? ''} / ${conditions.find(item => item.id === row.id)?.soil_thermal_resistivity} K·m/W`, '载流量': row.ampacity_a! }));
  return <section className="grid gap-3"><h3 className="m-0 text-16 font-strong">载流量表</h3>
    <p className="m-0 text-13 text-ink-2">中心埋深 0.7 m、环境温度 25 °C；土壤热阻率逐行注明。三芯排管为三回水平，具体工程须使用对应敷设条件。</p>
    {chart.length > 0 && <Paper withBorder p="md"><BarChart h={Math.max(240, chart.length * 34)} data={chart} dataKey="condition" series={[{ name: '载流量', color: 'blue.6' }]} orientation="vertical" yAxisProps={{ width: 150 }} unit=" A" tickLine="none" gridAxis="x" valueFormatter={value => `${value.toFixed(1)} A`} /></Paper>}
    {(result!.rows as RatingRow[]).map(row => { const condition = conditions.find(item => item.id === row.id); return <div key={row.id} className="grid gap-1 border-t border-line pt-3 text-13">
      <div className="flex items-baseline justify-between gap-3"><strong>{row.layout_label ?? condition?.layout}</strong><span className={row.error ? 'text-error' : 'font-strong'}>{row.ampacity_a == null ? '拒算' : `${row.ampacity_a.toFixed(1)} A`}</span></div>
      <span>{condition?.soil_thermal_resistivity} K·m/W · {condition?.depth_m} m · {condition?.ambient_temperature_c} °C · {row.circuits ?? '未声明'} 回路</span>
      <span>{row.error?.message ?? `${row.tier?.label ?? ''}；${row.basis_name ?? ''}`}</span>
    </div>; })}<Method result={result!} /></section>;
}

function Documents({ view }: { view: SpecView }) {
  const reports = useSpecificationReports(view.spec.id);
  const [preview, setPreview] = useState<SpecificationReport | null>(null);
  const shape = cableShape(view.entry.payload.cable_type, view.entry.payload.materials);
  const check = !resultIssue(view.results.check) ? view.results.check?.summary?.count : undefined;
  const mutation = useMutation({ mutationFn: () => api.op<SpecificationReport>('library.export', { spec: view.spec.id, version: view.version.number }),
    onSuccess: report => { setPreview(report); void queryClient.invalidateQueries({ queryKey: ['library'] }); }, onError: reportFailure });
  return <div className="grid gap-4">
    <div className="specification-paper" aria-label="当前版本规格书内容概览">
      <div className="paper-masthead"><span>CABLE STUDIO / 技术资料</span><span>第 {view.version.number} 版</span></div>
      <h3>电缆产品规格书</h3><p>{view.series.designation} · {view.spec.key} mm²</p>
      <div className="paper-product"><svg viewBox="0 0 180 180" role="img" aria-label="规格书电缆断面"><CableGlyph shape={shape} x={90} y={90} scale={76 / shape.radius} /></svg>
        <dl><dt>额定电压</dt><dd>{compact(view.series.u0_v / 1000)} / {compact(view.series.u_v == null ? null : view.series.u_v / 1000)} kV</dd><dt>结构外径</dt><dd>{compact(view.entry.summary.outer_diameter_m * 1000)} mm</dd><dt>文件状态</dt><dd>{REVIEW_NAMES[view.version.review]}</dd><dt>资料身份</dt><dd>{STATE_NAMES[view.series.origin]}</dd></dl></div>
      <div className="paper-sections"><span>01 结构与尺寸</span><span>02 电气与短路参数</span><span>03 载流量及条件</span><span>04 标准核对与来源</span></div>
      <p className="paper-note">{check ? `标准核对：通过 ${check.passed ?? 0} · 不通过 ${check.failed ?? 0} · 缺项 ${check.missing ?? 0} · 未覆盖 ${check.uncovered ?? 0}` : '标准核对尚未完成，文件将如实标明缺项。'}</p>
      <span className="paper-preview-label">内容概览 · 生成后可查看完整 PDF</span>
    </div>
    <p className="m-0 text-13 text-ink-2">第 {view.version.number} 版 · {REVIEW_NAMES[view.version.review]}。文件包含缺项、条件与来源；未审核状态不会自动变成保证值。</p>
    <Button variant="primary" icon="result/report" className="justify-self-start" busy={mutation.isPending} onClick={() => mutation.mutate()}>生成规格书 PDF</Button>
    <DocumentDialog open={Boolean(preview)} onClose={() => setPreview(null)}>{preview && <>
      <div className="pdf-preview-toolbar"><span>第 {preview.version} 版 · {REVIEW_NAMES[preview.review]} · {dateTime(preview.created)}</span><a href={preview.url} download={`${view.spec.name}.pdf`}>下载此文件</a></div>
      <iframe title="已生成的规格书 PDF" className="pdf-preview-frame" src={`${preview.url}?preview=1#view=FitH`} />
      <p className="text-13 text-ink-2">预览为已保存的原始 PDF。若浏览器无法显示，可下载查看；后续修改不会覆盖此文件。</p>
    </>}</DocumentDialog>
    {reports.error && <p role="alert" className="m-0 text-error">{reports.error.message}</p>}
    <h3 className="m-0 text-14 font-strong">已生成的文件 <span className="text-ink-2 font-normal">{reports.data?.length ?? 0}</span></h3>
    {reports.isPending && <p role="status">正在读取文件记录…</p>}
    {reports.data?.length === 0 && <p className="m-0 text-13 text-ink-2">尚未生成。点击上方按钮，保存当前版本的规格书与来源快照。</p>}
    {reports.data?.map(report => <article key={report.id} className="grid gap-2 border-t border-line pt-4 text-13">
      <strong>第 {report.version} 版 · {REVIEW_NAMES[report.review]}</strong><span>{dateTime(report.created)} · {report.by}</span>
      <div className="flex flex-wrap items-center gap-4"><Button size="compact" onClick={() => setPreview(report)}>预览 PDF</Button><a href={report.url} download={`${view.spec.name}.pdf`} className="text-copper">下载 PDF</a><a href={`${report.url}/snapshot`} download className="text-ink">来源快照 JSON</a></div>
      <details><summary className="cursor-pointer text-ink-2">文件身份</summary><p className="break-all">PDF SHA-256：{report.sha256}<br />快照 SHA-256：{report.snapshot_sha256}</p></details>
    </article>)}
    <details className="text-13"><summary className="cursor-pointer font-strong">版本与留痕（{view.versions.length} 版）</summary>
    {view.versions.map(version => <div key={version.id} className="border-t border-line pt-3 text-13"><strong>第 {version.number} 版 · {REVIEW_NAMES[version.review]}</strong><p>{version.note}</p><p>{dateTime(version.created)} · {version.created_by}</p></div>)}
    {view.events.map(event => <div key={event.id} className="text-13"><span>{dateTime(event.at)} · {event.by} · {EVENTS[event.action] ?? event.action}</span>{Boolean(event.detail.note) && <p>{String(event.detail.note)}</p>}</div>)}
    </details>
  </div>;
}

export function SpecInspector({ spec, version, focus, onVersion, onClose }: { spec: string; version?: number; focus?: { tab: string; token: number }; onVersion: (version?: number) => void; onClose: () => void }) {
  const query = useProductSpec(spec, version);
  const job = useLibraryJob();
  const navigate = useNavigate();
  const [tab, setTab] = useState(focus?.tab ?? 'structure');
  const [part, setPart] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus) setTab(focus.tab); }, [focus]);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [tab, spec, version]);
  const view = query.data;
  const previousNumber = view?.versions.find(item => item.number < view.version.number)?.number;
  const previous = useProductSpec(previousNumber ? spec : undefined, previousNumber);
  const compute = useMutation({ mutationFn: () => api.op('library.compute', { series: view!.series.id, specs: [spec], kinds: [...RESULT_KINDS], force: false }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['library'] }), onError: reportFailure });
  const open = useMutation({ mutationFn: () => api.op<ProjectView>('project.create', { name: view!.spec.name, model_id: spec }),
    onSuccess: result => void navigate({ to: '/p/$projectId', params: { projectId: result.meta.id }, search: {} }), onError: reportFailure });
  if (!view) return <div className="p-5 text-14">{query.error ? <><p role="alert">{query.error.message}</p><Button onClick={() => void query.refetch()}>重新读取</Button></> : <p role="status">正在读取规格…</p>}<Button onClick={onClose}>关闭详情</Button></div>;
  const difference = previous.data ? view.structure.filter(row => previous.data!.structure.find(item => item.key === row.key)?.value !== row.value) : [];
  return <>
    <div className="spec-inspector-head grid gap-4">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="m-0 text-28 font-strong">{view.spec.key} <span className="text-14 font-normal text-ink-2">mm²</span></h2><div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-13 font-strong">{view.series.designation}</span><OriginBadge origin={view.series.origin} /><ReviewBadge state={view.version.review} /></div></div><div className="flex items-center gap-1"><Button size="compact" aria-label="导出规格书" icon="result/report" onClick={() => setTab('documents')}><span className="hidden sm:inline">导出规格书</span></Button><ToolButton icon="action/close" label="关闭规格详情" onClick={onClose} /></div></div>
      <div className="flex flex-wrap items-center gap-3 text-13"><label className="flex items-center gap-2">版本<SelectField aria-label="查看规格版本"  value={view.version.number} onValueChange={value => onVersion(Number(value) === view.versions[0].number ? undefined : Number(value))}>{view.versions.map(item => <option key={item.id} value={item.number}>第 {item.number} 版 · {REVIEW_NAMES[item.review]}</option>)}</SelectField></label>
        <Button size="compact" variant="ghost" disabled={view.version.number !== view.versions[0].number} busy={open.isPending} onClick={() => open.mutate()}>进入断面细算</Button></div>
    </div>
    <Tabs className="flex min-h-0 flex-1 flex-col" value={tab} onChange={setTab} items={[{ value: 'structure', label: '结构' }, { value: 'cad', label: 'CAD 实体' }, { value: 'values', label: '计算参数' }, { value: 'checks', label: '标准核对' }, { value: 'documents', label: '版本与文件' }]}>
      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto p-4">
        {view.version.number === view.versions[0].number && RESULT_KINDS.some(kind => !view.results[kind]?.current) && <div className="spec-next-step"><div><strong>本版还有参数未计算</strong><span>按当前结构计算，并逐条核对标准。</span></div><Button size="compact" icon="run/run" busy={compute.isPending} disabled={job.data?.state === 'running'} onClick={() => compute.mutate()}>计算这个规格</Button></div>}
        {view.warnings.length > 0 && <details className="spec-warning-summary"><summary><Icon name="warning" />{view.warnings.length} 项资料提示 · 查看适用范围</summary>{view.warnings.map(issue => <p key={issue.code + issue.message}>{issue.message}</p>)}</details>}
        {difference.length > 0 && <details className="mb-4 text-13"><summary className="cursor-pointer">与第 {previousNumber} 版的结构差异（{difference.length} 项）</summary>{difference.map(row => <p key={row.key}>{row.label}：{compact(previous.data?.structure.find(item => item.key === row.key)?.value)} → {compact(row.value)} {row.unit}</p>)}<p>新版本的计算与审核分别进行；历史结果和文件保留。</p></details>}
        <TabPanel value="structure"><Revision key={view.version.id} view={view} selected={part} onSelect={setPart} /></TabPanel>
        <TabPanel value="cad"><Suspense fallback={<Skeleton height={320} />}><ProductCadView view={view} selected={part} /></Suspense></TabPanel>
        <TabPanel value="values"><div className="grid gap-8"><Values title="电气参数" result={view.results.electrical} /><Values title="短路容量" result={view.results.short_circuit} /><Ratings result={view.results.rating} /></div></TabPanel>
        <TabPanel value="checks"><Checks view={view} onLocate={role => { setPart(role); setTab('structure'); }} /></TabPanel>
        <TabPanel value="documents"><Documents view={view} /></TabPanel>
        <details className="mt-6 border-t border-line pt-4 text-13"><summary className="w-fit cursor-pointer">结构来源与内容摘要</summary><p className="break-words">{view.entry.source}</p><p className="break-all">SHA-256：{view.version.content_sha256}</p></details>
      </div>
    </Tabs>
  </>;
}
