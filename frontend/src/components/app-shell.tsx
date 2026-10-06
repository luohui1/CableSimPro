import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { WorkbenchSidebar } from './workbench-sidebar';

export function AppShell({ title, status, actions, tabs, children, property, checks, propertyCollapsed, theme, onTheme, gallery = false, sidebar, activeNavigation = '研究' }: {
  title: string; status: ReactNode; actions: ReactNode; tabs?: ReactNode; children: ReactNode; property?: ReactNode; checks?: ReactNode; propertyCollapsed?: boolean; onUnavailable: (name: string) => void; theme: 'light' | 'dark'; onTheme: () => void; gallery?: boolean; sidebar?: ReactNode; activeNavigation?: string; onGlobalNavigate?: (name: string) => void;
}) {
  return <div className={`app-shell shell-workbench ${gallery ? 'shell-gallery' : ''}`}>
    <WorkbenchSidebar theme={theme} onTheme={onTheme} activeNavigation={activeNavigation} gallery={gallery} sidebar={sidebar || (gallery ? <><Link className="module-item" to="/gallery" search={{theme}}>组件陈列</Link><Link className="module-item" to="/gallery/selection" search={{theme,state:'success',tab:'results'}}>选型样稿</Link></> : undefined)} />
    <section className="work-panel"><header className="topbar"><h1>{title}</h1>{status}<div className="topbar-actions">{actions}</div></header>{tabs && <div className="page-tabs">{tabs}</div>}<div className={`work-body ${property ? 'has-property' : ''} ${propertyCollapsed ? 'is-property-collapsed' : ''}`}><main className="main-content">{children}</main>{property}</div>{checks}</section>
  </div>;
}
