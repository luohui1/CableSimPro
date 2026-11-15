import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { compact, REVIEW_NAMES, STATE_NAMES } from '@shared/format';
import { cableShape } from '@shared/geometry';
import { dateTime, RESULT_NAMES, resultIssue, resultValue, VERDICT_NAMES } from '@shared/products';
import type { CheckRow, ProductResult, ProjectView, RatingCondition, RatingRow, SpecificationReport, SpecView, ValueRow } from '@shared/types';
import { CableGlyph } from '@/canvas/cable-glyph';
import { api } from '@/state/api';
import { queryClient, useProductSpec, useSpecificationReports } from '@/state/queries';
import { Button, ToolButton } from './button';
import { reportFailure } from './notice';
import { Icon } from './icon';
import { TabPanel, Tabs } from './tabs';

const HEAD = 'border-b border-line px-2 py-2 text-left font-strong';
const CELL = 'border-b border-line px-2 py-2 align-top';
const EVENTS: Record<string, string> = { revised: '修改结构', submit: '提交审核', approve: '审核通过', publish: '发布', return: '退回修改', exported: '导出规格书' };
const VERDICT_ORDER: Record<string, number> = { failed: 0, missing: 1, uncovered: 2, passed: 3 };

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

function Revision({ view }: { view: SpecView }) {
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
  const shape = cableShape(view.entry.payload.cable_type, view.entry.payload.materials);
  return <div className="grid gap-4">
    <figure className="spec-figure">
      <svg viewBox="0 0 200 184" role="img" aria-label={`${view.spec.key} 真实尺寸断面`}><CableGlyph shape={shape} x={100} y={76} scale={64 / shape.radius} />
        <path d="M36 148 V160 M164 148 V160 M36 154 H164" stroke="var(--text-secondary)" strokeWidth=".75" fill="none" />
        <text x="100" y="176" textAnchor="middle" fontSize="13" fill="var(--text-secondary)">⌀ {compact(view.entry.summary.outer_diameter_m * 1000)} mm</text>
      </svg>
      <figcaption><span>标称截面<strong>{view.spec.key} <span className="text-13 font-normal">mm²</span></strong></span><span>结构外径<strong>{compact(view.entry.summary.outer_diameter_m * 1000)} <span className="text-13 font-normal">mm</span></strong></span><span>按保存尺寸比例绘制</span></figcaption>
    </figure>
    {view.closure && <p className="m-0 text-13">外径闭合：表列 {compact(view.closure.declared_mm)} mm，已列结构 {compact(view.closure.listed_mm)} mm；余量 {compact(view.closure.residual_mm)} mm，容差 {compact(view.closure.tolerance_mm)} mm。{view.derivation.note}</p>}
    {canEdit && <Button size="compact" className="justify-self-start" onClick={() => setEditing(!editing)}>{editing ? '收起修改' : '修改结构'}</Button>}
    {!latest && <p className="m-0 text-13 text-attention">正在查看历史版本；修改请返回最新版本。</p>}
    {!view.structure.length && <p className="m-0 text-14">{view.derivation.note}</p>}
    <table className="w-full border-collapse text-13"><thead><tr><th className={HEAD}>结构项</th><th className={HEAD}>数值 / 单位</th><th className={HEAD}>来源</th></tr></thead><tbody>
      {view.structure.map(row => <tr key={row.key}><td className={CELL}>{row.label}</td><td className={CELL}>
        {editing && canEdit && row.origin === 'table' && row.key !== 'area' ? <input aria-label={`修改${row.label}`} type="number" min="0.000001" step="any" className="studio-input w-24 text-right"
          value={draft.values[row.key] ?? row.value} onChange={event => { setError(''); setDraft({ ...draft, values: { ...draft.values, [row.key]: event.target.value } }); }} /> : compact(row.value, 6)} <span>{row.unit}</span>
        </td><td className={CELL}><span>{row.revision ? '工程师修改' : ({ table: '结构表', series: '系列声明', standard: '标准规定' })[row.origin]}</span>{(row.basis || row.revision) && <details className="mt-1"><summary className="cursor-pointer text-ink-2">依据</summary>{row.revision && <p className="break-words">上版值 {compact(row.revision.previous)} {row.unit}；{row.revision.by} · {dateTime(row.revision.at)}；{row.revision.note}</p>}<p className="break-words">{row.revision ? '原始依据：' : ''}{row.basis ?? ({ table: '原结构表', series: '系列声明', standard: '标准规定' })[row.origin]}</p></details>}</td></tr>)}
    </tbody></table>
    {editing && canEdit && <form className="grid gap-3 border-t border-line pt-4" onSubmit={event => { event.preventDefault(); setError(''); mutation.mutate(); }}>
      <p className="m-0 text-14 font-strong">保存为第 {view.version.number + 1} 版草稿</p>
      {changes.map(row => <p key={row.key} className="m-0 text-13">{row.label}：{compact(row.value)} → {draft.values[row.key]} {row.unit}</p>)}
      <p className="m-0 text-13 text-ink-2">新版本需要重新核对结构、电气参数、短路容量与载流量；原版本和已导出文件保留。修改草稿自动保存在本机。</p>
      <label className="grid gap-1 text-13">修改原因<textarea aria-label="修改原因" required maxLength={400} className="studio-input min-h-20 w-full" value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} /></label>
      {error && <p role="alert" className="m-0 text-14 text-error">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" busy={mutation.isPending} disabled={!changes.length || changes.some(row => !(Number(draft.values[row.key]) > 0))}>保存新版本</Button>
        <Button onClick={() => { setDraft({ values: {}, note: '' }); setEditing(false); setError(''); }}>放弃本次修改</Button></div>
    </form>}
  </div>;
}

function Checks({ view }: { view: SpecView }) {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const result = view.results.check;
  const issue = resultIssue(result);
  if (issue) return <p className="m-0 text-14">{issue}</p>;
  const rows = result!.rows as CheckRow[];
  const counts = result!.summary?.count ?? {};
  return <div className="grid gap-4">
    <p className="m-0 text-14">通过 {counts.passed ?? 0} · 不通过 {counts.failed ?? 0} · 缺项 {counts.missing ?? 0} · 未覆盖 {counts.uncovered ?? 0}</p>
    <p className="m-0 text-13 text-ink-2">缺实测值和未覆盖项不计为通过。审核状态与标准核对结论分别记录。</p>
    <label className="flex items-center gap-2 text-14"><input type="checkbox" checked={onlyIssues} onChange={event => setOnlyIssues(event.target.checked)} />仅看需处理项</label>
    {[...rows].sort((a, b) => (VERDICT_ORDER[a.verdict] ?? 2) - (VERDICT_ORDER[b.verdict] ?? 2)).filter(row => !onlyIssues || row.verdict !== 'passed').map(row => <section key={row.id} data-verdict={row.verdict} className="spec-check-row grid gap-2">
      <div className="flex items-start justify-between gap-3 text-14"><strong>{row.title}{row.target.core_id && <span className="ml-2 text-13 font-normal">{row.target.core_id}</span>}</strong><span className={row.verdict === 'failed' ? 'inline-flex shrink-0 items-center gap-1 text-error' : row.verdict === 'passed' ? 'shrink-0 text-success' : 'shrink-0 text-attention'}>{row.verdict === 'failed' && <Icon name="action/close" className="size-3" />}{VERDICT_NAMES[row.verdict] ?? row.verdict}</span></div>
      <p className="m-0 text-13">要求 {row.comparison ?? ''} {compact(row.limit, 6)} {row.unit} · 实际 {compact(row.actual, 6)} {row.unit}</p>
      <p className="m-0 text-13">{row.standard} · {row.clause} · PDF 第 {row.pdf_page ?? '未注明'} 页{row.printed_page ? ` / 印刷第 ${row.printed_page} 页` : ''}</p>
      {row.reason && <p className="m-0 text-13 text-ink-2">{row.reason}</p>}
    </section>)}
    <Method result={result!} />
  </div>;
}

function Ratings({ result }: { result: ProductResult | undefined }) {
  const issue = resultIssue(result);
  if (issue) return <p className="m-0 text-14">{issue}</p>;
  const conditions = result!.conditions as RatingCondition[];
  return <section className="grid gap-3"><h3 className="m-0 text-16 font-strong">载流量表</h3>
    <p className="m-0 text-13 text-ink-2">中心埋深 0.7 m、环境温度 25 °C；土壤热阻率逐行注明。三芯排管为三回水平，具体工程须使用对应敷设条件。</p>
    {(result!.rows as RatingRow[]).map(row => { const condition = conditions.find(item => item.id === row.id); return <div key={row.id} className="grid gap-1 border-t border-line pt-3 text-13">
      <div className="flex items-baseline justify-between gap-3"><strong>{row.layout_label ?? condition?.layout}</strong><span className={row.error ? 'text-error' : 'font-strong'}>{row.ampacity_a == null ? '拒算' : `${row.ampacity_a.toFixed(1)} A`}</span></div>
      <span>{condition?.soil_thermal_resistivity} K·m/W · {condition?.depth_m} m · {condition?.ambient_temperature_c} °C · {row.circuits ?? '未声明'} 回路</span>
      <span>{row.error?.message ?? `${row.tier?.label ?? ''}；${row.basis_name ?? ''}`}</span>
    </div>; })}<Method result={result!} /></section>;
}

function Documents({ view }: { view: SpecView }) {
  const reports = useSpecificationReports(view.spec.id);
  const mutation = useMutation({ mutationFn: () => api.op<SpecificationReport>('library.export', { spec: view.spec.id, version: view.version.number }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['library'] }), onError: reportFailure });
  return <div className="grid gap-4">
    <p className="m-0 text-14">生成第 {view.version.number} 版规格书，状态为“{REVIEW_NAMES[view.version.review]}”。保存结构、计算条件、逐条核对、缺项和方法身份，附可读取的来源快照。</p>
    <p className="m-0 text-13 text-ink-2">未审核版本会标明草稿或待审核；公开资料和参考计算不自动成为本厂保证值。导出后文件固定，后续修改不会覆盖。</p>
    <Button variant="primary" icon="result/report" className="justify-self-start" busy={mutation.isPending} onClick={() => mutation.mutate()}>生成规格书 PDF</Button>
    {reports.error && <p role="alert" className="m-0 text-error">{reports.error.message}</p>}
    {reports.data?.map(report => <article key={report.id} className="grid gap-2 border-t border-line pt-4 text-13">
      <strong>第 {report.version} 版 · {REVIEW_NAMES[report.review]}</strong><span>{dateTime(report.created)} · {report.by}</span>
      <div className="flex flex-wrap gap-4"><a href={report.url} download={`${view.spec.name}.pdf`} className="text-copper">下载 PDF</a><a href={`${report.url}/snapshot`} download className="text-ink">来源快照 JSON</a></div>
      <details><summary className="cursor-pointer text-ink-2">文件身份</summary><p className="break-all">PDF SHA-256：{report.sha256}<br />快照 SHA-256：{report.snapshot_sha256}</p></details>
    </article>)}
    <h3 className="m-0 mt-2 text-16 font-strong">版本与留痕</h3>
    {view.versions.map(version => <div key={version.id} className="border-t border-line pt-3 text-13"><strong>第 {version.number} 版 · {REVIEW_NAMES[version.review]}</strong><p>{version.note}</p><p>{dateTime(version.created)} · {version.created_by}</p></div>)}
    {view.events.map(event => <div key={event.id} className="text-13"><span>{dateTime(event.at)} · {event.by} · {EVENTS[event.action] ?? event.action}</span>{Boolean(event.detail.note) && <p>{String(event.detail.note)}</p>}</div>)}
  </div>;
}

export function SpecInspector({ spec, version, onVersion, onClose }: { spec: string; version?: number; onVersion: (version?: number) => void; onClose: () => void }) {
  const query = useProductSpec(spec, version);
  const navigate = useNavigate();
  const [tab, setTab] = useState('structure');
  const view = query.data;
  const previousNumber = view?.versions.find(item => item.number < view.version.number)?.number;
  const previous = useProductSpec(previousNumber ? spec : undefined, previousNumber);
  const open = useMutation({ mutationFn: () => api.op<ProjectView>('project.create', { name: view!.spec.name, model_id: spec }),
    onSuccess: result => void navigate({ to: '/p/$projectId', params: { projectId: result.meta.id }, search: {} }), onError: reportFailure });
  if (!view) return <div className="p-5 text-14">{query.error ? <><p role="alert">{query.error.message}</p><Button onClick={() => void query.refetch()}>重新读取</Button></> : <p role="status">正在读取规格…</p>}<Button onClick={onClose}>关闭详情</Button></div>;
  const difference = previous.data ? view.structure.filter(row => previous.data!.structure.find(item => item.key === row.key)?.value !== row.value) : [];
  return <>
    <div className="spec-inspector-head grid gap-4">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="m-0 text-28 font-strong">{view.spec.key} <span className="text-14 font-normal text-ink-2">mm²</span></h2><p className="m-0 mt-1 text-13 text-ink-2">{view.series.designation} · {STATE_NAMES[view.series.origin]}</p></div><div className="flex items-center gap-1"><Button size="compact" aria-label="导出规格书" icon="result/report" onClick={() => setTab('documents')}><span className="hidden sm:inline">导出规格书</span></Button><ToolButton icon="action/close" label="关闭规格详情" onClick={onClose} /></div></div>
      <div className="flex flex-wrap items-center gap-3 text-13"><label className="flex items-center gap-2">版本<select aria-label="查看规格版本" className="studio-input" value={view.version.number} onChange={event => onVersion(Number(event.target.value) === view.versions[0].number ? undefined : Number(event.target.value))}>{view.versions.map(item => <option key={item.id} value={item.number}>第 {item.number} 版 · {REVIEW_NAMES[item.review]}</option>)}</select></label>
        <Button size="compact" variant="ghost" disabled={view.version.number !== view.versions[0].number} busy={open.isPending} onClick={() => open.mutate()}>进入断面细算</Button></div>
    </div>
    <Tabs className="flex min-h-0 flex-1 flex-col" value={tab} onChange={setTab} items={[{ value: 'structure', label: '结构' }, { value: 'values', label: '计算参数' }, { value: 'checks', label: '标准核对' }, { value: 'documents', label: '版本与文件' }]}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {view.warnings.map(issue => <p key={issue.code + issue.message} className="m-0 mb-4 text-13 text-attention">{issue.message}</p>)}
        {difference.length > 0 && <details className="mb-4 text-13"><summary className="cursor-pointer">与第 {previousNumber} 版的结构差异（{difference.length} 项）</summary>{difference.map(row => <p key={row.key}>{row.label}：{compact(previous.data?.structure.find(item => item.key === row.key)?.value)} → {compact(row.value)} {row.unit}</p>)}<p>新版本的计算与审核分别进行；历史结果和文件保留。</p></details>}
        <TabPanel value="structure"><Revision key={view.version.id} view={view} /></TabPanel>
        <TabPanel value="values"><div className="grid gap-8"><Values title="电气参数" result={view.results.electrical} /><Values title="短路容量" result={view.results.short_circuit} /><Ratings result={view.results.rating} /></div></TabPanel>
        <TabPanel value="checks"><Checks view={view} /></TabPanel>
        <TabPanel value="documents"><Documents view={view} /></TabPanel>
        <details className="mt-6 border-t border-line pt-4 text-13"><summary className="w-fit cursor-pointer">结构来源与内容摘要</summary><p className="break-words">{view.entry.source}</p><p className="break-all">SHA-256：{view.version.content_sha256}</p></details>
      </div>
    </Tabs>
  </>;
}
