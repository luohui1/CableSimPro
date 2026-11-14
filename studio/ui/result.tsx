// The result page reads in one order: the answer, where it shows on the section,
// why it is this number, and then the detail, the checks and the method behind it.
import { Download, ExternalLink, FileText, Play } from 'lucide-react';
import { useState } from 'react';
import { compact, fixed, KIND_NAMES, LEVEL_NAMES } from '../shared/format.ts';
import type { CableState, DomainDocument, Issue, MethodCard, RunRecord, Tier } from '../shared/types.ts';
import { Badge, Button, Facts, Group, Notice, Tabs, TierBadge } from './components.tsx';
import { cableLabel, HeatPath, LoadBar, LossBar, SectionDrawing, SweepChart, TemperatureScale } from './drawing.tsx';
import type { Step, Studio } from './studio.ts';

export function stepOf(path: string | undefined): Step {
  if (!path) return 'installation';
  if (path.startsWith('/conditions')) return 'conditions';
  if (path.startsWith('/parameters')) return 'method';
  if (path.startsWith('/cable')) return 'cable';
  return 'installation';
}

export function IssueNotice({ issue, studio, title }: { issue: Issue; studio: Studio; title: string }) {
  const step = stepOf(issue.path);
  const names: Record<Step, string> = { cable: '型号', installation: '敷设', conditions: '工况', method: '方法', result: '结果', report: '计算书' };
  return <Notice tone="bad" title={title} action={studio.route.step === step ? undefined
    : <Button onClick={() => studio.navigate({ step })}>去{names[step]}修改</Button>}>{issue.message}</Notice>;
}

export function TierPanel({ tier }: { tier: Tier }) {
  return <div className="tier-panel"><div className="tier-head"><TierBadge tier={tier} /><span>{tier.meaning}</span></div>
    <ul className="bullets">{tier.basis.map(item => <li key={item}>{item}</li>)}</ul></div>;
}

export function MethodCardView({ card }: { card: MethodCard }) {
  return <div className="card-body">
    <Facts rows={[['方法', card.method], ['方法族', card.family], ['插件', card.plugin], ['方法版本', card.method_version], ['验证等级', LEVEL_NAMES[card.validation.level] ?? card.validation.level]]} />
    <p className="prose">{card.summary}</p>
    <h4 className="subhead">本敷设形式的验证依据</h4><TierPanel tier={card.tier} />
    <Group title="方法的全部验证算例" summary={`${card.validation.cases.length} 项`} defaultOpen={false}><ul className="bullets">{card.validation.cases.map(item => <li key={item}>{item}</li>)}</ul></Group>
    <Group title="依据标准" summary={`${card.standards.length} 条`} defaultOpen={false}><ul className="bullets">{card.standards.map(item => <li key={item}>{item}</li>)}</ul></Group>
    <Group title="假设与取舍" summary={`${card.assumptions.length} 条`} defaultOpen={false}><ul className="bullets">{card.assumptions.map(item => <li key={item}>{item}</li>)}</ul></Group>
    <Group title="适用范围与限制" summary={`${card.scope.length} 条`} defaultOpen={false}><ul className="bullets">{card.scope.map(item => <li key={item}>{item}</li>)}</ul></Group>
  </div>;
}

function StateTable({ states, document, selected, onSelect }: { states: CableState[]; document: DomainDocument; selected?: string | null; onSelect: (id: string) => void }) {
  const threeCore = states.some(state => state.thermal_k_m_w.t2 !== undefined);
  const ducted = states.some(state => state.thermal_k_m_w.t4_wall > 0);
  const row = (state: CableState, cells: (string | undefined)[]) => <tr key={state.id} className={selected === state.id ? 'is-selected' : ''} onClick={() => onSelect(state.id)}>
    <td>{cableLabel(state.id, document)}</td>{cells.filter(cell => cell !== undefined).map((cell, index) => <td key={index} className="n">{cell}</td>)}</tr>;
  const head = (cells: (string | undefined)[]) => <thead><tr><th>电缆</th>{cells.filter(cell => cell !== undefined).map(cell => <th key={cell} className="n">{cell}</th>)}</tr></thead>;
  return <>
    <h4 className="subhead">温度</h4>
    <table className="grid">{head(['电流 A', '导体 °C', '温限 °C', '余量 K', '金属套 °C', '表面 °C'])}
      <tbody>{states.map(state => row(state, [fixed(state.current_a), fixed(state.conductor_c, 2), fixed(state.limit_c, 0), fixed(state.margin_k, 2),
        fixed(state.sheath_c, 2), fixed(state.surface_c, 2)]))}</tbody></table>
    <h4 className="subhead">损耗 W/m</h4>
    <table className="grid">{head(['导体', '护套', threeCore ? '铠装' : undefined, '介质', '合计', 'λ1', '交流电阻 Ω/km'])}
      <tbody>{states.map(state => row(state, [fixed(state.losses_w_m.conductor, 3), fixed(state.losses_w_m.sheath, 3),
        threeCore ? fixed(state.losses_w_m.armour, 3) : undefined, fixed(state.losses_w_m.dielectric, 3), fixed(state.losses_w_m.total, 3),
        fixed(state.lambda1, 4), compact(state.ac_resistance_ohm_m * 1000, 5)]))}</tbody></table>
    <h4 className="subhead">热阻 K·m/W</h4>
    <table className="grid">{head(['T1 绝缘', threeCore ? 'T2 内衬' : undefined, 'T3 外护套', ducted ? 'T4 管内空气' : undefined, ducted ? 'T4 管壁' : undefined, 'T4 土壤', '互热温升 K'])}
      <tbody>{states.map(state => row(state, [fixed(state.thermal_k_m_w.t1, 4), threeCore ? fixed(state.thermal_k_m_w.t2, 4) : undefined,
        fixed(state.thermal_k_m_w.t3, 4), ducted ? fixed(state.thermal_k_m_w.t4_air, 4) : undefined, ducted ? fixed(state.thermal_k_m_w.t4_wall, 4) : undefined,
        fixed(state.thermal_k_m_w.t4_soil, 4), fixed(state.mutual_rise_k, 2)]))}</tbody></table>
  </>;
}

function RatingResult({ record, studio }: { record: RunRecord; studio: Studio }) {
  const summary = record.summary!;
  const [condition, setCondition] = useState<'rated' | 'operating'>('rated');
  if (summary.status !== 'succeeded' || !record.document || !summary.ampacity) {
    return <IssueNotice issue={summary.error ?? { code: 'NO_RATING', message: '没有算出允许电流。' }} studio={studio} title="方法没有给出结果" />;
  }
  const document = record.document;
  const operating = summary.operating?.cables ?? [];
  const rated = summary.rated?.cables ?? [];
  const ambient = summary.ambient_c ?? 0;
  const limiting = summary.ampacity.limiting_cable;
  const hottest = operating.find(cable => cable.id === summary.operating?.hottest_cable);
  const load = summary.circuits?.find(circuit => circuit.id === summary.ampacity!.limiting_circuit)?.load_a;
  const states = condition === 'rated' ? rated : operating;
  const focusId = studio.selection?.kind === 'cable' ? studio.selection.id : limiting;
  const focus = states.find(cable => cable.id === focusId) ?? states[0];
  const select = (id: string | null) => studio.setSelection(id ? { kind: 'cable', id } : null);
  const verification = summary.verification;
  return <>
    <section className="verdict">
      <div className="verdict-main">
        <div className="verdict-label">允许电流</div>
        <div className="verdict-value">{fixed(summary.ampacity.value_a)}<span>A</span></div>
        <div className="chips"><TierBadge tier={record.method_card?.tier} /><Badge title={summary.ampacity.meaning}>{summary.ampacity.basis_name}</Badge>
          <Badge tone="bad">先到温限：{cableLabel(limiting, document)}</Badge></div>
      </div>
      {load !== undefined && <div className="verdict-check">
        <div className="check-head"><span>负荷</span><strong>{fixed(load, 0)} A</strong>
          <Badge tone={load <= summary.ampacity.value_a ? 'ok' : 'bad'}>{load <= summary.ampacity.value_a ? `余量 ${fixed(summary.ampacity.value_a - load)} A` : `超出 ${fixed(load - summary.ampacity.value_a)} A`}</Badge></div>
        <LoadBar load={load} ampacity={summary.ampacity.value_a} />
      </div>}
      {summary.operating?.error && <div className="verdict-check">
        <div className="check-head"><span>保存负荷下</span><Badge tone="bad">没有稳态解</Badge></div><p className="prose">{summary.operating.error.message}</p>
      </div>}
      {hottest && <div className="verdict-check">
        <div className="check-head"><span>负荷下最热导体</span><strong>{fixed(hottest.conductor_c)} °C</strong>
          <Badge tone={hottest.margin_k >= 0 ? 'ok' : 'bad'}>{hottest.margin_k >= 0 ? `低于温限 ${fixed(hottest.margin_k)} K` : `超温 ${fixed(-hottest.margin_k)} K`}</Badge></div>
        <TemperatureScale value={hottest.conductor_c} ambient={ambient} limit={hottest.limit_c} />
      </div>}
    </section>
    <section className="panel panel-canvas">
      <header className="panel-head"><h3>保存负荷下的导体温度</h3></header>
      <SectionDrawing document={document} states={operating} ambient={ambient} limiting={limiting}
        selected={studio.selection?.kind === 'cable' ? studio.selection.id : null} onSelect={select} focus="group"
        facts={<div className="ramp"><div className="ramp-bar" /><div className="ramp-ends"><span>环境 {fixed(ambient, 0)} °C</span><span>温限 {fixed(operating[0]?.limit_c ?? 90, 0)} °C</span></div></div>} />
    </section>
    <Group title="为什么是这个数" action={<Tabs value={condition} onChange={setCondition}
      options={[{ value: 'rated', label: '额定工况' }, { value: 'operating', label: '保存负荷' }]} />}>
      {focus ? <>
        <div className="why-head"><strong>{cableLabel(focus.id, document)}</strong><span>{fixed(focus.current_a)} A</span>
          {focus.id === limiting && <Badge tone="bad">限制电缆</Badge>}</div>
        <h4 className="subhead">热路：热量从导体到环境</h4><HeatPath state={focus} ambient={ambient} />
        <h4 className="subhead">损耗构成 · 合计 {fixed(focus.losses_w_m.total, 2)} W/m</h4><LossBar state={focus} />
      </> : <p className="prose">这个工况没有电缆状态。</p>}
    </Group>
    <Group title="明细" summary={`${states.length} 根电缆`} defaultOpen={false}>
      <StateTable states={states} document={document} selected={studio.selection?.id} onSelect={select} />
      <h4 className="subhead">各回路</h4>
      <table className="grid"><thead><tr><th>回路</th><th className="n">允许电流 A</th><th className="n">保存负荷 A</th><th className="n">余量 A</th><th>限制电缆</th></tr></thead>
        <tbody>{summary.circuits?.map(circuit => <tr key={circuit.id}><td>{circuit.label}</td>
          <td className="n">{circuit.ampacity_a === null ? circuit.error?.message : fixed(circuit.ampacity_a)}</td><td className="n">{fixed(circuit.load_a)}</td>
          <td className="n">{fixed(circuit.margin_a)}</td><td>{circuit.limiting_cable ? cableLabel(circuit.limiting_cable, document) : '—'}</td></tr>)}</tbody></table>
    </Group>
    {verification && <Group title="核对" summary={<Badge tone={verification.passed ? 'ok' : 'bad'}>{verification.passed ? `通过 · ${verification.rows.length} 项` : '未通过'}</Badge>} defaultOpen={false}>
      <p className="prose">{verification.basis}</p>
      <div className="table-scroll"><table className="grid"><thead><tr><th>对象</th><th>核对项</th><th className="n">计算值</th><th className="n">核对值</th><th className="n">差值</th><th>单位</th><th>结论</th></tr></thead>
        <tbody>{verification.rows.map((row, index) => <tr key={index}><td>{cableLabel(row.entity, document)}</td><td>{row.item}</td>
          <td className="n">{compact(row.computed, 8)}</td><td className="n">{compact(row.reference, 8)}</td><td className="n">{row.difference.toExponential(1)}</td>
          <td>{row.unit}</td><td>{row.passed ? '通过' : '未通过'}</td></tr>)}</tbody></table></div>
    </Group>}
    {record.method_card && <Group title="方法与验证" summary={<TierBadge tier={record.method_card.tier} />} defaultOpen={false}><MethodCardView card={record.method_card} /></Group>}
    {!!summary.warnings?.length && <Group title="运行提示" summary={`${summary.warnings.length} 条`} defaultOpen={false}>
      <ul className="bullets">{summary.warnings.map(warning => <li key={warning.message}>{warning.message}</li>)}</ul></Group>}
  </>;
}

function SweepResult({ record }: { record: RunRecord }) {
  const sweep = record.sweep!;
  const valid = sweep.points.filter(point => typeof point.ampacity_a === 'number');
  const [low, high] = [Math.min(...valid.map(point => point.ampacity_a!)), Math.max(...valid.map(point => point.ampacity_a!))];
  return <>
    <section className="verdict">
      <div className="verdict-main">
        <div className="verdict-label">允许电流范围</div>
        <div className="verdict-value">{valid.length ? `${fixed(low)} – ${fixed(high)}` : '未算出'}<span>A</span></div>
        <div className="chips"><TierBadge tier={record.method_card?.tier} /><Badge>{sweep.label} {compact(sweep.points[0].value)} – {compact(sweep.points.at(-1)!.value)} {sweep.unit}</Badge>
          <Badge>{sweep.points.length} 个点</Badge></div>
      </div>
    </section>
    <section className="panel"><header className="panel-head"><h3>允许电流随{sweep.label}的变化</h3></header><SweepChart points={sweep.points} label={sweep.label} unit={sweep.unit} /></section>
    <Group title="各点数值">
      <table className="grid"><thead><tr><th className="n">{sweep.label} {sweep.unit}</th><th className="n">允许电流 A</th><th className="n">保存负荷下最热导体 °C</th><th>说明</th></tr></thead>
        <tbody>{sweep.points.map(point => <tr key={point.case_id}><td className="n">{compact(point.value)}</td><td className="n">{fixed(point.ampacity_a)}</td>
          <td className="n">{point.operating_error ? '无稳态解' : fixed(point.hottest_conductor_c, 2)}</td>
          <td>{point.error?.message ?? point.operating_error?.message ?? (point.within_limit === false ? '保存负荷超过温限' : '')}</td></tr>)}</tbody></table>
    </Group>
    {record.method_card && <Group title="方法与验证" summary={<TierBadge tier={record.method_card.tier} />} defaultOpen={false}><MethodCardView card={record.method_card} /></Group>}
  </>;
}

function SelectionResult({ record, studio }: { record: RunRecord; studio: Studio }) {
  const selection = record.selection!;
  const chosen = selection.candidates.find(row => row.model_id === selection.chosen);
  const [problem, setProblem] = useState('');
  const adopted = chosen && studio.view?.parts.cable.id === chosen.model_id;
  return <>
    <section className="verdict">
      <div className="verdict-main">
        <div className="verdict-label">目标 {compact(selection.target_current_a)} A 的选型结果</div>
        <div className="verdict-value verdict-text">{chosen ? chosen.name : '没有满足的型号'}</div>
        <div className="chips">{chosen && <><TierBadge tier={chosen.tier} /><Badge tone="ok">允许 {fixed(chosen.ampacity_a)} A · 余量 {fixed(chosen.margin_a)} A</Badge></>}
          <Badge>{selection.candidates.length} 个候选</Badge></div>
      </div>
      {chosen && <div className="verdict-check">
        <div className="check-head"><span>选型规则</span></div><p className="prose">{selection.rule}</p>
        {adopted ? <Badge tone="ok">工程已采用这个型号</Badge>
          : <Button variant="primary" onClick={() => studio.write('cable.set', { model_id: chosen.model_id }).then(() => studio.navigate({ step: 'cable' }), error => setProblem(error.message))}>采用选定型号</Button>}
        {problem && <div className="field-note" role="alert">{problem}</div>}
      </div>}
    </section>
    {!chosen && selection.reason && <Notice tone="warn" title="没有选出型号">{selection.reason}</Notice>}
    <Group title="候选对比">
      <div className="table-scroll"><table className="grid"><thead><tr><th>型号</th><th className="n">截面 mm²</th><th className="n">允许电流 A</th><th className="n">余量 A</th><th className="n">目标电流下导体 °C</th><th>结论</th></tr></thead>
        <tbody>{selection.candidates.map(row => <tr key={row.model_id} className={row.model_id === selection.chosen ? 'is-chosen' : ''}>
          <td>{row.name}</td><td className="n">{compact(row.area_mm2)}</td><td className="n">{fixed(row.ampacity_a)}</td><td className="n">{fixed(row.margin_a)}</td>
          <td className="n">{row.conductor_at_target_c !== undefined && row.conductor_at_target_c !== null ? fixed(row.conductor_at_target_c) : row.at_target_error ? '无稳态解' : '—'}</td>
          <td>{row.error ? row.error.message : row.model_id === selection.chosen ? <Badge tone="ok">选定</Badge> : row.meets_target ? '满足' : '不满足'}</td></tr>)}</tbody></table></div>
    </Group>
    {record.method_card && <Group title="方法与验证" summary={<TierBadge tier={record.method_card.tier} />} defaultOpen={false}><MethodCardView card={record.method_card} /></Group>}
  </>;
}

export function ResultView({ studio }: { studio: Studio }) {
  const header = studio.runs.find(run => run.id === studio.runId);
  if (!header) {
    return <div className="page"><header className="page-head"><h2>结果</h2></header>
      <Notice title="还没有运行记录" action={<Button variant="primary" icon={<Play size={16} />} disabled={!!studio.busy || !!studio.view?.issue}
        onClick={() => studio.run('run.rate')}>运行校核</Button>}>运行后，允许电流、各电缆温度和它们的依据会显示在这里。</Notice></div>;
  }
  const record = studio.record;
  const stale = header.inputs_sha256 !== studio.view?.inputs_sha256;
  return <div className="page">
    <header className="page-head">
      <h2>#{header.sequence} {KIND_NAMES[header.kind]}</h2>
      {stale && <Badge tone="warn">输入已变，这是之前的结果</Badge>}
      <div className="page-actions">
        {stale && header.kind === 'rating' && <Button icon={<Play size={16} />} disabled={!!studio.busy} onClick={() => studio.run('run.rate')}>按当前输入重新运行</Button>}
        {studio.currentRating?.id !== header.id && <Button icon={<FileText size={16} />} disabled={!!studio.busy}
          onClick={() => header.report ? studio.navigate({ step: 'report', run: header.id }) : studio.exportReport(header.id)}>
          {header.report ? '查看计算书' : '导出计算书'}</Button>}
      </div>
    </header>
    {!record ? <p className="prose">正在读取记录…</p>
      : record.kind === 'rating' ? <RatingResult record={record} studio={studio} />
        : record.kind === 'sweep' ? <SweepResult record={record} /> : <SelectionResult record={record} studio={studio} />}
  </div>;
}

export function ReportView({ studio }: { studio: Studio }) {
  const header = studio.runs.find(run => run.id === studio.runId);
  const project = studio.view!.meta.id;
  if (!header) return <div className="page"><header className="page-head"><h2>计算书</h2></header><Notice title="还没有运行记录">计算书由运行记录生成，先运行一次校核。</Notice></div>;
  const url = `/api/projects/${project}/reports/${header.id}`;
  return <div className="page page-fill">
    <header className="page-head">
      <h2>计算书 · #{header.sequence} {header.title}</h2>
      <div className="page-actions">
        {header.report && <>
          <a className="btn btn-default" href={url} target="_blank" rel="noreferrer"><ExternalLink size={16} /><span>新窗口打开并打印</span></a>
          <a className="btn btn-default" href={url + '?download'}><Download size={16} /><span>下载 HTML</span></a>
        </>}
        <Button variant={header.report ? 'default' : 'primary'} icon={<FileText size={16} />} disabled={!!studio.busy} onClick={() => studio.exportReport(header.id)}>
          {header.report ? '重新导出' : '导出计算书'}</Button>
      </div>
    </header>
    {header.report ? <iframe key={header.id + studio.view!.meta.revision} className="report-frame" title="计算书预览" src={url} />
      : <Notice title="这条记录还没有导出计算书">导出后在这里预览。计算书是一个可打印的 HTML 文件，保存在工程文件夹的 reports 目录；用浏览器打印可另存为 PDF。</Notice>}
  </div>;
}
