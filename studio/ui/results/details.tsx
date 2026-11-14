// The other two pages of the verdict column (the selected object, the method) and the tables of
// the runs that are not a rating.
import { Collapsible } from '@base-ui/react/collapsible';
import type { ReactNode } from 'react';
import { Icon } from '@/components/icon';
import { Badge, Facts, Seal, SectionTitle } from '@/components/marks';
import { cn } from '@/lib/cn';
import { compact, fixed, LEVEL_NAMES, ROLE_NAMES } from '@shared/format';
import type { CableShape } from '@shared/geometry';
import type { CableState, Material, MethodCard, RunRecord } from '@shared/types';

const Block = ({ children }: { children: ReactNode }) => <section className="border-b border-line px-5 py-5 last:border-b-0">{children}</section>;

const th = 'pb-2 text-left text-13 font-normal text-ink-2';
const td = 'border-t border-line py-2 text-14 text-ink';

/** The layers of the cable, inside out, with real sizes. */
function Structure({ shape, materials }: { shape: CableShape; materials: readonly Material[] }) {
  const label = new Map(materials.map(material => [material.id, material.label]));
  const first = shape.rings.find(ring => ring.core)?.core;
  const cores = new Set(shape.rings.flatMap(ring => (ring.core ? [ring.core] : []))).size;
  const rows = shape.rings.filter(ring => !ring.core || ring.core === first);
  return <>
    <SectionTitle aside={cores > 1 ? `${cores} 芯，各芯相同` : undefined}>结构层</SectionTitle>
    <table className="w-full border-collapse">
      <thead><tr><th className={th}>层</th><th className={th}>材料</th><th className={cn(th, 'text-right')}>尺寸 mm</th></tr></thead>
      <tbody>
        {rows.map(ring => <tr key={ring.id}>
          <td className={td}>{ROLE_NAMES[ring.role] ?? ring.role}</td>
          <td className={cn(td, 'text-ink-2')}>{label.get(ring.material) ?? ring.material}</td>
          <td className={cn(td, 'text-right')}>{ring.role === 'conductor' ? `Ø ${compact(ring.size * 1000)}` : compact(ring.size * 1000)}</td>
        </tr>)}
      </tbody>
    </table>
  </>;
}

export function ObjectPage({ state, name, shape, materials, screenName }: {
  state: CableState | null;
  name: string | null;
  shape: CableShape;
  materials: readonly Material[];
  screenName: string;
}) {
  return <>
    <Block>
      {state && name ? <>
        <SectionTitle>{name}</SectionTitle>
        <Facts rows={[
          { label: '位置 x', value: `${fixed(state.x, 3)} m` },
          { label: '位置 z', value: `${fixed(state.z, 3)} m` },
          { label: '电流', value: `${fixed(state.current_a)} A` },
          { label: '导体温度', value: `${fixed(state.conductor_c)} °C` },
          { label: `${screenName}温度`, value: `${fixed(state.sheath_c)} °C` },
          ...(state.armour_c !== null && state.armour_c !== undefined ? [{ label: '铠装温度', value: `${fixed(state.armour_c)} °C` }] : []),
          { label: '表面温度', value: `${fixed(state.surface_c)} °C` },
          { label: '距温限', value: `${fixed(state.margin_k)} K` },
          { label: '交流电阻', value: `${compact(state.ac_resistance_ohm_m * 1e6)} μΩ/m` },
          { label: `${screenName}损耗系数 λ1`, value: compact(state.lambda1) },
        ]} />
      </> : <p className="m-0 text-14 text-ink-2">在图上点一根电缆，这里显示它的位置、温度和损耗。</p>}
    </Block>
    <Block><Structure shape={shape} materials={materials} /></Block>
  </>;
}

function Fold({ title, items }: { title: string; items: string[] }) {
  return <Collapsible.Root className="border-t border-line first:border-t-0">
    <Collapsible.Trigger className="group flex h-11 w-full items-center justify-between text-left text-14 text-ink">
      <span>{title}</span>
      <span className="flex items-center gap-2 text-ink-2">{items.length} 条<Icon name="action/chevron-down" className="transition-transform duration-std ease-std group-data-[panel-open]:rotate-180" /></span>
    </Collapsible.Trigger>
    <Collapsible.Panel className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-std ease-std data-[ending-style]:h-0 data-[starting-style]:h-0">
      <ul className="m-0 grid list-disc gap-2 pb-4 pl-5 text-14 text-ink-2">{items.map(item => <li key={item}>{item}</li>)}</ul>
    </Collapsible.Panel>
  </Collapsible.Root>;
}

export function MethodPage({ card, record }: { card: MethodCard; record: RunRecord }) {
  const rows = record.summary?.verification?.rows ?? [];
  return <>
    <Block>
      <SectionTitle>{card.method}</SectionTitle>
      <p className="m-0 mb-4 text-14 text-ink-2">{card.summary}</p>
      <Facts rows={[
        { label: '方法族', value: card.family },
        { label: '插件', value: card.plugin },
        { label: '验证水平', value: LEVEL_NAMES[card.validation.level] ?? card.validation.level },
        { label: '独立核对', value: rows.length ? `${rows.filter(row => row.passed).length} / ${rows.length} 项通过` : '本次没有核对项' },
      ]} />
    </Block>
    <Block>
      <SectionTitle aside={<Seal tier={card.tier.tier} label={card.tier.label} />}>这个结果能信到什么程度</SectionTitle>
      <p className="m-0 text-14 text-ink">{card.tier.meaning}</p>
      <ul className="m-0 mt-3 grid list-disc gap-2 pl-5 text-14 text-ink-2">{card.tier.basis.map(item => <li key={item}>{item}</li>)}</ul>
    </Block>
    <Block>
      <Fold title="依据的标准条款" items={card.standards} />
      <Fold title="适用范围" items={card.scope} />
      <Fold title="假设" items={card.assumptions} />
      <Fold title="验证过的算例" items={card.validation.cases} />
    </Block>
  </>;
}

/** A run that is a parameter sweep or a selection: its table. The curve and the drawing link come with the run drawer. */
export function RunTable({ record }: { record: RunRecord }) {
  const tier = record.method_card?.tier;
  return <div className="flex min-h-0 flex-1 flex-col">
    <header className="shrink-0 px-5 pt-5 pb-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-13 font-strong text-ink-2">结论</span>
        {tier && <Seal tier={tier.tier} label={tier.label} />}
      </div>
      <h2 className="m-0 mt-1 text-20 font-strong text-ink">{record.kind === 'sweep' ? '参数扫描' : '选型'}</h2>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-5 py-4">
      {record.sweep && <table className="w-full border-collapse">
        <thead><tr>
          <th className={th}>{record.sweep.label} {record.sweep.unit}</th>
          <th className={cn(th, 'text-right')}>允许电流 A</th>
          <th className={cn(th, 'text-right')}>最热导体 °C</th>
        </tr></thead>
        <tbody>{record.sweep.points.map(point => <tr key={point.case_id}>
          <td className={td}>{compact(point.value)}</td>
          <td className={cn(td, 'text-right font-strong')}>{fixed(point.ampacity_a)}</td>
          <td className={cn(td, 'text-right')}>{point.operating_error ? '无稳态解' : fixed(point.hottest_conductor_c)}</td>
        </tr>)}</tbody>
      </table>}
      {record.selection && <>
        <Facts className="mb-4" rows={[{ label: '目标电流', value: `${compact(record.selection.target_current_a)} A` }]} />
        <table className="w-full border-collapse">
          <thead><tr>
            <th className={th}>截面 mm²</th>
            <th className={cn(th, 'text-right')}>允许电流 A</th>
            <th className={cn(th, 'text-right')}>带目标电流时导体 °C</th>
          </tr></thead>
          <tbody>{record.selection.candidates.map(candidate => {
            const chosen = candidate.model_id === record.selection?.chosen;
            const over = candidate.meets_target === false;
            return <tr key={candidate.case_id} className={cn(chosen && 'bg-fill')}>
              <td className={cn(td, 'pl-2')}><span className="flex items-center gap-2">{compact(candidate.area_mm2)}{chosen && <Badge tone="ink">选中</Badge>}</span></td>
              <td className={cn(td, 'text-right font-strong')}>{fixed(candidate.ampacity_a)}</td>
              <td className={cn(td, 'pr-2 text-right', over && 'text-error')}>{candidate.at_target_error ? '无稳态解' : fixed(candidate.conductor_at_target_c)}</td>
            </tr>;
          })}</tbody>
        </table>
      </>}
    </div>
  </div>;
}
