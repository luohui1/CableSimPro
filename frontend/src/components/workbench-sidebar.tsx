import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { studyIndex, typeIndex, workspaces } from '@/api/research';
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
      {/* 第一层只列对象：工程与型号。工程里的模型、计算、交付在工作窗口左侧的工程浏览器中。 */}
      <div className="tree-caption"><Icon name="object/folder" />工程</div>
      {spaces.isPending ? <div className="tree-empty">读取中</div> : spaces.isError ? <div className="tree-empty">工程读取失败</div> : projects.map(project => {
        const id = text(project.id), rows = (studies.data || []).filter(row => row.workspace === id);
        const entry = rows[0];
        const module = entry ? rootModule(entry.definition) : '';
        return entry
          ? <Link key={id} className="tree-row tree-object" to="/studies/$sid/$module/$tab" params={{ sid: entry.id, module, tab: studyEntryTab(module) }} search={{ workspace: id, theme, run: '', delivery: '' }} aria-current={id === activeProject ? 'page' : undefined} title={text(project.name)}>
            <Icon name="object/folder" /><span className="tree-label">{text(project.name) || '未命名工程'}</span><span className="tree-count">{rows.length}</span>
          </Link>
          : <Link key={id} className="tree-row tree-object" to="/studies" search={{ theme, workspace: id }} aria-current={id === activeProject ? 'page' : undefined}>
            <Icon name="object/folder" /><span className="tree-label">{text(project.name) || '未命名工程'}</span><span className="tree-count">0</span>
          </Link>;
      })}
      <div className="tree-caption"><Icon name="nav/cable-type" />型号</div>
      {(types.data || []).map(row => {
        const wid = text(row.id);
        return <Link key={wid} className="tree-row tree-object" to="/types/$wid/$module/$tab" params={{ wid, module: 'structure', tab: 'table' }} search={{ theme }} aria-current={wid === activeType ? 'page' : undefined}>
          <Icon name="object/cable" /><span className="tree-label">{text(row.name)}</span>
        </Link>;
      })}
      {inGallery && <nav ref={onSlot} className="sidebar-modules" aria-label="陈列导航" />}
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
