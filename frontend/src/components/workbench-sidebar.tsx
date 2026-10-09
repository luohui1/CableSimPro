import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { studyIndex, typeIndex, workspaces } from '@/api/research';
import { indexInbox } from '@/api/object-index';
import { useIdleStart } from '@/lib/use-deferred-start';
import { text } from '@/api/client';
import { rootModule, studyEntryTab } from '@/lib/study-config';
import { Icon } from './icon';
import { BrandLogo } from './brand';
import { Button, IconButton } from './ui/button';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu';
import { CreateStudyDialog } from './create-study-dialog';
import { AgentTaskList } from '@/features/agent/task-list';

type Slot = (element: HTMLElement | null) => void;

/**
 * 常驻侧栏，按对象类别排（FRONTEND_REQUIREMENTS §2.3）：首页 · 工作（工程、型号设计）· 资源 · 记录 · 方法。
 * 工作台里也保持展开；工程内部的模型、研究、交付在工作窗口左侧的工程浏览器中。
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
  // 全库研究列表（只用于各工程的研究数）和待办数在浏览器空闲后再读，不和页面首屏抢宿主；
  // 当前工程优先取地址里的 workspace，不必等研究列表
  const idle = useIdleStart();
  const studies = useQuery({ queryKey: ['study-index'], queryFn: ({ signal }) => studyIndex(signal), enabled: idle });
  // 待办数：需要人处理的审核、过期与缺项；进行中的作业不计入
  const inbox = useQuery({ queryKey: ['index-inbox'], queryFn: ({ signal }) => indexInbox(signal), refetchInterval: 60_000, retry: false, enabled: idle });
  const todo = inbox.data ? inbox.data.counts.review + inbox.data.counts.stale + inbox.data.counts.missing : 0;
  const activeStudy = pathname.match(/^\/studies\/([^/]+)/)?.[1] || '';
  const activeType = pathname.match(/^\/types\/([^/]+)/)?.[1] || '';
  const inGallery = pathname.startsWith('/gallery');
  const at = (prefix: string) => pathname === prefix || pathname.startsWith(prefix + '/') ? 'page' as const : undefined;
  const typeIds = new Set((types.data || []).map(row => text(row.id)));
  const projects = (spaces.data || []).filter(space => !typeIds.has(text(space.id)));
  const activeProject = (typeof search.workspace === 'string' && search.workspace) || studies.data?.find(row => row.id === activeStudy)?.workspace || '';

  return <aside className="workbench-sidebar" aria-label="导航">
    <div className="sidebar-head">
      <BrandLogo theme={theme} compact={collapsed} />
      <IconButton variant="ghost" icon="nav/sidebar" label={collapsed ? '展开侧栏（Ctrl+B）' : '收起侧栏（Ctrl+B）'} onClick={() => onCollapse()} className="sidebar-collapse" />
    </div>
    <ToggleGroup type="single" value={mode} onValueChange={value => value && setMode(value)} className="sidebar-mode" aria-label="模式">
      <ToggleGroupItem value="workbench">工作台</ToggleGroupItem><ToggleGroupItem value="agent">Agent</ToggleGroupItem>
    </ToggleGroup>
    {/* Agent 模式下左栏换成任务列表 */}
    {mode === 'agent' ? <AgentTaskList theme={theme} /> : <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="secondary" className="sidebar-new"><Icon name="action/add" /><span>新建</span></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => setCreate(true)}>新建研究</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void navigate({ to: '/types', search: { theme, create: true } })}>新建型号</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <nav className="sidebar-scroll" aria-label="对象">
      <Link className="module-item" to="/" search={{ theme }} activeOptions={{ exact: true }}><Icon name="nav/home" /><span>首页</span></Link>
      <Link className="module-item" to="/inbox" search={{ theme }}><Icon name="status/pending" /><span>待办</span>{!!todo && <span className="sidebar-count">{todo}</span>}</Link>
      <div className="tree-caption">工作</div>
      <Link className="module-item" to="/studies" search={{ theme }} activeOptions={{ exact: true }}><Icon name="object/folder" /><span>工程</span></Link>
      {spaces.isPending ? <div className="tree-empty">读取中</div> : spaces.isError ? <div className="tree-empty">工程读取失败</div> : projects.map(project => {
        const id = text(project.id), rows = (studies.data || []).filter(row => row.workspace === id);
        const entry = rows[0];
        const module = entry ? rootModule(entry.definition) : '';
        return entry
          ? <Link key={id} className="tree-row tree-object" to="/studies/$sid/$module/$tab" params={{ sid: entry.id, module, tab: studyEntryTab(module) }} search={{ workspace: id, theme, run: '', delivery: '' }} aria-current={id === activeProject ? 'page' : undefined} title={text(project.name)}>
            <span className="tree-label">{text(project.name) || '未命名工程'}</span><span className="tree-count">{rows.length}</span>
          </Link>
          : <Link key={id} className="tree-row tree-object" to="/studies" search={{ theme, workspace: id }} aria-current={id === activeProject ? 'page' : undefined}>
            <span className="tree-label">{text(project.name) || '未命名工程'}</span><span className="tree-count">0</span>
          </Link>;
      })}
      <Link className="module-item" to="/types" search={{ theme }} activeOptions={{ exact: true }}><Icon name="nav/cable-type" /><span>型号设计</span></Link>
      {(types.data || []).map(row => {
        const wid = text(row.id);
        return <Link key={wid} className="tree-row tree-object" to="/types/$wid/$module/$tab" params={{ wid, module: 'structure', tab: 'table' }} search={{ theme }} aria-current={wid === activeType ? 'page' : undefined} title={text(row.name)}>
          <span className="tree-label">{text(row.name)}</span>
        </Link>;
      })}
      <div className="tree-caption">资源</div>
      <Link className="module-item" to="/resources/cables" search={{ theme }} aria-current={at('/resources/cables')}><Icon name="resource/cable-type" /><span>电缆型号版本</span></Link>
      <Link className="module-item" to="/resources/$group" params={{ group: 'materials' }} search={{ theme }} aria-current={at('/resources/materials')}><Icon name="resource/material" /><span>材料与部件</span></Link>
      <Link className="module-item" to="/resources/$group" params={{ group: 'templates' }} search={{ theme }} aria-current={at('/resources/templates')}><Icon name="resource/section-template" /><span>模板与计算方案</span></Link>
      <Link className="module-item" to="/resources/$group" params={{ group: 'standards' }} search={{ theme }} aria-current={at('/resources/standards')}><Icon name="source/from-standard" /><span>标准与规则</span></Link>
      <div className="tree-caption">记录</div>
      <Link className="module-item" to="/runs" search={{ theme }} aria-current={at('/runs')}><Icon name="run/run" /><span>运行与作业</span></Link>
      <Link className="module-item" to="/deliveries" search={{ theme, workspace: '', delivery: '' }} aria-current={at('/deliveries')}><Icon name="object/delivery" /><span>交付</span></Link>
      <div className="tree-caption">方法</div>
      <Link className="module-item" to="/plugins" search={{ theme }} aria-current={at('/plugins')}><Icon name="nav/plugin" /><span>插件</span></Link>
      <Link className="module-item" to="/validation" search={{ theme, snapshot: '' }} aria-current={at('/validation')}><Icon name="result/evidence" /><span>验证算例</span></Link>
      {inGallery && <nav ref={onSlot} className="sidebar-modules" aria-label="陈列导航" />}
    </nav>
    </>}
    <nav className="sidebar-foot" aria-label="系统">
      {import.meta.env.DEV && <Link className="module-item" to="/gallery" search={{ theme }}><Icon name="nav/workbench" /><span>组件陈列</span></Link>}
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="sidebar-user"><Icon name="nav/settings" /><span>本机用户</span><Icon name="action/chevrons-up-down" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onSelect={onTheme}>{theme === 'light' ? '切换深色模式' : '切换浅色模式'}</DropdownMenuItem><DropdownMenuItem onSelect={() => void navigate({ to: '/settings', search: { theme } })}>设置</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </nav>
    <CreateStudyDialog open={create} onOpenChange={setCreate} theme={theme} />
  </aside>;
}
