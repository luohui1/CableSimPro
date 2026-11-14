// The four premises of a calculation, always in view: cable, laying, conditions, method.
// Each slot opens the full content of that premise, and that is where it is changed.
import type { ReactNode } from 'react';
import { Icon } from '@/components/icon';
import { Badge, Facts, Seal } from '@/components/marks';
import { NumberField } from '@/components/number-field';
import { Popover } from '@/components/popover';
import { Segmented } from '@/components/segmented';
import { cn } from '@/lib/cn';
import { useLibrary } from '@/state/queries';
import { compact, STATE_NAMES } from '@shared/format';
import type { ProjectView } from '@shared/types';

export type Edit = (op: 'cable.set' | 'installation.set' | 'conditions.set' | 'method.set', params: Record<string, unknown>) => void;

function Slot({ icon, label, value, aside, children }: { icon: string; label: string; value: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return <Popover trigger={
    <button type="button" className="flex h-14 min-w-0 items-center gap-2.5 px-3 text-left transition-colors duration-fast ease-std hover:bg-hover data-[popup-open]:bg-fill">
      <Icon name={icon} className="text-ink-2" />
      <span className="min-w-0 flex-1">
        <span className="flex h-6 items-center justify-between gap-2 text-13 text-ink-2">{label}{aside}</span>
        <span className="block truncate text-14 font-strong text-ink">{value}</span>
      </span>
    </button>}>
    {children}
  </Popover>;
}

const Title = ({ children }: { children: ReactNode }) => <h3 className="m-0 mb-3 text-16 font-strong text-ink">{children}</h3>;
const Sub = ({ children }: { children: ReactNode }) => <h4 className="m-0 mt-5 mb-2 text-14 font-strong text-ink">{children}</h4>;

/** One choice in a list of alternatives: the present one is marked, the others can be picked. */
function Choice({ current, onPick, children, aside }: { current: boolean; onPick: () => void; children: ReactNode; aside?: ReactNode }) {
  return <button type="button" aria-current={current} onClick={() => { if (!current) onPick(); }}
    className={cn('flex h-9 w-full items-center gap-3 rounded-field px-2.5 text-left text-14 text-ink transition-colors duration-fast ease-std hover:bg-hover', current && 'bg-fill')}>
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {aside && <span className="shrink-0 text-13 text-ink-2">{aside}</span>}
    <Icon name="action/check" className={cn('text-ink', !current && 'invisible')} />
  </button>;
}

const Row = ({ label, children }: { label: string; children: ReactNode }) =>
  <div className="flex items-center justify-between gap-4"><span className="text-13 text-ink-2">{label}</span>{children}</div>;

export function PremiseStrip({ view, onEdit }: { view: ProjectView; onEdit: Edit }) {
  const { cable, installation, conditions, method } = view.parts;
  const preview = view.preview;
  const library = useLibrary();
  const limit = (cable.payload.cable_type.rating.max_conductor_temperature.normal ?? 363.15) - 273.15;
  const currents = conditions.currents_a;
  const sameLoad = currents.every(value => value === currents[0]);
  const parameters = (preview?.parameters ?? method.parameters) as { ks?: number; kp?: number; eddy?: string };

  return <div className="grid shrink-0 grid-cols-[52px_minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1.1fr)] divide-x divide-line border-b border-line">
    <span className="flex items-center justify-center text-13 font-strong text-ink-2">已知</span>

    <Slot icon="object/cable" label="电缆" value={cable.name}>
      <Title>{cable.name}</Title>
      <Facts rows={[
        { label: '数据状态', value: STATE_NAMES[cable.state] ?? cable.state },
        { label: '额定电压 U0 / U', value: `${compact(cable.summary.u0_v / 1000)} / ${cable.summary.u_v ? compact(cable.summary.u_v / 1000) : '—'} kV` },
        { label: '导体截面', value: `${cable.summary.cores} × ${compact(cable.summary.area_mm2)} mm²` },
        { label: '电缆外径', value: `${compact(cable.summary.outer_diameter_m * 1000)} mm` },
        { label: '导体温限', value: `${compact(limit)} °C` },
      ]} />
      <Sub>换一种电缆</Sub>
      <div className="-mx-2.5 grid max-h-56 gap-0.5 overflow-y-auto">
        {(library.data ?? []).map(entry => <Choice key={entry.id} current={entry.id === cable.id} onPick={() => onEdit('cable.set', { model_id: entry.id })}
          aside={`外径 ${compact(entry.summary.outer_diameter_m * 1000)} mm`}>{entry.name}</Choice>)}
      </div>
      <Sub>数据出处</Sub>
      <p className="m-0 text-14 break-words text-ink-2">{cable.source}</p>
    </Slot>

    <Slot icon="object/section" label="敷设" value={preview?.layout_label ?? installation.layout}>
      <Title>敷设</Title>
      <div className="-mx-2.5 grid gap-0.5">
        {view.layouts.map(option => <Choice key={option.kind} current={option.kind === installation.layout} onPick={() => onEdit('installation.set', { layout: option.kind })}
          aside={`${option.circuits} 回`}>{option.label}</Choice>)}
      </div>
      <Sub>尺寸</Sub>
      <div className="grid gap-2.5">
        <NumberField label="中心埋深" unit="m" value={installation.depth_m} min={0.05} step={0.05} onCommit={value => { if (value !== null) onEdit('installation.set', { depth_m: value }); }} />
        <NumberField label="中心距" unit="mm" value={installation.spacing_m === null ? null : installation.spacing_m * 1000} min={1} step={5} digits={1}
          placeholder={preview?.layout.spacing ? `默认 ${compact(preview.layout.spacing * 1000)}` : '默认'}
          onCommit={value => onEdit('installation.set', { spacing_m: value === null ? null : value / 1000 })} />
        {installation.duct && <>
          <NumberField label="管内径" unit="mm" value={installation.duct.inner_diameter_m * 1000} min={1} step={5} digits={1}
            onCommit={value => { if (value !== null) onEdit('installation.set', { duct: { ...installation.duct, inner_diameter_m: value / 1000 } }); }} />
          <NumberField label="管外径" unit="mm" value={installation.duct.outer_diameter_m * 1000} min={1} step={5} digits={1}
            onCommit={value => { if (value !== null) onEdit('installation.set', { duct: { ...installation.duct, outer_diameter_m: value / 1000 } }); }} />
        </>}
        {installation.backfill && <>
          <NumberField label="回填宽度" unit="m" value={installation.backfill.width ?? null} min={0.05} step={0.05}
            onCommit={value => { if (value !== null) onEdit('installation.set', { backfill: { ...installation.backfill, width: value } }); }} />
          <NumberField label="回填高度" unit="m" value={installation.backfill.height ?? null} min={0.05} step={0.05}
            onCommit={value => { if (value !== null) onEdit('installation.set', { backfill: { ...installation.backfill, height: value } }); }} />
          <NumberField label="回填热阻率" unit="K·m/W" value={installation.backfill.thermal_resistivity ?? null} min={0.01} step={0.1}
            onCommit={value => { if (value !== null) onEdit('installation.set', { backfill: { ...installation.backfill, thermal_resistivity: value } }); }} />
        </>}
        <Row label="护套接地">
          <Segmented label="护套接地" value={installation.bonding} onChange={bonding => onEdit('installation.set', { bonding })}
            options={[{ value: 'both_ends', label: '两端接地' }, { value: 'single_point', label: '单点接地' }]} />
        </Row>
      </div>
    </Slot>

    <Slot icon="object/conditions" label="工况" value={<span className="flex gap-3">
      <span>{currents.map(value => compact(value)).join(' / ')} A</span>
      <span>{compact(conditions.soil_thermal_resistivity)} K·m/W</span>
      <span>{compact(conditions.ambient_temperature_c)} °C</span>
    </span>}>
      <Title>工况</Title>
      <div className="grid gap-2.5">
        {sameLoad
          ? <NumberField label={currents.length > 1 ? '每回负荷电流' : '负荷电流'} unit="A" value={currents[0]} min={0} step={10} digits={1}
            onCommit={value => { if (value !== null) onEdit('conditions.set', { current_a: value }); }} />
          : currents.map((current, index) => <NumberField key={index} label={`回路 ${index + 1} 负荷电流`} unit="A" value={current} min={0} step={10} digits={1}
            onCommit={value => { if (value !== null) onEdit('conditions.set', { currents_a: currents.map((other, at) => (at === index ? value : other)) }); }} />)}
        <NumberField label="土壤热阻率" unit="K·m/W" value={conditions.soil_thermal_resistivity} min={0.01} step={0.1}
          onCommit={value => { if (value !== null) onEdit('conditions.set', { soil_thermal_resistivity: value }); }} />
        <NumberField label="环境温度" unit="°C" value={conditions.ambient_temperature_c} min={-50} max={80} step={1} digits={1}
          onCommit={value => { if (value !== null) onEdit('conditions.set', { ambient_temperature_c: value }); }} />
        <NumberField label="系统线电压" unit="kV" value={conditions.system_voltage_v === null ? null : conditions.system_voltage_v / 1000} min={0.1} step={1}
          onCommit={value => onEdit('conditions.set', { system_voltage_v: value === null ? null : value * 1000 })} />
        <NumberField label="频率" unit="Hz" value={conditions.frequency_hz} min={1} step={10} digits={1}
          onCommit={value => { if (value !== null) onEdit('conditions.set', { frequency_hz: value }); }} />
      </div>
    </Slot>

    <Slot icon="calc/ampacity" label="方法" value={method.method === 'iec60287.steady' ? 'IEC 60287 稳态' : method.method}
      aside={view.issue ? <Badge tone="attention">输入有问题</Badge> : preview ? <Seal tier={preview.tier.tier} label={preview.tier.label} /> : null}>
      <Title>IEC 60287 稳态载流量</Title>
      {view.issue && <p className="m-0 mb-4 text-14 text-attention">{view.issue.message}</p>}
      {preview && <>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-14 font-strong text-ink">这种敷设形式的信任等级</span>
          <Seal tier={preview.tier.tier} label={preview.tier.label} />
        </div>
        <p className="m-0 text-14 text-ink-2">{preview.tier.meaning}</p>
      </>}
      <Sub>方法参数</Sub>
      <div className="grid gap-2.5">
        <NumberField label="集肤效应系数 ks" value={parameters.ks ?? null} min={0.01} max={1} step={0.05}
          onCommit={value => { if (value !== null) onEdit('method.set', { ks: value }); }} />
        <NumberField label="邻近效应系数 kp" value={parameters.kp ?? null} min={0.01} max={1} step={0.05}
          onCommit={value => { if (value !== null) onEdit('method.set', { kp: value }); }} />
        <Row label="护套涡流损耗">
          <Segmented label="护套涡流损耗" value={parameters.eddy === 'trefoil' ? 'trefoil' : 'ignored'} onChange={eddy => onEdit('method.set', { eddy })}
            options={[{ value: 'ignored', label: '不计' }, { value: 'trefoil', label: '计入' }]} />
        </Row>
      </div>
    </Slot>
  </div>;
}
