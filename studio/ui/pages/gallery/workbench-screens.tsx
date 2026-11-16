// The three workbench screens: the product library, the workspace of one type, and the ampacity calculation.
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Disclosure, DisclosureMore, DisclosurePanel, DisclosureRoot } from '@/kit/disclosure';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Icon } from '@/kit/icon';
import { ReviewMark, TierMark, VERDICT, VerdictBar, VerdictMark, type Verdict } from '@/kit/marks';
import { LimitMeter, Metric } from '@/kit/metric';
import { PropertyGroup, PropertyList } from '@/kit/properties';
import { CanvasFrame, CanvasLayer, CanvasTool, CanvasToolbar, CanvasToolbarSeparator, TemperatureLegend } from '@/kit/workbench/canvas';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { NavItem, NavSection, WorkbenchNav } from '@/kit/workbench/nav';
import { PageHeader, Panel, Split, Toolbar } from '@/kit/workbench/page';
import { Given, PremiseStrip } from '@/kit/workbench/premise';
import { CableSection, FIELD_RANGE, SectionField, fieldStops } from './figures';
import { LIBRARY, WORKSPACE, type LibrarySeries, type LibrarySpec } from './library-data';
import { MODEL_FACTS, RATING } from './samples';
import { RUN_CABLE, RUN_SOLVER } from './run-document';
import { useTheme } from '@/state/theme';
import { compact, fixed } from '@shared/format';

const PROJECTS = ['YJV22-8.7/15 3×240 直埋载流量校核', 'YJV22-8.7/15 3×240 直埋载流量示例'];
const ORIGIN: Record<string, string> = { public: '公开资料', demo: '演示结构', factory: '本厂' };
const CORES: Record<number, string> = { 1: '单芯', 3: '三芯' };

export function WorkbenchSide({ at }: { at: 'library' | 'series' | 'project' }) {
  return <WorkbenchNav>
    <NavSection icon="nav/cable-type" label="电缆型号">
      <NavItem icon="nav/library" label="型号库" count={LIBRARY.length} active={at === 'library'} />
      <NavItem label="人民电缆集团 YJV22-8.7/15 kV 三芯" nested active={at === 'series'} />
      <NavItem label="人民电缆集团 YJV-8.7/15 kV 三芯" nested />
    </NavSection>
    <NavSection icon="calc/ampacity" label="载流量计算">
      <NavItem icon="object/study" label="全部工程" count={PROJECTS.length} />
      {PROJECTS.map((name, index) => <NavItem key={name} label={name} nested active={at === 'project' && index === 0} />)}
    </NavSection>
  </WorkbenchNav>;
}

// ---- 型号库 ----


function CheckCell({ check }: { check: Record<string, number> | null }) {
  if (!check) return <span className="text-ink-2">未核对</span>;
  return <VerdictBar counts={check} />;
}

// Dimensions to one decimal as the catalogue prints them; resistance to four significant figures; weight whole.
const SPEC_COLUMNS: Column<LibrarySpec>[] = [
  { key: 'key', header: '规格', width: 'w-32', cell: spec => <span className="font-medium">{spec.key}</span> },
  { key: 'version', header: '版本', width: 'w-24', cell: spec => `第 ${spec.version} 版` },
  { key: 'review', header: '审核', width: 'w-28', cell: spec => <ReviewMark state={spec.review} /> },
  { key: 'conductor', header: '导体外径', unit: 'mm', numeric: true, width: 'w-28', cell: spec => fixed(spec.conductor) },
  { key: 'insulation', header: '绝缘', unit: 'mm', numeric: true, width: 'w-24', cell: spec => fixed(spec.insulation) },
  { key: 'sheath', header: '护套', unit: 'mm', numeric: true, width: 'w-24', cell: spec => fixed(spec.sheath) },
  { key: 'od', header: '外径', unit: 'mm', numeric: true, width: 'w-24', cell: spec => fixed(spec.od) },
  { key: 'weight', header: '重量', unit: 'kg/km', numeric: true, width: 'w-28', cell: spec => fixed(spec.weight, 0) },
  { key: 'r20', header: 'R₂₀', unit: 'Ω/km', numeric: true, width: 'w-28', cell: spec => compact(spec.r20) },
  { key: 'check', header: '标准核对', width: 'w-40', cell: spec => <CheckCell check={spec.check} /> },
];

function SeriesHeader({ series }: { series: LibrarySeries }) {
  return <span className="flex min-w-0 items-center gap-3">
    <span className="truncate font-medium text-ink">{series.name}</span>
    <span className="shrink-0 text-ink-2">{series.u0_kv}/{series.u_kv} kV · {CORES[series.cores] ?? `${series.cores} 芯`}</span>
  </span>;
}

function LibraryScreenBody() {
  const [open, setOpen] = useState<string[]>([LIBRARY[0].id]);
  const total = LIBRARY.reduce((sum, series) => sum + series.specs.length, 0);
  return <>
    <PageHeader title="型号库" marks={<Badge variant="secondary">{LIBRARY.length} 个系列 · {total} 个规格</Badge>}
      actions={<Button variant="outline"><Icon name="action/add" data-icon="inline-start" />新建型号</Button>}
      primary={<Button><Icon name="action/import" data-icon="inline-start" />导入结构表</Button>} />
    <Toolbar>
      <InputGroup className="w-72">
        <InputGroupAddon><Icon name="action/search" /></InputGroupAddon>
        <InputGroupInput placeholder="搜索型号、规格或制造商" aria-label="搜索型号库" />
      </InputGroup>
      <ToggleGroup defaultValue={['all']} aria-label="来源" className="ml-2">
        <ToggleGroupItem value="all">全部</ToggleGroupItem>
        <ToggleGroupItem value="public">公开资料</ToggleGroupItem>
        <ToggleGroupItem value="demo">演示结构</ToggleGroupItem>
      </ToggleGroup>
    </Toolbar>
    <DataTable className="flex-1" columns={SPEC_COLUMNS} rowKey={spec => spec.id} selected="s-3382c86d.3x240" onSelect={() => undefined}
      groups={LIBRARY.map(series => ({
        key: series.id,
        header: <SeriesHeader series={series} />,
        aside: <>
          <Badge variant="outline">{ORIGIN[series.origin] ?? series.origin}</Badge>
          <span className="w-16 text-right text-sm text-ink-2 tabular-nums">{series.specs.length} 个规格</span>
        </>,
        rows: series.specs,
        open: open.includes(series.id),
        onToggle: () => setOpen(list => list.includes(series.id) ? list.filter(id => id !== series.id) : [...list, series.id]),
      }))} />
  </>;
}

// ---- 一款型号的工作区 ----

const ORIGIN_MARK: Record<string, string> = { table: '表列', series: '系列', standard: '标准' };
const LAYERS = WORKSPACE.structure.filter(row => !['area', 'outer_diameter', 'weight', 'r20'].includes(row.key));

function ElectricalList() {
  const per = (id: string) => WORKSPACE.electrical.find(row => row.id === id);
  const km = (id: string, factor: number, digits: number) => {
    const value = per(id)?.value;
    return value === null || value === undefined ? undefined : (value * factor).toFixed(digits);
  };
  return <>
    <PropertyGroup title="每芯电气参数" aside={<Badge variant="secondary">90 °C</Badge>}>
      <PropertyList rows={[
        { label: '20 °C 直流电阻', value: km('core/1:r20', 1000, 4), unit: 'Ω/km' },
        { label: '工作温度直流电阻', value: km('core/1:dc', 1000, 4), unit: 'Ω/km' },
        { label: '交流电阻', value: km('core/1:ac', 1000, 4), unit: 'Ω/km' },
        { label: '集肤因数 yₛ', value: km('core/1:ys', 1, 4), unit: '' },
        { label: '邻近因数 yₚ', value: km('core/1:yp', 1, 4), unit: '' },
        { label: '每相电容', value: km('core/1:capacitance', 1e9, 3), unit: 'μF/km' },
        { label: '充电电流', value: km('core/1:charging', 1000, 3), unit: 'A/km' },
        { label: '介质损耗', value: km('core/1:dielectric', 1, 4), unit: 'W/m' },
      ]} />
    </PropertyGroup>
    <PropertyGroup title="还没有算">
      <PropertyList rows={[
        { label: '导体几何电感', value: '', missing: true, unit: '未覆盖' },
        { label: '正序阻抗 Z₁', value: '', missing: true, unit: '缺依据' },
        { label: '零序阻抗 Z₀', value: '', missing: true, unit: '缺依据' },
      ]} />
    </PropertyGroup>
  </>;
}

function CheckList() {
  const counts = WORKSPACE.check.reduce<Record<string, number>>((all, row) => ({ ...all, [row.verdict as string]: (all[row.verdict as string] ?? 0) + 1 }), {});
  // The three cores ask the same things: one row per requirement, the cores it applies to after it.
  const grouped = new Map<string, { title: string; verdict: string; cores: string[]; clause: string; reason: string | null }>();
  for (const row of WORKSPACE.check) {
    const match = /^芯 (\d) · (.*)$/.exec(row.title as string);
    const title = match ? match[2] : row.title as string;
    const key = `${row.verdict}/${title}`;
    const entry = grouped.get(key) ?? { title, verdict: row.verdict as string, cores: [], clause: `${String(row.standard).startsWith('GB/T 12706.2') ? '' : `${String(row.standard).split('—')[0]} `}${String(row.clause).split('，')[0]}`, reason: row.reason as string | null };
    if (match) entry.cores.push(`芯 ${match[1]}`);
    grouped.set(key, entry);
  }
  const items = [...grouped.values()];
  const row = (item: (typeof items)[number]) => <li key={item.title} className="flex min-h-9 items-center gap-2 rounded-nav px-2 hover:bg-subtle" title={item.reason ?? undefined}>
    <span className="min-w-0 flex-1 text-sm text-ink">{item.title}{item.cores.length === 3 && <span className="ml-2 text-ink-2">三芯</span>}</span>
    <Badge variant="outline">{item.clause}</Badge>
  </li>;
  // The first six of a section; the rest one click away.
  const section = (verdict: Verdict, open: boolean) => {
    const list = items.filter(item => item.verdict === verdict);
    if (!list.length) return null;
    const rest = list.slice(6);
    return <Disclosure defaultOpen={open} title={<VerdictMark verdict={verdict} count={counts[verdict] ?? 0} />}>
      <ul className="m-0 flex list-none flex-col px-2 pb-3">
        {list.slice(0, 6).map(row)}
        {rest.length > 0 && <DisclosureRoot>
          <DisclosurePanel>{rest.map(row)}</DisclosurePanel>
          <DisclosureMore more={rest.length} />
        </DisclosureRoot>}
      </ul>
    </Disclosure>;
  };
  return <>
    <dl className="m-0 grid grid-cols-3 gap-4 border-b border-line px-4 py-4">
      {(['passed', 'failed', 'missing'] as Verdict[]).map(verdict => <div key={verdict} className="flex flex-col gap-1">
        <dt className="flex items-center gap-1 text-sm text-ink-2"><Icon name={VERDICT[verdict].icon} className={VERDICT[verdict].tone} />{VERDICT[verdict].label}</dt>
        <dd className="m-0 text-metric-sm text-ink tabular-nums">{counts[verdict] ?? 0}</dd>
      </div>)}
    </dl>
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"><Badge variant="outline">GB/T 12706.2—2020</Badge><Badge variant="outline">GB/T 3956—2008</Badge></div>
    {section('failed', true)}
    {section('missing', true)}
    {section('uncovered', false)}
    {section('passed', false)}
  </>;
}

function SeriesScreenBody() {
  return <>
    <PageHeader trail={[{ label: '型号库' }, { label: WORKSPACE.series }]} title={WORKSPACE.name}
      marks={<><Badge variant="outline">第 {WORKSPACE.version.number} 版</Badge><ReviewMark state="draft" /><Badge variant="secondary">公开资料</Badge></>}
      actions={<><Button variant="outline"><Icon name="object/file" data-icon="inline-start" />规格书</Button><Button variant="outline"><Icon name="run/run" data-icon="inline-start" />计算</Button></>}
      primary={<Button><Icon name="action/edit" data-icon="inline-start" />修改结构</Button>} />
    <Split panes={[
      { id: 'section', size: 34, min: 24, children: <Panel title="结构断面" tools={<ToggleGroup defaultValue={['section']} size="sm" aria-label="视图"><ToggleGroupItem value="section">断面</ToggleGroupItem><ToggleGroupItem value="solid">三维</ToggleGroupItem></ToggleGroup>}
          bodyClassName="relative bg-canvas">
          <div className="absolute inset-6"><CableSection /></div>
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1 text-xs text-ink-2 shadow-menu">{MODEL_FACTS.map((fact, index) => <span key={fact.label} className="flex items-center gap-1">{index > 0 && <span aria-hidden="true">·</span>}{fact.label}<span className="font-medium text-ink tabular-nums">{fact.value}</span></span>)}</div>
        </Panel> },
      { id: 'layers', size: 36, min: 26, children: <Panel title="分层结构" tools={<span className="text-sm text-ink-2">外径闭合 {fixed(WORKSPACE.closure.residual_mm, 2)} / {fixed(WORKSPACE.closure.tolerance_mm, 2)} mm</span>}>
          <DataTable rowKey={row => row.key} rows={LAYERS} selected="insulation_thickness" onSelect={() => undefined} columns={[
            { key: 'label', header: '层', cell: row => row.label },
            { key: 'value', header: '厚度 / 直径', unit: 'mm', numeric: true, width: 'w-32', cell: row => row.value },
            { key: 'origin', header: '来源', width: 'w-20', cell: row => <span className="text-ink-2" title={row.basis}>{ORIGIN_MARK[row.origin]}</span> },
          ]} />
        </Panel> },
      { id: 'properties', size: 30, min: 24, children: <Tabs defaultValue="check" className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="flex h-11 shrink-0 items-end border-b border-line px-4">
            <TabsList variant="line" className="h-11 border-b-0">
              <TabsTrigger value="params">参数</TabsTrigger>
              <TabsTrigger value="check">标准核对</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="params" className="min-h-0 overflow-auto"><ElectricalList /></TabsContent>
          <TabsContent value="check" className="min-h-0 overflow-auto"><CheckList /></TabsContent>
        </Tabs> },
    ]} />
  </>;
}

// ---- 载流量计算 ----

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
      { label: '铠装', value: (losses.armour ?? 0).toFixed(2), unit: 'W/m' },
      { label: '介质', value: losses.dielectric.toFixed(2), unit: 'W/m' },
      { label: '合计', value: losses.total.toFixed(2), unit: 'W/m' },
    ]} />)}
    {group('热阻', false, <PropertyList rows={[
      { label: 'T₁ 绝缘', value: thermal.t1.toFixed(3), unit: 'K·m/W' },
      { label: 'T₂ 内衬', value: (thermal.t2 ?? 0).toFixed(3), unit: 'K·m/W' },
      { label: 'T₃ 外护套', value: thermal.t3.toFixed(3), unit: 'K·m/W' },
      { label: 'T₄ 土壤', value: thermal.t4_soil.toFixed(3), unit: 'K·m/W' },
    ]} />)}
  </Panel>;
}

function RatingScreenBody() {
  const [layers, setLayers] = useState({ field: true, isotherms: true, dimensions: true });
  const dark = useTheme(state => state.theme) === 'dark';
  return <>
    <PageHeader trail={[{ label: '载流量计算' }]} title="YJV22-8.7/15 3×240 直埋载流量校核"
      marks={<Badge variant="outline">运行记录 1</Badge>}
      actions={<Button variant="outline"><Icon name="calc/sweep" data-icon="inline-start" />扫一个条件</Button>}
      primary={<Button><Icon name="result/report" data-icon="inline-start" />导出计算书</Button>} />
    <PremiseStrip asked="允许电流 · 单回路能力">
      <Given label="型号" value="YJV22-8.7/15 kV 3×240" />
      <Given label="敷设" value="三芯直埋 · 单回" />
      <Given label="埋深" value="1.2 m" />
      <Given label="土壤热阻率" value="1 K·m/W" />
      <Given label="环境" value="25 °C" />
      <Given label="负荷" value="300 A" />
      <Given label="系统" value="15 kV · 50 Hz" />
      <Given label="护套" value="两端接地" />
    </PremiseStrip>
    <div className="flex min-h-0 flex-1">
      <CanvasFrame
        tools={<CanvasToolbar label="画布工具">
          <CanvasLayer icon="result/field" label="温度场" pressed={layers.field} onPressedChange={field => setLayers(value => ({ ...value, field }))} />
          <CanvasLayer icon="result/radial" label="等温线" pressed={layers.isotherms} onPressedChange={isotherms => setLayers(value => ({ ...value, isotherms }))} />
          <CanvasLayer icon="tool/dimension" label="尺寸" pressed={layers.dimensions} onPressedChange={dimensions => setLayers(value => ({ ...value, dimensions }))} />
          <CanvasToolbarSeparator />
          <CanvasTool icon="tool/zoom-out" label="缩小" />
          <CanvasTool icon="tool/fit" label="回到全貌" />
          <CanvasTool icon="tool/zoom-in" label="放大" />
        </CanvasToolbar>}
        view={<ToggleGroup defaultValue={['overview']} aria-label="视图" className="rounded-lg border border-line bg-surface p-1 shadow-menu">
          <ToggleGroupItem value="cluster">电缆簇</ToggleGroupItem>
          <ToggleGroupItem value="overview">全景</ToggleGroupItem>
        </ToggleGroup>}
        legend={<TemperatureLegend title="颜色是土壤温度" ambient={FIELD_RANGE.ambient} limit={FIELD_RANGE.limit} stops={fieldStops()} strength={dark ? 0.24 : 1} lines={5} />}
        status={<>
          <span>视图：全景</span>
          <span>IEC 60287 稳态载流量 · cablesim.iec60287 1.2.0</span>
          <span className="ml-auto">迭代 {RUN_SOLVER.iterations} 次收敛</span>
        </>}>
        <SectionField />
      </CanvasFrame>
      <Conclusion />
    </div>
  </>;
}

export const LibraryBody = LibraryScreenBody;
export const SeriesBody = SeriesScreenBody;
export const RatingBody = RatingScreenBody;
