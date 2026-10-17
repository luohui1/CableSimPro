import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Icon } from './icon';
import { Button } from './ui/button';
import '../styles/workspace.css';
import '../styles/type-workspace.css';

const navigation = [['首页', 'nav/home'], ['型号', 'nav/cable-type'], ['研究', 'nav/study'], ['库', 'nav/library'], ['插件', 'nav/plugin'], ['设置', 'nav/settings']] as const;
const modules = [['电缆', 'object/cable'], ['敷设截面', 'object/section'], ['工况', 'object/conditions'], ['载流量', 'calc/ampacity'], ['温度场', 'calc/thermal-field'], ['问询选型', 'calc/selection'], ['计算书', 'module/datasheet']] as const;

/** Retain the desktop workspace and destinations; disclose navigation in narrow layouts. */
export function AppShell({ title, status, actions, tabs, children, property, checks, propertyCollapsed, onUnavailable, theme, onTheme, gallery = false, sidebar, activeNavigation = '研究', onGlobalNavigate }: {
  title: string; status: ReactNode; actions: ReactNode; tabs?: ReactNode; children: ReactNode; property?: ReactNode; checks?: ReactNode; propertyCollapsed?: boolean; onUnavailable: (name: string) => void; theme: 'light' | 'dark'; onTheme: () => void; gallery?: boolean; sidebar?: ReactNode; activeNavigation?: string; onGlobalNavigate?: (name: string) => void;
}) {
  const navigate = useNavigate(), uid = useId();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const main = useRef<HTMLElement>(null), toggle = useRef<HTMLButtonElement>(null);
  const sidebarId = `${uid}-modules`, mainId = `${uid}-content`;
  const destinations: Record<string, string> = { 首页: '/', 型号: '/types', 研究: '/studies', 库: '/library', 插件: '/plugins', 设置: '/settings' };
  useEffect(() => { setNavigationOpen(false); }, [activeNavigation, title]);
  function closeNavigation(restoreFocus = false) { setNavigationOpen(false); if (restoreFocus) toggle.current?.focus(); }
  return <div className={`app-shell ${gallery ? 'shell-gallery' : ''}`} data-ui-polish="true" data-navigation-open={navigationOpen}>
    <a className="shell-skip" href={`#${mainId}`} onClick={event => { event.preventDefault(); main.current?.focus(); }}>跳到工作区</a>
    <nav className="nav-rail" aria-label="主导航">{navigation.map(([label, icon]) => <button type="button" key={label} aria-current={!gallery && label === activeNavigation ? 'page' : undefined} className={`rail-item ${label === '设置' ? 'rail-settings' : ''}`} onClick={() => { closeNavigation(); if (destinations[label]) void navigate({ to: destinations[label], search: { theme } }); else (onGlobalNavigate || onUnavailable)(label); }}><Icon name={icon} /><span>{label}</span></button>)}</nav>
    <aside id={sidebarId} className="module-sidebar" aria-label="模块导航"
      onClickCapture={event => { if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.target instanceof Element && event.target.closest('a[href],button.module-item:not([disabled])')) closeNavigation(); }}
      onKeyDown={event => { if (event.key === 'Escape' && navigationOpen && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); closeNavigation(true); } }}>
      <div className="sidebar-caption"><span>{gallery ? '公共组件' : activeNavigation}</span><button type="button" className="button button-ghost button-compact shell-nav-close" onClick={() => closeNavigation(true)} aria-label="收起模块导航">收起</button></div>
      {sidebar || (gallery ? <><Link className="module-item" to="/gallery" search={{ theme }}>组件陈列</Link><Link className="module-item" to="/gallery/selection" search={{ theme, state: 'success', tab: 'results' }}>选型样稿</Link></> : modules.map(([label, icon]) => <button className="module-item" type="button" key={label} aria-current={label === '问询选型' ? 'page' : undefined} onClick={() => label !== '问询选型' && onUnavailable(label)}><Icon name={icon} /><span>{label}</span></button>))}
      <div className="sidebar-bottom"><Button variant="ghost" size="compact" onClick={onTheme} aria-label={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}>{theme === 'light' ? '深色模式' : '浅色模式'}</Button>{import.meta.env.DEV && <Button asChild variant="ghost" size="compact"><Link to="/gallery" search={{ theme }}>组件</Link></Button>}</div>
    </aside>
    <section className="work-panel">
      <header className="topbar"><button ref={toggle} type="button" className="button button-outline button-compact shell-nav-toggle" aria-controls={sidebarId} aria-expanded={navigationOpen} onClick={() => setNavigationOpen(value => !value)}>模块导航</button><h1 title={title}>{title}</h1><div className="shell-status">{status}</div><div className="topbar-actions">{actions}</div></header>
      {tabs && <div className="page-tabs">{tabs}</div>}
      <div className={`work-body ${property ? 'has-property' : ''} ${property && propertyCollapsed ? 'is-property-collapsed' : ''}`}><main ref={main} id={mainId} tabIndex={-1} className="main-content">{children}</main>{property}</div>{checks}
    </section>
  </div>;
}
