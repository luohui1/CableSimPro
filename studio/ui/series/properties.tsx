// The properties of what is selected: the size, one of its parts, an analysis, its files or its versions.
// Every number says where it comes from; a requirement shows its clause and page; nothing is filled in.
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ChevronRight, CircleAlert, CircleCheck, CircleDashed, CircleX, Ellipsis, FileDown, History as HistoryIcon, PencilLine, Play, SquareArrowOutUpRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Menu, Modal } from '@mantine/core';
import { compact, REVIEW_NAMES, STATE_NAMES } from '@shared/format';
import { dateTime, resultValue } from '@shared/products';
import { RESULT_KINDS, type CheckRow, type ProductResult, type ProjectView, type RatingCondition, type RatingRow, type SpecificationReport, type SpecView, type StructureValue, type ValueRow } from '@shared/types';
import { reportFailure } from '@/components/notice';
import { api } from '@/state/api';
import { queryClient, useLibraryJob, useProductSpec, useSpecificationReports } from '@/state/queries';
import { ANALYSES, analysisState, PART_FIELDS, partChecks, partSize, partUnit, reviewTone, sortChecks, VERDICT_TEXT, type Focus, type Part, type PartCheck, type Verdict } from './model';

const ORIGIN_TEXT: Record<string, string> = { table: '结构表', series: '系列声明', standard: '标准规定' };
const EVENTS: Record<string, string> = { revised: '修改结构', submit: '提交审核', approve: '审核通过', publish: '发布', return: '退回修改', exported: '导出规格书', imported: '导入', seeded: '随软件提供' };
const CONDITIONS: Record<string, string> = { temperature_k: '导体温度', frequency_hz: '频率', phase_voltage_v: '相电压', duration_s: '短路持续时间', initial_temperature_k: '短路前温度',
  final_temperature_k: '短路允许温度', spacing_m: '线芯中心距', r20_length_basis: '电阻长度口径', arrangement: '排列', core_lay_factor: '成缆系数', ks: '集肤系数 ks', kp: '邻近系数 kp' };
const VERDICT_GLYPH: Record<Verdict, ReactNode> = {
  failed: <CircleX size={16} />, missing: <CircleAlert size={16} />, uncovered: <CircleDashed size={16} />, passed: <CircleCheck size={16} />,
};

function conditionValue(key: string, value: number | string) {
  if (typeof value !== 'number') return ({ finished_cable: '每米成品电缆', trefoil: '品字形紧贴', flat: '水平排列' } as Record<string, string>)[value] ?? value;
  if (key.endsWith('_k')) return `${compact(value - 273.15, 4)} °C`;
  if (key === 'spacing_m') return `${compact(value * 1000, 4)} mm`;
  if (key === 'phase_voltage_v') return `${compact(value / 1000, 4)} kV`;
  if (key === 'frequency_hz') return `${compact(value)} Hz`;
  if (key === 'duration_s') return `${compact(value)} s`;
  return compact(value, 5);
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return <section className="ws-section-block"><header><h3>{title}</h3>{aside}</header>{children}</section>;
}
function Row({ label, children, origin, hint }: { label: ReactNode; children: ReactNode; origin?: string; hint?: string }) {
  return <div className="ws-row" title={hint}><dt>{label}</dt><dd>{children}{origin && <span className="ws-origin" data-origin={origin}>{ORIGIN_TEXT[origin] ?? origin}</span>}</dd></div>;
}
function Method({ result }: { result: ProductResult }) {
  if (!result.method) return null;
  return <details className="ws-method"><summary>方法与输入身份</summary>
    <p>{result.method.plugin_id} {result.method.plugin_version} · 方法 {result.method.method_version}</p>
    <p>{dateTime(result.created)} · {result.by}</p>
    <p className="ws-hash">封签 {result.method.manifest_sha256}<br />输入 {result.method.request_sha256}</p>
  </details>;
}
function Unavailable({ result, onCompute, busy }: { result: ProductResult | undefined; onCompute?: () => void; busy?: boolean }) {
  const text = !result ? '这一版还没有计算。' : !result.current ? '结构或执行标准已变化，这个结果需要重算。' : result.error ? `计算失败：${result.error.message}` : null;
  if (!text) return null;
  return <div className="ws-notice" data-tone={result?.error ? 'fail' : undefined}><p>{text}</p>
    {onCompute && <button type="button" className="ws-button" disabled={busy} onClick={onCompute}><Play size={14} />计算这个规格</button>}</div>;
}

const SYMBOLS: Record<string, string> = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '=': '=', in: '属于' };
/** A unit as written after a number: a dimensionless quantity has none. */
const unitText = (unit: string) => (unit === '1' ? '' : ` ${unit}`);

function CheckItem({ row, onPart }: { row: PartCheck; onPart?: () => void }) {
  const verdict = (['failed', 'missing', 'uncovered', 'passed'].includes(row.verdict) ? row.verdict : 'uncovered') as Verdict;
  const requirement = row.limit !== null ? `${row.comparison ? `${SYMBOLS[row.comparison] ?? row.comparison} ` : ''}${compact(row.limit, 5)}${unitText(row.unit)}` : '见条款';
  return <article className="ws-check" data-verdict={verdict}>
    <span className="ws-check-icon" aria-hidden="true">{VERDICT_GLYPH[verdict]}</span>
    <div>
      <div className="ws-check-head"><b>{row.title.replace(/^芯 \d+ · /, '')}{row.cores > 1 && <span className="ws-cores">{row.cores} 芯</span>}</b><span className="ws-check-verdict">{VERDICT_TEXT[verdict]}</span></div>
      <p className="ws-check-values">要求 {requirement}<span>实际 {row.actual !== null ? `${compact(row.actual, 5)}${unitText(row.unit)}` : '—'}</span></p>
      {row.reason && <p className="ws-check-reason">{row.reason}</p>}
      <p className="ws-clause">{row.standard} · {row.clause}{row.pdf_page ? ` · PDF 第 ${row.pdf_page} 页` : ''}{row.printed_page ? ` / 印刷第 ${row.printed_page} 页` : ''}
        {onPart && <button type="button" onClick={onPart}>查看部位</button>}</p>
    </div>
  </article>;
}

/** Inline editing of the table's own dimensions; a change becomes a new draft version, the present one stays. */
export interface Draft { values: Record<string, string>; note: string }
function DimensionRow({ item, editing, draft, onDraft }: { item: StructureValue; editing: boolean; draft: Draft; onDraft: (draft: Draft) => void }) {
  const editable = editing && item.origin === 'table' && item.key !== 'area';
  const changed = draft.values[item.key] !== undefined && Number(draft.values[item.key]) !== item.value;
  return <div className="ws-row" data-changed={changed ? '' : undefined}>
    <dt>{item.label}</dt>
    <dd>{editable ? <input className="ws-input ws-input-number" type="number" min="0.000001" step="any" aria-label={`修改${item.label}`}
      value={draft.values[item.key] ?? String(item.value)} onChange={event => onDraft({ ...draft, values: { ...draft.values, [item.key]: event.target.value } })} />
      : <span className="ws-value">{compact(item.value, 6)}</span>}<span className="ws-unit">{item.unit}</span>
      <span className="ws-origin" data-origin={item.revision ? 'revised' : item.origin} title={item.basis ?? undefined}>{item.revision ? '工程师修改' : ORIGIN_TEXT[item.origin]}</span>
      {(item.basis || item.revision) && <details className="ws-basis"><summary>依据</summary>
        {item.revision && <p>上版 {compact(item.revision.previous)} {item.unit} · {item.revision.by} · {dateTime(item.revision.at)} · {item.revision.note}</p>}
        <p>{item.basis ?? ORIGIN_TEXT[item.origin]}</p></details>}
    </dd>
  </div>;
}

function Materials({ view, part }: { view: SpecView; part: Part }) {
  const material = view.entry.payload.materials.find(item => item.id === part.material) as (Record<string, unknown> & { label: string }) | undefined;
  if (!material) return null;
  const rows: [string, string][] = [
    ['thermal_resistivity', '热阻率 K·m/W'], ['electrical_resistivity_20', '20 °C 电阻率 Ω·m'], ['temperature_coefficient_20', '电阻温度系数 1/K'],
    ['relative_permittivity', '相对介电常数'], ['loss_tangent', '介质损耗角正切'], ['relative_permeability', '相对磁导率'], ['density', '密度 kg/m³'],
  ];
  return <Section title="材料" aside={<span className="ws-aside">{material.label}</span>}>
    <dl className="ws-rows">{rows.filter(([key]) => typeof material[key] === 'number').map(([key, label]) => <Row key={key} label={label}><span className="ws-value">{compact(material[key] as number, 4)}</span></Row>)}
      {typeof material.standard_kind === 'string' && <Row label="标准材料类别"><span className="ws-value">{material.standard_kind as string}</span></Row>}</dl>
  </Section>;
}

function Values({ result, title, onCompute, busy }: { result: ProductResult | undefined; title: string; onCompute: () => void; busy: boolean }) {
  const unavailable = <Unavailable result={result} onCompute={onCompute} busy={busy} />;
  if (!result?.current || result.error) return <Section title={title}>{unavailable}</Section>;
  const conditions = result.conditions && !Array.isArray(result.conditions) ? result.conditions : null;
  // A three-core cable gives one row per core; equal values are shown once and say so.
  const groups = new Map<string, ValueRow[]>();
  for (const row of result.rows as ValueRow[]) {
    const name = (row.title ?? row.label ?? row.id).replace(/^芯 \d+ · /, '');
    groups.set(name, [...(groups.get(name) ?? []), row]);
  }
  return <>
    <Section title={title} aside={<span className="ws-aside">参考计算</span>}>
      <dl className="ws-rows">{[...groups.entries()].map(([name, rows]) => {
        const row = rows[0];
        const same = rows.every(item => item.value === row.value && item.status === row.status);
        const shown = resultValue({ ...row, value: row.value === null ? null : Number(row.value.toPrecision(6)) });
        return <Row key={name} label={name} hint={row.reason ?? undefined}>
          {row.value === null ? <span className="ws-missing" title={row.reason ?? undefined}>{row.status === 'missing' ? '缺输入' : '未覆盖'}</span>
            : <><span className="ws-value">{compact(Number(shown.value), 4)}</span><span className="ws-unit">{shown.unit === '1' ? '' : shown.unit}</span></>}
          {rows.length > 1 && <span className="ws-note-inline">{same ? `${rows.length} 芯相同` : '各芯不同'}</span>}
        </Row>;
      })}</dl>
    </Section>
    {conditions && <Section title="计算条件"><dl className="ws-rows">{Object.entries(conditions.values).map(([key, value]) =>
      <Row key={key} label={CONDITIONS[key] ?? key} hint={conditions.sources[key]}><span className="ws-value">{conditionValue(key, value)}</span><span className="ws-condition-source">{conditions.sources[key]}</span></Row>)}</dl></Section>}
    <Method result={result} />
  </>;
}

function Ratings({ result, onCompute, busy }: { result: ProductResult | undefined; onCompute: () => void; busy: boolean }) {
  if (!result?.current || result.error) return <Section title="载流量表"><Unavailable result={result} onCompute={onCompute} busy={busy} /></Section>;
  const conditions = result.conditions as RatingCondition[];
  const rows = result.rows as RatingRow[];
  const layouts = [...new Set(conditions.map(item => item.layout))];
  return <>
    <Section title="载流量表" aside={<span className="ws-aside">埋深 {conditions[0]?.depth_m} m · {conditions[0]?.ambient_temperature_c} °C · 导体 90 °C</span>}>
      <table className="ws-mini-table"><thead><tr><th>土壤热阻率<span className="ws-unit">K·m/W</span></th>{layouts.map(layout =>
        <th key={layout} className="ws-num">{rows.find(row => conditions.find(item => item.id === row.id)?.layout === layout)?.layout_label ?? layout}<span className="ws-unit">A</span></th>)}</tr></thead>
        <tbody>{[...new Set(conditions.map(item => item.soil_thermal_resistivity))].map(rho => <tr key={rho}><th scope="row">{rho}</th>{layouts.map(layout => {
          const condition = conditions.find(item => item.layout === layout && item.soil_thermal_resistivity === rho);
          const row = rows.find(item => item.id === condition?.id);
          return <td key={layout} className="ws-num">{row?.ampacity_a != null ? row.ampacity_a.toFixed(1) : <span className="ws-fail-text" title={row?.error?.message}>拒算</span>}</td>;
        })}</tr>)}</tbody></table>
    </Section>
    {[...new Map(rows.filter(row => row.error).map(row => [row.error!.message, row])).values()].map(row =>
      <div key={row.id} className="ws-notice" data-tone="fail"><p><b>{row.layout_label ?? row.id} 拒算：</b>{row.error!.message}</p></div>)}
    {rows.find(row => row.tier) && <Section title="可信分档"><p className="ws-text">{rows.find(row => row.tier)!.tier!.label}：{rows.find(row => row.tier)!.tier!.meaning}</p></Section>}
    <Method result={result} />
  </>;
}

function Checks({ view, parts, onFocus, onCompute, busy }: { view: SpecView; parts: Part[]; onFocus: (focus: Focus) => void; onCompute: () => void; busy: boolean }) {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const result = view.results.check;
  if (!result?.current || result.error) return <Section title="标准核对"><Unavailable result={result} onCompute={onCompute} busy={busy} /></Section>;
  const count = result.summary?.count ?? {};
  const total = Math.max(1, (count.passed ?? 0) + (count.failed ?? 0) + (count.missing ?? 0) + (count.uncovered ?? 0));
  const roles = [...parts.map(part => part.role), ...new Set((result.rows as CheckRow[]).map(row => row.target.role))].filter((role, index, list) => list.indexOf(role) === index);
  return <>
    <Section title="标准核对" aside={<label className="ws-toggle"><input type="checkbox" checked={onlyIssues} onChange={event => setOnlyIssues(event.target.checked)} />只看需处理</label>}>
      <div className="ws-distribution">{(['passed', 'failed', 'missing', 'uncovered'] as const).map(verdict => count[verdict] ? <i key={verdict} data-verdict={verdict} style={{ width: `${count[verdict] / total * 100}%` }} /> : null)}</div>
      <p className="ws-counts">{(['passed', 'failed', 'missing', 'uncovered'] as const).map(verdict => <span key={verdict} data-verdict={verdict}>{VERDICT_TEXT[verdict]} <b>{count[verdict] ?? 0}</b></span>)}</p>
      <p className="ws-text">按 {(result.standards ?? view.series.standards).join('、') || '声明的执行标准'} 逐条核对。缺实测值和标准库未覆盖的项不计为通过；审核结论另行记录。</p>
    </Section>
    {roles.map(role => {
      const rows = sortChecks(partChecks(view, role)).filter(row => !onlyIssues || row.verdict !== 'passed');
      const part = parts.find(item => item.role === role);
      if (!rows.length) return null;
      return <Section key={role} title={part ? `${part.number}  ${part.name}` : role} aside={part && <button type="button" className="ws-link" onClick={() => onFocus({ kind: 'part', role })}>在断面中查看<ChevronRight size={14} /></button>}>
        <div className="ws-checks">{rows.map(row => <CheckItem key={row.id} row={row} />)}</div>
      </Section>;
    })}
    <Method result={result} />
  </>;
}

function Documents({ view }: { view: SpecView }) {
  const reports = useSpecificationReports(view.spec.id);
  const [preview, setPreview] = useState<SpecificationReport | null>(null);
  const exporting = useMutation({ mutationFn: () => api.op<SpecificationReport>('library.export', { spec: view.spec.id, version: view.version.number }),
    onSuccess: report => { setPreview(report); void queryClient.invalidateQueries({ queryKey: ['library'] }); }, onError: reportFailure });
  return <>
    <Section title="规格书">
      <p className="ws-text">按第 {view.version.number} 版（{REVIEW_NAMES[view.version.review]}）生成 PDF，同时保存来源快照。文件如实列出缺项、计算条件和来源；未审核的版本不会写成保证值。</p>
      <button type="button" className="ws-button" data-variant="primary" disabled={exporting.isPending} onClick={() => exporting.mutate()}><FileDown size={15} />{exporting.isPending ? '正在生成…' : '生成规格书 PDF'}</button>
    </Section>
    <Section title="已生成的文件" aside={<span className="ws-aside">{reports.data?.length ?? 0} 份</span>}>
      {reports.error && <p role="alert" className="ws-error-text">{reports.error.message}</p>}
      {reports.data?.length === 0 && <p className="ws-text">还没有生成过。</p>}
      <div className="ws-files">{reports.data?.map(report => <article key={report.id} className="ws-file">
        <div><b>第 {report.version} 版 · {REVIEW_NAMES[report.review]}</b><span>{dateTime(report.created)} · {report.by}</span></div>
        <div className="ws-file-actions"><button type="button" className="ws-button" onClick={() => setPreview(report)}>预览 PDF</button>
          <a className="ws-link" href={report.url} download={`${view.spec.name}.pdf`}>下载 PDF</a><a className="ws-link" href={`${report.url}/snapshot`} download>来源快照 JSON</a></div>
        <details className="ws-basis"><summary>文件身份</summary><p className="ws-hash">PDF SHA-256 {report.sha256}<br />快照 SHA-256 {report.snapshot_sha256}</p></details>
      </article>)}</div>
    </Section>
    <Modal opened={Boolean(preview)} onClose={() => setPreview(null)} title="规格书 PDF 预览" size="min(1100px, 95vw)" centered classNames={{ content: 'ws ws-dialog', header: 'ws-dialog-header', title: 'ws-dialog-title' }}
      closeButtonProps={{ 'aria-label': '关闭规格书预览' }}>{preview && <>
        <div className="ws-pdf-bar"><span>第 {preview.version} 版 · {REVIEW_NAMES[preview.review]} · {dateTime(preview.created)}</span><a className="ws-link" href={preview.url} download={`${view.spec.name}.pdf`}>下载此文件</a></div>
        <iframe title="已生成的规格书 PDF" className="ws-pdf-frame" src={`${preview.url}?preview=1#view=FitH`} />
      </>}</Modal>
  </>;
}

function History({ view, onVersion }: { view: SpecView; onVersion: (version?: number) => void }) {
  const previousNumber = view.versions.find(item => item.number < view.version.number)?.number;
  const previous = useProductSpec(previousNumber ? view.spec.id : undefined, previousNumber);
  const difference = previous.data ? view.structure.filter(row => previous.data!.structure.find(item => item.key === row.key)?.value !== row.value) : [];
  return <>
    <Section title="版本">
      <div className="ws-versions">{view.versions.map(version => <button key={version.id} type="button" className="ws-version-item" aria-current={version.number === view.version.number ? 'true' : undefined}
        onClick={() => onVersion(version.number === view.versions[0].number ? undefined : version.number)}>
        <b>第 {version.number} 版</b><span className="ws-pill" data-tone={reviewTone(version.review)}>{REVIEW_NAMES[version.review]}</span>
        <span className="ws-version-note">{version.note}</span><span className="ws-version-meta">{dateTime(version.created)} · {version.created_by}</span>
      </button>)}</div>
    </Section>
    {difference.length > 0 && <Section title={`与第 ${previousNumber} 版的差异`}><dl className="ws-rows">{difference.map(row =>
      <Row key={row.key} label={row.label}><span className="ws-value">{compact(previous.data?.structure.find(item => item.key === row.key)?.value)} → {compact(row.value)}</span><span className="ws-unit">{row.unit}</span></Row>)}</dl></Section>}
    <Section title="留痕">
      <ol className="ws-events">{view.events.map(event => <li key={event.id}><span className="ws-event-time">{dateTime(event.at)}</span><b>{EVENTS[event.action] ?? event.action}</b><span>{event.by}</span>
        {Boolean(event.detail.note) && <p>{String(event.detail.note)}</p>}</li>)}</ol>
    </Section>
  </>;
}

export function Properties({ view, parts, focus, onFocus, onVersion }: {
  view: SpecView | undefined; parts: Part[]; focus: Focus; onFocus: (focus: Focus) => void; onVersion: (version?: number) => void;
}) {
  const job = useLibraryJob();
  const navigate = useNavigate();
  const storage = view ? `studio.structure.${view.version.id}` : '';
  const [draft, setDraft] = useState<Draft>({ values: {}, note: '' });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!storage) return;
    try { const saved = JSON.parse(localStorage.getItem(storage) ?? 'null') as Draft | null; setDraft(saved ?? { values: {}, note: '' }); setEditing(Boolean(saved && Object.keys(saved.values).length)); }
    catch { setDraft({ values: {}, note: '' }); setEditing(false); }
    setError('');
  }, [storage]);
  const changes = view?.structure.filter(row => draft.values[row.key] !== undefined && Number(draft.values[row.key]) !== row.value) ?? [];
  useEffect(() => {
    if (!storage) return;
    try { if (changes.length || draft.note) localStorage.setItem(storage, JSON.stringify(draft)); else localStorage.removeItem(storage); } catch { /* private browsing */ }
  }, [storage, draft, changes.length]);
  const compute = useMutation({ mutationFn: () => api.op('library.compute', { series: view!.series.id, specs: [view!.spec.id], kinds: [...RESULT_KINDS], force: false }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['library'] }), onError: reportFailure });
  const revise = useMutation({ mutationFn: () => api.op('library.revise', { spec: view!.spec.id, version: view!.version.number,
    values: Object.fromEntries(changes.map(row => [row.key, Number(draft.values[row.key])])), note: draft.note }),
    onSuccess: () => { try { localStorage.removeItem(storage); } catch { /* private browsing */ } setDraft({ values: {}, note: '' }); setEditing(false); onVersion(undefined); void queryClient.invalidateQueries({ queryKey: ['library'] }); },
    onError: cause => setError(cause.message) });
  const open = useMutation({ mutationFn: () => api.op<ProjectView>('project.create', { name: view!.spec.name, model_id: view!.spec.id }),
    onSuccess: result => void navigate({ to: '/p/$projectId', params: { projectId: result.meta.id }, search: {} }), onError: reportFailure });
  if (!view) return <aside className="ws-properties" aria-label="属性"><p className="ws-text ws-pad">正在读取规格…</p></aside>;

  const latest = view.version.number === view.versions[0].number;
  const canEdit = latest && view.derivation.kind !== 'bundled' && view.structure.length > 0;
  const stale = latest && RESULT_KINDS.some(kind => !view.results[kind]?.current);
  const busy = compute.isPending || job.data?.state === 'running';
  const part = focus.kind === 'part' ? parts.find(item => item.role === focus.role) : undefined;
  const value = (kind: 'electrical' | 'short_circuit', suffix: string) => {
    const result = view.results[kind];
    return result?.current && !result.error ? (result.rows as ValueRow[]).find(row => row.id.endsWith(suffix))?.value ?? null : null;
  };
  const rating = view.results.rating?.current ? view.results.rating : undefined;
  const reference = (rating?.conditions as RatingCondition[] | undefined)?.[0];
  const referenceRow = (rating?.rows as RatingRow[] | undefined)?.find(row => row.id === reference?.id);
  const dimension = (key: string) => view.structure.find(item => item.key === key);
  const editableRows = (items: StructureValue[]) => items.map(item => <DimensionRow key={item.key} item={item} editing={editing && canEdit} draft={draft} onDraft={setDraft} />);
  const back = focus.kind !== 'spec' && <button type="button" className="ws-back" onClick={() => onFocus({ kind: 'spec' })}><ArrowLeft size={14} />{view.spec.key} 概要</button>;

  let body: ReactNode;
  if (focus.kind === 'part' && part) {
    const fields = view.structure.filter(item => PART_FIELDS[part.role]?.includes(item.key));
    const checks = sortChecks(partChecks(view, part.role));
    body = <>
      <div className="ws-part-head"><span className="ws-balloon-chip">{part.number}</span><div><h3>{part.name}</h3><p>{part.role === 'conductor' ? '直径' : '厚度'} {partSize(part)}{partUnit(part)}{part.shared || part.rings.length === 1 ? '' : `，${part.rings.length} 芯相同`}</p></div></div>
      <Section title="尺寸">{fields.length ? <dl className="ws-rows">{editableRows(fields)}</dl>
        : <p className="ws-text">这一层没有单独列出的尺寸：{part.role === 'filler' && view.closure ? `厚度由外径闭合推得，表列外径 ${compact(view.closure.declared_mm)} mm，各层合计 ${compact(view.closure.listed_mm)} mm，余量 ${compact(view.closure.residual_mm)} mm 计为填充与包带。` : `绘图厚度 ${partSize(part)}${partUnit(part)} 由结构推导。`}</p>}</Section>
      <Section title="标准要求" aside={<span className="ws-aside">{view.series.standards.join(' · ')}</span>}>
        {checks.length ? <div className="ws-checks">{checks.map(row => <CheckItem key={row.id} row={row} />)}</div>
          : view.results.check?.current ? <p className="ws-text">声明的执行标准对这一层没有逐项要求，或标准库尚未收录。</p> : <Unavailable result={view.results.check} onCompute={() => compute.mutate()} busy={busy} />}
      </Section>
      <Materials view={view} part={part} />
    </>;
  } else if (focus.kind === 'structure') {
    body = <>
      {parts.map(item => { const fields = view.structure.filter(field => PART_FIELDS[item.role]?.includes(field.key)); return fields.length ? <Section key={item.role} title={`${item.number}  ${item.name}`}>
        <dl className="ws-rows">{editableRows(fields)}</dl></Section> : null; })}
      {(() => { const rest = view.structure.filter(field => !parts.some(item => PART_FIELDS[item.role]?.includes(field.key))); return rest.length ? <Section title="成品"><dl className="ws-rows">{editableRows(rest)}</dl></Section> : null; })()}
      {!view.structure.length && <p className="ws-text ws-pad">{view.derivation.note}</p>}
      {view.closure && <Section title="外径闭合"><p className="ws-text">表列外径 {compact(view.closure.declared_mm)} mm，各层合计 {compact(view.closure.listed_mm)} mm，余量 {compact(view.closure.residual_mm)} mm（容差 {compact(view.closure.tolerance_mm)} mm）。{view.derivation.note}</p></Section>}
    </>;
  } else if (focus.kind === 'analysis' && focus.id === 'check') {
    body = <Checks view={view} parts={parts} onFocus={onFocus} onCompute={() => compute.mutate()} busy={busy} />;
  } else if (focus.kind === 'analysis' && (focus.id === 'electrical' || focus.id === 'short_circuit')) {
    body = <Values result={view.results[focus.id]} title={focus.id === 'electrical' ? '电气参数' : '短路容量'} onCompute={() => compute.mutate()} busy={busy} />;
  } else if (focus.kind === 'analysis' && focus.id === 'rating') {
    body = <Ratings result={view.results.rating} onCompute={() => compute.mutate()} busy={busy} />;
  } else if (focus.kind === 'documents') {
    body = <Documents view={view} />;
  } else if (focus.kind === 'history') {
    body = <History view={view} onVersion={onVersion} />;
  } else {
    const ac = value('electrical', ':ac');
    const short = value('short_circuit', ':conductor-adiabatic');
    body = <>
      <Section title="关键参数">
        <dl className="ws-rows ws-key-values">
          <Row label="外径"><span className="ws-value">{(view.entry.summary.outer_diameter_m * 1000).toFixed(1)}</span><span className="ws-unit">mm</span>{view.closure && <span className="ws-note-inline">表列 {compact(view.closure.declared_mm)}</span>}</Row>
          <Row label="导体截面" origin={dimension('area')?.origin}><span className="ws-value">{compact(view.spec.area_mm2)}</span><span className="ws-unit">mm²</span></Row>
          {dimension('conductor_diameter') && <Row label="导体外径" origin={dimension('conductor_diameter')!.origin}><span className="ws-value">{compact(dimension('conductor_diameter')!.value)}</span><span className="ws-unit">mm</span></Row>}
          {view.entry.summary.r20_ohm_m != null && <Row label="R20" origin={dimension('r20')?.origin}><span className="ws-value">{compact(view.entry.summary.r20_ohm_m * 1000, 4)}</span><span className="ws-unit">Ω/km</span></Row>}
          {dimension('weight') && <Row label="重量" origin={dimension('weight')!.origin}><span className="ws-value">{compact(dimension('weight')!.value, 6)}</span><span className="ws-unit">kg/km</span></Row>}
          <Row label="交流电阻 90 °C">{ac !== null ? <><span className="ws-value">{compact(ac * 1000, 4)}</span><span className="ws-unit">Ω/km</span></> : <span className="ws-faint">未计算</span>}</Row>
          <Row label="短路电流 1 s">{short !== null ? <><span className="ws-value">{(short / 1000).toFixed(2)}</span><span className="ws-unit">kA</span></> : <span className="ws-faint">未计算</span>}</Row>
          <Row label="载流量" hint={reference ? `直埋 ${reference.depth_m} m · ${reference.soil_thermal_resistivity} K·m/W · ${reference.ambient_temperature_c} °C` : undefined}>
            {referenceRow?.ampacity_a != null ? <><span className="ws-value">{referenceRow.ampacity_a.toFixed(1)}</span><span className="ws-unit">A</span>
              <span className="ws-note-inline">直埋 {reference!.depth_m} m · {reference!.soil_thermal_resistivity} K·m/W · {reference!.ambient_temperature_c} °C</span></>
              : rating ? <span className="ws-fail-text" title={referenceRow?.error?.message}>拒算</span> : <span className="ws-faint">未计算</span>}</Row>
        </dl>
      </Section>
      <Section title="分析">
        <div className="ws-analyses">{ANALYSES.map(item => { const state = analysisState(view, item.id); return <button key={item.id} type="button" className="ws-analysis" onClick={() => onFocus({ kind: 'analysis', id: item.id })}>
          <span>{item.label}</span><span className="ws-tree-state" data-state={state.state}>{state.text}</span><ChevronRight size={15} /></button>; })}</div>
      </Section>
      {view.warnings.length > 0 && <Section title="资料提示">{view.warnings.map(issue => <div key={issue.code + issue.message} className="ws-notice" data-tone="warn"><p>{issue.message}</p></div>)}</Section>}
      <Section title="来源">
        <p className="ws-text">{STATE_NAMES[view.series.origin] ?? view.series.origin}。{view.derivation.note}</p>
        <details className="ws-basis"><summary>完整来源说明</summary><p>{view.entry.source}</p><p className="ws-hash">内容 SHA-256 {view.version.content_sha256}</p></details>
      </Section>
    </>;
  }

  return <aside className="ws-properties" aria-label="属性">
    <header className="ws-properties-head">
      <div className="ws-properties-title"><h2>{view.spec.key}<span className="ws-unit">mm²</span></h2>
        <span className="ws-pill" data-tone={reviewTone(view.version.review)}>{REVIEW_NAMES[view.version.review]}</span></div>
      <div className="ws-properties-meta">
        <select className="ws-select" aria-label="查看规格版本" value={view.version.number} onChange={event => onVersion(Number(event.target.value) === view.versions[0].number ? undefined : Number(event.target.value))}>
          {view.versions.map(item => <option key={item.id} value={item.number}>第 {item.number} 版 · {REVIEW_NAMES[item.review]}</option>)}</select>
      </div>
      <div className="ws-properties-actions">
        {stale && <button type="button" className="ws-button" data-variant="primary" disabled={busy} onClick={() => compute.mutate()}><Play size={14} />计算这个规格</button>}
        {canEdit && <button type="button" className="ws-button" aria-pressed={editing} onClick={() => { setEditing(!editing); if (!editing && focus.kind !== 'part') onFocus({ kind: 'structure' }); }}><PencilLine size={14} />{editing ? '结束修改' : '修改结构'}</button>}
        <button type="button" className="ws-button" aria-pressed={focus.kind === 'documents'} onClick={() => onFocus({ kind: 'documents' })}><FileDown size={14} />规格书</button>
        <Menu position="bottom-end" withinPortal classNames={{ dropdown: 'ws ws-menu' }}>
          <Menu.Target><button type="button" className="ws-icon-button" aria-label="更多操作" title="更多操作"><Ellipsis size={16} /></button></Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<HistoryIcon size={14} />} onClick={() => onFocus({ kind: 'history' })}>版本记录（{view.versions.length} 版）</Menu.Item>
            <Menu.Item leftSection={<SquareArrowOutUpRight size={14} />} disabled={!latest || open.isPending} onClick={() => open.mutate()}>在断面工作台按敷设条件细算</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
      {!latest && <div className="ws-notice" data-tone="warn"><p>正在查看第 {view.version.number} 版（历史）。修改请回到最新版。</p><button type="button" className="ws-link" onClick={() => onVersion(undefined)}>回到第 {view.versions[0].number} 版</button></div>}
    </header>
    <div className="ws-properties-body">{back}{body}</div>
    {editing && canEdit && <form className="ws-draft" onSubmit={event => { event.preventDefault(); setError(''); revise.mutate(); }}>
      <div className="ws-draft-head"><b>{changes.length ? `已改 ${changes.length} 项，保存为第 ${view.version.number + 1} 版草稿` : '在尺寸里直接改数值'}</b>
        {changes.length > 0 && <span>{changes.map(row => `${row.label} ${compact(row.value)} → ${draft.values[row.key]}`).join('；')}</span>}</div>
      <textarea className="ws-input" aria-label="修改原因" placeholder="修改原因（必填）" required maxLength={400} rows={2} value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} />
      {error && <p role="alert" className="ws-error-text">{error}</p>}
      <div className="ws-draft-actions"><button type="submit" className="ws-button" data-variant="primary" disabled={!changes.length || revise.isPending || changes.some(row => !(Number(draft.values[row.key]) > 0))}>保存新版本</button>
        <button type="button" className="ws-button" data-variant="ghost" onClick={() => { setDraft({ values: {}, note: '' }); setEditing(false); setError(''); }}>放弃修改</button></div>
    </form>}
  </aside>;
}
