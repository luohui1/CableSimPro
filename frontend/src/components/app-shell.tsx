import type { ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Icon } from './icon';
import { Button } from './ui/button';

const navigation = [['首页', 'nav/home'], ['型号', 'nav/cable-type'], ['研究', 'nav/study'], ['库', 'nav/library'], ['插件', 'nav/plugin'], ['设置', 'nav/settings']] as const;
const modules = [['电缆', 'object/cable'], ['敷设截面', 'object/section'], ['工况', 'object/conditions'], ['载流量', 'calc/ampacity'], ['温度场', 'calc/thermal-field'], ['问询选型', 'calc/selection'], ['计算书', 'module/datasheet']] as const;

export function AppShell({ title, status, actions, tabs, children, property, checks, propertyCollapsed, onUnavailable, theme, onTheme, gallery = false, sidebar, activeNavigation = '研究', onGlobalNavigate }: {
  title: string; status: ReactNode; actions: ReactNode; tabs?: ReactNode; children: ReactNode; property?: ReactNode; checks?: ReactNode; propertyCollapsed?: boolean; onUnavailable: (name: string) => void; theme: 'light' | 'dark'; onTheme: () => void; gallery?: boolean; sidebar?: ReactNode; activeNavigation?: string; onGlobalNavigate?: (name: string) => void;
}) {
  const navigate = useNavigate();
  const destinations: Record<string, string> = { 首页: '/', 型号: '/types', 研究: '/studies', 库: '/library', 插件: '/plugins', 设置: '/settings' };
  return <div className={`app-shell ${gallery ? 'shell-gallery' : ''}`}>
    <nav className="nav-rail" aria-label="主导航">{navigation.map(([label, icon]) => <button type="button" key={label} aria-current={!gallery && label === activeNavigation ? 'page' : undefined} className={`rail-item ${label === '设置' ? 'rail-settings' : ''}`} onClick={() => destinations[label] ? void navigate({ to: destinations[label], search: { theme } }) : (onGlobalNavigate || onUnavailable)(label)}><Icon name={icon} /><span>{label}</span></button>)}</nav>
    <aside className="module-sidebar" aria-label="模块导航"><div className="sidebar-caption">{gallery ? '公共组件' : activeNavigation}</div>{sidebar || (gallery ? <><Link className="module-item" to="/gallery" search={{ theme }}>组件陈列</Link><Link className="module-item" to="/gallery/selection" search={{ theme, state: 'success', tab: 'results' }}>选型样稿</Link></> : modules.map(([label, icon]) => <button className="module-item" type="button" key={label} aria-current={label === '问询选型' ? 'page' : undefined} onClick={() => label !== '问询选型' && onUnavailable(label)}><Icon name={icon} /><span>{label}</span></button>))}<div className="sidebar-bottom">{gallery && <Button variant="ghost" size="compact" onClick={onTheme}>{theme === 'light' ? '深色模式' : '浅色模式'}</Button>}{import.meta.env.DEV && <Button asChild variant="ghost" size="compact"><Link to="/gallery" search={{ theme }}>组件</Link></Button>}</div></aside>
    <section className="work-panel"><header className="topbar"><h1>{title}</h1>{status}<div className="topbar-actions">{actions}</div></header>{tabs && <div className="page-tabs">{tabs}</div>}<div className={`work-body ${property ? 'has-property' : ''} ${propertyCollapsed ? 'is-property-collapsed' : ''}`}><main className="main-content">{children}</main>{property}</div>{checks}</section>
  </div>;
}
