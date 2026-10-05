import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Icon } from './icon';
import { Button } from './ui/button';
import { WorkbenchCommandMenu } from './workbench-command-menu';
import { WorkbenchWelcome } from './workbench-welcome';
import {
  WORKBENCH_NAVIGATION, isNavigationShortcut, readSidebarPreference,
  saveSidebarPreference, type WorkbenchDestination,
} from '../lib/workbench-navigation';
import '../styles/workbench.css';

const modules = [['电缆', 'object/cable'], ['敷设截面', 'object/section'], ['工况', 'object/conditions'], ['载流量', 'calc/ampacity'], ['温度场', 'calc/thermal-field'], ['问询选型', 'calc/selection'], ['计算书', 'module/datasheet']] as const;

export interface AppShellProps {
  title: string; status: ReactNode; actions: ReactNode; tabs?: ReactNode;
  children: ReactNode; property?: ReactNode; checks?: ReactNode; propertyCollapsed?: boolean;
  onUnavailable: (name: string) => void; theme: 'light' | 'dark'; onTheme: () => void;
  gallery?: boolean; sidebar?: ReactNode; activeNavigation?: string;
  onGlobalNavigate?: (name: string) => void;
}

export function AppShell({ title, status, actions, tabs, children, property, checks,
  propertyCollapsed, onUnavailable, theme, onTheme, gallery = false, sidebar,
  activeNavigation = '研究' }: AppShellProps) {
  const navigate = useNavigate();
  const sidebarId = useId();
  const mainId = useId();
  const [commandOpen, setCommandOpen] = useState(false);
  const [navigationError, setNavigationError] = useState('');
  const [collapsed, setCollapsed] = useState(() => {
    try { return typeof window !== 'undefined' && readSidebarPreference(window.localStorage); }
    catch { return false; }
  });

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (!isNavigationShortcut(event) || commandOpen) return;
      // Do not open over a confirmation dialog or interrupt its focus boundary.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      event.preventDefault();
      setCommandOpen(true);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [commandOpen]);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try { saveSidebarPreference(window.localStorage, next); } catch { /* Preference storage is optional. */ }
  }
  function openDestination(destination: WorkbenchDestination) {
    setNavigationError('');
    // The existing TanStack Router blockers remain authoritative for dirty drafts.
    void Promise.resolve(navigate({ to: destination.to, search: { theme } }))
      .catch(() => setNavigationError('页面切换失败，请重试。当前输入未由导航器修改。'));
  }

  return (
    <div className={`app-shell workbench-shell ${gallery ? 'shell-gallery' : ''}`} data-sidebar-collapsed={collapsed}>
      <a className="wb-skip-link" href={`#${mainId}`} onClick={(event) => { event.preventDefault(); document.getElementById(mainId)?.focus(); }}>跳到工作区</a>
      <header className="wb-appbar">
        <Link className="wb-brand" to="/" search={{ theme }} aria-label="CableSimPro 首页"><span className="wb-brand-symbol" aria-hidden="true"><Icon name="nav/study" /></span><strong>CableSimPro</strong></Link>
        <span className="wb-appbar-divider" aria-hidden="true" />
        <span className="wb-appbar-context">{gallery ? '组件陈列' : '工程工作台'}</span>
        <button className="wb-launcher" type="button" onClick={() => setCommandOpen(true)} aria-label="快速导航" aria-keyshortcuts="Control+K Meta+K"><Icon name="action/search" /><span>快速导航</span><kbd>Ctrl / ⌘ K</kbd></button>
        <Button variant="ghost" size="compact" onClick={onTheme} aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'}><span aria-hidden="true">{theme === 'light' ? '◐' : '◑'}</span><span className="wb-theme-label">{theme === 'light' ? '深色' : '浅色'}</span></Button>
      </header>
      <nav className="nav-rail" aria-label="主导航">
        <button className="wb-sidebar-toggle" type="button" onClick={toggleSidebar} aria-expanded={!collapsed} aria-controls={sidebarId} aria-label={collapsed ? '展开模块导航' : '收起模块导航'} title={collapsed ? '展开模块导航' : '收起模块导航'}><Icon name={collapsed ? 'action/chevron-right' : 'action/chevron-down'} /></button>
        {WORKBENCH_NAVIGATION.map((item) => <button type="button" key={item.id} onClick={() => openDestination(item)} aria-current={!gallery && item.label === activeNavigation ? 'page' : undefined} className={`rail-item ${item.id === 'settings' ? 'rail-settings' : ''}`}><Icon name={item.icon} /><span>{item.label}</span></button>)}
      </nav>
      <aside id={sidebarId} className="module-sidebar" aria-label="模块导航" hidden={collapsed}>
        <div className="sidebar-caption"><span>{gallery ? '公共组件' : activeNavigation}</span><span className="wb-sidebar-caption-detail">工作区导航</span></div>
        <div className="wb-context-content">{sidebar || (gallery ? <><Link className="module-item" to="/gallery" search={{ theme }}>组件陈列</Link><Link className="module-item" to="/gallery/selection" search={{ theme, state: 'success', tab: 'results' }}>选型样稿</Link></> : modules.map(([label, icon]) => <button className="module-item" type="button" key={label} aria-current={label === '问询选型' ? 'page' : undefined} onClick={() => label !== '问询选型' && onUnavailable(label)}><Icon name={icon} /><span>{label}</span></button>))}</div>
        <div className="sidebar-bottom"><span className="wb-sidebar-note">工程数据由宿主管理</span>{import.meta.env.DEV && <Button asChild variant="ghost" size="compact"><Link to="/gallery" search={{ theme }}>组件</Link></Button>}</div>
      </aside>
      <section className="work-panel" aria-label={`${activeNavigation}工作区`}>
        <div className="wb-document-path" aria-label="当前位置"><span>{gallery ? '设计系统' : '工作区'}</span><Icon name="action/chevron-right" /><span>{activeNavigation}</span><Icon name="action/chevron-right" /><span className="wb-current-document" title={title}>{title}</span></div>
        <header className="topbar"><div className="wb-document-heading"><h1 title={title}>{title}</h1><div className="wb-document-status">{status}</div></div><div className="topbar-actions">{actions}</div></header>
        {navigationError && <div className="wb-navigation-error" role="alert">{navigationError}</div>}
        {tabs && <div className="page-tabs">{tabs}</div>}
        <div className={`work-body ${property ? 'has-property' : ''} ${propertyCollapsed ? 'is-property-collapsed' : ''}`}>
          <main id={mainId} tabIndex={-1} className="main-content">{!gallery && activeNavigation === '首页' && <WorkbenchWelcome />}{children}</main>{property}
        </div>
        {checks}
      </section>
      <footer className="wb-statusbar"><span>{gallery ? '组件预览' : '工程研究工作区'}</span><span className="wb-statusbar-boundary">计算状态与工程批准分别记录</span><button type="button" onClick={() => setCommandOpen(true)}>快速导航 <kbd>Ctrl / ⌘ K</kbd></button></footer>
      <WorkbenchCommandMenu open={commandOpen} onOpenChange={setCommandOpen} onNavigate={openDestination} />
    </div>
  );
}
