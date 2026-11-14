// Dialogs for the few actions that need more than one value before they can start.
import { useMemo, useState } from 'react';
import { compact, STATE_NAMES } from '../shared/format.ts';
import type { LibraryEntry } from '../shared/types.ts';
import { Badge, Button, Dialog, NumberField, SelectField } from './components.tsx';
import type { Studio } from './studio.ts';

function LibraryTable({ entries, value, onPick, multiple }: {
  entries: LibraryEntry[]; value: string[]; onPick: (id: string) => void; multiple?: boolean;
}) {
  const families = [...new Set(entries.map(entry => entry.family))];
  return <div className="library">{families.map(family => <section key={family}>
    <h3>{family}</h3>
    <table className="grid"><thead><tr><th>{multiple ? '候选' : ''}</th><th>型号</th><th className="n">截面 mm²</th><th className="n">外径 mm</th><th className="n">R20 Ω/km</th><th>数据状态</th></tr></thead>
      <tbody>{entries.filter(entry => entry.family === family).map(entry => {
        const picked = value.includes(entry.id);
        return <tr key={entry.id} className={picked ? 'is-selected' : ''} onClick={() => onPick(entry.id)}>
          <td><input type={multiple ? 'checkbox' : 'radio'} checked={picked} readOnly aria-label={entry.name} /></td>
          <td>{entry.name}</td><td className="n">{entry.summary.cores > 1 ? `${entry.summary.cores}×` : ''}{compact(entry.summary.area_mm2)}</td>
          <td className="n">{compact(entry.summary.outer_diameter_m * 1000, 4)}</td>
          <td className="n">{entry.summary.r20_ohm_m ? compact(entry.summary.r20_ohm_m * 1000, 4) : '—'}</td>
          <td><Badge tone="warn">{STATE_NAMES[entry.state] ?? entry.state}</Badge></td>
        </tr>;
      })}</tbody></table>
  </section>)}</div>;
}

export function ProjectDialog({ studio }: { studio: Studio }) {
  const [name, setName] = useState('');
  const [model, setModel] = useState(studio.library[0]?.id ?? '');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  async function create() {
    if (!name.trim()) { setProblem('请填写工程名称。'); return; }
    setBusy(true);
    try { await studio.createProject(name.trim(), model); } catch (error) { setProblem(error instanceof Error ? error.message : String(error)); setBusy(false); }
  }
  return <Dialog title="新建工程" wide onClose={() => studio.setDialog(null)} footer={<>
    <Button onClick={() => studio.setDialog(null)}>取消</Button><Button variant="primary" disabled={busy || !model} onClick={create}>建立工程</Button></>}>
    <div className="field"><label htmlFor="project-name">工程名称</label>
      <div className="field-control"><input id="project-name" value={name} placeholder="例如：城南 110 kV 出线" onChange={event => setName(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') void create(); }} /></div>
      {problem && <div className="field-note" role="alert">{problem}</div>}</div>
    <h3 className="dialog-section">从型号库选电缆</h3>
    <LibraryTable entries={studio.library} value={[model]} onPick={setModel} />
  </Dialog>;
}

export function LibraryDialog({ studio }: { studio: Studio }) {
  const current = studio.view!.parts.cable.id;
  const [model, setModel] = useState(current);
  const [problem, setProblem] = useState('');
  const picked = studio.library.find(entry => entry.id === model);
  const changesKind = picked && picked.summary.construction !== studio.view!.parts.cable.summary.construction;
  return <Dialog title="更换型号" wide onClose={() => studio.setDialog(null)} footer={<>
    {changesKind && <span className="dialog-hint">芯数不同：敷设方式会换成对应的默认模板，埋深保留。</span>}
    <Button onClick={() => studio.setDialog(null)}>取消</Button>
    <Button variant="primary" disabled={model === current} onClick={() => studio.write('cable.set', { model_id: model }).then(
      () => studio.setDialog(null), error => setProblem(error.message))}>换成这个型号</Button></>}>
    {problem && <div className="field-note" role="alert">{problem}</div>}
    <LibraryTable entries={studio.library} value={[model]} onPick={setModel} />
  </Dialog>;
}

const SWEEPS: Record<string, { label: string; unit: string; scale: number }> = {
  soil_thermal_resistivity: { label: '土壤热阻率', unit: 'K·m/W', scale: 1 },
  ambient_temperature_c: { label: '环境温度', unit: '°C', scale: 1 },
  depth_m: { label: '中心埋深', unit: 'm', scale: 1 },
  spacing_m: { label: '中心距', unit: 'mm', scale: 1000 },
  current_a: { label: '负荷电流', unit: 'A', scale: 1 },
};

export function SweepDialog({ studio }: { studio: Studio }) {
  const view = studio.view!;
  const starts: Record<string, [number, number]> = {
    soil_thermal_resistivity: [1, 2], ambient_temperature_c: [15, 35], depth_m: [.7, 1.5],
    spacing_m: [(view.preview?.layout.spacing ?? .2), (view.preview?.layout.spacing ?? .2) * 2], current_a: [200, 800],
  };
  const [variable, setVariable] = useState('soil_thermal_resistivity');
  const [from, setFrom] = useState<number | null>(starts[variable][0]);
  const [to, setTo] = useState<number | null>(starts[variable][1]);
  const [count, setCount] = useState<number | null>(6);
  const spec = SWEEPS[variable];
  const values = useMemo(() => from === null || to === null || !count || count < 2 ? []
    : Array.from({ length: count }, (_, index) => Number((from + (to - from) * index / (count - 1)).toPrecision(10))), [from, to, count]);
  const valid = values.length >= 2 && values.length <= 50 && from !== to;
  return <Dialog title="扫描" onClose={() => studio.setDialog(null)} footer={<>
    <Button onClick={() => studio.setDialog(null)}>取消</Button>
    <Button variant="primary" disabled={!valid} onClick={() => { studio.setDialog(null); void studio.run('run.sweep', { variable, values }, '正在扫描'); }}>运行扫描</Button></>}>
    <p className="prose">只改变一个量，其余输入保持不变，逐点计算允许电流。扫描不改动工程输入。</p>
    <SelectField label="扫描的量" value={variable} options={Object.entries(SWEEPS).map(([value, item]) => ({ value, label: item.label }))}
      onChange={value => { setVariable(value); setFrom(starts[value][0]); setTo(starts[value][1]); }} />
    <NumberField label="从" unit={spec.unit} scale={spec.scale} value={from} onCommit={setFrom} />
    <NumberField label="到" unit={spec.unit} scale={spec.scale} value={to} onCommit={setTo} />
    <NumberField label="点数" value={count} digits={3} onCommit={value => setCount(value === null ? null : Math.round(value))} />
    {valid && <div className="preview-values"><span>将计算</span>{values.map(value => <Badge key={value}>{compact(value * spec.scale)}</Badge>)}<span>{spec.unit}</span></div>}
  </Dialog>;
}

export function SelectionDialog({ studio }: { studio: Studio }) {
  const view = studio.view!;
  const cable = view.parts.cable;
  const eligible = studio.library.filter(entry => entry.summary.construction === cable.summary.construction);
  const [target, setTarget] = useState<number | null>(view.parts.conditions.currents_a[0] ?? 400);
  const [candidates, setCandidates] = useState<string[]>(eligible.filter(entry => entry.family === cable.family).map(entry => entry.id));
  const toggle = (id: string) => setCandidates(list => list.includes(id) ? list.filter(item => item !== id) : [...list, id]);
  return <Dialog title="选型" wide onClose={() => studio.setDialog(null)} footer={<>
    <Button onClick={() => studio.setDialog(null)}>取消</Button>
    <Button variant="primary" disabled={!target || !candidates.length} onClick={() => {
      studio.setDialog(null); void studio.run('run.select', { target_current_a: target, candidates }, '正在选型');
    }}>运行选型</Button></>}>
    <p className="prose">在当前敷设和工况下，逐个计算候选型号的允许电流，选出满足目标电流的最小截面。选型不改动工程输入；选出后可以一键采用。</p>
    <NumberField label="目标电流" unit="A" value={target} min={0} onCommit={setTarget} />
    <h3 className="dialog-section">候选型号（{candidates.length} 个）</h3>
    <LibraryTable entries={eligible} value={candidates} onPick={toggle} multiple />
  </Dialog>;
}
