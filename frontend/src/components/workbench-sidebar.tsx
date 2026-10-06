import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { studyIndex, workspaces } from '@/api/research';
import { text } from '@/api/client';
import { rootModule, studyEntryTab } from '@/lib/study-config';
import { Icon } from './icon';
import { BrandLogo } from './brand';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu';

export function WorkbenchSidebar({ theme, onTheme, activeNavigation, sidebar, gallery }: { theme: 'light' | 'dark'; onTheme: () => void; activeNavigation: string; sidebar?: ReactNode; gallery: boolean }) {
  const [mode, setMode] = useState('workbench');
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const pathname = useLocation({ select: location => location.pathname });
  const spaces = useQuery({ queryKey: ['workspace-index'], queryFn: ({signal}) => workspaces(signal) });
  const studies = useQuery({ queryKey: ['study-index'], queryFn: ({signal}) => studyIndex(signal) });
  const simulation = search.kind === 'simulation' || /\/(simulation|electrothermal|transient|sheath-losses|thermal-field|batch)\//.test(pathname);
  const active = activeNavigation === '型号' ? 'design' : activeNavigation === '研究' ? simulation ? 'simulation' : 'ampacity' : 'home';
  const selectedSpace = typeof search.workspace === 'string' ? search.workspace : '';
  const areas = [
    { id: 'home', label: '首页', icon: 'nav/home', to: '/' },
    { id: 'ampacity', label: '载流量计算', icon: 'calc/ampacity', to: '/studies' },
    { id: 'design', label: '电缆设计', icon: 'nav/cable-type', to: '/types' },
    { id: 'simulation', label: '电缆仿真', icon: 'nav/simulation', to: '/studies' },
  ];
  return <aside className="workbench-sidebar" aria-label="工作空间与导航">
    <BrandLogo theme={theme} />
    <Select label="工作空间" placeholder={spaces.isError ? '工作空间读取失败' : '选择工作空间'} value={selectedSpace} loading={spaces.isPending}
      options={(spaces.data || []).map(space => ({ value: text(space.id), label: text(space.name) || '未命名工程' }))}
      onChange={workspace => {
        const study = studies.data?.find(item => item.workspace === workspace);
        if (study) void navigate({ to: '/studies/$sid/$module/$tab', params: {sid: study.id, module: rootModule(study.definition), tab: studyEntryTab(rootModule(study.definition))}, search: {workspace, theme, run: '', delivery: ''} });
        else void navigate({ to: '/studies', search: {workspace, theme} });
      }} />
    <ToggleGroup type="single" value={mode} onValueChange={value => value && setMode(value)} className="sidebar-mode" aria-label="工作模式">
      <ToggleGroupItem value="workbench">工作台</ToggleGroupItem><ToggleGroupItem value="agent">Agent</ToggleGroupItem>
    </ToggleGroup>
    <div className="sidebar-scroll">
      {mode === 'agent' ? <section className="sidebar-agent" aria-label="Agent"><Icon name="agent/agent" /><span>待接入</span></section> : <>
        <nav aria-label="主导航">{areas.map(area => <div key={area.id}>
          <Link to={area.to} search={{ theme, ...(area.id === 'simulation' ? {kind: 'simulation'} : area.id === 'ampacity' ? {kind: 'ampacity'} : {}) }} className="module-item" aria-current={!gallery && active === area.id ? 'page' : undefined}><Icon name={area.icon} /><span>{area.label}</span></Link>
          {active === area.id && sidebar && <nav className="sidebar-modules" aria-label="模块导航">{sidebar}</nav>}
        </div>)}</nav>
        {/* 宿主未提供最近打开记录，按产品要求隐藏该区。 */}
      </>}
    </div>
    <nav aria-label="资源导航"><Link className="module-item" to="/library" search={{theme}}><Icon name="nav/library" />库</Link><Link className="module-item" to="/plugins" search={{theme}}><Icon name="nav/plugin" />插件</Link>{import.meta.env.DEV && <Link className="module-item" to="/gallery" search={{theme}}><Icon name="nav/workbench" />组件陈列</Link>}</nav>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="sidebar-user"><Icon name="nav/settings" />本机用户<Icon name="action/chevrons-up-down" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onSelect={onTheme}>{theme === 'light' ? '切换深色模式' : '切换浅色模式'}</DropdownMenuItem><DropdownMenuItem onSelect={() => void navigate({to:'/settings',search:{theme}})}>设置</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
  </aside>;
}
