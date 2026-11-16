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
import { PageHeader, PageTabs, Panel, Split, Toolbar } from '@/kit/workbench/page';
import { VersionSelect } from '@/kit/workbench/review';
import { CableSection } from './figures';
import { LIBRARY, WORKSPACE, type LibrarySeries, type LibrarySpec } from './library-data';
import { PROJECT_NAMES, RATING_TABLE, VERSIONS } from './host-records';
import { MODEL_FACTS } from './samples';
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
export function SeriesShell({ page, version, primary, actions, children }: {
  page: 'structure' | 'params' | 'rating' | 'versions';
  version: number;
  primary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const shown = VERSIONS.find(item => item.number === version)!;
  return <>
    <PageHeader trail={[{ label: '型号库' }, { label: WORKSPACE.series }]} title={WORKSPACE.name}
      marks={<><VersionSelect value={version} versions={VERSIONS.map(item => ({ number: item.number, review: item.review as Review }))} />
        <ReviewMark state={shown.review as Review} /><Badge variant="secondary">公开资料</Badge></>}
      actions={actions} primary={primary} />
    <PageTabs value={page} items={SERIES_PAGES} />
    {children}
  </>;
}

function SeriesScreenBody() {
  return <SeriesShell page="structure" version={WORKSPACE.version.number}
    actions={<><Button variant="outline"><Icon name="object/file" data-icon="inline-start" />规格书</Button><Button variant="outline"><Icon name="run/run" data-icon="inline-start" />计算</Button></>}
    primary={<Button><Icon name="action/edit" data-icon="inline-start" />修改结构</Button>}>
    <Split panes={[
      { id: 'section', size: 34, min: 24, children: <Panel title="结构断面" tools={<ToggleGroup defaultValue={['section']} size="sm" aria-label="视图"><ToggleGroupItem value="section">断面</ToggleGroupItem><ToggleGroupItem value="solid">三维</ToggleGroupItem></ToggleGroup>}
          bodyClassName="relative bg-canvas">
          <div className="absolute inset-6"><CableSection /></div>
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1 text-xs text-ink-2 shadow-menu">{MODEL_FACTS.map((fact, index) => <span key={fact.label} className="flex items-center gap-1">{index > 0 && <span aria-hidden="true">·</span>}{fact.label}<span className="font-medium text-ink tabular-nums">{fact.value}</span></span>)}</div>
        </Panel> },
      { id: 'layers', size: 36, min: 26, children: <Panel title="分层结构" tools={<span className="text-sm text-ink-2">{residualText(WORKSPACE.closure.residual_mm, WORKSPACE.closure.placed_in)}</span>}>
          <DataTable rowKey={row => row.key} rows={LAYERS} selected="insulation_thickness" onSelect={() => undefined} columns={[
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
