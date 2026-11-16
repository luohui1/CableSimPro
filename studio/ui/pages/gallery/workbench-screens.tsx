// The product library and the workspace of one specification: its header and pages (结构与核对, 参数, 载流量表, 版本与文件),
// and the first page. The other pages are in type-screens.tsx, the ampacity calculation in rating-screens.tsx.
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Disclosure, DisclosureMore, DisclosurePanel, DisclosureRoot } from '@/kit/disclosure';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Icon } from '@/kit/icon';
import { ReviewMark, VERDICT, VerdictBar, VerdictMark, type Review, type Verdict } from '@/kit/marks';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { NavItem, NavSection, WorkbenchNav } from '@/kit/workbench/nav';
import { CanvasFrame, CanvasNote, CanvasTool, CanvasToolbar } from '@/kit/workbench/canvas';
import { PropertyList } from '@/kit/properties';
import { PageHeader, PageTabs, Panel, Split, Toolbar } from '@/kit/workbench/page';
import { ChoiceSelect } from '@/kit/workbench/form';
import { VersionSelect, SpecSwitch } from '@/kit/workbench/review';
import { CableSection, RING_COUNTS, ringsOf } from './figures';
import { LIBRARY, WORKSPACE, type LibrarySeries, type LibrarySpec } from './library-data';
import { PROJECT_NAMES, RATING_TABLE, VERSIONS, SERIES_SPECS } from './host-records';
import { compact, fixed } from '@shared/format';

export const PROJECTS = PROJECT_NAMES;

/** Where the host put the outer diameter's residual (closure.placed_in): the layer that takes it. */
export const PLACED: Record<string, string> = { filler: '填充', binder: '包带' };
export const residualText = (residual: number, placedIn: string | null | undefined) =>
  placedIn ? `外径余量 ${fixed(residual, 2)} mm 计入${PLACED[placedIn] ?? placedIn}` : `外径余量 ${fixed(residual, 2)} mm`;
const ORIGIN: Record<string, string> = { public: '公开资料', demo: '演示结构', factory: '本厂' };
const CORES: Record<number, string> = { 1: '单芯', 3: '三芯' };

export function WorkbenchSide({ at }: { at: 'library' | 'series' | 'projects' | 'project' }) {
  return <WorkbenchNav>
    <NavSection icon="nav/cable-type" label="电缆型号">
      <NavItem icon="nav/library" label="型号库" count={LIBRARY.length} active={at === 'library'} />
      <NavItem label="人民电缆集团 YJV22-8.7/15 kV 三芯" nested active={at === 'series'} />
      <NavItem label="人民电缆集团 YJV-8.7/15 kV 三芯" nested />
    </NavSection>
    <NavSection icon="calc/ampacity" label="载流量计算">
      <NavItem icon="object/study" label="全部工程" count={PROJECTS.length} active={at === 'projects'} />
      {PROJECTS.map((name, index) => <NavItem key={name} label={name} nested active={at === 'project' && index === 0} />)}
    </NavSection>
  </WorkbenchNav>;
}

// ---- 型号库 ----


function CheckCell({ check }: { check: Record<string, number> | null }) {
  if (!check) return <span className="text-ink-2">未核对</span>;
  return <VerdictBar counts={check} />;
}

const SELECTED_SPEC = 's-3382c86d.3x240';
// The review filter stays: a reviewer opens the library to find what waits on them (待审核), and the column itself is quiet.
const REVIEW_FILTER = [{ value: 'all', label: '全部审核状态' }, { value: 'draft', label: '草稿' }, { value: 'submitted', label: '待审核' }, { value: 'reviewed', label: '已审核' }, { value: 'published', label: '已发布' }];

// Dimensions to one decimal as the catalogue prints them; resistance to four significant figures; weight whole.
const SPEC_COLUMNS: Column<LibrarySpec>[] = [
  { key: 'key', header: '规格', width: 'w-28', cell: spec => <span className="font-medium">{spec.key}</span> },
  { key: 'version', header: '版本', width: 'w-20', cell: spec => `第 ${spec.version} 版` },
  { key: 'review', header: '审核', width: 'w-20', cell: spec => <ReviewMark state={spec.review} quiet /> },
  { key: 'conductor', header: '导体外径', unit: 'mm', numeric: true, width: 'w-24', cell: spec => fixed(spec.conductor) },
  { key: 'insulation', header: '绝缘', unit: 'mm', numeric: true, width: 'w-20', cell: spec => fixed(spec.insulation) },
  { key: 'sheath', header: '护套', unit: 'mm', numeric: true, width: 'w-20', cell: spec => fixed(spec.sheath) },
  { key: 'od', header: '外径', unit: 'mm', numeric: true, width: 'w-20', cell: spec => fixed(spec.od) },
  { key: 'weight', header: '重量', unit: 'kg/km', numeric: true, width: 'w-24', cell: spec => fixed(spec.weight, 0) },
  { key: 'r20', header: 'R₂₀', unit: 'Ω/km', numeric: true, width: 'w-24', cell: spec => compact(spec.r20) },
  { key: 'check', header: '标准核对', width: 'w-52', cell: spec => <CheckCell check={spec.check} /> },
  { key: 'open', header: '', width: 'w-20', cell: spec => spec.id === SELECTED_SPEC
    ? <Button variant="ghost" size="sm" aria-label={`打开 ${spec.key}`}>打开<Icon name="action/arrow-right" data-icon="inline-end" /></Button> : null },
];

/** On a wide screen, the selected size beside the table: its section, the numbers that matter, its check, and the way in. */
function SpecPreview({ series, spec }: { series: LibrarySeries; spec: LibrarySpec }) {
  return <Panel title="选中的规格" className="hidden w-96 flex-none border-l border-line 2xl:flex"
    tools={<ReviewMark state={spec.review} />} bodyClassName="flex flex-col">
    <div className="flex flex-col gap-1 px-4 pt-4">
      <span className="text-h3 text-ink">{series.designation}-{series.u0_kv}/{series.u_kv} kV {spec.key}</span>
      <span className="text-sm text-ink-2">{series.name} · 第 {spec.version} 版</span>
    </div>
    <div className="mx-4 my-4 aspect-square rounded-card bg-canvas p-6"><CableSection /></div>
    <PropertyList className="px-4" rows={[
      { label: '导体外径', value: fixed(spec.conductor), unit: 'mm' },
      { label: '绝缘标称厚度', value: fixed(spec.insulation), unit: 'mm' },
      { label: '外护套标称厚度', value: fixed(spec.sheath), unit: 'mm' },
      { label: '外径', value: fixed(spec.od), unit: 'mm' },
      { label: '重量', value: fixed(spec.weight, 0), unit: 'kg/km' },
      { label: 'R₂₀', value: compact(spec.r20), unit: 'Ω/km' },
    ]} />
    <div className="mt-4 flex flex-col gap-2 border-t border-line px-4 py-4">
      <span className="text-sm text-ink-2">标准核对</span>
      <CheckCell check={spec.check} />
    </div>
    <div className="mt-auto border-t border-line px-4 py-4">
      <Button variant="outline" className="w-full">打开这个规格<Icon name="action/arrow-right" data-icon="inline-end" /></Button>
    </div>
  </Panel>;
}

function SeriesHeader({ series }: { series: LibrarySeries }) {
  return <span className="flex min-w-0 items-center gap-3">
    <span className="truncate font-medium text-ink">{series.name}</span>
    <span className="shrink-0 text-ink-2">{series.u0_kv}/{series.u_kv} kV · {CORES[series.cores] ?? `${series.cores} 芯`}</span>
  </span>;
}

export function LibraryScreenBody({ ticked, onTick, toolbar }: { ticked?: string[]; onTick?: (keys: string[]) => void; toolbar?: ReactNode } = {}) {
  const [open, setOpen] = useState<string[]>([LIBRARY[0].id]);
  const total = LIBRARY.reduce((sum, series) => sum + series.specs.length, 0);
  const selectedSeries = LIBRARY.find(series => series.specs.some(spec => spec.id === SELECTED_SPEC))!;
  const selectedSpec = selectedSeries.specs.find(spec => spec.id === SELECTED_SPEC)!;
  return <>
    <PageHeader trail={[{ label: '电缆型号' }]} title="型号库" marks={<Badge variant="secondary">{LIBRARY.length} 个系列 · {total} 个规格</Badge>}
      actions={<Button variant="outline"><Icon name="action/add" data-icon="inline-start" />新建型号</Button>}
      primary={<Button><Icon name="action/import" data-icon="inline-start" />导入结构表</Button>} />
    {toolbar ?? <Toolbar>
      <InputGroup className="w-72">
        <InputGroupAddon><Icon name="action/search" /></InputGroupAddon>
        <InputGroupInput placeholder="搜索型号、规格或制造商" aria-label="搜索型号库" />
      </InputGroup>
      <ToggleGroup defaultValue={['all']} aria-label="来源" className="ml-2">
        <ToggleGroupItem value="all">全部</ToggleGroupItem>
        <ToggleGroupItem value="public">公开资料</ToggleGroupItem>
        <ToggleGroupItem value="demo">演示结构</ToggleGroupItem>
      </ToggleGroup>
      <ChoiceSelect label="审核状态" size="sm" value="all" options={REVIEW_FILTER} />
    </Toolbar>}
    <div className="flex min-h-0 flex-1">
    <DataTable className="flex-1" columns={SPEC_COLUMNS} rowKey={spec => spec.id} selected={SELECTED_SPEC} onSelect={() => undefined} onOpen={() => undefined}
      checked={ticked} onCheckedChange={onTick} checkLabel={spec => `选中 ${spec.key}`}
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
    <SpecPreview series={selectedSeries} spec={selectedSpec} />
    </div>
  </>;
}

// ---- 一款型号的工作区 ----

const ORIGIN_MARK: Record<string, string> = { table: '表列', series: '系列', standard: '标准' };
// The ring of the drawing each row of the table sizes.
const ROLE_OF: Record<string, string> = {
  conductor_diameter: 'conductor', conductor_screen_thickness: 'conductor_screen', insulation_thickness: 'insulation',
  insulation_screen_thickness: 'insulation_screen', screen_tape_thickness: 'metallic_screen', bedding_thickness: 'bedding',
  armour_tape_thickness: 'armour', oversheath_thickness: 'oversheath',
};
const SELECTED_LAYER = 'insulation_thickness';
const LAYERS = WORKSPACE.structure.filter(row => !['area', 'outer_diameter', 'weight', 'r20'].includes(row.key));

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
    return <Disclosure defaultOpen={open} title={<VerdictMark verdict={verdict} count={counts[verdict] ?? 0} />}
      aside={<span className="text-sm font-normal text-ink-2">{list.length} 条要求</span>}>
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

const SERIES_PAGES = [
  { value: 'structure', label: '结构与核对' },
  { value: 'params', label: '参数' },
  { value: 'rating', label: '载流量表' },
  { value: 'versions', label: '版本与文件', count: VERSIONS.length },
];

/** The header of one specification and its pages. The page shows one version; the header says which and where it stands. */
export function SeriesShell({ page, version, review, primary, actions, children }: {
  page: 'structure' | 'params' | 'rating' | 'versions';
  version: number;
  /** The review state to show instead of the host's present one: the version as it stood when a dialog opened on it. */
  review?: Review;
  primary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const shown = VERSIONS.find(item => item.number === version)!;
  const size = WORKSPACE.name.split(' ').at(-1) ?? '';
  return <>
    <PageHeader trail={[{ label: '电缆型号' }, { label: '型号库' }, { label: WORKSPACE.series }]} title={WORKSPACE.name.replace(` ${size}`, '')}
      marks={<><SpecSwitch value={size} specs={SERIES_SPECS.map(spec => ({ key: spec.key, review: spec.review as Review }))} />
        <VersionSelect value={version} versions={VERSIONS.map(item => ({ number: item.number, review: (item.number === version && review) || item.review as Review }))} />
        <ReviewMark state={review ?? shown.review as Review} /><Badge variant="secondary">公开资料</Badge></>}
      actions={actions} primary={primary} />
    <PageTabs value={page} items={SERIES_PAGES} />
    {children}
  </>;
}

export function SeriesScreenBody({ review }: { review?: Review } = {}) {
  const selectedLayer = WORKSPACE.structure.find(row => row.key === SELECTED_LAYER);
  return <SeriesShell page="structure" version={WORKSPACE.version.number} review={review}
    actions={<><Button variant="outline"><Icon name="object/file" data-icon="inline-start" />规格书</Button><Button variant="outline"><Icon name="run/run" data-icon="inline-start" />计算</Button></>}
    primary={<Button><Icon name="action/edit" data-icon="inline-start" />修改结构</Button>}>
    <Split panes={[
      { id: 'section', size: 34, min: 24, children: <Panel title="结构断面" tools={<ToggleGroup defaultValue={['section']} size="sm" aria-label="视图"><ToggleGroupItem value="section">断面</ToggleGroupItem><ToggleGroupItem value="solid">三维</ToggleGroupItem></ToggleGroup>}
          bodyClassName="flex">
          <CanvasFrame
            tools={<CanvasToolbar label="断面工具"><CanvasTool icon="tool/zoom-out" label="缩小" /><CanvasTool icon="tool/fit" label="适应窗口" /><CanvasTool icon="tool/zoom-in" label="放大" /></CanvasToolbar>}
            legend={selectedLayer && <CanvasNote>
              <span className="size-2 shrink-0 rounded-full bg-copper" aria-hidden="true" />
              {selectedLayer.label}<span className="font-medium tabular-nums">{selectedLayer.value} {selectedLayer.unit}</span>
              {ringsOf(ROLE_OF[selectedLayer.key]) > 1 && <span className="text-ink-2">{RING_COUNTS.cores} 芯各一层</span>}
            </CanvasNote>}
            status={<>
              <span>外径 {fixed(WORKSPACE.structure.find(row => row.key === 'outer_diameter')?.value as number)} mm</span>
              <span>断面 {RING_COUNTS.total} 层：{RING_COUNTS.cores} 芯各 {RING_COUNTS.perCore} 层，共用 {RING_COUNTS.common} 层</span>
            </>}>
            <div className="absolute inset-8"><CableSection highlight={selectedLayer ? ROLE_OF[selectedLayer.key] : undefined} /></div>
          </CanvasFrame>
        </Panel> },
      { id: 'layers', size: 36, min: 26, children: <Panel title="分层结构" tools={<span className="text-sm text-ink-2">{residualText(WORKSPACE.closure.residual_mm, WORKSPACE.closure.placed_in)}</span>}>
          <DataTable rowKey={row => row.key} rows={LAYERS} selected={SELECTED_LAYER} onSelect={() => undefined} columns={[
            { key: 'label', header: '层', cell: row => row.label },
            { key: 'value', header: '厚度 / 直径', unit: 'mm', numeric: true, width: 'w-32', cell: row => row.value },
            { key: 'origin', header: '来源', width: 'w-20', cell: row => <span className="text-ink-2" title={row.basis}>{ORIGIN_MARK[row.origin]}</span> },
          ]} />
        </Panel> },
      { id: 'check', size: 30, min: 24, children: <Panel title="标准核对"><CheckList /></Panel> },
    ]} />
  </SeriesShell>;
}

export const LibraryBody = LibraryScreenBody;
export const SeriesBody = SeriesScreenBody;
