import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from '@tanstack/react-router';
import { useShellSlot } from './shell-layout';

/** 页面内容面板：顶栏、页签、主区与属性栏。侧栏由常驻外壳提供，页面的模块导航经 portal 放进侧栏。 */
export function AppShell({ title, path, status, actions, tabs, children, property, checks, propertyCollapsed, theme, gallery = false, sidebar }: {
  title: string; path?: string; status: ReactNode; actions: ReactNode; tabs?: ReactNode; children: ReactNode; property?: ReactNode; checks?: ReactNode; propertyCollapsed?: boolean; onUnavailable: (name: string) => void; theme: 'light' | 'dark'; onTheme: () => void; gallery?: boolean; sidebar?: ReactNode; activeNavigation?: string; onGlobalNavigate?: (name: string) => void;
}) {
  const slot = useShellSlot();
  // 属性栏开合时只在这一次挂上过渡（ZCode useAnimatedResizablePanel 的做法），平时不挂，窗口缩放不拖慢。
  const layout = `${!!property}/${!!propertyCollapsed}`;
  const [previousLayout, setPreviousLayout] = useState(layout);
  const [animating, setAnimating] = useState(false);
  if (previousLayout !== layout) { setPreviousLayout(layout); setAnimating(true); }
  useEffect(() => {
    if (!animating) return;
    const timer = window.setTimeout(() => setAnimating(false), 260);
    return () => window.clearTimeout(timer);
  }, [animating, layout]);
  const modules = sidebar || (gallery ? <><Link className="module-item" to="/gallery" search={{theme}}>组件陈列</Link><Link className="module-item" to="/gallery/selection" search={{theme,state:'success',tab:'results'}}>选型样稿</Link></> : null);
  return <>
    {slot && modules && createPortal(modules, slot)}
    <section className={`work-panel ${gallery ? 'shell-gallery' : ''}`}><header className="topbar">{path && <span className="topbar-path">{path}<span aria-hidden="true">/</span></span>}<h1>{title}</h1>{status}<div className="topbar-actions">{actions}</div></header>{tabs && <div className="page-tabs">{tabs}</div>}<div className={`work-body ${property ? 'has-property' : ''} ${propertyCollapsed ? 'is-property-collapsed' : ''}`} data-animating={animating || undefined}><main className="main-content">{children}</main>{property}</div>{checks}</section>
  </>;
}
