// The property panel: the inputs of the current step, or the facts of the selected object.
import { Bot, Replace } from 'lucide-react';
import {
  BONDING_NAMES, compact, CONDITION_FIELDS, EDDY_NAMES, type Field, fixed, INSTALLATION_FIELDS, KIND_NAMES, METHOD_FIELDS, pick, STATE_NAMES,
} from '../shared/format.ts';
import { cableShape } from '../shared/geometry.ts';
import type { CableState, Proposal } from '../shared/types.ts';
import { Badge, Button, Facts, Group, NumberField, SelectField, TierBadge } from './components.tsx';
import { cableLabel } from './drawing.tsx';
import type { Studio } from './studio.ts';

function proposedFor(proposals: Proposal[], part: string, field: string): string | undefined {
  for (const proposal of proposals) {
    const change = proposal.changes.find(item => item.part === part && item.field === field);
    if (change) return change.after;
  }
  return undefined;
}

function CableInspector({ studio }: { studio: Studio }) {
  const view = studio.view!;
  const cable = view.parts.cable;
  const type = cable.payload.cable_type;
  const shape = cableShape(type, cable.payload.materials);
  const first = type.cores[0].id;
  const proposed = proposedFor(studio.proposals, 'cable', 'id');
  return <>
    <Group title="型号" action={<Button icon={<Replace size={15} />} onClick={() => studio.setDialog('library')}>更换</Button>}>
      <div className="object-title">{cable.name}</div>
      {proposed && <div className="field-note field-note-agent">Agent 提议改为 {proposed}</div>}
      <Facts rows={[
        ['数据状态', <Badge tone="warn">{STATE_NAMES[cable.state] ?? cable.state}</Badge>],
        ['额定电压 U0/U', `${compact(cable.summary.u0_v / 1000)} / ${compact((cable.summary.u_v ?? 0) / 1000)} kV`],
        ['导体截面', `${type.cores.length > 1 ? type.cores.length + '×' : ''}${compact(cable.summary.area_mm2)} mm²`],
        ['导体 R20', cable.summary.r20_ohm_m ? `${compact(cable.summary.r20_ohm_m * 1000, 5)} Ω/km` : '未给'],
        ['导体温限', `${compact(type.rating.max_conductor_temperature.normal - 273.15)} °C`],
        ['电缆外径', `${compact(cable.summary.outer_diameter_m * 1000, 5)} mm`],
      ]} />
    </Group>
    <Group title="结构层" summary={`${shape.rings.filter(ring => !ring.core || ring.core === first).length} 层`}>
      <table className="grid">
        <thead><tr><th>序</th><th>层</th><th>材料</th><th className="n">mm</th></tr></thead>
        <tbody>{shape.rings.filter(ring => !ring.core || ring.core === first).map(ring =>
          <tr key={ring.id} className={studio.selection?.id === ring.id ? 'is-selected' : ''} onClick={() => studio.setSelection({ kind: 'ring', id: ring.id })}>
            <td>{ring.number}</td><td>{ring.name.replace(/^芯 1 · /, '')}</td>
            <td>{cable.payload.materials.find(material => material.id === ring.material)?.label}</td>
            <td className="n">{ring.role === 'conductor' ? `Ø ${compact(ring.size * 1000)}` : compact(ring.size * 1000)}</td>
          </tr>)}</tbody>
      </table>
    </Group>
    <Group title="数据出处" summary={STATE_NAMES[cable.state] ?? cable.state} defaultOpen={false}>
      <p className="prose">{cable.source}</p>
      <Facts rows={[['库版本', cable.version], ['内容摘要', <code>{cable.content_sha256.slice(0, 16)}</code>]]} />
    </Group>
  </>;
}

function fieldValue(source: unknown, field: Field): number | null {
  const value = pick(source, field.key);
  return typeof value === 'number' ? value : null;
}

function InstallationInspector({ studio }: { studio: Studio }) {
  const view = studio.view!;
  const { installation, cable } = view.parts;
  const preview = view.preview;
  const layouts = view.layouts;
  const layout = layouts.find(item => item.kind === installation.layout);
  const ducted = layout?.ducted ?? !!installation.duct;
  const backfilled = ['backfill', 'duct_bank'].includes(installation.layout);
  const set = (patch: Record<string, unknown>) => studio.write('installation.set', patch);
  const number = (field: Field, extra: { nullable?: boolean; placeholder?: string } = {}) => {
    const [head, tail] = field.key.split('.');
    return <NumberField key={field.key} label={field.label} unit={field.unit} scale={field.scale} digits={field.digits} min={field.min}
      value={fieldValue(installation, field)} proposed={proposedFor(studio.proposals, 'installation', field.key)} {...extra}
      onCommit={value => set(tail ? { [head]: { ...(pick(installation, head) as object ?? {}), [tail]: value } } : { [head]: value })} />;
  };
  const byKey = Object.fromEntries(INSTALLATION_FIELDS.map(field => [field.key, field]));
  const selected = studio.selection?.kind === 'cable' ? preview?.document.sections[0].placements.find(item => item.cable === studio.selection!.id) : undefined;
  return <>
    <Group title="敷设方式">
      <SelectField label="敷设方式" value={installation.layout} proposed={proposedFor(studio.proposals, 'installation', 'layout')}
        options={layouts.map(item => ({ value: item.kind, label: item.label, group: item.circuits > 1 ? '多回路' : '单回路' }))}
        onChange={value => set({ layout: value })} />
      {number(byKey.depth_m)}
      {installation.layout !== 'ducts' && (preview?.circuit_count !== 1 || cable.summary.construction !== 'three_core') &&
        number(byKey.spacing_m, { nullable: true, placeholder: preview?.layout.spacing ? `${compact(preview.layout.spacing * 1000, 5)}（默认）` : '默认' })}
      <SelectField label="护套接地" value={installation.bonding} proposed={proposedFor(studio.proposals, 'installation', 'bonding')}
        options={Object.entries(BONDING_NAMES).map(([value, label]) => ({ value, label }))} onChange={value => set({ bonding: value })} />
    </Group>
    {ducted && <Group title="管道" summary={installation.duct ? `${compact(installation.duct.inner_diameter_m * 1000)} / ${compact(installation.duct.outer_diameter_m * 1000)} mm` : undefined}>
      {number(byKey['duct.inner_diameter_m'])}{number(byKey['duct.outer_diameter_m'])}
      {number(byKey['duct.thermal_resistivity'], { nullable: true, placeholder: '6（PVC，IEC 表 1）' })}
    </Group>}
    {backfilled && <Group title="回填区">
      {number(byKey['backfill.width'], { nullable: true, placeholder: '1.2（默认）' })}
      {number(byKey['backfill.height'], { nullable: true, placeholder: installation.layout === 'backfill' ? '0.6（默认）' : '1（默认）' })}
      {number(byKey['backfill.thermal_resistivity'], { nullable: true, placeholder: '0.8（默认）' })}
    </Group>}
    {selected && preview && <Group title="所选电缆" action={<Button variant="agent" icon={<Bot size={15} />}
      onClick={() => studio.askAgent(`检查 ${cableLabel(selected.cable, preview.document)} 的位置和间距是否合理`)}>问 Agent</Button>}>
      <div className="object-title">{cableLabel(selected.cable, preview.document)}</div>
      <Facts rows={[['水平位置 x', `${compact(selected.x * 1000, 5)} mm`], ['轴线深度', `${compact(-selected.z, 5)} m`],
        ['电缆外径', `${compact(preview.outer_diameter_m * 1000, 5)} mm`], ['所在管道', selected.enclosure ? '一管一缆' : '直埋']]} />
    </Group>}
  </>;
}

function ConditionsInspector({ studio }: { studio: Studio }) {
  const view = studio.view!;
  const { conditions } = view.parts;
  const circuits = view.preview?.document.circuits ?? [];
  const currents = circuits.length > 1 ? circuits.map((_, index) => conditions.currents_a[index] ?? conditions.currents_a[0]) : [conditions.currents_a[0]];
  const set = (patch: Record<string, unknown>) => studio.write('conditions.set', patch);
  return <>
    <Group title="环境">
      {CONDITION_FIELDS.slice(0, 2).map(field => <NumberField key={field.key} label={field.label} unit={field.unit} digits={field.digits} min={field.min}
        value={fieldValue(conditions, field)} proposed={proposedFor(studio.proposals, 'conditions', field.key)} onCommit={value => set({ [field.key]: value })} />)}
    </Group>
    <Group title="负荷" summary={currents.map(value => compact(value) + ' A').join(' / ')}>
      {currents.map((value, index) => <NumberField key={index} label={circuits.length > 1 ? `${circuits[index].label} 负荷电流` : '负荷电流'} unit="A" value={value}
        min={-1e-9} proposed={index === 0 ? proposedFor(studio.proposals, 'conditions', 'currents_a') : undefined}
        onCommit={next => set(circuits.length > 1 ? { currents_a: currents.map((item, at) => at === index ? next : item) } : { current_a: next })} />)}
    </Group>
    <Group title="系统" summary={conditions.system_voltage_v ? `${compact(conditions.system_voltage_v / 1000)} kV · ${compact(conditions.frequency_hz)} Hz` : undefined} defaultOpen={false}>
      {CONDITION_FIELDS.slice(2).map(field => <NumberField key={field.key} label={field.label} unit={field.unit} scale={field.scale} digits={field.digits} min={field.min}
        nullable={field.key === 'system_voltage_v'} value={fieldValue(conditions, field)} proposed={proposedFor(studio.proposals, 'conditions', field.key)}
        onCommit={value => set({ [field.key]: value })} />)}
    </Group>
  </>;
}

function MethodInspector({ studio }: { studio: Studio }) {
  const view = studio.view!;
  const resolved = (view.preview?.parameters ?? { ...view.parts.cable.method_defaults, ...view.parts.method.parameters }) as Record<string, any>;
  const set = (patch: Record<string, unknown>) => studio.write('method.set', patch);
  return <>
    <Group title="方法参数">
      {METHOD_FIELDS.filter(field => !field.options).map(field => {
        const key = field.key.split('.')[1];
        return <NumberField key={field.key} label={field.label} digits={field.digits} min={0} value={resolved[key]}
          proposed={proposedFor(studio.proposals, 'method', field.key)} onCommit={value => set({ [key]: value })} />;
      })}
      <SelectField label="护套涡流损耗" value={resolved.eddy} proposed={proposedFor(studio.proposals, 'method', 'parameters.eddy')}
        options={Object.entries(EDDY_NAMES).map(([value, label]) => ({ value, label }))} onChange={value => set({ eddy: value })} />
    </Group>
    <Group title="数值控制" summary="库内默认" defaultOpen={false}>
      <Facts rows={[['外部热阻公式', resolved.t4_form === 'exact' ? 'IEC 2023 精确式' : resolved.t4_form],
        ['额定口径', resolved.rating_mode === 'both' ? '逐回路 + 全回路共同' : '单回路'],
        ['电流迭代容差', resolved.solver ? `${resolved.solver.current_tolerance_a} A` : undefined],
        ['最大迭代次数', resolved.solver?.max_iterations],
        ['管内空气系数 U / V / Y', resolved.duct ? `${resolved.duct.u} / ${resolved.duct.v} / ${resolved.duct.y_per_k}` : undefined]]} />
    </Group>
  </>;
}

function stateRows(state: CableState): [string, string][] {
  return [
    ['电流', `${fixed(state.current_a)} A`], ['导体温度', `${fixed(state.conductor_c, 2)} °C`], ['温限', `${fixed(state.limit_c, 0)} °C`],
    ['余量', `${fixed(state.margin_k, 2)} K`], ['金属套温度', `${fixed(state.sheath_c, 2)} °C`], ['表面温度', `${fixed(state.surface_c, 2)} °C`],
    ['导体损耗', `${fixed(state.losses_w_m.conductor, 3)} W/m`], ['护套损耗', `${fixed(state.losses_w_m.sheath, 3)} W/m`],
    ...(state.losses_w_m.armour !== undefined ? [['铠装损耗', `${fixed(state.losses_w_m.armour, 3)} W/m`] as [string, string]] : []),
    ['介质损耗', `${fixed(state.losses_w_m.dielectric, 3)} W/m`], ['护套损耗因数 λ1', fixed(state.lambda1, 4)],
    ['交流电阻', `${compact(state.ac_resistance_ohm_m * 1000, 5)} Ω/km`], ['互热温升', `${fixed(state.mutual_rise_k, 2)} K`],
  ];
}

function RunInspector({ studio }: { studio: Studio }) {
  const record = studio.record;
  const header = studio.runs.find(run => run.id === studio.runId);
  if (!header) return <Group title="运行记录"><p className="prose">还没有运行记录。运行校核后，结果和它的依据会留在这里。</p></Group>;
  const cable = studio.route.step === 'result' && studio.selection?.kind === 'cable' ? studio.selection.id : undefined;
  const selected = cable ? record?.summary?.operating?.cables.find(item => item.id === cable) : undefined;
  const rated = cable ? record?.summary?.rated?.cables.find(item => item.id === cable) : undefined;
  return <>
    {selected && record?.document && <Group title="所选电缆" action={<Button variant="agent" icon={<Bot size={15} />}
      onClick={() => studio.askAgent(`解释 #${header.sequence} 中 ${cableLabel(selected.id, record.document!)} 的温度和损耗是怎么来的`)}>问 Agent</Button>}>
      <div className="object-title">{cableLabel(selected.id, record.document)}</div>
      <h4 className="subhead">保存负荷工况</h4><Facts rows={stateRows(selected)} />
      {rated && <><h4 className="subhead">额定工况</h4><Facts rows={stateRows(rated).slice(0, 6)} /></>}
    </Group>}
    <Group title="这条记录">
      <div className="object-title">#{header.sequence} {header.title}</div>
      <Facts rows={[['类型', KIND_NAMES[header.kind]], ['可信分档', <TierBadge tier={header.tier} />],
        ['发起', header.by === 'agent' ? 'Agent' : '工程师'], ['时间', new Date(header.created).toLocaleString('zh-CN', { hour12: false })],
        ['与当前输入', header.inputs_sha256 === studio.view?.inputs_sha256 ? '一致' : <Badge tone="warn">输入已变</Badge>]]} />
    </Group>
    {record && <Group title="追溯" summary={`${record.plugin_id} ${record.plugin_version}`} defaultOpen={false}>
      <Facts rows={[['插件', `${record.plugin_id} ${record.plugin_version}`], ['方法版本', record.method_version], ['工况数', record.request.cases.length],
        ['清单摘要', <code>{record.manifest_sha256.slice(0, 16)}</code>], ['请求摘要', <code>{record.request_sha256.slice(0, 16)}</code>],
        ['输入摘要', <code>{record.inputs_sha256.slice(0, 16)}</code>], ['记录标识', <code>{record.id}</code>]]} />
    </Group>}
  </>;
}

export function Inspector({ studio }: { studio: Studio }) {
  if (!studio.view) return null;
  const step = studio.route.step;
  return <aside className="inspector" aria-label="属性">
    {step === 'cable' && <CableInspector studio={studio} />}
    {step === 'installation' && <InstallationInspector studio={studio} />}
    {step === 'conditions' && <ConditionsInspector studio={studio} />}
    {step === 'method' && <MethodInspector studio={studio} />}
    {(step === 'result' || step === 'report') && <RunInspector studio={studio} />}
  </aside>;
}
