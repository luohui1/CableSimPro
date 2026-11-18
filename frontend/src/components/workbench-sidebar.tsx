import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { typeIndex, workspaces } from '@/api/research';
import { indexAll, indexInbox } from '@/api/object-index';
import { useIdleStart } from '@/lib/use-deferred-start';
import { text } from '@/api/client';
import { Icon } from './icon';
import { BrandLogo } from './brand';
import { Button, IconButton } from './ui/button';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu';
import { LazyCreateStudyDialog as CreateStudyDialog } from './lazy-create-study-dialog';

type Slot = (element: HTMLElement | null) => void;

/**
 * 常驻侧栏，按对象类别排（FRONTEND_REQUIREMENTS §2.3）：首页 · 工作（工程、型号设计）· 资源 · 记录 · 方法。
 * 工作台里也保持展开；工程内部的模型、研究、交付在工作窗口左侧的工程浏览器中。
 */
const LAST_KEY = 'cablesim.last-workbench';
const rememberWorkbench = (href: string) => { try { window.sessionStorage.setItem(LAST_KEY, href); } catch { /* 无痕窗口：不记 */ } };
const lastWorkbench = () => { try { return window.sessionStorage.getItem(LAST_KEY); } catch { return null; } };
const SHOWN = 3;
/** 侧栏里每类只列前几个；当前打开的那个不在前几个里时替换最后一个。 */
function recent<T>(rows: T[], active: (row: T) => boolean): T[] {
  const head = rows.slice(0, SHOWN), current = rows.find(active);
  if (current && !head.includes(current)) head[head.length - 1] = current;
  return head;
}

export function WorkbenchSidebar({ theme, onTheme, onSlot, collapsed, onCollapse }: { theme: 'light' | 'dark'; onTheme: () => void; onSlot: Slot; collapsed: boolean; onCollapse: () => void }) {
  const [create, setCreate] = useState(false);
  const scroll = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { workspace?: string };
  const pathname = useLocation({ select: location => location.pathname });
  const mode = pathname.startsWith('/agent') ? 'agent' : 'workbench';
  // 从 Agent 切回工作台时回到离开前的页面，而不是每次落到研究列表
  const href = useLocation({ select: location => location.href });
  useEffect(() => { if (mode === 'workbench') rememberWorkbench(href); }, [mode, href]);
  const setMode = (next: string) => {
    if (next === mode) return;
    const back = next === 'workbench' ? lastWorkbench() : null;
    if (back) void navigate({ href: back });
    else void navigate({ to: next === 'agent' ? '/agent' : '/studies', search: { theme } });
  };
  const idle = useIdleStart();
  const spaces = useQuery({ queryKey: ['workspace-index'], queryFn: ({ signal }) => workspaces(signal), enabled: idle, staleTime: 30_000 });
  const types = useQuery({ queryKey: ['type-index'], queryFn: ({ signal }) => typeIndex(signal), enabled: idle, staleTime: 30_000 });
  // A workspace index includes model workspaces. Publish the two real indexes
  // together so an initial/refresh response cannot temporarily classify a model
  // as a project. Keep the last complete pair while either index refreshes.
  const [navigationIndex, setNavigationIndex] = useState<{ spaces: Record<string, unknown>[]; types: Record<string, unknown>[] } | null>(null);
  useEffect(() => {
    if (!spaces.isSuccess || !types.isSuccess || spaces.isFetching || types.isFetching) return;
    setNavigationIndex(previous => previous?.spaces === spaces.data && previous?.types === types.data
      ? previous : { spaces: spaces.data, types: types.data });
  }, [spaces.data, spaces.isSuccess, spaces.isFetching, types.data, types.isSuccess, types.isFetching]);
  const indexError = spaces.isError || types.isError;
  const retryIndexes = () => void Promise.all([spaces.refetch(), types.refetch()]);
  // 研究名片（只用于各工程的研究数）和待办数在浏览器空闲后再读，不和页面首屏抢宿主；
  // 当前工程优先取地址里的 workspace，不必等研究列表
  const studies = useQuery({ queryKey: ['study-index', 'sidebar-cards'], queryFn: ({ signal }) => indexAll('study', signal), enabled: idle });
  // 待办数：需要人处理的审核、过期与缺项；进行中的作业不计入
  const inbox = useQuery({ queryKey: ['index-inbox'], queryFn: ({ signal }) => indexInbox(signal), refetchInterval: 60_000, retry: false, enabled: idle });
  const todo = inbox.data ? inbox.data.counts.review + inbox.data.counts.stale + inbox.data.counts.missing : 0;
  const activeStudy = pathname.match(/^\/studies\/([^/]+)/)?.[1] || '';
  const activeType = pathname.match(/^\/types\/([^/]+)/)?.[1] || '';
  const inGallery = pathname.startsWith('/gallery');
  const at = (prefix: string) => pathname === prefix || pathname.startsWith(prefix + '/') ? 'page' as const : undefined;
  const typeRows = navigationIndex?.types || [];
  const typeIds = new Set(typeRows.map(row => text(row.id)));
  const projects = (navigationIndex?.spaces || []).filter(space => !typeIds.has(text(space.id)));
  const activeProject = (typeof search.workspace === 'string' && search.workspace) || studies.data?.items.find(row => row.id === activeStudy)?.parent?.id || '';
  useEffect(() => {
    const container = scroll.current;
    if (!container || collapsed) return;
    const active = container.querySelector<HTMLElement>('.tree-row[aria-current="page"]') || container.querySelector<HTMLElement>('.module-item[aria-current="page"]');
    if (!active) return;
    const viewport = container.getBoundingClientRect(), item = active.getBoundingClientRect();
    if (item.bottom > viewport.bottom) container.scrollTop += item.bottom - viewport.bottom;
    else if (item.top < viewport.top) container.scrollTop += item.top - viewport.top;
  }, [pathname, activeProject, activeType, collapsed, navigationIndex, studies.data]);

  return <aside className="workbench-sidebar" aria-label="导航">
    <div className="sidebar-head">
      <BrandLogo theme={theme} compact={collapsed} />
      <IconButton variant="ghost" icon="nav/sidebar" label={collapsed ? '展开侧栏（Ctrl+B）' : '收起侧栏（Ctrl+B）'} onClick={() => onCollapse()} className="sidebar-collapse" />
    </div>
    <ToggleGroup type="single" value={mode} onValueChange={value => value && setMode(value)} className="sidebar-mode" aria-label="模式">
      <ToggleGroupItem value="workbench">工作台</ToggleGroupItem><ToggleGroupItem value="agent">Agent</ToggleGroupItem>
    </ToggleGroup>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="secondary" className="sidebar-new"><Icon name="action/add" /><span>新建</span></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => setCreate(true)}>新建研究</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void navigate({ to: '/types', search: { theme, create: true } })}>新建型号</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <nav ref={scroll} className="sidebar-scroll" aria-label="对象">
      <Link className="module-item" to="/" search={{ theme }} activeOptions={{ exact: true }} title="首页"><Icon name="nav/home" /><span>首页</span></Link>
      <Link className="module-item" to="/inbox" search={{ theme }} title="待办"><Icon name="status/pending" /><span>待办</span>{!!todo && <span className="sidebar-count">{todo}</span>}</Link>
      <div className="tree-caption">工作</div>
      <Link className="module-item" to="/studies" search={{ theme }} activeOptions={{ exact: true }} title="工程"><Icon name="object/folder" /><span>工程</span></Link>
      {indexError && <div className="tree-empty" role="status">{navigationIndex ? '目录更新失败，暂显示上次读取结果。' : '工程与型号分类读取失败。'}<Button size="compact" variant="ghost" onClick={retryIndexes}>重新读取目录</Button></div>}
      {!navigationIndex ? !indexError && <div className="tree-empty" aria-live="polite">正在读取工程与型号</div> : <>
        {/* 只列最近几个，当前打开的始终在列；其余到列表页找，侧栏不随数量无限变长 */}
        {recent(projects, (project) => text(project.id) === activeProject).map(project => {
          const id = text(project.id), count = (studies.data?.items || []).filter(row => row.parent?.id === id).length;
          return <Link key={id} className="tree-row tree-object" to="/studies" search={{ theme, workspace: id }} aria-current={id === activeProject ? 'page' : undefined} title={text(project.name)}>
            <span className="tree-label">{text(project.name) || '未命名工程'}</span>{studies.data && <span className="tree-count">{count}</span>}
          </Link>;
        })}
        {projects.length > SHOWN && <Link className="tree-row tree-more" to="/studies" search={{ theme }}>全部 {projects.length} 个工程</Link>}
      </>}
      <Link className="module-item" to="/types" search={{ theme }} activeOptions={{ exact: true }} title="型号设计"><Icon name="nav/cable-type" /><span>型号设计</span></Link>
      {recent(typeRows, (row) => text(row.id) === activeType).map(row => {
        const wid = text(row.id);
        return <Link key={wid} className="tree-row tree-object" to="/types/$wid/$module/$tab" params={{ wid, module: 'structure', tab: 'table' }} search={{ theme }} aria-current={wid === activeType ? 'page' : undefined} title={text(row.name)}>
          <span className="tree-label">{text(row.name)}</span>
        </Link>;
      })}
      {typeRows.length > SHOWN && <Link className="tree-row tree-more" to="/types" search={{ theme }}>全部 {typeRows.length} 个型号设计</Link>}
      <div className="tree-caption">资源</div>
      <Link className="module-item" to="/resources/cables" search={{ theme }} aria-current={at('/resources/cables')} title="电缆型号版本"><Icon name="resource/cable-type" /><span>电缆型号版本</span></Link>
      <Link className="module-item" to="/resources/$group" params={{ group: 'materials' }} search={{ theme }} aria-current={at('/resources/materials')} title="材料与部件"><Icon name="resource/material" /><span>材料与部件</span></Link>
      <Link className="module-item" to="/resources/$group" params={{ group: 'templates' }} search={{ theme }} aria-current={at('/resources/templates')} title="模板与计算方案"><Icon name="resource/section-template" /><span>模板与计算方案</span></Link>
      <Link className="module-item" to="/resources/$group" params={{ group: 'standards' }} search={{ theme }} aria-current={at('/resources/standards')} title="标准与规则"><Icon name="source/from-standard" /><span>标准与规则</span></Link>
      <div className="tree-caption">记录</div>
      <Link className="module-item" to="/runs" search={{ theme }} aria-current={at('/runs')} title="运行与作业"><Icon name="run/run" /><span>运行与作业</span></Link>
      <Link className="module-item" to="/deliveries" search={{ theme, workspace: '', delivery: '' }} aria-current={at('/deliveries')} title="交付"><Icon name="object/delivery" /><span>交付</span></Link>
      <div className="tree-caption">方法</div>
      <Link className="module-item" to="/plugins" search={{ theme }} aria-current={at('/plugins')} title="插件"><Icon name="nav/plugin" /><span>插件</span></Link>
      <Link className="module-item" to="/validation" search={{ theme, snapshot: '' }} aria-current={at('/validation')} title="验证算例"><Icon name="result/evidence" /><span>验证算例</span></Link>
      {inGallery && <nav ref={onSlot} className="sidebar-modules" aria-label="陈列导航" />}
    </nav>
    <nav className="sidebar-foot" aria-label="系统">
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="sidebar-user"><Icon name="nav/settings" /><span>本机用户</span><Icon name="action/chevrons-up-down" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onSelect={onTheme}>{theme === 'light' ? '切换深色模式' : '切换浅色模式'}</DropdownMenuItem><DropdownMenuItem onSelect={() => void navigate({ to: '/settings', search: { theme } })}>设置</DropdownMenuItem>{import.meta.env.DEV && <DropdownMenuItem onSelect={() => void navigate({ to: '/gallery', search: { theme } })}>组件陈列（开发）</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
    </nav>
    <CreateStudyDialog open={create} onOpenChange={setCreate} theme={theme} />
  </aside>;
}
