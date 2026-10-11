import { useState } from 'react';
import { optionalRecord, numeric, text } from '@/api/client';
import { EmptyState } from './states';
import { Select } from './ui/select';
import { displayName } from '@/lib/display-names';
import { savedDomain, entityLabel } from '@/lib/domain-fields';
import { readableEvidence } from './study-workbench-config';
import { StudyDetailGroup } from './study-detail-group';

type Row = Record<string, unknown>;
const K = 273.15;
const TRACE = 'x-cablesim.iec60287-trace';

/** 从一次运行的某个工况里读出“运行工况”下的逐电缆物理量。只读插件已给出的值，缺失就显示“—”。 */
function operating(caseRow: Row) {
  const values = new Map<string, number>();
  for (const item of Array.isArray(caseRow.results) ? caseRow.results : []) {
    const r = optionalRecord(item);
    if (text(r.case) !== 'operating' || text(r.status) === 'unavailable') continue;
    const v = numeric(r.value);
    if (v !== null) values.set(`${text(r.key)}|${text(r.entity)}`, v);
  }
  return values;
}

/** 电缆实体按回路顺序命名为「回路 n」；单回路多根时加序号。 */
function cableNames(run: Row, caseId: string) {
  const snapshotCase = (Array.isArray(optionalRecord(run.snapshot).cases) ? optionalRecord(run.snapshot).cases as unknown[] : []).map(optionalRecord).find(c => text(c.case_id) === caseId);
  // 运行详情默认不带工况输入；回退到快照里保存的工作区模型（回路与电缆身份相同）
  const input = optionalRecord(snapshotCase?.input ?? savedDomain(run));
  const circuits = Array.isArray(input.circuits) ? input.circuits as unknown[] : [];
  const names = new Map<string, string>();
  circuits.map(optionalRecord).forEach(circuit => {
    const cables = (Array.isArray(circuit.cables) ? circuit.cables : []).map(optionalRecord);
    cables.forEach(cable => names.set(text(cable.id), entityLabel(input, text(cable.id))));
  });
  return names;
}

const fmt = (v: number | undefined, digits = 1) => (v === undefined ? '—' : v.toFixed(digits));

/**
 * 结果详情：损耗构成、IEC 60287 热路、回路间互热温升、计算口径。
 * 全部数值来自插件运行轨迹（x-cablesim.iec60287-trace）与结果；不在前端重算。
 */
export function StudyHeatDetail({ run, cases, initialCase }: { run?: Row; cases: { id: string; label: string }[]; initialCase?: string }) {
  const output = optionalRecord(run?.output);
  const runCases = (Array.isArray(output.cases) ? output.cases : []).map(optionalRecord);
  const options = cases.length ? cases : runCases.map(c => ({ id: text(c.case_id), label: text(c.case_id) }));
  const [caseId, setCaseId] = useState(initialCase || options[0]?.id || '');
  const [cable, setCable] = useState('');
  const current = runCases.find(c => text(c.case_id) === caseId);
  if (!run) return <EmptyState title="尚无运行" description="运行后在这里查看损耗、热路与互热。" />;
  const trace = optionalRecord(optionalRecord(current?.artifacts)[TRACE]);
  if (!current || !Object.keys(trace).length) return <EmptyState title="此工况没有计算轨迹" description="所用方法未输出 IEC 60287 计算轨迹，无法展示热路详情。" />;

  const values = operating(current);
  const names = cableNames(run, caseId);
  const cables = [...new Set([...values.keys()].filter(k => k.startsWith('conductor_temperature|')).map(k => k.split('|')[1]))];
  const hottest = cables.reduce((best, id) => ((values.get(`conductor_temperature|${id}`) ?? -Infinity) > (values.get(`conductor_temperature|${best}`) ?? -Infinity) ? id : best), cables[0]);
  const focus = cable && cables.includes(cable) ? cable : hottest;
  const v = (key: string) => values.get(`${key}|${focus}`);
  const losses = [
    ['导体', v('losses.conductor')], ['金属屏蔽', v('losses.sheath')], ['铠装', v('x-cablesim.iec60287.losses.armour')], ['介质', v('losses.dielectric')],
  ] as const;
  const total = v('losses.total');
  const ladder = [
    ['T1 绝缘', v('thermal_resistance.insulation')], ['T2 内衬', v('x-cablesim.iec60287.thermal_resistance.bedding')], ['T3 外护套', v('thermal_resistance.oversheath')],
    ['T4′ 管内空气', v('x-cablesim.iec60287.thermal_resistance.duct_air')], ['T4″ 管壁', v('x-cablesim.iec60287.thermal_resistance.duct_wall')], ['T4‴ 外部', v('thermal_resistance.external')],
  ] as const;
  const heat = new Map<string, number>();
  for (const item of Array.isArray(trace.heat_contributions) ? trace.heat_contributions : []) {
    const h = optionalRecord(item);
    const rise = numeric(h.temperature_rise_k);
    if (rise !== null) heat.set(`${text(h.source)}|${text(h.target)}`, rise);
  }
  const evidence = optionalRecord(current.evidence);
  const sources = (Array.isArray(trace.sources) ? trace.sources : []).map(text).filter(Boolean).map(readableEvidence);
  const name = (id: string) => names.get(id) || id.replace(/^cable\//, '');

  return <div className="heat-detail">
    <div className="heat-detail-bar">
      {options.length > 1 && <Select label="候选" value={caseId} options={options.map(o => ({ value: o.id, label: o.label }))} onChange={value => { setCaseId(value); setCable(''); }} />}
      {cables.length > 1 && <Select label="电缆" value={focus} options={cables.map(id => ({ value: id, label: name(id) + (id === hottest ? '（最热）' : '') }))} onChange={setCable} />}
    </div>
    <header className="heat-detail-head">
      <div>
        <span className="muted">{name(focus)} · 运行负荷 {fmt(v('x-cablesim.iec60287.current'))} A</span>
        <h2>导体 {fmt(v('conductor_temperature') === undefined ? undefined : v('conductor_temperature')! - K)} °C</h2>
      </div>
      <dl className="heat-detail-temps">
        <div><dt>护套</dt><dd>{fmt(v('sheath_temperature') === undefined ? undefined : v('sheath_temperature')! - K)} °C</dd></div>
        <div><dt>表面</dt><dd>{fmt(v('surface_temperature') === undefined ? undefined : v('surface_temperature')! - K)} °C</dd></div>
        <div><dt>总损耗</dt><dd>{fmt(total, 2)} W/m</dd></div>
        <div><dt>互热温升</dt><dd>{fmt(v('x-cablesim.iec60287.temperature_rise.mutual'))} K</dd></div>
      </dl>
    </header>

    <StudyDetailGroup id="heat:losses" title="损耗构成"><section className="heat-section" aria-label="损耗构成">
      <h3>损耗构成</h3>
      {losses.map(([label, value]) => <div key={label} className="loss-row">
        <span>{label}</span><progress className="native-progress loss-bar" value={value ?? 0} max={total || 1} aria-label={label} /><span className="numeric">{fmt(value, 2)} W/m</span>
      </div>)}
    </section></StudyDetailGroup>

    <StudyDetailGroup id="heat:ladder" title="热路 · K·m/W"><section className="heat-section" aria-label="热路">
      <h3>热路 <span className="muted">K·m/W</span></h3>
      <ol className="thermal-ladder">
        <li className="ladder-end is-hot">导体<b>{fmt(v('conductor_temperature') === undefined ? undefined : v('conductor_temperature')! - K)} °C</b></li>
        {ladder.map(([label, value]) => value === undefined || value === 0 ? null : <li key={label}><b className="numeric">{value.toFixed(3)}</b><span>{label}</span></li>)}
        <li className="ladder-end">环境<b>互热 {fmt(v('x-cablesim.iec60287.temperature_rise.mutual'))} K</b></li>
      </ol>
    </section></StudyDetailGroup>

    {cables.length > 1 && <StudyDetailGroup id="heat:mutual" title="回路间互热温升 · K"><section className="heat-section" aria-label="回路间互热温升">
      <h3>回路间互热温升 <span className="muted">热源 → 受热，K</span></h3>
      <div className="table-scroll"><table className="data-table heat-matrix">
        <thead><tr><th>热源</th>{cables.map(t => <th key={t} className="numeric">{name(t)}</th>)}</tr></thead>
        <tbody>{cables.map(s => <tr key={s}><th scope="row">{name(s)}</th>{cables.map(t => <td key={t} className={`numeric${s === t ? ' is-self' : ''}`}>{fmt(heat.get(`${s}|${t}`))}</td>)}</tr>)}</tbody>
      </table></div>
    </section></StudyDetailGroup>}

    <StudyDetailGroup id="heat:basis" title="计算口径与来源"><section className="heat-section heat-basis" aria-label="计算口径">
      <h3>计算口径</h3>
      <dl>
        <div><dt>迭代</dt><dd>{numeric(evidence.iterations) ?? '—'} 次</dd></div>
        <div><dt>热平衡残差</dt><dd>{numeric(evidence.residual_k) === null ? '—' : numeric(evidence.residual_k)! < 0.001 ? '< 0.001' : numeric(evidence.residual_k)!.toFixed(3)} K</dd></div>
        <div><dt>交流电阻</dt><dd>{v('ac_resistance') === undefined ? '—' : (v('ac_resistance')! * 1e3).toFixed(4)} Ω/km</dd></div>
        <div><dt>方法</dt><dd>{displayName(text(output.plugin_id))} {text(output.plugin_version)}</dd></div>
      </dl>
      {!!sources.length && <ul className="heat-sources">{sources.map(s => <li key={s}>{s}</li>)}</ul>}
    </section></StudyDetailGroup>
  </div>;
}
