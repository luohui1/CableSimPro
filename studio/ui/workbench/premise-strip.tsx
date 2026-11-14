// The four premises of a calculation, always in view: cable, laying, conditions, method.
// Each slot opens the full content of that premise.
import type { ReactNode } from 'react';
import { Icon } from '@/components/icon';
import { Badge, Facts, Seal } from '@/components/marks';
import { Popover } from '@/components/popover';
import { BONDING_NAMES, compact, CONDITION_FIELDS, display, INSTALLATION_FIELDS, METHOD_FIELDS, pick, STATE_NAMES } from '@shared/format';
import type { ProjectView } from '@shared/types';

function Slot({ icon, label, value, aside, children }: { icon: string; label: string; value: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return <Popover trigger={
    <button type="button" className="flex h-14 min-w-0 items-center gap-2.5 px-3.5 text-left transition-colors duration-fast ease-std hover:bg-hover data-[popup-open]:bg-fill">
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

export function PremiseStrip({ view }: { view: ProjectView }) {
  const { cable, installation, conditions, method } = view.parts;
  const preview = view.preview;
  const filled = (fields: typeof INSTALLATION_FIELDS, source: unknown) => fields
    .filter(field => pick(source, field.key) !== undefined && (pick(source, field.key) !== null || field.empty))
    .map(field => ({ label: field.label, value: display(field, pick(source, field.key)) }));
  const limit = (cable.payload.cable_type.rating.max_conductor_temperature.normal ?? 363.15) - 273.15;

  return <div className="grid shrink-0 grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1.1fr)] divide-x divide-line border-b border-line">
    <Slot icon="object/cable" label="电缆" value={cable.name}>
      <Title>{cable.name}</Title>
      <Facts rows={[
        { label: '数据状态', value: STATE_NAMES[cable.state] ?? cable.state },
        { label: '额定电压 U0 / U', value: `${compact(cable.summary.u0_v / 1000)} / ${cable.summary.u_v ? compact(cable.summary.u_v / 1000) : '—'} kV` },
        { label: '导体截面', value: `${cable.summary.cores} × ${compact(cable.summary.area_mm2)} mm²` },
        { label: '电缆外径', value: `${compact(cable.summary.outer_diameter_m * 1000)} mm` },
        { label: '导体温限', value: `${compact(limit)} °C` },
      ]} />
      <h4 className="m-0 mt-4 mb-1.5 text-14 font-strong text-ink">数据出处</h4>
      <p className="m-0 text-14 break-words text-ink-2">{cable.source}</p>
    </Slot>

    <Slot icon="object/section" label="敷设" value={preview?.layout_label ?? installation.layout}>
      <Title>{preview?.layout_label ?? installation.layout}</Title>
      <Facts rows={[
        ...(preview ? [{ label: '回路数', value: String(preview.circuit_count) }] : []),
        ...filled(INSTALLATION_FIELDS.filter(field => field.key !== 'bonding'), { ...installation, spacing_m: preview?.layout.spacing ?? installation.spacing_m }),
        { label: '护套接地', value: BONDING_NAMES[installation.bonding] ?? installation.bonding },
      ]} />
    </Slot>

    <Slot icon="object/conditions" label="工况" value={<span className="flex gap-3.5">
      <span>{conditions.currents_a.map(value => compact(value)).join(' / ')} A</span>
      <span>{compact(conditions.soil_thermal_resistivity)} K·m/W</span>
      <span>{compact(conditions.ambient_temperature_c)} °C</span>
    </span>}>
      <Title>工况</Title>
      <Facts rows={[
        { label: '负荷电流', value: conditions.currents_a.map(value => `${compact(value)} A`).join(' / ') },
        ...filled(CONDITION_FIELDS, conditions),
      ]} />
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
        <Facts className="mt-4" rows={filled(METHOD_FIELDS, { parameters: preview.parameters })} />
      </>}
    </Slot>
  </div>;
}
