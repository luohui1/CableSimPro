import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { studyIndex, studyRuns, typeIndex, workspaces, type StudyRow } from '@/api/research';
import { text } from '@/api/client';
import { rootModule, studyEntryTab } from '@/lib/study-config';
import { Icon } from './icon';
import { BrandLogo } from './brand';
import { Button, IconButton } from './ui/button';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu';
import { CreateStudyDialog } from './create-study-dialog';

type Slot = (element: HTMLElement | null) => void;

/**
 * 常驻侧栏（ZCode 式）：工程逐级展开 → 研究 → 当前研究的模块；型号库单独一区。
 * 当前对象的模块导航由页面经插槽（onSlot）以 portal 放入它所在的树节点下。
 */
export function WorkbenchSidebar({ theme, onTheme, onSlot, collapsed, onCollapse }: { theme: 'light' | 'dark'; onTheme: () => void; onSlot: Slot; collapsed: boolean; onCollapse: () => void }) {
  const [create, setCreate] = useState(false);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { workspace?: string };
  const pathname = useLocation({ select: location => location.pathname });
  const mode = pathname.startsWith('/agent') ? 'agent' : 'workbench';
  const setMode = (next: string) => { if (next !== mode) void navigate({ to: next === 'agent' ? '/agent' : '/studies', search: { theme } }); };
  const spaces = useQuery({ queryKey: ['workspace-index'], queryFn: ({ signal }) => workspaces(signal) });
  const types = useQuery({ queryKey: ['type-index'], queryFn: ({ signal }) => typeIndex(signal) });
  const studies = useQuery({ queryKey: ['study-index'], queryFn: ({ signal }) => studyIndex(signal) });

  const activeStudy = pathname.match(/^\/studies\/([^/]+)/)?.[1] || '';
  const activeType = pathname.match(/^\/types\/([^/]+)/)?.[1] || '';
  const inLibrary = pathname.startsWith('/library');
  const inGallery = pathname.startsWith('/gallery');
  const typeIds = new Set((types.data || []).map(row => text(row.id)));
  const projects = (spaces.data || []).filter(space => !typeIds.has(text(space.id)));
  const activeProject = studies.data?.find(row => row.id === activeStudy)?.workspace || (typeof search.workspace === 'string' ? search.workspace : '');

  return <aside className="workbench-sidebar" aria-label="导航">
    <div className="sidebar-head">
      <BrandLogo theme={theme} compact={collapsed} />
      <IconButton variant="ghost" icon="nav/sidebar" label={collapsed ? '展开侧栏（Ctrl+B）' : '收起侧栏（Ctrl+B）'} onClick={onCollapse} className="sidebar-collapse" />
    </div>
    <ToggleGroup type="single" value={mode} onValueChange={value => value && setMode(value)} className="sidebar-mode" aria-label="模式">
      <ToggleGroupItem value="workbench">工作台</ToggleGroupItem><ToggleGroupItem value="agent">Agent</ToggleGroupItem>
    </ToggleGroup>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="secondary" className="sidebar-new"><Icon name="action/add" /><span>新建</span></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => setCreate(true)}>新建研究</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void navigate({ to: '/types', search: { theme } })}>新建型号</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <div className="sidebar-scroll">
      <>
          <div className="tree-caption"><Icon name="object/folder" />工程</div>
          {spaces.isPending ? <div className="tree-empty">读取中</div> : spaces.isError ? <div className="tree-empty">工程读取失败</div> : projects.map(project => (
            <ProjectNode key={text(project.id)} id={text(project.id)} name={text(project.name) || '未命名工程'} theme={theme}
              studies={(studies.data || []).filter(row => row.workspace === text(project.id))}
              initiallyOpen={text(project.id) === activeProject} activeStudy={activeStudy} onCreate={() => setCreate(true)} />
          ))}
          <div className="tree-caption"><Icon name="nav/cable-type" />型号</div>
          {(types.data || []).map(row => {
            const wid = text(row.id);
            const active = wid === activeType;
            return <div key={wid}>
              <Link className="tree-row" to="/types/$wid/$module/$tab" params={{ wid, module: 'structure', tab: 'section' }} search={{ theme }} aria-current={active ? 'page' : undefined}>
                <span className="tree-twist" aria-hidden="true">{active ? '▾' : '▸'}</span><Icon name="object/cable" /><span className="tree-label">{text(row.name)}</span>
              </Link>
              {active && <nav ref={onSlot} className="sidebar-modules" aria-label="型号模块" />}
            </div>;
          })}
          {inGallery && <nav ref={onSlot} className="sidebar-modules" aria-label="陈列导航" />}
      </>
    </div>
    <nav className="sidebar-foot" aria-label="资源">
      <Link className="module-item" to="/library" search={{ theme }} aria-current={inLibrary ? 'page' : undefined}><Icon name="nav/library" /><span>库</span></Link>
      {inLibrary && <nav ref={onSlot} className="sidebar-modules" aria-label="库导航" />}
      <Link className="module-item" to="/plugins" search={{ theme }}><Icon name="nav/plugin" /><span>插件</span></Link>
      {import.meta.env.DEV && <Link className="module-item" to="/gallery" search={{ theme }}><Icon name="nav/workbench" /><span>组件陈列</span></Link>}
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="sidebar-user"><Icon name="nav/settings" /><span>本机用户</span><Icon name="action/chevrons-up-down" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onSelect={onTheme}>{theme === 'light' ? '切换深色模式' : '切换浅色模式'}</DropdownMenuItem><DropdownMenuItem onSelect={() => void navigate({ to: '/settings', search: { theme } })}>设置</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </nav>
    <CreateStudyDialog open={create} onOpenChange={setCreate} theme={theme} />
  </aside>;
}

/** 研究名在工程下面显示时去掉重复的工程名前缀（如「城北变电站 · 」）。 */
function withinProject(title: string, project: string) {
  const head = project.split(' · ')[0];
  return head && title.startsWith(head + ' · ') ? title.slice(head.length + 3) : title;
}

/** 每类计算一个图标，侧栏一眼分清是选型、扫描还是仿真。 */
const CALC_ICONS: Record<string, string> = {
  selection: 'calc/selection', ampacity: 'calc/ampacity', sweep: 'calc/sweep', 'method-compare': 'module/method-compare',
  'thermal-field': 'calc/thermal-field', electrothermal: 'calc/thermal-field', transient: 'calc/thermal-field',
  'sheath-losses': 'calc/induced-voltage', simulation: 'nav/simulation', batch: 'nav/simulation', hybrid: 'calc/cross-check',
};

/** 计算的运行状态点：成功 / 部分成功 / 失败 / 未运行，来自运行摘要。 */
function RunDot({ workspace, study }: { workspace: string; study: string }) {
  const runs = useQuery({ queryKey: ['runs', workspace, study, 'summary'], queryFn: ({ signal }) => studyRuns(workspace, study, signal, 'summary') });
  const status = text(runs.data?.at(-1)?.status);
  const kind = ['succeeded', 'partial'].includes(status) ? 'is-ok' : ['failed', 'rejected', 'cancelled'].includes(status) ? 'is-error' : status ? 'is-running' : 'is-off';
  return <span className={`status-dot ${kind}`} aria-label={kind === 'is-ok' ? '已有结果' : kind === 'is-error' ? '运行失败' : kind === 'is-running' ? '运行中' : '未运行'} />;
}

/**
 * 一个工程：模型（截面、电缆、工况，所有计算共用）→ 计算（只列真实存在的）→ 交付。
 * 模型节点切换当前计算工作窗口里的画布视图，不是单独页面。
 */
function ProjectNode({ id, name, theme, studies, initiallyOpen, activeStudy, onCreate }: { id: string; name: string; theme: 'light' | 'dark'; studies: StudyRow[]; initiallyOpen: boolean; activeStudy: string; onCreate: () => void }) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? initiallyOpen;
  const current = studies.find(study => study.id === activeStudy) || studies[0];
  const at = (study: StudyRow, module: string, tab: string, view?: 'section' | 'cable') => ({
    to: '/studies/$sid/$module/$tab' as const, params: { sid: study.id, module, tab },
    search: { workspace: study.workspace, theme, run: '', delivery: '', ...(view ? { view } : {}) },
  });
  const calcModule = current ? rootModule(current.definition) : '';
  return <div className="tree-project">
    <div className="tree-row tree-project-row">
      <button type="button" className="tree-twist" aria-expanded={open} aria-label={open ? `收起 ${name}` : `展开 ${name}`} onClick={() => setToggled(!open)}>{open ? '▾' : '▸'}</button>
      <Icon name="object/folder" />
      <Link className="tree-label" to="/studies" search={{ theme, workspace: id }} title={name}>{name}</Link>
      {!open && <span className="tree-count">{studies.length}</span>}
    </div>
    {open && <div className="tree-children">
      {current && <>
        <div className="tree-group"><Icon name="object/overview" />模型</div>
        <Link className="tree-row tree-leaf" {...at(current, calcModule, studyEntryTab(calcModule), 'section')}><Icon name="object/section" /><span className="tree-label">敷设截面</span></Link>
        <Link className="tree-row tree-leaf" {...at(current, calcModule, studyEntryTab(calcModule), 'cable')}><Icon name="object/cable" /><span className="tree-label">电缆</span></Link>
        <Link className="tree-row tree-leaf" {...at(current, calcModule, studyEntryTab(calcModule), 'section')}><Icon name="object/conditions" /><span className="tree-label">工况</span></Link>
      </>}
      <div className="tree-group"><Icon name="calc/ampacity" />计算</div>
      {studies.map(study => {
        const module = rootModule(study.definition);
        return <Link key={study.id} className="tree-row tree-leaf" {...at(study, module, studyEntryTab(module))} aria-current={study.id === activeStudy ? 'page' : undefined}>
          <Icon name={CALC_ICONS[module] || 'object/study'} /><span className="tree-label" title={study.title}>{withinProject(study.title, name)}</span><RunDot workspace={study.workspace} study={study.id} />
        </Link>;
      })}
      <button type="button" className="tree-row tree-leaf tree-add" onClick={onCreate}><Icon name="action/add" /><span className="tree-label">添加计算</span></button>
      {current && <>
        <div className="tree-group"><Icon name="object/delivery" />交付</div>
        <Link className="tree-row tree-leaf" {...at(current, 'report', 'content')}><Icon name="result/report" /><span className="tree-label">计算书</span></Link>
      </>}
    </div>}
  </div>;
}
