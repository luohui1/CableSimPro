// The ampacity calculation, screen by screen: a new project; the rated run (round one's screen) under the project's run
// records; the givens edited at the side with the drawing still in view; a sweep over one condition; a selection against a
// target current. Data: project p-fad964a2 on this branch's host, its three runs and their inputs (host-records.ts); the
// field drawing and the run document of round one, whose run gives the same 458.7 A.
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Disclosure } from '@/kit/disclosure';
import { Icon } from '@/kit/icon';
import { Dot, ReviewMark, TierMark, type Review } from '@/kit/marks';
import { LimitMeter, Metric } from '@/kit/metric';
import { PropertyList } from '@/kit/properties';
import { CanvasFrame, CanvasLayer, CanvasTool, CanvasToolbar, CanvasToolbarSeparator, TemperatureLegend } from '@/kit/workbench/canvas';
import { CurveChart, TargetBar, type Axis } from '@/kit/workbench/chart';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { ChoiceCards, ChoiceSelect, FormRow, FormSection, Segmented, UnitInput } from '@/kit/workbench/form';
import { PageHeader, Panel, Split } from '@/kit/workbench/page';
import { Given, PremiseStrip } from '@/kit/workbench/premise';
import { RunRail } from '@/kit/workbench/runs';
import { SideEditor, SideEditorSection } from '@/kit/workbench/side-editor';
import { useTheme } from '@/state/theme';
import { BONDING_NAMES, fixed } from '@shared/format';
import { CableSection, FIELD_RANGE, SectionField, fieldStops } from './figures';
import { WORKSPACE } from './library-data';
import { CANDIDATES, DEFAULTS, IMPORT, LAYOUTS, PROJECT, RUN_INPUTS, RUN_METHOD, RUNS, SELECTION, SWEEP } from './host-records';
import { RUN_CABLE, RUN_SOLVER } from './run-document';
import { RATING } from './samples';

// What the runs were made with (one digest for all three), and the method that made them.
const { installation, conditions } = RUN_INPUTS;
const METHOD = `${RUN_METHOD.card} · ${RUN_METHOD.plugin} ${RUN_METHOD.version}`;
const CABLE_NAME = CANDIDATES.find(option => option.id === PROJECT.cable)?.name ?? PROJECT.cable;
const LAYOUT_LABEL = Object.fromEntries(LAYOUTS.map(layout => [layout.kind, layout.label]));
const LIMIT_C = RATING.limiting.limit;
const [RATED, SWEPT, SELECTED] = RUNS;
const BONDING = Object.entries(BONDING_NAMES).map(([value, label]) => ({ value, label }));

// ---- The frame every run of the project shares ----

/**
 * The givens of the project as its runs were made; one of them may stand for a range, or be the one being edited. A selection
 * asks about a target current, so the target takes the load's place.
 */
function Givens({ cable = CABLE_NAME, soil, editing, target }: { cable?: string; soil?: string; editing?: boolean; target?: number }) {
  return <>
    <Given label="型号" value={cable} />
    <Given label="敷设" value={LAYOUT_LABEL[installation.layout]} />
    <Given label="埋深" value={`${installation.depth_m} m`} />
    <Given label="土壤热阻率" value={soil ?? `${conditions.soil_thermal_resistivity} K·m/W`} active={editing} />
    <Given label="环境" value={`${conditions.ambient_temperature_c} °C`} />
    {target === undefined ? <Given label="负荷" value={`${conditions.currents_a[0]} A`} /> : <Given label="目标电流" value={`${target} A`} />}
    <Given label="系统" value={`${conditions.system_voltage_v / 1000} kV · ${conditions.frequency_hz} Hz`} />
    <Given label="护套" value={BONDING_NAMES[installation.bonding]} />
  </>;
}

/** `editing`: the side editor is open, and its apply is the screen's one primary; the export steps back. */
function RatingShell({ active, asked, givens, editing, children }: { active: string; asked: ReactNode; givens: ReactNode; editing?: boolean; children: ReactNode }) {
  return <>
    <PageHeader trail={[{ label: '载流量计算' }]} title={PROJECT.name}
      actions={<>
        <Button variant="outline"><Icon name="calc/sweep" data-icon="inline-start" />扫一个条件</Button>
        <Button variant="outline"><Icon name="calc/selection" data-icon="inline-start" />按电流选型</Button>
      </>}
      primary={<Button variant={editing ? 'outline' : 'default'}><Icon name="result/report" data-icon="inline-start" />导出计算书</Button>} />
    <RunRail runs={RUNS} active={active} />
    <PremiseStrip asked={asked}>{givens}</PremiseStrip>
    <div className="flex min-h-0 flex-1">{children}</div>
  </>;
}

function FieldCanvas({ status }: { status?: ReactNode }) {
  const [layers, setLayers] = useState({ field: true, isotherms: true, dimensions: true });
  const [view, setView] = useState('overview');
  const dark = useTheme(state => state.theme) === 'dark';
  return <CanvasFrame
    tools={<CanvasToolbar label="画布工具">
      <CanvasLayer icon="result/field" label="温度场" pressed={layers.field} onPressedChange={field => setLayers(value => ({ ...value, field }))} />
      <CanvasLayer icon="result/radial" label="等温线" pressed={layers.isotherms} onPressedChange={isotherms => setLayers(value => ({ ...value, isotherms }))} />
      <CanvasLayer icon="tool/dimension" label="尺寸" pressed={layers.dimensions} onPressedChange={dimensions => setLayers(value => ({ ...value, dimensions }))} />
      <CanvasToolbarSeparator />
      <CanvasTool icon="tool/zoom-out" label="缩小" />
      <CanvasTool icon="tool/fit" label="回到全貌" />
      <CanvasTool icon="tool/zoom-in" label="放大" />
    </CanvasToolbar>}
    view={<Segmented floating label="视图" value={view} onValueChange={setView} options={[{ value: 'cluster', label: '电缆簇' }, { value: 'overview', label: '全景' }]} />}
    legend={<TemperatureLegend title="颜色是土壤温度" ambient={FIELD_RANGE.ambient} limit={FIELD_RANGE.limit} stops={fieldStops()} strength={dark ? 0.24 : 1} lines={5} />}
    status={status ?? <>
      <span>视图：{view === 'overview' ? '全景' : '电缆簇'}</span>
      <span>{METHOD}</span>
      <span className="ml-auto">迭代 {RUN_SOLVER.iterations} 次收敛</span>
    </>}>
    <SectionField />
  </CanvasFrame>;
}

// ---- #1 校核: round one's screen, now under the run records ----

function Conclusion() {
  const cable = RUN_CABLE;
  const losses = cable.losses_w_m;
  const thermal = cable.thermal_k_m_w;
  const group = (title: string, open: boolean, children: ReactNode) => <Disclosure title={title} defaultOpen={open}><div className="px-4 pb-4">{children}</div></Disclosure>;
  return <Panel title="结论" tools={<TierMark tier={RATING.tier} />} className="w-80 flex-none border-l border-line">
    <div className="flex flex-col gap-4 border-b border-line px-4 py-4">
      <Metric label="允许电流" value={RATING.current} unit="A" detail={RATING.basis} />
      <div className="flex flex-col">
        <span className="text-sm text-ink-2">先到温限</span>
        <span className="text-h3 text-ink">{RATING.limiting.name}</span>
      </div>
      <LimitMeter label="导体温度" value={RATING.limiting.conductor} limit={RATING.limiting.limit} from={RATING.limiting.ambient} unit="°C"
        caption={<>保存负荷 <span className="text-ink tabular-nums">{RATING.limiting.load}</span>，余量 <span className="text-ink tabular-nums">{RATING.limiting.margin}</span></>} />
    </div>
    {group('保存负荷下的温度', true, <PropertyList rows={[
      { label: '导体', value: cable.conductor_c.toFixed(1), unit: '°C' },
      { label: '金属屏蔽', value: cable.sheath_c.toFixed(1), unit: '°C' },
      { label: '电缆表面', value: cable.surface_c.toFixed(1), unit: '°C' },
    ]} />)}
    {group('损耗', false, <PropertyList rows={[
      { label: '导体', value: losses.conductor.toFixed(2), unit: 'W/m' },
      { label: '金属屏蔽', value: losses.sheath.toFixed(2), unit: 'W/m' },
      { label: '铠装', value: losses.armour == null ? '' : losses.armour.toFixed(2), unit: 'W/m', missing: losses.armour == null },
      { label: '介质', value: losses.dielectric.toFixed(2), unit: 'W/m' },
      { label: '合计', value: losses.total.toFixed(2), unit: 'W/m' },
    ]} />)}
    {group('热阻', false, <PropertyList rows={[
      { label: 'T₁ 绝缘', value: thermal.t1.toFixed(3), unit: 'K·m/W' },
      { label: 'T₂ 内衬', value: thermal.t2 == null ? '' : thermal.t2.toFixed(3), unit: 'K·m/W', missing: thermal.t2 == null },
      { label: 'T₃ 外护套', value: thermal.t3.toFixed(3), unit: 'K·m/W' },
      { label: 'T₄ 土壤', value: thermal.t4_soil.toFixed(3), unit: 'K·m/W' },
    ]} />)}
  </Panel>;
}

function RatingScreenBody() {
  return <RatingShell active={RATED.id} asked="允许电流 · 单回路能力" givens={<Givens />}>
    <FieldCanvas />
    <Conclusion />
  </RatingShell>;
}

// ---- The givens edited at the side: the drawing stays, the editor takes the conclusion's place ----

function GivensEditor() {
  const layouts = LAYOUTS.map(layout => ({ value: layout.kind, label: layout.label }));
  return <SideEditor title="已知条件" footer={<>
    <Badge variant="attention" className="mr-auto gap-2"><Dot tone="attention" />改了 1 项</Badge>
    <Button variant="outline">放弃</Button>
    <Button><Icon name="run/run" data-icon="inline-start" />按新条件计算</Button>
  </>}>
    <SideEditorSection title="敷设">
      <FormRow label="敷设方式"><ChoiceSelect label="敷设方式" value={installation.layout} options={layouts} /></FormRow>
      <FormRow label="埋深" htmlFor="edit-depth"><UnitInput id="edit-depth" unit="m" defaultValue={installation.depth_m} /></FormRow>
      <FormRow label="护套接地"><ChoiceSelect label="护套接地" value={installation.bonding} options={BONDING} /></FormRow>
    </SideEditorSection>
    <SideEditorSection title="环境">
      <FormRow label="土壤热阻率" htmlFor="edit-soil" changed hint={`运行记录 #${RATED.sequence} 用的是 ${conditions.soil_thermal_resistivity} K·m/W`}>
        <UnitInput id="edit-soil" unit="K·m/W" defaultValue="1.5" />
      </FormRow>
      <FormRow label="环境温度" htmlFor="edit-ambient"><UnitInput id="edit-ambient" unit="°C" defaultValue={conditions.ambient_temperature_c} /></FormRow>
    </SideEditorSection>
    <SideEditorSection title="系统">
      <FormRow label="频率" htmlFor="edit-frequency"><UnitInput id="edit-frequency" unit="Hz" defaultValue={conditions.frequency_hz} /></FormRow>
      <FormRow label="系统电压" htmlFor="edit-voltage"><UnitInput id="edit-voltage" unit="kV" defaultValue={conditions.system_voltage_v / 1000} /></FormRow>
    </SideEditorSection>
    <SideEditorSection title="负荷">
      <FormRow label="负荷电流" htmlFor="edit-current"><UnitInput id="edit-current" unit="A" defaultValue={conditions.currents_a[0]} /></FormRow>
    </SideEditorSection>
  </SideEditor>;
}

function RatingEditBody() {
  return <RatingShell active={RATED.id} asked="允许电流 · 单回路能力" givens={<Givens editing />} editing>
    <FieldCanvas status={<>
      <span className="flex items-center gap-2 text-ink"><Dot tone="attention" />条件改了 1 项，画面仍是运行记录 #{RATED.sequence}</span>
      <span className="ml-auto">{METHOD}</span>
    </>} />
    <GivensEditor />
  </RatingShell>;
}

// ---- #2 扫描: the curve and the numbers of one varied condition ----

type SweepPoint = (typeof SWEEP.points)[number];
const SOIL: Axis = { key: 'value', label: SWEEP.label, unit: SWEEP.unit, format: value => fixed(value, 1) };

function SweepBody() {
  const [shown, setShown] = useState<'ampacity' | 'conductor'>('ampacity');
  const points = SWEEP.points;
  const solved = points.filter(point => point.status === 'succeeded' && point.ampacity !== null);
  const lowest = solved.reduce((low, point) => point.ampacity < low.ampacity ? point : low, solved[0]);
  const hottest = solved.reduce((hot, point) => point.conductor > hot.conductor ? point : hot, solved[0]);
  const at = { value: conditions.soil_thermal_resistivity, label: `工程取值 ${conditions.soil_thermal_resistivity}` };
  const columns: Column<SweepPoint>[] = [
    { key: 'value', header: SWEEP.label, unit: SWEEP.unit, numeric: true, cell: point => fixed(point.value, 1) },
    { key: 'ampacity', header: '允许电流', unit: 'A', numeric: true, width: 'w-28', cell: point => point.status === 'succeeded' ? fixed(point.ampacity, 1)
      : <Tooltip><TooltipTrigger render={<span className="text-error">没有解</span>} /><TooltipContent>{point.error ?? '方法没有给出结果'}</TooltipContent></Tooltip> },
    { key: 'conductor', header: `${SWEEP.load} A 时导体`, unit: '°C', numeric: true, width: 'w-32', cell: point => point.status === 'succeeded' ? fixed(point.conductor, 1) : '—' },
  ];
  return <RatingShell active={SWEPT.id} asked={`允许电流随${SWEEP.label}的变化`}
    givens={<Givens soil={`${fixed(points[0].value, 1)}–${fixed(points[points.length - 1].value, 1)} ${SWEEP.unit} · ${points.length} 点`} />}>
    <Split panes={[
      { id: 'curve', size: 62, min: 40, children: <Panel title={shown === 'ampacity' ? '允许电流' : `保存负荷 ${SWEEP.load} A 时的导体温度`}
          tools={<ToggleGroup value={[shown]} onValueChange={value => value[0] && setShown(value[0] as typeof shown)} size="sm" aria-label="曲线">
            <ToggleGroupItem value="ampacity">允许电流</ToggleGroupItem>
            <ToggleGroupItem value="conductor">导体温度</ToggleGroupItem>
          </ToggleGroup>}
          bodyClassName="flex px-4 pt-4 pb-2">
          {shown === 'ampacity'
            ? <CurveChart className="h-full min-h-64" data={points} x={SOIL} y={{ key: 'ampacity', label: '允许电流', unit: 'A', format: value => fixed(value, 1) }}
              at={at} limit={{ value: SWEEP.load, label: `保存负荷 ${SWEEP.load} A` }} />
            : <CurveChart className="h-full min-h-64" data={points} x={SOIL} y={{ key: 'conductor', label: '导体温度', unit: '°C', format: value => fixed(value, 1) }}
              at={at} limit={{ value: SWEEP.limit, label: `限值 ${SWEEP.limit} °C` }} />}
        </Panel> },
      { id: 'numbers', size: 38, min: 28, children: <Panel title="各点数值" tools={<Button variant="ghost" size="sm"><Icon name="action/export" data-icon="inline-start" />导出 CSV</Button>}>
          <div className="grid grid-cols-2 gap-4 border-b border-line px-4 py-4">
            <Metric size="md" label="范围内最低允许电流" value={fixed(lowest?.ampacity, 1)} unit="A" detail={lowest && `${SWEEP.label} ${fixed(lowest.value, 1)} ${SWEEP.unit} 时`} />
            <Metric size="md" label={`${SWEEP.load} A 时最高导体温度`} value={fixed(hottest?.conductor, 1)} unit="°C" detail={`限值 ${SWEEP.limit} °C`} />
          </div>
          <DataTable rows={points} rowKey={point => String(point.value)} selected={String(conditions.soil_thermal_resistivity)} onSelect={() => undefined} columns={columns} />
        </Panel> },
    ]} />
  </RatingShell>;
}

// ---- #3 选型: every size of the series against the target ----

type Candidate = (typeof SELECTION.candidates)[number];
// The bar's full length: the largest size's current, or the target if that is larger.
const SCALE_A = Math.max(SELECTION.target, ...SELECTION.candidates.map(candidate => candidate.ampacity ?? 0));

function verdict(candidate: Candidate) {
  if (candidate.error) return { tone: 'error' as const, word: '拒算' };
  if (candidate.id === SELECTION.chosen) return { tone: 'selected' as const, word: '选定' };
  return candidate.meets ? { tone: 'secondary' as const, word: '满足' } : { tone: 'outline' as const, word: '不足' };
}

const SELECTION_COLUMNS: Column<Candidate>[] = [
  { key: 'size', header: '规格', width: 'w-24', cell: candidate => <span className="font-medium">{candidate.name.split(' ').pop()}</span> },
  { key: 'ampacity', header: '允许电流', unit: 'A', numeric: true, width: 'w-28', cell: candidate => candidate.ampacity === null ? '—' : fixed(candidate.ampacity, 1) },
  { key: 'bar', header: `对比 ${SELECTION.target} A`, width: 'w-48', cell: candidate => candidate.ampacity === null ? null
    : <TargetBar value={candidate.ampacity} target={SELECTION.target} max={SCALE_A} tone={candidate.id === SELECTION.chosen ? 'chosen' : candidate.meets ? 'meets' : 'short'} /> },
  { key: 'margin', header: '比目标', unit: 'A', numeric: true, width: 'w-28', cell: candidate => candidate.margin === null ? '—'
    : `${candidate.margin >= 0 ? '+' : '−'}${fixed(Math.abs(candidate.margin), 1)}` },
  { key: 'conductor', header: `${SELECTION.target} A 时导体`, unit: '°C', numeric: true, width: 'w-36', cell: candidate => candidate.conductorAtTarget !== null
    ? <span className={candidate.conductorAtTarget > LIMIT_C ? 'text-error' : undefined}>{fixed(candidate.conductorAtTarget, 1)}</span>
    : candidate.atTargetError ? <Tooltip><TooltipTrigger render={<span className="text-ink-2">无稳态解</span>} /><TooltipContent>{candidate.atTargetError}</TooltipContent></Tooltip> : '—' },
  { key: 'verdict', header: '结论', width: 'w-24', cell: candidate => {
    const mark = verdict(candidate);
    const badge = <Badge variant={mark.tone}>{mark.word}</Badge>;
    return candidate.error ? <Tooltip><TooltipTrigger render={badge} /><TooltipContent>{candidate.error}</TooltipContent></Tooltip> : badge;
  } },
];

function SelectionBody() {
  const chosen = SELECTION.candidates.find(candidate => candidate.id === SELECTION.chosen)!;
  const refused = SELECTION.candidates.filter(candidate => candidate.error);
  const unsolved = SELECTION.candidates.filter(candidate => candidate.atTargetError);
  return <RatingShell active={SELECTED.id} asked={`满足 ${SELECTION.target} A 的最小截面`}
    givens={<Givens cable={`${IMPORT.declaration.name} · ${SELECTION.candidates.length} 个规格`} target={SELECTION.target} />}>
    <Panel title={`${SELECTION.candidates.length} 个规格对比 ${SELECTION.target} A`}>
      <DataTable rows={SELECTION.candidates} rowKey={candidate => candidate.id} selected={SELECTION.chosen} onSelect={() => undefined} columns={SELECTION_COLUMNS} />
    </Panel>
    <Panel title="结论" className="w-80 flex-none border-l border-line">
      <div className="flex flex-col gap-4 border-b border-line px-4 py-4">
        <Metric label="选定规格" value={chosen.name.split(' ').pop()} detail={<ReviewMark state={CANDIDATES.find(option => option.id === chosen.id)?.review as Review} />} />
        <div className="grid grid-cols-2 gap-4">
          <Metric size="sm" label="允许电流" value={fixed(chosen.ampacity, 1)} unit="A" />
          <Metric size="sm" label={`比目标 ${SELECTION.target} A`} value={`+${fixed(chosen.margin, 1)}`} unit="A" />
        </div>
        <LimitMeter label={`${SELECTION.target} A 时导体温度`} value={chosen.conductorAtTarget!} limit={LIMIT_C} from={conditions.ambient_temperature_c} unit="°C" />
      </div>
      <Disclosure title="选型规则" defaultOpen><p className="m-0 px-4 pb-4 text-sm text-ink">{SELECTION.rule}</p></Disclosure>
      {unsolved.length > 0 && <Disclosure title={`${SELECTION.target} A 下没有稳态解 ${unsolved.length} 个`}>
        <div className="flex flex-col gap-2 px-4 pb-4 text-sm">
          <span className="font-medium text-ink">{unsolved.map(candidate => candidate.name.split(' ').pop()).join('、')}</span>
          {[...new Set(unsolved.map(candidate => candidate.atTargetError))].map(text => <span key={text} className="text-ink">{text}</span>)}
        </div>
      </Disclosure>}
      {refused.length > 0 && <Disclosure title={`方法拒算 ${refused.length} 个`} defaultOpen>
        <ul className="m-0 flex list-none flex-col gap-3 px-4 pb-4">
          {refused.map(candidate => <li key={candidate.id} className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink">{candidate.name.split(' ').pop()}</span>
            <span className="text-ink">{candidate.error}</span>
          </li>)}
        </ul>
      </Disclosure>}
    </Panel>
  </RatingShell>;
}

// ---- 新建载流量工程: a size, a laying template, the conditions ----

type Option = (typeof CANDIDATES)[number];
const CANDIDATE_COLUMNS: Column<Option>[] = [
  { key: 'name', header: '规格', width: 'w-64', cell: option => <span className="font-medium">{option.name}</span> },
  { key: 'family', header: '系列', cell: option => <span className="text-ink-2">{option.family}</span> },
  { key: 'review', header: '最新版本', width: 'w-28', cell: option => <ReviewMark state={option.review as Review} /> },
];
const LAYOUT_ICON: Record<string, string> = { false: 'tool/place-cable', true: 'tool/duct-bank' };
const LAYER_ROWS = ['conductor_diameter', 'insulation_thickness', 'armour_tape_thickness', 'oversheath_thickness', 'outer_diameter'];

function ProjectNewBody() {
  const picked = CANDIDATES.find(option => option.id === PROJECT.cable)!;
  return <>
    <PageHeader trail={[{ label: '载流量计算' }]} title="新建载流量工程"
      actions={<Button variant="outline">取消</Button>}
      primary={<Button><Icon name="run/run" data-icon="inline-start" />建好并计算</Button>} />
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto bg-surface">
        <div className="mx-auto flex max-w-3xl flex-col gap-10 px-8 py-8">
          <FormSection title="型号" description="从型号库选一个规格，工程按它的最新版本计算。">
            <InputGroup className="w-72">
              <InputGroupAddon><Icon name="action/search" /></InputGroupAddon>
              <InputGroupInput placeholder="搜索规格或系列" aria-label="搜索型号" />
            </InputGroup>
            <DataTable framed rows={CANDIDATES} rowKey={option => option.id} selected={PROJECT.cable} onSelect={() => undefined} columns={CANDIDATE_COLUMNS} />
          </FormSection>
          <FormSection title="敷设方式" description="三芯电缆能用的敷设模板。选多回路或排管时，回路间距和排管尺寸在下面出现。">
            <ChoiceCards label="敷设方式" columns="grid-cols-3" value={DEFAULTS.installation.layout} options={LAYOUTS.map(layout => ({
              value: layout.kind, title: layout.label, icon: LAYOUT_ICON[String(layout.ducted)],
              detail: `${layout.circuits} 个回路${layout.ducted ? ' · 排管' : ''}`,
            }))} />
            <FormRow label="埋深" htmlFor="new-depth"><UnitInput id="new-depth" unit="m" defaultValue={DEFAULTS.installation.depth_m} className="w-48" /></FormRow>
            <FormRow label="护套接地"><div className="w-48"><ChoiceSelect label="护套接地" value={DEFAULTS.installation.bonding} options={BONDING} /></div></FormRow>
          </FormSection>
          <FormSection title="工况" description="方法从这组工况起步，建好后随时可改。">
            <FormRow label="土壤热阻率" htmlFor="new-soil"><UnitInput id="new-soil" unit="K·m/W" defaultValue={DEFAULTS.conditions.soil_thermal_resistivity} className="w-48" /></FormRow>
            <FormRow label="环境温度" htmlFor="new-ambient"><UnitInput id="new-ambient" unit="°C" defaultValue={DEFAULTS.conditions.ambient_temperature_c} className="w-48" /></FormRow>
            <FormRow label="频率" htmlFor="new-frequency"><UnitInput id="new-frequency" unit="Hz" defaultValue={DEFAULTS.conditions.frequency_hz} className="w-48" /></FormRow>
            <FormRow label="系统电压" htmlFor="new-voltage"><UnitInput id="new-voltage" unit="kV" defaultValue={DEFAULTS.conditions.system_voltage_v / 1000} className="w-48" /></FormRow>
            <FormRow label="负荷电流" htmlFor="new-current"><UnitInput id="new-current" unit="A" defaultValue={DEFAULTS.conditions.currents_a[0]} className="w-48" /></FormRow>
          </FormSection>
        </div>
      </div>
      <Panel title="选中的规格" className="w-80 flex-none border-l border-line">
        <div className="flex flex-col gap-1 px-4 pt-4">
          <span className="text-h3 text-ink">{picked.name}</span>
          <span className="text-sm text-ink-2">{picked.family} · 第 {PROJECT.version} 版</span>
        </div>
        <div className="mx-4 my-4 aspect-square rounded-card bg-canvas p-4"><CableSection /></div>
        <PropertyList className="px-4 pb-4" rows={LAYER_ROWS.map(key => WORKSPACE.structure.find(row => row.key === key)!)
          .map(row => ({ label: row.label, value: fixed(row.value as number, 1), unit: row.unit }))} />
      </Panel>
    </div>
  </>;
}

export const RatingBody = RatingScreenBody;
export const RatingEdit = RatingEditBody;
export const RatingSweep = SweepBody;
export const RatingSelection = SelectionBody;
export const ProjectNew = ProjectNewBody;
