import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { studyIndex, typeIndex, workspaces, type StudyRow } from '@/api/research';
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
  const [mode, setMode] = useState('workbench');
  const [create, setCreate] = useState(false);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { workspace?: string };
  const pathname = useLocation({ select: location => location.pathname });
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
      <DropdownMenuTrigger asChild><Button variant="primary" className="sidebar-new"><Icon name="action/add" /><span>新建</span></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => setCreate(true)}>新建研究</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void navigate({ to: '/types', search: { theme } })}>新建型号</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <div className="sidebar-scroll">
      {mode === 'agent'
        ? <section className="sidebar-agent" aria-label="Agent 任务"><Icon name="agent/agent" /><span>Agent 尚未连接模型，任务会按工程列在这里。</span></section>
        : <>
          <div className="tree-caption">工程</div>
          {spaces.isPending ? <div className="tree-empty">读取中</div> : spaces.isError ? <div className="tree-empty">工程读取失败</div> : projects.map(project => (
            <ProjectNode key={text(project.id)} id={text(project.id)} name={text(project.name) || '未命名工程'} theme={theme}
              studies={(studies.data || []).filter(row => row.workspace === text(project.id))}
              initiallyOpen={text(project.id) === activeProject} activeStudy={activeStudy} onSlot={onSlot} />
          ))}
          <div className="tree-caption">型号库<span>全公司共用</span></div>
          {(types.data || []).map(row => {
            const wid = text(row.id);
            const active = wid === activeType;
            return <div key={wid}>
              <Link className="tree-row" to="/types/$wid/$module/$tab" params={{ wid, module: 'structure', tab: 'section' }} search={{ theme }} aria-current={active ? 'page' : undefined}>
                <span className="tree-twist" aria-hidden="true">{active ? '▾' : '▸'}</span><span className="tree-label">{text(row.name)}</span>
              </Link>
              {active && <nav ref={onSlot} className="sidebar-modules" aria-label="型号模块" />}
            </div>;
          })}
          {inGallery && <nav ref={onSlot} className="sidebar-modules" aria-label="陈列导航" />}
        </>}
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

/** 一个工程：标题行可展开/收起；展开后列出研究，当前研究下挂模块导航插槽。 */
function ProjectNode({ id, name, theme, studies, initiallyOpen, activeStudy, onSlot }: { id: string; name: string; theme: 'light' | 'dark'; studies: StudyRow[]; initiallyOpen: boolean; activeStudy: string; onSlot: Slot }) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? initiallyOpen;
  return <div className="tree-project">
    <div className="tree-row tree-project-row">
      <button type="button" className="tree-twist" aria-expanded={open} aria-label={open ? `收起 ${name}` : `展开 ${name}`} onClick={() => setToggled(!open)}>{open ? '▾' : '▸'}</button>
      <Link className="tree-label" to="/studies" search={{ theme, workspace: id }}>{name}</Link>
    </div>
    {open && <div className="tree-children">
      {studies.length ? studies.map(study => {
        const module = rootModule(study.definition);
        const active = study.id === activeStudy;
        return <div key={study.id}>
          <Link className="tree-row" to="/studies/$sid/$module/$tab" params={{ sid: study.id, module, tab: studyEntryTab(module) }} search={{ workspace: study.workspace, theme, run: '', delivery: '' }} aria-current={active ? 'page' : undefined}>
            <span className="tree-twist" aria-hidden="true">{active ? '▾' : ''}</span><span className="tree-label" title={study.title}>{withinProject(study.title, name)}</span>
          </Link>
          {active && <nav ref={onSlot} className="sidebar-modules" aria-label="研究模块" />}
        </div>;
      }) : <div className="tree-empty">尚无研究</div>}
    </div>}
  </div>;
}
