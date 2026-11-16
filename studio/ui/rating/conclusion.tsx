// The answer, in the order an engineer asks: how much the cable can carry, which one reaches its limit first, how far it is
// from the limit at the saved load; under it, the numbers that explain it. Every number is the method's, as saved in the run.
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Disclosure } from '@/kit/disclosure';
import { TierMark } from '@/kit/marks';
import { LimitMeter, Metric } from '@/kit/metric';
import { PropertyList } from '@/kit/properties';
import { DataTable } from '@/kit/workbench/data-table';
import { Panel } from '@/kit/workbench/page';
import { EmptyState } from '@/kit/workbench/premise';
import { cn } from '@/lib/utils';
import { compact, fixed, LEVEL_NAMES } from '@shared/format';
import type { CableState, RunRecord } from '@shared/types';
import type { Rating } from './rating';

export type ConclusionState =
  | { kind: 'issue'; message: string }
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | {
    kind: 'result'; record: RunRecord; rating: Rating;
    /** The inputs have changed since this was computed. */
    stale: boolean;
    names: (id: string) => string;
    /** The same names as short as they can be, for a table: the circuit, or the phase. */
    shortNames: (id: string) => string;
    /** What the cable calls its metal screen: 金属屏蔽 or 金属套. */
    screenName: string;
    selected: string | null;
    onSelect: (id: string | null) => void;
  };

const frame = 'w-80 flex-none border-l border-line';

const group = (title: string, items: string[]): ReactNode => items.length > 0 && <section key={title}>
  <h4 className="m-0 mb-1 text-sm font-medium text-ink">{title}</h4>
  <ul className="m-0 grid list-disc gap-1 pl-5 text-sm text-ink-2">{items.map(item => <li key={item}>{item}</li>)}</ul>
</section>;

export function Conclusion({ state }: { state: ConclusionState }) {
  if (state.kind === 'issue') return <Panel title="结论" className={frame}><EmptyState icon="status/warning" title="现在的输入算不出结果" description={state.message} /></Panel>;
  if (state.kind === 'loading') return <Panel title="结论" className={frame}><EmptyState icon="status/pending" title="正在读取运行记录" description="读完这条记录，结论就在这里。" /></Panel>;
  if (state.kind === 'empty') {
    return <Panel title="结论" className={frame}>
      <EmptyState icon="calc/ampacity" title="还没有运行记录" description="核对上面的已知条件，点右上角的“运行校核”，允许电流和先到温限的电缆会出现在这里。" />
    </Panel>;
  }
  if (state.kind === 'failed') return <Panel title="结论" className={frame}><EmptyState icon="status/error" title="这次校核没有结果" description={state.message} /></Panel>;

  const { record, rating, stale, names, shortNames, screenName, selected, onSelect } = state;
  const card = record.method_card;
  const { focus } = rating;
  const losses = focus.losses_w_m;
  const thermal = focus.thermal_k_m_w;
  const several = rating.states.length > 1;
  const ratedOf = (id: string): CableState | undefined => rating.rated.find(item => item.id === id);
  const verification = record.summary?.verification;
  const warnings = record.summary?.warnings ?? [];
  const about = several ? <Badge variant="outline">{names(focus.id)}</Badge> : undefined;
  const body = (children: ReactNode) => <div className="px-4 pb-4">{children}</div>;
  const spare = rating.margin;

  return <Panel title="结论" className={frame}
    tools={<>
      {stale && <Badge variant="attention">已过期</Badge>}
      {card && <TierMark tier={card.tier.tier} label={card.tier.label} />}
    </>}>
    <div className="flex flex-col gap-4 border-b border-line px-4 py-4">
      <Metric label="允许电流" value={fixed(rating.ampacity)} unit="A" detail={rating.summary.ampacity?.basis_name} />
      <div className="flex flex-col">
        <span className="text-sm text-ink-2">先到温限</span>
        <span className="text-h3 text-ink">{several && !rating.distinct ? '各电缆同时（温度相同）' : names(rating.limiting)}</span>
      </div>
      <LimitMeter label="导体温度" value={rating.limitingState.conductor_c} limit={rating.limitingState.limit_c} from={rating.ambient} unit="°C"
        caption={<>
          保存负荷 <span className="text-ink tabular-nums">{compact(rating.load)} A</span>
          {spare !== null && <>，{spare >= 0 ? '余量' : '超出'} <span className={cn('tabular-nums', spare >= 0 ? 'text-ink' : 'text-error')}>{fixed(Math.abs(spare))} A</span></>}
        </>} />
    </div>

    {several && <Disclosure title="各电缆" aside={<span className="text-sm font-normal text-ink-2">{rating.states.length} 根</span>}>
      <DataTable rowKey={row => row.id} rows={rating.states} selected={focus.id} onSelect={row => onSelect(row.id === selected ? null : row.id)} columns={[
        { key: 'name', header: '电缆', cell: row => <span className="flex items-center gap-2">{shortNames(row.id)}{rating.distinct && row.id === rating.limiting && <Badge variant="secondary">最热</Badge>}</span> },
        { key: 'load', header: '保存负荷', unit: '°C', numeric: true, width: 'w-28', cell: row => fixed(row.conductor_c) },
        { key: 'rated', header: '带满', unit: '°C', numeric: true, width: 'w-20', cell: row => fixed(ratedOf(row.id)?.conductor_c) },
      ]} />
    </Disclosure>}

    <Disclosure title="保存负荷下的温度" defaultOpen aside={about}>
      {body(<PropertyList rows={[
        { label: '导体', value: fixed(focus.conductor_c), unit: '°C' },
        { label: screenName, value: fixed(focus.sheath_c), unit: '°C' },
        ...(focus.armour_c !== null && focus.armour_c !== undefined ? [{ label: '铠装', value: fixed(focus.armour_c), unit: '°C' }] : []),
        { label: '电缆表面', value: fixed(focus.surface_c), unit: '°C' },
        { label: '距温限', value: fixed(focus.margin_k), unit: 'K' },
      ]} />)}
    </Disclosure>

    <Disclosure title="损耗" aside={about}>
      {body(<PropertyList rows={[
        { label: '导体', value: fixed(losses.conductor, 2), unit: 'W/m' },
        { label: screenName, value: fixed(losses.sheath, 2), unit: 'W/m' },
        ...(losses.armour !== undefined ? [{ label: '铠装', value: fixed(losses.armour, 2), unit: 'W/m' }] : []),
        { label: '介质', value: fixed(losses.dielectric, 2), unit: 'W/m' },
        { label: '合计', value: fixed(losses.total, 2), unit: 'W/m' },
      ]} />)}
    </Disclosure>

    <Disclosure title="热阻" aside={about}>
      {body(<PropertyList rows={[
        { label: 'T₁ 绝缘', value: fixed(thermal.t1, 3), unit: 'K·m/W' },
        ...(thermal.t2 !== undefined ? [{ label: 'T₂ 内衬', value: fixed(thermal.t2, 3), unit: 'K·m/W' }] : []),
        { label: 'T₃ 外护套', value: fixed(thermal.t3, 3), unit: 'K·m/W' },
        ...(thermal.t4_wall > 0 ? [{ label: 'T₄ 管内空气', value: fixed(thermal.t4_air, 3), unit: 'K·m/W' }, { label: 'T₄ 管壁', value: fixed(thermal.t4_wall, 3), unit: 'K·m/W' }] : []),
        { label: 'T₄ 土壤', value: fixed(thermal.t4_soil, 3), unit: 'K·m/W' },
      ]} />)}
    </Disclosure>

    {several && rating.contributions && rating.contributions.length > 0 && <Disclosure title="表面温升由谁加的" aside={about}>
      {body(<PropertyList rows={[...rating.contributions].sort((a, b) => Number(b.self) - Number(a.self) || b.temperature_rise_k - a.temperature_rise_k)
        .map(item => ({ label: item.self ? '自身' : names(item.source), value: fixed(item.temperature_rise_k), unit: 'K' }))} />)}
    </Disclosure>}

    {warnings.length > 0 && <Disclosure title="运行提示" aside={<Badge variant="attention">{warnings.length}</Badge>}>
      {body(<ul className="m-0 grid list-disc gap-1 pl-5 text-sm text-ink-2">{warnings.map(warning => <li key={warning.code + warning.message}>{warning.message}</li>)}</ul>)}
    </Disclosure>}

    {card && <Disclosure title="算法与可信度">
      <div className="flex flex-col gap-4 px-4 pb-4">
        <p className="m-0 text-sm text-ink">{card.tier.meaning}</p>
        {rating.summary.ampacity?.meaning && <p className="m-0 text-sm text-ink-2">{rating.summary.ampacity.meaning}</p>}
        <PropertyList rows={[
          { label: '方法', value: card.method },
          { label: '插件', value: `${record.plugin_id} ${record.plugin_version}` },
          { label: '验证水平', value: LEVEL_NAMES[card.validation.level] ?? card.validation.level },
          { label: '独立核对', value: verification ? `${verification.rows.filter(row => row.passed).length} / ${verification.rows.length} 项通过` : '本次没有核对项' },
        ]} />
        {group('分档依据', card.tier.basis)}
        {group('依据的标准条款', card.standards)}
        {group('适用范围', card.scope)}
        {group('假设', card.assumptions)}
        {group('验证过的算例', card.validation.cases)}
      </div>
    </Disclosure>}
  </Panel>;
}
